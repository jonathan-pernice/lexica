const { useState, useEffect, useMemo, useRef } = React;

// ============================================================
// ICONS
// ============================================================
const I = {
  Chevron: (p) => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m9 6 6 6-6 6"/></svg>),
  Close: (p) => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6 6l12 12M6 18 18 6"/></svg>),
  Arrow: (p) => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12h14M13 6l6 6-6 6"/></svg>),
  Plus: (p) => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><path d="M12 5v14M5 12h14"/></svg>),
  Minus: (p) => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><path d="M5 12h14"/></svg>),
  Pin: (p) => (<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>),
  Books: (p) => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5a2.5 2.5 0 0 0 0 5H20"/><path d="M20 16H6.5"/></svg>),
  Search: (p) => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>),
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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
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
          <a className="hdr-link" href="Bible Word Study.html">Search</a>
          <a className="hdr-link active" href="#">Library</a>
          <a className="hdr-link" href="#">About</a>
        </nav>
      </div>
    </header>
  );
}

// ============================================================
// LEFT NAV — book / chapter navigation
// ============================================================
function NavPanel({ book, chapter, setChapter, onPickBook, query, setQuery, onClose, isOverlay }) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BOOKS;
    return BOOKS.filter((b) => b.name.toLowerCase().includes(q) || b.ab.toLowerCase().includes(q));
  }, [query]);

  // group by testament + division, in array order
  const groups = useMemo(() => {
    const out = [];
    let cur = null;
    for (const b of filtered) {
      const key = b.t + " · " + b.div;
      if (!cur || cur.key !== key) { cur = { key, t: b.t, div: b.div, books: [] }; out.push(cur); }
      cur.books.push(b);
    }
    return out;
  }, [filtered]);

  return (
    <nav className={"nav " + (isOverlay ? "nav-overlay" : "")} aria-label="Books">
      <div className="nav-top">
        <span className="nav-title">Canon</span>
        {isOverlay && <button className="nav-x" onClick={onClose} aria-label="Close"><I.Close/></button>}
      </div>
      <div className="nav-search">
        <I.Search className="nav-search-i"/>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a book" />
      </div>
      <div className="nav-scroll">
        {groups.map((g) => (
          <div className="nav-group" key={g.key}>
            <div className="nav-div">
              <span className="nav-div-t">{g.t}</span>
              <span className="nav-div-n">{g.div}</span>
            </div>
            {g.books.map((b) => {
              const active = b.ab === book.ab;
              return (
                <div key={b.ab}>
                  <button className={"nav-book " + (active ? "on" : "")} onClick={() => onPickBook(b)}>
                    <span className="nav-book-name">{b.name}</span>
                  </button>
                  {active && (
                    <div className="nav-chips">
                      {Array.from({ length: b.ch }, (_, i) => i + 1).map((n) => (
                        <button
                          key={n}
                          className={"ch-chip " + (n === chapter ? "on" : "")}
                          onClick={() => setChapter(n)}
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
// VERSE RENDERER
// ============================================================
function parseVerse(str) {
  const tokens = [];
  const re = /(\[)|(\])|\^(\d+)|\*([^*]+)\*|\{([^}]+)\}/g;
  let last = 0, m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) tokens.push({ t: "text", v: str.slice(last, m.index) });
    if (m[1]) tokens.push({ t: "open" });
    else if (m[2]) tokens.push({ t: "close" });
    else if (m[3]) tokens.push({ t: "ord", n: m[3] });
    else if (m[4]) tokens.push({ t: "it", v: m[4] });
    else if (m[5]) { const p = m[5].split("|"); tokens.push({ t: "word", v: p[0], s: p[1], active: p[2] === "active" }); }
    last = re.lastIndex;
  }
  if (last < str.length) tokens.push({ t: "text", v: str.slice(last) });
  return tokens;
}

function Word({ tok, strongsOn, interlinear, script, activeStrong, onPick }) {
  const lex = WORDS[tok.s];
  const isActive = activeStrong === tok.s;
  const showGreek = script === "greek" && lex && lex.greek;
  const cls = "w" + (strongsOn ? " w-link" : "") + (isActive ? " w-active" : "");
  const handle = () => onPick(tok.s);

  if (interlinear && lex) {
    return (
      <button className={"il " + (isActive ? "il-active" : "")} onClick={handle}>
        <span className="il-gk">{lex.greek}</span>
        <span className="il-tr">{lex.translit}</span>
        <span className="il-en">{tok.v}</span>
      </button>
    );
  }
  return (
    <button className={cls} onClick={handle}>
      {showGreek ? lex.greek : tok.v}
      {strongsOn && tok.s && <sup className="w-s">{tok.s.replace(/^([GH])/, "$1·")}</sup>}
    </button>
  );
}

function Verse({ n, abp, kjv, edition, strongsOn, interlinear, script, activeStrong, onPick }) {
  // KJV / clean prose: render plain text
  if (edition === "kjv") {
    return (
      <p className="verse-line">
        <span className="vn">{n}</span>
        <span className="vt">{kjv}</span>
      </p>
    );
  }
  const tokens = parseVerse(abp);
  return (
    <p className={"verse-line" + (interlinear ? " il-line" : "")}>
      <span className="vn">{n}</span>
      <span className="vt">
        {tokens.map((tk, i) => {
          if (tk.t === "text") return <span key={i}>{tk.v}</span>;
          if (tk.t === "it") return <em key={i} className="sup">{tk.v}</em>;
          if (tk.t === "open") return strongsOn ? <span key={i} className="brk">[</span> : null;
          if (tk.t === "close") return strongsOn ? <span key={i} className="brk">]</span> : null;
          if (tk.t === "ord") return strongsOn ? <sup key={i} className="ord">{tk.n}</sup> : null;
          if (tk.t === "word") return <Word key={i} tok={tk} strongsOn={strongsOn} interlinear={interlinear} script={script} activeStrong={activeStrong} onPick={onPick}/>;
          return null;
        })}
      </span>
    </p>
  );
}

// ============================================================
// READING TOOLBAR
// ============================================================
function Toolbar({ book, chapter, setChapter, edition, setEdition, strongsOn, setStrongsOn, interlinear, setInterlinear, script, setScript, onOpenNav }) {
  return (
    <div className="bar">
      <div className="bar-l">
        <button className="bar-books" onClick={onOpenNav} aria-label="Books"><I.Books/></button>
        <div className="bar-book">{book.name}<I.Chevron/></div>
        <div className="bar-ch">
          <button className="ch-nav" disabled={chapter <= 1} onClick={() => setChapter(chapter - 1)} aria-label="Previous"><I.Chevron style={{ transform: "rotate(180deg)" }}/></button>
          <span className="ch-lbl">Ch <b>{chapter}</b> <span className="ch-of">/ {book.ch}</span></span>
          <button className="ch-nav" disabled={chapter >= book.ch} onClick={() => setChapter(chapter + 1)} aria-label="Next"><I.Chevron/></button>
        </div>
      </div>
      <div className="bar-r">
        <div className="seg">
          {["abp", "kjv", "parallel"].map((e) => (
            <button key={e} className={"seg-b " + (edition === e ? "on" : "")} onClick={() => setEdition(e)}>
              {e === "abp" ? "ABP" : e === "kjv" ? "KJV" : "Parallel"}
            </button>
          ))}
        </div>
        <span className="bar-sep" aria-hidden="true"></span>
        <button className={"toggle " + (strongsOn ? "on" : "")} onClick={() => setStrongsOn(!strongsOn)}>Strong's</button>
        <button className={"toggle " + (interlinear ? "on" : "")} onClick={() => setInterlinear(!interlinear)}>Interlinear</button>
        <span className="bar-sep" aria-hidden="true"></span>
        <div className="seg">
          <button className={"seg-b " + (script === "english" ? "on" : "")} onClick={() => setScript("english")}>English</button>
          <button className={"seg-b " + (script === "greek" ? "on" : "")} onClick={() => setScript("greek")}>Greek</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MINI MAP (stylized placeholder)
// ============================================================
function MiniMap({ place, label }) {
  return (
    <div className="map">
      <div className="map-terrain"></div>
      <div className="map-grid" aria-hidden="true"></div>
      <div className="map-zoom">
        <button aria-label="Zoom in"><I.Plus/></button>
        <button aria-label="Zoom out"><I.Minus/></button>
      </div>
      {place.labels && place.labels.slice(0, 4).map((l, i) => (
        <span key={l} className={"map-lbl map-lbl-" + i}>{l}</span>
      ))}
      <div className="map-pin"><I.Pin/></div>
      <div className="map-callout"><span>{label}</span><I.Close/></div>
    </div>
  );
}

// ============================================================
// DETAIL PANEL
// ============================================================
function Detail({ strong, refLabel, verseText, onClose, isSheet, lsjFull, setLsjFull }) {
  const lex = WORDS[strong];
  if (!lex) return null;
  const isPlace = lex.cat === "place";
  return (
    <aside className={"detail " + (isSheet ? "detail-sheet" : "")} role="dialog" aria-label="Word study">
      {isSheet && <div className="sheet-handle" aria-hidden="true"></div>}
      <div className="detail-head">
        <div className="detail-head-l">
          <span className="morph">{lex.morph}</span>
          <span className="detail-crumb">{refLabel}</span>
        </div>
        <button className="detail-x" onClick={onClose} aria-label="Close"><I.Close/></button>
      </div>

      <div className="detail-body">
        <h2 className="lemma">{lex.en}</h2>
        <div className="lemma-gk">{lex.greek} · <em>{lex.translit}</em></div>

        <div className="sec">
          <div className="sec-head">
            <span className="sec-t">{isPlace ? "Biblical Place" : lex.cat === "person" ? "Biblical Person" : "Lemma"}</span>
            <span className="tag">{lex.tag}</span>
          </div>
          {isPlace ? (
            <MiniMap place={lex.place} label={lex.en}/>
          ) : (
            <div className="fact">
              <div className="fact-row"><span className="fact-k">Type</span><span className="fact-v">{lex.type}</span></div>
              <div className="fact-row"><span className="fact-k">Strong's</span><span className="fact-v mono">{strong}</span></div>
              <div className="fact-row"><span className="fact-k">Occurrences</span><span className="fact-v">{lex.occ}</span></div>
            </div>
          )}
        </div>

        <div className="sec">
          <div className="sec-head">
            <span className="sec-t">Liddell-Scott-Jones <span className="lsj-badge">LSJ</span></span>
            <div className="seg seg-sm">
              <button className={"seg-b " + (!lsjFull ? "on" : "")} onClick={() => setLsjFull(false)}>Definition</button>
              <button className={"seg-b " + (lsjFull ? "on" : "")} onClick={() => setLsjFull(true)}>Full LSJ</button>
            </div>
          </div>
          <p className="lsj-text">{lsjFull ? lex.lsjFull : lex.lsj}</p>
        </div>

        <div className="sec">
          <div className="sec-head"><span className="sec-t">ABP Occurrences</span></div>
          <button className="occ-link">{lex.occ} <I.Arrow/></button>
        </div>

        <div className="sec">
          <div className="sec-head">
            <span className="sec-t">Verse — {refLabel}</span>
            <span className="sec-meta">LXX (ABP English)</span>
          </div>
          <blockquote className="dverse">
            <span className="dverse-n">{refLabel.split(":").pop()}</span>
            {verseText}
          </blockquote>
          <div className="dverse-tools">
            <button className="link-btn">Read in context <I.Arrow/></button>
            <span className="dot">·</span>
            <button className="link-btn">Interlinear</button>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ============================================================
// APP
// ============================================================
function App() {
  const [book, setBook] = useState(AMOS);
  const [chapter, setChapter] = useState(1);
  const [edition, setEdition] = useState("abp");
  const [strongsOn, setStrongsOn] = useState(true);
  const [interlinear, setInterlinear] = useState(false);
  const [script, setScript] = useState("english");
  const [navQuery, setNavQuery] = useState("");
  const [active, setActive] = useState("G1154"); // Damascus preselected
  const [activeRef, setActiveRef] = useState("Amos 1:3");
  const [lsjFull, setLsjFull] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [vw, setVw] = useState(typeof window !== "undefined" ? window.innerWidth : 1400);
  const mainRef = useRef(null);

  useEffect(() => {
    const onR = () => setVw(window.innerWidth);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);

  const isSheet = vw < 860;       // detail becomes bottom sheet
  const navOverlay = vw < 1024;   // nav becomes drawer

  const verses = book.text ? book.text[edition === "parallel" ? "abp" : edition] : [];
  const versesKjv = book.text ? book.text.kjv : [];
  const versesAbp = book.text ? book.text.abp : [];

  const pickWord = (s) => {
    if (!WORDS[s]) return;
    setActive(s);
    setLsjFull(false);
    // build a ref to the verse where the lemma appears (use current chapter)
    const idx = versesAbp.findIndex((v) => v.includes("{" + s + (v.includes("|active") && s === "G1154" ? "|active" : "") ) || v.includes("{" + s + "|"));
    const vIdx = versesAbp.findIndex((v) => v.includes("{" + s + "|"));
    setActiveRef(`${book.name} ${chapter}:${vIdx >= 0 ? vIdx + 1 : 1}`);
  };

  const detailVerseText = useMemo(() => {
    const vIdx = versesAbp.findIndex((v) => v.includes("{" + active + "|"));
    if (vIdx < 0) return versesKjv[2] || "";
    return versesKjv[vIdx] || "";
  }, [active, versesAbp, versesKjv]);

  const hasDetail = !!active;
  const showInlineDetail = hasDetail && !isSheet;

  return (
    <div className="app">
      <Header/>
      <div className={"lib " + (showInlineDetail ? "has-detail" : "") + (navOverlay ? " nav-collapsed" : "")}>
        {/* LEFT NAV */}
        {!navOverlay && (
          <NavPanel book={book} chapter={chapter} setChapter={(n) => { setChapter(n); }} onPickBook={setBook}
            query={navQuery} setQuery={setNavQuery} isOverlay={false}/>
        )}
        {navOverlay && navOpen && (
          <>
            <div className="nav-scrim" onClick={() => setNavOpen(false)}></div>
            <NavPanel book={book} chapter={chapter} setChapter={(n) => { setChapter(n); setNavOpen(false); }} onPickBook={(b) => { setBook(b); }}
              query={navQuery} setQuery={setNavQuery} isOverlay={true} onClose={() => setNavOpen(false)}/>
          </>
        )}

        {/* CENTER TEXT */}
        <main className="reader" ref={mainRef}>
          <Toolbar
            book={book} chapter={chapter} setChapter={setChapter}
            edition={edition} setEdition={setEdition}
            strongsOn={strongsOn} setStrongsOn={setStrongsOn}
            interlinear={interlinear} setInterlinear={setInterlinear}
            script={script} setScript={setScript}
            onOpenNav={() => setNavOpen(true)}
          />
          <div className="reader-scroll">
            <div className="reader-col">
              <h1 className="ch-title">
                {script === "greek" ? "Ἀμώς" : book.name} <span className="ch-title-n">{chapter}</span>
              </h1>

              {edition === "parallel" ? (
                <div className="parallel">
                  <div className="par-col">
                    <div className="par-head">ABP — Apostolic Bible Polyglot</div>
                    {versesAbp.map((v, i) => (
                      <Verse key={i} n={i + 1} abp={v} kjv={versesKjv[i]} edition="abp"
                        strongsOn={strongsOn} interlinear={false} script={script} activeStrong={active} onPick={pickWord}/>
                    ))}
                  </div>
                  <div className="par-rule" aria-hidden="true"></div>
                  <div className="par-col">
                    <div className="par-head">KJV — King James Version</div>
                    {versesKjv.map((v, i) => (
                      <Verse key={i} n={i + 1} abp="" kjv={v} edition="kjv"
                        strongsOn={false} interlinear={false} script="english" activeStrong={active} onPick={pickWord}/>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="chapter">
                  {verses.map((v, i) => (
                    <Verse key={i} n={i + 1}
                      abp={versesAbp[i]} kjv={versesKjv[i]} edition={edition}
                      strongsOn={strongsOn} interlinear={interlinear} script={script}
                      activeStrong={active} onPick={pickWord}/>
                  ))}
                </div>
              )}

              <div className="reader-foot">
                <button className="foot-nav" disabled={chapter <= 1} onClick={() => setChapter(chapter - 1)}>
                  <I.Chevron style={{ transform: "rotate(180deg)" }}/> Chapter {chapter - 1}
                </button>
                <span className="foot-ref">{book.name} {chapter}</span>
                <button className="foot-nav" disabled={chapter >= book.ch} onClick={() => setChapter(chapter + 1)}>
                  Chapter {chapter + 1} <I.Chevron/>
                </button>
              </div>
            </div>
          </div>
        </main>

        {/* RIGHT DETAIL — inline column on desktop */}
        {showInlineDetail && (
          <Detail strong={active} refLabel={activeRef} verseText={detailVerseText}
            onClose={() => setActive(null)} isSheet={false} lsjFull={lsjFull} setLsjFull={setLsjFull}/>
        )}
      </div>

      {/* DETAIL — bottom sheet on mobile */}
      {hasDetail && isSheet && (
        <>
          <div className="sheet-scrim" onClick={() => setActive(null)}></div>
          <Detail strong={active} refLabel={activeRef} verseText={detailVerseText}
            onClose={() => setActive(null)} isSheet={true} lsjFull={lsjFull} setLsjFull={setLsjFull}/>
        </>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
