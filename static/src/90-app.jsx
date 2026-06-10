// ============================================================
// APP
// ============================================================
function App() {
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
  const [corpusFilter, setCorpusFilter] = useState("all"); // "all" | "ot" | "nt"
  const [corpusSort, setCorpusSort] = useState("curated"); // "curated" | "canonical"
  const [corpusTextMode, setCorpusTextMode] = useState("abp"); // "abp" | "kjv"
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1100);
  const [mainView, setMainView] = useState("library");
  const [libNav, setLibNav] = useState(null);
  const [libCrossRef, setLibCrossRef] = useState(null);
  const [lexiconPendingStrongs, setLexiconPendingStrongs] = useState(null);
  const [libTranslation, setLibTranslation] = useState("abp");
  const [activeNote, setActiveNote] = useState(null);   // note id being edited

  // Open a note's editor — closes the word / cross-ref panels so one panel owns the slot.
  const openNote = (id) => { setActiveEntry(null); setLibCrossRef(null); setActiveNote(id); };
  // From the Notes tab: jump to the verse in the Library, then open the editor.
  const openNoteFromList = (n) => {
    if (n.corpus === "bible") {
      searchScrollRef.current = window.scrollY;
      setLibEverVisited(true);
      setMainView("library");
      setLibNav({ book: n.book, chapter: n.chapter, highlight: n.start.verse, scroll: true, translation: n.translation === "kjv" ? "kjv" : "abp" });
    }
    openNote(n.id);
  };


  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1100);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);


  const handleVerseNumberClick = (book, chapter, verse, translation) => {
    setActiveEntry(null);
    setActiveNote(null);
    setLibCrossRef({ book, chapter, verse, translation: translation || "abp" });
    setLibNav(prev => ({ ...(prev || {}), book, chapter, highlight: verse }));
  };

  // Corpus-filtered AI results (OT/NT filter)
  const corpusFilteredResults = useMemo(() => {
    let r = allResults;
    if (corpusFilter === "ot") r = r.filter(e => !NT_BOOKS.has(e.book));
    if (corpusFilter === "nt") r = r.filter(e => NT_BOOKS.has(e.book));
    return r;
  }, [allResults, corpusFilter]);

  // Count occurrences per strongs across AI results
  const countMap = useMemo(() => {
    const map = {};
    for (const e of corpusFilteredResults) {
      const key = e.strongs_raw || e.strongs_base;
      if (key) map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [corpusFilteredResults]);

  // Key strongs from AI search
  const primaryStrongs = useMemo(() => {
    if (mode === "ai" && aiMeta && aiMeta.keyStrongs && aiMeta.keyStrongs.length > 0)
      return aiMeta.keyStrongs;
    return null;
  }, [mode, aiMeta]);

  // Compute citedStrongs at App level — single source of truth, no prop-threading issues
  const citedStrongsApp = useMemo(() => {
    if (!primaryStrongs || !primaryStrongs.length) return null;
    const s = new Set();
    for (const p of primaryStrongs) {
      if (p.strongs_base) {
        const bare = strongsBare(p.strongs_base);
        s.add(p.strongs_base);   // as-is (e.g. "4151" or "G4151")
        s.add(bare);             // bare (e.g. "4151")
        s.add(`G${bare}`);       // G-prefixed
        s.add(`H${bare}`);       // H-prefixed
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

  const [libEverVisited, setLibEverVisited] = useState(true);
  const searchScrollRef = useRef(0);

  // Visitor stats: count this page load once (the server skips the owner's own
  // visits), and figure out whether the logged-in user is the owner so we can show
  // the private Stats tab. Re-check only when the signed-in email actually changes.
  const [owner, setOwner] = useState(false);
  useEffect(() => { api.statsHit(); }, []);
  useEffect(() => {
    let last;
    const check = () => {
      let email = null;
      try { email = (NotesStore.authInfo() || {}).email || null; } catch (e) {}
      if (email === last) return;
      last = email;
      api.statsOwner().then(d => setOwner(!!(d && d.owner)));
    };
    check();
    return NotesStore.subscribe(check);   // setAuth notifies on login/logout
  }, []);

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

  const handleNavigateToLexicon = (strongs, corpus) => {
    if (!strongs) return;
    setActiveEntry(null);   // close the word panel (bottom sheet on mobile) before showing the lexicon
    setLibCrossRef(null);
    setLexiconPendingStrongs({ strongs, corpus });   // corpus: "abp" | "kjv" | undefined (default by language)
    handleNavChange("lexicon");
  };

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
    setActiveEntry(null);
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

  const searchLabel = q2.trim();

  // Desktop Library: when nothing is selected, the right panel rests on the
  // book/chapter overview (SummaryPanel). It fills the same slot the word-study
  // and xref panels use, so `has-detail` stays on and the reading column keeps
  // its condensed (three-column) measure. Mobile never shows the summary.
  const showLibSummary = !isMobile && mainView === "library" && !activeEntry && !libCrossRef && !activeNote;

  return (
    <div className={"app view-" + mainView + " " + ((activeEntry || libCrossRef || activeNote || showLibSummary) ? "has-detail" : "")}>
      <Header activeView={mainView} onNavChange={handleNavChange}/>
      {isMobile && mainView !== "library" && (
        <div className="mobile-brand-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5a2.5 2.5 0 0 0 0 5H19v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M11 7v6M14 10h-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          <span className="mobile-brand-name">Lexica</span>
          <span className="mobile-brand-sub">Greek &amp; Hebrew Word Study</span>
        </div>
      )}
      <main className="main">
        {libEverVisited && (
          <div style={{ display: mainView === "library" ? undefined : "none" }}>
            <LibraryView nav={libNav} onNavChange={setLibNav} onWordClick={(e) => { setLibCrossRef(null); setActiveNote(null); setActiveEntry(e); }} onVerseNumberClick={handleVerseNumberClick} onOpenNote={openNote} onTranslationChange={setLibTranslation} isMobile={isMobile} showSummary={showLibSummary} />
          </div>
        )}
        {mainView === "about" && <AboutView owner={owner} />}
        {mainView === "notes" && <NotesView onOpen={openNoteFromList} />}
        <div style={{ display: mainView === "lexicon" ? undefined : "none" }}>
          <LexiconView
            onNavigateToSearch={(q) => { handleNavChange("search"); setQ2(q); }}
            onNavigateToLibrary={(book, chapter, verse, corpus) => {
              searchScrollRef.current = window.scrollY;
              setLibNav({ book, chapter, highlight: verse, scroll: true, translation: corpus === "kjv" ? "kjv" : "abp" });
              setLibEverVisited(true);
              setMainView("library");
            }}
            onWordClick={(e) => setActiveEntry(e)}
            pendingStrongs={lexiconPendingStrongs}
            onPendingStrongsConsumed={() => setLexiconPendingStrongs(null)}
            isMobile={isMobile}
          />
        </div>
        <div className="main-inner" style={{ display: (mainView === "library" || mainView === "about" || mainView === "lexicon" || mainView === "notes") ? "none" : undefined }}>
          <><SearchBar
            q2={q2} setQ2={setQ2}
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

          {mode === "ai" && (
            <>
              <div className="results-head">
                <div className="results-meta">
                  <span className="results-count">{(loading || aiLoading) ? "…" : primaryVerseCount}</span>
                  <span className="results-label">primary {primaryVerseCount === 1 ? "verse" : "verses"}</span>
                  {!loading && aiMeta && aiMeta.total > primaryVerseCount && (
                    <button className="see-all-link" onClick={() => setShowAllAi(v => !v)}>
                      {showAllAi ? "Show less" : `See all ${aiMeta.total} occurrences`}
                    </button>
                  )}
                  {searchLabel && !aiLoading && <span className="results-for">for "<b>{searchLabel}</b>"</span>}
                </div>
                <div className="results-controls" style={{marginLeft:"auto"}}>
                  <div className="results-sort">
                    <button className={"sort-btn " + (corpusFilter === "all" ? "on" : "")} onClick={() => setCorpusFilter("all")}>All</button>
                    <button className={"sort-btn " + (corpusFilter === "ot"  ? "on" : "")} onClick={() => setCorpusFilter("ot")}>OT</button>
                    <button className={"sort-btn " + (corpusFilter === "nt"  ? "on" : "")} onClick={() => setCorpusFilter("nt")}>NT</button>
                    <span style={{margin:"0 4px",color:"var(--rule-2)"}}>|</span>
                    <button className={"sort-btn " + (corpusSort === "curated"   ? "on" : "")} onClick={() => setCorpusSort("curated")}>Curated</button>
                    <button className={"sort-btn " + (corpusSort === "canonical" ? "on" : "")} onClick={() => setCorpusSort("canonical")}>Canonical</button>
                    <span style={{margin:"0 4px",color:"var(--rule-2)"}}>|</span>
                    <button className={"sort-btn " + (corpusTextMode === "abp" ? "on" : "")} onClick={() => setCorpusTextMode("abp")}>ABP</button>
                    <button className={"sort-btn " + (corpusTextMode === "kjv" ? "on" : "")} onClick={() => setCorpusTextMode("kjv")}>KJV</button>
                  </div>
                </div>
              </div>
              {(loading || aiLoading) ? (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--ink-3)", fontSize: "14px" }}>
                  Searching…
                </div>
              ) : (
                <CorpusResults allResults={corpusFilteredResults} primaryStrongs={primaryStrongs} citedStrongs={citedStrongsApp} showAll={showAllAi} onWordClick={(e) => setActiveEntry(e)} onReadInContext={handleReadInContext} corpusSort={corpusSort} textMode={corpusTextMode} />
              )}
            </>
          )}

          <footer className="foot">
            <span>Lexica · Greek Septuagint (LXX) · Apostolic Bible Polyglot Interlinear · Strong's Greek</span>
          </footer>
          </>
        </div>
      </main>

      {activeEntry && !isMobile && (
        <DetailPanel
          entry={activeEntry}
          isMobile={false}
          onClose={() => setActiveEntry(null)}
          occurrences={countMap[activeEntry.strongs_raw] || 0}
          totalResults={allResults.length}
                    onNavigateToLexicon={handleNavigateToLexicon}
          onReadInContext={handleReadInContext}
          overviewBack={mainView === "library"}
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
                        onNavigateToLexicon={handleNavigateToLexicon}
            onReadInContext={handleReadInContext}
          />
        </>
      )}
      {activeNote && (
        <NotesPanel
          noteId={activeNote}
          isMobile={isMobile}
          onClose={() => setActiveNote(null)}
        />
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
          overviewBack={true}
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
          <button className={"mobile-tab" + (mainView === "library" ? " active" : "")} onClick={() => handleNavChange("library")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5a2.5 2.5 0 0 0 0 5H19v-3"/></svg>
            Library
          </button>
          <button className={"mobile-tab" + (mainView === "lexicon" ? " active" : "")} onClick={() => handleNavChange("lexicon")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 19V6a2 2 0 0 1 2-2h13"/><path d="M4 19a2 2 0 0 0 2 2h13V8H6a2 2 0 0 0-2 2"/></svg>
            Lexicon
          </button>
          <button className={"mobile-tab" + (mainView === "search" ? " active" : "")} onClick={() => handleNavChange("search")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
            Search
          </button>
          <button className={"mobile-tab" + (mainView === "notes" ? " active" : "")} onClick={() => handleNavChange("notes")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>
            Notes
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
