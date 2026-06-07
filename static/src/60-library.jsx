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

function LibNavPanel({ books, selBook, setSelBook, selChapter, setSelChapter, isOverlay, onClose, navBookRef }) {
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
    <nav className={"nav" + (isOverlay ? " nav-overlay" : "")} aria-label="Books">
      <div className="nav-top">
        {isOverlay && <button className="nav-x" onClick={onClose} aria-label="Close">✕</button>}
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
function MobileBookPicker({ books, selBook, selChapter, onDone, onClose }) {
  const [screen, setScreen] = useState("book");
  const [pickedBook, setPickedBook] = useState(null);

  const otBooks = books.filter(b => !NT_BOOKS.has(b.abbrev));
  const ntBooks = books.filter(b => NT_BOOKS.has(b.abbrev));

  if (screen === "chapter") {
    return (
      <div className="mpick">
        <div className="mpick-head">
          <button className="mpick-back" onClick={() => setScreen("book")}>‹ Books</button>
          <span className="mpick-title">{pickedBook.name}</span>
          <button className="mpick-x" onClick={onClose}>✕</button>
        </div>
        <div className="mpick-scroll">
          <div className="mpick-grid">
            {Array.from({ length: pickedBook.chapters }, (_, i) => i + 1).map(n => {
              const active = selBook && pickedBook.abbrev === selBook.abbrev && n === selChapter;
              return <button key={n} className={"mpick-btn" + (active ? " on" : "")} onClick={() => onDone(pickedBook, n)}>{n}</button>;
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mpick">
      <div className="mpick-head">
        <span className="mpick-head-spacer" />
        <span className="mpick-title">Books</span>
        <button className="mpick-x" onClick={onClose}>✕</button>
      </div>
      <div className="mpick-scroll">
        {[["OT", otBooks], ["NT", ntBooks]].map(([label, bks]) => (
          <div key={label} className="mpick-section">
            <div className="mpick-sec-label">{label}</div>
            <div className="mpick-grid">
              {bks.map(b => (
                <button key={b.abbrev} className={"mpick-btn" + (selBook && b.abbrev === selBook.abbrev ? " on" : "")} onClick={() => { setPickedBook(b); setScreen("chapter"); }}>
                  {b.abbrev.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// LIBRARY VIEW
// ============================================================
function LibraryView({ nav, onNavChange, onWordClick, onVerseNumberClick, onTranslationChange, isMobile }) {
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
  const [translation, setTranslation] = useState("abp"); // "abp" | "kjv" | "parallel"
  const highlightRef = useRef(null);
  const navBookRef = useRef(null);

  useEffect(() => {
    if (!nav?.book || !navBookRef.current || nav.book !== selBook?.abbrev) return;
    requestAnimationFrame(() => {
      navBookRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [nav?.book, selBook?.abbrev]);
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

  const maxChap = selBook ? selBook.chapters : 1;
  const showStrongs     = libOptions.showStrongs     || false;
  const showInterlinear = libOptions.showInterlinear || false;
  const viewMode        = libOptions.viewMode        || "chip";
  const setOpt = (key, val) => setLibOptions(prev => ({ ...prev, [key]: val }));

  const chipMode    = viewMode === "chip" || showStrongs || showInterlinear;
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
        onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null });
      } else if (dx > 0 && selChapter > 1) {
        const c = selChapter - 1;
        setSelChapter(c);
        onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null });
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
    const isHighlight = nav && nav.highlight === v.verse;

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

  return (
    <div className="library">
      {navVisible && (
        <LibNavPanel
          books={books}
          selBook={selBook}
          setSelBook={setSelBook}
          selChapter={selChapter}
          setSelChapter={setSelChapter}
          navBookRef={navBookRef}
        />
      )}
      {!navVisible && mobileNavOpen && (
        <MobileBookPicker
          books={books}
          selBook={selBook}
          selChapter={selChapter}
          onDone={(b, n) => { setSelBook(b); setSelChapter(n); setMobileNavOpen(false); }}
          onClose={() => setMobileNavOpen(false)}
        />
      )}
      {!navVisible && modesOpen && (
        <>
          <div className="sheet-scrim" onClick={() => setModesOpen(false)} />
          <div className="msheet">
            <div className="msheet-handle" aria-hidden="true" />
            <div className="msheet-head">
              <span className="msheet-title">Reading</span>
              <button className="msheet-x" onClick={() => setModesOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="mode-sec">
              <div className="mode-lbl">Edition</div>
              <div className="mseg">
                <button className={"mseg-b"+(translation==="abp"?" on":"")} onClick={()=>{setTranslation("abp");onTranslationChange?.("abp");}}>ABP</button>
                <button className={"mseg-b"+(translation==="kjv"?" on":"")} onClick={()=>{setTranslation("kjv");onTranslationChange?.("kjv");}}>KJV</button>
                <button className={"mseg-b"+(translation==="parallel"?" on":"")} onClick={()=>{setTranslation("parallel");onTranslationChange?.("parallel");}}>Parallel</button>
              </div>
            </div>
            <div className="mode-sec">
              <div className="mode-lbl">Study layer</div>
              <div className="mtog">
                <div className="mtog-row">
                  <div className="mtog-txt">
                    <div className="mtog-name">Strong's numbers</div>
                    <div className="mtog-sub">Tap a word for its lexicon entry</div>
                  </div>
                  <button className={"switch"+(showStrongs?" on":"")} onClick={()=>setOpt("showStrongs",!showStrongs)} aria-label="Toggle Strong's" aria-pressed={showStrongs} />
                </div>
                <div className="mtog-row">
                  <div className="mtog-txt">
                    <div className="mtog-name">Interlinear</div>
                    <div className="mtog-sub">Stack Greek, transliteration &amp; gloss</div>
                  </div>
                  <button className={"switch"+(showInterlinear?" on":"")} onClick={()=>setOpt("showInterlinear",!showInterlinear)} aria-label="Toggle Interlinear" aria-pressed={showInterlinear} />
                </div>
              </div>
            </div>
            <div className="mode-sec">
              <div className="mode-lbl">Layout</div>
              <div className="mseg">
                <button className={"mseg-b"+(chipMode?" on":"")} onClick={()=>setOpt("viewMode","chip")}>Chip</button>
                <button className={"mseg-b"+(!chipMode?" on":"")} disabled={showStrongs||showInterlinear} style={showStrongs||showInterlinear?{opacity:0.35}:undefined} onClick={()=>!showStrongs&&!showInterlinear&&setOpt("viewMode","prose")}>Prose</button>
              </div>
            </div>
            <div className="mode-sec">
              <div className="mode-lbl">Font Size</div>
              <div className="mseg font-picker">
                <button className="mseg-b" onClick={() => changeFontSize(-1)}>A−</button>
                <span className="font-size-lbl">{libFontSize}</span>
                <button className="mseg-b" onClick={() => changeFontSize(+1)}>A+</button>
              </div>
            </div>
          </div>
        </>
      )}
      <div>
      {navVisible ? (
        <div className="lib-bar">
          <div className="lib-bar-l">
            <div className="bar-ch">
              <button
                className="ch-nav"
                disabled={selChapter <= 1}
                onClick={() => { const c = Math.max(1, selChapter - 1); setSelChapter(c); onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null }); }}
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
                onClick={() => { const c = Math.min(maxChap, selChapter + 1); setSelChapter(c); onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null }); }}
                aria-label="Next chapter"
              >›</button>
            </div>
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
                className={"seg-b" + (chipMode ? " on" : "")}
                onClick={() => setOpt("viewMode", "chip")}
              >Chip</button>
              <button
                className={"seg-b" + (!chipMode ? " on" : "")}
                disabled={showStrongs || showInterlinear}
                style={showStrongs || showInterlinear ? { opacity: 0.35, cursor: "default" } : undefined}
                onClick={() => !showStrongs && !showInterlinear && setOpt("viewMode", "prose")}
              >Prose</button>
            </div>
            <span className="lib-bar-sep" aria-hidden="true"/>
            <div className="seg">
              <button className="seg-b" onClick={() => changeFontSize(-1)}>A−</button>
              <span className="font-size-lbl">{libFontSize}</span>
              <button className="seg-b" onClick={() => changeFontSize(+1)}>A+</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="lib-toolbar">
          <div className="mbar-logo-btn" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5a2.5 2.5 0 0 0 0 5H19v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M11 7v6M14 10h-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="mbar-center">
            <button className="mbar-ch-nav" disabled={selChapter <= 1} onClick={() => { const c = Math.max(1, selChapter - 1); setSelChapter(c); onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null }); }} aria-label="Previous chapter">‹</button>
            <button className="mbar-loc" onClick={() => setMobileNavOpen(true)}>
              <span className="mbar-loc-name">{selBook ? selBook.name : ""}</span>
              <span className="mbar-loc-ch">{selChapter}</span>
            </button>
            <button className="mbar-ch-nav" disabled={selChapter >= maxChap} onClick={() => { const c = Math.min(maxChap, selChapter + 1); setSelChapter(c); onNavChange?.({ ...nav, book: selBook?.abbrev, chapter: c, highlight: null }); }} aria-label="Next chapter">›</button>
          </div>
          <button className="mbar-trans" onClick={() => setModesOpen(true)} aria-label="Reading options">
            {translation === "parallel" ? "Par" : translation.toUpperCase()}
          </button>
        </div>
      )}

      <div className={"lib-reading" + (showInterlinear ? " lib-interlinear-on" : "")} style={{...(translation === "parallel" ? {paddingTop: 0} : {}), "--lib-font-size": libFontSize + "px"}} {...swipeHandlers}>

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
    </div>
  );
}
