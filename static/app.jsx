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
  bdb: (sid) =>
    fetch(`/api/bdb/${encodeURIComponent(sid)}`).then(r => r.json()),
  crossRefsCurated: (book, chapter, verse) =>
    fetch(`/api/cross-references/curated/${encodeURIComponent(book)}/${chapter}/${verse}`).then(r => r.json()),
};

// ============================================================
// DATA SHAPING
// ============================================================
function strongsTag(snum) {
  if (!snum || snum === "*") return "PN";
  const n = parseInt(snum, 10);
  return `${!isNaN(n) && n > 5624 ? "H" : "G"}${snum}`;
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
        </nav>
      </div>
    </header>
  );
}

// ============================================================
// SEARCH BAR
// ============================================================
function SearchBar({ q1, setQ1, q2, setQ2, onSearch, onAiSearch, aiLoading }) {
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
              <Icon.ArrowRight/>
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

// ============================================================
// DETAIL PANEL — SIDEBAR / BOTTOM SHEET
// ============================================================
function DetailPanel({ entry, isMobile, onClose, occurrences, totalResults, onStrongsSearch, onReadInContext }) {
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

  // KJV verse text (when entry came from KJV mode)
  const [kjvVerseText, setKjvVerseText] = useState("");
  useEffect(() => {
    setKjvVerseText("");
    if (!entry || !entry.isKjv) return;
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
    const canLookup = !isHebrew && entry && (entry.greek || entry.strongs_raw);
    if (!canLookup) { setLsjLoading(false); return; }
    let cancelled = false;
    setLsjLoading(true);
    api.lsj(entry.greek, entry.strongs_raw)
      .then(d => {
        if (!cancelled) { setLsjEntry(d.error ? null : d); setLsjLoading(false); }
      })
      .catch(() => {
        if (!cancelled) { setLsjEntry(null); setLsjLoading(false); }
      });
    return () => { cancelled = true; };
  }, [entry && entry.id]);

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

  return (
    <aside className={"detail " + (isMobile ? "detail-sheet" : "detail-side")} role="dialog" aria-label="Lexicon detail">
      {isMobile && <div className="sheet-handle" aria-hidden="true"></div>}
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
        <div className="detail-hero">
          <div className="detail-greek"
               dir={isHebrew ? "rtl" : undefined}
               style={isHebrew ? {fontFamily: "var(--f-serif)", textAlign: "left"} : undefined}>
            {isHebrew ? (bdbEntry?.lemma || entry.gloss) : (entry.greek || entry.gloss)}
          </div>
          <div className="detail-translit-row">
            <span className="detail-translit">{isHebrew ? bdbEntry?.xlit : entry.translit}</span>
            <button
              className="tool-btn"
              title="Copy"
              onClick={() => navigator.clipboard?.writeText(isHebrew ? (bdbEntry?.lemma || "") : entry.greek)}
            >
              <Icon.Copy/>
            </button>
            <button className="tool-btn" title="Share"><Icon.Share/></button>
          </div>
          <div className="detail-gloss">{stripArticles(entry.gloss)}</div>
        </div>

        {isHebrew ? (
          <section className="detail-section">
            <h4 className="detail-h">Brown-Driver-Briggs<span className="bdb-badge">BDB</span></h4>
            {bdbLoading ? (
              <div className="lsj-def" style={{ color: "var(--ink-4)", fontStyle: "italic", padding: "8px 0" }}>Loading…</div>
            ) : bdbEntry ? (
              <div className="bdb-body">
                {bdbEntry.pronounce && <div className="bdb-xlit"><span className="bdb-pronounce">{bdbEntry.pronounce}</span></div>}
                {bdbEntry.part_of_speech && <span className="bdb-pos-badge">{bdbEntry.part_of_speech}</span>}
                {bdbEntry.description && <p className="detail-p" style={{ marginTop: "10px" }}>{bdbEntry.description}</p>}
              </div>
            ) : (
              <div className="lsj-def" style={{ color: "var(--ink-4)", fontStyle: "italic", padding: "8px 0" }}>Not found in BDB.</div>
            )}
          </section>
        ) : (entry.greek || entry.strongs_raw) && (
          <section className="detail-section">
            <div className="lsj-head">
              <h4 className="detail-h" style={{ margin: 0 }}>
                {lsjEntry && lsjEntry.source === "abp_ext"
                  ? <span>ABP Extended<span className="abp-badge">ABP EXT</span></span>
                  : <span>Liddell-Scott-Jones<span className="lsj-badge">LSJ</span></span>}
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
              <div className="lsj-def" style={{ color: "var(--ink-4)", fontStyle: "italic", padding: "8px 0" }}>Loading…</div>
            ) : lsjEntry ? (
              lsjTab === "def"
                ? lsjEntry.source === "strongs"
                  ? <div className="lsj-def" dangerouslySetInnerHTML={{ __html: lsjEntry.def_html }} />
                  : <LsjSummary data={lsjSummary} loading={lsjSummaryLoading} />
                : <div className="lsj-def" dangerouslySetInnerHTML={{ __html: lsjEntry.def_html }} />
            ) : (
              <div className="lsj-def" style={{ color: "var(--ink-4)", fontStyle: "italic", padding: "8px 0" }}>Not found.</div>
            )}
          </section>
        )}

        {!isHebrew && abpCount !== null && (
          <section className="detail-section">
            <h4 className="detail-h">ABP Occurrences</h4>
            <button
              className="link-btn"
              style={{ fontSize: "15px", fontWeight: "600" }}
              onClick={() => onStrongsSearch(entry.strongs_raw)}
            >
              <b>{abpCount}</b>× in LXX <Icon.ArrowRight/>
            </button>
          </section>
        )}

        {entry.derivation && (
          <section className="detail-section">
            <h4 className="detail-h">Derivation</h4>
            <p className="detail-p">
              {entry.derivation.split(/\b(G\d[\d.]*)/i).map((part, i) =>
                /^G\d[\d.]*/i.test(part)
                  ? <button key={i} className="link-btn" style={{ fontWeight: "600" }} onClick={() => onStrongsSearch(part)}>{part}</button>
                  : part
              )}
            </p>
          </section>
        )}

        {entry.book && (
        <section className="detail-section">
          <h4 className="detail-h">
            Verse — {entry.ref}
            <span className="detail-h-sub">{entry.isKjv ? "KJV" : "LXX (ABP English)"}</span>
          </h4>
          <blockquote className="verse">
            <span className="verse-num">{entry.verse}</span>
            {entry.isKjv ? (kjvVerseText || "—") : (verseLoading ? "Loading…" : verseText || "—")}
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
          <div className="verse-tools">
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
        <section className="detail-section last">
          <h4 className="detail-h">Frequency</h4>
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
  return (
    <aside className={"xref-panel " + (isMobile ? "detail-sheet" : "detail-side")} role="dialog" aria-label="Related Passages">
      {isMobile && <div className="sheet-handle" aria-hidden="true" />}
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
function VerseStudyRow({ book, chapter, verse, label, allResults, onWordClick, onReadInContext }) {
  const [words, setWords] = useState(null);
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

  const entryMap = useMemo(() => {
    const m = new Map();
    for (const e of allResults) {
      if (e.book === book && e.chapter === chapter && e.verse === verse && !m.has(e.strongs_raw))
        m.set(e.strongs_raw, e);
    }
    return m;
  }, [allResults, book, chapter, verse]);

  return (
    <div className="study-verse" ref={rowRef}>
      <button className="study-ref" onClick={() => onReadInContext?.(book, chapter, verse)}>{label}</button>
      <span className="study-text">
        {words === null ? (
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
            return (
              <span key={key} className={"study-word-wrap" + (clickable ? " match" : "")}
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
function PassageGroup({ label, verses, allResults, onWordClick, onReadInContext }) {
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
function StudyMode({ allResults, primaryStrongs, showAll, onWordClick, onReadInContext }) {
  const [studySort, setStudySort] = useState("curated");

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

  const passageGroupProps = { allResults, onWordClick, onReadInContext };

  return (
    <div className="study-groups">
      <div className="study-sort-toggle">
        <button className={"sort-btn " + (studySort === "curated" ? "on" : "")} onClick={() => setStudySort("curated")}>Curated</button>
        <button className={"sort-btn " + (studySort === "canonical" ? "on" : "")} onClick={() => setStudySort("canonical")}>Canonical</button>
      </div>
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

  const wordMode    = showStrongs || showInterlinear || wordOrder === "greek";
  const kjvWordMode = showStrongs || (translation === "parallel" && wordOrder === "greek");

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
      strongs: snum === "*" ? "PN" : `G${snum}`,
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
      const e = w.english || "";
      if (e) return e;
      // Null english: word absorbed into adjacent phrase — derive gloss from lexicon
      const kd = w.kjv_def || "";
      if (!kd) return "";
      const first = kd.split(",").map(t => t.trim()).find(t => !t.startsWith("X ")) || kd.split(",")[0].trim();
      return first.replace(/\s*[(\[+].*/,'').trim();
    };

    // Plain chip (English mode or non-bracketed word in Greek mode)
    const chip = (w, key) => {
      const clickable = !!(onWordClick && w.strongs_base && w.strongs_base !== "*");
      return (
        <span key={key}
          className={"lib-word" + (clickable ? " lib-word-clickable" : "")}
          onClick={clickable ? () => onWordClick(makeEntry(w)) : undefined}>
          {showInterlinear && w.lemma && <span className="lib-iw-greek">{w.lemma}</span>}
          <span className="lib-iw-english">{chipLabel(w)}</span>
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
      const clickable = !!(onWordClick && w.strongs_base && w.strongs_base !== "*");
      return (
        <span key={key}
          className={"lib-word lib-word-bracketed" + (clickable ? " lib-word-clickable" : "")}
          onClick={clickable ? () => onWordClick(makeEntry(w)) : undefined}>
          {w.greek_pos !== null && w.greek_pos !== undefined &&
            <span className="lib-iw-pos">{w.greek_pos}</span>}
          {showInterlinear && w.lemma && <span className="lib-iw-greek">{w.lemma}</span>}
          <span className="lib-iw-english">{chipLabel(w)}</span>
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
      const sortedWords = [...v.words].filter(w => w.english).sort((a, b) => a.position - b.position);
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
      const englishWords = getEnglishOrderWords(v.words).filter(w => w.english);
      content = englishWords.map((w, i) => chip(w, `e${i}`));
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
      greek: "",
      translit: "",
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
            return (
              <span key={i}
                className={"lib-word lib-kjv-word" + (w.italic ? " lib-kjv-italic" : "") + (clickable ? " lib-word-clickable" : "")}
                onClick={clickable ? () => onWordClick(makeKjvEntry(w, sid)) : undefined}>
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
        <div className="lib-translation-toggle">
          <button className={"lib-trans-btn" + (translation === "abp" ? " on" : "")} onClick={() => { setTranslation("abp"); onTranslationChange?.("abp"); }}>ABP</button>
          <button className={"lib-trans-btn" + (translation === "kjv" ? " on" : "")} onClick={() => { setTranslation("kjv"); onTranslationChange?.("kjv"); }}>KJV</button>
          <button className={"lib-trans-btn" + (translation === "parallel" ? " on" : "")} onClick={() => { setTranslation("parallel"); onTranslationChange?.("parallel"); }}>Parallel</button>
        </div>
        <div className="lib-toggles">
          {(translation === "kjv" || wordOrder === "greek") && <>
            <button
              className={"lib-toggle-btn" + (showStrongs ? " on" : "")}
              onClick={() => setOpt("showStrongs", !showStrongs)}
            >Strong's</button>
            <button
              className={"lib-toggle-btn" + (showInterlinear ? " on" : "")}
              onClick={() => setOpt("showInterlinear", !showInterlinear)}
            >Interlinear</button>
          </>}
          {translation !== "kjv" && (
            <div className="lib-order-toggle">
              <button
                className={"lib-order-btn" + (wordOrder === "english" ? " on" : "")}
                onClick={() => setLibOptions(prev => ({
                  ...prev,
                  [translation]: { ...prev[translation], wordOrder: "english", showStrongs: false, showInterlinear: false }
                }))}
              >English</button>
              <button
                className={"lib-order-btn" + (wordOrder === "greek" ? " on" : "")}
                onClick={() => setOpt("wordOrder", "greek")}
              >Greek</button>
            </div>
          )}
        </div>
      </div>

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
  );
}

// ============================================================
// GLOSS GROUPINGS
// ============================================================
function GlossGroupings({ groupings, results, variants, onGlossDrill, onStrongsSearch }) {
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
      .map(sn => {
        const glosses = groupings[sn] || [];
        const base = sn.includes('.') ? sn.split('.')[0] : sn;
        const allVariants = (variants && variants[base]) || [];
        const siblings = sn.includes('.') ? allVariants.filter(v => v !== sn) : [];
        const entry = results.find(e => e.strongs_raw === sn);
        return { sn, glosses, siblings, entry };
      })
      .filter(({ glosses, siblings, entry }) =>
        (glosses.length > 1 || siblings.length > 0) && !(entry && entry.is_function));
  }, [groupings, results, variants]);

  if (rows.length === 0) return null;

  return (
    <div className="gloss-groupings">
      {rows.map(({ sn, glosses, siblings, entry }) => (
        <div key={sn} className="gloss-group">
          <span className="gloss-group-head">
            <button className="gloss-strongs-btn" onClick={() => onStrongsSearch(`G${sn}`)}>G{sn}</button>
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
  { icon: "Search",  label: "The Lexicon",      body: "Search by English, Greek, transliteration, or Strong's number. Every word links to its full LSJ (Greek) or BDB (Hebrew) entry with a context-aware AI summary." },
  { icon: "Book",    label: "The Library",      body: "Read in ABP, KJV, or parallel interlinear. Switch to Greek word order, enable Strong's badges, or go fully interlinear. Click any verse number to open its cross-references." },
  { icon: "Panel",   label: "Cross-References", body: "Every verse connects to Torrey's Treasury of Scripture Knowledge — AI-curated to the strongest matches and synthesized into a thematic overview." },
  { icon: "Sparkle", label: "Ask the Corpus",  body: "Ask in plain language: 'Where does Paul use pistis in Romans?' or 'Divine council passages in the OT.' The AI searches Greek and Hebrew simultaneously." },
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
  const [sortBy, setSortBy] = useState("relevance");
  const [viewMode, setViewMode] = useState("browse");
  const [corpusFilter, setCorpusFilter] = useState("all"); // "all" | "ot" | "nt"
  const [isMobile, setIsMobile] = useState(false);
  const [mainView, setMainView] = useState("search");
  const [libNav, setLibNav] = useState(null);
  const [libCrossRef, setLibCrossRef] = useState(null);
  const [libTranslation, setLibTranslation] = useState("abp");
  const [groupings, setGroupings] = useState({});
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

  // Corpus-filtered results (OT/NT filter applied before everything else)
  const corpusFilteredResults = useMemo(() => {
    if (corpusFilter === "ot") return allResults.filter(e => !NT_BOOKS.has(e.book));
    if (corpusFilter === "nt") return allResults.filter(e => NT_BOOKS.has(e.book));
    return allResults;
  }, [allResults, corpusFilter]);

  // Count occurrences per dotted strongs across corpus-filtered results
  const countMap = useMemo(() => {
    const map = {};
    for (const e of corpusFilteredResults) {
      map[e.strongs_raw] = (map[e.strongs_raw] || 0) + 1;
    }
    return map;
  }, [corpusFilteredResults]);

  // Grouping counts recomputed from corpus-filtered results
  const filteredGroupings = useMemo(() => {
    if (corpusFilter === "all") return groupings;
    const glossCounts = {};
    for (const e of corpusFilteredResults) {
      if (e.strongs_raw && e.strongs_raw !== "*" && e.gloss_head) {
        const key = `${e.strongs_raw}::${e.gloss_head.toLowerCase()}`;
        glossCounts[key] = (glossCounts[key] || 0) + 1;
      }
    }
    const result = {};
    for (const [sn, glossList] of Object.entries(groupings)) {
      const filtered = glossList
        .map(g => ({ ...g, count: glossCounts[`${sn}::${g.gloss.toLowerCase()}`] || 0 }))
        .filter(g => g.count > 0);
      if (filtered.length > 0) result[sn] = filtered;
    }
    return result;
  }, [groupings, corpusFilteredResults, corpusFilter]);

  // Sorted display list — gloss filter > function word suppression (corpus already filtered)
  const displayed = useMemo(() => {
    let base;
    if (glossFilter) {
      base = corpusFilteredResults.filter(e =>
        e.strongs_raw === glossFilter.sn &&
        e.gloss_head.toLowerCase() === glossFilter.gloss.toLowerCase()
      );
    } else if (mode === "search" && !primaryStrongs) {
      base = corpusFilteredResults.filter(e => !e.is_function);
    } else {
      base = corpusFilteredResults;
    }
    if (sortBy === "alpha") return [...base].sort((a, b) =>
      (BOOK_LABELS[a.book] || a.book).localeCompare(BOOK_LABELS[b.book] || b.book));
    return [...base].sort((a, b) =>
      (BOOK_ORDER[a.book] ?? 99) - (BOOK_ORDER[b.book] ?? 99) || a.chapter - b.chapter || a.verse - b.verse);
  }, [corpusFilteredResults, sortBy, countMap, mode, primaryStrongs, glossFilter]);

  // Strongs number being searched directly (null in AI/text modes)
  const primaryStrongs = useMemo(() => {
    if (mode !== "search") return null;
    const m = /^[Gg]([\d.]+)$/.exec(q1.trim());
    return m ? m[1] : null;
  }, [mode, q1]);

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

  const handleSearch = async (overrideQ = null, newBreadcrumbs = null, pushHistory = true) => {
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
    setSortBy("relevance");
    setViewMode("browse");
    setActiveEntry(null);
    setGroupings({});
    setVariants({});
    setGlossFilter(null);
    try {
      const data = await api.search(q);
      if (data.error) {
        setError(data.error);
        setAllResults([]);
        setGroupings({});
        setVariants({});
      } else {
        setAllResults((data.results || []).map((r, idx) => makeEntry(r, idx)));
        setGroupings(data.groupings || {});
        setVariants(data.variants || {});
      }
    } catch (e) {
      setError("Network error: " + e.message);
      setAllResults([]);
    } finally {
      setLoading(false);
    }
  };
  searchFnRef.current = handleSearch;

  const handleStrongsSearch = (strongs_base) => {
    if (!strongs_base || strongs_base === "*") return;
    const num = String(strongs_base).replace(/^G/i, "");
    handleSearch(`G${num}`);
  };

  const handleGlossDrill = (sn, gloss) => {
    const hasMatch = allResults.some(
      e => e.strongs_raw === sn && e.gloss_head.toLowerCase() === gloss.toLowerCase()
    );
    if (hasMatch) {
      setGlossFilter({ sn, gloss });
      return;
    }
    // Gloss not in current results — search the full strongs entry, then apply filter
    const crumbsWithCurrent = [...breadcrumbs, { label: searchLabel, q: q1.trim() }];
    handleSearch(`G${sn}`, crumbsWithCurrent, true).then(() => setGlossFilter({ sn, gloss }));
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
    setSortBy("relevance");
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
          {libEverVisited && (
            <div style={{ display: mainView === "library" ? undefined : "none" }}>
              <LibraryView nav={libNav} onNavChange={setLibNav} onWordClick={(e) => { setLibCrossRef(null); setActiveEntry(e); }} onVerseNumberClick={handleVerseNumberClick} onTranslationChange={setLibTranslation} />
            </div>
          )}
          <div style={{ display: mainView === "library" ? "none" : undefined }}>
          <><SearchBar
            q1={q1} setQ1={setQ1}
            q2={q2} setQ2={setQ2}
            onSearch={handleSearch}
            onAiSearch={handleAiSearch}
            aiLoading={aiLoading}
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
                    ? [...breadcrumbs, { label: searchLabel, q: q1.trim() }, ...(searchLabel !== `G${glossFilter.sn}` ? [{ label: `G${glossFilter.sn}` }] : [])]
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
                      <span className="results-count">{loading ? "…" : primaryVerseCount}</span>
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
                  {searchLabel && <span className="results-for">for "<b>{searchLabel}</b>"</span>}
                </div>
                <div className="results-controls">
                  {viewMode === "browse" && (
                    <div className="results-sort">
                      <span className="sort-label">Sort</span>
                      <button className={"sort-btn " + (sortBy === "relevance" ? "on" : "")} onClick={() => setSortBy("relevance")}>Canonical</button>
                      <button className={"sort-btn " + (sortBy === "alpha" ? "on" : "")} onClick={() => setSortBy("alpha")}>A–Z</button>
                    </div>
                  )}
                  <div className="results-sort">
                    <span className="sort-label">Corpus</span>
                    <button className={"sort-btn " + (corpusFilter === "all" ? "on" : "")} onClick={() => setCorpusFilter("all")}>All</button>
                    <button className={"sort-btn " + (corpusFilter === "ot" ? "on" : "")} onClick={() => setCorpusFilter("ot")}>OT</button>
                    <button className={"sort-btn " + (corpusFilter === "nt" ? "on" : "")} onClick={() => setCorpusFilter("nt")}>NT</button>
                  </div>
                  <div className="view-toggle">
                    <button className={"view-btn " + (viewMode === "browse" ? "on" : "")} onClick={() => setViewMode("browse")} title="Browse mode">
                      <Icon.Grid/>
                    </button>
                    <button className={"view-btn " + (viewMode === "study" ? "on" : "")} onClick={() => setViewMode("study")} title="Study mode">
                      <Icon.Lines/>
                    </button>
                  </div>
                </div>
              </div>

              {!loading && allResults.length > 0 && mode === "search" && !glossFilter && (
                <GlossGroupings
                  groupings={filteredGroupings}
                  results={corpusFilteredResults}
                  variants={variants}
                  onGlossDrill={handleGlossDrill}
                  onStrongsSearch={handleStrongsSearch}
                />
              )}

              {loading ? (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--ink-3)", fontSize: "14px" }}>
                  Searching…
                </div>
              ) : displayed.length === 0 ? (
                <div className="empty">
                  <div className="empty-title">No matches</div>
                  <div className="empty-sub">Try a different lemma, gloss, or Strong's number.</div>
                </div>
              ) : viewMode === "study" ? (
                <StudyMode allResults={corpusFilteredResults} primaryStrongs={primaryStrongs} showAll={showAllAi} onWordClick={(e) => setActiveEntry(e)} onReadInContext={handleReadInContext} />
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
        </nav>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
