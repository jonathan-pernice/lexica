// ============================================================
// LEXICON VIEW
// ============================================================
const _STRONGS_RE = /^[GgHh]?\d+(\.\d+)?$/;

function LexiconView({ onNavigateToSearch, onNavigateToLibrary, onWordClick, pendingStrongs, onPendingStrongsConsumed, isMobile }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState(null);
  const [profile, setProfile] = useState(null);
  const [corpus, setCorpus] = useState("all");          // search-results scope: all | abp | kjv
  const [profileCorpus, setProfileCorpus] = useState("abp"); // drilled-in word view: abp | kjv (never "all")
  const [testament, setTestament] = useState("all");
  const [selectedBook, setSelectedBook] = useState(null);
  const [verseList, setVerseList] = useState(null);
  const [verseLoading, setVerseLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedGloss, setSelectedGloss] = useState(null);
  const [bookGlosses, setBookGlosses] = useState(null);
  const [filteredBooks, setFilteredBooks] = useState(null);
  const [groupings, setGroupings] = useState(null);
  const [pendingGloss, setPendingGloss] = useState(null);
  const [showDef, setShowDef] = useState(false);
  const [lsjEntry, setLsjEntry] = useState(null);
  const [lsjSummary, setLsjSummary] = useState(null);
  const [lsjLoading, setLsjLoading] = useState(false);
  const [lsjSummaryLoading, setLsjSummaryLoading] = useState(false);

  // Reset the curated LSJ definition whenever the focused word changes.
  useEffect(() => { setLsjEntry(null); setLsjSummary(null); }, [profile?.strongs]);

  // Lazily fetch the LSJ entry + AI-curated summary when the Greek definition is
  // opened (Haiku, cached). Hebrew keeps its BDB definition. The /api/lsj endpoint
  // auto-falls back to strongs_def when there's no LSJ match.
  useEffect(() => {
    if (!showDef || !profile || !/^G/i.test(profile.strongs) || lsjEntry || lsjLoading) return;
    let cancelled = false;
    setLsjLoading(true);
    api.lsj(profile.lemma || "", profile.strongs.replace(/^[GH]/i, ""))
      .then(d => {
        if (cancelled) return;
        const entry = d && !d.error ? d : null;
        setLsjEntry(entry);
        setLsjLoading(false);
        if (entry && entry.source !== "strongs") {
          setLsjSummaryLoading(true);
          api.lsjSummary(entry.key)
            .then(s => { if (!cancelled) setLsjSummary(s); })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLsjSummaryLoading(false); });
        }
      })
      .catch(() => { if (!cancelled) { setLsjEntry(null); setLsjLoading(false); } });
    return () => { cancelled = true; };
  }, [showDef, profile?.strongs]);

  useEffect(() => {
    if (!pendingStrongs) return;
    onPendingStrongsConsumed?.();
    setGroupings(null);
    setMatches(null);
    // pendingStrongs may be a bare Strong's or { strongs, corpus } (from an
    // ABP/KJV "occurrences" link) — drill in to the corpus the link named.
    const s = typeof pendingStrongs === "string" ? pendingStrongs : pendingStrongs.strongs;
    const c = typeof pendingStrongs === "string" ? undefined : pendingStrongs.corpus;
    loadProfile(s, c);
  }, [pendingStrongs]);

  const loadProfile = async (strongs, corpusOverride) => {
    setLoading(true);
    setError(null);
    // NOTE: keep `matches`/`groupings` alive so the profile's back button can
    // return to whichever result list we drilled in from. handleSubmit clears
    // both before every new search, so a stale list can't linger.
    setSelectedBook(null);
    setSelectedGloss(null);
    setBookGlosses(null);
    setFilteredBooks(null);
    setShowDef(false);
    const isHeb = /^H/i.test(strongs) || (!(/^[GgHh]/.test(strongs)) && parseInt(strongs) > 5624);
    const c = corpusOverride ?? (isHeb ? "kjv" : "abp");  // drilling in always lands in a single corpus
    setProfileCorpus(c);
    try {
      const data = await api.lexiconProfile(strongs, c);
      if (data.error) setError(data.error);
      else setProfile(data);
    } catch (e) { setError("Failed to load word profile: " + e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (profile && pendingGloss) {
      selectGloss(pendingGloss);
      setPendingGloss(null);
    }
  }, [profile, pendingGloss]);

  // Search-results scope toggle (All / ABP / KJV). Only shown when no word is
  // in focus; re-runs the English search in that corpus.
  const switchCorpus = async (c) => {
    if (loading || c === corpus) return;
    setCorpus(c);
    const q = query.trim();
    const isEnglishQuery = !!q && !_STRONGS_RE.test(q) && !_isGreekHebrew(q);
    if (groupings && isEnglishQuery) {
      setLoading(true);
      try {
        const data = await api.lexiconEnglish(q, c, testament);
        setGroupings(data.length ? data : null);
        setError(data.length ? null : "No matches found.");
      } catch { setError("Search failed."); }
      finally { setLoading(false); }
    }
  };

  // Profile corpus toggle (ABP / KJV). Reloads the focused word in that corpus.
  const switchProfileCorpus = async (c) => {
    if (loading || c === profileCorpus || !profile) return;
    setProfileCorpus(c);
    setLoading(true);
    setSelectedBook(null);
    setVerseList(null);
    setTestament("all");
    setSelectedGloss(null);
    setBookGlosses(null);
    setFilteredBooks(null);
    setShowDef(false);
    try {
      const data = await api.lexiconProfile(profile.strongs, c);
      if (!data.error) setProfile(data);
    } catch {}
    finally { setLoading(false); }
  };

  const switchTestament = async (t) => {
    if (loading) return;
    setTestament(t);
    setSelectedBook(null);
    setVerseList(null);
    // Profile view filters its distribution + count on `testament` client-side.
    if (profile) return;
    // Results view: re-run the English search scoped to the testament.
    const q = query.trim();
    if (groupings && q && !_STRONGS_RE.test(q) && !_isGreekHebrew(q)) {
      setLoading(true);
      try {
        const data = await api.lexiconEnglish(q, corpus, t);
        setGroupings(data.length ? data : null);
        setError(data.length ? null : "No matches found.");
      } catch { setError("Search failed."); }
      finally { setLoading(false); }
    }
  };

  const fetchVerses = async (book, gloss) => {
    setVerseList(null);
    setVerseLoading(true);
    try {
      const data = await api.lexiconVerses(profile.strongs, book, profileCorpus, gloss);
      if (data.error) {
        setVerseList([{ error: data.error }]);
      } else {
        setVerseList(data.verses || []);
        setBookGlosses(data.glosses && data.glosses.length ? data.glosses : null);
      }
    } catch (e) { setVerseList([{ error: String(e) }]); }
    finally { setVerseLoading(false); }
  };

  const selectBook = async (book) => {
    if (selectedBook === book) { setSelectedBook(null); setVerseList(null); setBookGlosses(null); return; }
    setSelectedBook(book);
    await fetchVerses(book, selectedGloss);
  };

  const selectGloss = async (gloss) => {
    const next = selectedGloss === gloss ? null : gloss;
    setSelectedGloss(next);
    if (next) {
      const data = await api.lexiconBooks(profile.strongs, profileCorpus, next);
      setFilteredBooks(data.books && data.books.length ? data.books : null);
    } else {
      setFilteredBooks(null);
    }
    if (selectedBook) await fetchVerses(selectedBook, next);
  };

  const _isGreekHebrew = (s) => /[Ͱ-Ͽἀ-῿֐-׿]/.test(s);

  // One "<Bible> renders this as" line. The active toggle's line is the
  // interactive one (click a rendering to filter the books/verses below); the
  // other Bible's line is shown read-only, just so you can see both at once.
  const renderGlossLine = (lineCorpus, label, list) => {
    if (!list || !list.length) return null;
    const interactive = profileCorpus === lineCorpus;
    return (
      <div className="lexicon-glosses">
        <div className="lexicon-gloss-label">{label}</div>
        <div className="lexicon-dist-list">
          {list.map((g, i) => (
            <React.Fragment key={g.gloss}>
              {i > 0 && <span className="lexicon-dist-sep"> · </span>}
              {interactive ? (
                <button
                  className={"lexicon-dist-item" + (selectedGloss === g.gloss ? " selected" : "")}
                  onClick={() => selectGloss(g.gloss)}
                >
                  {g.gloss}<span className="lexicon-dist-count">{g.count}</span>
                </button>
              ) : (
                <span className="lexicon-dist-item lexicon-dist-item--ref">
                  {g.gloss}<span className="lexicon-dist-count">{g.count}</span>
                </span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  // A result row's rendering preview: an ABP line and a KJV line. The little
  // ABP/KJV tag only shows when a word has both (so single-Bible words / the
  // ABP|KJV filters read clean, untagged). Desktop caps each line at 6 with an
  // ellipsis; mobile shows all and scrolls the line sideways (see styles.css).
  const renderRowPreview = (g) => {
    const abp = g.abp_glosses || [];
    const kjv = g.kjv_glosses || [];
    const both = abp.length > 0 && kjv.length > 0;
    const line = (list, tag) => list.length === 0 ? null : (
      <span className="lex-prev-line" key={tag}>
        {both && <span className="lex-prev-tag">{tag}</span>}
        {(isMobile ? list : list.slice(0, 6)).map(x => x.gloss).join(", ")}
      </span>
    );
    return [line(abp, "ABP"), line(kjv, "KJV")];
  };

  // Light up every form of the focused word's Strong's in the verse list.
  const citedStrongs = useMemo(() => {
    if (!profile?.strongs) return new Set();
    const tag = profile.strongs;
    const base = tag.split(".")[0];
    return new Set([tag, base, base.replace(/^[GH]/i, "")]);
  }, [profile?.strongs]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setProfile(null);
    setMatches(null);
    setGroupings(null);
    setError(null);
    if (_STRONGS_RE.test(q)) {
      const normalized = /^[GgHh]/i.test(q) ? q.toUpperCase() : q;
      loadProfile(normalized);
      return;
    }
    setLoading(true);
    try {
      if (_isGreekHebrew(q)) {
        const data = await api.lexiconLookup(q);
        if (!data.length) setError("No matches found.");
        else if (data.length === 1) loadProfile(data[0].strongs);
        else setMatches(data);
      } else {
        const data = await api.lexiconEnglish(q, corpus, testament);
        if (data.length) { setGroupings(data); }
        else {
          // No English meaning matched — the input may be a Greek/Hebrew word
          // typed in Latin letters (e.g. "pneuma"). Fall back to the lookup,
          // which matches transliterations accent-insensitively.
          const alt = await api.lexiconLookup(q);
          if (!alt.length) setError("No matches found for \"" + q + "\".");
          else if (alt.length === 1) loadProfile(alt[0].strongs);
          else setMatches(alt);
        }
      }
    } catch { setError("Search failed."); }
    finally { setLoading(false); }
  };

  return (
    <div className="lexicon-view">
      <section className="search">
        <div className="search-cell">
          <label className="search-label">
            <span className="search-eyebrow">Word lookup</span>
          </label>
          <form className="search-field" onSubmit={handleSubmit}>
            <Icon.Search className="search-icon"/>
            <input
              className="search-input"
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Greek, Hebrew, English, or Strong's (G4151, H7307)…"
              autoFocus
            />
            <button type="submit" className="search-go" aria-label="Search" disabled={loading}>
              {loading ? <span className="spinner"/> : <Icon.ArrowRight/>}
            </button>
          </form>
        </div>
      </section>

      <div className="lexicon-toolbar">
        <div className="lexicon-corpus-toggle">
          {profile ? (
            /* Drilled into a word: All is N/A (search-only); gray a corpus the
               word isn't in — but ABP stays live for backfilled proper nouns. */
            <>
              <button className="lct-btn" disabled title="Pick ABP or KJV to study this word">All</button>
              <button className={"lct-btn" + (profileCorpus === "abp" ? " on" : "")} disabled={!profile.has_abp} onClick={() => switchProfileCorpus("abp")}>ABP</button>
              <button className={"lct-btn" + (profileCorpus === "kjv" ? " on" : "")} disabled={!profile.has_kjv} onClick={() => switchProfileCorpus("kjv")}>KJV</button>
            </>
          ) : (
            <>
              <button className={"lct-btn" + (corpus === "all" ? " on" : "")} onClick={() => switchCorpus("all")}>All</button>
              <button className={"lct-btn" + (corpus === "abp" ? " on" : "")} onClick={() => switchCorpus("abp")}>ABP</button>
              <button className={"lct-btn" + (corpus === "kjv" ? " on" : "")} onClick={() => switchCorpus("kjv")}>KJV</button>
            </>
          )}
        </div>
        <div className="lexicon-corpus-toggle">
          {["all","ot","nt"].map(t => (
            <button key={t} className={"lct-btn" + (testament === t ? " on" : "")}
              onClick={() => switchTestament(t)}>
              {t === "all" ? "All" : t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="lexicon-error">{error}</p>}

      {matches && !profile && (
        <div className="lexicon-matches">
          {matches.map(m => (
            <button key={m.strongs} className="lexicon-match-row" onClick={() => loadProfile(m.strongs)}>
              <span className="lexicon-match-strongs">{m.strongs}</span>
              <span className="lexicon-match-lemma">{m.lemma}</span>
              <span className="lexicon-match-translit">{m.translit}</span>
              <span className="lexicon-match-gloss">{m.gloss}</span>
            </button>
          ))}
        </div>
      )}


      {groupings && !profile && (
        <div className="lexicon-results">
          <div className="lexicon-dist-label">
            rendered as "{query.trim()}" · {groupings.length} {groupings.length === 1 ? "word" : "words"}
          </div>
          {groupings.map(g => (
            <button key={g.strongs} className="lexicon-result-row"
              onClick={() => loadProfile(g.strongs, corpus === "all" ? undefined : corpus)}>
              <span className="lexicon-match-strongs">{g.strongs}</span>
              {g.lemma && <span className="lexicon-match-lemma" dir={g.strongs[0] === "H" ? "rtl" : undefined}>{g.lemma}</span>}
              {g.translit && <span className="lexicon-match-translit">{g.translit}</span>}
              <span className="lexicon-result-preview">{renderRowPreview(g)}</span>
              <span className="lexicon-result-count">{g.count}</span>
              <span className="lexicon-result-chev">›</span>
            </button>
          ))}
        </div>
      )}

      {profile && (
        <div className="lexicon-profile">
          <div className="lexicon-profile-header">
            {(groupings || matches) && (
              <button className="lexicon-back-btn" title={`Back to "${query.trim()}" results`}
                onClick={() => { setProfile(null); setSelectedBook(null); setVerseList(null); }}>←</button>
            )}
            <span className="lexicon-lemma" dir={profile.strongs[0] === "H" ? "rtl" : undefined}>{profile.lemma}</span>
            <span className="lexicon-translit">{profile.translit}</span>
            <span className="lexicon-strongs-tag">{profile.strongs}</span>
            <span className="lexicon-total">{
              testament === "all"
                ? profile.total
                : (filteredBooks || profile.books)
                    .filter(b => (b.testament || "").toLowerCase() === testament)
                    .reduce((s, b) => s + b.count, 0)
            } occurrences</span>
          </div>
          {(profile.definition || /^G/i.test(profile.strongs)) && (
            <div className="lexicon-def-section">
              <button className="lexicon-def-toggle" onClick={() => setShowDef(v => !v)}>
                Definition
                {showDef && (!/^G/i.test(profile.strongs)
                  ? <span className="lexicon-def-src">BDB</span>
                  : (!lsjLoading && lsjEntry)
                    ? <span className="lexicon-def-src">{lsjEntry.source === "strongs" ? "Strong's" : lsjEntry.source === "abp_ext" ? "ABP" : "LSJ"}</span>
                    : null)}
                {" "}{showDef ? "▲" : "▼"}
              </button>
              {showDef && (
                !/^G/i.test(profile.strongs)
                  ? <p className="lexicon-definition">{profile.definition}</p>     /* Hebrew: BDB */
                  : lsjLoading
                    ? <div className="lsj-def lsj-def--loading">Loading…</div>
                    : !lsjEntry
                      ? <p className="lexicon-definition">{profile.definition}</p>  /* no LSJ: strongs_def */
                      : lsjEntry.source === "strongs"
                        ? <div className="lsj-def" dangerouslySetInnerHTML={{ __html: lsjEntry.def_html }} />
                        : lsjSummaryLoading
                          ? <LsjSummary data={null} loading={true} />
                          : (lsjSummary && lsjSummary.summary)
                            ? <LsjSummary data={lsjSummary} loading={false} />
                            : <div className="lsj-def" dangerouslySetInnerHTML={{ __html: lsjEntry.def_html }} />  /* AI down: raw LSJ */
              )}
            </div>
          )}

          {selectedBook
            ? ((bookGlosses || profile.glosses) && (bookGlosses || profile.glosses).length > 0 && (
                <div className="lexicon-glosses">
                  <div className="lexicon-gloss-label">In this book</div>
                  <div className="lexicon-dist-list">
                    {(bookGlosses || profile.glosses).map((g, i) => (
                      <React.Fragment key={g.gloss}>
                        {i > 0 && <span className="lexicon-dist-sep"> · </span>}
                        <button
                          className={"lexicon-dist-item" + (selectedGloss === g.gloss ? " selected" : "")}
                          onClick={() => selectGloss(g.gloss)}
                        >
                          {g.gloss}<span className="lexicon-dist-count">{g.count}</span>
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))
            : (
                <>
                  {renderGlossLine("abp", "ABP renders this as", profile.abp_glosses)}
                  {renderGlossLine("kjv", "KJV renders this as", profile.kjv_glosses)}
                </>
              )}

          <div className="lexicon-distribution">
            <div className="lexicon-dist-header">
              <div className="lexicon-dist-label">Distribution by book</div>
            </div>
            <div className="lexicon-dist-list">
              {(filteredBooks || profile.books)
                .filter(b => testament === "all" || (b.testament || "").toLowerCase() === testament)
                .map((b, i) => (
                  <React.Fragment key={b.book}>
                    {i > 0 && <span className="lexicon-dist-sep"> · </span>}
                    <button
                      className={"lexicon-dist-item" + (selectedBook === b.book ? " selected" : "")}
                      onClick={() => selectBook(b.book)}
                    >
                      {b.name}<span className="lexicon-dist-count">{b.count}</span>
                    </button>
                  </React.Fragment>
                ))}
            </div>
          </div>

          {selectedBook && (
            <div className="corpus-groups">
              {verseLoading ? (
                <div className="lexicon-verse-loading">Loading…</div>
              ) : (verseList && verseList[0] && verseList[0].error) ? (
                <div className="lexicon-verse-loading" style={{ color: "red" }}>{verseList[0].error}</div>
              ) : (verseList && verseList.length) ? (
                <CorpusGroup
                  label={profile.books.find(b => b.book === selectedBook)?.name || selectedBook}
                  verses={verseList.map(v => ({
                    book: selectedBook,
                    chapter: v.chapter,
                    verse: v.verse,
                    ref: `${selectedBook} ${v.chapter}:${v.verse}`,
                  }))}
                  allResults={[]}
                  onWordClick={onWordClick}
                  onReadInContext={onNavigateToLibrary ? (b, c, vv) => onNavigateToLibrary(b, c, vv, profileCorpus) : undefined}
                  textMode={profileCorpus === "kjv" ? "kjv" : "greek"}
                  primaryStrongs={null}
                  citedStrongs={citedStrongs}
                  kjvCache={{}}
                />
              ) : (
                <div className="lexicon-verse-loading">No verses.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
