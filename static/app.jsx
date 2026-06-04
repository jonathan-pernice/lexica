const { useState, useEffect, useRef, useMemo } = React;

const _ARTICLE_RE = /^((?:the|a|an|his|her|its|of|my|your|their|our)\s+)+/i;
function stripArticles(s) {
  if (!s) return s;
  return s.replace(_ARTICLE_RE, "").trim() || s;
}

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
  lsj: (lemma, strongs) => {
    const path = lemma || strongs || '';
    if (!path) return Promise.resolve({ error: 'not found' });
    const qs = strongs ? `?strongs=${encodeURIComponent(strongs)}` : '';
    return fetch(`/api/lsj/${encodeURIComponent(path)}${qs}`).then(r => r.json());
  },
  lsjSummary: (key, strongs, book, chapter, verse) => {
    const hasDot = strongs && strongs.includes('.');
    const path = key || (hasDot ? strongs : '');
    if (!path) return Promise.resolve({ error: 'not found' });
    const p = new URLSearchParams();
    if (hasDot) p.set('strongs', strongs);
    if (book && chapter && verse) { p.set('book', book); p.set('chapter', chapter); p.set('verse', verse); }
    const qs = p.toString() ? `?${p}` : '';
    return fetch(`/api/lsj-summary/${encodeURIComponent(path)}${qs}`).then(r => r.json());
  },
  books: () =>
    fetch("/api/books").then(r => r.json()),
  chapter: (book, ch) =>
    fetch(`/api/chapter/${encodeURIComponent(book)}/${ch}`).then(r => r.json()),
  kjvChapter: (book, ch) =>
    fetch(`/api/kjv/chapter/${encodeURIComponent(book)}/${ch}`).then(r => r.json()),
  kjvVerse: (book, ch, v) =>
    fetch(`/api/kjv/verse/${encodeURIComponent(book)}/${ch}/${v}`).then(r => r.json()),
  kjvVerseWords: (book, ch, v) =>
    fetch(`/api/kjv/verse_words/${encodeURIComponent(book)}/${ch}/${v}`).then(r => r.json()),
  kjvVerseWordsBatch: (refs) =>
    fetch('/api/kjv/verse_words_batch', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(refs)}).then(r => r.json()),
  kjvStrongsCount: (strongs_id) =>
    fetch(`/api/kjv/strongs-count/${encodeURIComponent(strongs_id)}`).then(r => r.json()),
  kjvStrongsSearch: (strongs_id) =>
    fetch(`/api/kjv/strongs-search/${encodeURIComponent(strongs_id)}`).then(r => r.json()),
  pnCount: (name) =>
    fetch(`/api/pn-count/${encodeURIComponent(name)}`).then(r => r.json()),
  metavPerson: (name) =>
    fetch(`/api/metav/person/${encodeURIComponent(name)}`).then(r => r.json()),
  metavAiDescription: (name) =>
    fetch(`/api/metav/ai-description/${encodeURIComponent(name)}`).then(r => r.json()),
  metavPlace: (name) =>
    fetch(`/api/metav/place/${encodeURIComponent(name)}`).then(r => r.json()),
  bdb: (sid) =>
    fetch(`/api/bdb/${encodeURIComponent(sid)}`).then(r => r.json()),
  crossRefsCurated: (book, chapter, verse) =>
    fetch(`/api/cross-references/curated/${encodeURIComponent(book)}/${chapter}/${verse}`).then(r => r.json()),
  lexiconLookup: (q) =>
    fetch(`/api/lexicon/lookup?q=${encodeURIComponent(q)}`).then(r => r.json()),
  lexiconProfile: (strongs, corpus) =>
    fetch(`/api/lexicon/profile/${encodeURIComponent(strongs)}${corpus ? `?corpus=${corpus}` : ""}`).then(r => r.json()),
  lexiconVerses: (strongs, book, corpus, gloss) =>
    fetch(`/api/lexicon/verses/${encodeURIComponent(strongs)}/${encodeURIComponent(book)}?corpus=${corpus}${gloss ? `&gloss=${encodeURIComponent(gloss)}` : ""}`).then(r => r.json()),
  lexiconBooks: (strongs, corpus, gloss) =>
    fetch(`/api/lexicon/books/${encodeURIComponent(strongs)}?corpus=${corpus}${gloss ? `&gloss=${encodeURIComponent(gloss)}` : ""}`).then(r => r.json()),
  lexiconEnglish: (q, corpus, testament) =>
    fetch(`/api/lexicon/english?q=${encodeURIComponent(q)}&corpus=${encodeURIComponent(corpus)}${testament && testament !== "all" ? `&testament=${encodeURIComponent(testament)}` : ""}`).then(r => r.json()),
};

// Extract proper noun name from a multi-word gloss, skipping function words
const _PN_STOP = new Set(["And","But","Or","The","A","An","In","Of","To","For","With","From","By","At","His","Her","Its","Their","My","Your","Our"]);
function extractProperName(gloss) {
  if (!gloss) return "";
  const clean = gloss.replace(/[^a-zA-Z\s'-]/g, "").trim();
  const proper = clean.split(/\s+/).find(w => /^[A-Z]/.test(w) && !_PN_STOP.has(w));
  return proper || "";
}

// ============================================================
// DATA SHAPING
// ============================================================
function strongsTag(snum) {
  if (!snum || snum === "*") return "PN";
  const s = String(snum);
  const hasH = /^H/i.test(s);
  const bare = s.replace(/^[GH]/i, "");
  const n = parseInt(bare, 10);
  if (hasH) return `H${bare}`;
  return `${!isNaN(n) && n > 5624 ? "H" : "G"}${bare}`;
}

// ---- Morphology decoder (words.morph) -----------------------------------
// OT = CATSS dotted (V.AAI3S, N.GSM, RP.GS, bare C/P/D/X); NT = Robinson
// hyphen (V-PAI-3S, N-ASF, P-1GS, PRT-N, CONJ). Verbs start V in both, but
// the rest CONFLICTS by scheme (CATSS perfect=X/imperative=D; Robinson
// perfect=R/imperative=M) → separate tables. Returns e.g.
// "Verb · Aorist · Active · Indicative · 3rd person · Singular", or "" when
// morph is null/unmappable (caller hides the line — never shows "unknown").
const _CASE = { N:"Nominative", V:"Vocative", G:"Genitive", D:"Dative", A:"Accusative" };
const _NUM  = { S:"Singular", P:"Plural", D:"Dual" };
const _GEN  = { M:"Masculine", F:"Feminine", N:"Neuter" };
const _PERS = { "1":"1st person", "2":"2nd person", "3":"3rd person" };

const _CATSS_POS = { N:"Noun", A:"Adjective", RA:"Article", RP:"Pronoun",
  RD:"Demonstrative pronoun", RR:"Relative pronoun", RI:"Interrogative pronoun",
  RX:"Indefinite pronoun", V:"Verb", C:"Conjunction", P:"Preposition",
  D:"Adverb", X:"Particle", M:"Numeral", I:"Interjection" };
const _CATSS_TENSE = { P:"Present", I:"Imperfect", F:"Future", A:"Aorist", X:"Perfect", Y:"Pluperfect" };
const _CATSS_VOICE = { A:"Active", M:"Middle", P:"Passive" };
const _CATSS_MOOD  = { I:"Indicative", D:"Imperative", S:"Subjunctive", O:"Optative", N:"Infinitive", P:"Participle" };
// CATSS lumps several pronoun sub-classes under RD; disambiguate by lemma so
// αὐτός (3rd-person personal, = Robinson P) and the reflexives/reciprocal don't
// all read "Demonstrative". Anything not listed (οὗτος/ἐκεῖνος/ὅδε/τοιοῦτος…)
// keeps the demonstrative default.
const _CATSS_RD_LEMMA = {
  "αὐτός":"Pronoun", "ἑαυτοῦ":"Reflexive pronoun", "σεαυτοῦ":"Reflexive pronoun",
  "ἐμαυτοῦ":"Reflexive pronoun", "ἀλλήλων":"Reciprocal pronoun",
};

const _ROB_POS = { N:"Noun", A:"Adjective", T:"Article", P:"Pronoun",
  R:"Relative pronoun", D:"Demonstrative pronoun", K:"Correlative pronoun",
  I:"Interrogative pronoun", X:"Indefinite pronoun", Q:"Correlative pronoun",
  F:"Reflexive pronoun", S:"Possessive pronoun", C:"Reciprocal pronoun",
  V:"Verb", CONJ:"Conjunction", PREP:"Preposition", ADV:"Adverb",
  PRT:"Particle", COND:"Conditional", INJ:"Interjection", HEB:"Hebrew", ARAM:"Aramaic" };
const _ROB_TENSE = { P:"Present", I:"Imperfect", F:"Future", A:"Aorist", R:"Perfect", L:"Pluperfect" };
const _ROB_VOICE = { A:"Active", M:"Middle", P:"Passive", E:"Middle/Passive",
  D:"Middle deponent", O:"Passive deponent", N:"Middle/Passive deponent" };
const _ROB_MOOD  = { I:"Indicative", S:"Subjunctive", O:"Optative", M:"Imperative", N:"Infinitive", P:"Participle" };

function _decodeCNG(s) {            // case + number + (optional) gender, by position
  const out = [];
  if (s[0] && _CASE[s[0]]) out.push(_CASE[s[0]]);
  if (s[1] && _NUM[s[1]])  out.push(_NUM[s[1]]);
  if (s[2] && _GEN[s[2]])  out.push(_GEN[s[2]]);
  return out;
}

function decodeMorph(morph, lemma) {
  if (!morph) return "";
  const m = morph.trim();
  let parts = [];
  try {
    if (m.indexOf(".") >= 0) {                         // ---- CATSS (OT) ----
      const dot = m.indexOf(".");
      const pos = m.slice(0, dot), p = m.slice(dot + 1);
      if (pos === "V") {
        parts = ["Verb"];
        if (_CATSS_TENSE[p[0]]) parts.push(_CATSS_TENSE[p[0]]);
        if (_CATSS_VOICE[p[1]]) parts.push(_CATSS_VOICE[p[1]]);
        if (_CATSS_MOOD[p[2]])  parts.push(_CATSS_MOOD[p[2]]);
        const rest = p.slice(3);
        if (p[2] === "P")      parts.push(..._decodeCNG(rest));      // participle
        else if (p[2] !== "N" && rest) {                            // finite (N = infinitive)
          if (_PERS[rest[0]]) parts.push(_PERS[rest[0]]);
          if (_NUM[rest[1]])  parts.push(_NUM[rest[1]]);
        }
      } else {
        let label = _CATSS_POS[pos];
        if (!label) return "";
        if (pos === "RD") label = _CATSS_RD_LEMMA[(lemma || "").normalize("NFC")] || "Demonstrative pronoun";
        parts = [label, ..._decodeCNG(p)];
      }
    } else if (m.indexOf("-") >= 0) {                  // ---- Robinson (NT) ----
      const seg = m.split("-");
      const pos = seg[0];
      if (pos === "V") {
        let tvm = seg[1] || "";
        if (/^[23]/.test(tvm)) tvm = tvm.slice(1);     // 2nd aorist/perfect
        parts = ["Verb"];
        if (_ROB_TENSE[tvm[0]]) parts.push(_ROB_TENSE[tvm[0]]);
        if (_ROB_VOICE[tvm[1]]) parts.push(_ROB_VOICE[tvm[1]]);
        if (_ROB_MOOD[tvm[2]])  parts.push(_ROB_MOOD[tvm[2]]);
        const rest = seg[2] || "";
        if (rest) {
          if (tvm[2] === "P") parts.push(..._decodeCNG(rest));      // participle
          else {
            if (_PERS[rest[0]]) parts.push(_PERS[rest[0]]);
            if (_NUM[rest[1]])  parts.push(_NUM[rest[1]]);
          }
        }
      } else if (pos === "PRT") {
        parts = ["Particle"];
        if (seg[1] === "N") parts.push("Negative");
        else if (seg[1] === "I") parts.push("Interrogative");
      } else {
        const label = _ROB_POS[pos];
        if (!label) return "";
        const p = seg[1] || "";
        if (p === "PRI") return "Proper noun (indeclinable)";
        if (p === "NUI") return "Numeral (indeclinable)";
        parts = [label];
        if (pos === "P" && /^[123]/.test(p)) {         // personal pron: person·case·number
          if (_PERS[p[0]]) parts.push(_PERS[p[0]]);
          if (_CASE[p[1]]) parts.push(_CASE[p[1]]);
          if (_NUM[p[2]])  parts.push(_NUM[p[2]]);
        } else {
          parts.push(..._decodeCNG(p));                // incl. αὐτός P-GSM, drops trailing -T
        }
      }
    } else {                                           // ---- bare POS token ----
      const label = (m.length === 1 ? _CATSS_POS[m] : _ROB_POS[m]);
      if (!label) return "";
      parts = [label];
    }
  } catch (e) { return ""; }
  return parts.filter(Boolean).join(" · ");
}

function makeEntry(r, idx) {
  const snum = r.strongs_base === "*" ? "*" : (r.strongs || r.strongs_base);
  return {
    id: `${snum}-${r.book}-${r.chapter}-${r.verse}-${idx}`,
    strongs: strongsTag(snum),
    strongs_base: r.strongs_base,
    strongs_raw: snum,
    greek: r.lemma || "",
    translit: r.translit || "",
    gloss: r.gloss || "",
    gloss_head: r.gloss_head || "",
    ref: r.ref,
    book: r.book,
    chapter: r.chapter,
    verse: r.verse,
    definition: r.strongs_def || "",
    derivation: r.derivation || "",
    is_function: r.is_function || false,
    is_pn: r.is_pn || false,
  };
}

function flattenAiResults(verses) {
  const entries = [];
  let idx = 0;
  for (const v of verses) {
    for (const w of (v.words || [])) {
      const snum = w.strongs_base === "*" ? "*" : (w.strongs && w.strongs !== "*" ? w.strongs : w.strongs_base);
      entries.push({
        id: `ai-${v.book}-${v.chapter}-${v.verse}-${snum}-${idx++}`,
        strongs: strongsTag(snum),
        strongs_base: w.strongs_base,
        strongs_raw: snum,
        greek: w.lemma || "",
        translit: w.translit || "",
        gloss: w.gloss || "",
        ref: v.ref,
        book: v.book,
        chapter: v.chapter,
        verse: v.verse,
        definition: w.strongs_def || "",
        derivation: w.derivation || "",
        is_function: w.is_function || false,
        is_pn: w.is_pn || false,
        is_primary: v.is_primary || false,
        is_additional: v.is_additional || false,
      });
    }
  }
  return entries;
}

// ============================================================
// BOOK LABELS
// ============================================================
const NT_BOOKS = new Set([
  "Mat","Mar","Luk","Joh","Act","Rom","1Co","2Co","Gal","Eph",
  "Php","Col","1Th","2Th","1Ti","2Ti","Tit","Phm","Heb","Jas",
  "1Pe","2Pe","1Jn","2Jn","3Jn","Jud","Rev",
]);

const BOOK_ORDER = {};
[
  "Gen","Exo","Lev","Num","Deu","Jos","Jdg","Rth","1Sa","2Sa",
  "1Ki","2Ki","1Ch","2Ch","Ezr","Neh","Est","Job","Psa","Pro",
  "Ecc","Son","Isa","Jer","Lam","Eze","Dan","Hos","Joe","Amo",
  "Oba","Jon","Mic","Nah","Hab","Zep","Hag","Zec","Mal",
  "Mat","Mar","Luk","Joh","Act","Rom","1Co","2Co","Gal","Eph",
  "Php","Col","1Th","2Th","1Ti","2Ti","Tit","Phm","Heb","Jas",
  "1Pe","2Pe","1Jn","2Jn","3Jn","Jud","Rev",
].forEach((b, i) => { BOOK_ORDER[b] = i; });

const BOOK_LABELS = {
  Gen: "Genesis",      Exo: "Exodus",       Lev: "Leviticus",    Num: "Numbers",
  Deu: "Deuteronomy",  Jos: "Joshua",        Jdg: "Judges",       Rth: "Ruth",
  "1Sa": "1 Samuel",   "2Sa": "2 Samuel",    "1Ki": "1 Kings",    "2Ki": "2 Kings",
  "1Ch": "1 Chronicles", "2Ch": "2 Chronicles", Ezr: "Ezra",      Neh: "Nehemiah",
  Est: "Esther",       Job: "Job",           Psa: "Psalms",       Pro: "Proverbs",
  Ecc: "Ecclesiastes", Son: "Song of Solomon", Isa: "Isaiah",     Jer: "Jeremiah",
  Lam: "Lamentations", Eze: "Ezekiel",       Dan: "Daniel",       Hos: "Hosea",
  Joe: "Joel",         Amo: "Amos",          Oba: "Obadiah",      Jon: "Jonah",
  Mic: "Micah",        Nah: "Nahum",         Hab: "Habakkuk",     Zep: "Zephaniah",
  Hag: "Haggai",       Zec: "Zechariah",     Mal: "Malachi",
  Mat: "Matthew",      Mar: "Mark",          Luk: "Luke",         Joh: "John",
  Act: "Acts",         Rom: "Romans",        "1Co": "1 Corinthians", "2Co": "2 Corinthians",
  Gal: "Galatians",    Eph: "Ephesians",     Php: "Philippians",  Col: "Colossians",
  "1Th": "1 Thessalonians", "2Th": "2 Thessalonians", "1Ti": "1 Timothy", "2Ti": "2 Timothy",
  Tit: "Titus",        Phm: "Philemon",      Heb: "Hebrews",      Jas: "James",
  "1Pe": "1 Peter",    "2Pe": "2 Peter",     "1Jn": "1 John",     "2Jn": "2 John",
  "3Jn": "3 John",     Jud: "Jude",          Rev: "Revelation",
};

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
  Panel: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M15 3v18"/>
    </svg>
  ),
};

// ============================================================
// HEADER
// ============================================================
function Header({ activeView, onNavChange }) {
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
          <button className={"hdr-link " + (activeView === "library" ? "active" : "")} onClick={() => onNavChange("library")}>Library</button>
          <button className={"hdr-link " + (activeView === "lexicon" ? "active" : "")} onClick={() => onNavChange("lexicon")}>Lexicon</button>
          <button className={"hdr-link " + (activeView === "search" ? "active" : "")} onClick={() => onNavChange("search")}>Search</button>
          <button className={"hdr-link " + (activeView === "about" ? "active" : "")} onClick={() => onNavChange("about")}>About</button>
        </nav>
      </div>
    </header>
  );
}

// ============================================================
// SEARCH BAR
// ============================================================
function SearchBar({ q2, setQ2, onAiSearch, aiLoading }) {
  return (
    <section className="search">
      <div className="search-cell">
        <label className="search-label">
          <span className="search-eyebrow ai">
            <span className="ai-dot"></span>
            Ask the corpus
          </span>
        </label>
        <form className="search-field ai-field" onSubmit={(e) => { e.preventDefault(); onAiSearch(); }}>
          <Icon.Sparkle className="search-icon"/>
          <input
            type="text"
            className="search-input"
            placeholder="Ask the corpus… Where does the divine council appear?"
            value={q2}
            onChange={(e) => setQ2(e.target.value)}
          />
          <button type="submit" className="search-go" aria-label="Submit">
            {aiLoading ? <span className="spinner"/> : <Icon.ArrowRight/>}
          </button>
        </form>
        <div className="search-chips">
          <button className="chip suggest" onClick={() => setQ2("Where does pneuma appear in Genesis")}>"Where does pneuma appear in Genesis"</button>
          <button className="chip suggest" onClick={() => setQ2("Faith in Paul's letters")}>"Faith in Paul's letters"</button>
          <button className="chip suggest" onClick={() => setQ2("divine council passages")}>"divine council passages"</button>
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
      <div className="card-main">
        {entry.greek ? (
          <div className="card-greek">{entry.greek}</div>
        ) : (
          <div className="card-greek" style={{ fontSize: "22px" }}>{stripArticles(entry.gloss)}</div>
        )}
        {entry.greek && <div className="card-gloss">{stripArticles(entry.gloss)}</div>}
      </div>
      <div className="card-translit">{entry.translit}</div>
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
function _senseLevel(marker) {
  if (!marker) return 0;
  if (/^[IVX]+\.$/.test(marker)) return 0;
  if (/^[A-E]\.$/.test(marker))  return 1;
  if (/^[1-9]/.test(marker))     return 2;
  return 3;
}

function _stripMd(text) {
  return text
    .replace(/^#+\s*/gm, "")      // strip # ## ### headers
    .replace(/^\s*[-*]\s+/gm, "") // strip bullet points
    .replace(/\*\*(.+?)\*\*/g, "$1") // strip bold **
    .replace(/\*(.+?)\*/g, "$1")     // strip italic *
    .replace(/\s{2,}/g, " ")
    .trim();
}

const _REFUSAL_RE = /^(I |A\.\s*I |I'm |I don't|I cannot|I appreciate|I need|Unfortunately)/i;

function LsjSummary({ data, loading }) {
  if (loading)
    return <div className="lsj-def" style={{ color: "var(--muted)", fontStyle: "italic" }}>Summarizing…</div>;
  if (!data?.summary)
    return <div className="lsj-def" style={{ color: "var(--muted)" }}>No definition available.</div>;
  return <p className="lsj-synthesis">{data.summary}</p>;
}

function useSwipeToDismiss(onClose) {
  const [dragY, setDragY] = React.useState(0);
  const startY = React.useRef(0);
  const onTouchStart = (e) => { startY.current = e.touches[0].clientY; setDragY(0); };
  const onTouchMove  = (e) => { const d = Math.max(0, e.touches[0].clientY - startY.current); setDragY(d); };
  const onTouchEnd   = ()  => { if (dragY > 80) onClose(); setDragY(0); };
  return {
    handleProps: { onTouchStart, onTouchMove, onTouchEnd },
    sheetStyle:  dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : {}
  };
}

// ============================================================
// LEAFLET MINI-MAP
// ============================================================
function LeafletMap({ lat, lon, name }) {
  const mapRef = React.useRef(null);
  const instanceRef = React.useRef(null);

  React.useEffect(() => {
    if (!mapRef.current || !window.L) return;
    if (instanceRef.current) {
      instanceRef.current.remove();
      instanceRef.current = null;
    }
    const map = window.L.map(mapRef.current, {
      center: [lat, lon],
      zoom: 7,
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: false,
    });
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map);
    window.L.marker([lat, lon]).addTo(map).bindPopup(name).openPopup();
    instanceRef.current = map;
    return () => { if (instanceRef.current) { instanceRef.current.remove(); instanceRef.current = null; } };
  }, [lat, lon, name]);

  return <div ref={mapRef} className="metav-leaflet-map" />;
}

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
      // Default tab (only matters when BOTH person+place exist). Default to Person
      // and flip to Place ONLY when the word's own (prefixed) strongs matches the
      // place's strongs_g — a genuinely distinct place id. pn_type is NOT trusted:
      // tipnr.strongs is a PK, so a name sharing one strongs for person AND place
      // (e.g. Adam H121) stores whichever type was inserted last ('place' for Adam),
      // which would wrongly default person-names to Place.
      const placeStrongsMatch = !ld.error && !!ld.strongs_g && !!entry.strongs_base &&
        ld.strongs_g.split(/[^GH0-9.]+/i).map(s => s.toUpperCase()).includes(entry.strongs_base.toUpperCase());
      setMetavTab(placeStrongsMatch ? "place" : "person");
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
  const { handleProps, sheetStyle } = useSwipeToDismiss(onClose);

  return (
    <aside className={"detail " + (isMobile ? "detail-sheet" : "detail-side")} style={isMobile ? sheetStyle : {}} role="dialog" aria-label="Lexicon detail">
      {isMobile && <div className="sheet-drag-zone" aria-hidden="true" {...handleProps}><div className="sheet-handle"></div></div>}
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
        <div className={"detail-hero" + (isPN && !entry.greek && !isHebrew ? " no-gloss" : "")}>
          <div className={"detail-greek" + (isHebrew ? " detail-greek--he" : "")}
               dir={isHebrew ? "rtl" : undefined}>
            {isHebrew ? (bdbEntry?.lemma || entry.gloss) : (entry.greek || ((isPN || metavData) ? extractProperName(entry.gloss) : entry.gloss))}
          </div>
          <div className={"detail-translit-row" + (isHebrew ? " detail-translit-row-he" : "")}>
            <span className="detail-translit">{isHebrew ? bdbEntry?.xlit : entry.translit}</span>
            {isHebrew && (bdbEntry?.xlit || entry.translit) && entry.gloss && (
              <><span className="detail-sep">·</span><span className="detail-gloss">{stripArticles(((isPN || metavData) ? extractProperName(entry.gloss) : entry.gloss)?.replace(/[.,;:!?—-]+$/, "").trim())}</span></>
            )}
          </div>
          {!(isPN && !entry.greek && !isHebrew) && !(isHebrew && (bdbEntry?.xlit || entry.translit) && entry.gloss) && (
            <div className="detail-gloss">{stripArticles(((isPN || metavData) ? extractProperName(entry.gloss) : (entry.greek && (entry.gloss || "").trim().split(/\s+/).length > 2 ? entry.english_head : entry.gloss))?.replace(/[.,;:!?—-]+$/, "").trim())}</div>
          )}
          {morphLine && <div className="detail-morph">{morphLine}</div>}
        </div>

        {(metavLoading || metavPersonData || metavPlaceData) && (
          <section className="sec">
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
        )}

        {(aiDescription || aiDescLoading) && (
          <section className="sec">
            <h4 className="sec-head"><span className="sec-t">{metavType === "place" ? "Biblical Place" : "Biblical Reference"}</span><span className="lsj-badge lsj-badge--accent">AI</span></h4>
            {aiDescLoading
              ? <div className="lsj-def lsj-def--loading">Looking up…</div>
              : <p className="detail-p detail-p--meta">{aiDescription}</p>
            }
          </section>
        )}

        {isHebrewWord ? (
          <section className="sec">
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
        ) : (!isPN || (metavType === "place" && metavData?.strongs_g?.length > 0)) && metavType !== "person" && !aiDescription && !aiDescLoading && (entry.greek || entry.strongs_raw || metavData?.strongs_g?.length > 0) && (
          <section className="sec">
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
        )}


        {!isHebrew && !isPN && !entry.isKjv && abpCount !== null && abpCount > 0 && (
          <section className="sec">
            <h4 className="sec-head"><span className="sec-t">ABP Occurrences</span></h4>
            <button className="occ-link" onClick={() => onNavigateToLexicon && onNavigateToLexicon(entry.strongs_raw)}>
              <b>{abpCount}</b>× in LXX <Icon.ArrowRight/>
            </button>
          </section>
        )}

        {entry.isKjv && !isHebrew && !isPN && kjvCount !== null && kjvCount > 0 && (
          <section className="sec">
            <h4 className="sec-head"><span className="sec-t">KJV Occurrences</span></h4>
            <button className="occ-link" onClick={() => onNavigateToLexicon && onNavigateToLexicon(entry.strongs)}>
              <b>{kjvCount}</b>× in KJV <Icon.ArrowRight/>
            </button>
          </section>
        )}

        {!entry.isKjv && isPN && pnCount !== null && pnCount > 0 && onNameSearch && (
          <section className="sec">
            <h4 className="sec-head"><span className="sec-t">ABP Occurrences</span></h4>
            <button className="occ-link" onClick={() => onNameSearch(extractProperName(entry.gloss))}>
              <b>{pnCount}</b>× in LXX <Icon.ArrowRight/>
            </button>
          </section>
        )}

        {isHebrew && kjvCount !== null && kjvCount > 0 && (
          <section className="sec">
            <h4 className="sec-head"><span className="sec-t">KJV Occurrences</span></h4>
            <button className="occ-link" onClick={() => onNavigateToLexicon && onNavigateToLexicon(entry.strongs)}>
              <b>{kjvCount}</b>× in KJV <Icon.ArrowRight/>
            </button>
          </section>
        )}

        {entry.derivation && (
          <section className="sec">
            <h4 className="sec-head"><span className="sec-t">Derivation</span></h4>
            <p className="detail-p">
              {entry.derivation.split(/\b(G\d[\d.]*)/i).map((part, i) =>
                /^G\d[\d.]*/i.test(part)
                  ? <button key={i} className="link-btn link-btn--strong" onClick={() => onNavigateToLexicon?.(part)}>{part}</button>
                  : part
              )}
            </p>
          </section>
        )}

        {entry.book && (
        <section className="sec">
          <h4 className="sec-head">
            <span className="sec-t">Verse — {entry.ref}</span>
            <span className="sec-meta">{(entry.isKjv || isHebrew || (metavType === "place" && !isPN)) ? "KJV" : "LXX (ABP English)"}</span>
          </h4>
          <blockquote className="dverse">
            <span className="dverse-n">{entry.verse}</span>
            {(entry.isKjv || isHebrew || (metavType === "place" && !isPN)) ? (kjvVerseText || "—") : (verseLoading ? "Loading…" : verseText || "—")}
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
                    <span className="iw-strongs">{(w.strongs && w.strongs !== '*') ? 'G' + w.strongs : w.strongs_base}</span>
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
        )}

        {(occurrences > 0 || totalResults > 0) && (
        <section className="sec">
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
        )}
      </div>
    </aside>
  );
}

// ============================================================
// CROSS-REFERENCE PANEL
// ============================================================
function CrossRefPanel({ source, onClose, onNavigate, isMobile, translation, onAiSearch }) {
  const [refs, setRefs] = useState([]);
  const [synthesis, setSynthesis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [abpTexts, setAbpTexts] = useState({});
  const showAbp = translation === "abp" || translation === "parallel";

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setRefs([]);
    setSynthesis(null);
    setAbpTexts({});
    setLoading(true);
    api.crossRefsCurated(source.book, source.chapter, source.verse)
      .then(d => {
        if (cancelled) return;
        setRefs(d.refs || []);
        setSynthesis(d.synthesis || null);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source && source.book, source && source.chapter, source && source.verse]);

  useEffect(() => {
    if (!showAbp || !refs.length) { setAbpTexts({}); return; }
    let cancelled = false;
    Promise.all(
      refs.map(ref =>
        api.verse(ref.book, ref.chapter, ref.verse)
          .then(d => [ref.ref, d.text || ""])
          .catch(() => [ref.ref, ""])
      )
    ).then(pairs => { if (!cancelled) setAbpTexts(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [refs, showAbp]);

  const verseText = (ref) => showAbp ? (abpTexts[ref.ref] || ref.kjv_text) : ref.kjv_text;

  const sourceRef = `${source.book} ${source.chapter}:${source.verse}`;
  const { handleProps: swipeProps, sheetStyle: xrefSheetStyle } = useSwipeToDismiss(onClose);

  return (
    <aside className={"xref-panel " + (isMobile ? "detail-sheet" : "detail-side")} style={isMobile ? xrefSheetStyle : {}} role="dialog" aria-label="Related Passages">
      {isMobile && <div className="sheet-drag-zone" aria-hidden="true" {...swipeProps}><div className="sheet-handle"></div></div>}
      <div className="detail-head">
        <div className="detail-head-l">
          <span className="detail-pos">{sourceRef}</span>
          <span className="xref-badge">TSK</span>
        </div>
        <button className="detail-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="xref-body">
        <h3 className="xref-title">Related Passages</h3>
        {loading ? (
          <p className="xref-synthesis-loading">Selecting relevant passages…</p>
        ) : synthesis ? (
          <p className="xref-synthesis">{synthesis}</p>
        ) : null}
        {!loading && onAiSearch && (
          <button className="xref-ai-btn" onClick={() => { onClose(); onAiSearch(sourceRef); }}>
            Explore in the corpus →
          </button>
        )}
        {loading ? (
          <div className="lib-loading">Loading…</div>
        ) : refs.length === 0 ? (
          <p className="detail-p">No cross-references found.</p>
        ) : (
          <div className="xref-list">
            {refs.map(ref => (
              <div key={ref.ref} className="xref-verse" onClick={() => onNavigate(ref.book, ref.chapter, ref.verse)}>
                <span className="xref-ref">{ref.ref}</span>
                <p className="xref-text">{verseText(ref)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

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
// CORPUS SEARCH — VERSE ROW
// ============================================================
function CorpusVerseRow({ book, chapter, verse, label, allResults, onWordClick, onReadInContext, textMode, primaryStrongs, citedStrongs, kjvCache }) {
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
            const bareNum = (w.strongs_base || "").replace(/^[GH]/i, "");
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
            <CorpusVerseRow
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
  const m = w.morph || "";
  const isContent = m && (m[0] === "V" || m[0] === "N" || m[0] === "A");
  if (isContent && w.english_head) {
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
    if (!nav?.scroll || !verses.length) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (highlightRef.current) {
        highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        onNavChange?.({ ...nav, scroll: false });
      }
    }));
  }, [nav?.scroll, verses]);

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
  const swipeHandlers = isMobile ? {
    onTouchStart: (e) => {
      swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
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
        onNavChange?.({ ...nav, chapter: c, highlight: null });
      } else if (dx > 0 && selChapter > 1) {
        const c = selChapter - 1;
        setSelChapter(c);
        onNavChange?.({ ...nav, chapter: c, highlight: null });
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
        const bracketChar = (ch, k) => (
          <span key={k} className="lib-bracket">
            {showInterlinear && <span className="lib-iw-greek" style={{visibility:"hidden"}}>x</span>}
            <span className="lib-bracket-glyph">{ch}</span>
            {showStrongs && <span className="lib-iw-strongs" style={{visibility:"hidden"}}>G0</span>}
          </span>
        );
        return (
          <span key={`bg${gi}`} className="lib-bracket-group">
            {gw.length === 1 ? (
              <span className="lib-bracket-unit">
                {bracketChar("[", "bl")}
                {bracketChip(gw[0], `bg${gi}w0`)}
                {bracketChar("]", "br")}
              </span>
            ) : (<>
              <span className="lib-bracket-unit">
                {bracketChar("[", "bl")}
                {bracketChip(gw[0], `bg${gi}w0`)}
              </span>
              {gw.slice(1, -1).map((w, wi) => bracketChip(w, `bg${gi}w${wi + 1}`))}
              <span className="lib-bracket-unit">
                {bracketChip(gw[gw.length - 1], `bg${gi}w${gw.length - 1}`)}
                {bracketChar("]", "br")}
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
                onClick={() => { const c = Math.max(1, selChapter - 1); setSelChapter(c); onNavChange?.({ ...nav, chapter: c, highlight: null }); }}
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
                onClick={() => { const c = Math.min(maxChap, selChapter + 1); setSelChapter(c); onNavChange?.({ ...nav, chapter: c, highlight: null }); }}
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
            <button className="mbar-ch-nav" disabled={selChapter <= 1} onClick={() => { const c = Math.max(1, selChapter - 1); setSelChapter(c); onNavChange?.({ ...nav, chapter: c, highlight: null }); }} aria-label="Previous chapter">‹</button>
            <button className="mbar-loc" onClick={() => setMobileNavOpen(true)}>
              <span className="mbar-loc-name">{selBook ? selBook.name : ""}</span>
              <span className="mbar-loc-ch">{selChapter}</span>
            </button>
            <button className="mbar-ch-nav" disabled={selChapter >= maxChap} onClick={() => { const c = Math.min(maxChap, selChapter + 1); setSelChapter(c); onNavChange?.({ ...nav, chapter: c, highlight: null }); }} aria-label="Next chapter">›</button>
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

// ============================================================
// GLOSS GROUPINGS
// ============================================================
// ============================================================
// AI ANSWER STRIP
// ============================================================
function AIAnswer({ query, explanation, keyStrongs, onPick }) {
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
      {keyStrongs && keyStrongs.length > 0 && (
        <div className="ai-cites">
          <span className="ai-cites-label">Cited:</span>
          {keyStrongs.map((ks) => (
            <button key={ks.strongs} className="ai-cite" onClick={() => onPick({
              id: `ks-${ks.strongs_base}`,
              strongs: ks.strongs,
              strongs_base: ks.strongs_base,
              strongs_raw: ks.strongs_base,
              greek: ks.lemma,
              translit: ks.translit,
              gloss: "",
              ref: "",
              book: "", chapter: 0, verse: 0,
              definition: ks.definition || "", derivation: ks.derivation || "",
            })}>
              {ks.strongs} {ks.translit || ks.lemma}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================
// GUIDED TOUR
// ============================================================
const TOUR_STEPS = [
  { icon: "Book",    label: "Welcome to Lexica", body: "Lexica is a Greek and Hebrew word study tool built for the diligent Berean. No prior training required. Every word traces back to its Greek or Hebrew source so you can read what the text actually says — before any theological framework is applied. You won't be a scholar overnight, but you'll immediately be a Berean." },
  { icon: "Search",  label: "The Lexicon",       body: "Search by English, Greek, Hebrew, transliteration, or Strong's number. Results span both Greek (LSJ) and Hebrew (BDB) — click any word for its full lexicon entry and a context-aware AI summary anchored in the source text." },
  { icon: "Book",    label: "The Library",       body: "Read in ABP, KJV, or parallel. Enable Strong's badges or go fully interlinear — Hebrew script appears above OT words, Greek above NT. Click any word to open its lexicon entry. Click any verse number for cross-references." },
  { icon: "Panel",   label: "Cross-References",  body: "Every verse connects to Torrey's Treasury of Scripture Knowledge — AI-curated to the strongest matches and synthesized into a thematic overview anchored in ABP vocabulary." },
  { icon: "Sparkle", label: "Ask the Corpus",    body: "Ask in plain language: 'Where does pneuma appear in Genesis?' or 'Differences in how KJV and ABP render spirit in the OT.' The AI searches Greek and Hebrew simultaneously and cites specific passages." },
  { icon: "Book",    label: "Support Lexica",    body: "Lexica is free, independent, and has no ads. It's maintained by one person who thinks serious Bible study tools shouldn't cost hundreds of dollars. If it's been useful to your studies, a small contribution keeps it running.", donate: true },
];

function GuidedTour({ onDone }) {
  const [step, setStep] = useState(0);
  const cur = TOUR_STEPS[step];
  const StepIcon = Icon[cur.icon];
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <>
      <div className="tour-scrim" onClick={onDone} />
      <div className="tour-modal" role="dialog" aria-modal="true" aria-label="Welcome to Lexica">
        <button className="tour-skip" onClick={onDone}>Skip</button>
        <div className="tour-icon-wrap">
          <StepIcon width="20" height="20" />
        </div>
        <div className="tour-step-num">{step + 1} of {TOUR_STEPS.length}</div>
        <h2 className="tour-title">{cur.label}</h2>
        <p className="tour-body">{cur.body}</p>
        {cur.donate && (
          <div className="tour-donate-btns">
            <a className="donate-btn kofi" href="https://ko-fi.com/lexica" target="_blank" rel="noopener noreferrer">☕ Ko-fi</a>
            <a className="donate-btn github" href="https://github.com/sponsors/jonathan-pernice" target="_blank" rel="noopener noreferrer">♥ GitHub Sponsors</a>
          </div>
        )}
        <div className="tour-dots">
          {TOUR_STEPS.map((_, i) => (
            <button key={i} className={"tour-dot" + (i === step ? " active" : "")} onClick={() => setStep(i)} aria-label={`Step ${i + 1}`} />
          ))}
        </div>
        <div className="tour-nav">
          {step > 0 && (
            <button className="tour-btn tour-btn-prev" onClick={() => setStep(s => s - 1)}>Previous</button>
          )}
          {isLast ? (
            <button className="tour-btn tour-btn-done" onClick={onDone}>Get started</button>
          ) : (
            <button className="tour-btn tour-btn-next" onClick={() => setStep(s => s + 1)}>Next</button>
          )}
        </div>
      </div>
    </>
  );
}

// ============================================================
// ABOUT VIEW
// ============================================================
function AboutView() {
  return (
    <div className="about-view">
      <div className="about-inner">
        <h1 className="about-title">About Lexica</h1>
        <p className="about-lead">A Greek and Hebrew word study tool for the diligent Berean. No seminary required.</p>

        <h2 className="about-h2">What Lexica does</h2>
        <p className="about-p">Lexica lets you trace any English word in the Bible back to its Greek or Hebrew source and explore its full meaning — not just the translation choice made by one committee. Every word links to the Liddell-Scott-Jones Greek lexicon (LSJ) or Brown-Driver-Briggs Hebrew lexicon (BDB), the two most comprehensive scholarly references available.</p>
        <p className="about-p">The primary text is the <b>Apostolic Bible Polyglot (ABP)</b> — a word-for-word Greek interlinear covering both the Septuagint (OT) and New Testament. The <b>King James Version (KJV)</b> is available in parallel and interlinear modes for comparison. Cross-references come from Torrey's Treasury of Scripture Knowledge.</p>

        <h2 className="about-h2">The Berean approach</h2>
        <p className="about-p">The Bereans "received the word with all readiness of mind, and searched the scriptures daily" (Acts 17:11). Lexica is built on that same posture: let the Greek and Hebrew speak first, before any theological system is imported. No commentary, no denominational lens, no conclusions pre-loaded. The text speaks — you decide what it means.</p>
        <p className="about-p">Every AI-generated summary is anchored in the source vocabulary of the ABP. The system prompt explicitly forbids importing theology from outside the text.</p>

        <h2 className="about-h2">Methodology</h2>
        <ul className="about-ul">
          <li>Strong's numbers are the bridge between English, Greek, and Hebrew</li>
          <li>Greek definitions draw from LSJ — the standard classical Greek reference</li>
          <li>Hebrew definitions draw from BDB — the standard OT Hebrew reference</li>
          <li>AI search generates SQL against the full lexicon corpus — not a summary or paraphrase</li>
          <li>Translation comparisons surface where KJV and ABP make different rendering choices for the same source word</li>
        </ul>

        <h2 className="about-h2">Support Lexica</h2>
        <p className="about-p">Lexica is free, independent, and has no ads. It's maintained by one person who thinks serious Bible study tools shouldn't cost hundreds of dollars or require a seminary login. If it's been useful to you, a small contribution keeps the lights on.</p>
        <div className="about-donate">
          <a className="donate-btn kofi" href="https://ko-fi.com/lexica" target="_blank" rel="noopener noreferrer">☕ Ko-fi</a>
          <a className="donate-btn github" href="https://github.com/sponsors/jonathan-pernice" target="_blank" rel="noopener noreferrer">♥ GitHub Sponsors</a>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LEXICON VIEW
// ============================================================
const _STRONGS_RE = /^[GgHh]?\d+(\.\d+)?$/;

function LexiconView({ onNavigateToSearch, onNavigateToLibrary, onWordClick, pendingStrongs, onPendingStrongsConsumed }) {
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
    loadProfile(pendingStrongs);
  }, [pendingStrongs]);

  const loadProfile = async (strongs, corpusOverride) => {
    setLoading(true);
    setError(null);
    setMatches(null);
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
        if (!data.length) setError("No matches found for \"" + q + "\".");
        else setGroupings(data);
      }
    } catch { setError("Search failed."); }
    finally { setLoading(false); }
  };

  return (
    <div className="lexicon-view">
      <form className="lexicon-search-form" onSubmit={handleSubmit}>
        <input
          className="lexicon-search-input"
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Greek, Hebrew, English, or Strong's (G4151, H7307)…"
          autoFocus
        />
        <button type="submit" className="lexicon-search-btn" disabled={loading}>
          {loading ? "…" : "Search"}
        </button>
      </form>

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

      {matches && (
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
              onClick={() => loadProfile(g.strongs)}>
              <span className="lexicon-match-strongs">{g.strongs}</span>
              {g.lemma && <span className="lexicon-match-lemma" dir={g.strongs[0] === "H" ? "rtl" : undefined}>{g.lemma}</span>}
              {g.translit && <span className="lexicon-match-translit">{g.translit}</span>}
              <span className="lexicon-result-preview">
                {(g.glosses || []).slice(0, 3).map(x => x.gloss).join(", ")}
              </span>
              <span className="lexicon-result-count">{g.count}</span>
              <span className="lexicon-result-chev">›</span>
            </button>
          ))}
        </div>
      )}

      {profile && (
        <div className="lexicon-profile">
          <div className="lexicon-profile-header">
            {groupings && (
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

          {(bookGlosses || profile.glosses) && (bookGlosses || profile.glosses).length > 0 && (
            <div className="lexicon-glosses">
              <div className="lexicon-gloss-label">{selectedBook ? "In this book" : "Rendered as"}</div>
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
            <div className="lexicon-verse-list">
              <div className="lexicon-verse-list-header">
                <span className="lexicon-verse-list-title">
                  {profile.books.find(b => b.book === selectedBook)?.name}
                </span>
                <button className="lexicon-verse-close" onClick={() => { setSelectedBook(null); setVerseList(null); }}>✕</button>
              </div>
              {verseLoading && <div className="lexicon-verse-loading">Loading…</div>}
              {verseList && verseList.map((v, i) => (
                v.error
                  ? <div key={i} className="lexicon-verse-loading" style={{color:"red"}}>{v.error}</div>
                  : <div key={i} className="lexicon-verse-row">
                      <span className="lexicon-verse-ref">{selectedBook} {v.chapter}:{v.verse}</span>
                      <span className="lexicon-verse-text lib-verse-chips">
                        {v.words
                          ? v.words.map((w, wi) => (
                              <span key={wi} className={"lib-word" + (w.h ? " cited" : "") + (w.i ? " lib-abp-italic" : "")}>
                                <span className="lib-iw-english">{w.w}{w.punc || ""}</span>
                              </span>
                            ))
                          : v.text}
                      </span>
                      {onNavigateToLibrary && (
                        <button className="lexicon-verse-lib-link" onClick={() => onNavigateToLibrary(selectedBook, v.chapter, v.verse)}>
                          Read →
                        </button>
                      )}
                    </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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


  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1100);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);


  const handleVerseNumberClick = (book, chapter, verse, translation) => {
    setActiveEntry(null);
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
        s.add(p.strongs_base);                            // as-is (e.g. "4151" or "G4151")
        s.add(p.strongs_base.replace(/^[GH]/i, ""));     // bare (e.g. "4151")
        s.add(`G${p.strongs_base.replace(/^[GH]/i, "")}`); // G-prefixed
        s.add(`H${p.strongs_base.replace(/^[GH]/i, "")}`); // H-prefixed
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

  const handleNavigateToLexicon = (strongs) => {
    if (!strongs) return;
    setLexiconPendingStrongs(strongs);
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

  return (
    <div className={"app view-" + mainView + " " + ((activeEntry || libCrossRef) ? "has-detail" : "")}>
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
            <LibraryView nav={libNav} onNavChange={setLibNav} onWordClick={(e) => { setLibCrossRef(null); setActiveEntry(e); }} onVerseNumberClick={handleVerseNumberClick} onTranslationChange={setLibTranslation} isMobile={isMobile} />
          </div>
        )}
        {mainView === "about" && <AboutView />}
        <div style={{ display: mainView === "lexicon" ? undefined : "none" }}>
          <LexiconView
            onNavigateToSearch={(q) => { handleNavChange("search"); setQ2(q); }}
            onNavigateToLibrary={(book, chapter, verse) => {
              searchScrollRef.current = window.scrollY;
              setLibNav({ book, chapter, highlight: verse, scroll: true });
              setLibEverVisited(true);
              setMainView("library");
            }}
            onWordClick={(e) => setActiveEntry(e)}
            pendingStrongs={lexiconPendingStrongs}
            onPendingStrongsConsumed={() => setLexiconPendingStrongs(null)}
          />
        </div>
        <div className="main-inner" style={{ display: (mainView === "library" || mainView === "about" || mainView === "lexicon") ? "none" : undefined }}>
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
