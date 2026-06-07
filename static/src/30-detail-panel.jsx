// ============================================================
// DETAIL PANEL — SIDEBAR / BOTTOM SHEET
// ============================================================
function DetailPanel({ entry, isMobile, onClose, occurrences, totalResults, onStrongsSearch, onReadInContext, onNameSearch, onNavigateToLexicon }) {
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
    api.strongsCount(entry.strongs_raw)
      .then(d => { if (!cancelled) setAbpCount(d.count ?? null); })
      .catch(() => { if (!cancelled) setAbpCount(null); });
    return () => { cancelled = true; };
  }, [entry && entry.strongs_raw]);

  const isPN = entry && (entry.is_pn || entry.isPN || entry.strongs === "PN" || entry.strongs_base === "*");
  // A word carrying an H-number. For Hebrew PROPER NOUNS we want metaV (person/
  // place) on top with the BDB lexical entry stacked BELOW (like KJV mode):
  //  - isHebrewWord drives the BDB fetch + section (shown for ALL Hebrew words, incl. PNs)
  //  - isHebrew (excludes PNs) drives the Hebrew HERO styling + LSJ suppression, so a
  //    PN's hero shows its NAME and metaV stays the primary card.
  const isHebrewWord = entry && entry.strongs && entry.strongs.startsWith("H");
  const isHebrew = isHebrewWord && !isPN;
  // Gentilics (-ite/-ites: Hivite, Sinite, Amorite…) are eponymous people-groups
  // from the Table of Nations — labelled "People / Clan", but still shown as a
  // metaV person so the genealogy (parent/sibling clans) is preserved.
  const isGentilic = !!(isPN && entry && /ites?$/i.test(extractProperName(entry.pnName || entry.gloss || "")));

  // PN occurrence count (by name, for strongs='*' entries)
  const [pnCount, setPnCount] = useState(null);
  useEffect(() => {
    setPnCount(null);
    if (!entry.gloss) return;
    const name = extractProperName(entry.gloss);
    if (!name || name.length < 2) return;
    let cancelled = false;
    api.pnCount(name)
      .then(d => { if (!cancelled) setPnCount(d.count ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [entry && entry.id]);

  // KJV occurrence count for Hebrew words
  const [kjvCount, setKjvCount] = useState(null);
  useEffect(() => {
    setKjvCount(null);
    if ((!isHebrew && !entry.isKjv) || !entry.strongs) return;
    let cancelled = false;
    api.kjvStrongsCount(entry.strongs)
      .then(d => { if (!cancelled) setKjvCount(d.count ?? null); })
      .catch(() => { if (!cancelled) setKjvCount(null); });
    return () => { cancelled = true; };
  }, [entry && entry.strongs]);

  // metaV person/place lookup — runs on any word click where gloss may be a name
  const [metavPersonData, setMetavPersonData] = useState(null);
  const [metavPlaceData, setMetavPlaceData] = useState(null);
  const [metavTab, setMetavTab] = useState("person"); // "person" | "place"
  const [metavLoading, setMetavLoading] = useState(false);
  // Derived — all downstream code uses these unchanged
  const metavHasBoth = !!(metavPersonData && metavPlaceData);
  const metavType = metavHasBoth ? metavTab : (metavPersonData ? "person" : metavPlaceData ? "place" : null);
  const metavData = metavType === "person" ? metavPersonData : metavType === "place" ? metavPlaceData : null;
  useEffect(() => {
    setMetavPersonData(null);
    setMetavPlaceData(null);
    setMetavTab("person");
    // Skip metaV for words with a real Greek lemma — those belong to LSJ
    // Exception: KJV words that look like proper nouns (capitalized) still go through metaV
    const kjvIsPN = entry.isKjv && extractProperName(entry.pnName || entry.gloss || "") !== "";
    if (!isPN && !kjvIsPN && entry.greek && entry.translit && entry.strongs_raw !== "2316") return;
    const name = extractProperName(entry.pnName || entry.gloss || "");
    if (!name || name.length < 2) return;
    const _DIVINE_SKIP = new Set(["LORD","Lord","YHWH","Yahweh","Jehovah","Holy"]);
    if (_DIVINE_SKIP.has(name)) return;
    let cancelled = false;
    setMetavLoading(true);
    Promise.all([
      api.metavPerson(name).catch(() => ({ error: true })),
      api.metavPlace(name).catch(() => ({ error: true })),
    ]).then(([pd, ld]) => {
      if (cancelled) return;
      const personOk = !pd.error && (pd.birth_year || pd.death_year || pd.relationships?.length >= 2);
      if (personOk) setMetavPersonData(pd);
      if (!ld.error) setMetavPlaceData(ld);
      // Default tab (only matters when BOTH person+place exist). Prefer the
      // word's OWN proper-noun type from tipnr — pn_types is a SET ('person',
      // 'place', or 'person,place'; backlog #5 fix). A clean SINGLE type is
      // authoritative. When tipnr is ambiguous (a strongs shared by a person AND
      // a place → 'person,place', which strongs alone can't disambiguate) or
      // absent (pn_types null: pre-reimport, or a non-Library entry), fall back to
      // the strongs_g heuristic — flip to Place only when the place's own (G-)
      // strongs matches the clicked word's strongs_base. (Legacy pn_type is NOT
      // used: tipnr.strongs was a PK so it stored whichever type imported last.)
      const pnTypes = (entry.pn_types || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
      let tab;
      if (pnTypes.length === 1 && pnTypes[0] === "person") tab = "person";
      else if (pnTypes.length === 1 && pnTypes[0] === "place") tab = "place";
      else {
        const placeStrongsMatch = !ld.error && !!ld.strongs_g && !!entry.strongs_base &&
          ld.strongs_g.split(/[^GH0-9.]+/i).map(s => s.toUpperCase()).includes(entry.strongs_base.toUpperCase());
        tab = placeStrongsMatch ? "place" : "person";
      }
      setMetavTab(tab);
      setMetavLoading(false);
    }).catch(() => { if (!cancelled) setMetavLoading(false); });
    return () => { cancelled = true; };
  }, [entry && entry.id]);

  // AI description fallback for PN entries with no metaV data
  const [aiDescription, setAiDescription] = useState(null);
  const [aiDescLoading, setAiDescLoading] = useState(false);
  useEffect(() => {
    setAiDescription(null);
    setAiDescLoading(false);
    if (metavLoading) return;
    if (metavData && metavType === "person" && !isGentilic) return; // rich person bio replaces AI; groups still get the summary
    if (metavData && metavType === "place" && metavData.strongs_g?.length > 0) return; // place has LSJ via strongs_g
    if (isHebrew) return; // BDB covers Hebrew words
    if (!isPN) return; // only for proper nouns
    const name = extractProperName(entry.pnName || entry.gloss || "");
    if (!name || name.length < 2) return;
    let cancelled = false;
    setAiDescLoading(true);
    api.metavAiDescription(name)
      .then(d => { if (!cancelled && !d.error) setAiDescription(d.description || null); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAiDescLoading(false); });
    return () => { cancelled = true; };
  }, [entry && entry.id, metavData, metavLoading]);

  // Hebrew BDB lookup
  const [bdbEntry, setBdbEntry] = useState(null);
  const [bdbLoading, setBdbLoading] = useState(false);
  useEffect(() => {
    setBdbEntry(null);
    if (!isHebrewWord || !entry.strongs) return;
    let cancelled = false;
    setBdbLoading(true);
    api.bdb(entry.strongs)
      .then(d => { if (!cancelled) { setBdbEntry(d.error ? null : d); setBdbLoading(false); } })
      .catch(() => { if (!cancelled) { setBdbEntry(null); setBdbLoading(false); } });
    return () => { cancelled = true; };
  }, [entry && entry.id]);

  // KJV verse text (when entry came from KJV mode, or is a Hebrew word)
  const [kjvVerseText, setKjvVerseText] = useState("");
  useEffect(() => {
    setKjvVerseText("");
    if (!entry || (!entry.isKjv && !isHebrew && !(metavType === "place" && !isPN))) return;
    let cancelled = false;
    api.kjvVerse(entry.book, entry.chapter, entry.verse)
      .then(d => { if (!cancelled) setKjvVerseText(d.text || ""); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [entry && entry.id]);

  const [lsjEntry, setLsjEntry] = useState(null);
  const [lsjLoading, setLsjLoading] = useState(false);
  const [lsjTab, setLsjTab] = useState("def");
  const [lsjSummary, setLsjSummary] = useState(null);
  const [lsjSummaryLoading, setLsjSummaryLoading] = useState(false);

  useEffect(() => {
    setLsjEntry(null);
    setLsjTab("def");
    setLsjSummary(null);
    // For PN place entries with a mapped strongs_g, use that for LSJ lookup
    const placeStrongs = (isPN && metavType === "place" && metavData?.strongs_g?.length > 0)
      ? metavData.strongs_g.replace(/^G/i, "") : null;
    const canLookup = !isHebrew && entry && (entry.greek || entry.strongs_raw || placeStrongs);
    if (!canLookup) { setLsjLoading(false); return; }
    let cancelled = false;
    setLsjLoading(true);
    api.lsj(entry.greek || "", placeStrongs || entry.strongs_raw)
      .then(d => {
        if (!cancelled) { setLsjEntry(d.error ? null : d); setLsjLoading(false); }
      })
      .catch(() => {
        if (!cancelled) { setLsjEntry(null); setLsjLoading(false); }
      });
    return () => { cancelled = true; };
  }, [entry && entry.id, metavType, metavData?.strongs_g]);

  useEffect(() => {
    if (!lsjEntry || lsjEntry.source === "strongs") { setLsjSummary(null); setLsjSummaryLoading(false); return; }
    let cancelled = false;
    setLsjSummaryLoading(true);
    const summaryStrongs = lsjEntry.source === "abp_ext" ? lsjEntry.key : "";
    // Always request the verse-agnostic ("general") summary. A word's LSJ summary
    // is cached/shown universally, so it must not name the verse it was first clicked in.
    api.lsjSummary(lsjEntry.key, summaryStrongs)
      .then(d => { if (!cancelled) setLsjSummary(d); })
      .catch(() => { if (!cancelled) setLsjSummary(null); })
      .finally(() => { if (!cancelled) setLsjSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [lsjEntry && lsjEntry.key, entry && entry.id]);

  if (!entry) return null;

  const barWidth = Math.min(100, (occurrences / Math.max(1, totalResults)) * 100);
  const morphLine = (entry.greek && !isHebrew) ? decodeMorph(entry.morph, entry.greek) : "";
  const { sheetRef, scrollRef } = useSwipeToDismiss(onClose);

  // --------------------------------------------------------------------------
  // Panel descriptor — resolve the isPN / isHebrew / metavType tangle into ONE
  // place: a `hero` block and an ordered `sections` list. The return below is
  // dumb: it renders `hero`, then `sections.map(renderSection)` — no decisions.
  // --------------------------------------------------------------------------
  const properName = extractProperName(entry.gloss);
  const nameOrGloss = (isPN || metavData) ? properName : entry.gloss;
  const trimTail = (s) => stripArticles((s)?.replace(/[.,;:!?—-]+$/, "").trim());
  // Hebrew words show their gloss inline next to the transliteration; everything
  // else shows it on its own line. This boolean gates which (and the standalone).
  const heroHasHeGloss = !!(isHebrew && (bdbEntry?.xlit || entry.translit) && entry.gloss);
  const hero = {
    he: isHebrew,
    noGloss: isPN && !entry.greek && !isHebrew,
    script: isHebrew ? (bdbEntry?.lemma || entry.gloss) : (entry.greek || nameOrGloss),
    translit: isHebrew ? bdbEntry?.xlit : entry.translit,
    inlineGloss: trimTail(nameOrGloss),
    standaloneGloss: trimTail((isPN || metavData) ? properName
      : (entry.greek && (entry.gloss || "").trim().split(/\s+/).length > 2 ? entry.english_head : entry.gloss)),
    morph: morphLine,
  };

  // Verse + place sections show KJV text (not ABP) for Hebrew / KJV-mode / place words.
  const useKjvText = entry.isKjv || isHebrew || (metavType === "place" && !isPN);

  // Ordered list of stacked sections. BDB and LSJ are mutually exclusive (Hebrew
  // gets BDB; everything else may get LSJ) — same either/or as the old ternary.
  const sections = [];
  if (metavLoading || metavPersonData || metavPlaceData) sections.push("metav");
  if (aiDescription || aiDescLoading) sections.push("aidesc");
  if (isHebrewWord) sections.push("bdb");
  else if ((!isPN || (metavType === "place" && metavData?.strongs_g?.length > 0)) && metavType !== "person"
           && !aiDescription && !aiDescLoading
           && (entry.greek || entry.strongs_raw || metavData?.strongs_g?.length > 0)) sections.push("lsj");
  if (!isHebrew && !isPN && !entry.isKjv && abpCount !== null && abpCount > 0) sections.push("abpOcc");
  if (entry.isKjv && !isHebrew && !isPN && kjvCount !== null && kjvCount > 0) sections.push("kjvOcc");
  if (!entry.isKjv && isPN && pnCount !== null && pnCount > 0 && onNameSearch) sections.push("pnOcc");
  if (isHebrew && kjvCount !== null && kjvCount > 0) sections.push("hebrewKjvOcc");
  if (entry.derivation) sections.push("derivation");
  if (entry.book) sections.push("verse");
  if (occurrences > 0 || totalResults > 0) sections.push("frequency");

  const renderSection = (id) => {
    switch (id) {
    case "metav": return (
      <section key="metav" className="sec">
        {metavLoading ? (
          <div className="lsj-def lsj-def--loading">Looking up…</div>
        ) : <>
          {metavHasBoth && (
            <div className="metav-type-tabs">
              <button className={"metav-type-tab"+(metavTab==="person"?" on":"")} onClick={()=>setMetavTab("person")}>Person</button>
              <button className={"metav-type-tab"+(metavTab==="place"?" on":"")} onClick={()=>setMetavTab("place")}>Place</button>
            </div>
          )}
          {metavType === "person" && metavData ? (
          <div className="metav-person">
            <h4 className="sec-head"><span className="sec-t">{isGentilic ? "People / Clan" : "Biblical Person"}</span><span className="lsj-badge lsj-badge--gold">metaV</span></h4>
            <div className="metav-meta">
              {metavData.gender && <span className="metav-tag">{metavData.gender === "M" ? "Male" : "Female"}</span>}
              {metavData.groups.filter(g => g.startsWith("Tribe")).map(g => (
                <span key={g} className="metav-tag">{g}</span>
              ))}
              {metavData.groups.includes("Genealogy of Jesus") && <span className="metav-tag metav-tag-gold">Genealogy of Jesus</span>}
            </div>
            {(metavData.birth_year || metavData.death_year) && (
              <p className="detail-p detail-p--meta" style={{fontSize:"13px"}}>
                {metavData.birth_year && <span>Born: {metavData.birth_year}{metavData.birth_place ? `, ${metavData.birth_place}` : ""}</span>}
                {metavData.birth_year && metavData.death_year && " · "}
                {metavData.death_year && <span>Died: {metavData.death_year}{metavData.death_place ? `, ${metavData.death_place}` : ""}</span>}
              </p>
            )}
            {metavData.relationships.length > 0 && (
              <div className="metav-rels">
                {[
                  { types: ["child"],                    label: "Parent"   },
                  { types: ["father","mother"],          label: "Children" },
                  { types: ["spouseOrConcubine"],        label: "Spouse"   },
                  { types: ["sibling","halfSiblingSameFather","halfSiblingSameMother"], label: "Siblings" },
                ].map(({ types, label }) => {
                  const matching = metavData.relationships.filter(r => types.includes(r.type));
                  if (!matching.length) return null;
                  return (
                    <div key={label} className="metav-rel-row">
                      <span className="metav-rel-label">{label}</span>
                      <span className="metav-rel-names">{matching.slice(0,5).map(r => r.name).join(", ")}{matching.length > 5 ? ` +${matching.length - 5}` : ""}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : metavType === "place" && metavData ? (
          <div className="metav-place">
            <h4 className="sec-head"><span className="sec-t">{isGentilic ? "Homeland" : "Biblical Place"}</span><span className="lsj-badge lsj-badge--gold">metaV</span></h4>
            {metavData.comment && <p className="detail-p detail-p--meta">{metavData.comment}</p>}
            {metavData.lat && metavData.lon
              ? <LeafletMap lat={metavData.lat} lon={metavData.lon} name={metavData.name} />
              : <p className="detail-p detail-p--meta" style={{color:"var(--ink-4)", fontStyle:"italic"}}>Location unknown</p>
            }
          </div>
        ) : null}
        </>}
      </section>
    );
    case "aidesc": return (
      <section key="aidesc" className="sec">
        <h4 className="sec-head"><span className="sec-t">{metavType === "place" ? "Biblical Place" : "Biblical Reference"}</span><span className="lsj-badge lsj-badge--accent">AI</span></h4>
        {aiDescLoading
          ? <div className="lsj-def lsj-def--loading">Looking up…</div>
          : <p className="detail-p detail-p--meta">{aiDescription}</p>
        }
      </section>
    );
    case "bdb": return (
      <section key="bdb" className="sec">
        <h4 className="sec-head"><span className="sec-t">Brown-Driver-Briggs</span><span className="bdb-badge">BDB</span></h4>
        {bdbLoading ? (
          <div className="lsj-def lsj-def--loading">Loading…</div>
        ) : bdbEntry ? (
          <div className="bdb-body">
            {bdbEntry.pronounce && <div className="bdb-xlit"><span className="bdb-pronounce">{bdbEntry.pronounce}</span></div>}
            {bdbEntry.part_of_speech && <span className="bdb-pos-badge">{bdbEntry.part_of_speech}</span>}
            {bdbEntry.description && <p className="detail-p detail-p--meta">{bdbEntry.description}</p>}
          </div>
        ) : (
          <div className="lsj-def lsj-def--loading">Not found in BDB.</div>
        )}
      </section>
    );
    case "lsj": return (
      <section key="lsj" className="sec">
        <div className="lsj-head">
          <h4 className="sec-head">
            <span className="sec-t">
              {lsjEntry && lsjEntry.source === "abp_ext"
                ? <>ABP Extended<span className="abp-badge">ABP EXT</span></>
                : <>Liddell-Scott-Jones<span className="lsj-badge">LSJ</span></>}
            </span>
          </h4>
          {lsjEntry && (
            <div className="lsj-tabs">
              <button className={"lsj-tab " + (lsjTab === "def"  ? "on" : "")} onClick={() => setLsjTab("def")}>Definition</button>
              <button className={"lsj-tab " + (lsjTab === "full" ? "on" : "")} onClick={() => setLsjTab("full")}>
                {lsjEntry.source === "abp_ext" ? "Full ABP" : "Full LSJ"}
              </button>
            </div>
          )}
        </div>
        {lsjLoading ? (
          <div className="lsj-def lsj-def--loading">Loading…</div>
        ) : lsjEntry ? (
          lsjTab === "def"
            ? lsjEntry.source === "strongs"
              ? <div className="lsj-def" dangerouslySetInnerHTML={{ __html: lsjEntry.def_html }} />
              : <LsjSummary data={lsjSummary} loading={lsjSummaryLoading} />
            : <div className="lsj-def" dangerouslySetInnerHTML={{ __html: lsjEntry.def_html }} />
        ) : (
          <div className="lsj-def lsj-def--loading">Not found.</div>
        )}
      </section>
    );
    case "abpOcc": return (
      <section key="abpOcc" className="sec">
        <h4 className="sec-head"><span className="sec-t">ABP Occurrences</span></h4>
        <button className="occ-link" onClick={() => onNavigateToLexicon && onNavigateToLexicon(entry.strongs_raw)}>
          <b>{abpCount}</b>× in LXX <Icon.ArrowRight/>
        </button>
      </section>
    );
    case "kjvOcc": return (
      <section key="kjvOcc" className="sec">
        <h4 className="sec-head"><span className="sec-t">KJV Occurrences</span></h4>
        <button className="occ-link" onClick={() => onNavigateToLexicon && onNavigateToLexicon(entry.strongs)}>
          <b>{kjvCount}</b>× in KJV <Icon.ArrowRight/>
        </button>
      </section>
    );
    case "pnOcc": return (
      <section key="pnOcc" className="sec">
        <h4 className="sec-head"><span className="sec-t">ABP Occurrences</span></h4>
        <button className="occ-link" onClick={() => onNameSearch(extractProperName(entry.gloss))}>
          <b>{pnCount}</b>× in LXX <Icon.ArrowRight/>
        </button>
      </section>
    );
    case "hebrewKjvOcc": return (
      <section key="hebrewKjvOcc" className="sec">
        <h4 className="sec-head"><span className="sec-t">KJV Occurrences</span></h4>
        <button className="occ-link" onClick={() => onNavigateToLexicon && onNavigateToLexicon(entry.strongs)}>
          <b>{kjvCount}</b>× in KJV <Icon.ArrowRight/>
        </button>
      </section>
    );
    case "derivation": return (
      <section key="derivation" className="sec">
        <h4 className="sec-head"><span className="sec-t">Derivation</span></h4>
        <p className="detail-p">
          {entry.derivation.split(/\b(G\d[\d.]*)/i).map((part, i) =>
            /^G\d[\d.]*/i.test(part)
              ? <button key={i} className="link-btn link-btn--strong" onClick={() => onNavigateToLexicon?.(part)}>{part}</button>
              : part
          )}
        </p>
      </section>
    );
    case "verse": return (
      <section key="verse" className="sec">
        <h4 className="sec-head">
          <span className="sec-t">Verse — {entry.ref}</span>
          <span className="sec-meta">{useKjvText ? "KJV" : "LXX (ABP English)"}</span>
        </h4>
        <blockquote className="dverse">
          <span className="dverse-n">{entry.verse}</span>
          {useKjvText ? (kjvVerseText || "—") : (verseLoading ? "Loading…" : verseText || "—")}
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
                {(w.strongs || w.strongs_base) && w.strongs_base !== "*" && (
                  <span className="iw-strongs">{strongsTag((w.strongs && w.strongs !== '*') ? w.strongs : w.strongs_base)}</span>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="dverse-tools">
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
    );
    case "frequency": return (
      <section key="frequency" className="sec">
        <h4 className="sec-head"><span className="sec-t">Frequency</span></h4>
        <div className="freq">
          <div className="freq-bar">
            <div className="freq-fill" style={{ width: barWidth + "%" }}></div>
          </div>
          <div className="freq-meta">
            <span><b>{occurrences}</b>× in current results</span>
          </div>
        </div>
      </section>
    );
    default: return null;
    }
  };

  return (
    <aside ref={isMobile ? sheetRef : null} className={"detail " + (isMobile ? "detail-sheet" : "detail-side")} role="dialog" aria-label="Lexicon detail">
      {isMobile && <div className="sheet-drag-zone" aria-hidden="true"><div className="sheet-handle"></div></div>}
      <div className="detail-head">
        <div className="detail-head-l">
          <span className="card-badge solid">{entry.strongs}</span>
          <span className="detail-pos">{BOOK_LABELS[entry.book] || entry.book}</span>
        </div>
        <button className="detail-close" onClick={onClose} aria-label="Close">
          <Icon.Close/>
        </button>
      </div>

      <div className="detail-body" ref={isMobile ? scrollRef : null}>
        <div className={"detail-hero" + (hero.noGloss ? " no-gloss" : "")}>
          <div className={"detail-greek" + (hero.he ? " detail-greek--he" : "")}
               dir={hero.he ? "rtl" : undefined}>
            {hero.script}
          </div>
          <div className={"detail-translit-row" + (hero.he ? " detail-translit-row-he" : "")}>
            <span className="detail-translit">{hero.translit}</span>
            {heroHasHeGloss && (
              <><span className="detail-sep">·</span><span className="detail-gloss">{hero.inlineGloss}</span></>
            )}
          </div>
          {!hero.noGloss && !heroHasHeGloss && (
            <div className="detail-gloss">{hero.standaloneGloss}</div>
          )}
          {hero.morph && <div className="detail-morph">{hero.morph}</div>}
        </div>

        {sections.map(renderSection)}
      </div>
    </aside>
  );
}
