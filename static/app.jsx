const { useState, useEffect, useRef, useMemo } = React;

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
  lsj: (lemma) =>
    fetch(`/api/lsj/${encodeURIComponent(lemma)}`).then(r => r.json()),
  lsjSummary: (lemma) =>
    fetch(`/api/lsj-summary/${encodeURIComponent(lemma)}`).then(r => r.json()),
  books: () =>
    fetch("/api/books").then(r => r.json()),
  chapter: (book, ch) =>
    fetch(`/api/chapter/${encodeURIComponent(book)}/${ch}`).then(r => r.json()),
};

// ============================================================
// DATA SHAPING
// ============================================================
function makeEntry(r, idx) {
  return {
    id: `${r.strongs_base}-${r.book}-${r.chapter}-${r.verse}-${idx}`,
    strongs: r.strongs_base === "*" ? "PN" : `G${r.strongs_base}`,
    strongs_base: r.strongs_base,
    greek: r.lemma || "",
    translit: r.translit || "",
    gloss: r.gloss || "",
    ref: r.ref,
    book: r.book,
    chapter: r.chapter,
    verse: r.verse,
    definition: r.strongs_def || "",
    derivation: r.derivation || "",
  };
}

function flattenAiResults(verses) {
  const entries = [];
  let idx = 0;
  for (const v of verses) {
    for (const w of (v.words || [])) {
      entries.push({
        id: `ai-${v.book}-${v.chapter}-${v.verse}-${w.strongs_base}-${idx++}`,
        strongs: w.strongs_base === "*" ? "PN" : `G${w.strongs_base}`,
        strongs_base: w.strongs_base,
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
      });
    }
  }
  return entries;
}

// ============================================================
// BOOK LABELS
// ============================================================
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
        <div className="hdr-right">
          <div className="hdr-avatar">JM</div>
        </div>
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
          <div className="search-field">
            <Icon.Search className="search-icon"/>
            <input
              type="text"
              className="search-input"
              placeholder="πνεῦμα  ·  pneuma  ·  G4151"
              value={q1}
              onChange={(e) => setQ1(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
            />

          </div>
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
          <div className="search-field ai-field">
            <Icon.Sparkle className="search-icon"/>
            <input
              type="text"
              className="search-input"
              placeholder="Where does the divine council appear?"
              value={q2}
              onChange={(e) => setQ2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onAiSearch()}
            />
            <button className="search-go" onClick={onAiSearch} aria-label="Submit">
              {aiLoading ? <span className="spinner"/> : <Icon.ArrowRight/>}
            </button>
          </div>
          <div className="search-chips">
            <button className="chip suggest" onClick={() => setQ2("divine council passages")}>"divine council passages"</button>
            <button className="chip suggest" onClick={() => setQ2("covenant with Abraham")}>"covenant with Abraham"</button>
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
        <div className="card-greek" style={{ fontSize: "22px" }}>{entry.gloss}</div>
      )}
      <div className="card-translit">{entry.translit}</div>
      <div className="card-gloss">{entry.gloss}</div>
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
  const sections = (data?.sections || []).filter(s => s.text && !_REFUSAL_RE.test(s.text));
  if (!sections.length)
    return <div className="lsj-def" style={{ color: "var(--muted)" }}>No definition available.</div>;
  return (
    <div className="lsj-parsed">
      {sections.map((s, i) => (
        <div key={i} className={"lsj-sense lsj-l" + _senseLevel(s.marker)}>
          {s.marker && <span className="lsj-marker">{s.marker}</span>}
          <span className="lsj-text">{_stripMd(s.text)}</span>
        </div>
      ))}
    </div>
  );
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
    api.strongsCount(entry.strongs_base)
      .then(d => { if (!cancelled) setAbpCount(d.count ?? null); })
      .catch(() => { if (!cancelled) setAbpCount(null); });
    return () => { cancelled = true; };
  }, [entry && entry.strongs_base]);

  const [lsjEntry, setLsjEntry] = useState(null);
  const [lsjLoading, setLsjLoading] = useState(false);
  const [lsjTab, setLsjTab] = useState("def");
  const [lsjSummary, setLsjSummary] = useState(null);
  const [lsjSummaryLoading, setLsjSummaryLoading] = useState(false);

  useEffect(() => {
    setLsjEntry(null);
    setLsjTab("def");
    setLsjSummary(null);
    if (!entry || !entry.greek) { setLsjLoading(false); return; }
    let cancelled = false;
    setLsjLoading(true);
    api.lsj(entry.greek)
      .then(d => {
        if (!cancelled) { setLsjEntry(d.error ? null : d); setLsjLoading(false); }
      })
      .catch(() => {
        if (!cancelled) { setLsjEntry(null); setLsjLoading(false); }
      });
    return () => { cancelled = true; };
  }, [entry && entry.id]);

  useEffect(() => {
    if (!lsjEntry) { setLsjSummary(null); return; }
    let cancelled = false;
    setLsjSummaryLoading(true);
    api.lsjSummary(lsjEntry.key)
      .then(d => { if (!cancelled) setLsjSummary(d); })
      .catch(() => { if (!cancelled) setLsjSummary(null); })
      .finally(() => { if (!cancelled) setLsjSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [lsjEntry && lsjEntry.key]);

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
          <div className="detail-greek">{entry.greek || entry.gloss}</div>
          <div className="detail-translit-row">
            <span className="detail-translit">{entry.translit}</span>
            <button
              className="tool-btn"
              title="Copy"
              onClick={() => navigator.clipboard?.writeText(entry.greek)}
            >
              <Icon.Copy/>
            </button>
            <button className="tool-btn" title="Share"><Icon.Share/></button>
          </div>
          <div className="detail-gloss">{entry.gloss}</div>
        </div>

        {entry.greek && (
          <section className="detail-section">
            <div className="lsj-head">
              <h4 className="detail-h" style={{ margin: 0 }}>
                Liddell-Scott-Jones<span className="lsj-badge">LSJ</span>
              </h4>
              {lsjEntry && (
                <div className="lsj-tabs">
                  <button className={"lsj-tab " + (lsjTab === "def"  ? "on" : "")} onClick={() => setLsjTab("def")}>Definition</button>
                  <button className={"lsj-tab " + (lsjTab === "full" ? "on" : "")} onClick={() => setLsjTab("full")}>Full LSJ</button>
                </div>
              )}
            </div>
            {lsjLoading ? (
              <div className="lsj-def" style={{ color: "var(--ink-4)", fontStyle: "italic", padding: "8px 0" }}>Loading…</div>
            ) : lsjEntry ? (
              lsjTab === "def"
                ? <LsjSummary data={lsjSummary} loading={lsjSummaryLoading} />
                : <div className="lsj-def" dangerouslySetInnerHTML={{ __html: lsjEntry.def_html }} />
            ) : (
              <div className="lsj-def" style={{ color: "var(--ink-4)", fontStyle: "italic", padding: "8px 0" }}>Not in LSJ.</div>
            )}
          </section>
        )}

        {abpCount !== null && (
          <section className="detail-section">
            <h4 className="detail-h">ABP Occurrences</h4>
            <button
              className="link-btn"
              style={{ fontSize: "15px", fontWeight: "600" }}
              onClick={() => onStrongsSearch(entry.strongs_base)}
            >
              <b>{abpCount}</b>× in LXX <Icon.ArrowRight/>
            </button>
          </section>
        )}

        {entry.derivation && (
          <section className="detail-section">
            <h4 className="detail-h">Derivation</h4>
            <p className="detail-p">{entry.derivation}</p>
          </section>
        )}

        <section className="detail-section">
          <h4 className="detail-h">
            Verse — {entry.ref}
            <span className="detail-h-sub">LXX (ABP English)</span>
          </h4>
          <blockquote className="verse">
            <span className="verse-num">{entry.verse}</span>
            {verseLoading ? "Loading…" : verseText || "—"}
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
                  {w.strongs_base && w.strongs_base !== "*" && (
                    <span className="iw-strongs">G{w.strongs_base}</span>
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
      </div>
    </aside>
  );
}

// ============================================================
// STUDY MODE — VERSE ROW
// ============================================================
function VerseStudyRow({ book, chapter, verse, label, allResults, onWordClick, onReadInContext }) {
  const [words, setWords] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setWords(null);
    api.verseWords(book, chapter, verse)
      .then(d => { if (!cancelled) setWords(d.words || []); })
      .catch(() => { if (!cancelled) setWords([]); });
    return () => { cancelled = true; };
  }, [book, chapter, verse]);

  const entryMap = useMemo(() => {
    const m = new Map();
    for (const e of allResults) {
      if (e.book === book && e.chapter === chapter && e.verse === verse && !m.has(e.strongs_base))
        m.set(e.strongs_base, e);
    }
    return m;
  }, [allResults, book, chapter, verse]);

  return (
    <div className="study-verse">
      <button className="study-ref" onClick={() => onReadInContext?.(book, chapter, verse)}>{label}</button>
      <span className="study-text">
        {words === null ? (
          <span style={{ color: "var(--ink-4)", fontSize: "13px" }}>Loading…</span>
        ) : words.map((w, i) => {
          const clickable = w.strongs_base && w.strongs_base !== "*";
          const entry = clickable && (entryMap.get(w.strongs_base) || {
            id: `study-${book}-${chapter}-${verse}-${i}`,
            strongs: `G${w.strongs_base}`,
            strongs_base: w.strongs_base,
            greek: w.lemma || "",
            translit: w.translit || "",
            gloss: w.english || "",
            ref: `${book} ${chapter}:${verse}`,
            book, chapter, verse,
            definition: "", derivation: "", is_function: false,
          });
          return clickable ? (
            <span key={i} className="study-word match" onClick={() => onWordClick(entry)}>{w.english}{" "}</span>
          ) : (
            <span key={i} className="study-word">{w.english}{" "}</span>
          );
        })}
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
function StudyMode({ allResults, primaryStrongs, onWordClick, onReadInContext }) {

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
        };
        gMap[gk].verseOrder.push(vk);
      }
    }
    return gOrder.map(gk => ({
      label:  gMap[gk].label,
      verses: gMap[gk].verseOrder.map(vk => gMap[gk].verseMap[vk]),
    }));
  }, [allResults]);

  const primaryGroups = groups
    .map(g => ({ ...g, verses: g.verses.filter(v => v.is_primary) }))
    .filter(g => g.verses.length > 0);

  return (
    <div className="study-groups">
      {primaryGroups.map(g => (
        <PassageGroup key={g.label} label={g.label} verses={g.verses} allResults={allResults} onWordClick={onWordClick} onReadInContext={onReadInContext} />
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
function LibraryView({ nav, onNavChange, onWordClick }) {
  const [books, setBooks] = useState([]);
  const [selBook, setSelBook] = useState(null);
  const [selChapter, setSelChapter] = useState(1);
  const [verses, setVerses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showStrongs, setShowStrongs] = useState(false);
  const [showInterlinear, setShowInterlinear] = useState(false);
  const [wordOrder, setWordOrder] = useState("english"); // "english" | "greek"
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
    if (!nav?.scroll || !verses.length) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (highlightRef.current) {
        highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        onNavChange?.({ ...nav, scroll: false });
      }
    }));
  }, [nav?.scroll, verses]);

  const maxChap = selBook ? selBook.chapters : 1;
  const wordMode = showStrongs || showInterlinear || wordOrder === "greek";

  const renderVerse = (v) => {
    const isHighlight = nav && nav.highlight === v.verse;

    const makeEntry = (w) => ({
      id: `lib-${selBook.abbrev}-${selChapter}-${v.verse}-${w.position}`,
      strongs: `G${w.strongs_base}`,
      strongs_base: w.strongs_base,
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
    });

    // Plain chip (English mode or non-bracketed word in Greek mode)
    const chip = (w, key) => {
      const clickable = !!(onWordClick && w.strongs_base && w.strongs_base !== "*");
      return (
        <span key={key}
          className={"lib-word" + (clickable ? " lib-word-clickable" : "")}
          onClick={clickable ? () => onWordClick(makeEntry(w)) : undefined}>
          {showInterlinear && w.lemma && <span className="lib-iw-greek">{w.lemma}</span>}
          <span className="lib-iw-english">{w.english}</span>
          {showStrongs && (
            w.strongs_base && w.strongs_base !== "*"
              ? <span className="lib-iw-strongs">G{w.strongs_base}</span>
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
          <span className="lib-iw-english">{w.english}</span>
          {showStrongs && (
            w.strongs_base && w.strongs_base !== "*"
              ? <span className="lib-iw-strongs">G{w.strongs_base}</span>
              : <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>
          )}
        </span>
      );
    };

    if (!wordMode) {
      // Prose mode: compute English-ordered text from words
      const englishWords = getEnglishOrderWords(v.words);
      const text = englishWords.map(w => w.english).join(' ');
      return (
        <span key={v.verse} ref={isHighlight ? highlightRef : null}
          className={"lib-verse-span" + (isHighlight ? " lib-highlight" : "")}>
          <sup className="lib-vnum">{v.verse}</sup>
          {text}{" "}
        </span>
      );
    }

    // Chip mode
    let content;
    if (wordOrder === "greek") {
      // Greek syntactic order with bracket notation
      const sortedWords = [...v.words].sort((a, b) => a.position - b.position);
      const groups = groupForGreekMode(sortedWords);
      content = groups.map((g, gi) => {
        if (!g.isBracket) {
          return chip(g.word, `g${gi}`);
        }
        return (
          <span key={`bg${gi}`} className="lib-bracket-group">
            <span className="lib-bracket">[</span>
            {g.words.map((w, wi) => bracketChip(w, `bg${gi}w${wi}`))}
            <span className="lib-bracket">]</span>
          </span>
        );
      });
    } else {
      // English reading order
      const englishWords = getEnglishOrderWords(v.words);
      content = englishWords.map((w, i) => chip(w, `e${i}`));
    }

    return (
      <span key={v.verse} ref={isHighlight ? highlightRef : null}
        className={"lib-verse-block" + (isHighlight ? " lib-highlight" : "")}>
        <sup className="lib-vnum">{v.verse}</sup>
        {content}
      </span>
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
        <div className="lib-toggles">
          <button
            className={"lib-toggle-btn" + (showStrongs ? " on" : "")}
            onClick={() => setShowStrongs(v => !v)}
          >Strong's</button>
          <button
            className={"lib-toggle-btn" + (showInterlinear ? " on" : "")}
            onClick={() => setShowInterlinear(v => !v)}
          >Interlinear</button>
          <div className="lib-order-toggle">
            <button
              className={"lib-order-btn" + (wordOrder === "english" ? " on" : "")}
              onClick={() => setWordOrder("english")}
            >English</button>
            <button
              className={"lib-order-btn" + (wordOrder === "greek" ? " on" : "")}
              onClick={() => setWordOrder("greek")}
            >Greek</button>
          </div>
        </div>
      </div>

      <div className="lib-reading">
        <h2 className="lib-heading">
          {selBook ? selBook.name : "—"} <span className="lib-chap-num">{selChapter}</span>
        </h2>
        {loading ? (
          <div className="lib-loading">Loading…</div>
        ) : wordMode ? (
          <div className="lib-text-words">
            {verses.map(v => renderVerse(v))}
          </div>
        ) : (
          <p className="lib-text">
            {verses.map(v => renderVerse(v))}
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// GLOSS GROUPINGS
// ============================================================
function GlossGroupings({ groupings, results, onGlossDrill, onStrongsSearch }) {
  const rows = useMemo(() => {
    const seen = new Set();
    const order = [];
    for (const e of results) {
      if (e.strongs_base && e.strongs_base !== "*" && !seen.has(e.strongs_base)) {
        seen.add(e.strongs_base);
        order.push(e.strongs_base);
      }
    }
    return order
      .map(sb => ({ sb, glosses: groupings[sb] || [], entry: results.find(e => e.strongs_base === sb) }))
      .filter(({ glosses }) => glosses.length > 1);
  }, [groupings, results]);

  if (rows.length === 0) return null;

  return (
    <div className="gloss-groupings">
      {rows.map(({ sb, glosses, entry }) => (
        <div key={sb} className="gloss-group">
          <span className="gloss-group-head">
            <button className="gloss-strongs-btn" onClick={() => onStrongsSearch(`G${sb}`)}>G{sb}</button>
            {entry?.translit && <span className="gloss-translit">{entry.translit}</span>}
            <span className="gloss-also">appears as</span>
          </span>
          <span className="gloss-chips">
            {glosses.map(g => (
              <button key={g.gloss} className="gloss-chip"
                onClick={() => onGlossDrill(sb, entry?.greek || entry?.translit, g.gloss)}>
                {g.gloss}
                <span className="gloss-chip-count">{g.count}</span>
              </button>
            ))}
          </span>
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
function AIAnswer({ query, explanation, entries, onPick }) {
  const uniqueEntries = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const e of entries) {
      if (!seen.has(e.strongs_base)) {
        seen.add(e.strongs_base);
        result.push(e);
        if (result.length >= 6) break;
      }
    }
    return result;
  }, [entries]);

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
      <div className="ai-cites">
        <span className="ai-cites-label">Cited:</span>
        {uniqueEntries.map((e) => (
          <button key={e.id} className="ai-cite" onClick={() => onPick(e)}>
            {e.strongs} {e.greek}
          </button>
        ))}
      </div>
    </section>
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
  const [mode, setMode] = useState("idle");
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeEntry, setActiveEntry] = useState(null);
  const [sortBy, setSortBy] = useState("relevance");
  const [viewMode, setViewMode] = useState("browse");
  const [isMobile, setIsMobile] = useState(false);
  const [mainView, setMainView] = useState("search");
  const [libNav, setLibNav] = useState(null);
  const [groupings, setGroupings] = useState({});
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const searchFnRef = useRef(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 860);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Count occurrences per strongs_base across all results
  const countMap = useMemo(() => {
    const map = {};
    for (const e of allResults) {
      map[e.strongs_base] = (map[e.strongs_base] || 0) + 1;
    }
    return map;
  }, [allResults]);

  // Sorted display list
  const displayed = useMemo(() => {
    if (sortBy === "alpha") return [...allResults].sort((a, b) => a.translit.localeCompare(b.translit));
    if (sortBy === "freq") return [...allResults].sort((a, b) => (countMap[b.strongs_base] || 0) - (countMap[a.strongs_base] || 0));
    return allResults; // relevance = original order
  }, [allResults, sortBy, countMap]);

  // Strongs base being searched directly (null in AI/text modes)
  const primaryStrongs = useMemo(() => {
    if (mode !== "search") return null;
    const m = /^[Gg](\d+)$/.exec(q1.trim());
    return m ? m[1] : null;
  }, [mode, q1]);

  // Count of distinct primary verses (AI mode only)
  const primaryVerseCount = useMemo(() => {
    if (mode !== "ai") return null;
    const seen = new Set();
    for (const e of allResults) { if (e.is_primary) seen.add(e.ref); }
    return seen.size;
  }, [allResults, mode]);

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
    try {
      const data = await api.search(q);
      if (data.error) {
        setError(data.error);
        setAllResults([]);
        setGroupings({});
      } else {
        setAllResults((data.results || []).map((r, idx) => makeEntry(r, idx)));
        setGroupings(data.groupings || {});
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

  const handleGlossDrill = (sb, greek, gloss) => {
    const gq = `G${sb}`;
    const label = greek ? `${greek} G${sb}` : gq;
    const existingIdx = breadcrumbs.findIndex(c => c.q === gq);
    let newCrumbs;
    if (existingIdx !== -1) {
      newCrumbs = breadcrumbs.slice(0, existingIdx + 1);
    } else {
      newCrumbs = [
        ...breadcrumbs,
        { label: searchLabel, q: q1.trim() },
        { label, q: gq },
      ];
    }
    handleSearch(gloss, newCrumbs, true);
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

  const handleAiSearch = async () => {
    const q = q2.trim();
    if (!q) return;
    setMainView("search");
    setAiLoading(true);
    setError("");
    setMode("ai");
    setSortBy("relevance");
    setViewMode("study");
    setActiveEntry(null);
    try {
      const data = await api.aiSearch(q);
      if (data.error) {
        setError(data.error);
        setAllResults([]);
        setAiMeta(null);
      } else {
        setAllResults(flattenAiResults(data.results || []));
        setAiMeta({ query: q, explanation: data.explanation || "" });
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
      <div className="app-body">
      <main className="main">
        <div className="main-inner">
          {libEverVisited && (
            <div style={{ display: mainView === "library" ? undefined : "none" }}>
              <LibraryView nav={libNav} onNavChange={setLibNav} onWordClick={(e) => setActiveEntry(e)} />
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
              entries={allResults}
              onPick={(e) => setActiveEntry(e)}
            />
          )}

          {mode !== "idle" && (
            <>
              {mode === "search" && breadcrumbs.length > 0 && (
                <SearchBreadcrumb
                  breadcrumbs={breadcrumbs}
                  currentLabel={searchLabel}
                  onNav={handleBreadcrumbNav}
                />
              )}
              <div className="results-head">
                <div className="results-meta">
                  {mode === "ai" ? (
                    <>
                      <span className="results-count">{loading ? "…" : primaryVerseCount}</span>
                      <span className="results-label">primary {primaryVerseCount === 1 ? "verse" : "verses"}</span>
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
                      <button className={"sort-btn " + (sortBy === "relevance" ? "on" : "")} onClick={() => setSortBy("relevance")}>Relevance</button>
                      <button className={"sort-btn " + (sortBy === "alpha" ? "on" : "")} onClick={() => setSortBy("alpha")}>A–Z</button>
                      <button className={"sort-btn " + (sortBy === "freq" ? "on" : "")} onClick={() => setSortBy("freq")}>Frequency</button>
                    </div>
                  )}
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

              {!loading && allResults.length > 0 && mode === "search" && (
                <GlossGroupings
                  groupings={groupings}
                  results={allResults}
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
                <StudyMode allResults={allResults} primaryStrongs={primaryStrongs} onWordClick={(e) => setActiveEntry(e)} onReadInContext={handleReadInContext} />
              ) : (
                <div className="results">
                  {displayed.map((entry) => (
                    <ResultCard
                      key={entry.id}
                      entry={entry}
                      active={activeEntry && activeEntry.id === entry.id}
                      onClick={() => setActiveEntry(entry)}
                      count={countMap[entry.strongs_base] || 0}
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
          occurrences={countMap[activeEntry.strongs_base] || 0}
          totalResults={allResults.length}
          onStrongsSearch={handleStrongsSearch}
          onReadInContext={handleReadInContext}
        />
      )}
      </div>

      {activeEntry && isMobile && (
        <>
          <div className="sheet-scrim" onClick={() => setActiveEntry(null)}/>
          <DetailPanel
            entry={activeEntry}
            isMobile={true}
            onClose={() => setActiveEntry(null)}
            occurrences={countMap[activeEntry.strongs_base] || 0}
            totalResults={allResults.length}
            onStrongsSearch={handleStrongsSearch}
            onReadInContext={handleReadInContext}
          />
        </>
      )}
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
