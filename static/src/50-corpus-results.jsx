function corpusWordLabel(w) {
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
// SHARED VERSE ROW — used by both Search (CorpusGroup) and the Lexicon tab.
// Lazy-loads its own words; highlights any word whose Strong's is in citedStrongs.
// ============================================================
function VerseRow({ book, chapter, verse, label, allResults, onWordClick, onReadInContext, textMode, primaryStrongs, citedStrongs, kjvCache }) {
  const [words, setWords] = useState(null);
  const [kjvText, setKjvText] = useState(null);
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

  useEffect(() => {
    if (!visible || textMode !== "kjv") return;
    const cacheKey = `${book}:${chapter}:${verse}`;
    if (kjvCache && kjvCache[cacheKey]) {
      setKjvText(kjvCache[cacheKey]);
      return;
    }
    let cancelled = false;
    setKjvText(null);
    api.kjvVerseWords(book, chapter, verse)
      .then(d => { if (!cancelled) setKjvText(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setKjvText([]); });
    return () => { cancelled = true; };
  }, [visible, book, chapter, verse, textMode, kjvCache]);

  const entryMap = useMemo(() => {
    const m = new Map();
    for (const e of allResults) {
      if (e.book === book && e.chapter === chapter && e.verse === verse) {
        if (!m.has(e.strongs_raw)) m.set(e.strongs_raw, e);
        // Also index by bare number to handle G/H prefix inconsistency
        const bare = (e.strongs_raw || "").replace(/^[GH]/i, "");
        if (bare && !m.has(bare)) m.set(bare, e);
      }
    }
    return m;
  }, [allResults, book, chapter, verse]);

  // citedStrongs is now passed directly as a prop from App level — no local computation needed

  return (
    <div className="corpus-verse" ref={rowRef}>
      <button className="corpus-ref" onClick={() => onReadInContext?.(book, chapter, verse)}>{label}</button>
      <span className="corpus-text">
        {textMode === "kjv" ? (
          kjvText === null
            ? <span style={{ color: "var(--ink-4)", fontSize: "13px" }}>Loading…</span>
            : kjvText.map((w, i) => {
                const sid = w.strongs_ids && w.strongs_ids.length ? w.strongs_ids[0] : null;
                const sidBare = sid ? sid.replace(/^[GH]/i, "") : null;
                const isCited = sid && citedStrongs != null && citedStrongs.size > 0 &&
                  (citedStrongs.has(sid) || citedStrongs.has(sidBare));
                const kjvEntry = sid ? {
                  id: `kjvcorpus-${book}-${chapter}-${verse}-${i}`,
                  strongs: sid,
                  strongs_base: sid.slice(1),
                  strongs_raw: sid.slice(1),
                  greek: w.lemma || "",
                  translit: w.xlit || "",
                  gloss: w.word,
                  ref: `${book} ${chapter}:${verse}`,
                  book, chapter, verse,
                  definition: "", derivation: "", is_function: false,
                  isKjv: true,
                  isHebrew: sid.startsWith("H"),
                } : null;
                return (
                  <span key={i} className={"lib-word" + (sid ? " lib-word-clickable" : "") + (w.italic ? " lib-kjv-italic" : "") + (isCited ? " cited" : "")}
                    onClick={kjvEntry && onWordClick ? () => onWordClick(kjvEntry) : undefined}>
                    <span className="lib-iw-english">{w.word}{w.punc || ""}</span>
                  </span>
                );
              })
        ) : words === null ? (
          <span style={{ color: "var(--ink-4)", fontSize: "13px" }}>Loading…</span>
        ) : (() => {
          function renderCorpusWord(w, key) {
            const label = corpusWordLabel(w);
            if (!label) return null;
            const isPN = !!(w.is_pn || w.strongs_base === "*");
            const clickable = !!(w.strongs_base && (w.strongs_base !== "*" || w.english));
            const wnum = (w.strongs && w.strongs !== "*") ? w.strongs : w.strongs_base;
            const foundEntry = !isPN && clickable && entryMap.get(wnum);
            const entry = clickable && (foundEntry
              ? { ...foundEntry, gloss: w.english || foundEntry.gloss }
              : {
                id: `corpus-${book}-${chapter}-${verse}-${key}`,
                strongs: strongsTag(wnum),
                strongs_base: w.strongs_base,
                strongs_raw: wnum,
                greek: w.lemma || "",
                translit: w.translit || "",
                gloss: label,
                ref: `${book} ${chapter}:${verse}`,
                book, chapter, verse,
                definition: "", derivation: "", is_function: false,
                ...(isPN ? { isPN: true, pnName: label } : {}),
              });
            const hasPos = w.greek_pos !== null && w.greek_pos !== undefined;
            const bareNum = strongsBare(w.strongs_base);
            const isCited = clickable && citedStrongs != null && citedStrongs.size > 0 &&
              (citedStrongs.has(w.strongs_base) || citedStrongs.has(bareNum));
            // Multi-word gloss with italic_words: split into separate chips (mirrors library)
            if (label.includes(' ') && w.italic_words) {
              const iset = new Set(w.italic_words.split(','));
              return (
                <React.Fragment key={key}>
                  {label.split(' ').filter(Boolean).map((word, pi) => {
                    const bare = word.replace(/[^\w]/g, '').toLowerCase();
                    const isItal = iset.has(bare);
                    return (
                      <span key={pi} className={"lib-word" + (!isItal && clickable ? " lib-word-clickable" : "") + (isItal ? " lib-abp-italic" : "") + (!isItal && isCited ? " cited" : "")}
                            onClick={!isItal && clickable ? () => onWordClick(entry) : undefined}>
                        <span className="lib-iw-english">{word}</span>
                      </span>
                    );
                  })}
                </React.Fragment>
              );
            }
            return (
              <span key={key} className={"lib-word" + (clickable ? " lib-word-clickable" : "") + (w.italic ? " lib-abp-italic" : "") + (isCited ? " cited" : "")}
                    onClick={clickable ? () => onWordClick(entry) : undefined}>
                <span className="lib-iw-pos-english">
                  {hasPos && <span className="lib-iw-pos">{w.greek_pos}</span>}
                  <span className="lib-iw-english">{label}</span>
                </span>
              </span>
            );
          }
          const groups = groupForGreekMode(words.filter(w => w.english).sort((a, b) => a.position - b.position));
          return groups.map((g, gi) => {
            if (!g.isBracket) return renderCorpusWord(g.word, `g${gi}`);
            const corpusBracketChar = (ch, k) => (
              <span key={k} className="lib-bracket">
                <span className="lib-bracket-glyph">{ch}</span>
              </span>
            );
            return (
              <span key={`bg${gi}`} className="lib-bracket-group">
                {corpusBracketChar("[", "bl")}
                {g.words.map((w, wi) => renderCorpusWord(w, `bg${gi}w${wi}`))}
                {corpusBracketChar("]", "br")}
              </span>
            );
          });
        })()}
      </span>
    </div>
  );
}

// ============================================================
// CORPUS SEARCH — PASSAGE GROUP (collapsible book+chapter section)
// ============================================================
function CorpusGroup({ label, verses, allResults, onWordClick, onReadInContext, textMode, primaryStrongs, citedStrongs, kjvCache }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="corpus-group">
      <button
        className={"corpus-group-head " + (open ? "open" : "")}
        onClick={() => setOpen(o => !o)}
      >
        <Icon.Book style={{ opacity: 0.5, flexShrink: 0 }}/>
        <span className="corpus-group-label">{label}</span>
        <span className="corpus-group-count">{verses.length} verse{verses.length !== 1 ? "s" : ""}</span>
        <span className={"corpus-chevron " + (open ? "open" : "")}/>
      </button>
      {open && (
        <div className="corpus-group-body">
          {verses.map(v => (
            <VerseRow
              key={`${v.book}-${v.chapter}-${v.verse}`}
              book={v.book}
              chapter={v.chapter}
              verse={v.verse}
              label={v.ref}
              allResults={allResults}
              onWordClick={onWordClick}
              onReadInContext={onReadInContext}
              textMode={textMode}
              primaryStrongs={primaryStrongs}
              citedStrongs={citedStrongs}
              kjvCache={kjvCache}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// CORPUS SEARCH — OUTER CONTAINER
// ============================================================
function CorpusResults({ allResults, primaryStrongs, citedStrongs, showAll, onWordClick, onReadInContext, corpusSort, textMode }) {
  const [kjvCache, setKjvCache] = useState({}); // pre-fetched KJV verse words

  // Pre-fetch all KJV verse words in one batch when switching to KJV mode
  React.useEffect(() => {
    if (textMode !== "kjv" || !allResults.length) return;
    const seen = new Set();
    const refs = [];
    for (const e of allResults) {
      const key = `${e.book}:${e.chapter}:${e.verse}`;
      if (!seen.has(key)) { seen.add(key); refs.push({book: e.book, chapter: e.chapter, verse: e.verse}); }
    }
    if (!refs.length) return;
    let cancelled = false;
    api.kjvVerseWordsBatch(refs)
      .then(data => { if (!cancelled) setKjvCache(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [textMode, allResults]);

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
        if (corpusSort === "canonical") {
          const bookDiff = (BOOK_ORDER[a.verses[0]?.book] ?? 99) - (BOOK_ORDER[b.verses[0]?.book] ?? 99);
          return bookDiff || (a.verses[0]?.chapter ?? 0) - (b.verses[0]?.chapter ?? 0);
        }
        const aPrimary = a.verses.filter(v => v.is_primary).length;
        const bPrimary = b.verses.filter(v => v.is_primary).length;
        return bPrimary - aPrimary || b.verses.length - a.verses.length;
      });
  }, [allResults, corpusSort]);

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

  const passageGroupProps = { allResults, onWordClick, onReadInContext, textMode, primaryStrongs, citedStrongs, kjvCache };

  return (
    <div className="corpus-groups">

      {primaryGroups.map(g => (
        <CorpusGroup key={g.label} label={g.label} verses={g.verses} {...passageGroupProps} />
      ))}
      {additionalGroups.length > 0 && (
        <div className="additional-refs-section">
          <div className="additional-refs-label">Additional references</div>
          {additionalGroups.map(g => (
            <CorpusGroup key={g.label} label={g.label} verses={g.verses} {...passageGroupProps} />
          ))}
        </div>
      )}
      {showAll && otherGroups.map(g => (
        <CorpusGroup key={g.label} label={g.label} verses={g.verses} {...passageGroupProps} />
      ))}
    </div>
  );
}
