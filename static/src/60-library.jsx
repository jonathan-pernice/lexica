// ============================================================
// LIBRARY HELPERS
// ============================================================

// Wrap every occurrence of `term` in `text` with a highlight mark (for the
// in-text search result snippets). Case-insensitive; returns React nodes.
function highlightTerm(text, term) {
  if (!text || !term) return text;
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  if (lower.indexOf(t) === -1) return text;
  const parts = [];
  let i = 0, key = 0, pos = lower.indexOf(t, i);
  while (pos !== -1) {
    if (pos > i) parts.push(text.slice(i, pos));
    parts.push(<mark key={key++} className="lib-search-mark">{text.slice(pos, pos + term.length)}</mark>);
    i = pos + term.length;
    pos = lower.indexOf(t, i);
  }
  if (i < text.length) parts.push(text.slice(i));
  return parts;
}

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
  // Trailing punctuation marks a clause boundary in the SOURCE order. After a
  // bracket group is reordered into English order, that punctuation must float
  // to the last word of the reordered group (Greek "were-completed ... earth,"
  // -> English "... earth were-completed,") instead of stranding on "earth".
  const TRAIL = /[.,;:!?·]+$/;
  for (const bid in bracketMap) {
    let trailing = "";
    const cleaned = [];
    for (const w of bracketMap[bid]) {
      const eng = (w.english || "").trim();
      if (eng && eng.replace(TRAIL, "") === "") {        // pure-punctuation token
        trailing += eng;
        continue;
      }
      const m = eng.match(TRAIL);
      if (m) {
        trailing += m[0];
        cleaned.push({ ...w, english: eng.slice(0, eng.length - m[0].length).trimEnd() });
      } else {
        cleaned.push(w);
      }
    }
    cleaned.sort((a, b) => (a.greek_pos ?? 999) - (b.greek_pos ?? 999));
    if (trailing && cleaned.length) {
      // Attach the floated punctuation to the last word that actually has English
      // text. Empty-gloss words (e.g. the σου/αὐτός pronouns folded into a
      // neighboring noun) would otherwise become a standalone "," token, which
      // renders with a stray leading space ("reprove , me") in prose mode.
      let li = cleaned.length - 1;
      while (li > 0 && !((cleaned[li].english || "").trim())) li--;
      cleaned[li] = { ...cleaned[li], english: (cleaned[li].english || "") + trailing };
    }
    bracketMap[bid] = cleaned;
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

// Which sub-word of a split multi-word gloss carries the Strong's number + Greek
// lemma superscript in chip mode. For a CONTENT-word slot (verb/noun/adjective per
// the morph POS) the number belongs to the head content word — english_head, e.g.
// "put" in "you shall put it" — not the leading "you". For a FUNCTION-word slot
// (article/preposition/pronoun/conjunction/particle), and whenever morph is absent,
// it stays on the first non-italic token (prior behavior), which IS the function
// word itself ("of", "the"). Only ever returns a non-italic (visible) token so the
// superscript actually renders. morph schemes: OT CATSS (V./N./A.) + NT Robinson
// (V-/N-/A-) — content words start V/N/A in both.
function strongsAnchorIndex(parts, italicSet, w) {
  const bare = s => s.replace(/[^\w]/g, "").toLowerCase();
  const firstNonItalic = parts.findIndex(word => !italicSet.has(bare(word)));
  // Anchor the Strong's on the gloss's head word whenever it's present — even when
  // the row has no morph. The old morph gate dropped the Strong's onto the FIRST word
  // for null-morph rows ("of the LORD" → shown on "of", not "LORD"); the head is the
  // Strong's-bearing word, so anchoring on it is always at least as good (recovers ~552
  // κύριος/G2962 displays — see scripts/audit_lord_strongs.py ANCHOR-MORPH bucket).
  if (w.english_head) {
    const hb = bare(w.english_head);
    const hi = parts.findIndex(word => bare(word) === hb && !italicSet.has(bare(word)));
    if (hi >= 0) return hi;
  }
  return firstNonItalic;
}

// ============================================================
// LIB NAV PANEL — desktop left sidebar (≥1100px)
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

function LibNavPanel({ books, selBook, setSelBook, selChapter, setSelChapter, isOverlay, onClose, navBookRef, nonCanon, nonCanonList, onPickNonCanon, translation, corpus, pickBible, esvOwner, otherOpen, setOtherOpen, chrono, orderMode, setOrder, chronoPos, onPickPassage }) {
  const [query, setQuery] = useState("");
  const chronoMode = orderMode === "chronological" && chrono && !nonCanon;
  // The era a passage belongs to, so the active passage's era starts expanded.
  const curEraId = chrono && chrono.passages[chronoPos - 1] ? chrono.passages[chronoPos - 1].era : null;
  const [openEras, setOpenEras] = useState(() => new Set(curEraId ? [curEraId] : []));
  const toggleEra = (id) => setOpenEras(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const navActiveRef = useRef(null);   // the active passage button (scroll into view)
  // Keep the active passage's era open and scroll it into view as you step through.
  useEffect(() => {
    if (!chronoMode || !curEraId) return;
    setOpenEras(s => s.has(curEraId) ? s : new Set(s).add(curEraId));
    requestAnimationFrame(() => navActiveRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }, [chronoMode, chronoPos, curEraId]);
  // "Other" menu groups start collapsed (the list is long) — except the group of the
  // text that's currently open, so the active pick stays visible.
  const [openGroups, setOpenGroups] = useState(() => new Set(nonCanon ? [nonCanon.group] : []));
  const toggleGroup = (g) => setOpenGroups(s => {
    const n = new Set(s);
    n.has(g) ? n.delete(g) : n.add(g);
    return n;
  });

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

  // When a non-canonical text is active, the nav shows that text's chapter chips
  // (picking WHICH non-canon text happens via the "Other" menu in the source bar).
  const nonCanonActive = nonCanon ? (
    <div className="nav-group">
      <div className="nav-div">
        <span className="nav-div-t">Other</span>
        <span className="nav-div-n">{nonCanon.name}</span>
      </div>
      <div ref={navBookRef}>
        <button className="nav-book on"><span className="nav-book-name">{nonCanon.name}</span></button>
        <div className="nav-chips">
          {Array.from({ length: nonCanon.chapters }, (_, i) => i + 1).map(n => (
            <button
              key={n}
              className={"ch-chip" + (n === selChapter ? " on" : "")}
              onClick={() => setSelChapter(n)}
            >{n}</button>
          ))}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <nav className={"nav" + (isOverlay ? " nav-overlay" : "")} aria-label="Books">
      <div className="nav-top">
        {isOverlay && <button className="nav-x" onClick={onClose} aria-label="Close">✕</button>}
      </div>
      {/* Text-source picker — ABP / KJV + non-canonical "Other" menu */}
      <div className="nav-source">
        <div className="seg nav-source-seg">
          <button className={"seg-b" + (!nonCanon && translation === "abp" ? " on" : "")} onClick={() => pickBible("abp")}>ABP</button>
          <button className={"seg-b" + (!nonCanon && translation === "kjv" ? " on" : "")} onClick={() => pickBible("kjv")}>KJV</button>
          <button className={"seg-b" + (!nonCanon && translation === "bsb" ? " on" : "")} onClick={() => pickBible("bsb")}>BSB</button>
          {esvOwner && (
            <button className={"seg-b" + (!nonCanon && translation === "esv" ? " on" : "")} onClick={() => pickBible("esv")}>ESV</button>
          )}
          {nonCanonList && nonCanonList.length > 0 && (
            <button className={"seg-b nav-other-seg" + (nonCanon ? " on" : "")} onClick={() => setOtherOpen(o => !o)} aria-expanded={otherOpen}>
              <span className="nav-other-lbl">{nonCanon ? (nonCanon.abbr || nonCanon.name) : "Other"}</span>
              <span className={"nav-other-caret" + (otherOpen ? " open" : "")}>▾</span>
            </button>
          )}
        </div>
      </div>
      {/* Reading-order toggle (Canonical | Chronological) lives in the top toolbar.
          The nav just reflects orderMode: era→passage list when chronological. */}
      {/* "Other" books open INLINE in the panel (pushes the book list down) so the
          menu never floats over the reading text. */}
      {otherOpen && nonCanonList && nonCanonList.length > 0 && (
        <div className="nav-other-inline">
          {nonCanonGroups(nonCanonList).map(grp => {
            const open = openGroups.has(grp.group);
            return (
              <React.Fragment key={grp.group}>
                <button className={"lib-other-head lib-other-head-btn" + (open ? " open" : "")}
                  onClick={() => toggleGroup(grp.group)} aria-expanded={open}>
                  <span className="lib-other-head-caret">▸</span>
                  <span className="lib-other-head-lbl">{grp.group}</span>
                  <span className="lib-other-head-count">{grp.items.length}</span>
                </button>
                {open && grp.items.map(t => (
                  <button key={t.id}
                    className={"lib-other-item" + (nonCanon && nonCanon.id === t.id ? " on" : "")}
                    onClick={() => { onPickNonCanon(t); setOtherOpen(false); if (isOverlay) onClose(); }}>{t.name}</button>
                ))}
              </React.Fragment>
            );
          })}
        </div>
      )}
      <div className="nav-scroll">
        {chronoMode && chrono.eras.map(era => {
          const open = openEras.has(era.id);
          const eraPassages = chrono.passages.filter(p => p.era === era.id);
          return (
            <div className="nav-group" key={era.id}>
              <button className={"nav-era" + (open ? " open" : "")} onClick={() => toggleEra(era.id)}
                aria-expanded={open} title={era.blurb}>
                <span className="nav-era-caret">▸</span>
                <span className="nav-era-name">{era.name}</span>
                <span className="nav-era-count">{eraPassages.length}</span>
              </button>
              {open && (
                <div className="nav-passages">
                  {eraPassages.map(p => {
                    const active = p.pos === chronoPos;
                    return (
                      <button key={p.pos} ref={active ? navActiveRef : null}
                        className={"nav-passage" + (active ? " on" : "")}
                        onClick={() => { onPickPassage(p); if (isOverlay) onClose(); }}>{p.label}</button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {!chronoMode && nonCanon && nonCanonActive}
        {!chronoMode && !nonCanon && groups.map(g => (
          <div className="nav-group" key={g.key}>
            <div className="nav-div">
              <span className="nav-div-t">{g.t}</span>
              <span className="nav-div-n">{g.div}</span>
            </div>
            {g.books.map(b => {
              const active = !nonCanon && selBook && b.abbrev === selBook.abbrev;
              return (
                <div key={b.abbrev} ref={active ? navBookRef : null}>
                  <button
                    className={"nav-book" + (active ? " on" : "")}
                    onClick={() => { setSelBook(b); setSelChapter(1); if (isOverlay) onClose(); }}
                  >
                    <span className="nav-book-name">{b.name}</span>
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
// MOBILE BOOK PICKER — full-screen, two-screen (book grid → chapter grid)
// ============================================================
function MobileBookPicker({ books, selBook, selChapter, nonCanon, nonCanonList, onDone, onClose, chronoOn, chrono, chronoPos, onPickPassage }) {
  // A non-canonical book is identified by its `id`; a Bible book by its `abbrev`.
  const isNC = b => !!(b && b.id);
  // Chronological: the picker shows eras → passages instead of books → chapters.
  const curEraId = chrono && chrono.passages[chronoPos - 1] ? chrono.passages[chronoPos - 1].era : null;
  const [openEras, setOpenEras] = useState(() => new Set(curEraId ? [curEraId] : []));
  const toggleEra = (id) => setOpenEras(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // If a non-canonical text is already open, jump straight to its chapter grid so the
  // reader can change chapter (this is the bug it fixes: the picker used to show only
  // the Bible books, stranding you on whatever Bible book was last selected).
  const [screen, setScreen] = useState(nonCanon ? "chapter" : "book");
  const [pickedBook, setPickedBook] = useState(nonCanon || null);
  // Every section (OT, NT, and each non-canonical group) starts collapsed EXCEPT the
  // one you're currently reading: the testament of the open Bible book, or the active
  // non-canonical text's group.
  const [openGroups, setOpenGroups] = useState(() => new Set([
    nonCanon ? nonCanon.group
             : (selBook && NT_BOOKS.has(selBook.abbrev) ? "NT" : "OT"),
  ]));
  const toggleGroup = (g) => setOpenGroups(s => {
    const n = new Set(s);
    n.has(g) ? n.delete(g) : n.add(g);
    return n;
  });
  // Same swipe-down-to-close + at-top scroll arming as the hero / xref sheets.
  // ONE stable root so the refs survive the book→chapter screen switch.
  const { sheetRef, scrollRef } = useSwipeToDismiss(onClose);

  const otBooks = books.filter(b => !NT_BOOKS.has(b.abbrev));
  const ntBooks = books.filter(b => NT_BOOKS.has(b.abbrev));
  const onChapter = screen === "chapter";
  const isActive = b => isNC(b) ? (nonCanon && nonCanon.id === b.id)
                                : (selBook && b.abbrev === selBook.abbrev);

  return (
    <div className="mpick" ref={sheetRef}>
      <div className="sheet-drag-zone" aria-hidden="true"><div className="sheet-handle"></div></div>
      <div className="mpick-head">
        {!chronoOn && onChapter
          ? <button className="mpick-back" onClick={() => setScreen("book")}>‹ Books</button>
          : <span className="mpick-head-spacer" />}
        <span className="mpick-title">{chronoOn ? "Chronological" : (onChapter ? pickedBook.name : "Books")}</span>
        <button className="mpick-x" onClick={onClose}>✕</button>
      </div>
      <div className="mpick-scroll" ref={scrollRef}>
        {chronoOn ? (
          chrono.eras.map(era => {
            const open = openEras.has(era.id);
            const eraPassages = chrono.passages.filter(p => p.era === era.id);
            return (
              <div key={era.id} className="mpick-section">
                <button className={"mpick-sec-label mpick-sec-btn" + (open ? " open" : "")} onClick={() => toggleEra(era.id)} aria-expanded={open}>
                  <span className="mpick-sec-caret">▸</span>
                  <span className="mpick-sec-name">{era.name}</span>
                  <span className="mpick-sec-count">{eraPassages.length}</span>
                </button>
                {open && (
                  <div className="mpick-passages">
                    {eraPassages.map(p => (
                      <button key={p.pos} className={"mpick-passage" + (p.pos === chronoPos ? " on" : "")} onClick={() => onPickPassage(p)}>{p.label}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : onChapter ? (
          <div className="mpick-grid">
            {Array.from({ length: pickedBook.chapters }, (_, i) => i + 1).map(n => {
              const active = isActive(pickedBook) && n === selChapter;
              return <button key={n} className={"mpick-btn" + (active ? " on" : "")} onClick={() => onDone(pickedBook, n)}>{n}</button>;
            })}
          </div>
        ) : (
          [["OT", otBooks], ["NT", ntBooks]].map(([label, bks]) => {
            const open = openGroups.has(label);
            return (
              <div key={label} className="mpick-section">
                <button className={"mpick-sec-label mpick-sec-btn" + (open ? " open" : "")} onClick={() => toggleGroup(label)} aria-expanded={open}>
                  <span className="mpick-sec-caret">▸</span>
                  <span className="mpick-sec-name">{label}</span>
                  <span className="mpick-sec-count">{bks.length}</span>
                </button>
                {open && (
                  <div className="mpick-grid">
                    {bks.map(b => (
                      <button key={b.abbrev} className={"mpick-btn" + (isActive(b) ? " on" : "")} onClick={() => { setPickedBook(b); setScreen("chapter"); }}>
                        {b.abbrev.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }).concat((nonCanonList || []).length ? nonCanonGroups(nonCanonList).map(grp => {
            const open = openGroups.has(grp.group);
            return (
              <div key={grp.group} className="mpick-section">
                <button className={"mpick-sec-label mpick-sec-btn" + (open ? " open" : "")} onClick={() => toggleGroup(grp.group)} aria-expanded={open}>
                  <span className="mpick-sec-caret">▸</span>
                  <span className="mpick-sec-name">{grp.group}</span>
                  <span className="mpick-sec-count">{grp.items.length}</span>
                </button>
                {open && (
                  <div className="mpick-grid">
                    {grp.items.map(t => (
                      <button key={t.id} className={"mpick-btn mpick-btn-nc" + (isActive(t) ? " on" : "")} onClick={() => { setPickedBook(t); setScreen("chapter"); }}>
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }) : [])
        )}
      </div>
    </div>
  );
}

// ============================================================
// MOBILE READING OPTIONS — bottom sheet (swipe-to-dismiss, scrollable).
// Compacted to three groups: Text · Study layer · Display.
// ============================================================
function ModesSheet({
  corpus, translation, pickBible, esvOwner, toggleParallel, nonCanonList,
  showStrongs, showInterlinear, setOpt, chipMode, libFontSize, changeFontSize, onClose,
  chrono, orderMode, setOrder,
}) {
  const { sheetRef, scrollRef } = useSwipeToDismiss(onClose);
  const activeNonCanon = nonCanonList.find(t => t.id === corpus) || null;
  const proseLocked = !!(activeNonCanon && activeNonCanon.englishOnly) || translation === "bsb" || translation === "esv";   // English-only / BSB / ESV: no Greek toggles
  const gray = proseLocked ? { opacity: 0.35, cursor: "default" } : undefined;
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="msheet" ref={sheetRef}>
        <div className="sheet-drag-zone" aria-hidden="true"><div className="sheet-handle"></div></div>
        <div className="msheet-head">
          <span className="msheet-title">Reading</span>
          <button className="msheet-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="msheet-body" ref={scrollRef}>
          <div className="mode-sec">
            <div className="mode-lbl">Text</div>
            <div className="text-row">
              <div className="mseg text-ed">
                <button className={"mseg-b"+(corpus==="bible"&&translation==="abp"?" on":"")} onClick={()=>pickBible("abp")}>ABP</button>
                <button className={"mseg-b"+(corpus==="bible"&&translation==="kjv"?" on":"")} onClick={()=>pickBible("kjv")}>KJV</button>
                <button className={"mseg-b"+(corpus==="bible"&&translation==="bsb"?" on":"")} onClick={()=>pickBible("bsb")}>BSB</button>
                {esvOwner && (
                  <button className={"mseg-b"+(corpus==="bible"&&translation==="esv"?" on":"")} onClick={()=>pickBible("esv")}>ESV</button>
                )}
              </div>
              {!activeNonCanon && (
                <div className="mseg text-par">
                  <button className={"mseg-b"+(translation==="parallel"?" on":"")} disabled={proseLocked} style={gray} onClick={()=>!proseLocked&&toggleParallel()}>Parallel</button>
                </div>
              )}
            </div>
          </div>
          {chrono && !activeNonCanon && (
            <div className="mode-sec">
              <div className="mode-lbl">Order</div>
              <div className="mseg">
                <button className={"mseg-b"+(orderMode!=="chronological"?" on":"")} onClick={()=>setOrder("canonical")}>Canonical</button>
                <button className={"mseg-b"+(orderMode==="chronological"?" on":"")} onClick={()=>setOrder("chronological")}>Chronological</button>
              </div>
            </div>
          )}
          <div className="mode-sec">
            <div className="mode-lbl">Study layer</div>
            <div className="mtog">
              <div className="mtog-row">
                <div className="mtog-txt">
                  <div className="mtog-name">Strong's numbers</div>
                  <div className="mtog-sub">Tap a word for its lexicon entry</div>
                </div>
                <button className={"switch"+(showStrongs?" on":"")} disabled={proseLocked} style={gray} onClick={()=>!proseLocked&&setOpt("showStrongs",!showStrongs)} aria-label="Toggle Strong's" aria-pressed={showStrongs} />
              </div>
              <div className="mtog-row">
                <div className="mtog-txt">
                  <div className="mtog-name">Interlinear</div>
                  <div className="mtog-sub">Stack Greek, transliteration &amp; gloss</div>
                </div>
                <button className={"switch"+(showInterlinear?" on":"")} disabled={proseLocked} style={gray} onClick={()=>!proseLocked&&setOpt("showInterlinear",!showInterlinear)} aria-label="Toggle Interlinear" aria-pressed={showInterlinear} />
              </div>
            </div>
          </div>
          <div className="mode-sec">
            <div className="mode-lbl">Display</div>
            <div className="display-row">
              <div className="mseg mseg-view">
                <button className={"mseg-b"+(chipMode?" on":"")} disabled={proseLocked} style={gray} title="Chip view" aria-label="Chip view" aria-pressed={chipMode} onClick={()=>!proseLocked&&setOpt("viewMode","chip")}><Icon.Grid/></button>
                <button className={"mseg-b"+(!chipMode?" on":"")} disabled={!proseLocked&&(showStrongs||showInterlinear)} style={!proseLocked&&(showStrongs||showInterlinear)?{opacity:0.35}:undefined} title="Prose view" aria-label="Prose view" aria-pressed={!chipMode} onClick={()=>!showStrongs&&!showInterlinear&&setOpt("viewMode","prose")}><Icon.Lines/></button>
              </div>
              <div className="mseg font-picker">
                <button className="mseg-b" onClick={() => changeFontSize(-1)}>A−</button>
                <span className="font-size-lbl">{libFontSize}</span>
                <button className="mseg-b" onClick={() => changeFontSize(+1)}>A+</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Non-canonical texts — reached via the "Other" pick, walled off from the Bible
// book list, search, and lexicon counts. Each rides its own backend route + tables.
// Add future early-church / apocryphal texts here.
const NONCANON = [
  // abbr = short label for the mobile toolbar pill (standard scholarly short forms).
  // group = section heading in the "Other" menus (kept in array order).
  // englishOnly: no Greek interlinear in our pipeline, so the reader stays in Prose
  // (chip / parallel-Greek views would be blank). Drop the flag once a tagged Greek
  // file is added (e.g. 1 Enoch ch 1–32 from the Akhmim papyrus).
  // Group order = nearness to the canon / era: Septuagint Apocrypha (inside the Greek
  // OT world) -> Pseudepigrapha -> Testaments -> Apostolic Fathers (early Christian).

  // Septuagint Apocrypha — Brenton's 1851 public-domain English LXX (ebible.org USFM),
  // verse-perfect. English-only; the Greek isn't Strong's-tagged so no interlinear.
  { id: "esdras1",    name: "1 Esdras",            abbr: "1Esd",  chapters: 9,  englishOnly: true, group: "Septuagint Apocrypha" },
  { id: "tobit",      name: "Tobit",               abbr: "Tob",   chapters: 14, englishOnly: true, group: "Septuagint Apocrypha" },
  { id: "judith",     name: "Judith",              abbr: "Jdt",   chapters: 16, englishOnly: true, group: "Septuagint Apocrypha" },
  { id: "esther_gk",  name: "Esther (Greek)",      abbr: "EsG",   chapters: 10, englishOnly: true, group: "Septuagint Apocrypha" },
  { id: "maccabees1", name: "1 Maccabees",         abbr: "1Mac",  chapters: 16, englishOnly: true, group: "Septuagint Apocrypha" },
  { id: "maccabees2", name: "2 Maccabees",         abbr: "2Mac",  chapters: 15, englishOnly: true, group: "Septuagint Apocrypha" },
  { id: "maccabees3", name: "3 Maccabees",         abbr: "3Mac",  chapters: 7,  englishOnly: true, group: "Septuagint Apocrypha" },
  { id: "maccabees4", name: "4 Maccabees",         abbr: "4Mac",  chapters: 18, englishOnly: true, group: "Septuagint Apocrypha" },
  { id: "wisdom",     name: "Wisdom of Solomon",   abbr: "Wis",   chapters: 19, englishOnly: true, group: "Septuagint Apocrypha" },
  { id: "sirach",     name: "Sirach",              abbr: "Sir",   chapters: 51, englishOnly: true, group: "Septuagint Apocrypha" },
  { id: "baruch",     name: "Baruch",              abbr: "Bar",   chapters: 5,  englishOnly: true, group: "Septuagint Apocrypha" },
  { id: "epjeremiah", name: "Letter of Jeremiah",  abbr: "EpJer", chapters: 1,  englishOnly: true, group: "Septuagint Apocrypha" },
  { id: "susanna",    name: "Susanna",             abbr: "Sus",   chapters: 1,  englishOnly: true, group: "Septuagint Apocrypha" },
  { id: "bel",        name: "Bel and the Dragon",  abbr: "Bel",   chapters: 1,  englishOnly: true, group: "Septuagint Apocrypha" },
  { id: "manasseh",   name: "Prayer of Manasseh",  abbr: "PrMan", chapters: 1,  englishOnly: true, group: "Septuagint Apocrypha" },

  // Pseudepigrapha — Second Temple Jewish texts (R.H. Charles et al., public domain).
  // 2 Esdras (= 4 Ezra) is the great Jewish apocalypse; not in the Greek LXX, so it sits
  // here rather than with the Septuagint Apocrypha. WEB Apocrypha (public domain) English.
  { id: "esdras2", name: "2 Esdras (4 Ezra)", abbr: "2Esd", chapters: 16, englishOnly: true, group: "Pseudepigrapha" },
  { id: "enoch", name: "1 Enoch", abbr: "1En", chapters: 108, englishOnly: true, group: "Pseudepigrapha" },
  { id: "enoch2", name: "2 Enoch", abbr: "2En", chapters: 68, englishOnly: true, group: "Pseudepigrapha" },
  { id: "jubilees", name: "Jubilees", abbr: "Jub", chapters: 50, englishOnly: true, group: "Pseudepigrapha" },
  { id: "baruch2", name: "2 Baruch", abbr: "2Bar", chapters: 85, englishOnly: true, group: "Pseudepigrapha" },
  // 3 Baruch / Greek Apocalypse of Baruch (Charles APOT, public domain) -- 17 ch + Prologue (ch 0).
  { id: "baruch3", name: "3 Baruch", abbr: "3Bar", chapters: 17, englishOnly: true, group: "Pseudepigrapha" },
  { id: "apocabr", name: "Apocalypse of Abraham", abbr: "ApAb", chapters: 32, englishOnly: true, group: "Pseudepigrapha" },
  // chapter-level only: no freely-reachable copy is versified (see parse_assummoses.py)
  { id: "assummoses", name: "Assumption of Moses", abbr: "AsMos", chapters: 12, englishOnly: true, group: "Pseudepigrapha" },
  // Latin Vita Adae et Evae (Charles APOT, public domain) -- 51 chapters.
  { id: "adameve", name: "Life of Adam and Eve", abbr: "LAE", chapters: 51, englishOnly: true, group: "Pseudepigrapha" },
  // Psalms of Solomon (G.B. Gray, Charles APOT, public domain) -- 18 psalms.
  { id: "psolomon", name: "Psalms of Solomon", abbr: "PsSol", chapters: 18, englishOnly: true, group: "Pseudepigrapha" },
  // Letter of Aristeas (H.T. Andrews, Charles APOT, public domain) -- one letter, cited by
  // section 1-322 (loaded as a single chapter whose verses are the section numbers).
  { id: "aristeas", name: "Letter of Aristeas", abbr: "Arist", chapters: 1, englishOnly: true, group: "Pseudepigrapha" },
  // Ascension of Isaiah (R.H. Charles, public domain) -- Martyrdom (1-5) + Vision (6-11).
  { id: "ascisaiah", name: "Ascension of Isaiah", abbr: "AscIsa", chapters: 11, englishOnly: true, group: "Pseudepigrapha" },
  // Sibylline Oracles (Milton Terry, public domain) -- chapter = book, verse = line. The
  // collection numbers its books 1-8 and 11-14 (chapters 9 & 10 carry a "no such book" note).
  { id: "sibylline", name: "Sibylline Oracles", abbr: "SibOr", chapters: 14, englishOnly: true, group: "Pseudepigrapha" },

  // Testaments of the Twelve Patriarchs (R.H. Charles, APOT) -- twelve short books,
  // each cited on its own (T. Reuben 1:1 ...), so each is a separate entry.
  { id: "treuben",   name: "Testament of Reuben",   abbr: "TReu",  chapters: 7,  englishOnly: true, group: "Testaments (12 Patriarchs)" },
  { id: "tsimeon",   name: "Testament of Simeon",   abbr: "TSim",  chapters: 9,  englishOnly: true, group: "Testaments (12 Patriarchs)" },
  { id: "tlevi",     name: "Testament of Levi",     abbr: "TLevi", chapters: 19, englishOnly: true, group: "Testaments (12 Patriarchs)" },
  { id: "tjudah",    name: "Testament of Judah",    abbr: "TJud",  chapters: 26, englishOnly: true, group: "Testaments (12 Patriarchs)" },
  { id: "tissachar", name: "Testament of Issachar", abbr: "TIss",  chapters: 7,  englishOnly: true, group: "Testaments (12 Patriarchs)" },
  { id: "tzebulun",  name: "Testament of Zebulun",  abbr: "TZeb",  chapters: 10, englishOnly: true, group: "Testaments (12 Patriarchs)" },
  { id: "tdan",      name: "Testament of Dan",      abbr: "TDan",  chapters: 7,  englishOnly: true, group: "Testaments (12 Patriarchs)" },
  { id: "tnaphtali", name: "Testament of Naphtali", abbr: "TNaph", chapters: 9,  englishOnly: true, group: "Testaments (12 Patriarchs)" },
  { id: "tgad",      name: "Testament of Gad",      abbr: "TGad",  chapters: 8,  englishOnly: true, group: "Testaments (12 Patriarchs)" },
  { id: "tasher",    name: "Testament of Asher",    abbr: "TAsh",  chapters: 8,  englishOnly: true, group: "Testaments (12 Patriarchs)" },
  { id: "tjoseph",   name: "Testament of Joseph",   abbr: "TJos",  chapters: 20, englishOnly: true, group: "Testaments (12 Patriarchs)" },
  { id: "tbenjamin", name: "Testament of Benjamin", abbr: "TBen",  chapters: 12, englishOnly: true, group: "Testaments (12 Patriarchs)" },

  // Apostolic Fathers — Greek-tagged interlinear (Brannan/Lake Greek + Lightfoot English).
  // NOT englishOnly: these have the full Greek word-study layer like the Bible text.
  // Traditional reading order. (Polycarp ch 10-14 survive only in Latin -> English
  // shows there, no Greek chips.)
  { id: "clement1",  name: "1 Clement",                      abbr: "1Clem", chapters: 65, group: "Apostolic Fathers" },
  { id: "clement2",  name: "2 Clement",                      abbr: "2Clem", chapters: 20, group: "Apostolic Fathers" },
  { id: "ign_eph",   name: "Ignatius to the Ephesians",      abbr: "IgEph", chapters: 21, group: "Apostolic Fathers" },
  { id: "ign_mag",   name: "Ignatius to the Magnesians",     abbr: "IgMag", chapters: 15, group: "Apostolic Fathers" },
  { id: "ign_tral",  name: "Ignatius to the Trallians",      abbr: "IgTra", chapters: 13, group: "Apostolic Fathers" },
  { id: "ign_rom",   name: "Ignatius to the Romans",         abbr: "IgRom", chapters: 10, group: "Apostolic Fathers" },
  { id: "ign_phld",  name: "Ignatius to the Philadelphians", abbr: "IgPhl", chapters: 11, group: "Apostolic Fathers" },
  { id: "ign_smyrn", name: "Ignatius to the Smyrnaeans",     abbr: "IgSmy", chapters: 13, group: "Apostolic Fathers" },
  { id: "ign_pol",   name: "Ignatius to Polycarp",           abbr: "IgPol", chapters: 8,  group: "Apostolic Fathers" },
  { id: "polycarp",  name: "Polycarp to the Philippians",    abbr: "Pol",   chapters: 14, group: "Apostolic Fathers" },
  { id: "mpolycarp", name: "Martyrdom of Polycarp",          abbr: "MPol",  chapters: 22, group: "Apostolic Fathers" },
  { id: "barnabas",  name: "Epistle of Barnabas",            abbr: "Barn",  chapters: 21, group: "Apostolic Fathers" },
  { id: "didache",   name: "Didache",                        abbr: "Did",   chapters: 16, group: "Apostolic Fathers" },
  { id: "diognetus", name: "Epistle to Diognetus",           abbr: "Diog",  chapters: 12, group: "Apostolic Fathers" },
  { id: "shepherd",  name: "Shepherd of Hermas",             abbr: "Herm",  chapters: 110, group: "Apostolic Fathers" },
];

// Group NONCANON entries by their `group` label, preserving array order, for the
// section-headed "Other" menus (nav source-picker dropdown + mobile sheet).
function nonCanonGroups(list) {
  const out = [];
  let cur = null;
  for (const t of list) {
    const g = t.group || "Other";
    if (!cur || cur.group !== g) { cur = { group: g, items: [] }; out.push(cur); }
    cur.items.push(t);
  }
  return out;
}

// ============================================================
// LIBRARY VIEW
// ============================================================
function LibraryView({ nav, onNavChange, onWordClick, onVerseNumberClick, onOpenNote, onTranslationChange, isMobile, showSummary }) {
  const [books, setBooks] = useState([]);
  const [selBook, setSelBook] = useState(null);
  const [selChapter, setSelChapter] = useState(1);
  const [verses, setVerses] = useState([]);
  const [kjvVerses, setKjvVerses] = useState([]);
  const [bsbVerses, setBsbVerses] = useState([]);
  const [esvVerses, setEsvVerses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [kjvLoading, setKjvLoading] = useState(false);
  const [bsbLoading, setBsbLoading] = useState(false);
  const [esvLoading, setEsvLoading] = useState(false);
  // ESV is the owner's personal text: esvOwner (set by the server) gates the toggle.
  const [esvOwner, setEsvOwner] = useState(false);
  // Chapter audio (BSB = public-domain openbible; ESV = owner-only FCBH), once "Listen" is pressed.
  // audioKey = the "book-chapter" currently loaded (so the right Listen button highlights in chrono,
  // where a passage can span chapters and each chapter is its own file).
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioKey, setAudioKey] = useState(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioCur, setAudioCur] = useState(0);
  const [audioDur, setAudioDur] = useState(0);
  const audioRef = useRef(null);
  const [libOptions, setLibOptions] = useState({
    viewMode: "chip", showStrongs: false, showInterlinear: false,
  });
  const [libFontSize, setLibFontSize] = useState(() => {
    const stored = localStorage.getItem("libFontSize");
    if (stored) return parseInt(stored, 10);
    return isMobile ? 15 : 18;
  });
  const [translation, setTranslation] = useState("abp"); // layout: "abp" | "kjv" | "parallel"
  const [corpus, setCorpus] = useState("bible");          // which text: "bible" | a non-canonical id (e.g. "didache")
  const [didVerses, setDidVerses] = useState([]);
  const [didLoading, setDidLoading] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);   // mobile: overview sheet
  // Chronological reading: the same reader, fed passages in event order. The list
  // is a static file (book + verse range pointers, no Bible text). "canonical" =
  // normal book/chapter order; "chronological" = walk `chrono.passages` in order.
  const [orderMode, setOrderMode] = useState("canonical"); // "canonical" | "chronological"
  const [chrono, setChrono] = useState(null);              // { eras, passages } | null
  const [chronoPos, setChronoPos] = useState(1);           // current passage position (1-based)
  const [chronoData, setChronoData] = useState(null);      // loaded span: { pos, byCh:{ch:{abp,kjv,bsb}} }
  const [chronoLoading, setChronoLoading] = useState(false);
  const nonCanon = NONCANON.find(t => t.id === corpus) || null;
  const chronoOn = orderMode === "chronological" && !nonCanon && !!chrono;
  const curPassage = chronoOn ? (chrono.passages[chronoPos - 1] || null) : null;
  const highlightRef = useRef(null);
  const navBookRef = useRef(null);
  const readingRef = useRef(null);
  // Drag-select-to-note: the floating "Add note" bar + the captured anchor.
  const [noteSel, setNoteSel] = useState(null);   // { rect, anchor } | null
  const justSelectedRef = useRef(false);            // suppress the click that follows a drag
  const [flashMsg, setFlashMsg] = useState("");     // tiny confirmation toast ("Copied", etc.)
  const flashT = useRef(null);
  const flash = (m) => { setFlashMsg(m); clearTimeout(flashT.current); flashT.current = setTimeout(() => setFlashMsg(""), 1600); };
  // The line a verse becomes when sent to the journal: "Genesis 1:8 (ABP) — text".
  // No translation tag for non-canon texts (their book name already says it all).
  const journalLine = (a) => {
    const tag = nonCanon ? "" : (translation === "parallel" ? "ABP/KJV" : (translation || "").toUpperCase());
    return a.refLabel + (tag ? " (" + tag + ")" : "") + " — " + a.snippet;
  };
  useNotesVersion();                                // re-render markers when notes change
  // Who's signed in (re-read every render; setAuth notifies, so login/logout
  // re-renders us). The ESV toggle only ever shows when the server says "owner".
  const authEmail = (() => { try { return (NotesStore.authInfo() || {}).email || null; } catch (e) { return null; } })();
  useEffect(() => {
    let cancelled = false;
    api.esvStatus().then(d => { if (!cancelled) setEsvOwner(!!(d && d.owner)); });
    return () => { cancelled = true; };
  }, [authEmail]);
  // If the owner signs out (or it's revoked) while reading ESV, fall back to ABP
  // so they're never stuck on a now-forbidden text showing blank.
  useEffect(() => {
    if (!esvOwner && translation === "esv") { setTranslation("abp"); onTranslationChange?.("abp"); }
  }, [esvOwner, translation]);

  useEffect(() => {
    if (!nav?.book || !navBookRef.current || nav.book !== selBook?.abbrev) return;
    requestAnimationFrame(() => {
      // "nearest" so an already-visible book button doesn't scroll at all — "start"
      // dragged the whole window down (and pushed the verse off-screen) even when the
      // nav book was right there, e.g. clicking a verse number on a fresh Genesis 1.
      navBookRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [nav?.book, selBook?.abbrev]);

  // When a non-canonical text is opened, its nav group moves to the top — bring it into view.
  useEffect(() => {
    if (!nonCanon || !navBookRef.current) return;
    requestAnimationFrame(() => {
      navBookRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
    });
  }, [nonCanon?.id]);
  const navVisible = !isMobile;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [modesOpen, setModesOpen] = useState(false);
  // In-text search ("find in the text you're reading")
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState(null);   // null = no search run yet
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchScope, setSearchScope] = useState("all");      // "all" | "book" (current book only)
  const [searchTerm, setSearchTerm] = useState("");           // the term actually searched (for highlighting)

  useEffect(() => {
    api.books().then(data => {
      setBooks(data);
      if (data.length) setSelBook(data[0]);
    });
  }, []);

  // Load the chronological passage list once (a small static file). If it fails,
  // chronoOn stays false and the Order toggle simply never appears.
  useEffect(() => {
    api.chronological().then(setChrono).catch(() => {});
  }, []);

  // Where you were reading in canonical order, so flipping back restores it
  // (instead of stranding you on the chronological passage's book/chapter).
  const canonReturnRef = useRef(null);
  // Jump the reader to a chronological passage: select its book and land on its
  // START chapter. (Stage 2 trims to the exact verse window and spans chapters.)
  // No manual verse-clearing here — the chapter loader clears + reloads itself when
  // the book/chapter actually changes; clearing when they DON'T change just blanks
  // the page (e.g. switching to chrono while already on Genesis 1).
  const pickPassage = (p) => {
    if (!p) return;
    const b = books.find(bk => bk.abbrev === p.book);
    if (!b) return;
    setChronoPos(p.pos);
    if (corpus !== "bible") setCorpus("bible");
    setSelBook(b);
    setSelChapter(p.start_ch);
  };
  // Step forward/back through the whole passage list (flows across era edges).
  const stepPassage = (delta) => {
    if (!chrono) return;
    const next = chronoPos + delta;
    if (next < 1 || next > chrono.passages.length) return;
    pickPassage(chrono.passages[next - 1]);
  };
  // Flip reading order. Entering chronological stashes the canonical spot and jumps
  // to the current passage; leaving restores the stashed canonical spot.
  const setOrder = (mode) => {
    if (mode === orderMode) return;
    if (mode === "chronological") {
      canonReturnRef.current = selBook ? { book: selBook, chapter: selChapter } : null;
      setOrderMode("chronological");
      if (chrono) {
        if (corpus !== "bible") setCorpus("bible");
        pickPassage(chrono.passages[chronoPos - 1] || chrono.passages[0]);
      }
    } else {
      setOrderMode("canonical");
      const r = canonReturnRef.current;
      if (r && r.book) {
        if (corpus !== "bible") setCorpus("bible");
        setSelBook(r.book);
        setSelChapter(r.chapter);
      }
    }
  };

  useEffect(() => {
    if (!nav || !nav.book || !books.length) return;
    const b = books.find(b => b.abbrev === nav.book);
    if (b) {
      // Only react to a REAL destination change. The scroll-to-highlight step writes a
      // `scroll: false` self-update back to nav (same book + chapter); without this guard
      // that re-fires the reset below, wiping the just-loaded verses — and since the book
      // and chapter didn't change, the chapter loader never refetches → blank chapter.
      if (corpus === "bible" && selBook?.abbrev === b.abbrev && selChapter === (nav.chapter || 1)) return;
      setCorpus("bible");   // a verse reference is a Bible verse — leave any open non-canonical text
      setOtherOpen(false);  // close the "Other" picker if it was open
      // clear the old chapter's verses so the scroll-to-highlight waits for the NEW
      // chapter (otherwise it can fire on a stale same-numbered verse and burn its flag)
      setVerses([]);
      setKjvVerses([]);
      setBsbVerses([]);
      setSelBook(b);
      setSelChapter(nav.chapter || 1);
      if (nav.translation) { setTranslation(nav.translation); onTranslationChange?.(nav.translation); }
    }
  }, [nav, books]);

  useEffect(() => {
    if (!selBook || nonCanon || chronoOn) return;   // non-canon + chronological load via their own effects below
    let cancelled = false;
    setLoading(true);
    setVerses([]);
    api.chapter(selBook.abbrev, selChapter)
      .then(data => { if (!cancelled) { setVerses(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selBook && selBook.abbrev, selChapter, corpus, chronoOn]);

  // Chronological span loader: fetch every chapter the current passage covers, for
  // the active text(s). One state object keyed by chapter; the render trims each
  // chapter to the passage's verse window and stitches them with chapter markers.
  useEffect(() => {
    if (!chronoOn || !curPassage || !selBook) return;
    let cancelled = false;
    setChronoLoading(true);
    const { book, start_ch, end_ch } = curPassage;
    const chs = [];
    for (let c = start_ch; c <= end_ch; c++) chs.push(c);
    const need = translation === "parallel" ? ["abp", "kjv"] : [translation];
    const fetchChapter = (c) => {
      const jobs = [];
      if (need.includes("abp")) jobs.push(api.chapter(book, c).then(d => ["abp", d]));
      if (need.includes("kjv")) jobs.push(api.kjvChapter(book, c).then(d => ["kjv", d]));
      if (need.includes("bsb")) jobs.push(api.bsbChapter(book, c).then(d => ["bsb", d]));
      if (need.includes("esv")) jobs.push(api.esvChapter(book, c).then(d => ["esv", d]));
      return Promise.all(jobs).then(pairs => [c, Object.fromEntries(pairs)]);
    };
    Promise.all(chs.map(fetchChapter))
      .then(entries => {
        if (cancelled) return;
        setChronoData({ pos: curPassage.pos, byCh: Object.fromEntries(entries) });
        setChronoLoading(false);
      })
      .catch(() => { if (!cancelled) setChronoLoading(false); });
    return () => { cancelled = true; };
  }, [chronoOn, chronoPos, translation, corpus]);

  // Non-canonical text loader (Didache, etc.) — keyed on the active text id + chapter.
  useEffect(() => {
    if (!nonCanon) return;
    let cancelled = false;
    setDidLoading(true);
    setDidVerses([]);
    api.extraChapter(nonCanon.id, selChapter)
      .then(data => { if (!cancelled) { setDidVerses(data); setDidLoading(false); } })
      .catch(() => { if (!cancelled) setDidLoading(false); });
    return () => { cancelled = true; };
  }, [corpus, selChapter]);

  useEffect(() => {
    if (!selBook || nonCanon || chronoOn || (translation !== "kjv" && translation !== "parallel")) return;
    let cancelled = false;
    setKjvLoading(true);
    setKjvVerses([]);
    api.kjvChapter(selBook.abbrev, selChapter)
      .then(data => { if (!cancelled) { setKjvVerses(data); setKjvLoading(false); } })
      .catch(() => { if (!cancelled) setKjvLoading(false); });
    return () => { cancelled = true; };
  }, [selBook && selBook.abbrev, selChapter, translation, corpus, chronoOn]);

  // BSB chapter loader — only when the BSB reading text is active.
  useEffect(() => {
    if (!selBook || nonCanon || chronoOn || translation !== "bsb") return;
    let cancelled = false;
    setBsbLoading(true);
    setBsbVerses([]);
    api.bsbChapter(selBook.abbrev, selChapter)
      .then(data => { if (!cancelled) { setBsbVerses(data); setBsbLoading(false); } })
      .catch(() => { if (!cancelled) setBsbLoading(false); });
    return () => { cancelled = true; };
  }, [selBook && selBook.abbrev, selChapter, translation, corpus, chronoOn]);

  // ESV chapter loader — owner-only reading text. Each fetch carries the login
  // token; the server returns 404 (and api.esvChapter yields []) for non-owners.
  useEffect(() => {
    if (!selBook || nonCanon || chronoOn || translation !== "esv" || !esvOwner) return;
    let cancelled = false;
    setEsvLoading(true);
    setEsvVerses([]);
    api.esvChapter(selBook.abbrev, selChapter)
      .then(data => { if (!cancelled) { setEsvVerses(data); setEsvLoading(false); } })
      .catch(() => { if (!cancelled) setEsvLoading(false); });
    return () => { cancelled = true; };
  }, [selBook && selBook.abbrev, selChapter, translation, corpus, chronoOn, esvOwner]);

  // Reset the chapter audio when the reading changes — the old mp3 is for the
  // previous chapter/passage. Press Listen to fetch the new one. (chronoPos covers
  // moving between chronological passages, which doesn't change selChapter.)
  useEffect(() => {
    setAudioUrl(null); setAudioKey(null); setAudioBusy(false);
    setAudioPlaying(false); setAudioCur(0); setAudioDur(0);
  }, [selBook && selBook.abbrev, selChapter, translation, chronoPos]);
  // New mp3 loaded: start playing (the user already pressed Listen).
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !audioUrl) return;
    a.load();
    a.play().catch(() => {});
  }, [audioUrl]);
  const loadAudio = (book, ch) => {
    if (!book) return;
    setAudioBusy(true);
    const fetchUrl = translation === "esv" ? api.esvAudio : api.bsbAudio;
    fetchUrl(book, ch)
      .then(d => {
        setAudioBusy(false);
        if (d && d.url) { setAudioUrl(d.url); setAudioKey(book + "-" + ch); }
        else flash("No audio for this chapter");
      })
      .catch(() => { setAudioBusy(false); flash("Audio unavailable"); });
  };
  const seekAudio = (e) => {
    const a = audioRef.current; if (!a) return;
    const v = Number(e.target.value);
    a.currentTime = v; setAudioCur(v);
  };

  useEffect(() => {
    if (!nav?.scroll || loading || !verses.length) return;
    // Don't scroll while the requested chapter's verses are still the OLD chapter's —
    // otherwise we scroll to (and burn the scroll flag on) a wrong same-numbered verse.
    if (nav.chapter != null && nav.chapter !== selChapter) return;
    let raf, tries = 0;
    const tryScroll = () => {
      if (highlightRef.current) {
        highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        onNavChange?.({ ...nav, scroll: false });
      } else if (tries++ < 30) {
        raf = requestAnimationFrame(tryScroll); // highlight row not rendered yet — keep waiting
      }
    };
    raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
    // kjvVerses is in the deps so a KJV-mode jump re-runs once the KJV rows render
    // (the highlight ref lives on those rows, which load separately from the ABP set).
  }, [nav?.scroll, nav?.highlight, nav?.chapter, verses, kjvVerses, bsbVerses, loading, selChapter]);

  const maxChap = nonCanon ? nonCanon.chapters : (selBook ? selBook.chapters : 1);

  // Pick a non-canonical text (from the "Other" menu / nav): switch the reader to it and
  // start at chapter 1. Parallel/KJV/BSB have no meaning for a non-canonical text,
  // so any of those falls back to the Greek interlinear (ABP single view).
  const pickNonCanon = (t) => {
    setCorpus(t.id);
    setSelChapter(1);
    setOtherOpen(false);
    if (translation === "kjv" || translation === "bsb" || translation === "esv" || translation === "parallel") { setTranslation("abp"); onTranslationChange?.("abp"); }
  };
  // Picking a Bible book from the nav returns to the Bible text.
  const selectBook = (b) => {
    setSelBook(b);
    setCorpus("bible");
  };
  // ABP / KJV always select a Bible edition — and clicking either while a
  // non-canonical text is open is the quick way back to the Bible.
  const pickBible = (edition) => {
    setCorpus("bible");
    setTranslation(edition);
    onTranslationChange?.(edition);
    if (selBook && selChapter > selBook.chapters) setSelChapter(selBook.chapters);
  };
  // Parallel is its own toggle: on shows two columns (Bible ABP|KJV); off returns
  // to the single view. Bible only — non-canonical texts don't offer Parallel.
  const toggleParallel = () => {
    const next = translation === "parallel" ? "abp" : "parallel";
    setTranslation(next);
    onTranslationChange?.(next);
  };
  // In-text search: which text to search. Bible → the active edition (Parallel
  // searches the English/KJV column); a non-canonical reader → that text's id.
  const readCorpus = corpus === "bible" ? (translation === "parallel" ? "kjv" : translation) : corpus;
  // ESV has no plain-text search route (owner-only reading text), so the reader's
  // in-text find is off for it — every other text supports it.
  const canSearch = !!readCorpus && translation !== "esv";
  const searchName = corpus === "bible" ? readCorpus.toUpperCase() : (nonCanon ? nonCanon.name : "");
  const runTextSearch = () => {
    const q = searchQ.trim();
    if (!q || !readCorpus) return;
    setSearchTerm(q);
    setSearchLoading(true);
    setSearchResults(null);
    const bookFilter = (corpus === "bible" && searchScope === "book") ? (selBook?.abbrev || "") : "";
    api.textSearch(q, readCorpus, "phrase", bookFilter)
      .then(d => { setSearchResults(d.results || []); setSearchLoading(false); })
      .catch(() => { setSearchResults([]); setSearchLoading(false); });
  };
  // Jump to a hit. Bible → the shared nav path (loads chapter, highlights +
  // scrolls). Non-canonical → same text, just switch to that chapter.
  const jumpToResult = (r) => {
    setSearchOpen(false);
    if (corpus === "bible") {
      onNavChange?.({ book: r.book, chapter: r.chapter, highlight: r.verse, scroll: true, translation });
    } else {
      setSelChapter(r.chapter);
    }
  };
  const showStrongs     = libOptions.showStrongs     || false;
  const showInterlinear = libOptions.showInterlinear || false;
  const viewMode        = libOptions.viewMode        || "chip";
  const setOpt = (key, val) => setLibOptions(prev => ({ ...prev, [key]: val }));

  // English-only non-canonical texts (e.g. 1 Enoch) have no Greek, so the reader is
  // locked to Prose and the Greek-only toggles (Strong's / Interlinear / Parallel /
  // Chip) are disabled and grayed out.
  const bsbMode     = translation === "bsb";
  const esvMode     = translation === "esv";
  const proseLocked = !!(nonCanon && nonCanon.englishOnly) || bsbMode || esvMode;
  const chipMode    = !proseLocked && (viewMode === "chip" || showStrongs || showInterlinear);
  const wordMode    = chipMode;
  const kjvWordMode = chipMode;

  const POETRY_BOOKS = new Set(["Psa", "Pro", "Job", "Son", "Lam", "Ecc"]);
  const isPoetry = POETRY_BOOKS.has(selBook?.abbrev);

  // ---- Chronological span assembly --------------------------------------
  // Pull the active text(s) for the current passage out of the loaded span,
  // trim each chapter to the passage's verse window, and tag every verse with
  // its chapter (_ch). The renderers read _ch (defaulting to selChapter), so
  // canonical reading is unchanged — _ch is simply absent there.
  const chronoReady = chronoOn && chronoData && chronoData.pos === chronoPos;
  const flattenSpan = (key) => {
    if (!chronoReady || !curPassage) return [];
    const { start_ch, end_ch, start_v, end_v } = curPassage;
    const out = [];
    for (let c = start_ch; c <= end_ch; c++) {
      const arr = (chronoData.byCh[c] && chronoData.byCh[c][key]) || [];
      const lo = c === start_ch ? start_v : 1;
      const hi = c === end_ch ? end_v : Infinity;
      arr.forEach(v => { if (v.verse >= lo && v.verse <= hi) out.push({ ...v, _ch: c }); });
    }
    return out;
  };
  const abpView = chronoOn ? flattenSpan("abp") : verses;
  const kjvView = chronoOn ? flattenSpan("kjv") : kjvVerses;
  const bsbView = chronoOn ? flattenSpan("bsb") : bsbVerses;
  const esvView = chronoOn ? flattenSpan("esv") : esvVerses;
  // Drop a chapter divider each time _ch changes; a plain map for canonical (no _ch).
  const withMarks = (arr, renderFn) => {
    const out = []; let lastCh = null;
    arr.forEach(v => {
      if (v._ch != null && v._ch !== lastCh) {
        out.push(
          <div key={`cm-${v._ch}`} className="lib-chrono-chapmark">
            <span className="lib-chrono-chapmark-lbl">{selBook ? selBook.name : ""} {v._ch}</span>
            {renderChronoAudio(v._ch)}
          </div>
        );
        lastCh = v._ch;
      }
      out.push(renderFn(v));
    });
    return out;
  };
  const abpShowLoading = chronoOn ? (chronoLoading || !chronoReady) : loading;
  const kjvShowLoading = chronoOn ? (chronoLoading || !chronoReady) : kjvLoading;
  const bsbShowLoading = chronoOn ? (chronoLoading || !chronoReady) : bsbLoading;
  const esvShowLoading = chronoOn ? (chronoLoading || !chronoReady) : esvLoading;
  // Chapter audio (BSB + ESV only). Audio is one file per WHOLE chapter.
  //  - Canonical: a play/pause icon in the toolbar + a progress bar under the toolbar
  //    (desktop AND mobile — same spot).
  //  - Chronological: a play/pause + bar above EACH chapter's verses (renderChronoAudio,
  //    placed at the chapter dividers); play auto-advances to the next chapter on end.
  const audioCapable = bsbMode || esvMode;
  const onToolbarAudio = () => {
    if (!audioCapable) return;
    const a = audioRef.current;
    if (audioUrl && a) { if (a.paused) a.play().catch(() => {}); else a.pause(); return; }
    if (selBook) loadAudio(selBook.abbrev, selChapter);
  };
  // Toggle one specific chapter (used by the inline chrono controls).
  const onChapterAudio = (book, ch) => {
    const a = audioRef.current;
    if (audioKey === (book + "-" + ch) && a) { if (a.paused) a.play().catch(() => {}); else a.pause(); }
    else loadAudio(book, ch);
  };
  const onAudioEnded = () => {
    setAudioPlaying(false);
    if (!chronoOn || !curPassage || !audioKey) return;   // chrono: roll into the next chapter of the passage
    const cur = parseInt(audioKey.split("-")[1], 10);
    if (cur < curPassage.end_ch) loadAudio(curPassage.book, cur + 1);
  };
  // The (invisible) audio element renders once while a chapter is loaded so it can play.
  const audioEl = (audioCapable && audioUrl) ? (
    <audio ref={audioRef} src={audioUrl} preload="metadata"
      onLoadedMetadata={e => setAudioDur(e.target.duration || 0)}
      onTimeUpdate={e => setAudioCur(e.target.currentTime || 0)}
      onPlay={() => setAudioPlaying(true)} onPause={() => setAudioPlaying(false)}
      onEnded={onAudioEnded} />
  ) : null;
  const audioProgress = (
    <input className="lib-audio-bar" type="range" min="0" max={audioDur || 0} step="0.1"
      value={Math.min(audioCur, audioDur || 0)} onChange={seekAudio} aria-label="Audio position" />
  );
  // Under-toolbar slot. Chrono keeps the bar inline per chapter, so here it just mounts
  // the hidden player; canonical shows the progress bar (desktop + mobile alike).
  const audioBar = !audioEl ? null : chronoOn ? audioEl : (
    <div className="lib-audio-bar-row">{audioProgress}{audioEl}</div>
  );
  // Toolbar play/pause — canonical only (chrono uses the inline per-chapter controls).
  const audioBtn = (audioCapable && !chronoOn) ? (
    <button className={"lib-toggle lib-toggle-icon" + (audioPlaying ? " on" : "")}
      disabled={audioBusy}
      title={audioPlaying ? "Pause audio" : "Play chapter audio"}
      aria-label={audioPlaying ? "Pause audio" : "Play chapter audio"} aria-pressed={audioPlaying}
      onClick={onToolbarAudio}>
      {audioPlaying ? <Icon.Pause/> : <Icon.Play/>}
    </button>
  ) : null;
  // Inline control rendered at each chrono chapter divider (above that chapter's verses).
  const renderChronoAudio = (ch) => {
    if (!audioCapable || !curPassage) return null;
    const book = curPassage.book;
    const active = audioKey === (book + "-" + ch);
    return (
      <span className="lib-chrono-audio">
        <button className={"lib-chrono-play" + (active && audioPlaying ? " on" : "")}
          disabled={audioBusy} onClick={() => onChapterAudio(book, ch)}
          aria-label={active && audioPlaying ? "Pause" : "Play chapter"}>
          {active && audioPlaying ? <Icon.Pause/> : <Icon.Play/>}
        </button>
        {active && audioUrl && audioProgress}
      </span>
    );
  };

  const swipeRef = React.useRef(null);
  const tapMovedRef = React.useRef(false);
  const swipeHandlers = isMobile ? {
    onTouchStart: (e) => {
      tapMovedRef.current = false;
      swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    onTouchMove: (e) => {
      if (!swipeRef.current) return;
      const dx = e.touches[0].clientX - swipeRef.current.x;
      const dy = e.touches[0].clientY - swipeRef.current.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) tapMovedRef.current = true;
    },
    // A swipe/scroll that ends over a word must NOT open its panel — only a real tap should.
    onClickCapture: (e) => {
      if (tapMovedRef.current) { e.stopPropagation(); e.preventDefault(); }
    },
    onTouchEnd: (e) => {
      if (!swipeRef.current) return;
      // If the touch produced a text selection (note-making), don't turn the page.
      if (window.getSelection && String(window.getSelection()).trim()) { swipeRef.current = null; return; }
      const dx = e.changedTouches[0].clientX - swipeRef.current.x;
      const dy = e.changedTouches[0].clientY - swipeRef.current.y;
      swipeRef.current = null;
      if (Math.abs(dx) < 50) return;           // too short
      if (Math.abs(dy) > Math.abs(dx) * 0.6) return; // too vertical
      if (chronoOn) {                          // chronological: swipe walks passages
        stepPassage(dx < 0 ? 1 : -1);
      } else if (dx < 0 && selChapter < maxChap) {
        const c = selChapter + 1;
        setSelChapter(c);
        if (!nonCanon) onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null });
      } else if (dx > 0 && selChapter > 1) {
        const c = selChapter - 1;
        setSelChapter(c);
        if (!nonCanon) onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null });
      }
    },
  } : {};

  // --- Drag-select → note ---------------------------------------------------
  // Walk up from a selection edge to the nearest tagged verse row / word span.
  const _attrUp = (node, attr) => {
    let el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    while (el && el !== readingRef.current && !(el.getAttribute && el.hasAttribute(attr))) el = el.parentElement;
    return el && el.getAttribute ? el.getAttribute(attr) : null;
  };
  const resolveSelection = () => {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { setNoteSel(null); return; }
    const text = sel.toString().trim();
    if (!text) { setNoteSel(null); return; }
    const range = sel.getRangeAt(0);
    if (!readingRef.current || !readingRef.current.contains(range.commonAncestorContainer)) { setNoteSel(null); return; }
    const aV = _attrUp(range.startContainer, "data-note-verse");
    const bV = _attrUp(range.endContainer, "data-note-verse");
    if (aV == null && bV == null) { setNoteSel(null); return; }
    let startV = parseInt(aV != null ? aV : bV, 10);
    let endV = parseInt(bV != null ? bV : aV, 10);
    const aP = _attrUp(range.startContainer, "data-note-pos");
    const bP = _attrUp(range.endContainer, "data-note-pos");
    let startP = aP != null ? parseInt(aP, 10) : null;
    let endP = bP != null ? parseInt(bP, 10) : null;
    if (startV > endV || (startV === endV && (startP || 0) > (endP || 0))) {
      [startV, endV] = [endV, startV];
      [startP, endP] = [endP, startP];
    }
    const bookId = nonCanon ? nonCanon.id : (selBook ? selBook.abbrev : null);
    const bookName = nonCanon ? nonCanon.name : (selBook ? selBook.name : "");
    if (!bookId) { setNoteSel(null); return; }
    // The chapter the selection sits in — from the row (chronological spans several
    // chapters), falling back to the single canonical chapter.
    const selCh = parseInt(_attrUp(range.startContainer, "data-note-chapter") || selChapter, 10);
    const refLabel = bookName + " " + selCh + ":" + startV + (endV !== startV ? "–" + endV : "");
    // In chip mode each word is its own chip with no space characters between
    // them, so the raw selected text runs together ("Inthebeginning"). Rebuild
    // the snippet from the visible English of the touched word chips instead;
    // that also drops the verse number. Prose/BSB keep real spaces, so fall back.
    let snippet = text;
    if (sel.containsNode) {
      const parts = [];
      readingRef.current.querySelectorAll(".lib-word, .lib-kjv-word").forEach(el => {
        if (sel.containsNode(el, true)) {
          const eng = el.querySelector(".lib-iw-english");
          const t = (eng ? eng.textContent : el.textContent).trim();
          if (t) parts.push(t);
        }
      });
      if (parts.length) snippet = parts.join(" ");
    }
    const r = range.getBoundingClientRect();
    justSelectedRef.current = true;
    setNoteSel({
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      anchor: {
        corpus, translation,
        book: bookId, bookName, chapter: selCh,
        start: { verse: startV, pos: startP },
        end: { verse: endV, pos: endP },
        snippet: snippet.slice(0, 300), refLabel,
      },
    });
  };
  const addNoteFromSelection = () => {
    if (!noteSel) return;
    // Reuse a note already on this exact text instead of making a duplicate.
    const existing = NotesStore.findAnchor(noteSel.anchor);
    const note = existing || NotesStore.create(noteSel.anchor);
    setNoteSel(null);
    if (window.getSelection) window.getSelection().removeAllRanges();   // dismiss the OS selection toolbar
    onOpenNote && onOpenNote(note.id);
  };
  // A color swatch in the popover → make a highlight (no editor; the paint is it).
  // If this exact text already has a record, just recolor it.
  const addHighlightFromSelection = (color) => {
    if (!noteSel) return;
    const existing = NotesStore.findAnchor(noteSel.anchor);
    if (existing) NotesStore.update(existing.id, { color });
    else NotesStore.create({ ...noteSel.anchor, color });
    setNoteSel(null);
    if (window.getSelection) window.getSelection().removeAllRanges();
  };
  // Copy the selected verse text to the clipboard (also clears the OS bar on mobile).
  const copySelection = () => {
    if (!noteSel) return;
    const txt = noteSel.anchor.snippet || "";
    try { if (navigator.clipboard) navigator.clipboard.writeText(txt); } catch (e) {}
    setNoteSel(null);
    if (window.getSelection) window.getSelection().removeAllRanges();
    flash("Copied");
  };
  // Drop "reference — verse text" into the journal page currently open in the Notes tab.
  const journalFromSelection = () => {
    if (!noteSel) return;
    const id = NotesStore.getActiveJournal();
    const a = noteSel.anchor;
    setNoteSel(null);
    if (window.getSelection) window.getSelection().removeAllRanges();
    if (!id) { flash("Open a journal page first"); return; }
    NotesStore.appendToJournal(id, journalLine(a));
    flash("Added to journal");
  };
  // Mobile: the browser owns the touch-select gesture, so our touch handlers may
  // not fire. Watch for a settled selection and show the bottom "Add note" bar.
  const resolveRef = useRef(resolveSelection);
  resolveRef.current = resolveSelection;
  useEffect(() => {
    if (!isMobile) return;
    let t;
    const onSel = () => { clearTimeout(t); t = setTimeout(() => resolveRef.current(), 200); };
    document.addEventListener("selectionchange", onSel);
    return () => { document.removeEventListener("selectionchange", onSel); clearTimeout(t); };
  }, [isMobile]);
  // One handler set on the reading area: swipe (mobile) + selection (all).
  const readingHandlers = {
    ...swipeHandlers,
    // A fresh press starts a new interaction: drop any open popover + the suppress flag.
    onMouseDown: () => { if (noteSel) setNoteSel(null); justSelectedRef.current = false; },
    onMouseUp: () => resolveSelection(),
    onTouchEnd: (e) => {
      if (swipeHandlers.onTouchEnd) swipeHandlers.onTouchEnd(e);
      setTimeout(resolveSelection, 0);   // let the browser settle the selection first
    },
    onClickCapture: (e) => {
      if (justSelectedRef.current) { justSelectedRef.current = false; e.stopPropagation(); e.preventDefault(); return; }
      if (swipeHandlers.onClickCapture) swipeHandlers.onClickCapture(e);
    },
  };

  // Notes/highlights are looked up per chapter. Canonical reading is one chapter
  // (ch defaults to selChapter); chronological spans several, so every note helper
  // takes the verse's chapter. A small per-render cache avoids re-querying the
  // store for each verse in a chapter.
  const noteBookId = nonCanon ? nonCanon.id : (selBook ? selBook.abbrev : null);
  const _chNoteCache = {};
  const chapterNotesFor = (ch) => {
    if (!(ch in _chNoteCache)) _chNoteCache[ch] = NotesStore.forChapter(corpus, noteBookId, ch);
    return _chNoteCache[ch];
  };
  const noteForVerse = (verse, ch = selChapter) =>
    chapterNotesFor(ch).find(n => verse >= n.start.verse && verse <= ((n.end && n.end.verse) || n.start.verse));
  // Highlight paint: the color (if any) for a given word. Highlights show in
  // EVERY translation (verses always line up). In the text where the highlight
  // was made we paint the exact words; in a DIFFERENT translation we can't line
  // up word-for-word, so a partial highlight rounds up to the whole verse.
  const hiForWord = (verse, pos, ch = selChapter) => {
    for (const n of chapterNotesFor(ch)) {
      if (!n.color) continue;
      const sv = n.start.verse, ev = (n.end && n.end.verse) || sv;
      if (verse < sv || verse > ev) continue;
      const sameText = !n.translation || !translation || n.translation === translation;
      const sp = n.start.pos, ep = n.end ? n.end.pos : null;
      if (!sameText || sp == null || pos == null) return n.color;   // whole-verse paint
      if (verse === sv && pos < sp) continue;
      if (verse === ev && ep != null && pos > ep) continue;
      return n.color;
    }
    return null;
  };
  const hiClass = (verse, pos, ch = selChapter) => { const c = hiForWord(verse, pos, ch); return c ? " lib-hi lib-hi-" + c : ""; };
  const noteMarker = (verse, ch = selChapter) => {
    const n = noteForVerse(verse, ch);
    if (!n) return null;
    return (
      <button className="lib-note-dot" title="Open note" aria-label="Open note"
        onClick={(e) => { e.stopPropagation(); onOpenNote && onOpenNote(n.id); }}>
        <Icon.Bookmark/>
      </button>
    );
  };
  // Build the whole-verse anchor (incl. a readable snippet) for a verse number.
  const verseAnchor = (verse, fromEl, ch = selChapter) => {
    const bookId = nonCanon ? nonCanon.id : (selBook ? selBook.abbrev : null);
    const bookName = nonCanon ? nonCanon.name : (selBook ? selBook.name : "");
    if (!bookId) return null;
    // Snippet = the verse's words. Chip rows pack words with no spaces, so pull
    // the visible English of each chip; otherwise read the verse text (works for
    // both the verse-row layout and the running-prose flow span, after dropping
    // the verse number + note marker).
    let snippet = "";
    const row = fromEl && fromEl.closest("[data-note-verse]");
    if (row) {
      const chips = row.querySelectorAll(".lib-word, .lib-kjv-word");
      if (chips.length) {
        const parts = [];
        chips.forEach(el => { const eng = el.querySelector(".lib-iw-english"); const t = (eng ? eng.textContent : el.textContent).trim(); if (t) parts.push(t); });
        snippet = parts.join(" ");
      } else {
        const clone = row.cloneNode(true);
        clone.querySelectorAll(".lib-vnum, .lib-flow-vnum, .lib-note-dot").forEach(el => el.remove());
        snippet = (clone.textContent || "").trim();
      }
    }
    return {
      corpus, translation, book: bookId, bookName, chapter: ch,
      start: { verse, pos: null }, end: { verse, pos: null },
      snippet: snippet.slice(0, 300), refLabel: bookName + " " + ch + ":" + verse,
    };
  };
  // Right-click / long-press a verse number opens a small menu (Bookmark · Note ·
  // colors). Left-click / tap stays cross-references.
  const [verseMenu, setVerseMenu] = useState(null);   // { rect, verse, el } | null
  const openVerseMenu = (verse, el, ch = selChapter) => {
    const r = el.getBoundingClientRect();
    setVerseMenu({ rect: { top: r.top, left: r.left, width: r.width, height: r.height }, verse, el, ch });
  };
  const vmBookmark = () => {
    const a = verseAnchor(verseMenu.verse, verseMenu.el, verseMenu.ch); if (!a) return setVerseMenu(null);
    const ex = NotesStore.findAnchor(a);
    if (ex) NotesStore.update(ex.id, { bookmark: true }); else NotesStore.create({ ...a, bookmark: true });
    setVerseMenu(null);
  };
  const vmNote = () => {
    const a = verseAnchor(verseMenu.verse, verseMenu.el, verseMenu.ch); if (!a) return setVerseMenu(null);
    const ex = NotesStore.findAnchor(a);
    const note = ex || NotesStore.create(a);
    setVerseMenu(null);
    onOpenNote && onOpenNote(note.id);
  };
  const vmColor = (color) => {
    const a = verseAnchor(verseMenu.verse, verseMenu.el, verseMenu.ch); if (!a) return setVerseMenu(null);
    const ex = NotesStore.findAnchor(a);
    if (ex) NotesStore.update(ex.id, { color }); else NotesStore.create({ ...a, color });
    setVerseMenu(null);
  };
  // Copy the whole verse text to the clipboard.
  const vmCopy = () => {
    const a = verseAnchor(verseMenu.verse, verseMenu.el, verseMenu.ch); if (!a) return setVerseMenu(null);
    setVerseMenu(null);
    try { if (navigator.clipboard) navigator.clipboard.writeText(a.snippet || ""); } catch (e) {}
    flash("Copied");
  };
  // Send the whole verse to the journal page currently open in the Notes tab.
  const vmJournal = () => {
    const a = verseAnchor(verseMenu.verse, verseMenu.el, verseMenu.ch); if (!a) return setVerseMenu(null);
    setVerseMenu(null);
    const id = NotesStore.getActiveJournal();
    if (!id) { flash("Open a journal page first"); return; }
    NotesStore.appendToJournal(id, journalLine(a));
    flash("Added to journal");
  };
  // Shared press handlers for a verse number: right-click + mobile long-press.
  const vnumPressRef = useRef({ timer: null, fired: false });
  const vnumNoteHandlers = (verse, ch = selChapter) => ({
    onContextMenu: (e) => { e.preventDefault(); openVerseMenu(verse, e.currentTarget, ch); },
    onTouchStart: (e) => {
      const el = e.currentTarget;
      const st = vnumPressRef.current;
      st.fired = false;
      clearTimeout(st.timer);
      st.timer = setTimeout(() => {
        st.fired = true;
        openVerseMenu(verse, el, ch);
        if (navigator.vibrate) navigator.vibrate(12);
      }, 500);
    },
    onTouchMove: () => clearTimeout(vnumPressRef.current.timer),
    onTouchEnd: () => clearTimeout(vnumPressRef.current.timer),
  });

  const changeFontSize = (delta) => {
    setLibFontSize(prev => {
      const next = Math.min(24, Math.max(13, prev + delta));
      localStorage.setItem("libFontSize", String(next));
      return next;
    });
  };

  const handleVerseNum = onVerseNumberClick && selBook
    ? (verse, ch = selChapter) => onVerseNumberClick(selBook.abbrev, ch, verse, translation)
    : null;

  const vnumEl = (verse, ch = selChapter) => (
    <span
      className={"lib-vnum" + (handleVerseNum ? " lib-vnum-click" : "") + (showInterlinear ? " lib-vnum-il" : "")}
      title={handleVerseNum ? "Click: cross-references · Right-click / long-press: add a note" : undefined}
      onClick={handleVerseNum ? () => {
        if (vnumPressRef.current.fired) { vnumPressRef.current.fired = false; return; }
        handleVerseNum(verse, ch);
      } : undefined}
      {...vnumNoteHandlers(verse, ch)}
    >{verse}</span>
  );

  // Verse number for non-canonical texts: opens the note menu on right-click /
  // long-press, but no cross-references (those texts have none). Left-click is a no-op
  // (just swallows the click that follows a long-press).
  const noteVnum = (verse, cls = "lib-vnum") => (
    <span className={cls + " lib-vnum-click"}
      title="Right-click / long-press: add a note"
      onClick={() => { if (vnumPressRef.current.fired) vnumPressRef.current.fired = false; }}
      {...vnumNoteHandlers(verse)}>{verse}</span>
  );

  const joinProse = (words) => {
    const tokens = words.map(w => w.english).filter(Boolean);
    return tokens.reduce((acc, tok, i) => {
      if (i === 0) return tok;
      return /^[.,;:?!—)]/.test(tok) ? acc + tok : acc + " " + tok;
    }, "");
  };

  const renderProseWords = (v) => {
    const ch = v._ch ?? selChapter;
    const englishWords = getEnglishOrderWords(v.words);
    return englishWords.map((w, i) => {
      const text = w.english || "";
      if (!text) return null;
      const hc = hiClass(v.verse, w.position, ch);   // highlight paint for this word
      const isPunct = /^[.,;:?!—)]/.test(text);
      if (isPunct) return <span key={i} data-note-pos={w.position} className={hc || undefined}>{text}</span>;
      if (text.includes(' ')) {
        if (w.italic_words) {
          const iset = new Set(w.italic_words.split(','));
          return (
            <span key={i} data-note-pos={w.position} className={hc || undefined}>
              {text.split(' ').filter(Boolean).map((word, pi) => {
                const bare = word.replace(/[^\w]/g,'').toLowerCase();
                return <span key={pi} className={iset.has(bare) ? "lib-prose-italic" : undefined}>{word}{" "}</span>;
              })}
            </span>
          );
        }
        if (w.italic) {
          const headBare = w.english_head ? w.english_head.replace(/[^\w]/g,'').toLowerCase() : null;
          return (
            <span key={i} data-note-pos={w.position} className={hc || undefined}>
              {text.split(' ').filter(Boolean).map((word, pi) => {
                const bare = word.replace(/[^\w]/g,'').toLowerCase();
                const isItalic = !headBare || bare === headBare;
                return <span key={pi} className={isItalic ? "lib-prose-italic" : undefined}>{word}{" "}</span>;
              })}
            </span>
          );
        }
        return <span key={i} data-note-pos={w.position} className={hc || undefined}>{text + " "}</span>;
      }
      return <span key={i} data-note-pos={w.position} className={(!!w.italic ? "lib-prose-italic" : "") + hc}>{text + " "}</span>;
    });
  };

  const renderVerse = (v, skipHeading = false) => {
    const ch = v._ch ?? selChapter;   // chronological rides the chapter on the verse
    const isHighlight = nav && nav.highlight === v.verse && (nav.chapter == null || nav.chapter === ch);

    const makeEntry = (w) => ({
      id: `lib-${selBook.abbrev}-${ch}-${v.verse}-${w.position}`,
      ...wordEntryCore(w, { ref: `${selBook.abbrev} ${ch}:${v.verse}`, book: selBook.abbrev, chapter: ch, verse: v.verse, gloss: w.english }),
      morph: w.morph || "",
      pn_type: w.pn_type || null,
      pn_types: w.pn_types || null,
    });

    const chipLabel = (w) => {
      return (w.english_head && w.english?.includes(' ')) ? w.english_head : (w.english || w.english_head || "");
    };

    // Plain chip (English mode or non-bracketed word in Greek mode)
    const chip = (w, key) => {
      const isPN = !!(w.is_pn || w.strongs_base === "*");
      const clickable = !!(onWordClick && w.strongs_base && (w.strongs_base !== "*" || w.english || w.english_head) && (w.english || w.english_head));

      // Split multi-word gloss: mute italic sub-words, style smcap sub-words, chip the rest
      if (w.italic_words && w.english && w.english.includes(' ')) {
        const italicSet = new Set(w.italic_words.split(','));
        const smcapSet  = w.smcap_words ? new Set(w.smcap_words.split(',')) : new Set();
        const parts = w.english.split(' ');
        const hc = hiClass(v.verse, w.position, ch);
        return (
          <React.Fragment key={key}>
            {(() => {
              const anchorIdx = strongsAnchorIndex(parts, italicSet, w);
              return parts.map((word, pi) => {
                const bare = word.replace(/[^\w]/g, '').toLowerCase();
                if (italicSet.has(bare)) {
                  return <span key={`${key}-p${pi}`} className={"lib-word lib-abp-italic" + (smcapSet.has(bare) ? " lib-smcap" : "") + hc}>
                    {showInterlinear && <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>}
                    <span className="lib-iw-english">{word}</span>
                    {showStrongs && <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>}
                  </span>;
                }
                const isSmcap = smcapSet.has(bare);
                return (
                  <span key={`${key}-p${pi}`}
                    className={"lib-word" + (isSmcap ? " lib-smcap" : "") + (clickable ? " lib-word-clickable" : "") + (isPN ? " lib-word-pn" : "") + hc}
                    onClick={clickable ? () => onWordClick(isPN ? { ...makeEntry(w), isPN: true, pnName: w.english || w.english_head } : makeEntry(w)) : undefined}>
                    {showInterlinear && (pi === anchorIdx && w.lemma
                      ? <span className="lib-iw-greek">{w.lemma}</span>
                      : <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>)}
                    <span className="lib-iw-english">{word}</span>
                    {showStrongs && (pi === anchorIdx && w.strongs_base && w.strongs_base !== "*"
                      ? <span className="lib-iw-strongs">{(w.strongs && w.strongs !== '*') ? 'G' + w.strongs : w.strongs_base}</span>
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
        <span key={key} data-note-pos={w.position}
          className={"lib-word" + (w.italic ? " lib-abp-italic" : "") + (isSmcap ? " lib-smcap" : "") + (clickable ? " lib-word-clickable" : "") + (isPN ? " lib-word-pn" : "") + hiClass(v.verse, w.position, ch)}
          onClick={clickable ? () => onWordClick(isPN ? { ...makeEntry(w), isPN: true, pnName: label, gloss: label } : makeEntry(w)) : undefined}>
          {showInterlinear && (w.lemma ? <span className="lib-iw-greek">{w.lemma}</span> : <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>)}
          <span className="lib-iw-english">{label}</span>
          {showStrongs && (
            w.strongs_base && w.strongs_base !== "*"
              ? <span className="lib-iw-strongs">{(w.strongs && w.strongs !== '*') ? 'G' + w.strongs : w.strongs_base}</span>
              : <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>
          )}
        </span>
      );
    };

    // Bracket chip (bracketed word in Greek mode — shows inline position number)
    const bracketChip = (w, key) => {
      const isPN = !!(w.is_pn || w.strongs_base === "*");
      const clickable = !!(onWordClick && w.strongs_base && (w.strongs_base !== "*" || w.english));

      // Split multi-word gloss within a bracket word
      if (w.italic_words && w.english && w.english.includes(' ')) {
        const italicSet = new Set(w.italic_words.split(','));
        const smcapSet  = w.smcap_words ? new Set(w.smcap_words.split(',')) : new Set();
        const parts = w.english.split(' ');
        const anchorIdx = strongsAnchorIndex(parts, italicSet, w);
        const hc = hiClass(v.verse, w.position, ch);
        return (
          <React.Fragment key={key}>
            {parts.map((word, pi) => {
              const bare = word.replace(/[^\w]/g, '').toLowerCase();
              if (italicSet.has(bare)) {
                return <span key={`${key}-p${pi}`} className={"lib-word lib-word-bracketed lib-abp-italic" + (smcapSet.has(bare) ? " lib-smcap" : "") + hc}>
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
                  className={"lib-word lib-word-bracketed" + (isSmcap ? " lib-smcap" : "") + (clickable ? " lib-word-clickable" : "") + (isPN ? " lib-word-pn" : "") + hc}
                  onClick={clickable ? () => onWordClick(isPN ? { ...makeEntry(w), isPN: true, pnName: w.english || w.english_head } : makeEntry(w)) : undefined}>
                  {showInterlinear && (pi === anchorIdx && w.lemma
                    ? <span className="lib-iw-greek">{w.lemma}</span>
                    : <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>)}
                  <span className="lib-iw-pos-english">
                    {pi === 0 && w.greek_pos !== null && w.greek_pos !== undefined &&
                      <span className="lib-iw-pos">{w.greek_pos}</span>}
                    <span className="lib-iw-english">{word}</span>
                  </span>
                  {showStrongs && (pi === anchorIdx && w.strongs_base && w.strongs_base !== "*"
                    ? <span className="lib-iw-strongs">{(w.strongs && w.strongs !== '*') ? 'G' + w.strongs : w.strongs_base}</span>
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
        <span key={key} data-note-pos={w.position}
          className={"lib-word lib-word-bracketed" + (w.italic ? " lib-abp-italic" : "") + (isSmcap ? " lib-smcap" : "") + (clickable ? " lib-word-clickable" : "") + (isPN ? " lib-word-pn" : "") + hiClass(v.verse, w.position, ch)}
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
              ? <span className="lib-iw-strongs">{(w.strongs && w.strongs !== '*') ? 'G' + w.strongs : w.strongs_base}</span>
              : <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>
          )}
        </span>
      );
    };

    if (!wordMode) {
      return (
        <React.Fragment key={`${ch}-${v.verse}`}>
          {!skipHeading && v.heading && <div className="lib-verse-row pericope-row"><span className="lib-vnum" aria-hidden="true"/><div className="pericope-heading">{v.heading}</div></div>}
          <div ref={isHighlight ? highlightRef : null} data-note-verse={v.verse} data-note-chapter={ch}
            className={"lib-verse-row" + (isHighlight ? " lib-highlight" : "")}>
            {vnumEl(v.verse, ch)}
            <span className="lib-verse-content">
              {noteMarker(v.verse, ch)}
              {renderProseWords(v)}
            </span>
          </div>
        </React.Fragment>
      );
    }

    // Chip mode — always Greek syntactic order with bracket notation
    let content;
    {
      const sortedWords = [...v.words].filter(w => w.english || w.kjv_def || w.strongs_base === "*").sort((a, b) => a.position - b.position);
      const groups = groupForGreekMode(sortedWords);
      content = groups.map((g, gi) => {
        if (!g.isBracket) {
          return chip(g.word, `g${gi}`);
        }
        // Suppress a duplicate position number on continuation words: when a word
        // shares the greek_pos of the previous numbered member (e.g. the source
        // token "2God did" split into God + did, both pos 2), hide the second
        // number so it renders "²God did", not "²God ²did".
        let lastGp = null;
        const gw = g.words.map((w) => {
          if (w.greek_pos != null && w.greek_pos === lastGp) return { ...w, greek_pos: null };
          if (w.greek_pos != null) lastGp = w.greek_pos;
          return w;
        });
        // Lift the bracket's trailing clause punctuation OUTSIDE the "]". ABP
        // writes "...many]," (mark after the bracket), but clean_english glued it
        // onto the word ("many,") so it renders inside. fix_bracket_punct already
        // parks the mark on the bracket's LAST word, so we snip it off here and
        // re-emit it just after the "]" — "[...dominate]." not "[...dominate.]".
        const TRAIL = /[.,;:!?·]+$/;
        let bracketTrail = "";
        let gwR = gw;
        {
          const li = gw.length - 1;
          const lastEng = (gw[li] && gw[li].english) || "";
          const m = lastEng.match(TRAIL);
          if (m) {
            bracketTrail = m[0];
            gwR = gw.map((w, i) => i === li ? { ...w, english: lastEng.slice(0, m.index) } : w);
          }
        }
        const trailChar = (txt, k) => (
          <span key={k} className="lib-bracket-trail">
            {showInterlinear && <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>}
            <span className="lib-iw-english">{txt}</span>
            {showStrongs && <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>}
          </span>
        );
        const bracketChar = (ch, k) => (
          <span key={k} className="lib-bracket">
            {showInterlinear && <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>}
            <span className="lib-bracket-glyph">{ch}</span>
            {showStrongs && <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>}
          </span>
        );
        return (
          <span key={`bg${gi}`} className="lib-bracket-group">
            {gwR.length === 1 ? (
              <span className="lib-bracket-unit">
                {bracketChar("[", "bl")}
                {bracketChip(gwR[0], `bg${gi}w0`)}
                {bracketChar("]", "br")}
                {bracketTrail && trailChar(bracketTrail, "bt")}
              </span>
            ) : (<>
              <span className="lib-bracket-unit">
                {bracketChar("[", "bl")}
                {bracketChip(gwR[0], `bg${gi}w0`)}
              </span>
              {gwR.slice(1, -1).map((w, wi) => bracketChip(w, `bg${gi}w${wi + 1}`))}
              <span className="lib-bracket-unit">
                {bracketChip(gwR[gwR.length - 1], `bg${gi}w${gwR.length - 1}`)}
                {bracketChar("]", "br")}
                {bracketTrail && trailChar(bracketTrail, "bt")}
              </span>
            </>)}
          </span>
        );
      });
    }

    return (
      <React.Fragment key={`${ch}-${v.verse}`}>
        {!skipHeading && v.heading && <div className="lib-verse-row pericope-row"><span className="lib-vnum" aria-hidden="true"/><div className="pericope-heading">{v.heading}</div></div>}
        <div ref={isHighlight ? highlightRef : null} data-note-verse={v.verse} data-note-chapter={ch}
          className={"lib-verse-row" + (isHighlight ? " lib-highlight" : "")}>
          {vnumEl(v.verse, ch)}
          <span className="lib-verse-content lib-verse-chips">{noteMarker(v.verse, ch)}{content}</span>
        </div>
      </React.Fragment>
    );
  };

  const renderKjvVerse = (v, showVerseNum = true, skipHeading = false) => {
    const ch = v._ch ?? selChapter;
    const isHighlight = nav && nav.highlight === v.verse && (nav.chapter == null || nav.chapter === ch);
    const makeKjvEntry = (w, sid) => ({
      id: `kjv-${selBook.abbrev}-${ch}-${v.verse}-${w.word_id}`,
      strongs: sid || "",
      strongs_base: sid ? sid.slice(1) : "",
      strongs_raw: sid ? sid.slice(1) : "",
      greek: w.lemma || "",
      translit: w.xlit || "",
      gloss: w.word,
      ref: `${selBook.abbrev} ${ch}:${v.verse}`,
      book: selBook.abbrev,
      chapter: ch,
      verse: v.verse,
      definition: "", derivation: "", is_function: false,
      isKjv: true,
      isHebrew: sid ? sid.startsWith("H") : false,
    });
    return (
      <React.Fragment key={`${ch}-${v.verse}`}>
        {!skipHeading && v.heading && <div className="lib-verse-row pericope-row"><span className="lib-vnum" aria-hidden="true"/><div className="pericope-heading">{v.heading}</div></div>}
        <div ref={isHighlight ? highlightRef : null} data-note-verse={v.verse} data-note-chapter={ch}
          className={"lib-verse-row" + (isHighlight ? " lib-highlight" : "")}>
        {showVerseNum && vnumEl(v.verse, ch)}
        <span className="lib-verse-content lib-verse-chips">
          {showVerseNum && noteMarker(v.verse, ch)}
          {v.words.map((w, i) => {
            const sid = w.strongs_ids && w.strongs_ids.length ? w.strongs_ids[0] : null;
            const clickable = !!(onWordClick && sid);
            const isHebrew = sid ? sid.startsWith("H") : false;
            return (
              <span key={i}
                className={"lib-word lib-kjv-word" + (w.italic ? " lib-kjv-italic" : "") + (clickable ? " lib-word-clickable" : "") + hiClass(v.verse, null, ch)}
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
      </React.Fragment>
    );
  };

  const renderKjvProse = (v, showVerseNum = true, skipHeading = false) => {
    const ch = v._ch ?? selChapter;
    const isHighlight = nav && nav.highlight === v.verse && (nav.chapter == null || nav.chapter === ch);
    return (
      <React.Fragment key={`${ch}-${v.verse}`}>
        {!skipHeading && v.heading && <div className="lib-verse-row pericope-row"><span className="lib-vnum" aria-hidden="true"/><div className="pericope-heading">{v.heading}</div></div>}
        <div ref={isHighlight ? highlightRef : null} data-note-verse={v.verse} data-note-chapter={ch}
          className={"lib-verse-row" + (isHighlight ? " lib-highlight" : "")}>
          {showVerseNum && vnumEl(v.verse, ch)}
          <span className="lib-verse-content">
            {showVerseNum && noteMarker(v.verse, ch)}
            {v.words.map((w, i) => (
              <span key={i} className={(w.italic ? "lib-prose-italic" : "") + hiClass(v.verse, null, ch)}>
                {w.word}{w.punc || ""}{" "}
              </span>
            ))}
          </span>
        </div>
      </React.Fragment>
    );
  };

  // BSB reader — plain English reading text (one string per verse, no word data).
  const renderBsbVerse = (v) => {
    const ch = v._ch ?? selChapter;
    const isHighlight = nav && nav.highlight === v.verse && (nav.chapter == null || nav.chapter === ch);
    return (
      <React.Fragment key={`${ch}-${v.verse}`}>
        {v.heading && <div className="lib-verse-row pericope-row"><span className="lib-vnum" aria-hidden="true"/><div className="pericope-heading">{v.heading}</div></div>}
        <div ref={isHighlight ? highlightRef : null} data-note-verse={v.verse} data-note-chapter={ch}
          className={"lib-verse-row" + (isHighlight ? " lib-highlight" : "")}>
          {vnumEl(v.verse, ch)}
          <span className="lib-verse-content">{noteMarker(v.verse, ch)}<span className={"lib-bsb-text" + hiClass(v.verse, null, ch)}>{v.verse_text}</span></span>
        </div>
      </React.Fragment>
    );
  };

  // ESV reader — plain English, owner-only (same shape as BSB; no Greek/Strong's).
  const renderEsvVerse = (v) => {
    const ch = v._ch ?? selChapter;
    const isHighlight = nav && nav.highlight === v.verse && (nav.chapter == null || nav.chapter === ch);
    return (
      <React.Fragment key={`${ch}-${v.verse}`}>
        {v.heading && <div className="lib-verse-row pericope-row"><span className="lib-vnum" aria-hidden="true"/><div className="pericope-heading">{v.heading}</div></div>}
        <div ref={isHighlight ? highlightRef : null} data-note-verse={v.verse} data-note-chapter={ch}
          className={"lib-verse-row" + (isHighlight ? " lib-highlight" : "")}>
          {vnumEl(v.verse, ch)}
          <span className="lib-verse-content">{noteMarker(v.verse, ch)}<span className={"lib-bsb-text" + hiClass(v.verse, null, ch)}>{v.verse_text}</span></span>
        </div>
      </React.Fragment>
    );
  };

  // Non-canonical reader (Didache, etc.). The Greek interlinear is the normal reading,
  // exactly like Bible ABP. The readable English appears ONLY in Parallel — same
  // two-column layout as Bible parallel (Greek interlinear | English). No bracket /
  // ordering machinery; chips stay in natural Greek order. Word click → word-study.
  let _didCapNext = true;   // reset per verse below; capitalize sentence-initial glosses
  const didChips = (v) => {
    _didCapNext = true;
    return v.words.map((w, i) => {
    const raw = w.english || "";
    if (!raw) return null;
    const label = _didCapNext ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw;
    _didCapNext = /[.!?][")'\]]*$/.test(raw);   // next gloss starts a new sentence?
    const clickable = !!(onWordClick && w.strongs_base);
    const entry = {
      id: `extra-${corpus}-${selChapter}-${v.verse}-${w.position}`,
      strongs: w.strongs ? strongsTag(w.strongs) : "",
      strongs_base: w.strongs_base || "",
      strongs_raw: w.strongs || "",
      greek: w.lemma || w.greek || "",
      translit: w.translit || "", morph: "",
      gloss: label,
      english_head: label,   // hero shows the gloss even when it's a short phrase
      ref: `${nonCanon ? nonCanon.name : "Extra"} ${selChapter}:${v.verse}`,
      book: corpus, chapter: selChapter, verse: v.verse,
      definition: "", derivation: "", is_function: false,
      is_pn: false, pn_type: null, pn_types: null,
      isExtra: true, extraBook: corpus, extraBookName: nonCanon ? nonCanon.name : "",
    };
    return (
      <span key={`d${i}`}
        className={"lib-word" + (clickable ? " lib-word-clickable" : "") + hiClass(v.verse, null)}
        onClick={clickable ? () => onWordClick(entry) : undefined}>
        {showInterlinear && (w.lemma
          ? <span className="lib-iw-greek">{w.lemma}</span>
          : <span className="lib-iw-greek" style={{ visibility: "hidden" }}>x</span>)}
        <span className="lib-iw-english">{label}</span>
        {showStrongs && (w.strongs
          ? <span className="lib-iw-strongs">{"G" + w.strongs}</span>
          : <span className="lib-iw-strongs" style={{ visibility: "hidden" }}>G0</span>)}
      </span>
    );
    });
  };

  // Single view: Greek interlinear only (mirrors Bible ABP).
  const renderDidacheVerse = (v) => (
    <React.Fragment key={v.verse}>
      {v.heading && <div className="lib-verse-row pericope-row"><span className="lib-vnum" aria-hidden="true"/><div className="pericope-heading">{v.heading}</div></div>}
      <div className="lib-verse-row lib-did-row" data-note-verse={v.verse}>
        {noteVnum(v.verse)}
        <span className="lib-verse-content lib-verse-chips">{noteMarker(v.verse)}{didChips(v)}</span>
      </div>
    </React.Fragment>
  );

  // Prose view: our readable English as flowing text with verse numbers.
  const renderDidacheProse = () => (
    <div className="lib-text-words lib-prose-flow">
      {didVerses.map(v => (
        <React.Fragment key={v.verse}>
          {v.heading && <div className="pericope-heading">{v.heading}</div>}
          <span className="lib-flow-verse" data-note-verse={v.verse}>
            <sup className="lib-flow-vnum"
                 title="Right-click / long-press: add a note"
                 onClick={() => { if (vnumPressRef.current.fired) vnumPressRef.current.fired = false; }}
                 {...vnumNoteHandlers(v.verse)}>{v.verse}</sup>
            {noteForVerse(v.verse) && (
              <button className="lib-note-dot lib-note-dot-inline" title="Open note" aria-label="Open note"
                onClick={(e) => { e.stopPropagation(); const n = noteForVerse(v.verse); onOpenNote && onOpenNote(n.id); }}>
                <Icon.Bookmark/>
              </button>
            )}
            <span className={hiClass(v.verse, null) || undefined}>{(v.english || "") + " "}</span>
          </span>
        </React.Fragment>
      ))}
    </div>
  );

  // Parallel view: Greek interlinear | readable English (same shape as Bible parallel).
  const renderDidacheParallelVerse = (v) => (
    <React.Fragment key={v.verse}>
      {v.heading && <div className="lib-parallel-section-heading"><div className="pericope-heading">{v.heading}</div></div>}
      <div className="lib-parallel-verse" data-note-verse={v.verse}>
        <div className="lib-parallel-vnum">{noteVnum(v.verse)}{noteMarker(v.verse)}</div>
        <div className="lib-parallel-col"><span className="lib-verse-chips">{didChips(v)}</span></div>
        <div className="lib-parallel-col"><p className={"lib-did-eng" + hiClass(v.verse, null)}>{v.english}</p></div>
      </div>
    </React.Fragment>
  );

  return (
    <div className="library">
      {navVisible && (
        <LibNavPanel
          books={books}
          selBook={selBook}
          setSelBook={selectBook}
          selChapter={selChapter}
          setSelChapter={setSelChapter}
          navBookRef={navBookRef}
          nonCanon={nonCanon}
          nonCanonList={NONCANON}
          onPickNonCanon={pickNonCanon}
          translation={translation}
          corpus={corpus}
          pickBible={pickBible}
          esvOwner={esvOwner}
          otherOpen={otherOpen}
          setOtherOpen={setOtherOpen}
          chrono={chrono}
          orderMode={orderMode}
          setOrder={setOrder}
          chronoPos={chronoPos}
          onPickPassage={pickPassage}
        />
      )}
      {!navVisible && mobileNavOpen && (
        <MobileBookPicker
          books={books}
          selBook={selBook}
          selChapter={selChapter}
          nonCanon={nonCanon}
          nonCanonList={NONCANON}
          chronoOn={chronoOn}
          chrono={chrono}
          chronoPos={chronoPos}
          onPickPassage={(p) => { pickPassage(p); setMobileNavOpen(false); }}
          onDone={(b, n) => {
            if (b.id) pickNonCanon(b); else selectBook(b);
            setSelChapter(n);
            setMobileNavOpen(false);
          }}
          onClose={() => setMobileNavOpen(false)}
        />
      )}
      {!navVisible && modesOpen && (
        <ModesSheet
          corpus={corpus}
          translation={translation}
          pickBible={pickBible}
          esvOwner={esvOwner}
          toggleParallel={toggleParallel}
          nonCanonList={NONCANON}
          showStrongs={showStrongs}
          showInterlinear={showInterlinear}
          setOpt={setOpt}
          chipMode={chipMode}
          libFontSize={libFontSize}
          changeFontSize={changeFontSize}
          chrono={chrono}
          orderMode={orderMode}
          setOrder={setOrder}
          onClose={() => setModesOpen(false)}
        />
      )}
      <div>
      {navVisible ? (
        <div className="lib-bar">
          <div className="lib-bar-l">
            <div className={"bar-ch" + (chronoOn ? " bar-ch-chrono" : "")}>
              <button
                className="ch-nav"
                disabled={chronoOn ? chronoPos <= 1 : selChapter <= 1}
                onClick={() => { if (chronoOn) { stepPassage(-1); return; } const c = Math.max(1, selChapter - 1); setSelChapter(c); if (!nonCanon) onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null }); }}
                aria-label={chronoOn ? "Previous passage" : "Previous chapter"}
              >‹</button>
              {chronoOn
                ? <span className="ch-lbl ch-cur ch-cur-chrono" title="Current passage — pick any from the era list at left">{curPassage ? curPassage.label : "—"}</span>
                : <span className="ch-lbl ch-cur" title="Current chapter — pick any chapter from the book list at left">{selChapter}</span>}
              <button
                className="ch-nav"
                disabled={chronoOn ? (chrono && chronoPos >= chrono.passages.length) : selChapter >= maxChap}
                onClick={() => { if (chronoOn) { stepPassage(1); return; } const c = Math.min(maxChap, selChapter + 1); setSelChapter(c); if (!nonCanon) onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null }); }}
                aria-label={chronoOn ? "Next passage" : "Next chapter"}
              >›</button>
            </div>
            {chrono && !nonCanon && (
              <>
                <span className="lib-bar-sep" aria-hidden="true"/>
                <div className="seg lib-order-seg">
                  <button className={"seg-b" + (orderMode !== "chronological" ? " on" : "")} title="Canonical order (books in order)" aria-label="Canonical order" onClick={() => setOrder("canonical")}><Icon.Book/></button>
                  <button className={"seg-b" + (orderMode === "chronological" ? " on" : "")} title="Chronological order (events in sequence)" aria-label="Chronological order" onClick={() => setOrder("chronological")}><Icon.Clock/></button>
                </div>
              </>
            )}
            <span className="lib-bar-sep" aria-hidden="true"/>
            <button className={"lib-toggle lib-toggle-icon" + (showStrongs ? " on" : "")} disabled={proseLocked} title="Strong's numbers" aria-label="Strong's numbers" aria-pressed={showStrongs} style={proseLocked ? { opacity: 0.35, cursor: "default" } : undefined} onClick={() => !proseLocked && setOpt("showStrongs", !showStrongs)}><Icon.Hash/></button>
            <button className={"lib-toggle lib-toggle-icon" + (showInterlinear ? " on" : "")} disabled={proseLocked} title="Interlinear" aria-label="Interlinear" aria-pressed={showInterlinear} style={proseLocked ? { opacity: 0.35, cursor: "default" } : undefined} onClick={() => !proseLocked && setOpt("showInterlinear", !showInterlinear)}><Icon.Interlinear/></button>
            {!nonCanon && <button className={"lib-toggle lib-toggle-icon" + (translation === "parallel" ? " on" : "")} disabled={proseLocked} title="Parallel (ABP + KJV)" aria-label="Parallel" aria-pressed={translation === "parallel"} style={proseLocked ? { opacity: 0.35, cursor: "default" } : undefined} onClick={() => !proseLocked && toggleParallel()}><Icon.Columns/></button>}
            <span className="lib-bar-sep" aria-hidden="true"/>
            <div className="seg lib-view-seg">
              <button
                className={"seg-b" + (chipMode ? " on" : "")}
                disabled={proseLocked}
                title="Chip view"
                aria-label="Chip view"
                aria-pressed={chipMode}
                style={proseLocked ? { opacity: 0.35, cursor: "default" } : undefined}
                onClick={() => !proseLocked && setOpt("viewMode", "chip")}
              ><Icon.Grid/></button>
              <button
                className={"seg-b" + (!chipMode ? " on" : "")}
                disabled={!proseLocked && (showStrongs || showInterlinear)}
                title="Prose view"
                aria-label="Prose view"
                aria-pressed={!chipMode}
                style={!proseLocked && (showStrongs || showInterlinear) ? { opacity: 0.35, cursor: "default" } : undefined}
                onClick={() => !showStrongs && !showInterlinear && setOpt("viewMode", "prose")}
              ><Icon.Lines/></button>
            </div>
            <span className="lib-bar-sep" aria-hidden="true"/>
            {audioBtn}
            {canSearch && (
              <button className={"lib-toggle lib-toggle-icon" + (searchOpen ? " on" : "")} title="Search this text" aria-label="Search this text" aria-pressed={searchOpen} onClick={() => setSearchOpen(o => !o)}><Icon.Search/></button>
            )}
            <div className="lib-other-wrap">
              <button className="lib-toggle lib-font-btn" onClick={() => setFontOpen(o => !o)} title="Text size" aria-label="Text size">Aa ▾</button>
              {fontOpen && (
                <>
                  <div className="lib-other-scrim" onClick={() => setFontOpen(false)} />
                  <div className="lib-other-menu lib-font-menu">
                    <div className="seg">
                      <button className="seg-b" onClick={() => changeFontSize(-1)}>A−</button>
                      <span className="font-size-lbl">{libFontSize}</span>
                      <button className="seg-b" onClick={() => changeFontSize(+1)}>A+</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="lib-toolbar">
          <button className="mbar-overview" onClick={() => setSummaryOpen(true)} aria-label="Chapter overview">
            <Icon.Info/>
          </button>
          {canSearch && (
            <button className="mbar-overview mbar-search" onClick={() => setSearchOpen(o => !o)} aria-label="Search this text">
              <Icon.Search/>
            </button>
          )}
          <div className="mbar-center">
            <button className="mbar-loc" onClick={() => setMobileNavOpen(true)}>
              {chronoOn ? (
                <span className="mbar-loc-name mbar-loc-chrono">{curPassage ? curPassage.label : "—"}</span>
              ) : (
                <>
                  <span className="mbar-loc-name">{nonCanon ? nonCanon.name : (selBook ? selBook.name : "")}</span>
                  <span className="mbar-loc-ch">{selChapter}</span>
                </>
              )}
            </button>
          </div>
          {audioCapable && !chronoOn && (
            <button className={"mbar-overview mbar-audio" + (audioPlaying ? " on" : "")} disabled={audioBusy}
              onClick={onToolbarAudio} aria-label={audioPlaying ? "Pause audio" : "Play chapter audio"}>
              {audioPlaying ? <Icon.Pause/> : <Icon.Play/>}
            </button>
          )}
          <button className="mbar-trans" onClick={() => setModesOpen(true)} aria-label="Reading options">
            {nonCanon ? (nonCanon.abbr || nonCanon.name) : translation === "parallel" ? "Par" : translation.toUpperCase()}
          </button>
        </div>
      )}

      {audioBar}

      {searchOpen && canSearch && (
        <>
          <div className="lib-search-scrim" onClick={() => setSearchOpen(false)} />
          <div className="lib-search-panel">
            <div className="lib-search-row">
              <input
                className="lib-search-input"
                type="text"
                autoFocus
                placeholder={`Search ${searchName}${corpus === "bible" && searchScope === "book" && selBook ? " · " + selBook.name : ""}…`}
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runTextSearch(); if (e.key === "Escape") setSearchOpen(false); }}
              />
              <button className="lib-search-go" onClick={runTextSearch} aria-label="Search">Go</button>
              <button className="lib-search-x" onClick={() => setSearchOpen(false)} aria-label="Close search">✕</button>
            </div>
            {corpus === "bible" && (
              <div className="lib-search-scope seg">
                <button className={"seg-b" + (searchScope === "all" ? " on" : "")} onClick={() => setSearchScope("all")}>Whole Bible</button>
                <button className={"seg-b" + (searchScope === "book" ? " on" : "")} onClick={() => setSearchScope("book")}>This book</button>
              </div>
            )}
            <div className="lib-search-results">
              {searchLoading ? (
                <div className="lib-search-status">Searching…</div>
              ) : searchResults == null ? (
                <div className="lib-search-status">Type words and press Enter.</div>
              ) : searchResults.length === 0 ? (
                <div className="lib-search-status">No matches.</div>
              ) : (
                <>
                  <div className="lib-search-status">{searchResults.length}{searchResults.length === 1000 ? "+" : ""} match{searchResults.length === 1 ? "" : "es"}</div>
                  {searchResults.map((r, i) => (
                    <button key={i} className="lib-search-hit" onClick={() => jumpToResult(r)}>
                      <span className="lib-search-hit-ref">{(corpus === "bible" ? (BOOK_LABELS[r.book] || r.book) : searchName)} {r.chapter}:{r.verse}</span>
                      <span className="lib-search-hit-text">{highlightTerm(r.text, searchTerm)}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </>
      )}

      <div ref={readingRef} className={"lib-reading" + (showInterlinear ? " lib-interlinear-on" : "")} style={{...(translation === "parallel" ? {paddingTop: 0} : {}), "--lib-font-size": libFontSize + "px"}} {...readingHandlers}>

        {nonCanon ? (
          didLoading ? (
            <div className="lib-loading">Loading…</div>
          ) : nonCanon.englishOnly ? (
            renderDidacheProse()
          ) : translation === "parallel" ? (
            <div className="lib-parallel">
              <div className="lib-parallel-header">
                <span className="lib-parallel-label">{nonCanon.name} · Greek</span>
                <span className="lib-parallel-label">English</span>
              </div>
              {didVerses.map(renderDidacheParallelVerse)}
            </div>
          ) : chipMode ? (
            <div className="lib-text-words lib-did-text">
              {didVerses.map(renderDidacheVerse)}
            </div>
          ) : (
            renderDidacheProse()
          )
        ) : translation === "parallel" ? (
          <div className="lib-parallel">
            <div className="lib-parallel-header">
              <span className="lib-parallel-label">ABP</span>
              <span className="lib-parallel-label">KJV</span>
            </div>
            {(abpShowLoading || kjvShowLoading) ? (
              <div className="lib-loading">Loading…</div>
            ) : (() => {
              // Key by chapter+verse so a chronological span (verse numbers repeat
              // across chapters) pairs ABP↔KJV correctly; canonical has one chapter.
              const cv = (v) => `${v._ch ?? selChapter}-${v.verse}`;
              const kjvMap = Object.fromEntries(kjvView.map(v => [cv(v), v]));
              // Build display items, lifting section headings above any preceding ABP-only verse
              const items = [];
              let lastCh = null;
              for (let i = 0; i < abpView.length; i++) {
                const abpV = abpView[i];
                if (abpV._ch != null && abpV._ch !== lastCh) { items.push({ type: 'chap', ch: abpV._ch }); lastCh = abpV._ch; }
                const kjvV = kjvMap[cv(abpV)];
                const heading = abpV.heading || (kjvV && kjvV.heading);
                if (heading) {
                  const prev = items[items.length - 1];
                  if (prev && prev.type === 'verse' && !prev.kjvV) {
                    items.splice(items.length - 1, 0, { type: 'heading', heading, key: `h-${cv(abpV)}` });
                  } else {
                    items.push({ type: 'heading', heading, key: `h-${cv(abpV)}` });
                  }
                }
                items.push({ type: 'verse', abpV, kjvV });
              }
              return items.map(item => {
                if (item.type === 'chap') {
                  return <div key={`cm-${item.ch}`} className="lib-chrono-chapmark">{selBook ? selBook.name : ""} {item.ch}</div>;
                }
                if (item.type === 'heading') {
                  return <div key={item.key} className="lib-parallel-section-heading"><div className="pericope-heading">{item.heading}</div></div>;
                }
                const { abpV, kjvV } = item;
                const ach = abpV._ch ?? selChapter;
                return (
                  <div key={cv(abpV)} className="lib-parallel-verse">
                    <div className="lib-parallel-vnum">{vnumEl(abpV.verse, ach)}</div>
                    <div className="lib-parallel-col">
                      {renderVerse(abpV, true)}
                    </div>
                    <div className="lib-parallel-col">
                      {kjvV
                        ? kjvWordMode
                          ? renderKjvVerse(kjvV, true, true)
                          : renderKjvProse(kjvV, true, true)
                        : null
                      }
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        ) : translation === "kjv" ? (
          kjvShowLoading ? (
            <div className="lib-loading">Loading…</div>
          ) : kjvWordMode ? (
            <div className="lib-text-words">
              {withMarks(kjvView, v => renderKjvVerse(v))}
            </div>
          ) : (
            <div className="lib-text-words">
              {withMarks(kjvView, v => renderKjvProse(v))}
            </div>
          )
        ) : translation === "bsb" ? (
          bsbShowLoading ? (
            <div className="lib-loading">Loading…</div>
          ) : (
            <div className="lib-text-words">
              {withMarks(bsbView, renderBsbVerse)}
            </div>
          )
        ) : translation === "esv" ? (
          esvShowLoading ? (
            <div className="lib-loading">Loading…</div>
          ) : (
            <div className="lib-text-words">
              {withMarks(esvView, renderEsvVerse)}
            </div>
          )
        ) : abpShowLoading ? (
          <div className="lib-loading">Loading…</div>
        ) : wordMode ? (
          <div className="lib-text-words">
            {withMarks(abpView, v => renderVerse(v))}
          </div>
        ) : isPoetry ? (
          <div className="lib-text-words">
            {withMarks(abpView, v => renderVerse(v))}
          </div>
        ) : (
          <div className="lib-text-words lib-prose-flow">
            {withMarks(abpView, v => {
              const ch = v._ch ?? selChapter;
              return (
              <React.Fragment key={`${ch}-${v.verse}`}>
                {v.heading && <div className="pericope-heading">{v.heading}</div>}
                <span className="lib-flow-verse" data-note-verse={v.verse} data-note-chapter={ch}>
                  <sup className="lib-flow-vnum"
                       title={handleVerseNum ? "Click: cross-references · Right-click / long-press: add a note" : undefined}
                       onClick={handleVerseNum ? () => {
                         if (vnumPressRef.current.fired) { vnumPressRef.current.fired = false; return; }
                         handleVerseNum(v.verse, ch);
                       } : undefined}
                       {...vnumNoteHandlers(v.verse, ch)}>
                    {v.verse}
                  </sup>
                  {noteForVerse(v.verse, ch) && (
                    <button className="lib-note-dot lib-note-dot-inline" title="Open note" aria-label="Open note"
                      onClick={(e) => { e.stopPropagation(); const n = noteForVerse(v.verse, ch); onOpenNote && onOpenNote(n.id); }}>
                      <Icon.Bookmark/>
                    </button>
                  )}
                  {renderProseWords(v)}
                </span>
              </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
      </div>
      {noteSel && <NoteAddPopover rect={noteSel.rect} isMobile={isMobile} onAdd={addNoteFromSelection} onColor={addHighlightFromSelection} onCopy={copySelection} onJournal={journalFromSelection} />}
      {flashMsg && <div className="lib-flash">{flashMsg}</div>}
      {verseMenu && <VerseNoteMenu rect={verseMenu.rect} isMobile={isMobile} onColor={vmColor} onNote={vmNote} onBookmark={vmBookmark} onCopy={vmCopy} onJournal={vmJournal} onClose={() => setVerseMenu(null)} />}
      {showSummary && (selBook || nonCanon) && (
        <SummaryPanel
          book={nonCanon ? nonCanon.id : selBook.abbrev}
          chapter={selChapter}
          bookLabel={nonCanon ? nonCanon.name : (BOOK_LABELS[selBook.abbrev] || selBook.abbrev)}
        />
      )}
      {isMobile && summaryOpen && (selBook || nonCanon) && (
        <SummaryPanel
          isMobile
          onClose={() => setSummaryOpen(false)}
          book={nonCanon ? nonCanon.id : selBook.abbrev}
          chapter={selChapter}
          bookLabel={nonCanon ? nonCanon.name : (BOOK_LABELS[selBook.abbrev] || selBook.abbrev)}
        />
      )}
    </div>
  );
}
