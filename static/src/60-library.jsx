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

function LibNavPanel({ books, selBook, setSelBook, selChapter, setSelChapter, isOverlay, onClose, navBookRef, nonCanon, nonCanonList, onPickNonCanon, translation, corpus, pickBible, esvOwner, nivOwner, hebShown, hebPickable, otherOpen, setOtherOpen, chrono, orderMode, setOrder, chronoPos, onPickPassage }) {
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
    // Hebrew is OT-only (no Hebrew NT), so drop the NT books from the list in HEB mode.
    const base = translation === "heb" ? books.filter(b => !NT_BOOKS.has(b.abbrev)) : books;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(b => b.name.toLowerCase().includes(q) || b.abbrev.toLowerCase().includes(q));
  }, [books, query, translation]);

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

  // "More" button: ABP/KJV/BSB stay one-click; ESV/NIV/HEB + the non-canon books live
  // in this menu, so the row stays at four buttons no matter how many texts exist.
  const extraActive = !nonCanon && (translation === "esv" || translation === "niv" || translation === "heb");
  const moreActive = !!nonCanon || extraActive;
  const moreLabel = nonCanon ? (nonCanon.abbr || nonCanon.name)
    : translation === "esv" ? "ESV"
    : translation === "niv" ? "NIV"
    : translation === "heb" ? "HEB" : "More";

  return (
    <nav className={"nav" + (isOverlay ? " nav-overlay" : "")} aria-label="Books">
      <div className="nav-top">
        {isOverlay && <button className="nav-x" onClick={onClose} aria-label="Close">✕</button>}
      </div>
      {/* Text-source picker — ABP/KJV/BSB one-click; ESV/NIV/HEB + non-canon in "More" */}
      <div className="nav-source">
        <div className="seg nav-source-seg">
          <button className={"seg-b" + (!nonCanon && translation === "abp" ? " on" : "")} onClick={() => pickBible("abp")}>ABP</button>
          <button className={"seg-b" + (!nonCanon && translation === "kjv" ? " on" : "")} onClick={() => pickBible("kjv")}>KJV</button>
          <button className={"seg-b" + (!nonCanon && translation === "bsb" ? " on" : "")} onClick={() => pickBible("bsb")}>BSB</button>
          <button className={"seg-b nav-other-seg" + (moreActive ? " on" : "")} onClick={() => setOtherOpen(o => !o)} aria-expanded={otherOpen}>
            <span className="nav-other-lbl">{moreLabel}</span>
            <span className={"nav-other-caret" + (otherOpen ? " open" : "")}>▾</span>
          </button>
        </div>
      </div>
      {/* Reading-order toggle (Canonical | Chronological) lives in the top toolbar.
          The nav just reflects orderMode: era→passage list when chronological. */}
      {/* "Other" books open INLINE in the panel (pushes the book list down) so the
          menu never floats over the reading text. */}
      {otherOpen && (
        <div className="nav-other-inline">
          {(esvOwner || nivOwner || hebShown) && (
            <div className="nav-more-bibles">
              {esvOwner && (
                <button className={"lib-other-item" + (!nonCanon && translation === "esv" ? " on" : "")}
                  onClick={() => { pickBible("esv"); setOtherOpen(false); if (isOverlay) onClose(); }}>ESV</button>
              )}
              {nivOwner && (
                <button className={"lib-other-item" + (!nonCanon && translation === "niv" ? " on" : "")}
                  onClick={() => { pickBible("niv"); setOtherOpen(false); if (isOverlay) onClose(); }}>NIV</button>
              )}
              {hebShown && (
                <button className={"lib-other-item" + (!nonCanon && translation === "heb" ? " on" : "")}
                  disabled={!hebPickable} title={!hebPickable ? "Old Testament books only" : undefined}
                  onClick={() => { pickBible("heb"); setOtherOpen(false); if (isOverlay) onClose(); }}>Hebrew OT (interlinear)</button>
              )}
            </div>
          )}
          {nonCanonList && nonCanonList.length > 0 && nonCanonGroups(nonCanonList).map(grp => {
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
function MobileBookPicker({ books, selBook, selChapter, nonCanon, nonCanonList, onDone, onClose, chronoOn, chrono, chronoPos, onPickPassage, translation }) {
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

  // Hebrew is OT-only (no Hebrew NT), so drop the NT section in HEB mode — mirrors the
  // desktop nav's `filtered` useMemo.
  const otBooks = books.filter(b => !NT_BOOKS.has(b.abbrev));
  const ntBooks = translation === "heb" ? [] : books.filter(b => NT_BOOKS.has(b.abbrev));
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
          [["OT", otBooks], ["NT", ntBooks]].filter(([, bks]) => bks.length).map(([label, bks]) => {
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
  corpus, translation, pickBible, esvOwner, nivOwner, hebShown, hebPickable, toggleParallel, nonCanonList,
  compareAvail, compareActive, toggleCompare,
  showStrongs, showInterlinear, setOpt, chipMode, viewMode, libFontSize, changeFontSize, onClose,
  chrono, orderMode, setOrder,
}) {
  const { sheetRef, scrollRef } = useSwipeToDismiss(onClose);
  const activeNonCanon = nonCanonList.find(t => t.id === corpus) || null;
  const proseLocked = !!(activeNonCanon && activeNonCanon.englishOnly) || translation === "bsb" || translation === "esv" || translation === "niv";   // English-only / BSB / ESV / NIV: no Greek toggles
  const hebMode = translation === "heb";   // Hebrew interlinear: always chips, no prose option
  const gray = proseLocked ? { opacity: 0.35, cursor: "default" } : undefined;
  // English-only "other books": Greek toggles stay locked, but line-vs-flow is allowed.
  const extraEnglish = !!(activeNonCanon && activeNonCanon.englishOnly);
  const layoutLocked = proseLocked && !extraEnglish;
  const viewChipOn   = hebMode ? true : (extraEnglish ? viewMode === "chip" : chipMode);
  // Text picker gestures: a TAP swaps to that single Bible; a LONG-PRESS (or right-click)
  // ticks it into / out of the side-by-side compare set. One shared timer is fine (touches
  // happen one at a time); the `fired` flag stops a long-press from also firing the tap.
  const pressRef = useRef({ timer: null, fired: false });
  const pickHandlers = (id) => ({
    onClick: () => { if (pressRef.current.fired) { pressRef.current.fired = false; return; } pickBible(id); },
    onContextMenu: (e) => { e.preventDefault(); toggleCompare(id); },
    onTouchStart: () => {
      const st = pressRef.current;
      st.fired = false;
      clearTimeout(st.timer);
      st.timer = setTimeout(() => { st.fired = true; toggleCompare(id); if (navigator.vibrate) navigator.vibrate(12); }, 500);
    },
    onTouchMove: () => clearTimeout(pressRef.current.timer),
    onTouchEnd: () => clearTimeout(pressRef.current.timer),
  });
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
            {activeNonCanon ? (
              /* Reading a non-canonical text: ABP/KJV/etc just jump back to the Bible. */
              <div className="mseg text-ed">
                <button className={"mseg-b"+(corpus==="bible"&&translation==="abp"?" on":"")} onClick={()=>pickBible("abp")}>ABP</button>
                <button className={"mseg-b"+(corpus==="bible"&&translation==="kjv"?" on":"")} onClick={()=>pickBible("kjv")}>KJV</button>
                <button className={"mseg-b"+(corpus==="bible"&&translation==="bsb"?" on":"")} onClick={()=>pickBible("bsb")}>BSB</button>
                {esvOwner && <button className={"mseg-b"+(corpus==="bible"&&translation==="esv"?" on":"")} onClick={()=>pickBible("esv")}>ESV</button>}
                {nivOwner && <button className={"mseg-b"+(corpus==="bible"&&translation==="niv"?" on":"")} onClick={()=>pickBible("niv")}>NIV</button>}
              </div>
            ) : (
              /* Bible: one checkable row — tick 1 to read it, 2-4 to compare side by side.
                 compareActive + toggleCompare already do the read/compare switching. HEB
                 rides in the same row but is single-read only (no compare gesture); the
                 row wraps to a 2nd line when there are enough texts. When HEB is the read,
                 none of the compare buttons are "on" (compareActive falls back to abp). */
              <>
                <div className="mode-hint">Tap to read · long-press to compare</div>
                <div className="mseg text-ed text-pick">
                  {compareAvail.map(id => {
                    const on = translation !== "heb" && compareActive.includes(id);
                    return (
                      <button key={id} className={"mseg-b"+(on?" on":"")} aria-pressed={on} {...pickHandlers(id)}>
                        {on && <span className="mseg-chk" aria-hidden="true">✓</span>}{id.toUpperCase()}
                      </button>
                    );
                  })}
                  {hebShown && (
                    <button className={"mseg-b"+(translation === "heb" ? " on" : "")} aria-pressed={translation === "heb"}
                      disabled={!hebPickable} style={!hebPickable ? {opacity:0.35,cursor:"default"} : undefined}
                      title={hebPickable ? "Hebrew OT interlinear" : "Hebrew OT — Old Testament books only"}
                      aria-label="Hebrew OT interlinear"
                      onContextMenu={(e) => e.preventDefault()}
                      onClick={() => { if (hebPickable) pickBible("heb"); }}>
                      {translation === "heb" && <span className="mseg-chk" aria-hidden="true">✓</span>}HEB
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          {chrono && !activeNonCanon && (
            <div className="mode-sec">
              <div className="mode-lbl">Order</div>
              <div className="mseg">
                <button className={"mseg-b"+(orderMode!=="chronological"?" on":"")} aria-pressed={orderMode!=="chronological"} onClick={()=>setOrder("canonical")}>Canonical</button>
                <button className={"mseg-b"+(orderMode==="chronological"?" on":"")} aria-pressed={orderMode==="chronological"} onClick={()=>setOrder("chronological")}>Chronological</button>
              </div>
            </div>
          )}
          <div className="mode-sec">
            <div className="mode-lbl">Study layer</div>
            <div className="mseg">
              <button className={"mseg-b"+(showStrongs?" on":"")} disabled={proseLocked} style={gray} aria-pressed={showStrongs} onClick={()=>!proseLocked&&setOpt("showStrongs",!showStrongs)}>Strong's</button>
              <button className={"mseg-b"+(showInterlinear?" on":"")} disabled={proseLocked} style={gray} aria-pressed={showInterlinear} onClick={()=>!proseLocked&&setOpt("showInterlinear",!showInterlinear)}>Interlinear</button>
            </div>
          </div>
          <div className="mode-sec">
            <div className="mode-lbl">Display</div>
            <div className="display-row">
              <div className="mseg mseg-view">
                <button className={"mseg-b"+(viewChipOn?" on":"")} disabled={layoutLocked} style={layoutLocked?{opacity:0.35,cursor:"default"}:undefined} title={extraEnglish?"Line-by-line view":"Chip view"} aria-label={extraEnglish?"Line-by-line view":"Chip view"} aria-pressed={viewChipOn} onClick={()=>!layoutLocked&&setOpt("viewMode","chip")}><Icon.Grid/></button>
                <button className={"mseg-b"+(!viewChipOn?" on":"")} disabled={hebMode||(!extraEnglish&&!proseLocked&&(showStrongs||showInterlinear))} style={hebMode||(!extraEnglish&&!proseLocked&&(showStrongs||showInterlinear))?{opacity:0.35}:undefined} title="Prose view" aria-label="Prose view" aria-pressed={!viewChipOn} onClick={()=>{ if(hebMode)return; if(extraEnglish){setOpt("viewMode","prose");return;} if(!showStrongs&&!showInterlinear)setOpt("viewMode","prose"); }}><Icon.Lines/></button>
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
function LibraryView({ nav, onNavChange, onWordClick, onVerseNumberClick, onOpenNote, onTranslationChange, isMobile, showSummary, focusMode, onToggleFocus }) {
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
  // NIV — same owner gate as ESV, text-only (no audio).
  const [nivVerses, setNivVerses] = useState([]);
  const [nivLoading, setNivLoading] = useState(false);
  const [nivOwner, setNivOwner] = useState(false);
  // Hebrew OT interlinear (PUBLIC, public-domain). Now open to everyone: the toggle
  // shows whenever hebAvail (heb.db is loaded) — no login needed. Single-read mode for
  // now (not in compare/chronological yet).
  const [hebVerses, setHebVerses] = useState([]);
  const [hebLoading, setHebLoading] = useState(false);
  const [hebAvail, setHebAvail] = useState(false);
  // Have the owner-status checks come back yet? Until they do, don't bounce a restored
  // ESV/NIV/HEB reading to ABP (a refresh would otherwise drop you off the gated text).
  const [gatedReady, setGatedReady] = useState(false);
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
  const [viewCh, setViewCh] = useState(null);   // chrono: chapter currently scrolled into view (drives the toolbar play target)
  const [libOptions, setLibOptions] = useState({
    viewMode: "chip", showStrongs: false, showInterlinear: false,
  });
  const [libFontSize, setLibFontSize] = useState(() => {
    const stored = localStorage.getItem("libFontSize");
    if (stored) return parseInt(stored, 10);
    return isMobile ? 15 : 18;
  });
  const [translation, setTranslation] = useState("abp"); // layout: "abp" | "kjv" | "bsb" | "esv" | "niv" | "parallel"
  // Compare (parallel): translation === "parallel" is the mode; compareSel is WHICH
  // texts (2-4) sit side by side. ESV/NIV only offered to the owner.
  const [compareSel, setCompareSel] = useState(["abp", "kjv"]);
  const [compareOpen, setCompareOpen] = useState(false);
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
  const swallowClickRef = useRef(false);            // a press that closed the popup → eat its click (survives the re-render)
  const [flashMsg, setFlashMsg] = useState("");     // tiny confirmation toast ("Copied", etc.)
  const flashT = useRef(null);
  const flash = (m) => { setFlashMsg(m); clearTimeout(flashT.current); flashT.current = setTimeout(() => setFlashMsg(""), 1600); };
  // The line a verse becomes when sent to the journal: "Genesis 1:8 (ABP) — text".
  // No translation tag for non-canon texts (their book name already says it all).
  const journalLine = (a) => {
    const tag = nonCanon ? "" : (translation === "parallel" ? compareSel.map(s => s.toUpperCase()).join("/") : (translation || "").toUpperCase());
    return a.refLabel + (tag ? " (" + tag + ")" : "") + " — " + a.snippet;
  };
  useNotesVersion();                                // re-render markers when notes change
  // Who's signed in (re-read every render; setAuth notifies, so login/logout
  // re-renders us). The ESV toggle only ever shows when the server says "owner".
  const authEmail = (() => { try { return (NotesStore.authInfo() || {}).email || null; } catch (e) { return null; } })();
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.esvStatus().then(d => { if (!cancelled) setEsvOwner(!!(d && d.owner)); }),
      api.nivStatus().then(d => { if (!cancelled) setNivOwner(!!(d && d.owner)); }),
      api.hebStatus().then(d => { if (!cancelled) setHebAvail(!!(d && d.available)); }),
    ]).finally(() => { if (!cancelled) setGatedReady(true); });
    return () => { cancelled = true; };
  }, [authEmail]);
  // If the owner signs out (or it's revoked) while reading ESV/NIV, fall back to ABP
  // so they're never stuck on a now-forbidden text showing blank.
  useEffect(() => {
    if (!gatedReady) return;   // owner status still loading — don't bounce a just-restored gated text
    if (!esvOwner && translation === "esv") { setTranslation("abp"); onTranslationChange?.("abp"); }
    if (!nivOwner && translation === "niv") { setTranslation("abp"); onTranslationChange?.("abp"); }
    // HEB is OT-only — bounce back to ABP if it's unavailable, or you moved to an NT
    // book while reading Hebrew.
    if (translation === "heb" && (!hebAvail || (selBook && NT_BOOKS.has(selBook.abbrev)))) { setTranslation("abp"); onTranslationChange?.("abp"); }
  }, [esvOwner, nivOwner, hebAvail, translation, selBook, gatedReady]);

  useEffect(() => {
    if (!nav?.book || !navBookRef.current || nav.book !== selBook?.abbrev) return;
    requestAnimationFrame(() => {
      const el = navBookRef.current;
      const sc = el && el.closest(".nav-scroll");
      if (!sc) return;
      // Scroll ONLY the nav's own book list so the active book rides near the top —
      // never the whole window (that dragged the verse you jumped to off-screen).
      const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
      sc.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
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
      if (!data.length) return;
      // Restore the last reading spot from a previous visit (book/chapter/translation, or an
      // open non-canonical text); fall back to Genesis. An explicit verse jump (nav.book — a
      // click from Search/cross-refs) runs in its own effect and overrides this afterward.
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem("lexica.lib.v1") || "null"); } catch (e) {}
      const savedBook = saved && saved.book ? data.find(b => b.abbrev === saved.book) : null;
      setSelBook(savedBook || data[0]);
      if (saved) {
        if (saved.chapter > 0) setSelChapter(saved.chapter);
        const t = saved.translation;
        // Restore the saved text optimistically (incl. the gated ESV/NIV/HEB); the
        // owner-status effect bounces it back to ABP afterward if you're not allowed.
        if (["abp", "kjv", "bsb", "esv", "niv", "heb"].includes(t)) setTranslation(t);
        if (saved.corpus && saved.corpus !== "bible" && NONCANON.some(x => x.id === saved.corpus)) setCorpus(saved.corpus);
      }
    });
  }, []);
  // Remember the reading spot so a refresh returns you here instead of Genesis 1.
  useEffect(() => {
    if (!selBook && corpus === "bible") return;   // nothing settled yet
    try {
      localStorage.setItem("lexica.lib.v1", JSON.stringify({
        corpus, book: selBook ? selBook.abbrev : null, chapter: selChapter, translation,
      }));
    } catch (e) {}
  }, [corpus, selBook, selChapter, translation]);

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
    const need = translation === "parallel" ? compareSel : [translation];
    const fetchChapter = (c) => {
      const jobs = [];
      if (need.includes("abp")) jobs.push(api.chapter(book, c).then(d => ["abp", d]));
      if (need.includes("kjv")) jobs.push(api.kjvChapter(book, c).then(d => ["kjv", d]));
      if (need.includes("bsb")) jobs.push(api.bsbChapter(book, c).then(d => ["bsb", d]));
      if (need.includes("esv")) jobs.push(api.esvChapter(book, c).then(d => ["esv", d]));
      if (need.includes("niv")) jobs.push(api.nivChapter(book, c).then(d => ["niv", d]));
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
  }, [chronoOn, chronoPos, translation, corpus, compareSel]);

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
    if (!selBook || nonCanon || chronoOn) return;
    if (translation !== "kjv" && !(translation === "parallel" && compareSel.includes("kjv"))) return;
    let cancelled = false;
    setKjvLoading(true);
    setKjvVerses([]);
    api.kjvChapter(selBook.abbrev, selChapter)
      .then(data => { if (!cancelled) { setKjvVerses(data); setKjvLoading(false); } })
      .catch(() => { if (!cancelled) setKjvLoading(false); });
    return () => { cancelled = true; };
  }, [selBook && selBook.abbrev, selChapter, translation, corpus, chronoOn, compareSel]);

  // BSB chapter loader — when BSB is the reading text OR a selected compare column.
  useEffect(() => {
    if (!selBook || nonCanon || chronoOn) return;
    if (translation !== "bsb" && !(translation === "parallel" && compareSel.includes("bsb"))) return;
    let cancelled = false;
    setBsbLoading(true);
    setBsbVerses([]);
    api.bsbChapter(selBook.abbrev, selChapter)
      .then(data => { if (!cancelled) { setBsbVerses(data); setBsbLoading(false); } })
      .catch(() => { if (!cancelled) setBsbLoading(false); });
    return () => { cancelled = true; };
  }, [selBook && selBook.abbrev, selChapter, translation, corpus, chronoOn, compareSel]);

  // ESV chapter loader — owner-only reading text. Each fetch carries the login
  // token; the server returns 404 (and api.esvChapter yields []) for non-owners.
  useEffect(() => {
    if (!selBook || nonCanon || chronoOn || !esvOwner) return;
    if (translation !== "esv" && !(translation === "parallel" && compareSel.includes("esv"))) return;
    let cancelled = false;
    setEsvLoading(true);
    setEsvVerses([]);
    api.esvChapter(selBook.abbrev, selChapter)
      .then(data => { if (!cancelled) { setEsvVerses(data); setEsvLoading(false); } })
      .catch(() => { if (!cancelled) setEsvLoading(false); });
    return () => { cancelled = true; };
  }, [selBook && selBook.abbrev, selChapter, translation, corpus, chronoOn, esvOwner, compareSel]);

  // NIV chapter loader — owner-only reading text (same as ESV, text only).
  useEffect(() => {
    if (!selBook || nonCanon || chronoOn || !nivOwner) return;
    if (translation !== "niv" && !(translation === "parallel" && compareSel.includes("niv"))) return;
    let cancelled = false;
    setNivLoading(true);
    setNivVerses([]);
    api.nivChapter(selBook.abbrev, selChapter)
      .then(data => { if (!cancelled) { setNivVerses(data); setNivLoading(false); } })
      .catch(() => { if (!cancelled) setNivLoading(false); });
    return () => { cancelled = true; };
  }, [selBook && selBook.abbrev, selChapter, translation, corpus, chronoOn, nivOwner, compareSel]);

  // Hebrew OT interlinear loader — PUBLIC text, OT books only, single-read mode
  // (not wired into compare / chronological yet).
  useEffect(() => {
    if (!selBook || nonCanon || chronoOn) return;
    if (translation !== "heb" || NT_BOOKS.has(selBook.abbrev)) return;
    let cancelled = false;
    setHebLoading(true);
    setHebVerses([]);
    api.hebChapter(selBook.abbrev, selChapter)
      .then(data => { if (!cancelled) { setHebVerses(data); setHebLoading(false); } })
      .catch(() => { if (!cancelled) setHebLoading(false); });
    return () => { cancelled = true; };
  }, [selBook && selBook.abbrev, selChapter, translation, corpus, chronoOn]);

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
        // Land the verse in the UPPER THIRD (context above, room to read forward) —
        // not dead center. The row carries scroll-margin-top: 30vh (styles.css), so
        // block:"start" stops 30% down. scrollIntoView finds the right scroller on its
        // own (the window, or the fixed focus-mode page), so this works in every mode.
        highlightRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
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
    if (translation === "kjv" || translation === "bsb" || translation === "esv" || translation === "niv" || translation === "parallel") { setTranslation("abp"); onTranslationChange?.("abp"); }
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
  // Compare (parallel): pick 2-4 texts to show side by side. The picker's "active"
  // set is the parallel selection when on, else just the current single edition (so
  // opening the menu pre-checks what you're reading). Checking a 2nd text turns
  // compare ON; dropping below 2 falls back to a single view. Bible only.
  const COMPARE_ORDER = ["abp", "kjv", "bsb", "esv", "niv"];
  const compareAvail = COMPARE_ORDER.filter(id => (id === "esv" ? esvOwner : id === "niv" ? nivOwner : true));
  const compareActive = translation === "parallel"
    ? compareSel.filter(id => compareAvail.includes(id))
    : (COMPARE_ORDER.includes(translation) ? [translation] : ["abp"]);
  const toggleCompare = (id) => {
    const set = compareActive.includes(id) ? compareActive.filter(x => x !== id) : [...compareActive, id];
    const ordered = COMPARE_ORDER.filter(x => set.includes(x) && compareAvail.includes(x));
    setCompareSel(ordered);
    if (ordered.length >= 2) { setTranslation("parallel"); onTranslationChange?.("parallel"); }
    else { const fb = ordered[0] || "abp"; setTranslation(fb); onTranslationChange?.(fb); }
  };
  // Plain on/off toggle (used by the mobile sheet header + as a quick flip). Turning
  // on keeps the current compareSel if it already has 2+, else defaults to ABP|KJV.
  const toggleParallel = () => {
    if (translation === "parallel") { setTranslation("abp"); onTranslationChange?.("abp"); }
    else {
      setCompareSel(prev => (prev.filter(id => compareAvail.includes(id)).length >= 2 ? prev : ["abp", "kjv"]));
      setTranslation("parallel"); onTranslationChange?.("parallel");
    }
  };
  // In-text search: which text to search. Bible → the active edition (Parallel
  // searches the English/KJV column); a non-canonical reader → that text's id.
  const readCorpus = corpus === "bible" ? (translation === "parallel" ? "kjv" : translation) : corpus;
  // ESV has no plain-text search route (owner-only reading text), so the reader's
  // in-text find is off for it — every other text supports it.
  const canSearch = !!readCorpus && translation !== "esv" && translation !== "niv";
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
  const nivMode     = translation === "niv";
  const hebMode     = translation === "heb";   // Hebrew interlinear: always chips, no prose option
  const proseLocked = !!(nonCanon && nonCanon.englishOnly) || bsbMode || esvMode || nivMode;
  const chipMode    = !proseLocked && (viewMode === "chip" || showStrongs || showInterlinear);
  const wordMode    = chipMode;
  const kjvWordMode = chipMode;
  // English-only "other books" have no Greek interlinear, so the Strong's / Interlinear
  // toggles stay locked — but they CAN switch between a verse-per-line layout (the
  // "chip" slot) and flowing prose. layoutLocked = can't even pick line vs flow.
  const extraEnglish  = !!(nonCanon && nonCanon.englishOnly);
  const extraLineMode = extraEnglish && viewMode === "chip";
  const layoutLocked  = proseLocked && !extraEnglish;
  const viewChipOn    = hebMode ? true : (extraEnglish ? viewMode === "chip" : chipMode);

  const POETRY_BOOKS = new Set(["Psa", "Pro", "Job", "Son", "Lam", "Ecc"]);
  const isPoetry = POETRY_BOOKS.has(selBook?.abbrev);

  // HEB toggle: public (shows whenever the Hebrew data is loaded), OT books only (no
  // Hebrew NT), and not while a non-canon text is open.
  // hebShown = the OT-only Hebrew text exists as an option (heb.db loaded, reading the Bible).
  // hebPickable = and it's usable on the CURRENT book (an OT book). On NT books we keep the
  // selector VISIBLE but disabled/grayed, so it doesn't vanish out from under you.
  const hebShown = hebAvail && !nonCanon && !!selBook;
  const hebPickable = hebShown && !NT_BOOKS.has(selBook.abbrev);

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
  const nivView = chronoOn ? flattenSpan("niv") : nivVerses;
  // Drop a chapter divider each time _ch changes; a plain map for canonical (no _ch).
  const withMarks = (arr, renderFn) => {
    const out = []; let lastCh = null;
    arr.forEach(v => {
      if (v._ch != null && v._ch !== lastCh) {
        out.push(<div key={`cm-${v._ch}`} data-ch={v._ch} className="lib-chrono-chapmark">{selBook ? selBook.name : ""} {v._ch}</div>);
        // Audio progress bar above the chapter that's currently playing — DESKTOP only.
        // On mobile the scrubber docks at the bottom cockpit like every other mode.
        if (!isMobile && audioCapable && audioUrl && curPassage && audioKey === (curPassage.book + "-" + v._ch)) {
          out.push(<div key={`cb-${v._ch}`} className="lib-chrono-audio-bar">{audioProgress}</div>);
        }
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
  const nivShowLoading = chronoOn ? (chronoLoading || !chronoReady) : nivLoading;
  // Chapter audio (BSB + ESV only). Audio is one file per WHOLE chapter. ONE play/pause
  // icon in the toolbar + a progress bar under the toolbar (desktop AND mobile, same
  // spot). The button targets the chapter you're reading: canonical = the open chapter;
  // chrono = whichever chapter is scrolled into view (viewCh). Press play and you get
  // that chapter; it auto-advances to the next when one ends.
  const audioCapable = bsbMode || esvMode;
  const audioTarget = audioCapable ? {
    book: chronoOn ? (curPassage && curPassage.book) : (selBook && selBook.abbrev),
    ch:   chronoOn ? (viewCh || (curPassage && curPassage.start_ch)) : selChapter,
  } : null;
  const targetKey = audioTarget && audioTarget.book ? (audioTarget.book + "-" + audioTarget.ch) : null;
  const onTargetNow = !!targetKey && audioKey === targetKey;   // the chapter in view IS the loaded one
  // The icon follows ONLY whether sound is playing, so scrolling never desyncs it.
  const showPause = audioPlaying;
  const onToolbarAudio = () => {
    if (!audioTarget || !audioTarget.book || !audioTarget.ch) return;
    const a = audioRef.current;
    if (a && !a.paused) { a.pause(); return; }                 // playing → pause
    if (a && onTargetNow) { a.play().catch(() => {}); return; } // paused on the chapter in view → resume
    loadAudio(audioTarget.book, audioTarget.ch);               // else start / switch to the chapter in view
  };
  const onAudioEnded = () => {
    setAudioPlaying(false);
    if (chronoOn && curPassage && audioKey) {
      const cur = parseInt(audioKey.split("-")[1], 10);               // chrono: roll into the next chapter of the passage
      if (cur < curPassage.end_ch) { loadAudio(curPassage.book, cur + 1); return; }
    }
    setAudioUrl(null); setAudioKey(null);   // canonical end, or chrono passage finished → scrubber goes away
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
  // Where the visible seek bar sits:
  //  - mobile (ALL modes): a strip docked just above the bottom reading cockpit, sliding
  //    up when a chapter loads. Play/pause stays in the cockpit; this is only the scrubber.
  //  - desktop chrono: inline above the playing chapter (rendered at its divider in
  //    withMarks); here we only mount the hidden <audio>.
  //  - desktop canonical: a row right under the toolbar.
  const audioBar = !audioEl ? null
    : isMobile ? <div className="lib-audio-dock">{audioProgress}{audioEl}</div>
    : chronoOn ? audioEl
    : <div className="lib-audio-bar-row">{audioProgress}{audioEl}</div>;
  const audioDockOn = !!audioEl && isMobile;   // drives the reading-list bottom clearance (all mobile modes)
  const audioBtn = audioCapable ? (
    <button className={"lib-toggle lib-toggle-icon" + (showPause ? " on" : "")}
      disabled={audioBusy}
      title={showPause ? "Pause audio" : "Play chapter audio"}
      aria-label={showPause ? "Pause audio" : "Play chapter audio"} aria-pressed={showPause}
      onClick={onToolbarAudio}>
      {showPause ? <Icon.Pause/> : <Icon.Play/>}
    </button>
  ) : null;
  // Chrono: track which chapter is scrolled into view (~just above mid-screen), so the
  // toolbar play button AND the chapter overview both follow the chapter you're reading.
  useEffect(() => {
    if (!chronoOn) { setViewCh(null); return; }
    const compute = () => {
      const root = readingRef.current; if (!root) return;
      const marks = root.querySelectorAll(".lib-chrono-chapmark[data-ch]");
      if (!marks.length) return;
      // Switch when a chapter heading passes ~just-above the middle of the screen
      // (not the very top), so the "current" chapter matches what you're reading.
      const threshold = (window.innerHeight || 800) * 0.45;
      let cur = parseInt(marks[0].dataset.ch, 10);
      marks.forEach(m => { if (m.getBoundingClientRect().top <= threshold) cur = parseInt(m.dataset.ch, 10); });
      setViewCh(cur);
    };
    let raf = null;
    const onScroll = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = null; compute(); }); };
    compute();
    window.addEventListener("scroll", onScroll, true);   // capture: also catches a nested scroll panel
    return () => { window.removeEventListener("scroll", onScroll, true); if (raf) cancelAnimationFrame(raf); };
  }, [chronoOn, audioCapable, chronoPos, translation, chronoReady, curPassage && curPassage.start_ch]);

  // Chapter overview target — in chrono it follows the chapter scrolled into view
  // (same cutoff as the audio); otherwise the open chapter.
  const sumBook = nonCanon ? nonCanon.id : (chronoOn && curPassage ? curPassage.book : (selBook && selBook.abbrev));
  const sumChapter = (chronoOn && curPassage) ? (viewCh || curPassage.start_ch) : selChapter;
  const sumLabel = nonCanon ? nonCanon.name : (BOOK_LABELS[sumBook] || sumBook);

  // Turn one page: chronological steps a passage, everything else steps a chapter.
  // Shared by the mobile swipe and the desktop arrow keys (focus mode).
  const turnPage = (dir) => {                 // dir: +1 next, -1 prev
    if (chronoOn) { stepPassage(dir); return; }
    const c = selChapter + dir;
    if (c < 1 || c > maxChap) return;
    setSelChapter(c);
    if (!nonCanon) onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null });
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
      turnPage(dx < 0 ? 1 : -1);               // left swipe = next, right swipe = prev
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
    swallowClickRef.current = false;   // a real selection isn't a dismiss-click
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
  // Focus mode: blank-space tap strips the chrome (header/nav/toolbar/tabs/audio)
  // for distraction-free reading. A one-time hint shows the way back out.
  const toggleFocus = () => {
    if (!focusMode) flash(isMobile ? "Tap anywhere to show the menus" : "Reading mode — tap the text or press Esc to exit");
    onToggleFocus && onToggleFocus();
  };
  // While focus is on: Esc brings the chrome back; arrow keys turn the page
  // (the toolbar's hidden, so this is the desktop page-turn). Ignore keys typed
  // into an input so search/notes fields aren't hijacked.
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e) => {
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === "Escape") { onToggleFocus && onToggleFocus(); }
      else if (e.key === "ArrowRight") turnPage(1);
      else if (e.key === "ArrowLeft") turnPage(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, chronoOn, selChapter, maxChap, nonCanon, chronoPos]);

  // One handler set on the reading area: swipe (mobile) + selection (all).
  const readingHandlers = {
    ...swipeHandlers,
    // A fresh press starts a new interaction: drop any open popover + the suppress flag.
    onMouseDown: () => { if (noteSel) { setNoteSel(null); swallowClickRef.current = true; } justSelectedRef.current = false; },
    onMouseUp: () => resolveSelection(),
    onTouchEnd: (e) => {
      if (swipeHandlers.onTouchEnd) swipeHandlers.onTouchEnd(e);
      setTimeout(resolveSelection, 0);   // let the browser settle the selection first
    },
    onClickCapture: (e) => {
      // The click that ENDS a selection must keep the popover showing — swallow it
      // (so it doesn't also hit a chip / verse number / focus) but leave noteSel set.
      if (justSelectedRef.current) { justSelectedRef.current = false; e.stopPropagation(); e.preventDefault(); return; }
      // A press that closed the popover flagged this click to be eaten — so dismissing
      // the popover doesn't also hit a chip / verse number / focus. (Popover buttons sit
      // outside the reading area, so they're unaffected.)
      if (swallowClickRef.current) { swallowClickRef.current = false; e.stopPropagation(); e.preventDefault(); return; }
      if (swipeHandlers.onClickCapture) swipeHandlers.onClickCapture(e);
    },
    // Tap on blank space (not a word / verse number / control, and not mid-selection)
    // toggles focus mode. A swipe or a finished selection sets defaultPrevented above.
    onClick: (e) => {
      if (e.defaultPrevented) return;
      if (window.getSelection && String(window.getSelection())) return;
      if (e.target.closest && e.target.closest(".lib-word, .lib-vnum, .lib-flow-vnum, button, a, input, textarea, [contenteditable]")) return;
      toggleFocus();
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
  // A record is shown with a bookmark icon only when it's a PLAIN bookmark; once it
  // carries a note or a highlight color it shows the note (pencil) icon instead.
  const isBookmarkOnly = (n) => !!(n && n.bookmark && !n.body && !n.color);
  const markerIcon = (n) => isBookmarkOnly(n) ? <Icon.Bookmark/> : <Icon.Note/>;
  const markerLabel = (n) => isBookmarkOnly(n) ? "Open bookmark" : "Open note";
  const noteMarker = (verse, ch = selChapter) => {
    const n = noteForVerse(verse, ch);
    if (!n) return null;
    return (
      <button className="lib-note-dot" title={markerLabel(n)} aria-label={markerLabel(n)}
        onClick={(e) => { e.stopPropagation(); onOpenNote && onOpenNote(n.id); }}>
        {markerIcon(n)}
      </button>
    );
  };
  // Inline variant (prose flow / non-canon) — same icon logic, inline placement.
  const noteDotInline = (verse, ch = selChapter) => {
    const n = noteForVerse(verse, ch);
    if (!n) return null;
    return (
      <button className="lib-note-dot lib-note-dot-inline" title={markerLabel(n)} aria-label={markerLabel(n)}
        onClick={(e) => { e.stopPropagation(); onOpenNote && onOpenNote(n.id); }}>
        {markerIcon(n)}
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

  // Outer span = the alignment gutter (fixed width, not interactive). Inner span =
  // the actual hit target, sized to the digits, so clicking the empty space beside
  // the number does nothing (and can't start a verse-wide text selection).
  const vnumEl = (verse, ch = selChapter) => (
    <span className="lib-vnum">
      <span
        className={"lib-vnum-num" + (handleVerseNum ? " lib-vnum-click" : "")}
        title={handleVerseNum ? "Click: cross-references · Right-click / long-press: add a note" : undefined}
        onClick={handleVerseNum ? () => {
          if (vnumPressRef.current.fired) { vnumPressRef.current.fired = false; return; }
          handleVerseNum(verse, ch);
        } : undefined}
        {...vnumNoteHandlers(verse, ch)}
      >{verse}</span>
    </span>
  );

  // Verse number for non-canonical texts: opens the note menu on right-click /
  // long-press, but no cross-references (those texts have none). Left-click is a no-op
  // (just swallows the click that follows a long-press).
  const noteVnum = (verse, cls = "lib-vnum") => (
    <span className={cls}>
      <span className="lib-vnum-num lib-vnum-click"
        title="Right-click / long-press: add a note"
        onClick={() => { if (vnumPressRef.current.fired) vnumPressRef.current.fired = false; }}
        {...vnumNoteHandlers(verse)}>{verse}</span>
    </span>
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

  // Hebrew OT interlinear verse — right-to-left chips (Hebrew over gloss over H-number).
  // Its own simple renderer (morphhb is one word = one chip; none of the ABP bracket /
  // italic / proper-noun machinery applies). Word-click hands a Hebrew entry (strongs
  // "H####") to the detail panel, which already routes H-numbers to the BDB sidebar.
  const renderHebVerse = (v) => {
    const ch = selChapter;
    const isHighlight = nav && nav.highlight === v.verse && (nav.chapter == null || nav.chapter === ch);
    const hebEntry = (w) => ({
      id: `heb-${selBook.abbrev}-${ch}-${v.verse}-${w.pos}`,
      strongs: w.strongs,             // "H7307" -> isHebrewWord -> BDB fetch
      strongs_base: w.strongs,
      strongs_raw: (w.strongs || "").replace(/^H/, ""),
      greek: "",
      translit: w.translit || "",
      gloss: w.gloss || "",
      hebrew: w.hebrew,
      morph: w.morph || "",
      grammar: w.grammar || "",
      ref: `${selBook.abbrev} ${ch}:${v.verse}`,
      book: selBook.abbrev, chapter: ch, verse: v.verse,
      is_pn: false,
      isHeb: true,   // from the Hebrew OT reader — suppress the KJV-occurrences link
    });
    return (
      <React.Fragment key={`heb-${ch}-${v.verse}`}>
        {v.heading && <div className="lib-verse-row pericope-row"><span className="lib-vnum" aria-hidden="true"/><div className="pericope-heading">{v.heading}</div></div>}
        <div ref={isHighlight ? highlightRef : null} data-note-verse={v.verse} data-note-chapter={ch}
          className={"lib-verse-row lib-heb-row" + (isHighlight ? " lib-highlight" : "")}>
          {vnumEl(v.verse, ch)}
          <span className="lib-verse-content lib-heb-content">
            {noteMarker(v.verse, ch)}
            {(v.words || []).map(w => {
              const clickable = !!(onWordClick && w.strongs);
              return (
                <span key={w.pos} data-note-pos={w.pos}
                  className={"lib-word lib-heb-word" + (clickable ? " lib-word-clickable" : "") + hiClass(v.verse, w.pos, ch)}
                  onClick={clickable ? () => onWordClick(hebEntry(w)) : undefined}>
                  <span className="lib-iw-heb">{w.hebrew}</span>
                  {showInterlinear && w.translit && <span className="lib-iw-translit">{w.translit}</span>}
                  <span className="lib-iw-english">{w.gloss}</span>
                  {showStrongs && (w.strongs
                    ? <span className="lib-iw-strongs">{w.strongs}</span>
                    : <span className="lib-iw-strongs" style={{visibility:"hidden"}}>H0</span>)}
                </span>
              );
            })}
          </span>
        </div>
      </React.Fragment>
    );
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

  // KJV / BSB / ESV read as continuous prose (paragraphs), the same flow ABP prose
  // uses — NOT one block per verse. Each verse is an inline run with a superscript
  // number; `inner` is that verse's text/words.
  const renderFlowVerse = (v, inner) => {
    const ch = v._ch ?? selChapter;
    const isHighlight = nav && nav.highlight === v.verse && (nav.chapter == null || nav.chapter === ch);
    return (
      <React.Fragment key={`${ch}-${v.verse}`}>
        {v.heading && <div className="pericope-heading">{v.heading}</div>}
        <span ref={isHighlight ? highlightRef : null} className="lib-flow-verse"
          data-note-verse={v.verse} data-note-chapter={ch}>
          <sup className="lib-flow-vnum"
               title={handleVerseNum ? "Click: cross-references · Right-click / long-press: add a note" : undefined}
               onClick={handleVerseNum ? () => {
                 if (vnumPressRef.current.fired) { vnumPressRef.current.fired = false; return; }
                 handleVerseNum(v.verse, ch);
               } : undefined}
               {...vnumNoteHandlers(v.verse, ch)}>
            {v.verse}
          </sup>
          {noteDotInline(v.verse, ch)}
          {inner}
        </span>
      </React.Fragment>
    );
  };
  // Plain-text verse (BSB + ESV).
  const plainFlowInner = (v) => {
    const ch = v._ch ?? selChapter;
    return <span className={"lib-bsb-text" + hiClass(v.verse, null, ch)}>{v.verse_text}{" "}</span>;
  };
  // KJV word list (keeps italic-addition styling), run together as prose.
  const kjvFlowInner = (v) => {
    const ch = v._ch ?? selChapter;
    return v.words.map((w, i) => (
      <span key={i} className={(w.italic ? "lib-prose-italic" : "") + hiClass(v.verse, null, ch)}>{w.word}{w.punc || ""}{" "}</span>
    ));
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
            {noteDotInline(v.verse)}
            <span className={hiClass(v.verse, null) || undefined}>{(v.english || "") + " "}</span>
          </span>
        </React.Fragment>
      ))}
    </div>
  );

  // Verse-per-line view for English-only "other books": each verse on its own row
  // with its number, like the Bible's verse layout — but plain reading text, no
  // clickable word chips (these texts have no Greek interlinear). Notes + highlights
  // ride the whole verse, same as the flowing-prose view.
  const renderExtraLines = () => (
    <div className="lib-text-words">
      {didVerses.map(v => (
        <React.Fragment key={v.verse}>
          {v.heading && <div className="lib-verse-row pericope-row"><span className="lib-vnum" aria-hidden="true"/><div className="pericope-heading">{v.heading}</div></div>}
          <div className="lib-verse-row" data-note-verse={v.verse}>
            {noteVnum(v.verse)}
            <span className="lib-verse-content">
              {noteMarker(v.verse)}
              <span className={hiClass(v.verse, null) || undefined}>{v.english || ""}</span>
            </span>
          </div>
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
          nivOwner={nivOwner}
          hebShown={hebShown}
          hebPickable={hebPickable}
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
          translation={translation}
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
          nivOwner={nivOwner}
          hebShown={hebShown}
          hebPickable={hebPickable}
          toggleParallel={toggleParallel}
          compareAvail={compareAvail}
          compareActive={compareActive}
          toggleCompare={toggleCompare}
          nonCanonList={NONCANON}
          showStrongs={showStrongs}
          showInterlinear={showInterlinear}
          setOpt={setOpt}
          chipMode={chipMode}
          viewMode={viewMode}
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
            {!nonCanon && (
              <div className="lib-other-wrap">
                <button className={"lib-toggle lib-toggle-icon" + (translation === "parallel" ? " on" : "")} title="Compare translations" aria-label="Compare translations" aria-pressed={translation === "parallel"} aria-expanded={compareOpen} onClick={() => setCompareOpen(o => !o)}><Icon.Columns/></button>
                {compareOpen && (
                  <>
                    <div className="lib-other-scrim" onClick={() => setCompareOpen(false)} />
                    <div className="lib-other-menu lib-compare-menu">
                      <div className="lib-compare-title">Compare (pick 2–4)</div>
                      {compareAvail.map(id => (
                        <label key={id} className="lib-compare-opt">
                          <input type="checkbox" checked={compareActive.includes(id)} onChange={() => toggleCompare(id)} />
                          <span>{id.toUpperCase()}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <span className="lib-bar-sep" aria-hidden="true"/>
            <div className="seg lib-view-seg">
              <button
                className={"seg-b" + (viewChipOn ? " on" : "")}
                disabled={layoutLocked}
                title={extraEnglish ? "Line-by-line view" : "Chip view"}
                aria-label={extraEnglish ? "Line-by-line view" : "Chip view"}
                aria-pressed={viewChipOn}
                style={layoutLocked ? { opacity: 0.35, cursor: "default" } : undefined}
                onClick={() => !layoutLocked && setOpt("viewMode", "chip")}
              ><Icon.Grid/></button>
              <button
                className={"seg-b" + (!viewChipOn ? " on" : "")}
                disabled={hebMode || (!extraEnglish && !proseLocked && (showStrongs || showInterlinear))}
                title="Prose view"
                aria-label="Prose view"
                aria-pressed={!viewChipOn}
                style={hebMode || (!extraEnglish && !proseLocked && (showStrongs || showInterlinear)) ? { opacity: 0.35, cursor: "default" } : undefined}
                onClick={() => { if (hebMode) return; if (extraEnglish) { setOpt("viewMode", "prose"); return; } if (!showStrongs && !showInterlinear) setOpt("viewMode", "prose"); }}
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
          {audioCapable && (
            <button className={"mbar-overview mbar-audio" + (showPause ? " on" : "")} disabled={audioBusy}
              onClick={onToolbarAudio} aria-label={showPause ? "Pause audio" : "Play chapter audio"}>
              {showPause ? <Icon.Pause/> : <Icon.Play/>}
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

      <div ref={readingRef} className={"lib-reading" + (showInterlinear ? " lib-interlinear-on" : "") + (audioDockOn ? " lib-reading--audio" : "")} style={{...(translation === "parallel" ? {paddingTop: 0} : {}), "--lib-font-size": libFontSize + "px"}} {...readingHandlers}>

        {nonCanon ? (
          didLoading ? (
            <div className="lib-loading">Loading…</div>
          ) : nonCanon.englishOnly ? (
            extraLineMode ? renderExtraLines() : renderDidacheProse()
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
          (() => {
            // Compare: render the selected texts (2-4) side by side. Each column
            // knows how to draw its own verse + its own number (shown on desktop,
            // hidden on mobile where the shared number sits above the stack).
            // Plain English columns (BSB/ESV/NIV) carry their own verse number too
            // (the shared one is mobile-only), so every desktop column shows it.
            // They also get the note anchor + highlight paint + note marker so notes
            // and highlights are SHARED across the compare columns: a highlight made
            // in any text paints the whole verse here, the pencil shows, and you can
            // drag-select inside the column to add a new one.
            const plainCol = (v) => {
              const pch = v._ch ?? selChapter;
              return (
                <span className="lib-parallel-plain" data-note-verse={v.verse} data-note-chapter={pch}>
                  {vnumEl(v.verse, pch)}
                  {noteDotInline(v.verse, pch)}
                  <span className={"lib-bsb-text" + hiClass(v.verse, null, pch)}>{v.verse_text}</span>
                </span>
              );
            };
            const colDefs = {
              abp: { label: "ABP", view: abpView, loading: abpShowLoading, render: (v) => renderVerse(v, true) },
              kjv: { label: "KJV", view: kjvView, loading: kjvShowLoading, render: (v) => (kjvWordMode ? renderKjvVerse(v, true, true) : renderKjvProse(v, true, true)) },
              bsb: { label: "BSB", view: bsbView, loading: bsbShowLoading, render: plainCol },
              esv: { label: "ESV", view: esvView, loading: esvShowLoading, render: plainCol },
              niv: { label: "NIV", view: nivView, loading: nivShowLoading, render: plainCol },
            };
            const cols = compareSel.filter(id => colDefs[id] && compareAvail.includes(id)).map(id => ({ id, ...colDefs[id] }));
            const n = Math.max(cols.length, 1);
            return (
              <div className={"lib-parallel lib-cmp-" + n}>
                <div className="lib-parallel-header">
                  {cols.map(c => <span key={c.id} className="lib-parallel-label">{c.label}</span>)}
                </div>
                {cols.some(c => c.loading) ? (
                  <div className="lib-loading">Loading…</div>
                ) : (() => {
                  // Key by chapter+verse so a chronological span (verse numbers repeat
                  // across chapters) lines the texts up; canonical has one chapter.
                  const cv = (v) => `${v._ch ?? selChapter}-${v.verse}`;
                  const maps = {};
                  cols.forEach(c => { maps[c.id] = Object.fromEntries(c.view.map(v => [cv(v), v])); });
                  // Ordered union of every verse present in any selected text.
                  const seen = new Set(); const order = [];
                  cols.forEach(c => c.view.forEach(v => {
                    const k = cv(v);
                    if (!seen.has(k)) { seen.add(k); order.push({ k, ch: v._ch ?? selChapter, verse: v.verse }); }
                  }));
                  order.sort((a, b) => a.ch - b.ch || a.verse - b.verse);
                  const items = []; let lastCh = null;
                  order.forEach(o => {
                    if (chronoOn && o.ch !== lastCh) { items.push({ type: 'chap', ch: o.ch }); lastCh = o.ch; }
                    let heading = null;
                    for (const c of cols) { const vv = maps[c.id][o.k]; if (vv && vv.heading) { heading = vv.heading; break; } }
                    if (heading) items.push({ type: 'heading', heading, key: `h-${o.k}` });
                    items.push({ type: 'verse', o });
                  });
                  return items.map(item => {
                    if (item.type === 'chap') return <div key={`cm-${item.ch}`} className="lib-chrono-chapmark">{selBook ? selBook.name : ""} {item.ch}</div>;
                    if (item.type === 'heading') return <div key={item.key} className="lib-parallel-section-heading"><div className="pericope-heading">{item.heading}</div></div>;
                    const o = item.o;
                    return (
                      <div key={o.k} className="lib-parallel-verse">
                        <div className="lib-parallel-vnum">{vnumEl(o.verse, o.ch)}</div>
                        {cols.map(c => {
                          const vv = maps[c.id][o.k];
                          return (
                            <div key={c.id} className="lib-parallel-col">
                              <span className="lib-parallel-col-lbl">{c.label}</span>
                              {vv ? c.render(vv) : null}
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()}
              </div>
            );
          })()
        ) : translation === "kjv" ? (
          kjvShowLoading ? (
            <div className="lib-loading">Loading…</div>
          ) : kjvWordMode ? (
            <div className="lib-text-words">
              {withMarks(kjvView, v => renderKjvVerse(v))}
            </div>
          ) : (
            <div className="lib-text-words lib-prose-flow">
              {withMarks(kjvView, v => renderFlowVerse(v, kjvFlowInner(v)))}
            </div>
          )
        ) : translation === "bsb" ? (
          bsbShowLoading ? (
            <div className="lib-loading">Loading…</div>
          ) : (
            <div className="lib-text-words lib-prose-flow">
              {withMarks(bsbView, v => renderFlowVerse(v, plainFlowInner(v)))}
            </div>
          )
        ) : translation === "esv" ? (
          esvShowLoading ? (
            <div className="lib-loading">Loading…</div>
          ) : (
            <div className="lib-text-words lib-prose-flow">
              {withMarks(esvView, v => renderFlowVerse(v, plainFlowInner(v)))}
            </div>
          )
        ) : translation === "niv" ? (
          nivShowLoading ? (
            <div className="lib-loading">Loading…</div>
          ) : (
            <div className="lib-text-words lib-prose-flow">
              {withMarks(nivView, v => renderFlowVerse(v, plainFlowInner(v)))}
            </div>
          )
        ) : translation === "heb" ? (
          hebLoading ? (
            <div className="lib-loading">Loading…</div>
          ) : (
            <div className="lib-text-words lib-heb-text">
              {hebVerses.map(renderHebVerse)}
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
                  {noteDotInline(v.verse, ch)}
                  {renderProseWords(v)}
                </span>
              </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
      </div>
      {focusMode && !isMobile && (() => {
        const canPrev = chronoOn ? chronoPos > 1 : selChapter > 1;
        const canNext = chronoOn ? (chrono && chronoPos < chrono.passages.length) : selChapter < maxChap;
        return (
          <>
            <button className="lib-focus-arrow lib-focus-arrow-prev" aria-label="Previous" disabled={!canPrev} onClick={() => turnPage(-1)}>‹</button>
            <button className="lib-focus-arrow lib-focus-arrow-next" aria-label="Next" disabled={!canNext} onClick={() => turnPage(1)}>›</button>
          </>
        );
      })()}
      {noteSel && <NoteAddPopover rect={noteSel.rect} isMobile={isMobile} onAdd={addNoteFromSelection} onColor={addHighlightFromSelection} onCopy={copySelection} onJournal={journalFromSelection} />}
      {flashMsg && <div className="lib-flash">{flashMsg}</div>}
      {verseMenu && <VerseNoteMenu rect={verseMenu.rect} isMobile={isMobile} onColor={vmColor} onNote={vmNote} onBookmark={vmBookmark} onCopy={vmCopy} onJournal={vmJournal} onClose={() => setVerseMenu(null)} />}
      {showSummary && (selBook || nonCanon) && (
        <SummaryPanel
          book={sumBook}
          chapter={sumChapter}
          bookLabel={sumLabel}
        />
      )}
      {isMobile && summaryOpen && (selBook || nonCanon) && (
        <SummaryPanel
          isMobile
          onClose={() => setSummaryOpen(false)}
          book={sumBook}
          chapter={sumChapter}
          bookLabel={sumLabel}
        />
      )}
    </div>
  );
}
