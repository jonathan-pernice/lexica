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

function LibNavPanel({ books, selBook, setSelBook, selChapter, setSelChapter, isOverlay, onClose, navBookRef, nonCanon, nonCanonList, onPickNonCanon, translation, corpus, pickBible, otherOpen, setOtherOpen }) {
  const [query, setQuery] = useState("");
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
          {nonCanonList && nonCanonList.length > 0 && (
            <button className={"seg-b nav-other-seg" + (nonCanon ? " on" : "")} onClick={() => setOtherOpen(o => !o)} aria-expanded={otherOpen}>
              <span className="nav-other-lbl">{nonCanon ? (nonCanon.abbr || nonCanon.name) : "Other"}</span>
              <span className={"nav-other-caret" + (otherOpen ? " open" : "")}>▾</span>
            </button>
          )}
        </div>
      </div>
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
        {nonCanon && nonCanonActive}
        {!nonCanon && groups.map(g => (
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
function MobileBookPicker({ books, selBook, selChapter, nonCanon, nonCanonList, onDone, onClose }) {
  // A non-canonical book is identified by its `id`; a Bible book by its `abbrev`.
  const isNC = b => !!(b && b.id);
  // If a non-canonical text is already open, jump straight to its chapter grid so the
  // reader can change chapter (this is the bug it fixes: the picker used to show only
  // the Bible books, stranding you on whatever Bible book was last selected).
  const [screen, setScreen] = useState(nonCanon ? "chapter" : "book");
  const [pickedBook, setPickedBook] = useState(nonCanon || null);
  // non-canonical groups start collapsed (long list); the active text's group opens.
  const [openGroups, setOpenGroups] = useState(() => new Set(nonCanon ? [nonCanon.group] : []));
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
        {onChapter
          ? <button className="mpick-back" onClick={() => setScreen("book")}>‹ Books</button>
          : <span className="mpick-head-spacer" />}
        <span className="mpick-title">{onChapter ? pickedBook.name : "Books"}</span>
        <button className="mpick-x" onClick={onClose}>✕</button>
      </div>
      <div className="mpick-scroll" ref={scrollRef}>
        {onChapter ? (
          <div className="mpick-grid">
            {Array.from({ length: pickedBook.chapters }, (_, i) => i + 1).map(n => {
              const active = isActive(pickedBook) && n === selChapter;
              return <button key={n} className={"mpick-btn" + (active ? " on" : "")} onClick={() => onDone(pickedBook, n)}>{n}</button>;
            })}
          </div>
        ) : (
          [["OT", otBooks], ["NT", ntBooks]].map(([label, bks]) => (
            <div key={label} className="mpick-section">
              <div className="mpick-sec-label">{label}</div>
              <div className="mpick-grid">
                {bks.map(b => (
                  <button key={b.abbrev} className={"mpick-btn" + (isActive(b) ? " on" : "")} onClick={() => { setPickedBook(b); setScreen("chapter"); }}>
                    {b.abbrev.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )).concat((nonCanonList || []).length ? nonCanonGroups(nonCanonList).map(grp => {
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
  corpus, translation, pickBible, toggleParallel, nonCanonList, pickNonCanon,
  showStrongs, showInterlinear, setOpt, chipMode, libFontSize, changeFontSize, onClose,
}) {
  const { sheetRef, scrollRef } = useSwipeToDismiss(onClose);
  const activeNonCanon = nonCanonList.find(t => t.id === corpus) || null;
  const proseLocked = !!(activeNonCanon && activeNonCanon.englishOnly);   // English-only: no Greek toggles
  const [otherShown, setOtherShown] = useState(false);
  // groups start collapsed (long list); the active text's group opens
  const [openGroups, setOpenGroups] = useState(() => new Set(activeNonCanon ? [activeNonCanon.group] : []));
  const toggleGroup = (g) => setOpenGroups(s => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n; });
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
              </div>
              <div className="mseg text-par">
                <button className={"mseg-b"+(translation==="parallel"?" on":"")} disabled={proseLocked} style={gray} onClick={()=>!proseLocked&&toggleParallel()}>Parallel</button>
              </div>
            </div>
            {nonCanonList.length > 0 && (
              <div className="other-acc">
                <button className="other-acc-head" onClick={()=>setOtherShown(s=>!s)} aria-expanded={otherShown}>
                  <span>Other texts</span>
                  <span className="other-acc-r">
                    {activeNonCanon && <span className="other-acc-cur">{activeNonCanon.name}</span>}
                    <span className={"other-acc-chev"+(otherShown?" open":"")}>▾</span>
                  </span>
                </button>
                {otherShown && (
                  <div className="other-acc-list">
                    {nonCanonGroups(nonCanonList).map(grp => {
                      const open = openGroups.has(grp.group);
                      return (
                        <React.Fragment key={grp.group}>
                          <button className={"other-acc-grp other-acc-grp-btn"+(open?" open":"")}
                            onClick={()=>toggleGroup(grp.group)} aria-expanded={open}>
                            <span className="other-acc-grp-chev">▸</span>
                            <span className="other-acc-grp-lbl">{grp.group}</span>
                            <span className="other-acc-grp-count">{grp.items.length}</span>
                          </button>
                          {open && grp.items.map(t => (
                            <button key={t.id} className={"other-acc-item"+(corpus===t.id?" on":"")}
                              onClick={()=>{ pickNonCanon(t); onClose(); }}>{t.name}</button>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
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
              <div className="mseg">
                <button className={"mseg-b"+(chipMode?" on":"")} disabled={proseLocked} style={gray} onClick={()=>!proseLocked&&setOpt("viewMode","chip")}>Chip</button>
                <button className={"mseg-b"+(!chipMode?" on":"")} disabled={!proseLocked&&(showStrongs||showInterlinear)} style={!proseLocked&&(showStrongs||showInterlinear)?{opacity:0.35}:undefined} onClick={()=>!showStrongs&&!showInterlinear&&setOpt("viewMode","prose")}>Prose</button>
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
function LibraryView({ nav, onNavChange, onWordClick, onVerseNumberClick, onTranslationChange, isMobile, showSummary }) {
  const [books, setBooks] = useState([]);
  const [selBook, setSelBook] = useState(null);
  const [selChapter, setSelChapter] = useState(1);
  const [verses, setVerses] = useState([]);
  const [kjvVerses, setKjvVerses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [kjvLoading, setKjvLoading] = useState(false);
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
  const nonCanon = NONCANON.find(t => t.id === corpus) || null;
  const highlightRef = useRef(null);
  const navBookRef = useRef(null);

  useEffect(() => {
    if (!nav?.book || !navBookRef.current || nav.book !== selBook?.abbrev) return;
    requestAnimationFrame(() => {
      navBookRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      setSelBook(b);
      setSelChapter(nav.chapter || 1);
      if (nav.translation) { setTranslation(nav.translation); onTranslationChange?.(nav.translation); }
    }
  }, [nav, books]);

  useEffect(() => {
    if (!selBook || nonCanon) return;   // non-canonical texts load via their own effect below
    let cancelled = false;
    setLoading(true);
    setVerses([]);
    api.chapter(selBook.abbrev, selChapter)
      .then(data => { if (!cancelled) { setVerses(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selBook && selBook.abbrev, selChapter, corpus]);

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
    if (!selBook || nonCanon || (translation !== "kjv" && translation !== "parallel")) return;
    let cancelled = false;
    setKjvLoading(true);
    setKjvVerses([]);
    api.kjvChapter(selBook.abbrev, selChapter)
      .then(data => { if (!cancelled) { setKjvVerses(data); setKjvLoading(false); } })
      .catch(() => { if (!cancelled) setKjvLoading(false); });
    return () => { cancelled = true; };
  }, [selBook && selBook.abbrev, selChapter, translation, corpus]);

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
  }, [nav?.scroll, nav?.highlight, nav?.chapter, verses, loading, selChapter]);

  const maxChap = nonCanon ? nonCanon.chapters : (selBook ? selBook.chapters : 1);

  // Pick a non-canonical text (from the "Other" menu / nav): switch the reader to it and
  // start at chapter 1. The ABP/Parallel buttons stay live and control its layout
  // (Greek interlinear vs. Greek+English columns); KJV has no meaning here, so fall
  // back to the Greek interlinear if it was active.
  const pickNonCanon = (t) => {
    setCorpus(t.id);
    setSelChapter(1);
    setOtherOpen(false);
    if (translation === "kjv") { setTranslation("abp"); onTranslationChange?.("abp"); }
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
  // Parallel is its own toggle: on shows two columns (Bible ABP|KJV, or a
  // non-canonical text's Greek|English); off returns to the single view.
  const toggleParallel = () => {
    const next = translation === "parallel" ? "abp" : "parallel";
    setTranslation(next);
    onTranslationChange?.(next);
  };
  const showStrongs     = libOptions.showStrongs     || false;
  const showInterlinear = libOptions.showInterlinear || false;
  const viewMode        = libOptions.viewMode        || "chip";
  const setOpt = (key, val) => setLibOptions(prev => ({ ...prev, [key]: val }));

  // English-only non-canonical texts (e.g. 1 Enoch) have no Greek, so the reader is
  // locked to Prose and the Greek-only toggles (Strong's / Interlinear / Parallel /
  // Chip) are disabled and grayed out.
  const proseLocked = !!(nonCanon && nonCanon.englishOnly);
  const chipMode    = !proseLocked && (viewMode === "chip" || showStrongs || showInterlinear);
  const wordMode    = chipMode;
  const kjvWordMode = chipMode;

  const POETRY_BOOKS = new Set(["Psa", "Pro", "Job", "Son", "Lam", "Ecc"]);
  const isPoetry = POETRY_BOOKS.has(selBook?.abbrev);

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
      const dx = e.changedTouches[0].clientX - swipeRef.current.x;
      const dy = e.changedTouches[0].clientY - swipeRef.current.y;
      swipeRef.current = null;
      if (Math.abs(dx) < 50) return;           // too short
      if (Math.abs(dy) > Math.abs(dx) * 0.6) return; // too vertical
      if (dx < 0 && selChapter < maxChap) {
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

  const changeFontSize = (delta) => {
    setLibFontSize(prev => {
      const next = Math.min(24, Math.max(13, prev + delta));
      localStorage.setItem("libFontSize", String(next));
      return next;
    });
  };

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

  const renderProseWords = (v) => {
    const englishWords = getEnglishOrderWords(v.words);
    return englishWords.map((w, i) => {
      const text = w.english || "";
      if (!text) return null;
      const isPunct = /^[.,;:?!—)]/.test(text);
      if (isPunct) return <span key={i}>{text}</span>;
      if (text.includes(' ')) {
        if (w.italic_words) {
          const iset = new Set(w.italic_words.split(','));
          return (
            <React.Fragment key={i}>
              {text.split(' ').filter(Boolean).map((word, pi) => {
                const bare = word.replace(/[^\w]/g,'').toLowerCase();
                return <span key={pi} className={iset.has(bare) ? "lib-prose-italic" : undefined}>{word}{" "}</span>;
              })}
            </React.Fragment>
          );
        }
        if (w.italic) {
          const headBare = w.english_head ? w.english_head.replace(/[^\w]/g,'').toLowerCase() : null;
          return (
            <React.Fragment key={i}>
              {text.split(' ').filter(Boolean).map((word, pi) => {
                const bare = word.replace(/[^\w]/g,'').toLowerCase();
                const isItalic = !headBare || bare === headBare;
                return <span key={pi} className={isItalic ? "lib-prose-italic" : undefined}>{word}{" "}</span>;
              })}
            </React.Fragment>
          );
        }
        return <span key={i}>{text + " "}</span>;
      }
      return <span key={i} className={!!w.italic ? "lib-prose-italic" : undefined}>{text + " "}</span>;
    });
  };

  const renderVerse = (v, skipHeading = false) => {
    const isHighlight = nav && nav.highlight === v.verse && (nav.chapter == null || nav.chapter === selChapter);

    const makeEntry = (w) => {
      const snum = w.strongs_base === "*" ? "*" : (w.strongs && w.strongs !== "*" ? w.strongs : w.strongs_base);
      return {
      id: `lib-${selBook.abbrev}-${selChapter}-${v.verse}-${w.position}`,
      strongs: strongsTag(snum),
      strongs_base: w.strongs_base,
      strongs_raw: snum,
      greek: w.lemma || "",
      translit: w.translit || "",
      morph: w.morph || "",
      gloss: w.english || "",
      ref: `${selBook.abbrev} ${selChapter}:${v.verse}`,
      book: selBook.abbrev,
      chapter: selChapter,
      verse: v.verse,
      definition: "",
      derivation: "",
      is_function: false,
      is_pn: !!w.is_pn,
      pn_type: w.pn_type || null,
      pn_types: w.pn_types || null,
      };
    };

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
        return (
          <React.Fragment key={key}>
            {(() => {
              const anchorIdx = strongsAnchorIndex(parts, italicSet, w);
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
        <span key={key}
          className={"lib-word" + (w.italic ? " lib-abp-italic" : "") + (isSmcap ? " lib-smcap" : "") + (clickable ? " lib-word-clickable" : "") + (isPN ? " lib-word-pn" : "")}
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
              ? <span className="lib-iw-strongs">{(w.strongs && w.strongs !== '*') ? 'G' + w.strongs : w.strongs_base}</span>
              : <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>
          )}
        </span>
      );
    };

    if (!wordMode) {
      return (
        <React.Fragment key={v.verse}>
          {!skipHeading && v.heading && <div className="lib-verse-row pericope-row"><span className="lib-vnum" aria-hidden="true"/><div className="pericope-heading">{v.heading}</div></div>}
          <div ref={isHighlight ? highlightRef : null}
            className={"lib-verse-row" + (isHighlight ? " lib-highlight" : "")}>
            {vnumEl(v.verse)}
            <span className="lib-verse-content">
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
      <React.Fragment key={v.verse}>
        {!skipHeading && v.heading && <div className="lib-verse-row pericope-row"><span className="lib-vnum" aria-hidden="true"/><div className="pericope-heading">{v.heading}</div></div>}
        <div ref={isHighlight ? highlightRef : null}
          className={"lib-verse-row" + (isHighlight ? " lib-highlight" : "")}>
          {vnumEl(v.verse)}
          <span className="lib-verse-content lib-verse-chips">{content}</span>
        </div>
      </React.Fragment>
    );
  };

  const renderKjvVerse = (v, showVerseNum = true, skipHeading = false) => {
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
      <React.Fragment key={v.verse}>
        {!skipHeading && v.heading && <div className="lib-verse-row pericope-row"><span className="lib-vnum" aria-hidden="true"/><div className="pericope-heading">{v.heading}</div></div>}
        <div className="lib-verse-row">
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
      </React.Fragment>
    );
  };

  const renderKjvProse = (v, showVerseNum = true, skipHeading = false) => {
    return (
      <React.Fragment key={v.verse}>
        {!skipHeading && v.heading && <div className="lib-verse-row pericope-row"><span className="lib-vnum" aria-hidden="true"/><div className="pericope-heading">{v.heading}</div></div>}
        <div className="lib-verse-row">
          {showVerseNum && vnumEl(v.verse)}
          <span className="lib-verse-content">
            {v.words.map((w, i) => (
              <span key={i} className={w.italic ? "lib-prose-italic" : undefined}>
                {w.word}{w.punc || ""}{" "}
              </span>
            ))}
          </span>
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
        className={"lib-word" + (clickable ? " lib-word-clickable" : "")}
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
      <div className="lib-verse-row lib-did-row">
        <span className="lib-vnum">{v.verse}</span>
        <span className="lib-verse-content lib-verse-chips">{didChips(v)}</span>
      </div>
    </React.Fragment>
  );

  // Prose view: our readable English as flowing text with verse numbers.
  const renderDidacheProse = () => (
    <div className="lib-text-words lib-prose-flow">
      {didVerses.map(v => (
        <React.Fragment key={v.verse}>
          {v.heading && <div className="pericope-heading">{v.heading}</div>}
          <span className="lib-flow-verse">
            <sup className="lib-flow-vnum">{v.verse}</sup>
            {(v.english || "") + " "}
          </span>
        </React.Fragment>
      ))}
    </div>
  );

  // Parallel view: Greek interlinear | readable English (same shape as Bible parallel).
  const renderDidacheParallelVerse = (v) => (
    <React.Fragment key={v.verse}>
      {v.heading && <div className="lib-parallel-section-heading"><div className="pericope-heading">{v.heading}</div></div>}
      <div className="lib-parallel-verse">
        <div className="lib-parallel-vnum"><span className="lib-vnum">{v.verse}</span></div>
        <div className="lib-parallel-col"><span className="lib-verse-chips">{didChips(v)}</span></div>
        <div className="lib-parallel-col"><p className="lib-did-eng">{v.english}</p></div>
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
          otherOpen={otherOpen}
          setOtherOpen={setOtherOpen}
        />
      )}
      {!navVisible && mobileNavOpen && (
        <MobileBookPicker
          books={books}
          selBook={selBook}
          selChapter={selChapter}
          nonCanon={nonCanon}
          nonCanonList={NONCANON}
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
          toggleParallel={toggleParallel}
          nonCanonList={NONCANON}
          pickNonCanon={pickNonCanon}
          showStrongs={showStrongs}
          showInterlinear={showInterlinear}
          setOpt={setOpt}
          chipMode={chipMode}
          libFontSize={libFontSize}
          changeFontSize={changeFontSize}
          onClose={() => setModesOpen(false)}
        />
      )}
      <div>
      {navVisible ? (
        <div className="lib-bar">
          <div className="lib-bar-l">
            <div className="bar-ch">
              <button
                className="ch-nav"
                disabled={selChapter <= 1}
                onClick={() => { const c = Math.max(1, selChapter - 1); setSelChapter(c); if (!nonCanon) onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null }); }}
                aria-label="Previous chapter"
              >‹</button>
              <span className="ch-lbl ch-cur" title="Current chapter — pick any chapter from the book list at left">{selChapter}</span>
              <button
                className="ch-nav"
                disabled={selChapter >= maxChap}
                onClick={() => { const c = Math.min(maxChap, selChapter + 1); setSelChapter(c); if (!nonCanon) onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null }); }}
                aria-label="Next chapter"
              >›</button>
            </div>
            <span className="lib-bar-sep" aria-hidden="true"/>
            <button className={"lib-toggle lib-toggle-icon" + (showStrongs ? " on" : "")} disabled={proseLocked} title="Strong's numbers" aria-label="Strong's numbers" aria-pressed={showStrongs} style={proseLocked ? { opacity: 0.35, cursor: "default" } : undefined} onClick={() => !proseLocked && setOpt("showStrongs", !showStrongs)}><Icon.Hash/></button>
            <button className={"lib-toggle lib-toggle-icon" + (showInterlinear ? " on" : "")} disabled={proseLocked} title="Interlinear" aria-label="Interlinear" aria-pressed={showInterlinear} style={proseLocked ? { opacity: 0.35, cursor: "default" } : undefined} onClick={() => !proseLocked && setOpt("showInterlinear", !showInterlinear)}><Icon.Interlinear/></button>
            <button className={"lib-toggle lib-toggle-icon" + (translation === "parallel" ? " on" : "")} disabled={proseLocked} title="Parallel (ABP + KJV)" aria-label="Parallel" aria-pressed={translation === "parallel"} style={proseLocked ? { opacity: 0.35, cursor: "default" } : undefined} onClick={() => !proseLocked && toggleParallel()}><Icon.Columns/></button>
            <span className="lib-bar-sep" aria-hidden="true"/>
            <div className="seg">
              <button
                className={"seg-b" + (chipMode ? " on" : "")}
                disabled={proseLocked}
                style={proseLocked ? { opacity: 0.35, cursor: "default" } : undefined}
                onClick={() => !proseLocked && setOpt("viewMode", "chip")}
              >Chip</button>
              <button
                className={"seg-b" + (!chipMode ? " on" : "")}
                disabled={!proseLocked && (showStrongs || showInterlinear)}
                style={!proseLocked && (showStrongs || showInterlinear) ? { opacity: 0.35, cursor: "default" } : undefined}
                onClick={() => !showStrongs && !showInterlinear && setOpt("viewMode", "prose")}
              >Prose</button>
            </div>
            <span className="lib-bar-sep" aria-hidden="true"/>
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
          <div className="mbar-center">
            <button className="mbar-ch-nav" disabled={selChapter <= 1} onClick={() => { const c = Math.max(1, selChapter - 1); setSelChapter(c); if (!nonCanon) onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null }); }} aria-label="Previous chapter">‹</button>
            <button className="mbar-loc" onClick={() => setMobileNavOpen(true)}>
              <span className="mbar-loc-name">{nonCanon ? nonCanon.name : (selBook ? selBook.name : "")}</span>
              <span className="mbar-loc-ch">{selChapter}</span>
            </button>
            <button className="mbar-ch-nav" disabled={selChapter >= maxChap} onClick={() => { const c = Math.min(maxChap, selChapter + 1); setSelChapter(c); if (!nonCanon) onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null }); }} aria-label="Next chapter">›</button>
          </div>
          <button className="mbar-trans" onClick={() => setModesOpen(true)} aria-label="Reading options">
            {nonCanon ? (nonCanon.abbr || nonCanon.name) : translation === "parallel" ? "Par" : translation.toUpperCase()}
          </button>
        </div>
      )}

      <div className={"lib-reading" + (showInterlinear ? " lib-interlinear-on" : "")} style={{...(translation === "parallel" ? {paddingTop: 0} : {}), "--lib-font-size": libFontSize + "px"}} {...swipeHandlers}>

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
            {(loading || kjvLoading) ? (
              <div className="lib-loading">Loading…</div>
            ) : (() => {
              const kjvMap = Object.fromEntries(kjvVerses.map(v => [v.verse, v]));
              // Build display items, lifting section headings above any preceding ABP-only verse
              const items = [];
              for (let i = 0; i < verses.length; i++) {
                const abpV = verses[i];
                const kjvV = kjvMap[abpV.verse];
                const heading = abpV.heading || (kjvV && kjvV.heading);
                if (heading) {
                  const prev = items[items.length - 1];
                  if (prev && prev.type === 'verse' && !prev.kjvV) {
                    items.splice(items.length - 1, 0, { type: 'heading', heading, key: `h-${abpV.verse}` });
                  } else {
                    items.push({ type: 'heading', heading, key: `h-${abpV.verse}` });
                  }
                }
                items.push({ type: 'verse', abpV, kjvV });
              }
              return items.map(item => {
                if (item.type === 'heading') {
                  return <div key={item.key} className="lib-parallel-section-heading"><div className="pericope-heading">{item.heading}</div></div>;
                }
                const { abpV, kjvV } = item;
                return (
                  <div key={abpV.verse} className="lib-parallel-verse">
                    <div className="lib-parallel-vnum">{vnumEl(abpV.verse)}</div>
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
          kjvLoading ? (
            <div className="lib-loading">Loading…</div>
          ) : kjvWordMode ? (
            <div className="lib-text-words">
              {kjvVerses.map(v => renderKjvVerse(v))}
            </div>
          ) : (
            <div className="lib-text-words">
              {kjvVerses.map(v => renderKjvProse(v))}
            </div>
          )
        ) : loading ? (
          <div className="lib-loading">Loading…</div>
        ) : wordMode ? (
          <div className="lib-text-words">
            {verses.map(v => renderVerse(v))}
          </div>
        ) : isPoetry ? (
          <div className="lib-text-words">
            {verses.map(v => renderVerse(v))}
          </div>
        ) : (
          <div className="lib-text-words lib-prose-flow">
            {verses.map(v => (
              <React.Fragment key={v.verse}>
                {v.heading && <div className="pericope-heading">{v.heading}</div>}
                <span className="lib-flow-verse">
                  <sup className="lib-flow-vnum"
                       onClick={handleVerseNum ? () => handleVerseNum(v.verse) : undefined}>
                    {v.verse}
                  </sup>
                  {renderProseWords(v)}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
      </div>
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
