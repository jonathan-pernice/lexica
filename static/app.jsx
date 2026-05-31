const { useState, useEffect, useRef, useMemo } = React;

const _ARTICLE_RE = /^((?:the|a|an|his|her|its|of|my|your|their|our)\s+)+/i;
function stripArticles(s) {
  if (!s) return s;
  return s.replace(_ARTICLE_RE, "").trim() || s;
}

// ============================================================
// API LAYER
// ============================================================
const api = {
  search: (q, phrase = false) =>
    fetch(`/api/search?q=${encodeURIComponent(q)}&phrase=${phrase ? 1 : 0}`).then(r => r.json()),
  aiSearch: (q) =>
    fetch(`/api/ai-search?q=${encodeURIComponent(q)}`).then(r => r.json()),
  verse: (book, chapter, verse) =>
    fetch(`/api/verse/${encodeURIComponent(book)}/${chapter}/${verse}`).then(r => r.json()),
  verseWords: (book, chapter, verse) =>
    fetch(`/api/verse-words/${encodeURIComponent(book)}/${chapter}/${verse}`).then(r => r.json()),
  strongsCount: (strongs_base) =>
    fetch(`/api/strongs-count/${encodeURIComponent(strongs_base)}`).then(r => r.json()),
  lsj: (lemma, strongs) => {
    const path = lemma || strongs || '';
    if (!path) return Promise.resolve({ error: 'not found' });
    const qs = strongs ? `?strongs=${encodeURIComponent(strongs)}` : '';
    return fetch(`/api/lsj/${encodeURIComponent(path)}${qs}`).then(r => r.json());
  },
  lsjSummary: (key, strongs, book, chapter, verse) => {
    const hasDot = strongs && strongs.includes('.');
    const path = key || (hasDot ? strongs : '');
    if (!path) return Promise.resolve({ error: 'not found' });
    const p = new URLSearchParams();
    if (hasDot) p.set('strongs', strongs);
    if (book && chapter && verse) { p.set('book', book); p.set('chapter', chapter); p.set('verse', verse); }
    const qs = p.toString() ? `?${p}` : '';
    return fetch(`/api/lsj-summary/${encodeURIComponent(path)}${qs}`).then(r => r.json());
  },
  books: () =>
    fetch("/api/books").then(r => r.json()),
  chapter: (book, ch) =>
    fetch(`/api/chapter/${encodeURIComponent(book)}/${ch}`).then(r => r.json()),
  kjvChapter: (book, ch) =>
    fetch(`/api/kjv/chapter/${encodeURIComponent(book)}/${ch}`).then(r => r.json()),
  kjvVerse: (book, ch, v) =>
    fetch(`/api/kjv/verse/${encodeURIComponent(book)}/${ch}/${v}`).then(r => r.json()),
  kjvVerseWords: (book, ch, v) =>
    fetch(`/api/kjv/verse_words/${encodeURIComponent(book)}/${ch}/${v}`).then(r => r.json()),
  kjvVerseWordsBatch: (refs) =>
    fetch('/api/kjv/verse_words_batch', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(refs)}).then(r => r.json()),
  kjvStrongsCount: (strongs_id) =>
    fetch(`/api/kjv/strongs-count/${encodeURIComponent(strongs_id)}`).then(r => r.json()),
  kjvStrongsSearch: (strongs_id) =>
    fetch(`/api/kjv/strongs-search/${encodeURIComponent(strongs_id)}`).then(r => r.json()),
  pnCount: (name) =>
    fetch(`/api/pn-count/${encodeURIComponent(name)}`).then(r => r.json()),
  metavPerson: (name) =>
    fetch(`/api/metav/person/${encodeURIComponent(name)}`).then(r => r.json()),
  metavAiDescription: (name) =>
    fetch(`/api/metav/ai-description/${encodeURIComponent(name)}`).then(r => r.json()),
  metavPlace: (name) =>
    fetch(`/api/metav/place/${encodeURIComponent(name)}`).then(r => r.json()),
  bdb: (sid) =>
    fetch(`/api/bdb/${encodeURIComponent(sid)}`).then(r => r.json()),
  crossRefsCurated: (book, chapter, verse) =>
    fetch(`/api/cross-references/curated/${encodeURIComponent(book)}/${chapter}/${verse}`).then(r => r.json()),
};

// Extract proper noun name from a multi-word gloss, skipping function words
const _PN_STOP = new Set(["And","But","Or","The","A","An","In","Of","To","For","With","From","By","At","His","Her","Its","Their","My","Your","Our"]);
function extractProperName(gloss) {
  if (!gloss) return "";
  const clean = gloss.replace(/[^a-zA-Z\s'-]/g, "").trim();
  const proper = clean.split(/\s+/).find(w => /^[A-Z]/.test(w) && !_PN_STOP.has(w));
  return proper || "";
}

// ============================================================
// DATA SHAPING
// ============================================================
function strongsTag(snum) {
  if (!snum || snum === "*") return "PN";
  const s = String(snum);
  const hasH = /^H/i.test(s);
  const bare = s.replace(/^[GH]/i, "");
  const n = parseInt(bare, 10);
  if (hasH) return `H${bare}`;
  return `${!isNaN(n) && n > 5624 ? "H" : "G"}${bare}`;
}

function makeEntry(r, idx) {
  const snum = r.strongs_base === "*" ? "*" : (r.strongs || r.strongs_base);
  return {
    id: `${snum}-${r.book}-${r.chapter}-${r.verse}-${idx}`,
    strongs: strongsTag(snum),
    strongs_base: r.strongs_base,
    strongs_raw: snum,
    greek: r.lemma || "",
    translit: r.translit || "",
    gloss: r.gloss || "",
    gloss_head: r.gloss_head || "",
    ref: r.ref,
    book: r.book,
    chapter: r.chapter,
    verse: r.verse,
    definition: r.strongs_def || "",
    derivation: r.derivation || "",
    is_function: r.is_function || false,
  };
}

function flattenAiResults(verses) {
  const entries = [];
  let idx = 0;
  for (const v of verses) {
    for (const w of (v.words || [])) {
      const snum = w.strongs_base === "*" ? "*" : (w.strongs || w.strongs_base);
      entries.push({
        id: `ai-${v.book}-${v.chapter}-${v.verse}-${snum}-${idx++}`,
        strongs: strongsTag(snum),
        strongs_base: w.strongs_base,
        strongs_raw: snum,
        greek: w.lemma || "",
        translit: w.translit || "",
        gloss: w.gloss || "",
        ref: v.ref,
        book: v.book,
        chapter: v.chapter,
        verse: v.verse,
        definition: w.strongs_def || "",
        derivation: w.derivation || "",
        is_function: w.is_function || false,
        is_primary: v.is_primary || false,
        is_additional: v.is_additional || false,
      });
    }
  }
  return entries;
}

// ============================================================
// BOOK LABELS
// ============================================================
const NT_BOOKS = new Set([
  "Mat","Mar","Luk","Joh","Act","Rom","1Co","2Co","Gal","Eph",
  "Php","Col","1Th","2Th","1Ti","2Ti","Tit","Phm","Heb","Jas",
  "1Pe","2Pe","1Jn","2Jn","3Jn","Jud","Rev",
]);

const BOOK_ORDER = {};
[
  "Gen","Exo","Lev","Num","Deu","Jos","Jdg","Rth","1Sa","2Sa",
  "1Ki","2Ki","1Ch","2Ch","Ezr","Neh","Est","Job","Psa","Pro",
  "Ecc","Son","Isa","Jer","Lam","Eze","Dan","Hos","Joe","Amo",
  "Oba","Jon","Mic","Nah","Hab","Zep","Hag","Zec","Mal",
  "Mat","Mar","Luk","Joh","Act","Rom","1Co","2Co","Gal","Eph",
  "Php","Col","1Th","2Th","1Ti","2Ti","Tit","Phm","Heb","Jas",
  "1Pe","2Pe","1Jn","2Jn","3Jn","Jud","Rev",
].forEach((b, i) => { BOOK_ORDER[b] = i; });

const BOOK_LABELS = {
  Gen: "Genesis",      Exo: "Exodus",       Lev: "Leviticus",    Num: "Numbers",
  Deu: "Deuteronomy",  Jos: "Joshua",        Jdg: "Judges",       Rth: "Ruth",
  "1Sa": "1 Samuel",   "2Sa": "2 Samuel",    "1Ki": "1 Kings",    "2Ki": "2 Kings",
  "1Ch": "1 Chronicles", "2Ch": "2 Chronicles", Ezr: "Ezra",      Neh: "Nehemiah",
  Est: "Esther",       Job: "Job",           Psa: "Psalms",       Pro: "Proverbs",
  Ecc: "Ecclesiastes", Son: "Song of Solomon", Isa: "Isaiah",     Jer: "Jeremiah",
  Lam: "Lamentations", Eze: "Ezekiel",       Dan: "Daniel",       Hos: "Hosea",
  Joe: "Joel",         Amo: "Amos",          Oba: "Obadiah",      Jon: "Jonah",
  Mic: "Micah",        Nah: "Nahum",         Hab: "Habakkuk",     Zep: "Zephaniah",
  Hag: "Haggai",       Zec: "Zechariah",     Mal: "Malachi",
  Mat: "Matthew",      Mar: "Mark",          Luk: "Luke",         Joh: "John",
  Act: "Acts",         Rom: "Romans",        "1Co": "1 Corinthians", "2Co": "2 Corinthians",
  Gal: "Galatians",    Eph: "Ephesians",     Php: "Philippians",  Col: "Colossians",
  "1Th": "1 Thessalonians", "2Th": "2 Thessalonians", "1Ti": "1 Timothy", "2Ti": "2 Timothy",
  Tit: "Titus",        Phm: "Philemon",      Heb: "Hebrews",      Jas: "James",
  "1Pe": "1 Peter",    "2Pe": "2 Peter",     "1Jn": "1 John",     "2Jn": "2 John",
  "3Jn": "3 John",     Jud: "Jude",          Rev: "Revelation",
};

// ============================================================
// ICONS — minimal line set
// ============================================================
const Icon = {
  Search: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
    </svg>
  ),
  Sparkle: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>
    </svg>
  ),
  Close: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M6 6l12 12M6 18 18 6"/>
    </svg>
  ),
  ArrowRight: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M5 12h14M13 6l6 6-6 6"/>
    </svg>
  ),
  Book: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5a2.5 2.5 0 0 0 0 5H20"/><path d="M8 6h8M8 10h6"/>
    </svg>
  ),
  Filter: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 6h18M6 12h12M10 18h4"/>
    </svg>
  ),
  Bookmark: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M6 3h12v18l-6-4-6 4z"/>
    </svg>
  ),
  Copy: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>
    </svg>
  ),
  Share: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/>
    </svg>
  ),
  Grid: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  Lines: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 6h18M3 11h18M3 16h12"/>
    </svg>
  ),
  Panel: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M15 3v18"/>
    </svg>
  ),
};

// ============================================================
// HEADER
// ============================================================
function Header({ activeView, onNavChange }) {
  return (
    <header className="hdr">
      <div className="hdr-inner">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5a2.5 2.5 0 0 0 0 5H19v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M11 7v6M14 10h-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="brand-text">
            <div className="brand-name">Lexica</div>
            <div className="brand-sub">Greek &amp; Hebrew Word Study</div>
          </div>
        </div>
        <nav className="hdr-nav">
          <button className={"hdr-link " + (activeView === "search" ? "active" : "")} onClick={() => onNavChange("search")}>Search</button>
          <button className={"hdr-link " + (activeView === "library" ? "active" : "")} onClick={() => onNavChange("library")}>Library</button>
          <button className={"hdr-link " + (activeView === "about" ? "active" : "")} onClick={() => onNavChange("about")}>About</button>
        </nav>
      </div>
    </header>
  );
}

// ============================================================
// SEARCH BAR
// ============================================================
function SearchBar({ q1, setQ1, q2, setQ2, onSearch, onAiSearch, aiLoading, lexLoading }) {
  return (
    <section className="search">
      <div className="search-grid">
        <div className="search-cell">
          <label className="search-label">
            <span className="search-eyebrow">Lexicon</span>
            <span className="search-hint">Word, transliteration, or Strong's №</span>
          </label>
          <form className="search-field" onSubmit={(e) => { e.preventDefault(); onSearch(); }}>
            <Icon.Search className="search-icon"/>
            <input
              type="text"
              className="search-input"
              placeholder="πνεῦμα  ·  pneuma  ·  G4151"
              value={q1}
              onChange={(e) => setQ1(e.target.value)}
            />
            <button type="submit" className="search-go" aria-label="Search">
              {lexLoading ? <span className="spinner"/> : <Icon.ArrowRight/>}
            </button>
          </form>
        </div>
        <div className="search-divider" aria-hidden="true"></div>
        <div className="search-cell">
          <label className="search-label">
            <span className="search-eyebrow ai">
              <span className="ai-dot"></span>
              Ask the corpus
            </span>
            <span className="search-hint">Natural language across the lexicon</span>
          </label>
          <form className="search-field ai-field" onSubmit={(e) => { e.preventDefault(); onAiSearch(); }}>
            <Icon.Sparkle className="search-icon"/>
            <input
              type="text"
              className="search-input"
              placeholder="Where does the divine council appear?"
              value={q2}
              onChange={(e) => setQ2(e.target.value)}
            />
            <button type="submit" className="search-go" aria-label="Submit">
              {aiLoading ? <span className="spinner"/> : <Icon.ArrowRight/>}
            </button>
          </form>
          <div className="search-chips">
            <button className="chip suggest" onClick={() => setQ2("Where does pneuma appear in Genesis")}>"Where does pneuma appear in Genesis"</button>
            <button className="chip suggest" onClick={() => setQ2("Faith in Paul's letters")}>"Faith in Paul's letters"</button>
            <button className="chip suggest" onClick={() => setQ2("divine council passages")}>"divine council passages"</button>
          </div>
          <p className="search-morph-note">For detailed grammatical analysis including verb forms and pronoun usage, morphological search coming soon.</p>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// RESULT CARD
// ============================================================
function ResultCard({ entry, active, onClick, count }) {
  return (
    <article
      className={"card " + (active ? "card-active" : "")}
      onClick={onClick}
      tabIndex="0"
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
    >
      <div className="card-top">
        <span className="card-ref">{entry.ref}</span>
        <span className="card-badge">{entry.strongs}</span>
      </div>
      {entry.greek ? (
        <div className="card-greek">{entry.greek}</div>
      ) : (
        <div className="card-greek" style={{ fontSize: "22px" }}>{stripArticles(entry.gloss)}</div>
      )}
      <div className="card-translit">{entry.translit}</div>
      <div className="card-gloss">{stripArticles(entry.gloss)}</div>
      <div className="card-foot">
        <span className="card-pos">{BOOK_LABELS[entry.book] || entry.book}</span>
        <span className="card-occ">{count}×</span>
      </div>
    </article>
  );
}

// ============================================================
// LSJ SUMMARY DISPLAY
// ============================================================
function _senseLevel(marker) {
  if (!marker) return 0;
  if (/^[IVX]+\.$/.test(marker)) return 0;
  if (/^[A-E]\.$/.test(marker))  return 1;
  if (/^[1-9]/.test(marker))     return 2;
  return 3;
}

function _stripMd(text) {
  return text
    .replace(/^#+\s*/gm, "")      // strip # ## ### headers
    .replace(/^\s*[-*]\s+/gm, "") // strip bullet points
    .replace(/\*\*(.+?)\*\*/g, "$1") // strip bold **
    .replace(/\*(.+?)\*/g, "$1")     // strip italic *
    .replace(/\s{2,}/g, " ")
    .trim();
}

const _REFUSAL_RE = /^(I |A\.\s*I |I'm |I don't|I cannot|I appreciate|I need|Unfortunately)/i;

function LsjSummary({ data, loading }) {
  if (loading)
    return <div className="lsj-def" style={{ color: "var(--muted)", fontStyle: "italic" }}>Summarizing…</div>;
  if (!data?.summary)
    return <div className="lsj-def" style={{ color: "var(--muted)" }}>No definition available.</div>;
  return <p className="lsj-synthesis">{data.summary}</p>;
}

function useSwipeToDismiss(onClose) {
  const [dragY, setDragY] = React.useState(0);
  const startY = React.useRef(0);
  const onTouchStart = (e) => { startY.current = e.touches[0].clientY; setDragY(0); };
  const onTouchMove  = (e) => { const d = Math.max(0, e.touches[0].clientY - startY.current); setDragY(d); };
  const onTouchEnd   = ()  => { if (dragY > 80) onClose(); setDragY(0); };
  return {
    handleProps: { onTouchStart, onTouchMove, onTouchEnd },
    sheetStyle:  dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : {}
  };
}

// ============================================================
// LEAFLET MINI-MAP
// ============================================================
function LeafletMap({ lat, lon, name }) {
  const mapRef = React.useRef(null);
  const instanceRef = React.useRef(null);

  React.useEffect(() => {
    if (!mapRef.current || !window.L) return;
    if (instanceRef.current) {
      instanceRef.current.remove();
      instanceRef.current = null;
    }
    const map = window.L.map(mapRef.current, {
      center: [lat, lon],
      zoom: 7,
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: false,
    });
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map);
    window.L.marker([lat, lon]).addTo(map).bindPopup(name).openPopup();
    instanceRef.current = map;
    return () => { if (instanceRef.current) { instanceRef.current.remove(); instanceRef.current = null; } };
  }, [lat, lon, name]);

  return <div ref={mapRef} className="metav-leaflet-map" />;
}

// ============================================================
// DETAIL PANEL — SIDEBAR / BOTTOM SHEET
// ============================================================
function DetailPanel({ entry, isMobile, onClose, occurrences, totalResults, onStrongsSearch, onReadInContext, onNameSearch }) {
  const [verseText, setVerseText] = useState("");
  const [verseLoading, setVerseLoading] = useState(false);
  const [abpCount, setAbpCount] = useState(null);
  const [showInterlinear, setShowInterlinear] = useState(false);
  const [interlinearWords, setInterlinearWords] = useState(null);

  useEffect(() => {
    setShowInterlinear(false);
    setInterlinearWords(null);
  }, [entry && entry.id]);

  useEffect(() => {
    if (!showInterlinear || !entry || interlinearWords) return;
    let cancelled = false;
    api.verseWords(entry.book, entry.chapter, entry.verse)
      .then(d => { if (!cancelled) setInterlinearWords(d.words || []); })
      .catch(() => { if (!cancelled) setInterlinearWords([]); });
    return () => { cancelled = true; };
  }, [showInterlinear, entry && entry.id]);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    setVerseText("");
    setVerseLoading(true);
    api.verse(entry.book, entry.chapter, entry.verse)
      .then((data) => {
        if (!cancelled) setVerseText(data.text || "");
      })
      .catch(() => {
        if (!cancelled) setVerseText("");
      })
      .finally(() => {
        if (!cancelled) setVerseLoading(false);
      });
    return () => { cancelled = true; };
  }, [entry && entry.id]);

  useEffect(() => {
    if (!entry || entry.strongs_base === "*") { setAbpCount(null); return; }
    let cancelled = false;
    api.strongsCount(entry.strongs_raw)
      .then(d => { if (!cancelled) setAbpCount(d.count ?? null); })
      .catch(() => { if (!cancelled) setAbpCount(null); });
    return () => { cancelled = true; };
  }, [entry && entry.strongs_raw]);

  const isHebrew = entry && entry.strongs && entry.strongs.startsWith("H");
  const isPN = entry && (entry.isPN || entry.strongs === "PN" || entry.strongs_base === "*");

  // PN occurrence count (by name, for strongs='*' entries)
  const [pnCount, setPnCount] = useState(null);
  useEffect(() => {
    setPnCount(null);
    if (!entry.gloss) return;
    const name = extractProperName(entry.gloss);
    if (!name || name.length < 2) return;
    let cancelled = false;
    api.pnCount(name)
      .then(d => { if (!cancelled) setPnCount(d.count ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [entry && entry.id]);

  // KJV occurrence count for Hebrew words
  const [kjvCount, setKjvCount] = useState(null);
  useEffect(() => {
    setKjvCount(null);
    if ((!isHebrew && !entry.isKjv) || !entry.strongs) return;
    let cancelled = false;
    api.kjvStrongsCount(entry.strongs)
      .then(d => { if (!cancelled) setKjvCount(d.count ?? null); })
      .catch(() => { if (!cancelled) setKjvCount(null); });
    return () => { cancelled = true; };
  }, [entry && entry.strongs]);

  // metaV person/place lookup — runs on any word click where gloss may be a name
  const [metavData, setMetavData] = useState(null);
  const [metavType, setMetavType] = useState(null); // "person" | "place" | null
  const [metavLoading, setMetavLoading] = useState(false);
  useEffect(() => {
    setMetavData(null);
    setMetavType(null);
    // Skip metaV for words with a real Greek lemma — those belong to LSJ
    // Exception: KJV words that look like proper nouns (capitalized) still go through metaV
    const kjvIsPN = entry.isKjv && extractProperName(entry.pnName || entry.gloss || "") !== "";
    if (!isPN && !kjvIsPN && entry.greek && entry.translit && entry.strongs_raw !== "2316") return;
    const name = extractProperName(entry.pnName || entry.gloss || "");
    if (!name || name.length < 2) return;
    const _DIVINE_SKIP = new Set(["LORD","Lord","YHWH","Yahweh","Jehovah","Holy"]);
    if (_DIVINE_SKIP.has(name)) return;
    let cancelled = false;
    setMetavLoading(true);
    api.metavPerson(name)
      .then(d => {
        if (cancelled) return;
        const hasData = !d.error && (d.birth_year || d.death_year || d.groups?.length > 0 || d.relationships?.length >= 2);
        if (hasData) { setMetavData(d); setMetavType("person"); setMetavLoading(false); return; }
        return api.metavPlace(name);
      })
      .then(d => {
        if (cancelled || !d) return;
        if (!d.error) { setMetavData(d); setMetavType("place"); }
        else if (!metavData) setMetavLoading(false);
        setMetavLoading(false);
      })
      .catch(() => { if (!cancelled) setMetavLoading(false); });
    return () => { cancelled = true; };
  }, [entry && entry.id]);

  // AI description fallback for PN entries with no metaV data
  const [aiDescription, setAiDescription] = useState(null);
  const [aiDescLoading, setAiDescLoading] = useState(false);
  useEffect(() => {
    setAiDescription(null);
    setAiDescLoading(false);
    if (metavLoading) return;
    if (metavData && metavType === "person") return; // person bio replaces AI
    if (metavData && metavType === "place" && metavData.strongs_g?.length > 0) return; // place has LSJ via strongs_g
    if (isHebrew) return; // BDB covers Hebrew words
    if (!isPN) return; // only for proper nouns
    const name = extractProperName(entry.pnName || entry.gloss || "");
    if (!name || name.length < 2) return;
    let cancelled = false;
    setAiDescLoading(true);
    api.metavAiDescription(name)
      .then(d => { if (!cancelled && !d.error) setAiDescription(d.description || null); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAiDescLoading(false); });
    return () => { cancelled = true; };
  }, [entry && entry.id, metavData, metavLoading]);

  // Hebrew BDB lookup
  const [bdbEntry, setBdbEntry] = useState(null);
  const [bdbLoading, setBdbLoading] = useState(false);
  useEffect(() => {
    setBdbEntry(null);
    if (!isHebrew || !entry.strongs) return;
    let cancelled = false;
    setBdbLoading(true);
    api.bdb(entry.strongs)
      .then(d => { if (!cancelled) { setBdbEntry(d.error ? null : d); setBdbLoading(false); } })
      .catch(() => { if (!cancelled) { setBdbEntry(null); setBdbLoading(false); } });
    return () => { cancelled = true; };
  }, [entry && entry.id]);

  // KJV verse text (when entry came from KJV mode, or is a Hebrew word)
  const [kjvVerseText, setKjvVerseText] = useState("");
  useEffect(() => {
    setKjvVerseText("");
    if (!entry || (!entry.isKjv && !isHebrew && !(metavType === "place" && !isPN))) return;
    let cancelled = false;
    api.kjvVerse(entry.book, entry.chapter, entry.verse)
      .then(d => { if (!cancelled) setKjvVerseText(d.text || ""); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [entry && entry.id]);

  const [lsjEntry, setLsjEntry] = useState(null);
  const [lsjLoading, setLsjLoading] = useState(false);
  const [lsjTab, setLsjTab] = useState("def");
  const [lsjSummary, setLsjSummary] = useState(null);
  const [lsjSummaryLoading, setLsjSummaryLoading] = useState(false);

  useEffect(() => {
    setLsjEntry(null);
    setLsjTab("def");
    setLsjSummary(null);
    // For PN place entries with a mapped strongs_g, use that for LSJ lookup
    const placeStrongs = (isPN && metavType === "place" && metavData?.strongs_g?.length > 0)
      ? metavData.strongs_g.replace(/^G/i, "") : null;
    const canLookup = !isHebrew && entry && (entry.greek || entry.strongs_raw || placeStrongs);
    if (!canLookup) { setLsjLoading(false); return; }
    let cancelled = false;
    setLsjLoading(true);
    api.lsj(entry.greek || "", placeStrongs || entry.strongs_raw)
      .then(d => {
        if (!cancelled) { setLsjEntry(d.error ? null : d); setLsjLoading(false); }
      })
      .catch(() => {
        if (!cancelled) { setLsjEntry(null); setLsjLoading(false); }
      });
    return () => { cancelled = true; };
  }, [entry && entry.id, metavType, metavData?.strongs_g]);

  useEffect(() => {
    if (!lsjEntry || lsjEntry.source === "strongs") { setLsjSummary(null); setLsjSummaryLoading(false); return; }
    let cancelled = false;
    setLsjSummaryLoading(true);
    const summaryStrongs = lsjEntry.source === "abp_ext" ? lsjEntry.key : "";
    api.lsjSummary(lsjEntry.key, summaryStrongs, entry.book, entry.chapter, entry.verse)
      .then(d => { if (!cancelled) setLsjSummary(d); })
      .catch(() => { if (!cancelled) setLsjSummary(null); })
      .finally(() => { if (!cancelled) setLsjSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [lsjEntry && lsjEntry.key, entry && entry.id]);

  if (!entry) return null;

  const barWidth = Math.min(100, (occurrences / Math.max(1, totalResults)) * 100);
  const { handleProps, sheetStyle } = useSwipeToDismiss(onClose);

  return (
    <aside className={"detail " + (isMobile ? "detail-sheet" : "detail-side")} style={isMobile ? sheetStyle : {}} role="dialog" aria-label="Lexicon detail">
      {isMobile && <div className="sheet-drag-zone" aria-hidden="true" {...handleProps}><div className="sheet-handle"></div></div>}
      <div className="detail-head">
        <div className="detail-head-l">
          <span className="card-badge solid">{entry.strongs}</span>
          <span className="detail-pos">{BOOK_LABELS[entry.book] || entry.book}</span>
        </div>
        <button className="detail-close" onClick={onClose} aria-label="Close">
          <Icon.Close/>
        </button>
      </div>

      <div className="detail-body">
        <div className={"detail-hero" + (isPN && !entry.greek && !isHebrew ? " no-gloss" : "")}>
          <div className={"detail-greek" + (isHebrew ? " detail-greek--he" : "")}
               dir={isHebrew ? "rtl" : undefined}>
            {isHebrew ? (bdbEntry?.lemma || entry.gloss) : (entry.greek || ((isPN || metavData) ? extractProperName(entry.gloss) : entry.gloss))}
          </div>
          <div className={"detail-translit-row" + (isHebrew ? " detail-translit-row-he" : "")}>
            <span className="detail-translit">{isHebrew ? bdbEntry?.xlit : entry.translit}</span>
            {isHebrew && (bdbEntry?.xlit || entry.translit) && entry.gloss && (
              <><span className="detail-sep">·</span><span className="detail-gloss">{stripArticles(((isPN || metavData) ? extractProperName(entry.gloss) : entry.gloss)?.replace(/[.,;:!?—-]+$/, "").trim())}</span></>
            )}
          </div>
          {!(isPN && !entry.greek && !isHebrew) && !(isHebrew && (bdbEntry?.xlit || entry.translit) && entry.gloss) && (
            <div className="detail-gloss">{stripArticles(((isPN || metavData) ? extractProperName(entry.gloss) : (entry.greek && (entry.gloss || "").trim().split(/\s+/).length > 2 ? entry.english_head : entry.gloss))?.replace(/[.,;:!?—-]+$/, "").trim())}</div>
          )}
        </div>

        {(metavData || metavLoading) && (
          <section className="sec">
            {metavLoading ? (
              <div className="lsj-def lsj-def--loading">Looking up…</div>
            ) : metavType === "person" && metavData ? (
              <div className="metav-person">
                <h4 className="sec-head"><span className="sec-t">Biblical Person</span><span className="lsj-badge lsj-badge--gold">metaV</span></h4>
                <div className="metav-meta">
                  {metavData.gender && <span className="metav-tag">{metavData.gender === "M" ? "Male" : "Female"}</span>}
                  {metavData.groups.filter(g => g.startsWith("Tribe")).map(g => (
                    <span key={g} className="metav-tag">{g}</span>
                  ))}
                  {metavData.groups.includes("Genealogy of Jesus") && <span className="metav-tag metav-tag-gold">Genealogy of Jesus</span>}
                </div>
                {(metavData.birth_year || metavData.death_year) && (
                  <p className="detail-p detail-p--meta" style={{fontSize:"13px"}}>
                    {metavData.birth_year && <span>Born: {metavData.birth_year}{metavData.birth_place ? `, ${metavData.birth_place}` : ""}</span>}
                    {metavData.birth_year && metavData.death_year && " · "}
                    {metavData.death_year && <span>Died: {metavData.death_year}{metavData.death_place ? `, ${metavData.death_place}` : ""}</span>}
                  </p>
                )}
                {metavData.relationships.length > 0 && (
                  <div className="metav-rels">
                    {[
                      { types: ["child"],                    label: "Parent"   },
                      { types: ["father","mother"],          label: "Children" },
                      { types: ["spouseOrConcubine"],        label: "Spouse"   },
                      { types: ["sibling","halfSiblingSameFather","halfSiblingSameMother"], label: "Siblings" },
                    ].map(({ types, label }) => {
                      const matching = metavData.relationships.filter(r => types.includes(r.type));
                      if (!matching.length) return null;
                      return (
                        <div key={label} className="metav-rel-row">
                          <span className="metav-rel-label">{label}</span>
                          <span className="metav-rel-names">{matching.slice(0,5).map(r => r.name).join(", ")}{matching.length > 5 ? ` +${matching.length - 5}` : ""}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : metavType === "place" && metavData ? (
              <div className="metav-place">
                <h4 className="sec-head"><span className="sec-t">Biblical Place</span><span className="lsj-badge lsj-badge--gold">metaV</span></h4>
                {metavData.comment && <p className="detail-p detail-p--meta">{metavData.comment}</p>}
                {metavData.lat && metavData.lon
                  ? <LeafletMap lat={metavData.lat} lon={metavData.lon} name={metavData.name} />
                  : <p className="detail-p detail-p--meta" style={{color:"var(--ink-4)", fontStyle:"italic"}}>Location unknown</p>
                }
              </div>
            ) : null}
          </section>
        )}

        {(aiDescription || aiDescLoading) && (
          <section className="sec">
            <h4 className="sec-head"><span className="sec-t">{metavType === "place" ? "Biblical Place" : "Biblical Reference"}</span><span className="lsj-badge lsj-badge--accent">AI</span></h4>
            {aiDescLoading
              ? <div className="lsj-def lsj-def--loading">Looking up…</div>
              : <p className="detail-p detail-p--meta">{aiDescription}</p>
            }
          </section>
        )}

        {isHebrew ? (
          <section className="sec">
            <h4 className="sec-head"><span className="sec-t">Brown-Driver-Briggs</span><span className="bdb-badge">BDB</span></h4>
            {bdbLoading ? (
              <div className="lsj-def lsj-def--loading">Loading…</div>
            ) : bdbEntry ? (
              <div className="bdb-body">
                {bdbEntry.pronounce && <div className="bdb-xlit"><span className="bdb-pronounce">{bdbEntry.pronounce}</span></div>}
                {bdbEntry.part_of_speech && <span className="bdb-pos-badge">{bdbEntry.part_of_speech}</span>}
                {bdbEntry.description && <p className="detail-p detail-p--meta">{bdbEntry.description}</p>}
              </div>
            ) : (
              <div className="lsj-def lsj-def--loading">Not found in BDB.</div>
            )}
          </section>
        ) : (!isPN || (metavType === "place" && metavData?.strongs_g?.length > 0)) && metavType !== "person" && !aiDescription && !aiDescLoading && (entry.greek || entry.strongs_raw || metavData?.strongs_g?.length > 0) && (
          <section className="sec">
            <div className="lsj-head">
              <h4 className="sec-head">
                <span className="sec-t">
                  {lsjEntry && lsjEntry.source === "abp_ext"
                    ? <>ABP Extended<span className="abp-badge">ABP EXT</span></>
                    : <>Liddell-Scott-Jones<span className="lsj-badge">LSJ</span></>}
                </span>
              </h4>
              {lsjEntry && (
                <div className="lsj-tabs">
                  <button className={"lsj-tab " + (lsjTab === "def"  ? "on" : "")} onClick={() => setLsjTab("def")}>Definition</button>
                  <button className={"lsj-tab " + (lsjTab === "full" ? "on" : "")} onClick={() => setLsjTab("full")}>
                    {lsjEntry.source === "abp_ext" ? "Full ABP" : "Full LSJ"}
                  </button>
                </div>
              )}
            </div>
            {lsjLoading ? (
              <div className="lsj-def lsj-def--loading">Loading…</div>
            ) : lsjEntry ? (
              lsjTab === "def"
                ? lsjEntry.source === "strongs"
                  ? <div className="lsj-def" dangerouslySetInnerHTML={{ __html: lsjEntry.def_html }} />
                  : <LsjSummary data={lsjSummary} loading={lsjSummaryLoading} />
                : <div className="lsj-def" dangerouslySetInnerHTML={{ __html: lsjEntry.def_html }} />
            ) : (
              <div className="lsj-def lsj-def--loading">Not found.</div>
            )}
          </section>
        )}


        {!isHebrew && !isPN && !entry.isKjv && abpCount !== null && abpCount > 0 && (
          <section className="sec">
            <h4 className="sec-head"><span className="sec-t">ABP Occurrences</span></h4>
            <button className="occ-link" onClick={() => onStrongsSearch(entry.strongs_raw)}>
              <b>{abpCount}</b>× in LXX <Icon.ArrowRight/>
            </button>
          </section>
        )}

        {entry.isKjv && !isHebrew && !isPN && kjvCount !== null && kjvCount > 0 && (
          <section className="sec">
            <h4 className="sec-head"><span className="sec-t">KJV Occurrences</span></h4>
            <button className="occ-link" onClick={() => onStrongsSearch(entry.strongs, true)}>
              <b>{kjvCount}</b>× in KJV <Icon.ArrowRight/>
            </button>
          </section>
        )}

        {!entry.isKjv && isPN && pnCount !== null && pnCount > 0 && onNameSearch && (
          <section className="sec">
            <h4 className="sec-head"><span className="sec-t">ABP Occurrences</span></h4>
            <button className="occ-link" onClick={() => onNameSearch(extractProperName(entry.gloss))}>
              <b>{pnCount}</b>× in LXX <Icon.ArrowRight/>
            </button>
          </section>
        )}

        {isHebrew && kjvCount !== null && kjvCount > 0 && (
          <section className="sec">
            <h4 className="sec-head"><span className="sec-t">KJV Occurrences</span></h4>
            <button className="occ-link" onClick={() => onStrongsSearch && onStrongsSearch(entry.strongs)}>
              <b>{kjvCount}</b>× in KJV <Icon.ArrowRight/>
            </button>
          </section>
        )}

        {entry.derivation && (
          <section className="sec">
            <h4 className="sec-head"><span className="sec-t">Derivation</span></h4>
            <p className="detail-p">
              {entry.derivation.split(/\b(G\d[\d.]*)/i).map((part, i) =>
                /^G\d[\d.]*/i.test(part)
                  ? <button key={i} className="link-btn link-btn--strong" onClick={() => onStrongsSearch(part)}>{part}</button>
                  : part
              )}
            </p>
          </section>
        )}

        {entry.book && (
        <section className="sec">
          <h4 className="sec-head">
            <span className="sec-t">Verse — {entry.ref}</span>
            <span className="sec-meta">{(entry.isKjv || isHebrew || (metavType === "place" && !isPN)) ? "KJV" : "LXX (ABP English)"}</span>
          </h4>
          <blockquote className="dverse">
            <span className="dverse-n">{entry.verse}</span>
            {(entry.isKjv || isHebrew || (metavType === "place" && !isPN)) ? (kjvVerseText || "—") : (verseLoading ? "Loading…" : verseText || "—")}
          </blockquote>
          {showInterlinear && (
            <div className="interlinear">
              {!interlinearWords ? (
                <span style={{ color: "var(--ink-4)", fontSize: "13px" }}>Loading…</span>
              ) : interlinearWords.map((w, i) => (
                <div key={i} className="iword">
                  <span className="iw-greek">{w.lemma || "—"}</span>
                  <span className="iw-translit">{w.translit || ""}</span>
                  <span className="iw-english">{w.english || "—"}</span>
                  {(w.strongs || w.strongs_base) && w.strongs_base !== "*" && (
                    <span className="iw-strongs">G{w.strongs || w.strongs_base}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="dverse-tools">
            <button className="link-btn" onClick={() => onReadInContext && onReadInContext(entry.book, entry.chapter, entry.verse)}>
              Read in context <Icon.ArrowRight/>
            </button>
            <span className="dot">·</span>
            <button
              className={"link-btn" + (showInterlinear ? " link-btn-on" : "")}
              onClick={() => setShowInterlinear(v => !v)}
            >Interlinear</button>
          </div>
        </section>
        )}

        {(occurrences > 0 || totalResults > 0) && (
        <section className="sec">
          <h4 className="sec-head"><span className="sec-t">Frequency</span></h4>
          <div className="freq">
            <div className="freq-bar">
              <div className="freq-fill" style={{ width: barWidth + "%" }}></div>
            </div>
            <div className="freq-meta">
              <span><b>{occurrences}</b>× in current results</span>
            </div>
          </div>
        </section>
        )}
      </div>
    </aside>
  );
}

// ============================================================
// CROSS-REFERENCE PANEL
// ============================================================
function CrossRefPanel({ source, onClose, onNavigate, isMobile, translation, onAiSearch }) {
  const [refs, setRefs] = useState([]);
  const [synthesis, setSynthesis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [abpTexts, setAbpTexts] = useState({});
  const showAbp = translation === "abp" || translation === "parallel";

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setRefs([]);
    setSynthesis(null);
    setAbpTexts({});
    setLoading(true);
    api.crossRefsCurated(source.book, source.chapter, source.verse)
      .then(d => {
        if (cancelled) return;
        setRefs(d.refs || []);
        setSynthesis(d.synthesis || null);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source && source.book, source && source.chapter, source && source.verse]);

  useEffect(() => {
    if (!showAbp || !refs.length) { setAbpTexts({}); return; }
    let cancelled = false;
    Promise.all(
      refs.map(ref =>
        api.verse(ref.book, ref.chapter, ref.verse)
          .then(d => [ref.ref, d.text || ""])
          .catch(() => [ref.ref, ""])
      )
    ).then(pairs => { if (!cancelled) setAbpTexts(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [refs, showAbp]);

  const verseText = (ref) => showAbp ? (abpTexts[ref.ref] || ref.kjv_text) : ref.kjv_text;

  const sourceRef = `${source.book} ${source.chapter}:${source.verse}`;
  const { handleProps: swipeProps, sheetStyle: xrefSheetStyle } = useSwipeToDismiss(onClose);

  return (
    <aside className={"xref-panel " + (isMobile ? "detail-sheet" : "detail-side")} style={isMobile ? xrefSheetStyle : {}} role="dialog" aria-label="Related Passages">
      {isMobile && <div className="sheet-drag-zone" aria-hidden="true" {...swipeProps}><div className="sheet-handle"></div></div>}
      <div className="detail-head">
        <div className="detail-head-l">
          <span className="detail-pos">{sourceRef}</span>
          <span className="xref-badge">TSK</span>
        </div>
        <button className="detail-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="xref-body">
        <h3 className="xref-title">Related Passages</h3>
        {loading ? (
          <p className="xref-synthesis-loading">Selecting relevant passages…</p>
        ) : synthesis ? (
          <p className="xref-synthesis">{synthesis}</p>
        ) : null}
        {!loading && onAiSearch && (
          <button className="xref-ai-btn" onClick={() => { onClose(); onAiSearch(sourceRef); }}>
            Explore in the corpus →
          </button>
        )}
        {loading ? (
          <div className="lib-loading">Loading…</div>
        ) : refs.length === 0 ? (
          <p className="detail-p">No cross-references found.</p>
        ) : (
          <div className="xref-list">
            {refs.map(ref => (
              <div key={ref.ref} className="xref-verse" onClick={() => onNavigate(ref.book, ref.chapter, ref.verse)}>
                <span className="xref-ref">{ref.ref}</span>
                <p className="xref-text">{verseText(ref)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function studyWordLabel(w) {
  const e = w.english || "";
  if (e) return e;
  const kd = w.kjv_def || "";
  if (kd) {
    const first = kd.split(",").map(t => t.trim()).find(t => !t.startsWith("X ")) || kd.split(",")[0].trim();
    const result = first.replace(/\s*[(\[+].*/,'').trim();
    if (result) return result;
  }
  return w.translit || w.lemma || null;
}

// ============================================================
// STUDY MODE — VERSE ROW
// ============================================================
function VerseStudyRow({ book, chapter, verse, label, allResults, onWordClick, onReadInContext, textMode, primaryStrongs, citedStrongs, kjvCache }) {
  const [words, setWords] = useState(null);
  const [kjvText, setKjvText] = useState(null);
  const [visible, setVisible] = useState(false);
  const rowRef = useRef(null);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: "300px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setWords(null);
    api.verseWords(book, chapter, verse)
      .then(d => { if (!cancelled) setWords(d.words || []); })
      .catch(() => { if (!cancelled) setWords([]); });
    return () => { cancelled = true; };
  }, [visible, book, chapter, verse]);

  useEffect(() => {
    if (!visible || textMode !== "kjv") return;
    const cacheKey = `${book}:${chapter}:${verse}`;
    if (kjvCache && kjvCache[cacheKey]) {
      setKjvText(kjvCache[cacheKey]);
      return;
    }
    let cancelled = false;
    setKjvText(null);
    api.kjvVerseWords(book, chapter, verse)
      .then(d => { if (!cancelled) setKjvText(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setKjvText([]); });
    return () => { cancelled = true; };
  }, [visible, book, chapter, verse, textMode, kjvCache]);

  const entryMap = useMemo(() => {
    const m = new Map();
    for (const e of allResults) {
      if (e.book === book && e.chapter === chapter && e.verse === verse) {
        if (!m.has(e.strongs_raw)) m.set(e.strongs_raw, e);
        // Also index by bare number to handle G/H prefix inconsistency
        const bare = (e.strongs_raw || "").replace(/^[GH]/i, "");
        if (bare && !m.has(bare)) m.set(bare, e);
      }
    }
    return m;
  }, [allResults, book, chapter, verse]);

  // citedStrongs is now passed directly as a prop from App level — no local computation needed

  return (
    <div className="study-verse" ref={rowRef}>
      <button className="study-ref" onClick={() => onReadInContext?.(book, chapter, verse)}>{label}</button>
      <span className="study-text">
        {textMode === "kjv" ? (
          kjvText === null
            ? <span style={{ color: "var(--ink-4)", fontSize: "13px" }}>Loading…</span>
            : kjvText.map((w, i) => {
                const sid = w.strongs_ids && w.strongs_ids.length ? w.strongs_ids[0] : null;
                const sidBare = sid ? sid.replace(/^[GH]/i, "") : null;
                const isCited = sid && citedStrongs != null && citedStrongs.size > 0 &&
                  (citedStrongs.has(sid) || citedStrongs.has(sidBare));
                const kjvEntry = sid ? {
                  id: `kjvstudy-${book}-${chapter}-${verse}-${i}`,
                  strongs: sid,
                  strongs_base: sid.slice(1),
                  strongs_raw: sid.slice(1),
                  greek: w.lemma || "",
                  translit: w.xlit || "",
                  gloss: w.word,
                  ref: `${book} ${chapter}:${verse}`,
                  book, chapter, verse,
                  definition: "", derivation: "", is_function: false,
                  isKjv: true,
                  isHebrew: sid.startsWith("H"),
                } : null;
                return (
                  <span key={i} className={"study-word-wrap" + (sid ? " match" : "") + (isCited ? " cited" : "")}
                    onClick={kjvEntry && onWordClick ? () => onWordClick(kjvEntry) : undefined}>
                    <span className={"study-word" + (w.italic ? " study-word-italic" : "")}>{w.word}{w.punc || ""}</span>
                    {sid
                      ? <span className="study-strongs">{sid}</span>
                      : <span className="study-strongs" style={{visibility:"hidden"}}>G0</span>}
                  </span>
                );
              })
        ) : words === null ? (
          <span style={{ color: "var(--ink-4)", fontSize: "13px" }}>Loading…</span>
        ) : (() => {
          function renderStudyWord(w, key) {
            const label = studyWordLabel(w);
            if (!label) return null;
            const clickable = w.strongs_base && w.strongs_base !== "*";
            const wnum = w.strongs || w.strongs_base;
            const entry = clickable && (entryMap.get(wnum) || {
              id: `study-${book}-${chapter}-${verse}-${key}`,
              strongs: `G${wnum}`,
              strongs_base: w.strongs_base,
              strongs_raw: wnum,
              greek: w.lemma || "",
              translit: w.translit || "",
              gloss: w.english || "",
              ref: `${book} ${chapter}:${verse}`,
              book, chapter, verse,
              definition: "", derivation: "", is_function: false,
            });
            const hasPos = w.greek_pos !== null && w.greek_pos !== undefined;
            const bareNum = (w.strongs_base || "").replace(/^[GH]/i, "");
            const isCited = clickable && citedStrongs != null && citedStrongs.size > 0 &&
              (citedStrongs.has(w.strongs_base) || citedStrongs.has(bareNum));
            return (
              <span key={key} className={"study-word-wrap" + (clickable ? " match" : "") + (isCited ? " cited" : "")}
                    onClick={clickable ? () => onWordClick(entry) : undefined}>
                {hasPos && <span className="study-pos">{w.greek_pos}</span>}
                <span className="study-word">{label}</span>
                {clickable
                  ? <span className="study-strongs">G{wnum}</span>
                  : <span className="study-strongs" style={{visibility:"hidden"}}>G0</span>}
              </span>
            );
          }
          const groups = groupForGreekMode(words.filter(w => w.english).sort((a, b) => a.position - b.position));
          return groups.map((g, gi) => {
            if (!g.isBracket) return renderStudyWord(g.word, `g${gi}`);
            const studyBracketChar = (ch, k) => (
              <span key={k} className="study-bracket">
                <span className="study-bracket-glyph">{ch}</span>
                <span className="study-strongs" style={{visibility:"hidden"}}>G0</span>
              </span>
            );
            return (
              <span key={`bg${gi}`} className="study-bracket-group">
                {studyBracketChar("[", "bl")}
                {g.words.map((w, wi) => renderStudyWord(w, `bg${gi}w${wi}`))}
                {studyBracketChar("]", "br")}
              </span>
            );
          });
        })()}
      </span>
    </div>
  );
}

// ============================================================
// STUDY MODE — PASSAGE GROUP (collapsible book+chapter section)
// ============================================================
function PassageGroup({ label, verses, allResults, onWordClick, onReadInContext, textMode, primaryStrongs, citedStrongs, kjvCache }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="study-group">
      <button
        className={"study-group-head " + (open ? "open" : "")}
        onClick={() => setOpen(o => !o)}
      >
        <Icon.Book style={{ opacity: 0.5, flexShrink: 0 }}/>
        <span className="study-group-label">{label}</span>
        <span className="study-group-count">{verses.length} verse{verses.length !== 1 ? "s" : ""}</span>
        <span className={"study-chevron " + (open ? "open" : "")}/>
      </button>
      {open && (
        <div className="study-group-body">
          {verses.map(v => (
            <VerseStudyRow
              key={`${v.book}-${v.chapter}-${v.verse}`}
              book={v.book}
              chapter={v.chapter}
              verse={v.verse}
              label={v.ref}
              allResults={allResults}
              onWordClick={onWordClick}
              onReadInContext={onReadInContext}
              textMode={textMode}
              primaryStrongs={primaryStrongs}
              citedStrongs={citedStrongs}
              kjvCache={kjvCache}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// STUDY MODE — OUTER CONTAINER
// ============================================================
function StudyMode({ allResults, primaryStrongs, citedStrongs, showAll, onWordClick, onReadInContext, studySort, textMode }) {
  const [kjvCache, setKjvCache] = useState({}); // pre-fetched KJV verse words

  // Pre-fetch all KJV verse words in one batch when switching to KJV mode
  React.useEffect(() => {
    if (textMode !== "kjv" || !allResults.length) return;
    const seen = new Set();
    const refs = [];
    for (const e of allResults) {
      const key = `${e.book}:${e.chapter}:${e.verse}`;
      if (!seen.has(key)) { seen.add(key); refs.push({book: e.book, chapter: e.chapter, verse: e.verse}); }
    }
    if (!refs.length) return;
    let cancelled = false;
    api.kjvVerseWordsBatch(refs)
      .then(data => { if (!cancelled) setKjvCache(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [textMode, allResults]);

  const groups = useMemo(() => {
    const gMap = {};
    const gOrder = [];
    for (const entry of allResults) {
      const gk = `${entry.book}-${entry.chapter}`;
      if (!gMap[gk]) {
        gMap[gk] = {
          label: `${BOOK_LABELS[entry.book] || entry.book} · Chapter ${entry.chapter}`,
          verseMap: {},
          verseOrder: [],
        };
        gOrder.push(gk);
      }
      const vk = `${entry.book}-${entry.chapter}-${entry.verse}`;
      if (!gMap[gk].verseMap[vk]) {
        gMap[gk].verseMap[vk] = {
          book: entry.book, chapter: entry.chapter, verse: entry.verse, ref: entry.ref,
          is_primary: entry.is_primary,
          is_additional: entry.is_additional,
        };
        gMap[gk].verseOrder.push(vk);
      }
    }
    return gOrder
      .map(gk => ({
        label:  gMap[gk].label,
        verses: gMap[gk].verseOrder.map(vk => gMap[gk].verseMap[vk]),
      }))
      .sort((a, b) => {
        if (studySort === "canonical") {
          const bookDiff = (BOOK_ORDER[a.verses[0]?.book] ?? 99) - (BOOK_ORDER[b.verses[0]?.book] ?? 99);
          return bookDiff || (a.verses[0]?.chapter ?? 0) - (b.verses[0]?.chapter ?? 0);
        }
        const aPrimary = a.verses.filter(v => v.is_primary).length;
        const bPrimary = b.verses.filter(v => v.is_primary).length;
        return bPrimary - aPrimary || b.verses.length - a.verses.length;
      });
  }, [allResults, studySort]);

  const hasPrimary = allResults.some(e => e.is_primary);
  const hasAdditional = allResults.some(e => e.is_additional);

  const primaryGroups = hasPrimary
    ? groups.map(g => ({ ...g, verses: g.verses.filter(v => v.is_primary) })).filter(g => g.verses.length > 0)
    : groups;

  const additionalGroups = hasAdditional
    ? groups.map(g => ({ ...g, verses: g.verses.filter(v => v.is_additional) })).filter(g => g.verses.length > 0)
    : [];

  const otherGroups = (hasPrimary || hasAdditional)
    ? groups.map(g => ({ ...g, verses: g.verses.filter(v => !v.is_primary && !v.is_additional) })).filter(g => g.verses.length > 0)
    : [];

  const passageGroupProps = { allResults, onWordClick, onReadInContext, textMode, primaryStrongs, citedStrongs, kjvCache };

  return (
    <div className="study-groups">

      {primaryGroups.map(g => (
        <PassageGroup key={g.label} label={g.label} verses={g.verses} {...passageGroupProps} />
      ))}
      {additionalGroups.length > 0 && (
        <div className="additional-refs-section">
          <div className="additional-refs-label">Additional references</div>
          {additionalGroups.map(g => (
            <PassageGroup key={g.label} label={g.label} verses={g.verses} {...passageGroupProps} />
          ))}
        </div>
      )}
      {showAll && otherGroups.map(g => (
        <PassageGroup key={g.label} label={g.label} verses={g.verses} {...passageGroupProps} />
      ))}
    </div>
  );
}

// ============================================================
// LIBRARY HELPERS
// ============================================================

// Reorder words for natural English reading:
// within each bracket group sort by greek_pos ascending; non-bracket words keep position order.
function getEnglishOrderWords(words) {
  const bracketMap = {};
  for (const w of words) {
    const bid = w.bracket_id;
    if (bid !== null && bid !== undefined) {
      if (!bracketMap[bid]) bracketMap[bid] = [];
      bracketMap[bid].push(w);
    }
  }
  for (const bid in bracketMap) {
    bracketMap[bid].sort((a, b) => (a.greek_pos ?? 999) - (b.greek_pos ?? 999));
  }
  const result = [];
  const seen = new Set();
  for (const w of words) {
    const bid = w.bracket_id;
    if (bid === null || bid === undefined) {
      result.push(w);
    } else if (!seen.has(bid)) {
      seen.add(bid);
      result.push(...bracketMap[bid]);
    }
  }
  return result;
}

// Group a position-sorted word list into runs by bracket_id for bracket notation rendering.
function groupForGreekMode(words) {
  const groups = [];
  let cur = null;
  for (const w of words) {
    const bid = (w.bracket_id !== null && w.bracket_id !== undefined) ? w.bracket_id : null;
    if (bid === null) {
      groups.push({ isBracket: false, word: w });
      cur = null;
    } else {
      if (!cur || cur.bid !== bid) {
        cur = { isBracket: true, bid, words: [] };
        groups.push(cur);
      }
      cur.words.push(w);
    }
  }
  return groups;
}

// ============================================================
// LIB NAV PANEL — desktop left sidebar (≥1024px)
// ============================================================

const _BOOK_DIV = {
  Gen:"Law",Exo:"Law",Lev:"Law",Num:"Law",Deu:"Law",
  Jos:"History",Jdg:"History",Rth:"History","1Sa":"History","2Sa":"History",
  "1Ki":"History","2Ki":"History","1Ch":"History","2Ch":"History",Ezr:"History",Neh:"History",Est:"History",
  Job:"Wisdom",Psa:"Wisdom",Pro:"Wisdom",Ecc:"Wisdom",Son:"Wisdom",
  Isa:"Major Prophets",Jer:"Major Prophets",Lam:"Major Prophets",Eze:"Major Prophets",Dan:"Major Prophets",
  Hos:"Minor Prophets",Joe:"Minor Prophets",Amo:"Minor Prophets",Oba:"Minor Prophets",
  Jon:"Minor Prophets",Mic:"Minor Prophets",Nah:"Minor Prophets",Hab:"Minor Prophets",
  Zep:"Minor Prophets",Hag:"Minor Prophets",Zec:"Minor Prophets",Mal:"Minor Prophets",
  Mat:"Gospels",Mar:"Gospels",Luk:"Gospels",Joh:"Gospels",
  Act:"History",
  Rom:"Pauline Epistles","1Co":"Pauline Epistles","2Co":"Pauline Epistles",
  Gal:"Pauline Epistles",Eph:"Pauline Epistles",Php:"Pauline Epistles",
  Col:"Pauline Epistles","1Th":"Pauline Epistles","2Th":"Pauline Epistles",
  "1Ti":"Pauline Epistles","2Ti":"Pauline Epistles",Tit:"Pauline Epistles",Phm:"Pauline Epistles",
  Heb:"General Epistles",Jas:"General Epistles",
  "1Pe":"General Epistles","2Pe":"General Epistles",
  "1Jn":"General Epistles","2Jn":"General Epistles","3Jn":"General Epistles",
  Jud:"General Epistles",Rev:"Apocalyptic",
};

function LibNavPanel({ books, selBook, setSelBook, selChapter, setSelChapter }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return books;
    return books.filter(b => b.name.toLowerCase().includes(q) || b.abbrev.toLowerCase().includes(q));
  }, [books, query]);

  const groups = useMemo(() => {
    const out = [];
    let cur = null;
    for (const b of filtered) {
      const t = NT_BOOKS.has(b.abbrev) ? "NT" : "OT";
      const div = _BOOK_DIV[b.abbrev] || "";
      const key = t + " · " + div;
      if (!cur || cur.key !== key) { cur = { key, t, div, books: [] }; out.push(cur); }
      cur.books.push(b);
    }
    return out;
  }, [filtered]);

  return (
    <nav className="nav" aria-label="Books">
      <div className="nav-top">
        <span className="nav-title">Canon</span>
      </div>
      <div className="nav-search">
        <svg className="nav-search-i" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
        </svg>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a book" />
      </div>
      <div className="nav-scroll">
        {groups.map(g => (
          <div className="nav-group" key={g.key}>
            <div className="nav-div">
              <span className="nav-div-t">{g.t}</span>
              <span className="nav-div-n">{g.div}</span>
            </div>
            {g.books.map(b => {
              const active = selBook && b.abbrev === selBook.abbrev;
              return (
                <div key={b.abbrev}>
                  <button
                    className={"nav-book" + (active ? " on" : "")}
                    onClick={() => { setSelBook(b); setSelChapter(1); }}
                  >
                    <span className="nav-book-name">{b.name}</span>
                    <span className="nav-book-ch">{b.chapters}</span>
                  </button>
                  {active && (
                    <div className="nav-chips">
                      {Array.from({ length: b.chapters }, (_, i) => i + 1).map(n => (
                        <button
                          key={n}
                          className={"ch-chip" + (n === selChapter ? " on" : "")}
                          onClick={() => setSelChapter(n)}
                        >{n}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}

// ============================================================
// LIBRARY VIEW
// ============================================================
function LibraryView({ nav, onNavChange, onWordClick, onVerseNumberClick, onTranslationChange }) {
  const [books, setBooks] = useState([]);
  const [selBook, setSelBook] = useState(null);
  const [selChapter, setSelChapter] = useState(1);
  const [verses, setVerses] = useState([]);
  const [kjvVerses, setKjvVerses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [kjvLoading, setKjvLoading] = useState(false);
  const [libOptions, setLibOptions] = useState({
    abp:      { wordOrder: "english", showStrongs: false, showInterlinear: false },
    kjv:      { wordOrder: "english", showStrongs: false, showInterlinear: false },
    parallel: { wordOrder: "english", showStrongs: false, showInterlinear: false },
  });
  const [translation, setTranslation] = useState("abp"); // "abp" | "kjv" | "parallel"
  const highlightRef = useRef(null);
  const [navVisible, setNavVisible] = useState(typeof window !== "undefined" && window.innerWidth >= 1024);

  useEffect(() => {
    const _onResize = () => setNavVisible(window.innerWidth >= 1024);
    window.addEventListener("resize", _onResize);
    return () => window.removeEventListener("resize", _onResize);
  }, []);

  useEffect(() => {
    api.books().then(data => {
      setBooks(data);
      if (data.length) setSelBook(data[0]);
    });
  }, []);

  useEffect(() => {
    if (!nav || !nav.book || !books.length) return;
    const b = books.find(b => b.abbrev === nav.book);
    if (b) {
      setSelBook(b);
      setSelChapter(nav.chapter || 1);
    }
  }, [nav, books]);

  useEffect(() => {
    if (!selBook) return;
    let cancelled = false;
    setLoading(true);
    setVerses([]);
    api.chapter(selBook.abbrev, selChapter)
      .then(data => { if (!cancelled) { setVerses(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selBook && selBook.abbrev, selChapter]);

  useEffect(() => {
    if (!selBook || (translation !== "kjv" && translation !== "parallel")) return;
    let cancelled = false;
    setKjvLoading(true);
    setKjvVerses([]);
    api.kjvChapter(selBook.abbrev, selChapter)
      .then(data => { if (!cancelled) { setKjvVerses(data); setKjvLoading(false); } })
      .catch(() => { if (!cancelled) setKjvLoading(false); });
    return () => { cancelled = true; };
  }, [selBook && selBook.abbrev, selChapter, translation]);

  useEffect(() => {
    if (!nav?.scroll || !verses.length) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (highlightRef.current) {
        highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        onNavChange?.({ ...nav, scroll: false });
      }
    }));
  }, [nav?.scroll, verses]);

  const maxChap = selBook ? selBook.chapters : 1;
  const opts          = libOptions[translation] || {};
  const showStrongs   = opts.showStrongs    || false;
  const showInterlinear = opts.showInterlinear || false;
  const wordOrder     = opts.wordOrder      || "english";
  const setOpt = (key, val) => setLibOptions(prev => ({
    ...prev,
    [translation]: { ...prev[translation], [key]: val },
  }));

  const wordMode    = true; // always chip mode — words are always individually clickable
  const kjvWordMode = showStrongs || showInterlinear || (translation === "parallel" && wordOrder === "greek") || translation === "kjv";

  const handleVerseNum = onVerseNumberClick && selBook
    ? (verse) => onVerseNumberClick(selBook.abbrev, selChapter, verse, translation)
    : null;

  const vnumEl = (verse) => (
    <span
      className={"lib-vnum" + (handleVerseNum ? " lib-vnum-click" : "") + (showInterlinear ? " lib-vnum-il" : "")}
      onClick={handleVerseNum ? () => handleVerseNum(verse) : undefined}
    >{verse}</span>
  );

  const joinProse = (words) => {
    const tokens = words.map(w => w.english).filter(Boolean);
    return tokens.reduce((acc, tok, i) => {
      if (i === 0) return tok;
      return /^[.,;:?!—)]/.test(tok) ? acc + tok : acc + " " + tok;
    }, "");
  };

  const renderVerse = (v) => {
    const isHighlight = nav && nav.highlight === v.verse;

    const makeEntry = (w) => {
      const snum = w.strongs_base === "*" ? "*" : (w.strongs || w.strongs_base);
      return {
      id: `lib-${selBook.abbrev}-${selChapter}-${v.verse}-${w.position}`,
      strongs: strongsTag(snum),
      strongs_base: w.strongs_base,
      strongs_raw: snum,
      greek: w.lemma || "",
      translit: w.translit || "",
      gloss: w.english || "",
      ref: `${selBook.abbrev} ${selChapter}:${v.verse}`,
      book: selBook.abbrev,
      chapter: selChapter,
      verse: v.verse,
      definition: "",
      derivation: "",
      is_function: false,
      };
    };

    const chipLabel = (w) => {
      return (w.english_head && w.english?.includes(' ')) ? w.english_head : (w.english || w.english_head || "");
    };

    // Plain chip (English mode or non-bracketed word in Greek mode)
    const chip = (w, key) => {
      const isPN = w.strongs_base === "*";
      const clickable = !!(onWordClick && w.strongs_base && (w.strongs_base !== "*" || w.english || w.english_head) && (w.english || w.english_head));

      // Split multi-word gloss: mute italic sub-words, style smcap sub-words, chip the rest
      if (w.italic_words && w.english && w.english.includes(' ')) {
        const italicSet = new Set(w.italic_words.split(','));
        const smcapSet  = w.smcap_words ? new Set(w.smcap_words.split(',')) : new Set();
        const parts = w.english.split(' ');
        return (
          <React.Fragment key={key}>
            {(() => {
              const firstNonItalic = parts.findIndex(word => !italicSet.has(word.replace(/[^\w]/g,'').toLowerCase()));
              return parts.map((word, pi) => {
                const bare = word.replace(/[^\w]/g, '').toLowerCase();
                if (italicSet.has(bare)) {
                  return <span key={`${key}-p${pi}`} className={"lib-word lib-abp-italic" + (smcapSet.has(bare) ? " lib-smcap" : "")}>
                    {showInterlinear && <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>}
                    <span className="lib-iw-english">{word}</span>
                    {showStrongs && <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>}
                  </span>;
                }
                const isSmcap = smcapSet.has(bare);
                return (
                  <span key={`${key}-p${pi}`}
                    className={"lib-word" + (isSmcap ? " lib-smcap" : "") + (clickable ? " lib-word-clickable" : "") + (isPN ? " lib-word-pn" : "")}
                    onClick={clickable ? () => onWordClick(isPN ? { ...makeEntry(w), isPN: true, pnName: w.english || w.english_head } : makeEntry(w)) : undefined}>
                    {showInterlinear && (pi === firstNonItalic && w.lemma
                      ? <span className="lib-iw-greek">{w.lemma}</span>
                      : <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>)}
                    <span className="lib-iw-english">{word}</span>
                    {showStrongs && (pi === firstNonItalic && w.strongs_base && w.strongs_base !== "*"
                      ? <span className="lib-iw-strongs">G{w.strongs || w.strongs_base}</span>
                      : <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>)}
                  </span>
                );
              });
            })()}
          </React.Fragment>
        );
      }

      const rawLabel = w.english || chipLabel(w);
      if (!rawLabel) return null;
      const label = (isPN && rawLabel && !rawLabel.includes(' ')) ? rawLabel[0].toUpperCase() + rawLabel.slice(1) : rawLabel;
      const isSmcap = w.smcap_words ? new Set(w.smcap_words.split(',')).has(label.replace(/[^\w]/g, '').toLowerCase()) : false;
      return (
        <span key={key}
          className={"lib-word" + (w.italic ? " lib-abp-italic" : "") + (isSmcap ? " lib-smcap" : "") + (clickable ? " lib-word-clickable" : "") + (isPN ? " lib-word-pn" : "")}
          onClick={clickable ? () => onWordClick(isPN ? { ...makeEntry(w), isPN: true, pnName: label, gloss: label } : makeEntry(w)) : undefined}>
          {showInterlinear && (w.lemma ? <span className="lib-iw-greek">{w.lemma}</span> : <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>)}
          <span className="lib-iw-english">{label}</span>
          {showStrongs && (
            w.strongs_base && w.strongs_base !== "*"
              ? <span className="lib-iw-strongs">G{w.strongs || w.strongs_base}</span>
              : <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>
          )}
        </span>
      );
    };

    // Bracket chip (bracketed word in Greek mode — shows inline position number)
    const bracketChip = (w, key) => {
      const isPN = w.strongs_base === "*";
      const clickable = !!(onWordClick && w.strongs_base && (w.strongs_base !== "*" || w.english));

      // Split multi-word gloss within a bracket word
      if (w.italic_words && w.english && w.english.includes(' ')) {
        const italicSet = new Set(w.italic_words.split(','));
        const smcapSet  = w.smcap_words ? new Set(w.smcap_words.split(',')) : new Set();
        const parts = w.english.split(' ');
        return (
          <React.Fragment key={key}>
            {parts.map((word, pi) => {
              const bare = word.replace(/[^\w]/g, '').toLowerCase();
              if (italicSet.has(bare)) {
                return <span key={`${key}-p${pi}`} className={"lib-word lib-word-bracketed lib-abp-italic" + (smcapSet.has(bare) ? " lib-smcap" : "")}>
                  {showInterlinear && <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>}
                  <span className="lib-iw-pos-english">
                    {pi === 0 && w.greek_pos !== null && w.greek_pos !== undefined &&
                      <span className="lib-iw-pos">{w.greek_pos}</span>}
                    <span className="lib-iw-english">{word}</span>
                  </span>
                  {showStrongs && <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>}
                </span>;
              }
              const isSmcap = smcapSet.has(bare);
              return (
                <span key={`${key}-p${pi}`}
                  className={"lib-word lib-word-bracketed" + (isSmcap ? " lib-smcap" : "") + (clickable ? " lib-word-clickable" : "") + (isPN ? " lib-word-pn" : "")}
                  onClick={clickable ? () => onWordClick(isPN ? { ...makeEntry(w), isPN: true, pnName: w.english || w.english_head } : makeEntry(w)) : undefined}>
                  {showInterlinear && (pi === 0 && w.lemma
                    ? <span className="lib-iw-greek">{w.lemma}</span>
                    : <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>)}
                  <span className="lib-iw-pos-english">
                    {pi === 0 && w.greek_pos !== null && w.greek_pos !== undefined &&
                      <span className="lib-iw-pos">{w.greek_pos}</span>}
                    <span className="lib-iw-english">{word}</span>
                  </span>
                  {showStrongs && (pi === 0 && w.strongs_base && w.strongs_base !== "*"
                    ? <span className="lib-iw-strongs">G{w.strongs || w.strongs_base}</span>
                    : <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>)}
                </span>
              );
            })}
          </React.Fragment>
        );
      }

      const rawLabel = w.english || chipLabel(w);
      if (!rawLabel) return null;
      const label = (isPN && rawLabel && !rawLabel.includes(' ')) ? rawLabel[0].toUpperCase() + rawLabel.slice(1) : rawLabel;
      const isSmcap = w.smcap_words ? new Set(w.smcap_words.split(',')).has(label.replace(/[^\w]/g, '').toLowerCase()) : false;
      return (
        <span key={key}
          className={"lib-word lib-word-bracketed" + (w.italic ? " lib-abp-italic" : "") + (isSmcap ? " lib-smcap" : "") + (clickable ? " lib-word-clickable" : "") + (isPN ? " lib-word-pn" : "")}
          onClick={clickable ? () => onWordClick(isPN ? { ...makeEntry(w), isPN: true, pnName: label, gloss: label } : makeEntry(w)) : undefined}>
          {showInterlinear && (w.lemma
            ? <span className="lib-iw-greek">{w.lemma}</span>
            : <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>)}
          <span className="lib-iw-pos-english">
            {w.greek_pos !== null && w.greek_pos !== undefined &&
              <span className="lib-iw-pos">{w.greek_pos}</span>}
            <span className="lib-iw-english">{label}</span>
          </span>
          {showStrongs && (
            w.strongs_base && w.strongs_base !== "*"
              ? <span className="lib-iw-strongs">G{w.strongs || w.strongs_base}</span>
              : <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>
          )}
        </span>
      );
    };

    if (!wordMode) {
      const englishWords = getEnglishOrderWords(v.words);
      const text = joinProse(englishWords);
      return (
        <div key={v.verse} ref={isHighlight ? highlightRef : null}
          className={"lib-verse-row" + (isHighlight ? " lib-highlight" : "")}>
          {vnumEl(v.verse)}
          <span className="lib-verse-content">{text}</span>
        </div>
      );
    }

    // Chip mode
    let content;
    if (wordOrder === "greek") {
      // Greek syntactic order with bracket notation — only words with a gloss or lexicon entry
      const sortedWords = [...v.words].filter(w => w.english || w.kjv_def || w.strongs_base === "*").sort((a, b) => a.position - b.position);
      const groups = groupForGreekMode(sortedWords);
      content = groups.map((g, gi) => {
        if (!g.isBracket) {
          return chip(g.word, `g${gi}`);
        }
        const bracketChar = (ch, k) => (
          <span key={k} className="lib-bracket">
            {showInterlinear && <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>}
            <span className="lib-bracket-glyph">{ch}</span>
            {showStrongs && <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>}
          </span>
        );
        return (
          <span key={`bg${gi}`} className="lib-bracket-group">
            {bracketChar("[", "bl")}
            {g.words.map((w, wi) => bracketChip(w, `bg${gi}w${wi}`))}
            {bracketChar("]", "br")}
          </span>
        );
      });
    } else {
      // English reading order — words with a gloss or lexicon fallback
      const englishWords = getEnglishOrderWords(v.words).filter(w => w.english || w.english_head || w.kjv_def);
      content = englishWords.map((w, i) => {
        return chip(w, `e${i}`);
      });
    }

    return (
      <div key={v.verse} ref={isHighlight ? highlightRef : null}
        className={"lib-verse-row" + (isHighlight ? " lib-highlight" : "")}>
        {vnumEl(v.verse)}
        <span className="lib-verse-content lib-verse-chips">{content}</span>
      </div>
    );
  };

  const renderKjvVerse = (v, showVerseNum = true) => {
    const makeKjvEntry = (w, sid) => ({
      id: `kjv-${selBook.abbrev}-${selChapter}-${v.verse}-${w.word_id}`,
      strongs: sid || "",
      strongs_base: sid ? sid.slice(1) : "",
      strongs_raw: sid ? sid.slice(1) : "",
      greek: w.lemma || "",
      translit: w.xlit || "",
      gloss: w.word,
      ref: `${selBook.abbrev} ${selChapter}:${v.verse}`,
      book: selBook.abbrev,
      chapter: selChapter,
      verse: v.verse,
      definition: "", derivation: "", is_function: false,
      isKjv: true,
      isHebrew: sid ? sid.startsWith("H") : false,
    });
    return (
      <div key={v.verse} className="lib-verse-row">
        {showVerseNum && vnumEl(v.verse)}
        <span className="lib-verse-content lib-verse-chips">
          {v.words.map((w, i) => {
            const sid = w.strongs_ids && w.strongs_ids.length ? w.strongs_ids[0] : null;
            const clickable = !!(onWordClick && sid);
            const isHebrew = sid ? sid.startsWith("H") : false;
            return (
              <span key={i}
                className={"lib-word lib-kjv-word" + (w.italic ? " lib-kjv-italic" : "") + (clickable ? " lib-word-clickable" : "")}
                onClick={clickable ? () => onWordClick(makeKjvEntry(w, sid)) : undefined}>
                {showInterlinear && (w.lemma
                  ? <span className="lib-iw-greek" dir={isHebrew ? "rtl" : undefined}
                      style={isHebrew ? {fontFamily: "var(--f-serif)"} : undefined}>
                      {w.lemma}
                    </span>
                  : <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>
                )}
                <span className="lib-iw-english">{w.word}{w.punc || ""}</span>
                {showStrongs && (sid
                  ? <span className="lib-iw-strongs">{sid}</span>
                  : <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>
                )}
              </span>
            );
          })}
        </span>
      </div>
    );
  };

  return (
    <div className="library">
      {navVisible && (
        <LibNavPanel
          books={books}
          selBook={selBook}
          setSelBook={setSelBook}
          selChapter={selChapter}
          setSelChapter={setSelChapter}
        />
      )}
      <div>
      {navVisible ? (
        <div className="lib-bar">
          <div className="lib-bar-l">
            {selBook && <span className="lib-bar-book">{selBook.name}</span>}
            <div className="bar-ch">
              <button
                className="ch-nav"
                disabled={selChapter <= 1}
                onClick={() => setSelChapter(c => Math.max(1, c - 1))}
                aria-label="Previous chapter"
              >‹</button>
              <span className="ch-lbl">
                Ch <input
                  className="lib-chap-input"
                  type="number"
                  min={1}
                  max={maxChap}
                  value={selChapter}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    if (v >= 1 && v <= maxChap) setSelChapter(v);
                  }}
                /> <span className="ch-of">/ {maxChap}</span>
              </span>
              <button
                className="ch-nav"
                disabled={selChapter >= maxChap}
                onClick={() => setSelChapter(c => Math.min(maxChap, c + 1))}
                aria-label="Next chapter"
              >›</button>
            </div>
          </div>
          <div className="lib-bar-r">
            <div className="seg">
              <button className={"seg-b" + (translation === "abp" ? " on" : "")} onClick={() => { setTranslation("abp"); onTranslationChange?.("abp"); }}>ABP</button>
              <button className={"seg-b" + (translation === "kjv" ? " on" : "")} onClick={() => { setTranslation("kjv"); onTranslationChange?.("kjv"); }}>KJV</button>
              <button className={"seg-b" + (translation === "parallel" ? " on" : "")} onClick={() => { setTranslation("parallel"); onTranslationChange?.("parallel"); }}>Parallel</button>
            </div>
            <span className="lib-bar-sep" aria-hidden="true"/>
            <button className={"lib-toggle" + (showStrongs ? " on" : "")} onClick={() => setOpt("showStrongs", !showStrongs)}>Strong's</button>
            <button className={"lib-toggle" + (showInterlinear ? " on" : "")} onClick={() => setOpt("showInterlinear", !showInterlinear)}>Interlinear</button>
            <span className="lib-bar-sep" aria-hidden="true"/>
            <div className="seg">
              <button
                className={"seg-b" + (wordOrder === "english" || translation === "kjv" ? " on" : "")}
                onClick={() => translation !== "kjv" && setLibOptions(prev => ({
                  ...prev,
                  [translation]: { ...prev[translation], wordOrder: "english" }
                }))}
              >English</button>
              <button
                className={"seg-b" + (wordOrder === "greek" ? " on" : "")}
                disabled={translation === "kjv"}
                style={translation === "kjv" ? { opacity: 0.35, cursor: "default" } : undefined}
                onClick={() => translation !== "kjv" && setOpt("wordOrder", "greek")}
              >Greek</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="lib-toolbar">
          <select
            className="lib-select"
            value={selBook ? selBook.abbrev : ""}
            onChange={e => {
              const b = books.find(b => b.abbrev === e.target.value);
              if (b) { setSelBook(b); setSelChapter(1); }
            }}
          >
            {books.map(b => <option key={b.abbrev} value={b.abbrev}>{b.name}</option>)}
          </select>
          <div className="lib-chap-nav">
            <button
              className="lib-nav-btn"
              disabled={selChapter <= 1}
              onClick={() => setSelChapter(c => Math.max(1, c - 1))}
              aria-label="Previous chapter"
            >‹</button>
            <span className="lib-chap-label">
              Ch <input
                className="lib-chap-input"
                type="number"
                min={1}
                max={maxChap}
                value={selChapter}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (v >= 1 && v <= maxChap) setSelChapter(v);
                }}
              /> / {maxChap}
            </span>
            <button
              className="lib-nav-btn"
              disabled={selChapter >= maxChap}
              onClick={() => setSelChapter(c => Math.min(maxChap, c + 1))}
              aria-label="Next chapter"
            >›</button>
          </div>
          <div className="lib-toggles">
            <button className={"lib-trans-btn" + (translation === "abp" ? " on" : "")} onClick={() => { setTranslation("abp"); onTranslationChange?.("abp"); }}>ABP</button>
            <button className={"lib-trans-btn" + (translation === "kjv" ? " on" : "")} onClick={() => { setTranslation("kjv"); onTranslationChange?.("kjv"); }}>KJV</button>
            <button className={"lib-trans-btn" + (translation === "parallel" ? " on" : "")} onClick={() => { setTranslation("parallel"); onTranslationChange?.("parallel"); }}>Parallel</button>
            <span className="lib-toggle-sep">|</span>
            <button
              className={"lib-toggle-btn" + (showStrongs ? " on" : "")}
              onClick={() => setOpt("showStrongs", !showStrongs)}
            >Strong's</button>
            <button
              className={"lib-toggle-btn" + (showInterlinear ? " on" : "")}
              onClick={() => setOpt("showInterlinear", !showInterlinear)}
            >Interlinear</button>
            <span className="lib-toggle-sep">|</span>
            <button
              className={"lib-order-btn" + (wordOrder === "english" || translation === "kjv" ? " on" : "")}
              onClick={() => translation !== "kjv" && setLibOptions(prev => ({
                ...prev,
                [translation]: { ...prev[translation], wordOrder: "english" }
              }))}
            >English</button>
            <button
              className={"lib-order-btn" + (wordOrder === "greek" ? " on" : "")}
              disabled={translation === "kjv"}
              style={translation === "kjv" ? { opacity: 0.35, cursor: "default" } : undefined}
              onClick={() => translation !== "kjv" && setOpt("wordOrder", "greek")}
            >Greek</button>
          </div>
        </div>
      )}

      <div className="lib-reading">
        <h2 className="lib-heading">
          {selBook ? selBook.name : "—"} <span className="lib-chap-num">{selChapter}</span>
        </h2>
        {translation === "parallel" ? (
          <div className="lib-parallel">
            <div className="lib-parallel-header">
              <span className="lib-parallel-label">ABP</span>
              <span className="lib-parallel-label">KJV</span>
            </div>
            {(loading || kjvLoading) ? (
              <div className="lib-loading">Loading…</div>
            ) : (() => {
              const kjvMap = Object.fromEntries(kjvVerses.map(v => [v.verse, v]));
              return verses.map(abpV => {
                const kjvV = kjvMap[abpV.verse];
                return (
                  <div key={abpV.verse} className="lib-parallel-verse">
                    <div className="lib-parallel-col">
                      {wordMode
                        ? renderVerse(abpV)
                        : <div className="lib-verse-row">
                            {vnumEl(abpV.verse)}
                            <span className="lib-verse-content">{joinProse(getEnglishOrderWords(abpV.words))}</span>
                          </div>
                      }
                    </div>
                    <div className="lib-parallel-col">
                      {kjvV
                        ? kjvWordMode
                          ? renderKjvVerse(kjvV)
                          : <div className="lib-verse-row">
                              {vnumEl(kjvV.verse)}
                              <span className="lib-verse-content">{kjvV.verse_text}</span>
                            </div>
                        : vnumEl(abpV.verse)
                      }
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        ) : translation === "kjv" ? (
          kjvLoading ? (
            <div className="lib-loading">Loading…</div>
          ) : kjvWordMode ? (
            <div className="lib-text-words">
              {kjvVerses.map(v => renderKjvVerse(v))}
            </div>
          ) : (
            <div className="lib-text-words">
              {kjvVerses.map(v => (
                <div key={v.verse} className="lib-verse-row">
                  {vnumEl(v.verse)}
                  <span className="lib-verse-content">{v.verse_text}</span>
                </div>
              ))}
            </div>
          )
        ) : loading ? (
          <div className="lib-loading">Loading…</div>
        ) : wordMode ? (
          <div className="lib-text-words">
            {verses.map(v => renderVerse(v))}
          </div>
        ) : (
          <div className="lib-text-words">
            {verses.map(v => renderVerse(v))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

// ============================================================
// GLOSS GROUPINGS
// ============================================================
function GlossGroupings({ groupings, results, variants, onGlossDrill, onStrongsSearch, isKjv }) {
  const rows = useMemo(() => {
    const seen = new Set();
    const order = [];
    for (const e of results) {
      if (e.strongs_raw && e.strongs_raw !== "*" && !seen.has(e.strongs_raw)) {
        seen.add(e.strongs_raw);
        order.push(e.strongs_raw);
      }
    }
    return order
      .filter(sn => groupings[sn]?.length > 0) // only strongs with actual groupings
      .map(sn => {
        const glosses = groupings[sn] || [];
        const base = sn.includes('.') ? sn.split('.')[0] : sn;
        const allVariants = (variants && variants[base]) || [];
        const siblings = sn.includes('.') ? allVariants.filter(v => v !== sn) : [];
        const entry = results.find(e => e.strongs_raw === sn);
        return { sn, glosses, siblings, entry };
      })
      .filter(({ glosses, siblings, entry }) =>
        glosses.length > 1 && !(entry && entry.is_function));
  }, [groupings, results, variants]);

  if (rows.length === 0) return null;

  return (
    <div className="gloss-groupings">
      {rows.map(({ sn, glosses, siblings, entry }) => (
        <div key={sn} className="gloss-group">
          <span className="gloss-group-head">
            <button className="gloss-strongs-btn" onClick={() => onStrongsSearch(strongsTag(sn), isKjv)}>{strongsTag(sn)}</button>
            {entry && entry.translit && <span className="gloss-translit">{entry.translit}</span>}
            {glosses.length > 1 && <span className="gloss-also">appears as</span>}
          </span>
          {glosses.length > 0 && (
            <span className="gloss-chips">
              {glosses.map(g => (
                <button key={g.gloss} className="gloss-chip"
                  onClick={() => onGlossDrill(sn, g.gloss)}>
                  {stripArticles(g.gloss)}
                  <span className="gloss-chip-count">{g.count}</span>
                </button>
              ))}
            </span>
          )}
          {siblings.length > 0 && (
            <span className="gloss-siblings">
              <span className="gloss-also">{glosses.length > 1 ? "·" : "see also"}</span>
              {siblings.map(v => (
                <button key={v} className="gloss-strongs-btn gloss-sibling-btn"
                  onClick={() => onStrongsSearch(`G${v}`)}>
                  G{v}
                </button>
              ))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// SEARCH BREADCRUMB
// ============================================================
function SearchBreadcrumb({ breadcrumbs, currentLabel, onNav }) {
  if (!breadcrumbs.length) return null;
  return (
    <nav className="breadcrumb" aria-label="Search navigation">
      {breadcrumbs.map((crumb, idx) => (
        <React.Fragment key={idx}>
          <button className="breadcrumb-item" onClick={() => onNav(crumb, idx)}>
            {crumb.label}
          </button>
          <span className="breadcrumb-sep" aria-hidden="true">›</span>
        </React.Fragment>
      ))}
      <span className="breadcrumb-current">{currentLabel}</span>
    </nav>
  );
}

// ============================================================
// AI ANSWER STRIP
// ============================================================
function AIAnswer({ query, explanation, keyStrongs, onPick }) {
  return (
    <section className="ai-answer">
      <div className="ai-answer-head">
        <span className="ai-tag">
          <span className="ai-dot"></span>
          Synthesis
        </span>
        <span className="ai-q">"{query}"</span>
      </div>
      <p className="ai-answer-body">{explanation}</p>
      {keyStrongs && keyStrongs.length > 0 && (
        <div className="ai-cites">
          <span className="ai-cites-label">Cited:</span>
          {keyStrongs.map((ks) => (
            <button key={ks.strongs} className="ai-cite" onClick={() => onPick({
              id: `ks-${ks.strongs_base}`,
              strongs: ks.strongs,
              strongs_base: ks.strongs_base,
              strongs_raw: ks.strongs_base,
              greek: ks.lemma,
              translit: ks.translit,
              gloss: "",
              ref: "",
              book: "", chapter: 0, verse: 0,
              definition: ks.definition || "", derivation: ks.derivation || "",
            })}>
              {ks.strongs} {ks.lemma}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================
// GUIDED TOUR
// ============================================================
const TOUR_STEPS = [
  { icon: "Book",    label: "Welcome to Lexica", body: "Lexica is a Greek and Hebrew word study tool built for the diligent Berean. No prior training required. Every word traces back to its Greek or Hebrew source so you can read what the text actually says — before any theological framework is applied. You won't be a scholar overnight, but you'll immediately be a Berean." },
  { icon: "Search",  label: "The Lexicon",       body: "Search by English, Greek, Hebrew, transliteration, or Strong's number. Results span both Greek (LSJ) and Hebrew (BDB) — click any word for its full lexicon entry and a context-aware AI summary anchored in the source text." },
  { icon: "Book",    label: "The Library",       body: "Read in ABP, KJV, or parallel. Enable Strong's badges or go fully interlinear — Hebrew script appears above OT words, Greek above NT. Click any word to open its lexicon entry. Click any verse number for cross-references." },
  { icon: "Panel",   label: "Cross-References",  body: "Every verse connects to Torrey's Treasury of Scripture Knowledge — AI-curated to the strongest matches and synthesized into a thematic overview anchored in ABP vocabulary." },
  { icon: "Sparkle", label: "Ask the Corpus",    body: "Ask in plain language: 'Where does pneuma appear in Genesis?' or 'Differences in how KJV and ABP render spirit in the OT.' The AI searches Greek and Hebrew simultaneously and cites specific passages." },
  { icon: "Book",    label: "Support Lexica",    body: "Lexica is free, independent, and has no ads. It's maintained by one person who thinks serious Bible study tools shouldn't cost hundreds of dollars. If it's been useful to your studies, a small contribution keeps it running.", donate: true },
];

function GuidedTour({ onDone }) {
  const [step, setStep] = useState(0);
  const cur = TOUR_STEPS[step];
  const StepIcon = Icon[cur.icon];
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <>
      <div className="tour-scrim" onClick={onDone} />
      <div className="tour-modal" role="dialog" aria-modal="true" aria-label="Welcome to Lexica">
        <button className="tour-skip" onClick={onDone}>Skip</button>
        <div className="tour-icon-wrap">
          <StepIcon width="20" height="20" />
        </div>
        <div className="tour-step-num">{step + 1} of {TOUR_STEPS.length}</div>
        <h2 className="tour-title">{cur.label}</h2>
        <p className="tour-body">{cur.body}</p>
        {cur.donate && (
          <div className="tour-donate-btns">
            <a className="donate-btn kofi" href="https://ko-fi.com/lexica" target="_blank" rel="noopener noreferrer">☕ Ko-fi</a>
            <a className="donate-btn github" href="https://github.com/sponsors/jonathan-pernice" target="_blank" rel="noopener noreferrer">♥ GitHub Sponsors</a>
          </div>
        )}
        <div className="tour-dots">
          {TOUR_STEPS.map((_, i) => (
            <button key={i} className={"tour-dot" + (i === step ? " active" : "")} onClick={() => setStep(i)} aria-label={`Step ${i + 1}`} />
          ))}
        </div>
        <div className="tour-nav">
          {step > 0 && (
            <button className="tour-btn tour-btn-prev" onClick={() => setStep(s => s - 1)}>Previous</button>
          )}
          {isLast ? (
            <button className="tour-btn tour-btn-done" onClick={onDone}>Get started</button>
          ) : (
            <button className="tour-btn tour-btn-next" onClick={() => setStep(s => s + 1)}>Next</button>
          )}
        </div>
      </div>
    </>
  );
}

// ============================================================
// ABOUT VIEW
// ============================================================
function AboutView() {
  return (
    <div className="about-view">
      <div className="about-inner">
        <h1 className="about-title">About Lexica</h1>
        <p className="about-lead">A Greek and Hebrew word study tool for the diligent Berean. No seminary required.</p>

        <h2 className="about-h2">What Lexica does</h2>
        <p className="about-p">Lexica lets you trace any English word in the Bible back to its Greek or Hebrew source and explore its full meaning — not just the translation choice made by one committee. Every word links to the Liddell-Scott-Jones Greek lexicon (LSJ) or Brown-Driver-Briggs Hebrew lexicon (BDB), the two most comprehensive scholarly references available.</p>
        <p className="about-p">The primary text is the <b>Apostolic Bible Polyglot (ABP)</b> — a word-for-word Greek interlinear covering both the Septuagint (OT) and New Testament. The <b>King James Version (KJV)</b> is available in parallel and interlinear modes for comparison. Cross-references come from Torrey's Treasury of Scripture Knowledge.</p>

        <h2 className="about-h2">The Berean approach</h2>
        <p className="about-p">The Bereans "received the word with all readiness of mind, and searched the scriptures daily" (Acts 17:11). Lexica is built on that same posture: let the Greek and Hebrew speak first, before any theological system is imported. No commentary, no denominational lens, no conclusions pre-loaded. The text speaks — you decide what it means.</p>
        <p className="about-p">Every AI-generated summary is anchored in the source vocabulary of the ABP. The system prompt explicitly forbids importing theology from outside the text.</p>

        <h2 className="about-h2">Methodology</h2>
        <ul className="about-ul">
          <li>Strong's numbers are the bridge between English, Greek, and Hebrew</li>
          <li>Greek definitions draw from LSJ — the standard classical Greek reference</li>
          <li>Hebrew definitions draw from BDB — the standard OT Hebrew reference</li>
          <li>AI search generates SQL against the full lexicon corpus — not a summary or paraphrase</li>
          <li>Translation comparisons surface where KJV and ABP make different rendering choices for the same source word</li>
        </ul>

        <h2 className="about-h2">Support Lexica</h2>
        <p className="about-p">Lexica is free, independent, and has no ads. It's maintained by one person who thinks serious Bible study tools shouldn't cost hundreds of dollars or require a seminary login. If it's been useful to you, a small contribution keeps the lights on.</p>
        <div className="about-donate">
          <a className="donate-btn kofi" href="https://ko-fi.com/lexica" target="_blank" rel="noopener noreferrer">☕ Ko-fi</a>
          <a className="donate-btn github" href="https://github.com/sponsors/jonathan-pernice" target="_blank" rel="noopener noreferrer">♥ GitHub Sponsors</a>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// APP
// ============================================================
function App() {
  const [q1, setQ1] = useState("");
  const [q2, setQ2] = useState("");
  const [allResults, setAllResults] = useState([]);
  const [aiMeta, setAiMeta] = useState(null);
  const [showAllAi, setShowAllAi] = useState(false);
  const [mode, setMode] = useState("idle");
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState("");
  const [aiNotice, setAiNotice] = useState("");
  const [activeEntry, setActiveEntry] = useState(null);
  const [viewMode, setViewMode] = useState("browse");
  const [browseTranslation, setBrowseTranslation] = useState("all"); // "abp" | "kjv" | "all"
  const [corpusFilter, setCorpusFilter] = useState("all"); // "all" | "ot" | "nt"
  const [langFilter, setLangFilter] = useState("all"); // "all" | "greek" | "hebrew"
  const [studySort, setStudySort] = useState("curated"); // "curated" | "canonical"
  const [studyTextMode, setStudyTextMode] = useState("abp"); // "abp" | "kjv"
  const [isMobile, setIsMobile] = useState(false);
  const [mainView, setMainView] = useState("search");
  const [libNav, setLibNav] = useState(null);
  const [libCrossRef, setLibCrossRef] = useState(null);
  const [libTranslation, setLibTranslation] = useState("abp");
  const [abpGroupings, setAbpGroupings] = useState({});
  const [kjvGroupings, setKjvGroupings] = useState({});
  const [variants, setVariants] = useState({});
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [glossFilter, setGlossFilter] = useState(null); // { sn, gloss, label } | null
  const searchFnRef = useRef(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 860);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);


  const handleVerseNumberClick = (book, chapter, verse, translation) => {
    setActiveEntry(null);
    setLibCrossRef({ book, chapter, verse, translation: translation || "abp" });
    setLibNav(prev => ({ ...(prev || {}), book, chapter, highlight: verse }));
  };

  // Source-filtered results based on browseTranslation mode
  const corpusFilteredResults = useMemo(() => {
    let r = allResults;
    if (mode === "search") {
      if (browseTranslation === "abp") r = r.filter(e => e.source === "abp" || !e.source);
      else if (browseTranslation === "kjv") r = r.filter(e => e.source === "kjv");
      else if (browseTranslation === "all") r = r.filter(e => e.source === "abp" || !e.source || (e.source === "kjv" && e.isHebrew));
    }
    if (corpusFilter === "ot") r = r.filter(e => !NT_BOOKS.has(e.book));
    if (corpusFilter === "nt") r = r.filter(e => NT_BOOKS.has(e.book));
    if (langFilter === "greek") r = r.filter(e => e.strongs && !String(e.strongs).startsWith("H"));
    if (langFilter === "hebrew") r = r.filter(e => e.strongs && String(e.strongs).startsWith("H"));
    return r;
  }, [allResults, browseTranslation, mode, corpusFilter, langFilter]);

  // Count occurrences per strongs across displayed results
  const countMap = useMemo(() => {
    const map = {};
    for (const e of corpusFilteredResults) {
      const key = e.strongs_raw || e.strongs_base;
      if (key) map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [corpusFilteredResults]);

  // Active groupings based on mode
  const activeGroupings = useMemo(() => {
    if (mode !== "search") return abpGroupings;
    if (browseTranslation === "kjv") return kjvGroupings;
    if (browseTranslation === "all") return { ...abpGroupings, ...kjvGroupings };
    return abpGroupings;
  }, [abpGroupings, kjvGroupings, browseTranslation, mode]);

  // Sorted display list
  const displayed = useMemo(() => {
    let base;
    if (glossFilter) {
      base = corpusFilteredResults.filter(e =>
        (e.strongs_raw === glossFilter.sn || e.strongs_base === glossFilter.sn) &&
        e.gloss_head === glossFilter.gloss
      );
    } else if (mode === "search" && !primaryStrongs) {
      base = corpusFilteredResults.filter(e => !e.is_function);
    } else {
      base = corpusFilteredResults;
    }
    return [...base].sort((a, b) =>
      (BOOK_ORDER[a.book] ?? 99) - (BOOK_ORDER[b.book] ?? 99) || a.chapter - b.chapter || a.verse - b.verse);
  }, [corpusFilteredResults, countMap, mode, primaryStrongs, glossFilter]);

  // Strongs number being searched directly (null in AI/text modes)
  const primaryStrongs = useMemo(() => {
    if (mode === "ai") {
      if (aiMeta && aiMeta.keyStrongs && aiMeta.keyStrongs.length > 0) return aiMeta.keyStrongs;
      return null;
    }
    if (mode !== "search") return null;
    const m = /^[Gg]([\d.]+)$/.exec(q1.trim());
    return m ? [{ strongs_base: m[1], strongs: `G${m[1]}` }] : null;
  }, [mode, q1, aiMeta]);

  // Compute citedStrongs at App level — single source of truth, no prop-threading issues
  const citedStrongsApp = useMemo(() => {
    if (!primaryStrongs || !primaryStrongs.length) return null;
    const s = new Set();
    for (const p of primaryStrongs) {
      if (p.strongs_base) {
        s.add(p.strongs_base);                            // as-is (e.g. "4151" or "G4151")
        s.add(p.strongs_base.replace(/^[GH]/i, ""));     // bare (e.g. "4151")
        s.add(`G${p.strongs_base.replace(/^[GH]/i, "")}`); // G-prefixed
        s.add(`H${p.strongs_base.replace(/^[GH]/i, "")}`); // H-prefixed
      }
    }
    return s.size > 0 ? s : null;
  }, [primaryStrongs]);

  // Count of distinct primary verses (AI mode only)
  const primaryVerseCount = useMemo(() => {
    if (mode !== "ai") return null;
    const seen = new Set();
    for (const e of allResults) { if (e.is_primary) seen.add(e.ref); }
    return seen.size;
  }, [allResults, mode]);

  const [showTour, setShowTour] = useState(() => {
    try { return !localStorage.getItem("lexica_tour_seen"); } catch { return false; }
  });
  const handleTourDone = () => {
    try { localStorage.setItem("lexica_tour_seen", "1"); } catch {}
    setShowTour(false);
  };

  const [libEverVisited, setLibEverVisited] = useState(false);
  const searchScrollRef = useRef(0);

  const handleReadInContext = (book, chapter, verse) => {
    searchScrollRef.current = window.scrollY;
    setLibNav({ book, chapter, highlight: verse, scroll: true });
    setLibEverVisited(true);
    setMainView("library");
  };

  const handleNavChange = (view) => {
    if (view === "library") {
      searchScrollRef.current = window.scrollY;
      setLibEverVisited(true);
      if (!libNav) setLibNav({});
    } else {
      const saved = searchScrollRef.current;
      requestAnimationFrame(() => window.scrollTo(0, saved));
    }
    setMainView(view);
  };

  const handleSearch = async (overrideQ = null, newBreadcrumbs = null, pushHistory = true, pendingGlossFilter = null) => {
    const q = (overrideQ !== null ? overrideQ : q1).trim();
    if (!q) return;
    if (overrideQ !== null) setQ1(overrideQ);
    const crumbs = newBreadcrumbs ?? [];
    setBreadcrumbs(crumbs);
    if (pushHistory) window.history.pushState({ q, breadcrumbs: crumbs }, "");
    setMainView("search");
    setLoading(true);
    setError("");
    setAiMeta(null);
    setMode("search");
    setViewMode("browse");
    setActiveEntry(null);
    setAbpGroupings({});
    setKjvGroupings({});
    setVariants({});
    setGlossFilter(null);
    setLangFilter("all");
    try {
      const data = await api.search(q);
      if (data.error) {
        setError(data.error);
        setAllResults([]);
        setAbpGroupings({});
        setKjvGroupings({});
        setVariants({});
      } else {
        const abp = (data.abp_results || []).map((r, i) => ({ ...makeEntry(r, i), source: "abp" }));
        const kjv = (data.kjv_results || []).map((r, i) => ({
          ...r, id: `kjv-sr-${i}`, gloss_head: r.gloss || "",
          strongs: r.strongs || "", strongs_raw: r.strongs || r.strongs_base || "",
          greek: r.lemma || "", translit: r.translit || "",
          source: "kjv",
        }));
        setAllResults([...abp, ...kjv]);
        setAbpGroupings(data.abp_groupings || {});
        setKjvGroupings(data.kjv_groupings || {});
        setVariants(data.variants || {});
        if (pendingGlossFilter) setGlossFilter(pendingGlossFilter);
      }
    } catch (e) {
      setError("Network error: " + e.message);
      setAllResults([]);
    } finally {
      setLoading(false);
    }
  };
  searchFnRef.current = handleSearch;

  const handleStrongsSearch = (strongs_base, fromKjv = false) => {
    if (!strongs_base || strongs_base === "*") return;
    const s = String(strongs_base);
    const isH = /^H/i.test(s);
    const num = s.replace(/^[GH]/i, "");
    if (fromKjv) setBrowseTranslation("kjv");
    const newQ = isH ? `H${num}` : `G${num}`;
    const currentQ = q1.trim();
    const last = breadcrumbs[breadcrumbs.length - 1];
    const crumbs = currentQ && last?.q !== currentQ
      ? [...breadcrumbs, { label: searchLabel, q: currentQ }]
      : breadcrumbs;
    handleSearch(newQ, crumbs);
  };

  const handleGlossDrill = (sn, gloss) => {
    // Always do a full strongs search to ensure all results are fetched
    // (grouping count is from full corpus, allResults may be truncated)
    const crumbsWithCurrent = [...breadcrumbs, { label: searchLabel, q: q1.trim() }];
    handleSearch(strongsTag(sn), crumbsWithCurrent, true, { sn, gloss });
  };

  const handleBreadcrumbNav = (crumb, idx) => {
    handleSearch(crumb.q, breadcrumbs.slice(0, idx), true);
  };

  useEffect(() => {
    const onPop = (e) => {
      if (e.state?.q) searchFnRef.current(e.state.q, e.state.breadcrumbs ?? [], false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const handleAiSearch = async (overrideQ) => {
    const q = (overrideQ !== undefined ? overrideQ : q2).trim();
    if (!q) return;
    if (overrideQ !== undefined) setQ2(overrideQ);
    setMainView("search");
    setAiLoading(true);
    setError("");
    setAiNotice("");
    setMode("ai");
    setShowAllAi(false);
    setViewMode("study");
    setActiveEntry(null);
    setGlossFilter(null);
    try {
      const data = await api.aiSearch(q);
      if (data.out_of_scope) {
        setAiNotice(data.explanation || "This tool searches the Greek Bible corpus — try a question about a word, theme, or passage.");
        setAllResults([]);
        setAiMeta(null);
      } else if (data.error) {
        setError(data.error);
        setAllResults([]);
        setAiMeta(null);
      } else {
        setAllResults(flattenAiResults(data.results || []));
        setAiMeta({ query: q, explanation: data.explanation || "", total: data.total || 0, keyStrongs: data.key_strongs || [] });
      }
    } catch (e) {
      setError("Network error: " + e.message);
      setAllResults([]);
      setAiMeta(null);
    } finally {
      setAiLoading(false);
    }
  };

  const searchLabel = mode === "ai" ? q2.trim() : q1.trim();

  return (
    <div className={"app " + (activeEntry ? "has-detail" : "")}>
      <Header activeView={mainView} onNavChange={handleNavChange}/>
      <main className="main">
        <div className="main-inner">
          {mainView === "about" && <AboutView />}
          {libEverVisited && (
            <div style={{ display: mainView === "library" ? undefined : "none" }}>
              <LibraryView nav={libNav} onNavChange={setLibNav} onWordClick={(e) => { setLibCrossRef(null); setActiveEntry(e); }} onVerseNumberClick={handleVerseNumberClick} onTranslationChange={setLibTranslation} />
            </div>
          )}
          <div style={{ display: (mainView === "library" || mainView === "about") ? "none" : undefined }}>
          <><SearchBar
            q1={q1} setQ1={setQ1}
            q2={q2} setQ2={setQ2}
            onSearch={handleSearch}
            onAiSearch={handleAiSearch}
            aiLoading={aiLoading}
            lexLoading={loading}
          />

          {aiNotice && (
            <div style={{
              marginTop: "14px",
              padding: "12px 16px",
              background: "var(--accent-soft, #f0f4ff)",
              border: "1px solid var(--accent, #b0bfff)",
              borderRadius: "10px",
              color: "var(--ink-2, #444)",
              fontSize: "14px",
            }}>
              {aiNotice}
            </div>
          )}

          {error && (
            <div style={{
              marginTop: "14px",
              padding: "12px 16px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "10px",
              color: "#b91c1c",
              fontSize: "14px",
            }}>
              {error}
            </div>
          )}

          {aiMeta && (
            <AIAnswer
              query={aiMeta.query}
              explanation={aiMeta.explanation}
              keyStrongs={aiMeta.keyStrongs || []}
              onPick={(e) => setActiveEntry(e)}
            />
          )}

          {mode !== "idle" && (
            <>
              {mode === "search" && (breadcrumbs.length > 0 || glossFilter) && (
                <SearchBreadcrumb
                  breadcrumbs={glossFilter
                    ? [
                        ...breadcrumbs,
                        ...(breadcrumbs[breadcrumbs.length - 1]?.q !== q1.trim() ? [{ label: searchLabel, q: q1.trim() }] : []),
                        ...(searchLabel !== strongsTag(glossFilter.sn) ? [{ label: strongsTag(glossFilter.sn) }] : [])
                      ]
                    : breadcrumbs}
                  currentLabel={glossFilter ? glossFilter.gloss : searchLabel}
                  onNav={(crumb, idx) => {
                    setGlossFilter(null);
                    if (idx < breadcrumbs.length) handleBreadcrumbNav(crumb, idx);
                  }}
                />
              )}
              <div className="results-head">
                <div className="results-meta">
                  {mode === "ai" ? (
                    <>
                      <span className="results-count">{(loading || aiLoading) ? "…" : primaryVerseCount}</span>
                      <span className="results-label">primary {primaryVerseCount === 1 ? "verse" : "verses"}</span>
                      {!loading && aiMeta && aiMeta.total > primaryVerseCount && (
                        <button className="see-all-link" onClick={() => setShowAllAi(v => !v)}>
                          {showAllAi ? "Show less" : `See all ${aiMeta.total} occurrences`}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="results-count">{loading ? "…" : displayed.length}</span>
                      <span className="results-label">results</span>
                    </>
                  )}
                  {searchLabel && !aiLoading && <span className="results-for">for "<b>{searchLabel}</b>"</span>}
                </div>
                <div className="results-controls" style={{marginLeft:"auto"}}>
                  <div className="results-sort">
                    {mode === "ai" && <>
                      <button className={"sort-btn " + (corpusFilter === "all" ? "on" : "")} onClick={() => setCorpusFilter("all")}>All</button>
                      <button className={"sort-btn " + (corpusFilter === "ot"  ? "on" : "")} onClick={() => setCorpusFilter("ot")}>OT</button>
                      <button className={"sort-btn " + (corpusFilter === "nt"  ? "on" : "")} onClick={() => setCorpusFilter("nt")}>NT</button>
                      <span style={{margin:"0 4px",color:"var(--rule-2)"}}>|</span>
                      <button className={"sort-btn " + (studySort === "curated"   ? "on" : "")} onClick={() => setStudySort("curated")}>Curated</button>
                      <button className={"sort-btn " + (studySort === "canonical" ? "on" : "")} onClick={() => setStudySort("canonical")}>Canonical</button>
                      <span style={{margin:"0 4px",color:"var(--rule-2)"}}>|</span>
                      <button className={"sort-btn " + (studyTextMode === "abp" ? "on" : "")} onClick={() => setStudyTextMode("abp")}>ABP</button>
                      <button className={"sort-btn " + (studyTextMode === "kjv" ? "on" : "")} onClick={() => setStudyTextMode("kjv")}>KJV</button>
                    </>}
                    {mode === "search" && <>
                      <button className={"sort-btn " + (browseTranslation === "abp" ? "on" : "")} onClick={() => setBrowseTranslation("abp")}>ABP</button>
                      <button className={"sort-btn " + (browseTranslation === "kjv" ? "on" : "")} onClick={() => setBrowseTranslation("kjv")}>KJV</button>
                      <button className={"sort-btn " + (browseTranslation === "all" ? "on" : "")} onClick={() => setBrowseTranslation("all")}>All</button>
                    </>}
                  </div>
                </div>
              </div>

              {!loading && allResults.length > 0 && mode === "search" && !glossFilter && (
                <GlossGroupings
                  groupings={activeGroupings}
                  results={corpusFilteredResults}
                  variants={browseTranslation === "kjv" ? {} : variants}
                  onGlossDrill={handleGlossDrill}
                  onStrongsSearch={handleStrongsSearch}
                  isKjv={browseTranslation === "kjv"}
                />
              )}

              {(loading || aiLoading) ? (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--ink-3)", fontSize: "14px" }}>
                  Searching…
                </div>
              ) : displayed.length === 0 ? (
                <div className="empty">
                  <div className="empty-title">No matches</div>
                  <div className="empty-sub">Try a different lemma, gloss, or Strong's number.</div>
                </div>
              ) : viewMode === "study" ? (
                <StudyMode allResults={corpusFilteredResults} primaryStrongs={primaryStrongs} citedStrongs={citedStrongsApp} showAll={showAllAi} onWordClick={(e) => setActiveEntry(e)} onReadInContext={handleReadInContext} studySort={studySort} textMode={studyTextMode} />
              ) : (
                <div className="results">
                  {displayed.map((entry) => (
                    <ResultCard
                      key={entry.id}
                      entry={entry}
                      active={activeEntry && activeEntry.id === entry.id}
                      onClick={() => setActiveEntry(entry)}
                      count={countMap[entry.strongs_raw] || 0}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          <footer className="foot">
            <span>Lexica · Greek Septuagint (LXX) · Apostolic Bible Polyglot Interlinear · Strong's Greek</span>
          </footer>
          </>
          </div>
        </div>
      </main>

      {activeEntry && !isMobile && (
        <DetailPanel
          entry={activeEntry}
          isMobile={false}
          onClose={() => setActiveEntry(null)}
          occurrences={countMap[activeEntry.strongs_raw] || 0}
          totalResults={allResults.length}
          onStrongsSearch={handleStrongsSearch}
          onReadInContext={handleReadInContext}
          onNameSearch={(name) => handleSearch(name)}
        />
      )}

      {activeEntry && isMobile && (
        <>
          <div className="sheet-scrim" onClick={() => setActiveEntry(null)}/>
          <DetailPanel
            entry={activeEntry}
            isMobile={true}
            onClose={() => setActiveEntry(null)}
            occurrences={countMap[activeEntry.strongs_raw] || 0}
            totalResults={allResults.length}
            onStrongsSearch={handleStrongsSearch}
            onReadInContext={handleReadInContext}
          />
        </>
      )}
      {libCrossRef && !isMobile && (
        <CrossRefPanel
          source={libCrossRef}
          translation={libTranslation === "kjv" ? "kjv" : "abp"}
          onClose={() => { setLibCrossRef(null); setLibNav(prev => prev ? { ...prev, highlight: null } : prev); }}
          onNavigate={(book, chapter, verse) => {
            setMainView("library");
            setLibCrossRef(null);
            setLibNav({ book, chapter, scroll: true, highlight: verse });
          }}
          onAiSearch={(q) => { setLibCrossRef(null); handleAiSearch(q); }}
          isMobile={false}
        />
      )}
      {libCrossRef && isMobile && (
        <>
          <div className="sheet-scrim" onClick={() => { setLibCrossRef(null); setLibNav(prev => prev ? { ...prev, highlight: null } : prev); }} />
          <CrossRefPanel
            source={libCrossRef}
            translation={libTranslation === "kjv" ? "kjv" : "abp"}
            onClose={() => { setLibCrossRef(null); setLibNav(prev => prev ? { ...prev, highlight: null } : prev); }}
            onNavigate={(book, chapter, verse) => {
              setMainView("library");
              setLibCrossRef(null);
              setLibNav({ book, chapter, scroll: true, highlight: verse });
            }}
            onAiSearch={(q) => { setLibCrossRef(null); handleAiSearch(q); }}
            isMobile={true}
          />
        </>
      )}
      {showTour && <GuidedTour onDone={handleTourDone} />}

      {isMobile && (
        <nav className="mobile-tabs">
          <button className={"mobile-tab" + (mainView === "search" ? " active" : "")} onClick={() => handleNavChange("search")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
            Search
          </button>
          <button className={"mobile-tab" + (mainView === "library" ? " active" : "")} onClick={() => handleNavChange("library")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5a2.5 2.5 0 0 0 0 5H19v-3"/></svg>
            Library
          </button>
          <button className={"mobile-tab" + (mainView === "about" ? " active" : "")} onClick={() => handleNavChange("about")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="8.5"/><line x1="12" y1="12" x2="12" y2="16"/></svg>
            About
          </button>
        </nav>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
