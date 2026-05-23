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
      });
    }
  }
  return entries;
}

// ============================================================
// BOOK LABELS
// ============================================================
const BOOK_LABELS = { Gen: "Genesis LXX", Exo: "Exodus LXX" };

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
function Header() {
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
          <a className="hdr-link active" href="#">Search</a>
          <a className="hdr-link" href="#">Concordance</a>
          <a className="hdr-link" href="#">Library</a>
          <a className="hdr-link" href="#">Notes</a>
        </nav>
        <div className="hdr-right">
          <button className="hdr-icon-btn" aria-label="Saved">
            <Icon.Bookmark/>
          </button>
          <div className="hdr-avatar">JM</div>
        </div>
      </div>
    </header>
  );
}

// ============================================================
// SEARCH BAR
// ============================================================
function SearchBar({ q1, setQ1, q2, setQ2, phraseMode, setPhraseMode, onSearch, onAiSearch, aiLoading }) {
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
            <kbd className="search-kbd">⌘ K</kbd>
          </div>
          <div className="search-chips">
            <button
              className={"chip " + (phraseMode ? "chip-active" : "")}
              onClick={() => setPhraseMode(!phraseMode)}
            >
              <Icon.Filter/> Phrase
            </button>
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
function LsjSummary({ data, loading }) {
  if (loading)
    return <div className="lsj-def" style={{ color: "var(--muted)", fontStyle: "italic" }}>Summarizing…</div>;
  if (!data || !data.sections || !data.sections.length)
    return <div className="lsj-def" style={{ color: "var(--muted)" }}>No definition available.</div>;
  return (
    <div className="lsj-parsed">
      {data.sections.map((s, i) => (
        <div key={i} className="lsj-sense lsj-l0">
          {s.marker && <span className="lsj-marker">{s.marker}</span>}
          <span className="lsj-text">{s.text}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// DETAIL PANEL — SIDEBAR / BOTTOM SHEET
// ============================================================
function DetailPanel({ entry, isMobile, onClose, occurrences, totalResults, onStrongsSearch }) {
  const [verseText, setVerseText] = useState("");
  const [verseLoading, setVerseLoading] = useState(false);
  const [abpCount, setAbpCount] = useState(null);

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
  const [lsjTab, setLsjTab] = useState("def");
  const [lsjSummary, setLsjSummary] = useState(null);
  const [lsjSummaryLoading, setLsjSummaryLoading] = useState(false);

  useEffect(() => {
    setLsjTab("def");
    setLsjSummary(null);
    if (!entry || !entry.greek) { setLsjEntry(null); return; }
    let cancelled = false;
    api.lsj(entry.greek)
      .then(d => { if (!cancelled) setLsjEntry(d.error ? null : d); })
      .catch(() => { if (!cancelled) setLsjEntry(null); });
    return () => { cancelled = true; };
  }, [entry && entry.greek]);

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
            <button className="tool-btn" title="Save"><Icon.Bookmark/></button>
            <button className="tool-btn" title="Share"><Icon.Share/></button>
          </div>
          <div className="detail-gloss">{entry.gloss}</div>
        </div>

        {lsjEntry && (
          <section className="detail-section">
            <div className="lsj-head">
              <h4 className="detail-h" style={{ margin: 0 }}>
                Liddell-Scott-Jones<span className="lsj-badge">LSJ</span>
              </h4>
              <div className="lsj-tabs">
                <button className={"lsj-tab " + (lsjTab === "def"  ? "on" : "")} onClick={() => setLsjTab("def")}>Definition</button>
                <button className={"lsj-tab " + (lsjTab === "full" ? "on" : "")} onClick={() => setLsjTab("full")}>Full LSJ</button>
              </div>
            </div>
            {lsjTab === "def"
              ? <LsjSummary data={lsjSummary} loading={lsjSummaryLoading} />
              : <div className="lsj-def" dangerouslySetInnerHTML={{ __html: lsjEntry.def_html }} />
            }
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
              <b>{abpCount}</b>× in Genesis–Exodus LXX <Icon.ArrowRight/>
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
          <div className="verse-tools">
            <button className="link-btn">Read in context <Icon.ArrowRight/></button>
            <span className="dot">·</span>
            <button className="link-btn">Interlinear</button>
            <span className="dot">·</span>
            <button className="link-btn">Parallel</button>
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
function VerseStudyRow({ book, chapter, verse, label, entries, onWordClick }) {
  const [words, setWords] = useState(null);

  // Map strongs_base -> first matching entry for this verse
  const matchMap = useMemo(() => {
    const m = new Map();
    for (const e of entries) {
      if (e.strongs_base !== "*" && !m.has(e.strongs_base)) m.set(e.strongs_base, e);
    }
    return m;
  }, [entries]);

  useEffect(() => {
    let cancelled = false;
    setWords(null);
    api.verseWords(book, chapter, verse)
      .then(d => { if (!cancelled) setWords(d.words || []); })
      .catch(() => { if (!cancelled) setWords([]); });
    return () => { cancelled = true; };
  }, [book, chapter, verse]);

  return (
    <div className="study-verse">
      <span className="study-ref">{label}</span>
      <span className="study-text">
        {words === null ? (
          <span style={{ color: "var(--ink-4)", fontSize: "13px" }}>Loading…</span>
        ) : words.map((w, i) => {
          const entry = matchMap.get(w.strongs_base);
          if (entry) {
            return (
              <span key={i} className="study-word match" onClick={() => onWordClick(entry)}>
                <span className="word-badge">G{w.strongs_base}</span>
                {w.english}{" "}
              </span>
            );
          }
          return <span key={i} className="study-word">{w.english}{" "}</span>;
        })}
      </span>
    </div>
  );
}

// ============================================================
// STUDY MODE — PASSAGE GROUP (collapsible book+chapter section)
// ============================================================
function PassageGroup({ label, verses, onWordClick }) {
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
              entries={v.entries}
              onWordClick={onWordClick}
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
function StudyMode({ allResults, onWordClick }) {
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
          book: entry.book, chapter: entry.chapter, verse: entry.verse,
          ref: entry.ref, entries: [],
        };
        gMap[gk].verseOrder.push(vk);
      }
      gMap[gk].verseMap[vk].entries.push(entry);
    }
    return gOrder.map(gk => ({
      label: gMap[gk].label,
      verses: gMap[gk].verseOrder.map(vk => gMap[gk].verseMap[vk]),
    }));
  }, [allResults]);

  return (
    <div className="study-groups">
      {groups.map(g => (
        <PassageGroup key={g.label} label={g.label} verses={g.verses} onWordClick={onWordClick} />
      ))}
    </div>
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
  const [phraseMode, setPhraseMode] = useState(false);
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

  const handleSearch = async (overrideQ = null) => {
    const q = (overrideQ !== null ? overrideQ : q1).trim();
    if (!q) return;
    if (overrideQ !== null) setQ1(overrideQ);
    setLoading(true);
    setError("");
    setAiMeta(null);
    setMode("search");
    setSortBy("relevance");
    setViewMode("browse");
    setActiveEntry(null);
    try {
      const data = await api.search(q, overrideQ !== null ? false : phraseMode);
      if (data.error) {
        setError(data.error);
        setAllResults([]);
      } else {
        setAllResults((data.results || []).map((r, idx) => makeEntry(r, idx)));
      }
    } catch (e) {
      setError("Network error: " + e.message);
      setAllResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleStrongsSearch = (strongs_base) => {
    if (!strongs_base || strongs_base === "*") return;
    handleSearch(`G${strongs_base}`);
  };

  const handleAiSearch = async () => {
    const q = q2.trim();
    if (!q) return;
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
      <Header/>
      <main className="main">
        <div className="main-inner">
          <SearchBar
            q1={q1} setQ1={setQ1}
            q2={q2} setQ2={setQ2}
            phraseMode={phraseMode}
            setPhraseMode={setPhraseMode}
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
              <div className="results-head">
                <div className="results-meta">
                  <span className="results-count">{loading ? "…" : displayed.length}</span>
                  <span className="results-label">results</span>
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
                <StudyMode allResults={allResults} onWordClick={(e) => setActiveEntry(e)} />
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
            <span>Lexica · Genesis–Exodus LXX · Apostolic Bible Polyglot Interlinear · Strong's Greek</span>
          </footer>
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
        />
      )}
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
          />
        </>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
