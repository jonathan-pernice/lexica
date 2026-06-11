function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState,
  useEffect,
  useRef,
  useMemo
} = React;
const _ARTICLE_RE = /^((?:the|a|an|his|her|its|of|my|your|their|our)\s+)+/i;
function stripArticles(s) {
  if (!s) return s;
  return s.replace(_ARTICLE_RE, "").trim() || s;
}

// The Haiku-written blurbs (cross-ref synthesis, book/chapter summaries, person/
// place descriptions, LSJ word study) routinely mark transliterated Greek/Hebrew in
// markdown — *italic* and occasionally **bold**. Rendered as plain text the markers
// leak as literal asterisks, so turn them into <em>/<strong> here. Asterisks only
// (the form the model actually emits); a lone/unpaired * is left as text.
// Require non-space hugging the markers (the real markdown rule), so a stray or
// unpaired "*" — or "2*3" arithmetic — is never mistaken for emphasis.
const _INLINE_MD_RE = /\*\*(\S(?:[^*]*\S)?)\*\*|\*(\S(?:[^*]*\S)?)\*/g;
function renderInlineMd(text) {
  if (!text || typeof text !== "string" || text.indexOf("*") === -1) return text;
  const nodes = [];
  let last = 0,
    m,
    key = 0;
  while ((m = _INLINE_MD_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] != null) nodes.push(/*#__PURE__*/React.createElement("strong", {
      key: key++
    }, m[1]));else nodes.push(/*#__PURE__*/React.createElement("em", {
      key: key++
    }, m[2]));
    last = _INLINE_MD_RE.lastIndex;
  }
  _INLINE_MD_RE.lastIndex = 0;
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// ============================================================
// API LAYER
// ============================================================
// Attach the signed-in user's bearer token (if any). Used only by the ESV calls
// below — the server gate needs to know WHO is asking, since the ESV is the
// owner's personal text. Resolved at call time (NotesStore loads after this file).
function _authHeaders() {
  try {
    const a = typeof NotesStore !== "undefined" && NotesStore.auth();
    return a && a.token ? {
      "Authorization": "Bearer " + a.token
    } : {};
  } catch (e) {
    return {};
  }
}
const api = {
  search: (q, phrase = false) => fetch(`/api/search?q=${encodeURIComponent(q)}&phrase=${phrase ? 1 : 0}`).then(r => r.json()),
  aiSearch: q => fetch(`/api/ai-search?q=${encodeURIComponent(q)}`).then(r => r.json()),
  verse: (book, chapter, verse) => fetch(`/api/verse/${encodeURIComponent(book)}/${chapter}/${verse}`).then(r => r.json()),
  verseWords: (book, chapter, verse) => fetch(`/api/verse-words/${encodeURIComponent(book)}/${chapter}/${verse}`).then(r => r.json()),
  strongsCount: strongs_base => fetch(`/api/strongs-count/${encodeURIComponent(strongs_base)}`).then(r => r.json()),
  lsj: (lemma, strongs) => {
    const path = lemma || strongs || '';
    if (!path) return Promise.resolve({
      error: 'not found'
    });
    const qs = strongs ? `?strongs=${encodeURIComponent(strongs)}` : '';
    return fetch(`/api/lsj/${encodeURIComponent(path)}${qs}`).then(r => r.json());
  },
  lsjSummary: (key, strongs, book, chapter, verse) => {
    const hasDot = strongs && strongs.includes('.');
    const path = key || (hasDot ? strongs : '');
    if (!path) return Promise.resolve({
      error: 'not found'
    });
    const p = new URLSearchParams();
    if (hasDot) p.set('strongs', strongs);
    if (book && chapter && verse) {
      p.set('book', book);
      p.set('chapter', chapter);
      p.set('verse', verse);
    }
    const qs = p.toString() ? `?${p}` : '';
    return fetch(`/api/lsj-summary/${encodeURIComponent(path)}${qs}`).then(r => r.json());
  },
  books: () => fetch("/api/books").then(r => r.json()),
  chronological: () => fetch("/static/chronological.json").then(r => r.json()),
  chapter: (book, ch) => fetch(`/api/chapter/${encodeURIComponent(book)}/${ch}`).then(r => r.json()),
  extraChapter: (book, ch) => fetch(`/api/extra/${encodeURIComponent(book)}/chapter/${ch}`).then(r => r.json()),
  extraStrongsCount: (book, strongs) => fetch(`/api/extra/${encodeURIComponent(book)}/strongs-count/${encodeURIComponent(strongs)}`).then(r => r.json()),
  kjvChapter: (book, ch) => fetch(`/api/kjv/chapter/${encodeURIComponent(book)}/${ch}`).then(r => r.json()),
  bsbChapter: (book, ch) => fetch(`/api/bsb/chapter/${encodeURIComponent(book)}/${ch}`).then(r => r.json()),
  bsbAudio: (book, ch) => fetch(`/api/bsb/audio/${encodeURIComponent(book)}/${ch}`).then(r => r.ok ? r.json() : {
    url: null
  }).catch(() => ({
    url: null
  })),
  // ESV is the owner's personal text — every call carries the login token and the
  // server refuses anyone but the owner (404). esvStatus drives the toggle.
  esvStatus: () => fetch(`/api/esv/status`, {
    headers: _authHeaders()
  }).then(r => r.json()).catch(() => ({
    owner: false
  })),
  esvChapter: (book, ch) => fetch(`/api/esv/chapter/${encodeURIComponent(book)}/${ch}`, {
    headers: _authHeaders()
  }).then(r => r.ok ? r.json() : []).catch(() => []),
  esvAudio: (book, ch) => fetch(`/api/esv/audio/${encodeURIComponent(book)}/${ch}`, {
    headers: _authHeaders()
  }).then(r => r.ok ? r.json() : {
    url: null
  }).catch(() => ({
    url: null
  })),
  // NIV is the owner's personal text too (same gate as ESV; text-only, no audio).
  nivStatus: () => fetch(`/api/niv/status`, {
    headers: _authHeaders()
  }).then(r => r.json()).catch(() => ({
    owner: false
  })),
  nivChapter: (book, ch) => fetch(`/api/niv/chapter/${encodeURIComponent(book)}/${ch}`, {
    headers: _authHeaders()
  }).then(r => r.ok ? r.json() : []).catch(() => []),
  // Hebrew OT interlinear — PUBLIC text (public-domain WLC), no gate on the data.
  // hebStatus carries the token only to learn if the caller is the owner (the toggle
  // shows owner-only during rollout); the chapter fetch needs no auth.
  hebStatus: () => fetch(`/api/hebrew/status`, {
    headers: _authHeaders()
  }).then(r => r.json()).catch(() => ({
    available: false,
    owner: false
  })),
  hebChapter: (book, ch) => fetch(`/api/hebrew/chapter/${encodeURIComponent(book)}/${ch}`).then(r => r.ok ? r.json() : []).catch(() => []),
  // Visitor stats — count this visit (owner's own visits are skipped server-side),
  // ask if the logged-in user is the owner (drives the Stats tab), and fetch the
  // owner-only dashboard numbers.
  statsHit: () => fetch(`/api/stats/hit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ..._authHeaders()
    },
    body: JSON.stringify({
      ref: document.referrer || ""
    })
  }).catch(() => {}),
  statsOwner: () => fetch(`/api/stats/owner`, {
    headers: _authHeaders()
  }).then(r => r.json()).catch(() => ({
    owner: false
  })),
  stats: () => fetch(`/api/stats`, {
    headers: _authHeaders()
  }).then(r => r.ok ? r.json() : null).catch(() => null),
  textSearch: (q, corpus, mode, book) => fetch(`/api/text-search?q=${encodeURIComponent(q)}&corpus=${encodeURIComponent(corpus || "bsb")}` + `&mode=${encodeURIComponent(mode || "phrase")}` + (book ? `&book=${encodeURIComponent(book)}` : "")).then(r => r.json()),
  summary: (book, ch) => fetch(`/api/summary/${encodeURIComponent(book)}/${ch}`).then(r => r.json()),
  kjvVerse: (book, ch, v) => fetch(`/api/kjv/verse/${encodeURIComponent(book)}/${ch}/${v}`).then(r => r.json()),
  kjvVerseWords: (book, ch, v) => fetch(`/api/kjv/verse_words/${encodeURIComponent(book)}/${ch}/${v}`).then(r => r.json()),
  kjvVerseWordsBatch: refs => fetch('/api/kjv/verse_words_batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(refs)
  }).then(r => r.json()),
  kjvStrongsCount: strongs_id => fetch(`/api/kjv/strongs-count/${encodeURIComponent(strongs_id)}`).then(r => r.json()),
  kjvStrongsSearch: strongs_id => fetch(`/api/kjv/strongs-search/${encodeURIComponent(strongs_id)}`).then(r => r.json()),
  pnCount: name => fetch(`/api/pn-count/${encodeURIComponent(name)}`).then(r => r.json()),
  metavPerson: name => fetch(`/api/metav/person/${encodeURIComponent(name)}`).then(r => r.json()),
  metavAiDescription: name => fetch(`/api/metav/ai-description/${encodeURIComponent(name)}`).then(r => r.json()),
  metavPlace: name => fetch(`/api/metav/place/${encodeURIComponent(name)}`).then(r => r.json()),
  bdb: sid => fetch(`/api/bdb/${encodeURIComponent(sid)}`).then(r => r.json()),
  crossRefsCurated: (book, chapter, verse) => fetch(`/api/cross-references/curated/${encodeURIComponent(book)}/${chapter}/${verse}`).then(r => r.json()),
  lexiconLookup: q => fetch(`/api/lexicon/lookup?q=${encodeURIComponent(q)}`).then(r => r.json()),
  lexiconProfile: (strongs, corpus) => fetch(`/api/lexicon/profile/${encodeURIComponent(strongs)}${corpus ? `?corpus=${corpus}` : ""}`).then(r => r.json()),
  lexiconVerses: (strongs, book, corpus, gloss) => fetch(`/api/lexicon/verses/${encodeURIComponent(strongs)}/${encodeURIComponent(book)}?corpus=${corpus}${gloss ? `&gloss=${encodeURIComponent(gloss)}` : ""}`).then(r => r.json()),
  lexiconBooks: (strongs, corpus, gloss) => fetch(`/api/lexicon/books/${encodeURIComponent(strongs)}?corpus=${corpus}${gloss ? `&gloss=${encodeURIComponent(gloss)}` : ""}`).then(r => r.json()),
  lexiconEnglish: (q, corpus, testament) => fetch(`/api/lexicon/english?q=${encodeURIComponent(q)}&corpus=${encodeURIComponent(corpus)}${testament && testament !== "all" ? `&testament=${encodeURIComponent(testament)}` : ""}`).then(r => r.json())
};

// Extract proper noun name from a multi-word gloss, skipping function words
const _PN_STOP = new Set(["And", "But", "Or", "The", "A", "An", "In", "Of", "To", "For", "With", "From", "By", "At", "His", "Her", "Its", "Their", "My", "Your", "Our"]);
function extractProperName(gloss) {
  if (!gloss) return "";
  const clean = gloss.replace(/[^a-zA-Z\s'-]/g, "").trim();
  const proper = clean.split(/\s+/).find(w => /^[A-Z]/.test(w) && !_PN_STOP.has(w));
  return proper || "";
}

// ============================================================
// DATA SHAPING
// ============================================================
// ---- Canonical Strong's-number handling (single source of truth) --------
// strongsBare: drop any G/H prefix, keep dotted variants. "G4151"->"4151",
//   "1510.7.3"->"1510.7.3", "H7307"->"7307".
// strongsTag: display form. "*"/empty -> "PN"; preserves an explicit H prefix;
//   bare numbers above the Greek max (5624) read as Hebrew.
function strongsBare(snum) {
  return String(snum || "").replace(/^[GH]/i, "");
}
function strongsTag(snum) {
  if (!snum || snum === "*") return "PN";
  const s = String(snum);
  const hasH = /^H/i.test(s);
  const bare = strongsBare(s);
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
const _CASE = {
  N: "Nominative",
  V: "Vocative",
  G: "Genitive",
  D: "Dative",
  A: "Accusative"
};
const _NUM = {
  S: "Singular",
  P: "Plural",
  D: "Dual"
};
const _GEN = {
  M: "Masculine",
  F: "Feminine",
  N: "Neuter"
};
const _PERS = {
  "1": "1st person",
  "2": "2nd person",
  "3": "3rd person"
};
const _CATSS_POS = {
  N: "Noun",
  A: "Adjective",
  RA: "Article",
  RP: "Pronoun",
  RD: "Demonstrative pronoun",
  RR: "Relative pronoun",
  RI: "Interrogative pronoun",
  RX: "Indefinite pronoun",
  V: "Verb",
  C: "Conjunction",
  P: "Preposition",
  D: "Adverb",
  X: "Particle",
  M: "Numeral",
  I: "Interjection"
};
const _CATSS_TENSE = {
  P: "Present",
  I: "Imperfect",
  F: "Future",
  A: "Aorist",
  X: "Perfect",
  Y: "Pluperfect"
};
const _CATSS_VOICE = {
  A: "Active",
  M: "Middle",
  P: "Passive"
};
const _CATSS_MOOD = {
  I: "Indicative",
  D: "Imperative",
  S: "Subjunctive",
  O: "Optative",
  N: "Infinitive",
  P: "Participle"
};
// CATSS lumps several pronoun sub-classes under RD; disambiguate by lemma so
// αὐτός (3rd-person personal, = Robinson P) and the reflexives/reciprocal don't
// all read "Demonstrative". Anything not listed (οὗτος/ἐκεῖνος/ὅδε/τοιοῦτος…)
// keeps the demonstrative default.
const _CATSS_RD_LEMMA = {
  "αὐτός": "Pronoun",
  "ἑαυτοῦ": "Reflexive pronoun",
  "σεαυτοῦ": "Reflexive pronoun",
  "ἐμαυτοῦ": "Reflexive pronoun",
  "ἀλλήλων": "Reciprocal pronoun"
};
const _ROB_POS = {
  N: "Noun",
  A: "Adjective",
  T: "Article",
  P: "Pronoun",
  R: "Relative pronoun",
  D: "Demonstrative pronoun",
  K: "Correlative pronoun",
  I: "Interrogative pronoun",
  X: "Indefinite pronoun",
  Q: "Correlative pronoun",
  F: "Reflexive pronoun",
  S: "Possessive pronoun",
  C: "Reciprocal pronoun",
  V: "Verb",
  CONJ: "Conjunction",
  PREP: "Preposition",
  ADV: "Adverb",
  PRT: "Particle",
  COND: "Conditional",
  INJ: "Interjection",
  HEB: "Hebrew",
  ARAM: "Aramaic"
};
const _ROB_TENSE = {
  P: "Present",
  I: "Imperfect",
  F: "Future",
  A: "Aorist",
  R: "Perfect",
  L: "Pluperfect"
};
const _ROB_VOICE = {
  A: "Active",
  M: "Middle",
  P: "Passive",
  E: "Middle/Passive",
  D: "Middle deponent",
  O: "Passive deponent",
  N: "Middle/Passive deponent"
};
const _ROB_MOOD = {
  I: "Indicative",
  S: "Subjunctive",
  O: "Optative",
  M: "Imperative",
  N: "Infinitive",
  P: "Participle"
};
function _decodeCNG(s) {
  // case + number + (optional) gender, by position
  const out = [];
  if (s[0] && _CASE[s[0]]) out.push(_CASE[s[0]]);
  if (s[1] && _NUM[s[1]]) out.push(_NUM[s[1]]);
  if (s[2] && _GEN[s[2]]) out.push(_GEN[s[2]]);
  return out;
}
function decodeMorph(morph, lemma) {
  if (!morph) return "";
  const m = morph.trim();
  let parts = [];
  try {
    if (m.indexOf(".") >= 0) {
      // ---- CATSS (OT) ----
      const dot = m.indexOf(".");
      const pos = m.slice(0, dot),
        p = m.slice(dot + 1);
      if (pos === "V") {
        parts = ["Verb"];
        if (_CATSS_TENSE[p[0]]) parts.push(_CATSS_TENSE[p[0]]);
        if (_CATSS_VOICE[p[1]]) parts.push(_CATSS_VOICE[p[1]]);
        if (_CATSS_MOOD[p[2]]) parts.push(_CATSS_MOOD[p[2]]);
        const rest = p.slice(3);
        if (p[2] === "P") parts.push(..._decodeCNG(rest)); // participle
        else if (p[2] !== "N" && rest) {
          // finite (N = infinitive)
          if (_PERS[rest[0]]) parts.push(_PERS[rest[0]]);
          if (_NUM[rest[1]]) parts.push(_NUM[rest[1]]);
        }
      } else {
        let label = _CATSS_POS[pos];
        if (!label) return "";
        if (pos === "RD") label = _CATSS_RD_LEMMA[(lemma || "").normalize("NFC")] || "Demonstrative pronoun";
        parts = [label, ..._decodeCNG(p)];
      }
    } else if (m.indexOf("-") >= 0) {
      // ---- Robinson (NT) ----
      const seg = m.split("-");
      const pos = seg[0];
      if (pos === "V") {
        let tvm = seg[1] || "";
        if (/^[23]/.test(tvm)) tvm = tvm.slice(1); // 2nd aorist/perfect
        parts = ["Verb"];
        if (_ROB_TENSE[tvm[0]]) parts.push(_ROB_TENSE[tvm[0]]);
        if (_ROB_VOICE[tvm[1]]) parts.push(_ROB_VOICE[tvm[1]]);
        if (_ROB_MOOD[tvm[2]]) parts.push(_ROB_MOOD[tvm[2]]);
        const rest = seg[2] || "";
        if (rest) {
          if (tvm[2] === "P") parts.push(..._decodeCNG(rest)); // participle
          else {
            if (_PERS[rest[0]]) parts.push(_PERS[rest[0]]);
            if (_NUM[rest[1]]) parts.push(_NUM[rest[1]]);
          }
        }
      } else if (pos === "PRT") {
        parts = ["Particle"];
        if (seg[1] === "N") parts.push("Negative");else if (seg[1] === "I") parts.push("Interrogative");
      } else {
        const label = _ROB_POS[pos];
        if (!label) return "";
        const p = seg[1] || "";
        if (p === "PRI") return "Proper noun (indeclinable)";
        if (p === "NUI") return "Numeral (indeclinable)";
        parts = [label];
        if (pos === "P" && /^[123]/.test(p)) {
          // personal pron: person·case·number
          if (_PERS[p[0]]) parts.push(_PERS[p[0]]);
          if (_CASE[p[1]]) parts.push(_CASE[p[1]]);
          if (_NUM[p[2]]) parts.push(_NUM[p[2]]);
        } else {
          parts.push(..._decodeCNG(p)); // incl. αὐτός P-GSM, drops trailing -T
        }
      }
    } else {
      // ---- bare POS token ----
      const label = m.length === 1 ? _CATSS_POS[m] : _ROB_POS[m];
      if (!label) return "";
      parts = [label];
    }
  } catch (e) {
    return "";
  }
  return parts.filter(Boolean).join(" · ");
}

// Which Strong's number a detail entry shows: a proper-noun slot ('*') stays '*';
// otherwise prefer the bare `strongs`, falling back to `strongs_base`.
function entrySnum(s) {
  return s.strongs_base === "*" ? "*" : s.strongs && s.strongs !== "*" ? s.strongs : s.strongs_base;
}

// Shared core of a detail-panel word entry. Callers add their own `id`, `gloss`
// source, and any extra fields (gloss_head, morph, is_primary, …).
function wordEntryCore(src, {
  ref,
  book,
  chapter,
  verse,
  gloss
}) {
  return {
    strongs: strongsTag(entrySnum(src)),
    strongs_base: src.strongs_base,
    strongs_raw: entrySnum(src),
    greek: src.lemma || "",
    translit: src.translit || "",
    gloss: gloss || "",
    ref,
    book,
    chapter,
    verse,
    definition: src.strongs_def || "",
    derivation: src.derivation || "",
    is_function: src.is_function || false,
    is_pn: src.is_pn || false
  };
}
function makeEntry(r, idx) {
  return {
    id: `${entrySnum(r)}-${r.book}-${r.chapter}-${r.verse}-${idx}`,
    ...wordEntryCore(r, {
      ref: r.ref,
      book: r.book,
      chapter: r.chapter,
      verse: r.verse,
      gloss: r.gloss
    }),
    gloss_head: r.gloss_head || ""
  };
}
function flattenAiResults(verses) {
  const entries = [];
  let idx = 0;
  for (const v of verses) {
    for (const w of v.words || []) {
      entries.push({
        id: `ai-${v.book}-${v.chapter}-${v.verse}-${entrySnum(w)}-${idx++}`,
        ...wordEntryCore(w, {
          ref: v.ref,
          book: v.book,
          chapter: v.chapter,
          verse: v.verse,
          gloss: w.gloss
        }),
        is_primary: v.is_primary || false,
        is_additional: v.is_additional || false
      });
    }
  }
  return entries;
}

// ============================================================
// BOOK LABELS
// ============================================================
const NT_BOOKS = new Set(["Mat", "Mar", "Luk", "Joh", "Act", "Rom", "1Co", "2Co", "Gal", "Eph", "Php", "Col", "1Th", "2Th", "1Ti", "2Ti", "Tit", "Phm", "Heb", "Jas", "1Pe", "2Pe", "1Jn", "2Jn", "3Jn", "Jud", "Rev"]);
const BOOK_ORDER = {};
["Gen", "Exo", "Lev", "Num", "Deu", "Jos", "Jdg", "Rth", "1Sa", "2Sa", "1Ki", "2Ki", "1Ch", "2Ch", "Ezr", "Neh", "Est", "Job", "Psa", "Pro", "Ecc", "Son", "Isa", "Jer", "Lam", "Eze", "Dan", "Hos", "Joe", "Amo", "Oba", "Jon", "Mic", "Nah", "Hab", "Zep", "Hag", "Zec", "Mal", "Mat", "Mar", "Luk", "Joh", "Act", "Rom", "1Co", "2Co", "Gal", "Eph", "Php", "Col", "1Th", "2Th", "1Ti", "2Ti", "Tit", "Phm", "Heb", "Jas", "1Pe", "2Pe", "1Jn", "2Jn", "3Jn", "Jud", "Rev"].forEach((b, i) => {
  BOOK_ORDER[b] = i;
});
const BOOK_LABELS = {
  Gen: "Genesis",
  Exo: "Exodus",
  Lev: "Leviticus",
  Num: "Numbers",
  Deu: "Deuteronomy",
  Jos: "Joshua",
  Jdg: "Judges",
  Rth: "Ruth",
  "1Sa": "1 Samuel",
  "2Sa": "2 Samuel",
  "1Ki": "1 Kings",
  "2Ki": "2 Kings",
  "1Ch": "1 Chronicles",
  "2Ch": "2 Chronicles",
  Ezr: "Ezra",
  Neh: "Nehemiah",
  Est: "Esther",
  Job: "Job",
  Psa: "Psalms",
  Pro: "Proverbs",
  Ecc: "Ecclesiastes",
  Son: "Song of Solomon",
  Isa: "Isaiah",
  Jer: "Jeremiah",
  Lam: "Lamentations",
  Eze: "Ezekiel",
  Dan: "Daniel",
  Hos: "Hosea",
  Joe: "Joel",
  Amo: "Amos",
  Oba: "Obadiah",
  Jon: "Jonah",
  Mic: "Micah",
  Nah: "Nahum",
  Hab: "Habakkuk",
  Zep: "Zephaniah",
  Hag: "Haggai",
  Zec: "Zechariah",
  Mal: "Malachi",
  Mat: "Matthew",
  Mar: "Mark",
  Luk: "Luke",
  Joh: "John",
  Act: "Acts",
  Rom: "Romans",
  "1Co": "1 Corinthians",
  "2Co": "2 Corinthians",
  Gal: "Galatians",
  Eph: "Ephesians",
  Php: "Philippians",
  Col: "Colossians",
  "1Th": "1 Thessalonians",
  "2Th": "2 Thessalonians",
  "1Ti": "1 Timothy",
  "2Ti": "2 Timothy",
  Tit: "Titus",
  Phm: "Philemon",
  Heb: "Hebrews",
  Jas: "James",
  "1Pe": "1 Peter",
  "2Pe": "2 Peter",
  "1Jn": "1 John",
  "2Jn": "2 John",
  "3Jn": "3 John",
  Jud: "Jude",
  Rev: "Revelation"
};

// ============================================================
// ICONS — minimal line set
// ============================================================
const Icon = {
  Search: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "11",
    r: "7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m20 20-3.5-3.5"
  })),
  Sparkle: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("path", {
    d: "M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"
  })),
  Close: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("path", {
    d: "M6 6l12 12M6 18 18 6"
  })),
  ArrowRight: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("path", {
    d: "M5 12h14M13 6l6 6-6 6"
  })),
  Book: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("path", {
    d: "M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5a2.5 2.5 0 0 0 0 5H20"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 6h8M8 10h6"
  })),
  Filter: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("path", {
    d: "M3 6h18M6 12h12M10 18h4"
  })),
  Bookmark: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("path", {
    d: "M6 3h12v18l-6-4-6 4z"
  })),
  // Note / highlight marker — a pencil (annotation)
  Note: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("path", {
    d: "M4 20h4L18.5 9.5l-4-4L4 16z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M13 7l4 4"
  })),
  Copy: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("rect", {
    x: "8",
    y: "8",
    width: "13",
    height: "13",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"
  })),
  Share: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("path", {
    d: "M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"
  })),
  Grid: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "15",
    height: "15",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "3",
    width: "7",
    height: "7",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "3",
    width: "7",
    height: "7",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "14",
    width: "7",
    height: "7",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "14",
    width: "7",
    height: "7",
    rx: "1"
  })),
  Lines: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "15",
    height: "15",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("path", {
    d: "M3 6h18M3 11h18M3 16h12"
  })),
  Panel: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "3",
    width: "18",
    height: "18",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M15 3v18"
  })),
  // Strong's numbers → hash
  Hash: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("path", {
    d: "M10 3 8 21M16 3l-2 18M4 8.5h16M3 15.5h16"
  })),
  // Interlinear → Greek stacked over English (two rows)
  Interlinear: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("path", {
    d: "M4 6h16M4 9.5h11"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M4 15h16M4 18.5h11"
  })),
  // Parallel → two side-by-side columns
  Columns: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "4",
    width: "7.5",
    height: "16",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "13.5",
    y: "4",
    width: "7.5",
    height: "16",
    rx: "1"
  })),
  // Chronological order → clock
  Clock: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 7v5l3.5 2"
  })),
  // Overview / summary → info circle
  Info: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "20",
    height: "20",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 11v5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 8h.01"
  })),
  // Audio play (filled triangle, reads as a media control)
  Play: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "currentColor"
  }, p), /*#__PURE__*/React.createElement("path", {
    d: "M7 4.5v15l12-7.5z"
  })),
  // Audio pause (two filled bars)
  Pause: p => /*#__PURE__*/React.createElement("svg", _extends({
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "currentColor"
  }, p), /*#__PURE__*/React.createElement("rect", {
    x: "6.5",
    y: "5",
    width: "4",
    height: "14",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "13.5",
    y: "5",
    width: "4",
    height: "14",
    rx: "1"
  }))
};

// ============================================================
// NOTES STORE — browser-local, migration-ready
// ------------------------------------------------------------
// v1 keeps study notes in the browser only (no login, no bible.db write).
// The shape here is the EXACT shape a future server/account will use, so
// moving notes up later is a straight copy, not a rewrite:
//   - each note gets its OWN id the moment it's created (clean device-merge
//     / re-upload later)
//   - the anchor is a word-position range (corpus, which text, book, chapter,
//     start verse+word-spot, end verse+word-spot) so a future highlight layer
//     can paint the exact words
// Highlighting (color + painting the marks) is the NEXT phase; `color` is
// stored blank now so it's already there when that lands.
// ============================================================
// Highlight palette — ids map to CSS classes (.lib-hi-<id>) + swatch colors.
const NOTE_COLORS = ["yellow", "green", "blue", "pink", "orange"];
const NOTE_COLOR_CSS = {
  yellow: "#ffe89e",
  green: "#bdeec0",
  blue: "#bfe0ff",
  pink: "#ffcfe1",
  orange: "#ffd6a6"
};
const NotesStore = function () {
  const KEY = "lexica.notes.v1";
  const DEVKEY = "lexica.device.v1";
  const AUTHKEY = "lexica.auth.v1"; // { token, email } when signed in
  const JKEY = "lexica.journal.active.v1"; // id of the journal page you last opened
  const listeners = new Set();
  let cache = null;

  // --- sync state ---
  let syncTimer = null;
  let applyingRemote = false; // suppress re-scheduling while folding in the server's copy
  let syncing = false;
  let lastSync = 0; // ms epoch of last successful sync

  function load() {
    if (cache) return cache;
    try {
      cache = JSON.parse(localStorage.getItem(KEY)) || [];
    } catch (e) {
      cache = [];
    }
    if (!Array.isArray(cache)) cache = [];
    return cache;
  }
  const live = n => !n.deleted; // tombstones stay in the store (for sync) but hide everywhere else
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch (e) {/* storage full / blocked */}
    listeners.forEach(fn => {
      try {
        fn();
      } catch (e) {}
    });
    scheduleSync();
  }
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "n_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }
  // A stable per-browser id, made once — harmless now, helps a future account
  // merge tell this device's notes apart.
  function deviceId() {
    let d = null;
    try {
      d = localStorage.getItem(DEVKEY);
    } catch (e) {}
    if (!d) {
      d = newId();
      try {
        localStorage.setItem(DEVKEY, d);
      } catch (e) {}
    }
    return d;
  }

  // Fold a list of notes into the store by id: newer `updated` wins, tombstones
  // (deleted:true) included. Shared by Import (backup file) and Sync (server).
  function merge(incoming) {
    if (!Array.isArray(incoming)) return {
      added: 0,
      updated: 0,
      skipped: 0
    };
    const cur = load();
    const byId = new Map(cur.map(n => [n.id, n]));
    let added = 0,
      updated = 0,
      skipped = 0;
    for (const n of incoming) {
      // journal pages have no verse anchor (no .start) — let them through too
      if (!n || !n.id || n.kind !== "journal" && !n.start) {
        skipped++;
        continue;
      }
      const ex = byId.get(n.id);
      if (!ex) {
        cur.push(n);
        byId.set(n.id, n);
        added++;
      } else if ((n.updated || "") > (ex.updated || "")) {
        Object.assign(ex, n);
        updated++;
      } else skipped++;
    }
    persist();
    return {
      added,
      updated,
      skipped
    };
  }

  // --- account (email + password) ---
  function getAuth() {
    try {
      return JSON.parse(localStorage.getItem(AUTHKEY)) || null;
    } catch (e) {
      return null;
    }
  }
  function setAuth(a) {
    try {
      a ? localStorage.setItem(AUTHKEY, JSON.stringify(a)) : localStorage.removeItem(AUTHKEY);
    } catch (e) {}
    listeners.forEach(fn => {
      try {
        fn();
      } catch (e) {}
    });
  }
  function notify() {
    listeners.forEach(fn => {
      try {
        fn();
      } catch (e) {}
    });
  }
  function scheduleSync() {
    const a = getAuth();
    if (applyingRemote || !a || !a.token) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncNow();
    }, 2500);
  }
  async function syncNow() {
    const a = getAuth();
    if (!a || !a.token) return {
      ok: false,
      reason: "off"
    };
    syncing = true;
    notify();
    try {
      const res = await fetch("/api/notes/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + a.token
        },
        body: JSON.stringify({
          notes: load()
        })
      });
      if (res.status === 401) {
        setAuth(null);
        return {
          ok: false,
          reason: "signed-out"
        };
      }
      if (!res.ok) return {
        ok: false,
        status: res.status
      };
      const data = await res.json();
      applyingRemote = true;
      merge(data.notes || []); // fold the account's copy back in (no re-schedule)
      applyingRemote = false;
      lastSync = Date.now();
      return {
        ok: true
      };
    } catch (e) {
      return {
        ok: false,
        error: String(e)
      };
    } finally {
      syncing = false;
      notify();
    }
  }
  // POST to an auth endpoint; on success store {token,email} and push/pull notes.
  async function authPost(path, email, password) {
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          password
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return {
        ok: false,
        error: data.error || "Something went wrong."
      };
      setAuth({
        token: data.token,
        email: data.email
      });
      syncNow(); // push local notes up + pull the account's down
      return {
        ok: true,
        email: data.email
      };
    } catch (e) {
      return {
        ok: false,
        error: "Network error."
      };
    }
  }
  return {
    // newest-edited first (tombstones hidden). Journal pages are a separate
    // free-form mode — they live in journals(), not the anchored-note list.
    all() {
      return load().filter(n => live(n) && n.kind !== "journal").sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
    },
    // Free-form journal pages (kind:"journal"), newest-edited first.
    journals() {
      return load().filter(n => live(n) && n.kind === "journal").sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
    },
    createJournal() {
      const now = new Date().toISOString();
      const page = {
        id: newId(),
        device: deviceId(),
        kind: "journal",
        title: "",
        body: "",
        created: now,
        updated: now
      };
      load().push(page);
      persist();
      return page;
    },
    // The journal page you last opened — what "send verse to journal" targets.
    // Validated: returns null if the page was since deleted.
    getActiveJournal() {
      let id = null;
      try {
        id = localStorage.getItem(JKEY);
      } catch (e) {}
      if (!id) return null;
      const n = load().find(x => x.id === id);
      return n && live(n) && n.kind === "journal" ? id : null;
    },
    setActiveJournal(id) {
      try {
        id ? localStorage.setItem(JKEY, id) : localStorage.removeItem(JKEY);
      } catch (e) {}
    },
    // Append text to a journal page (blank line between blocks). Returns the page.
    appendToJournal(id, text) {
      const n = this.get(id);
      if (!n || n.kind !== "journal") return null;
      const sep = n.body && n.body.trim() ? "\n\n" : "";
      return this.update(id, {
        body: (n.body || "") + sep + text
      });
    },
    get(id) {
      const n = load().find(x => x.id === id);
      return n && live(n) ? n : null;
    },
    // An existing (non-deleted) record on the exact same words, so we reuse it
    // instead of stacking duplicates.
    findAnchor(a) {
      const sp = a.start.pos ?? null,
        ep = (a.end && a.end.pos) ?? null;
      const ev = a.end && a.end.verse || a.start.verse;
      return load().find(n => live(n) && n.corpus === a.corpus && n.book === a.book && n.chapter === a.chapter && n.start.verse === a.start.verse && (n.end && n.end.verse || n.start.verse) === ev && (n.start.pos ?? null) === sp && ((n.end && n.end.pos) ?? null) === ep) || null;
    },
    forChapter(corpus, book, chapter) {
      return load().filter(n => live(n) && n.corpus === corpus && n.book === book && n.chapter === chapter);
    },
    create(anchor) {
      const now = new Date().toISOString();
      const note = {
        id: newId(),
        device: deviceId(),
        body: "",
        color: null,
        created: now,
        updated: now,
        ...anchor
      };
      load().push(note);
      persist();
      return note;
    },
    update(id, fields) {
      const n = this.get(id);
      if (!n) return null;
      Object.assign(n, fields, {
        updated: new Date().toISOString()
      });
      persist();
      return n;
    },
    // SOFT delete — keep a tombstone so the delete propagates through sync/import
    // instead of the note re-appearing from another device.
    remove(id) {
      const n = load().find(x => x.id === id);
      if (!n) return;
      Object.assign(n, {
        deleted: true,
        title: "",
        body: "",
        color: null,
        bookmark: false,
        updated: new Date().toISOString()
      });
      persist();
    },
    search(text) {
      const t = (text || "").toLowerCase().trim();
      const list = this.all();
      if (!t) return list;
      return list.filter(n => (n.body || "").toLowerCase().includes(t) || (n.snippet || "").toLowerCase().includes(t) || (n.refLabel || "").toLowerCase().includes(t));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    exportData() {
      return {
        app: "lexica-notes",
        version: 1,
        exported: new Date().toISOString(),
        notes: load()
      };
    },
    importMerge(incoming) {
      return merge(incoming);
    },
    // --- account API ---
    auth: getAuth,
    authInfo() {
      const a = getAuth();
      return {
        email: a && a.email,
        token: a && a.token,
        syncing,
        last: lastSync
      };
    },
    signup(email, password) {
      return authPost("/api/auth/signup", email, password);
    },
    login(email, password) {
      return authPost("/api/auth/login", email, password);
    },
    // Sign in with the signed token Google handed the browser.
    async googleLogin(credential) {
      try {
        const res = await fetch("/api/auth/google", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            credential
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return {
          ok: false,
          error: data.error || "Google sign-in failed."
        };
        setAuth({
          token: data.token,
          email: data.email
        });
        syncNow();
        return {
          ok: true,
          email: data.email
        };
      } catch (e) {
        return {
          ok: false,
          error: "Network error."
        };
      }
    },
    logout() {
      const a = getAuth();
      if (a && a.token) {
        fetch("/api/auth/logout", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + a.token
          }
        }).catch(() => {});
      }
      clearTimeout(syncTimer);
      setAuth(null);
    },
    syncNow
  };
}();

// On load, if signed in, pull once so this device catches up.
if (NotesStore.auth()) {
  setTimeout(() => NotesStore.syncNow(), 400);
}

// Re-render a component whenever the note store changes.
function useNotesVersion() {
  const [, force] = useState(0);
  useEffect(() => NotesStore.subscribe(() => force(v => v + 1)), []);
}

// ============================================================
// HEADER
// ============================================================
function Header({
  activeView,
  onNavChange
}) {
  return /*#__PURE__*/React.createElement("header", {
    className: "hdr"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hdr-inner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand-mark",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "22",
    height: "22",
    viewBox: "0 0 24 24",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5a2.5 2.5 0 0 0 0 5H19v-3",
    stroke: "currentColor",
    strokeWidth: "1.6",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M11 7v6M14 10h-6",
    stroke: "currentColor",
    strokeWidth: "1.6",
    strokeLinecap: "round"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "brand-text"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand-name"
  }, "Lexica"), /*#__PURE__*/React.createElement("div", {
    className: "brand-sub"
  }, "Greek & Hebrew Word Study"))), /*#__PURE__*/React.createElement("nav", {
    className: "hdr-nav"
  }, /*#__PURE__*/React.createElement("button", {
    className: "hdr-link " + (activeView === "library" ? "active" : ""),
    onClick: () => onNavChange("library")
  }, "Library"), /*#__PURE__*/React.createElement("button", {
    className: "hdr-link " + (activeView === "lexicon" ? "active" : ""),
    onClick: () => onNavChange("lexicon")
  }, "Lexicon"), /*#__PURE__*/React.createElement("button", {
    className: "hdr-link " + (activeView === "search" ? "active" : ""),
    onClick: () => onNavChange("search")
  }, "Search"), /*#__PURE__*/React.createElement("button", {
    className: "hdr-link " + (activeView === "notes" ? "active" : ""),
    onClick: () => onNavChange("notes")
  }, "Notes"), /*#__PURE__*/React.createElement("button", {
    className: "hdr-link " + (activeView === "about" ? "active" : ""),
    onClick: () => onNavChange("about")
  }, "About"))));
}

// ============================================================
// SEARCH BAR
// ============================================================
function SearchBar({
  q2,
  setQ2,
  onAiSearch,
  aiLoading
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: "search"
  }, /*#__PURE__*/React.createElement("div", {
    className: "search-cell"
  }, /*#__PURE__*/React.createElement("label", {
    className: "search-label"
  }, /*#__PURE__*/React.createElement("span", {
    className: "search-eyebrow ai"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ai-dot"
  }), "Ask the corpus")), /*#__PURE__*/React.createElement("form", {
    className: "search-field ai-field",
    onSubmit: e => {
      e.preventDefault();
      onAiSearch();
    }
  }, /*#__PURE__*/React.createElement(Icon.Sparkle, {
    className: "search-icon"
  }), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "search-input",
    placeholder: "Ask the corpus\u2026 Where does the divine council appear?",
    value: q2,
    onChange: e => setQ2(e.target.value)
  }), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "search-go",
    "aria-label": "Submit"
  }, aiLoading ? /*#__PURE__*/React.createElement("span", {
    className: "spinner"
  }) : /*#__PURE__*/React.createElement(Icon.ArrowRight, null)))));
}

// ============================================================
// RESULT CARD
// ============================================================
function ResultCard({
  entry,
  active,
  onClick,
  count
}) {
  return /*#__PURE__*/React.createElement("article", {
    className: "card " + (active ? "card-active" : ""),
    onClick: onClick,
    tabIndex: "0",
    onKeyDown: e => (e.key === "Enter" || e.key === " ") && onClick()
  }, /*#__PURE__*/React.createElement("div", {
    className: "card-top"
  }, /*#__PURE__*/React.createElement("span", {
    className: "card-ref"
  }, entry.ref), /*#__PURE__*/React.createElement("span", {
    className: "card-badge"
  }, entry.strongs)), /*#__PURE__*/React.createElement("div", {
    className: "card-main"
  }, entry.greek ? /*#__PURE__*/React.createElement("div", {
    className: "card-greek"
  }, entry.greek) : /*#__PURE__*/React.createElement("div", {
    className: "card-greek",
    style: {
      fontSize: "22px"
    }
  }, stripArticles(entry.gloss)), entry.greek && /*#__PURE__*/React.createElement("div", {
    className: "card-gloss"
  }, stripArticles(entry.gloss))), /*#__PURE__*/React.createElement("div", {
    className: "card-translit"
  }, entry.translit), /*#__PURE__*/React.createElement("div", {
    className: "card-foot"
  }, /*#__PURE__*/React.createElement("span", {
    className: "card-pos"
  }, BOOK_LABELS[entry.book] || entry.book), /*#__PURE__*/React.createElement("span", {
    className: "card-occ"
  }, count, "\xD7")));
}

// ============================================================
// LSJ SUMMARY DISPLAY
// ============================================================
function _senseLevel(marker) {
  if (!marker) return 0;
  if (/^[IVX]+\.$/.test(marker)) return 0;
  if (/^[A-E]\.$/.test(marker)) return 1;
  if (/^[1-9]/.test(marker)) return 2;
  return 3;
}
function _stripMd(text) {
  return text.replace(/^#+\s*/gm, "") // strip # ## ### headers
  .replace(/^\s*[-*]\s+/gm, "") // strip bullet points
  .replace(/\*\*(.+?)\*\*/g, "$1") // strip bold **
  .replace(/\*(.+?)\*/g, "$1") // strip italic *
  .replace(/\s{2,}/g, " ").trim();
}
const _REFUSAL_RE = /^(I |A\.\s*I |I'm |I don't|I cannot|I appreciate|I need|Unfortunately)/i;
function LsjSummary({
  data,
  loading
}) {
  if (loading) return /*#__PURE__*/React.createElement("div", {
    className: "lsj-def",
    style: {
      color: "var(--muted)",
      fontStyle: "italic"
    }
  }, "Summarizing\u2026");
  if (!data?.summary) return /*#__PURE__*/React.createElement("div", {
    className: "lsj-def",
    style: {
      color: "var(--muted)"
    }
  }, "No definition available.");
  return /*#__PURE__*/React.createElement("p", {
    className: "lsj-synthesis"
  }, renderInlineMd(data.summary));
}

// Google-Maps-style bottom-sheet dismissal: drag the WHOLE card down to close.
// Grabbing the card's top chrome (the handle/header — anything outside the
// scrolling body) ALWAYS arms the drag, no matter where the body is scrolled.
// Starting inside the body only arms when it's already scrolled to the top
// (otherwise the body scrolls normally). Uses native non-passive listeners so we
// can block page scroll / pull-to-refresh while dragging (React's touch props
// are passive and can't).
function useSwipeToDismiss(onClose) {
  const sheetRef = React.useRef(null);
  const scrollRef = React.useRef(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    let startY = 0,
      dragY = 0,
      active = false,
      fromChrome = false;
    const SNAP = 'transform 0.25s cubic-bezier(0.2,0.8,0.2,1)';
    const atTop = () => {
      const sc = scrollRef.current;
      return !sc || sc.scrollTop <= 0;
    };
    const onStart = e => {
      const sc = scrollRef.current;
      fromChrome = !(sc && sc.contains(e.target)); // touch began on the handle/header, not the scroll body
      active = fromChrome || atTop(); // chrome always arms; body only when scrolled to top
      startY = e.touches[0].clientY;
      dragY = 0;
    };
    const onMove = e => {
      if (!active) return;
      const d = e.touches[0].clientY - startY;
      if (d <= 0 || !fromChrome && !atTop()) {
        // pulling up, or body-drag that got scrolled → hand back
        if (dragY) {
          el.style.transition = '';
          el.style.transform = '';
          dragY = 0;
        }
        active = false;
        return;
      }
      dragY = d;
      el.style.transition = 'none';
      el.style.transform = `translateY(${d}px)`;
      if (e.cancelable) e.preventDefault(); // stop the page scrolling / pull-to-refresh
    };
    const onEnd = () => {
      if (!active) return;
      active = false;
      if (dragY > 90) {
        // committed: slide the card fully down, THEN dismiss
        el.style.transition = SNAP;
        el.style.transform = 'translateY(100%)';
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          el.removeEventListener('transitionend', finish);
          closeRef.current?.();
        };
        el.addEventListener('transitionend', finish);
        setTimeout(finish, 320); // fallback if transitionend doesn't fire
        dragY = 0;
        return;
      }
      if (dragY) {
        el.style.transition = SNAP;
        el.style.transform = '';
      } // not far enough: snap back up
      dragY = 0;
    };
    el.addEventListener('touchstart', onStart, {
      passive: true
    });
    el.addEventListener('touchmove', onMove, {
      passive: false
    });
    el.addEventListener('touchend', onEnd, {
      passive: true
    });
    el.addEventListener('touchcancel', onEnd, {
      passive: true
    });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);
  return {
    sheetRef,
    scrollRef
  };
}

// ============================================================
// LEAFLET MINI-MAP
// ============================================================
// Leaflet (CSS+JS) is loaded ON DEMAND — the map only ever appears inside the
// metaV place card, so keeping it out of index.html keeps it off the critical
// path for every page load. Loaded once, cached on window.L for later opens.
let _leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (_leafletPromise) return _leafletPromise;
  _leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    css.crossOrigin = "";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    js.crossOrigin = "";
    js.onload = () => resolve(window.L);
    js.onerror = reject;
    document.head.appendChild(js);
  });
  return _leafletPromise;
}
function LeafletMap({
  lat,
  lon,
  name
}) {
  const mapRef = React.useRef(null);
  const instanceRef = React.useRef(null);
  const [ready, setReady] = React.useState(!!window.L);

  // Kick off the lazy load on first mount (no-op if Leaflet is already present).
  React.useEffect(() => {
    if (window.L) return;
    let cancelled = false;
    loadLeaflet().then(() => {
      if (!cancelled) setReady(true);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  React.useEffect(() => {
    if (!ready || !mapRef.current || !window.L) return;
    if (instanceRef.current) {
      instanceRef.current.remove();
      instanceRef.current = null;
    }
    const map = window.L.map(mapRef.current, {
      center: [lat, lon],
      zoom: 7,
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: false
    });
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);
    window.L.marker([lat, lon]).addTo(map).bindPopup(name).openPopup();
    instanceRef.current = map;
    return () => {
      if (instanceRef.current) {
        instanceRef.current.remove();
        instanceRef.current = null;
      }
    };
  }, [ready, lat, lon, name]);
  return /*#__PURE__*/React.createElement("div", {
    ref: mapRef,
    className: "metav-leaflet-map"
  });
}

// ============================================================
// SUMMARY PANEL — Library right-pane DEFAULT (desktop) / bottom sheet (mobile)
// ------------------------------------------------------------
// A short Berean book blurb + a pericope-aware chapter summary for whatever the
// reader is on. On DESKTOP it's the resting content of the right sidebar (reuses
// the .detail-side shell); a word/verse click replaces it and closing returns
// here. On MOBILE it opens on demand as a bottom sheet from the reading cockpit's
// ⓘ button (isMobile + onClose), riding the same .detail-sheet rails as the
// word-study sheet.
// ============================================================
function SummaryPanel({
  book,
  chapter,
  bookLabel,
  isMobile,
  onClose
}) {
  // Remembers fetched summaries across remounts (the panel unmounts whenever a
  // word/verse takes over the slot) so re-opening the same chapter is instant
  // instead of flashing the loading line again.
  const key = book + "/" + chapter;
  const [data, setData] = useState(() => SummaryPanel._cache[key] || null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!book || !chapter) return;
    const cached = SummaryPanel._cache[key];
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setData(null);
    api.summary(book, chapter).then(d => {
      if (!cancelled) {
        SummaryPanel._cache[key] = d || {};
        setData(d || {});
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setData({});
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [book, chapter]);

  // Swipe-to-dismiss for the mobile sheet (same hook the word-study / xref sheets
  // use). Harmlessly no-ops on desktop, where sheetRef is never attached.
  const {
    sheetRef,
    scrollRef
  } = useSwipeToDismiss(onClose);
  const bookText = data && data.book_summary;
  const chapText = data && data.chapter_summary;
  const nothing = !loading && !bookText && !chapText;
  const title = (bookLabel || book) + (chapter ? " " + chapter : "");
  const content = /*#__PURE__*/React.createElement(React.Fragment, null, loading && /*#__PURE__*/React.createElement("div", {
    className: "summary-loading"
  }, "Reading the chapter\u2026"), !loading && bookText && /*#__PURE__*/React.createElement("div", {
    className: "detail-section"
  }, /*#__PURE__*/React.createElement("div", {
    className: "detail-h"
  }, "About"), /*#__PURE__*/React.createElement("p", {
    className: "detail-p"
  }, renderInlineMd(bookText))), !loading && chapText && /*#__PURE__*/React.createElement("div", {
    className: "detail-section last"
  }, /*#__PURE__*/React.createElement("div", {
    className: "detail-h"
  }, "This chapter"), /*#__PURE__*/React.createElement("p", {
    className: "detail-p"
  }, renderInlineMd(chapText))), nothing && /*#__PURE__*/React.createElement("div", {
    className: "summary-loading"
  }, "No overview available for this passage."));

  // Mobile: bottom sheet opened from the reading cockpit. Swipe down (drag
  // anywhere) or tap the scrim / X to close — matches the other sheets.
  if (isMobile) {
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "sheet-scrim",
      onClick: onClose
    }), /*#__PURE__*/React.createElement("aside", {
      ref: sheetRef,
      className: "detail detail-sheet summary-sheet",
      role: "dialog",
      "aria-label": "Reading overview"
    }, /*#__PURE__*/React.createElement("div", {
      className: "sheet-drag-zone",
      "aria-hidden": "true"
    }, /*#__PURE__*/React.createElement("div", {
      className: "sheet-handle"
    })), /*#__PURE__*/React.createElement("div", {
      className: "detail-head"
    }, /*#__PURE__*/React.createElement("div", {
      className: "detail-head-l"
    }, /*#__PURE__*/React.createElement("span", {
      className: "detail-pos summary-pos"
    }, title)), /*#__PURE__*/React.createElement("button", {
      className: "detail-close",
      onClick: onClose,
      "aria-label": "Close"
    }, /*#__PURE__*/React.createElement(Icon.Close, null))), /*#__PURE__*/React.createElement("div", {
      className: "detail-body",
      ref: scrollRef
    }, content)));
  }

  // Desktop: resting content of the right sidebar.
  return /*#__PURE__*/React.createElement("aside", {
    className: "detail detail-side summary-side",
    role: "complementary",
    "aria-label": "Reading overview"
  }, /*#__PURE__*/React.createElement("div", {
    className: "detail-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "detail-head-l"
  }, /*#__PURE__*/React.createElement("span", {
    className: "detail-pos summary-pos"
  }, title))), /*#__PURE__*/React.createElement("div", {
    className: "detail-body"
  }, content));
}
SummaryPanel._cache = {};

// ============================================================
// DETAIL PANEL — SIDEBAR / BOTTOM SHEET
// ============================================================
function DetailPanel({
  entry,
  isMobile,
  onClose,
  occurrences,
  totalResults,
  onStrongsSearch,
  onReadInContext,
  onNameSearch,
  onNavigateToLexicon,
  overviewBack
}) {
  const [verseText, setVerseText] = useState("");
  const [verseLoading, setVerseLoading] = useState(false);
  const [abpCount, setAbpCount] = useState(null);
  const [extraCount, setExtraCount] = useState(null);
  const [showInterlinear, setShowInterlinear] = useState(false);
  const [interlinearWords, setInterlinearWords] = useState(null);
  useEffect(() => {
    setShowInterlinear(false);
    setInterlinearWords(null);
  }, [entry && entry.id]);
  useEffect(() => {
    if (!showInterlinear || !entry || interlinearWords) return;
    let cancelled = false;
    api.verseWords(entry.book, entry.chapter, entry.verse).then(d => {
      if (!cancelled) setInterlinearWords(d.words || []);
    }).catch(() => {
      if (!cancelled) setInterlinearWords([]);
    });
    return () => {
      cancelled = true;
    };
  }, [showInterlinear, entry && entry.id]);
  useEffect(() => {
    if (!entry || entry.isExtra) return; // non-canonical words have no Bible verse to load
    let cancelled = false;
    setVerseText("");
    setVerseLoading(true);
    api.verse(entry.book, entry.chapter, entry.verse).then(data => {
      if (!cancelled) setVerseText(data.text || "");
    }).catch(() => {
      if (!cancelled) setVerseText("");
    }).finally(() => {
      if (!cancelled) setVerseLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [entry && entry.id]);
  useEffect(() => {
    if (!entry || entry.strongs_base === "*") {
      setAbpCount(null);
      return;
    }
    let cancelled = false;
    api.strongsCount(entry.strongs_raw).then(d => {
      if (!cancelled) setAbpCount(d.count ?? null);
    }).catch(() => {
      if (!cancelled) setAbpCount(null);
    });
    return () => {
      cancelled = true;
    };
  }, [entry && entry.strongs_raw]);

  // Count within the non-canonical text itself (e.g. the Didache).
  useEffect(() => {
    if (!entry || !entry.isExtra || !entry.extraBook || !entry.strongs_base || entry.strongs_base === "*") {
      setExtraCount(null);
      return;
    }
    let cancelled = false;
    api.extraStrongsCount(entry.extraBook, entry.strongs_base).then(d => {
      if (!cancelled) setExtraCount(d.count ?? null);
    }).catch(() => {
      if (!cancelled) setExtraCount(null);
    });
    return () => {
      cancelled = true;
    };
  }, [entry && entry.id]);
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
    api.pnCount(name).then(d => {
      if (!cancelled) setPnCount(d.count ?? null);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entry && entry.id]);

  // KJV occurrence count for Hebrew words
  const [kjvCount, setKjvCount] = useState(null);
  useEffect(() => {
    setKjvCount(null);
    if (!isHebrew && !entry.isKjv || !entry.strongs) return;
    let cancelled = false;
    api.kjvStrongsCount(entry.strongs).then(d => {
      if (!cancelled) setKjvCount(d.count ?? null);
    }).catch(() => {
      if (!cancelled) setKjvCount(null);
    });
    return () => {
      cancelled = true;
    };
  }, [entry && entry.strongs]);

  // metaV person/place lookup — runs on any word click where gloss may be a name
  const [metavPersonData, setMetavPersonData] = useState(null);
  const [metavPlaceData, setMetavPlaceData] = useState(null);
  const [metavTab, setMetavTab] = useState("person"); // "person" | "place"
  const [metavLoading, setMetavLoading] = useState(false);
  // Derived — all downstream code uses these unchanged.
  // If the word's OWN proper-noun type (tipnr pn_types) is a clean SINGLE type and
  // we have that card, the word IS that entity — the other metaV card is a
  // name-coincidence (loose name-based lookup), so PIN to the single entity and
  // suppress the Person/Place toggle. When pn_types is ambiguous ('person,place':
  // a strongs shared by a genuine person AND place — Adam, Dan) or absent (a
  // non-Library entry, or no tipnr row), keep the toggle so the user can see both.
  const pnList = (entry && entry.pn_types || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const pnSingle = pnList.length === 1 && (pnList[0] === "person" || pnList[0] === "place") ? pnList[0] : null;
  const metavPinned = pnSingle === "person" && metavPersonData ? "person" : pnSingle === "place" && metavPlaceData ? "place" : null;
  const metavHasBoth = !!(metavPersonData && metavPlaceData) && !metavPinned;
  const metavType = metavPinned ? metavPinned : metavHasBoth ? metavTab : metavPersonData ? "person" : metavPlaceData ? "place" : null;
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
    const _DIVINE_SKIP = new Set(["LORD", "Lord", "YHWH", "Yahweh", "Jehovah", "Holy"]);
    if (_DIVINE_SKIP.has(name)) return;
    let cancelled = false;
    setMetavLoading(true);
    Promise.all([api.metavPerson(name).catch(() => ({
      error: true
    })), api.metavPlace(name).catch(() => ({
      error: true
    }))]).then(([pd, ld]) => {
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
      if (pnTypes.length === 1 && pnTypes[0] === "person") tab = "person";else if (pnTypes.length === 1 && pnTypes[0] === "place") tab = "place";else {
        const placeStrongsMatch = !ld.error && !!ld.strongs_g && !!entry.strongs_base && ld.strongs_g.split(/[^GH0-9.]+/i).map(s => s.toUpperCase()).includes(entry.strongs_base.toUpperCase());
        tab = placeStrongsMatch ? "place" : "person";
      }
      setMetavTab(tab);
      setMetavLoading(false);
    }).catch(() => {
      if (!cancelled) setMetavLoading(false);
    });
    return () => {
      cancelled = true;
    };
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
    api.metavAiDescription(name).then(d => {
      if (!cancelled && !d.error) setAiDescription(d.description || null);
    }).catch(() => {}).finally(() => {
      if (!cancelled) setAiDescLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [entry && entry.id, metavData, metavLoading]);

  // Hebrew BDB lookup
  const [bdbEntry, setBdbEntry] = useState(null);
  const [bdbLoading, setBdbLoading] = useState(false);
  useEffect(() => {
    setBdbEntry(null);
    if (!isHebrewWord || !entry.strongs) return;
    let cancelled = false;
    setBdbLoading(true);
    api.bdb(entry.strongs).then(d => {
      if (!cancelled) {
        setBdbEntry(d.error ? null : d);
        setBdbLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setBdbEntry(null);
        setBdbLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entry && entry.id]);

  // KJV verse text (when entry came from KJV mode, or is a Hebrew word)
  const [kjvVerseText, setKjvVerseText] = useState("");
  useEffect(() => {
    setKjvVerseText("");
    if (!entry || !entry.isKjv && !isHebrew && !(metavType === "place" && !isPN)) return;
    let cancelled = false;
    api.kjvVerse(entry.book, entry.chapter, entry.verse).then(d => {
      if (!cancelled) setKjvVerseText(d.text || "");
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
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
    const placeStrongs = isPN && metavType === "place" && metavData?.strongs_g?.length > 0 ? metavData.strongs_g.replace(/^G/i, "") : null;
    const canLookup = !isHebrew && entry && (entry.greek || entry.strongs_raw || placeStrongs);
    if (!canLookup) {
      setLsjLoading(false);
      return;
    }
    let cancelled = false;
    setLsjLoading(true);
    api.lsj(entry.greek || "", placeStrongs || entry.strongs_raw).then(d => {
      if (!cancelled) {
        setLsjEntry(d.error ? null : d);
        setLsjLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setLsjEntry(null);
        setLsjLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entry && entry.id, metavType, metavData?.strongs_g]);
  useEffect(() => {
    if (!lsjEntry || lsjEntry.source === "strongs") {
      setLsjSummary(null);
      setLsjSummaryLoading(false);
      return;
    }
    let cancelled = false;
    setLsjSummaryLoading(true);
    const summaryStrongs = lsjEntry.source === "abp_ext" ? lsjEntry.key : "";
    // Always request the verse-agnostic ("general") summary. A word's LSJ summary
    // is cached/shown universally, so it must not name the verse it was first clicked in.
    api.lsjSummary(lsjEntry.key, summaryStrongs).then(d => {
      if (!cancelled) setLsjSummary(d);
    }).catch(() => {
      if (!cancelled) setLsjSummary(null);
    }).finally(() => {
      if (!cancelled) setLsjSummaryLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [lsjEntry && lsjEntry.key, entry && entry.id]);
  if (!entry) return null;
  const barWidth = Math.min(100, occurrences / Math.max(1, totalResults) * 100);
  const morphLine = entry.greek && !isHebrew ? decodeMorph(entry.morph, entry.greek) : isHebrew ? entry.grammar || "" : ""; // Hebrew: the decoded TAHOT grammar, same card slot as Greek
  const {
    sheetRef,
    scrollRef
  } = useSwipeToDismiss(onClose);

  // --------------------------------------------------------------------------
  // Panel descriptor — resolve the isPN / isHebrew / metavType tangle into ONE
  // place: a `hero` block and an ordered `sections` list. The return below is
  // dumb: it renders `hero`, then `sections.map(renderSection)` — no decisions.
  // --------------------------------------------------------------------------
  const properName = extractProperName(entry.gloss);
  const nameOrGloss = isPN || metavData ? properName : entry.gloss;
  const trimTail = s => stripArticles(s?.replace(/[.,;:!?—-]+$/, "").trim());
  // Hebrew words show their gloss inline next to the transliteration; everything
  // else shows it on its own line. This boolean gates which (and the standalone).
  const heroHasHeGloss = !!(isHebrew && (bdbEntry?.xlit || entry.translit) && entry.gloss);
  const hero = {
    he: isHebrew,
    noGloss: isPN && !entry.greek && !isHebrew,
    script: isHebrew ? bdbEntry?.lemma || entry.gloss : entry.greek || nameOrGloss,
    translit: isHebrew ? bdbEntry?.xlit : entry.translit,
    inlineGloss: trimTail(nameOrGloss),
    standaloneGloss: trimTail(isPN || metavData ? properName : entry.greek && (entry.gloss || "").trim().split(/\s+/).length > 2 ? entry.english_head : entry.gloss),
    morph: morphLine
  };

  // Verse + place sections show KJV text (not ABP) for Hebrew / KJV-mode / place words.
  const useKjvText = entry.isKjv || isHebrew || metavType === "place" && !isPN;

  // Ordered list of stacked sections. BDB and LSJ are mutually exclusive (Hebrew
  // gets BDB; everything else may get LSJ) — same either/or as the old ternary.
  const sections = [];
  if (metavLoading || metavPersonData || metavPlaceData) sections.push("metav");
  if (aiDescription || aiDescLoading) sections.push("aidesc");
  if (isHebrewWord) sections.push("bdb");else if ((!isPN || metavType === "place" && metavData?.strongs_g?.length > 0) && metavType !== "person" && !aiDescription && !aiDescLoading && (entry.greek || entry.strongs_raw || metavData?.strongs_g?.length > 0)) sections.push("lsj");
  if (!isHebrew && !isPN && !entry.isKjv && abpCount !== null && abpCount > 0) sections.push("abpOcc");
  if (entry.isExtra && extraCount !== null && extraCount > 0) sections.push("extraOcc");
  if (entry.isKjv && !isHebrew && !isPN && kjvCount !== null && kjvCount > 0) sections.push("kjvOcc");
  if (!entry.isKjv && isPN && pnCount !== null && pnCount > 0 && onNameSearch) sections.push("pnOcc");
  if (isHebrew && kjvCount !== null && kjvCount > 0) sections.push("hebrewKjvOcc");
  if (entry.derivation) sections.push("derivation");
  if (entry.book && !entry.isExtra) sections.push("verse");
  if (occurrences > 0 || totalResults > 0) sections.push("frequency");
  const renderSection = id => {
    switch (id) {
      case "metav":
        return /*#__PURE__*/React.createElement("section", {
          key: "metav",
          className: "sec"
        }, metavLoading ? /*#__PURE__*/React.createElement("div", {
          className: "lsj-def lsj-def--loading"
        }, "Looking up\u2026") : /*#__PURE__*/React.createElement(React.Fragment, null, metavHasBoth && /*#__PURE__*/React.createElement("div", {
          className: "metav-type-tabs"
        }, /*#__PURE__*/React.createElement("button", {
          className: "metav-type-tab" + (metavTab === "person" ? " on" : ""),
          onClick: () => setMetavTab("person")
        }, "Person"), /*#__PURE__*/React.createElement("button", {
          className: "metav-type-tab" + (metavTab === "place" ? " on" : ""),
          onClick: () => setMetavTab("place")
        }, "Place")), metavType === "person" && metavData ? /*#__PURE__*/React.createElement("div", {
          className: "metav-person"
        }, /*#__PURE__*/React.createElement("h4", {
          className: "sec-head"
        }, /*#__PURE__*/React.createElement("span", {
          className: "sec-t"
        }, isGentilic ? "People / Clan" : "Biblical Person"), /*#__PURE__*/React.createElement("span", {
          className: "lsj-badge lsj-badge--gold"
        }, "metaV")), /*#__PURE__*/React.createElement("div", {
          className: "metav-meta"
        }, metavData.gender && /*#__PURE__*/React.createElement("span", {
          className: "metav-tag"
        }, metavData.gender === "M" ? "Male" : "Female"), metavData.groups.filter(g => g.startsWith("Tribe")).map(g => /*#__PURE__*/React.createElement("span", {
          key: g,
          className: "metav-tag"
        }, g)), metavData.groups.includes("Genealogy of Jesus") && /*#__PURE__*/React.createElement("span", {
          className: "metav-tag metav-tag-gold"
        }, "Genealogy of Jesus")), (metavData.birth_year || metavData.death_year) && /*#__PURE__*/React.createElement("p", {
          className: "detail-p detail-p--meta",
          style: {
            fontSize: "13px"
          }
        }, metavData.birth_year && /*#__PURE__*/React.createElement("span", null, "Born: ", metavData.birth_year, metavData.birth_place ? `, ${metavData.birth_place}` : ""), metavData.birth_year && metavData.death_year && " · ", metavData.death_year && /*#__PURE__*/React.createElement("span", null, "Died: ", metavData.death_year, metavData.death_place ? `, ${metavData.death_place}` : "")), metavData.relationships.length > 0 && /*#__PURE__*/React.createElement("div", {
          className: "metav-rels"
        }, [{
          types: ["child"],
          label: "Parent"
        }, {
          types: ["father", "mother"],
          label: "Children"
        }, {
          types: ["spouseOrConcubine"],
          label: "Spouse"
        }, {
          types: ["sibling", "halfSiblingSameFather", "halfSiblingSameMother"],
          label: "Siblings"
        }].map(({
          types,
          label
        }) => {
          const matching = metavData.relationships.filter(r => types.includes(r.type));
          if (!matching.length) return null;
          return /*#__PURE__*/React.createElement("div", {
            key: label,
            className: "metav-rel-row"
          }, /*#__PURE__*/React.createElement("span", {
            className: "metav-rel-label"
          }, label), /*#__PURE__*/React.createElement("span", {
            className: "metav-rel-names"
          }, matching.slice(0, 5).map(r => r.name).join(", "), matching.length > 5 ? ` +${matching.length - 5}` : ""));
        }))) : metavType === "place" && metavData ? /*#__PURE__*/React.createElement("div", {
          className: "metav-place"
        }, /*#__PURE__*/React.createElement("h4", {
          className: "sec-head"
        }, /*#__PURE__*/React.createElement("span", {
          className: "sec-t"
        }, isGentilic ? "Homeland" : "Biblical Place"), /*#__PURE__*/React.createElement("span", {
          className: "lsj-badge lsj-badge--gold"
        }, "metaV")), metavData.comment && /*#__PURE__*/React.createElement("p", {
          className: "detail-p detail-p--meta"
        }, metavData.comment), metavData.lat && metavData.lon ? /*#__PURE__*/React.createElement(LeafletMap, {
          lat: metavData.lat,
          lon: metavData.lon,
          name: metavData.name
        }) : /*#__PURE__*/React.createElement("p", {
          className: "detail-p detail-p--meta",
          style: {
            color: "var(--ink-4)",
            fontStyle: "italic"
          }
        }, "Location unknown")) : null));
      case "aidesc":
        return /*#__PURE__*/React.createElement("section", {
          key: "aidesc",
          className: "sec"
        }, /*#__PURE__*/React.createElement("h4", {
          className: "sec-head"
        }, /*#__PURE__*/React.createElement("span", {
          className: "sec-t"
        }, metavType === "place" ? "Biblical Place" : "Biblical Reference"), /*#__PURE__*/React.createElement("span", {
          className: "lsj-badge lsj-badge--accent"
        }, "AI")), aiDescLoading ? /*#__PURE__*/React.createElement("div", {
          className: "lsj-def lsj-def--loading"
        }, "Looking up\u2026") : /*#__PURE__*/React.createElement("p", {
          className: "detail-p detail-p--meta"
        }, renderInlineMd(aiDescription)));
      case "bdb":
        return /*#__PURE__*/React.createElement("section", {
          key: "bdb",
          className: "sec"
        }, /*#__PURE__*/React.createElement("h4", {
          className: "sec-head"
        }, /*#__PURE__*/React.createElement("span", {
          className: "sec-t"
        }, "Brown-Driver-Briggs"), /*#__PURE__*/React.createElement("span", {
          className: "bdb-badge"
        }, "BDB")), bdbLoading ? /*#__PURE__*/React.createElement("div", {
          className: "lsj-def lsj-def--loading"
        }, "Loading\u2026") : bdbEntry ? /*#__PURE__*/React.createElement("div", {
          className: "bdb-body"
        }, bdbEntry.pronounce && /*#__PURE__*/React.createElement("div", {
          className: "bdb-xlit"
        }, /*#__PURE__*/React.createElement("span", {
          className: "bdb-pronounce"
        }, bdbEntry.pronounce)), bdbEntry.part_of_speech && /*#__PURE__*/React.createElement("span", {
          className: "bdb-pos-badge"
        }, bdbEntry.part_of_speech), bdbEntry.description && /*#__PURE__*/React.createElement("p", {
          className: "detail-p detail-p--meta"
        }, bdbEntry.description)) : /*#__PURE__*/React.createElement("div", {
          className: "lsj-def lsj-def--loading"
        }, "Not found in BDB."));
      case "lsj":
        return /*#__PURE__*/React.createElement("section", {
          key: "lsj",
          className: "sec"
        }, /*#__PURE__*/React.createElement("div", {
          className: "lsj-head"
        }, /*#__PURE__*/React.createElement("h4", {
          className: "sec-head"
        }, /*#__PURE__*/React.createElement("span", {
          className: "sec-t"
        }, lsjEntry && lsjEntry.source === "abp_ext" ? /*#__PURE__*/React.createElement(React.Fragment, null, "ABP Extended", /*#__PURE__*/React.createElement("span", {
          className: "abp-badge"
        }, "ABP EXT")) : /*#__PURE__*/React.createElement(React.Fragment, null, "Liddell-Scott-Jones", /*#__PURE__*/React.createElement("span", {
          className: "lsj-badge"
        }, "LSJ")))), lsjEntry && /*#__PURE__*/React.createElement("div", {
          className: "lsj-tabs"
        }, /*#__PURE__*/React.createElement("button", {
          className: "lsj-tab " + (lsjTab === "def" ? "on" : ""),
          onClick: () => setLsjTab("def")
        }, "Definition"), /*#__PURE__*/React.createElement("button", {
          className: "lsj-tab " + (lsjTab === "full" ? "on" : ""),
          onClick: () => setLsjTab("full")
        }, lsjEntry.source === "abp_ext" ? "Full ABP" : "Full LSJ"))), lsjLoading ? /*#__PURE__*/React.createElement("div", {
          className: "lsj-def lsj-def--loading"
        }, "Loading\u2026") : lsjEntry ? lsjTab === "def" ? lsjEntry.source === "strongs" ? /*#__PURE__*/React.createElement("div", {
          className: "lsj-def",
          dangerouslySetInnerHTML: {
            __html: lsjEntry.def_html
          }
        }) : /*#__PURE__*/React.createElement(LsjSummary, {
          data: lsjSummary,
          loading: lsjSummaryLoading
        }) : /*#__PURE__*/React.createElement("div", {
          className: "lsj-def",
          dangerouslySetInnerHTML: {
            __html: lsjEntry.def_html
          }
        }) : /*#__PURE__*/React.createElement("div", {
          className: "lsj-def lsj-def--loading"
        }, "Not found."));
      case "abpOcc":
        return /*#__PURE__*/React.createElement("section", {
          key: "abpOcc",
          className: "sec"
        }, /*#__PURE__*/React.createElement("h4", {
          className: "sec-head"
        }, /*#__PURE__*/React.createElement("span", {
          className: "sec-t"
        }, entry.isExtra ? "Occurrences in Scripture" : "ABP Occurrences")), /*#__PURE__*/React.createElement("button", {
          className: "occ-link",
          onClick: () => onNavigateToLexicon && onNavigateToLexicon(entry.strongs_raw, "abp")
        }, /*#__PURE__*/React.createElement("b", null, abpCount), "\xD7 in LXX ", /*#__PURE__*/React.createElement(Icon.ArrowRight, null)));
      case "extraOcc":
        return /*#__PURE__*/React.createElement("section", {
          key: "extraOcc",
          className: "sec"
        }, /*#__PURE__*/React.createElement("h4", {
          className: "sec-head"
        }, /*#__PURE__*/React.createElement("span", {
          className: "sec-t"
        }, "In the ", entry.extraBookName || "text")), /*#__PURE__*/React.createElement("div", {
          className: "occ-link occ-link--static"
        }, /*#__PURE__*/React.createElement("b", null, extraCount), "\xD7 in ", entry.extraBookName || "this text"));
      case "kjvOcc":
        return /*#__PURE__*/React.createElement("section", {
          key: "kjvOcc",
          className: "sec"
        }, /*#__PURE__*/React.createElement("h4", {
          className: "sec-head"
        }, /*#__PURE__*/React.createElement("span", {
          className: "sec-t"
        }, "KJV Occurrences")), /*#__PURE__*/React.createElement("button", {
          className: "occ-link",
          onClick: () => onNavigateToLexicon && onNavigateToLexicon(entry.strongs, "kjv")
        }, /*#__PURE__*/React.createElement("b", null, kjvCount), "\xD7 in KJV ", /*#__PURE__*/React.createElement(Icon.ArrowRight, null)));
      case "pnOcc":
        return /*#__PURE__*/React.createElement("section", {
          key: "pnOcc",
          className: "sec"
        }, /*#__PURE__*/React.createElement("h4", {
          className: "sec-head"
        }, /*#__PURE__*/React.createElement("span", {
          className: "sec-t"
        }, "ABP Occurrences")), /*#__PURE__*/React.createElement("button", {
          className: "occ-link",
          onClick: () => onNameSearch(extractProperName(entry.gloss))
        }, /*#__PURE__*/React.createElement("b", null, pnCount), "\xD7 in LXX ", /*#__PURE__*/React.createElement(Icon.ArrowRight, null)));
      case "hebrewKjvOcc":
        return /*#__PURE__*/React.createElement("section", {
          key: "hebrewKjvOcc",
          className: "sec"
        }, /*#__PURE__*/React.createElement("h4", {
          className: "sec-head"
        }, /*#__PURE__*/React.createElement("span", {
          className: "sec-t"
        }, "KJV Occurrences")), /*#__PURE__*/React.createElement("button", {
          className: "occ-link",
          onClick: () => onNavigateToLexicon && onNavigateToLexicon(entry.strongs, "kjv")
        }, /*#__PURE__*/React.createElement("b", null, kjvCount), "\xD7 in KJV ", /*#__PURE__*/React.createElement(Icon.ArrowRight, null)));
      case "derivation":
        return /*#__PURE__*/React.createElement("section", {
          key: "derivation",
          className: "sec"
        }, /*#__PURE__*/React.createElement("h4", {
          className: "sec-head"
        }, /*#__PURE__*/React.createElement("span", {
          className: "sec-t"
        }, "Derivation")), /*#__PURE__*/React.createElement("p", {
          className: "detail-p"
        }, entry.derivation.split(/\b(G\d[\d.]*)/i).map((part, i) => /^G\d[\d.]*/i.test(part) ? /*#__PURE__*/React.createElement("button", {
          key: i,
          className: "link-btn link-btn--strong",
          onClick: () => onNavigateToLexicon?.(part)
        }, part) : part)));
      case "verse":
        return /*#__PURE__*/React.createElement("section", {
          key: "verse",
          className: "sec"
        }, /*#__PURE__*/React.createElement("h4", {
          className: "sec-head"
        }, /*#__PURE__*/React.createElement("span", {
          className: "sec-t"
        }, "Verse \u2014 ", entry.ref), /*#__PURE__*/React.createElement("span", {
          className: "sec-meta"
        }, useKjvText ? "KJV" : "LXX (ABP English)")), /*#__PURE__*/React.createElement("blockquote", {
          className: "dverse"
        }, /*#__PURE__*/React.createElement("span", {
          className: "dverse-n"
        }, entry.verse), useKjvText ? kjvVerseText || "—" : verseLoading ? "Loading…" : verseText || "—"), showInterlinear && /*#__PURE__*/React.createElement("div", {
          className: "interlinear"
        }, !interlinearWords ? /*#__PURE__*/React.createElement("span", {
          style: {
            color: "var(--ink-4)",
            fontSize: "13px"
          }
        }, "Loading\u2026") : interlinearWords.map((w, i) => /*#__PURE__*/React.createElement("div", {
          key: i,
          className: "iword"
        }, /*#__PURE__*/React.createElement("span", {
          className: "iw-greek"
        }, w.lemma || "—"), /*#__PURE__*/React.createElement("span", {
          className: "iw-translit"
        }, w.translit || ""), /*#__PURE__*/React.createElement("span", {
          className: "iw-english"
        }, w.english || "—"), (w.strongs || w.strongs_base) && w.strongs_base !== "*" && /*#__PURE__*/React.createElement("span", {
          className: "iw-strongs"
        }, strongsTag(w.strongs && w.strongs !== '*' ? w.strongs : w.strongs_base))))), /*#__PURE__*/React.createElement("div", {
          className: "dverse-tools"
        }, /*#__PURE__*/React.createElement("button", {
          className: "link-btn",
          onClick: () => onReadInContext && onReadInContext(entry.book, entry.chapter, entry.verse)
        }, "Read in context ", /*#__PURE__*/React.createElement(Icon.ArrowRight, null)), /*#__PURE__*/React.createElement("span", {
          className: "dot"
        }, "\xB7"), /*#__PURE__*/React.createElement("button", {
          className: "link-btn" + (showInterlinear ? " link-btn-on" : ""),
          onClick: () => setShowInterlinear(v => !v)
        }, "Interlinear")));
      case "frequency":
        return /*#__PURE__*/React.createElement("section", {
          key: "frequency",
          className: "sec"
        }, /*#__PURE__*/React.createElement("h4", {
          className: "sec-head"
        }, /*#__PURE__*/React.createElement("span", {
          className: "sec-t"
        }, "Frequency")), /*#__PURE__*/React.createElement("div", {
          className: "freq"
        }, /*#__PURE__*/React.createElement("div", {
          className: "freq-bar"
        }, /*#__PURE__*/React.createElement("div", {
          className: "freq-fill",
          style: {
            width: barWidth + "%"
          }
        })), /*#__PURE__*/React.createElement("div", {
          className: "freq-meta"
        }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, occurrences), "\xD7 in current results"))));
      default:
        return null;
    }
  };
  return /*#__PURE__*/React.createElement("aside", {
    ref: isMobile ? sheetRef : null,
    className: "detail " + (isMobile ? "detail-sheet" : "detail-side"),
    role: "dialog",
    "aria-label": "Lexicon detail"
  }, isMobile && /*#__PURE__*/React.createElement("div", {
    className: "sheet-drag-zone",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sheet-handle"
  })), /*#__PURE__*/React.createElement("div", {
    className: "detail-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "detail-head-l"
  }, /*#__PURE__*/React.createElement("span", {
    className: "card-badge solid"
  }, entry.strongs), /*#__PURE__*/React.createElement("span", {
    className: "detail-pos"
  }, BOOK_LABELS[entry.book] || entry.book)), overviewBack && !isMobile ? /*#__PURE__*/React.createElement("button", {
    className: "detail-back",
    onClick: onClose,
    "aria-label": "Back to overview"
  }, "\u2039 Overview") : /*#__PURE__*/React.createElement("button", {
    className: "detail-close",
    onClick: onClose,
    "aria-label": "Close"
  }, /*#__PURE__*/React.createElement(Icon.Close, null))), /*#__PURE__*/React.createElement("div", {
    className: "detail-body",
    ref: isMobile ? scrollRef : null
  }, /*#__PURE__*/React.createElement("div", {
    className: "detail-hero" + (hero.noGloss ? " no-gloss" : "")
  }, /*#__PURE__*/React.createElement("div", {
    className: "detail-greek" + (hero.he ? " detail-greek--he" : ""),
    dir: hero.he ? "rtl" : undefined
  }, hero.script), /*#__PURE__*/React.createElement("div", {
    className: "detail-translit-row" + (hero.he ? " detail-translit-row-he" : "")
  }, /*#__PURE__*/React.createElement("span", {
    className: "detail-translit"
  }, hero.translit), heroHasHeGloss && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "detail-sep"
  }, "\xB7"), /*#__PURE__*/React.createElement("span", {
    className: "detail-gloss"
  }, hero.inlineGloss))), !hero.noGloss && !heroHasHeGloss && /*#__PURE__*/React.createElement("div", {
    className: "detail-gloss"
  }, hero.standaloneGloss), hero.morph && /*#__PURE__*/React.createElement("div", {
    className: "detail-morph"
  }, hero.morph)), sections.map(renderSection)));
}

// ============================================================
// NOTES UI — add popover, editor panel, browse view
// ------------------------------------------------------------
// Drag-select text in the Library reader → a small "Add note" bar pops by the
// selection → opens the editor panel (same right-sidebar / bottom-sheet slot
// the word-study and cross-ref panels use). The Notes tab lists & searches
// every saved note and jumps back to its verse.
// ============================================================

// "Add note" affordance for a text selection. On DESKTOP it floats just above
// the selection. On MOBILE the OS floats its own copy/share toolbar right there,
// so ours is pinned to the bottom of the screen (above the tab bar) to avoid the
// collision.
function NoteAddPopover({
  rect,
  isMobile,
  onAdd,
  onColor,
  onCopy,
  onJournal
}) {
  if (!rect) return null;
  let style;
  if (isMobile) {
    style = {
      position: "fixed",
      left: "50%",
      transform: "translateX(-50%)",
      bottom: 72,
      zIndex: 1000
    };
  } else {
    const W = 360;
    style = {
      position: "fixed",
      top: Math.max(8, rect.top - 48),
      left: Math.min(window.innerWidth - W - 8, Math.max(8, rect.left + rect.width / 2 - W / 2)),
      zIndex: 1000
    };
  }
  // preventDefault on mousedown so pressing a button doesn't clear the selection
  return /*#__PURE__*/React.createElement("div", {
    className: "note-popover" + (isMobile ? " note-popover-mobile" : ""),
    style: style,
    onMouseDown: e => e.preventDefault()
  }, /*#__PURE__*/React.createElement("div", {
    className: "note-swatches"
  }, NOTE_COLORS.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    className: "note-swatch",
    style: {
      background: NOTE_COLOR_CSS[c]
    },
    title: "Highlight " + c,
    "aria-label": "Highlight " + c,
    onClick: () => onColor(c)
  }))), /*#__PURE__*/React.createElement("button", {
    className: "note-popover-btn",
    onClick: onAdd
  }, /*#__PURE__*/React.createElement(Icon.Note, null), /*#__PURE__*/React.createElement("span", {
    className: "note-btn-lbl"
  }, "Note")), onJournal && /*#__PURE__*/React.createElement("button", {
    className: "note-popover-btn",
    onClick: onJournal
  }, /*#__PURE__*/React.createElement(Icon.Book, null), /*#__PURE__*/React.createElement("span", {
    className: "note-btn-lbl"
  }, "Journal")), onCopy && /*#__PURE__*/React.createElement("button", {
    className: "note-popover-btn",
    onClick: onCopy
  }, /*#__PURE__*/React.createElement(Icon.Copy, null), /*#__PURE__*/React.createElement("span", {
    className: "note-btn-lbl"
  }, "Copy")));
}

// Menu shown when you right-click / long-press a verse number: Bookmark · Note · colors.
function VerseNoteMenu({
  rect,
  isMobile,
  onBookmark,
  onNote,
  onColor,
  onCopy,
  onJournal,
  onClose
}) {
  if (!rect) return null;
  let style;
  if (isMobile) {
    style = {
      position: "fixed",
      left: "50%",
      transform: "translateX(-50%)",
      bottom: 72,
      zIndex: 1000
    };
  } else {
    const W = 270;
    style = {
      position: "fixed",
      top: Math.min(window.innerHeight - 56, rect.top + rect.height + 6),
      left: Math.min(window.innerWidth - W - 8, Math.max(8, rect.left)),
      zIndex: 1000
    };
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "note-menu-scrim",
    onClick: onClose
  }), /*#__PURE__*/React.createElement("div", {
    className: "note-popover" + (isMobile ? " note-popover-mobile" : ""),
    style: style,
    onMouseDown: e => e.preventDefault()
  }, /*#__PURE__*/React.createElement("div", {
    className: "note-swatches"
  }, NOTE_COLORS.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    className: "note-swatch",
    style: {
      background: NOTE_COLOR_CSS[c]
    },
    title: "Highlight " + c,
    "aria-label": "Highlight " + c,
    onClick: () => onColor(c)
  }))), /*#__PURE__*/React.createElement("button", {
    className: "note-popover-btn",
    onClick: onNote
  }, /*#__PURE__*/React.createElement(Icon.Note, null), /*#__PURE__*/React.createElement("span", {
    className: "note-btn-lbl"
  }, "Note")), onJournal && /*#__PURE__*/React.createElement("button", {
    className: "note-popover-btn",
    onClick: onJournal
  }, /*#__PURE__*/React.createElement(Icon.Book, null), /*#__PURE__*/React.createElement("span", {
    className: "note-btn-lbl"
  }, "Journal")), onCopy && /*#__PURE__*/React.createElement("button", {
    className: "note-popover-btn",
    onClick: onCopy
  }, /*#__PURE__*/React.createElement(Icon.Copy, null), /*#__PURE__*/React.createElement("span", {
    className: "note-btn-lbl"
  }, "Copy")), /*#__PURE__*/React.createElement("button", {
    className: "note-popover-btn",
    onClick: onBookmark
  }, /*#__PURE__*/React.createElement(Icon.Bookmark, null), /*#__PURE__*/React.createElement("span", {
    className: "note-btn-lbl"
  }, "Bookmark"))));
}

// A row of color swatches + a clear button, for the editor.
function NoteColorRow({
  value,
  onPick
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "note-color-row"
  }, NOTE_COLORS.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    className: "note-swatch" + (value === c ? " on" : ""),
    style: {
      background: NOTE_COLOR_CSS[c]
    },
    title: "Highlight " + c,
    "aria-label": "Highlight " + c,
    onClick: () => onPick(value === c ? null : c)
  })), /*#__PURE__*/React.createElement("button", {
    className: "note-swatch note-swatch-none" + (!value ? " on" : ""),
    title: "No highlight",
    "aria-label": "No highlight",
    onClick: () => onPick(null)
  }, "\u2715"));
}

// Write / edit / delete a single note. Reuses the .detail shell.
function NotesPanel({
  noteId,
  isMobile,
  onClose
}) {
  const note = NotesStore.get(noteId);
  const [body, setBody] = useState(note ? note.body || "" : "");
  const [color, setColor] = useState(note ? note.color || null : null);
  const [bookmark, setBookmark] = useState(note ? !!note.bookmark : false);
  const taRef = useRef(null);
  useEffect(() => {
    setBody(note ? note.body || "" : "");
    setColor(note ? note.color || null : null);
    setBookmark(note ? !!note.bookmark : false);
    // Desktop: focus the box right away. Mobile: DON'T — auto-popping the
    // on-screen keyboard covers a freshly opened sheet. The user taps to type.
    if (!isMobile) requestAnimationFrame(() => taRef.current && taRef.current.focus());
  }, [noteId]);
  const save = () => {
    NotesStore.update(noteId, {
      body,
      color,
      bookmark
    });
    onClose();
  };
  const del = () => {
    NotesStore.remove(noteId);
    onClose();
  };
  // Closing a record that's blank AND uncolored AND not bookmarked discards it
  // (id minted on create, so a thrown-away draft shouldn't linger).
  const close = () => {
    if (!body.trim() && !color && !bookmark) NotesStore.remove(noteId);else NotesStore.update(noteId, {
      body,
      color,
      bookmark
    });
    onClose();
  };
  // Swipe-down-to-close on mobile (same hook the word / xref / summary sheets use).
  const {
    sheetRef,
    scrollRef
  } = useSwipeToDismiss(close);
  if (!note) return null;
  const head = /*#__PURE__*/React.createElement("div", {
    className: "detail-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "detail-head-l"
  }, /*#__PURE__*/React.createElement("span", {
    className: "detail-pos"
  }, note.refLabel || note.book + " " + note.chapter)), /*#__PURE__*/React.createElement("button", {
    className: "note-bm-toggle" + (bookmark ? " on" : ""),
    onClick: () => setBookmark(b => !b),
    title: bookmark ? "Bookmarked" : "Bookmark this",
    "aria-label": "Toggle bookmark",
    "aria-pressed": bookmark
  }, /*#__PURE__*/React.createElement(Icon.Bookmark, null)), /*#__PURE__*/React.createElement("button", {
    className: "detail-close",
    onClick: close,
    "aria-label": "Close"
  }, /*#__PURE__*/React.createElement(Icon.Close, null)));
  const content = /*#__PURE__*/React.createElement("div", {
    className: "detail-body note-edit-body",
    ref: isMobile ? scrollRef : undefined
  }, note.snippet && /*#__PURE__*/React.createElement("blockquote", {
    className: "note-snippet"
  }, "\u201C", note.snippet, "\u201D"), /*#__PURE__*/React.createElement(NoteColorRow, {
    value: color,
    onPick: setColor
  }), /*#__PURE__*/React.createElement("textarea", {
    ref: taRef,
    className: "note-textarea",
    value: body,
    onChange: e => setBody(e.target.value),
    placeholder: "Write your note\u2026"
  }), /*#__PURE__*/React.createElement("div", {
    className: "note-actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "note-save",
    onClick: save
  }, "Save"), /*#__PURE__*/React.createElement("button", {
    className: "note-del",
    onClick: del
  }, "Delete")));
  if (isMobile) {
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "sheet-scrim",
      onClick: close
    }), /*#__PURE__*/React.createElement("aside", {
      ref: sheetRef,
      className: "detail detail-sheet note-sheet",
      role: "dialog",
      "aria-label": "Note"
    }, /*#__PURE__*/React.createElement("div", {
      className: "sheet-drag-zone",
      "aria-hidden": "true"
    }, /*#__PURE__*/React.createElement("div", {
      className: "sheet-handle"
    })), head, content));
  }
  return /*#__PURE__*/React.createElement("aside", {
    className: "detail detail-side note-side",
    role: "complementary",
    "aria-label": "Note"
  }, head, content);
}

// One free-form journal page (plain text). No verse anchor — a title + a big
// box you type into. Autosaves as you write; rides the same store/sync as notes.
const JOURNAL_MAX = 60000; // chars; stays safely under the server's 64KB page cap
function JournalEditor({
  pageId,
  onBack
}) {
  const page = NotesStore.get(pageId);
  const [title, setTitle] = useState(page ? page.title || "" : "");
  const [body, setBody] = useState(page ? page.body || "" : "");
  const saveTimer = useRef(null);
  const first = useRef(true);

  // This is now the page that "send verse to journal" (in the reader) targets.
  useEffect(() => {
    NotesStore.setActiveJournal(pageId);
  }, [pageId]);

  // Autosave ~0.8s after you stop typing. Skip the very first run so just
  // opening a page doesn't re-stamp it as edited.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      NotesStore.update(pageId, {
        title,
        body
      });
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [title, body]);
  const back = () => {
    clearTimeout(saveTimer.current);
    // A page never given a title or any text is a thrown-away draft — discard it.
    if (!title.trim() && !body.trim()) NotesStore.remove(pageId);else NotesStore.update(pageId, {
      title,
      body
    });
    onBack();
  };
  const del = () => {
    clearTimeout(saveTimer.current);
    NotesStore.remove(pageId);
    onBack();
  };
  if (!page) {
    onBack();
    return null;
  }
  const near = body.length > JOURNAL_MAX - 2000;
  return /*#__PURE__*/React.createElement("div", {
    className: "journal-editor"
  }, /*#__PURE__*/React.createElement("div", {
    className: "journal-editor-bar"
  }, /*#__PURE__*/React.createElement("button", {
    className: "notes-tool-btn",
    onClick: back
  }, "\u2039 Back"), /*#__PURE__*/React.createElement("button", {
    className: "note-del",
    onClick: del
  }, "Delete")), /*#__PURE__*/React.createElement("input", {
    className: "journal-title-input",
    type: "text",
    value: title,
    maxLength: 200,
    onChange: e => setTitle(e.target.value),
    placeholder: "Page title"
  }), /*#__PURE__*/React.createElement("textarea", {
    className: "journal-textarea",
    value: body,
    maxLength: JOURNAL_MAX,
    onChange: e => setBody(e.target.value),
    placeholder: "Write freely \u2014 thoughts, questions, an outline, a study\u2026"
  }), /*#__PURE__*/React.createElement("div", {
    className: "journal-count" + (near ? " warn" : "")
  }, body.length.toLocaleString(), " characters", near ? " — near the page limit; start a new page for more" : ""));
}

// The Journal side of the Notes tab — a list of free-form pages + an editor.
function JournalView() {
  useNotesVersion();
  const [editing, setEditing] = useState(null);
  const pages = NotesStore.journals();
  if (editing) return /*#__PURE__*/React.createElement(JournalEditor, {
    pageId: editing,
    onBack: () => setEditing(null)
  });
  const fmtDate = iso => {
    try {
      return new Date(iso).toLocaleDateString();
    } catch (e) {
      return "";
    }
  };
  const newPage = () => {
    const p = NotesStore.createJournal();
    setEditing(p.id);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "journal-view"
  }, /*#__PURE__*/React.createElement("div", {
    className: "journal-toolbar"
  }, /*#__PURE__*/React.createElement("button", {
    className: "notes-tool-btn on",
    onClick: newPage
  }, "+ New page")), pages.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "notes-empty"
  }, "No journal pages yet. Tap \u201CNew page\u201D to start writing \u2014 free-form, not tied to any verse.") : /*#__PURE__*/React.createElement("ul", {
    className: "journal-list"
  }, pages.map(p => /*#__PURE__*/React.createElement("li", {
    key: p.id,
    className: "journal-item",
    onClick: () => setEditing(p.id)
  }, /*#__PURE__*/React.createElement("div", {
    className: "journal-item-title"
  }, (p.title || "").trim() || "Untitled page"), (p.body || "").trim() && /*#__PURE__*/React.createElement("div", {
    className: "journal-item-preview"
  }, p.body.trim().slice(0, 160)), /*#__PURE__*/React.createElement("div", {
    className: "journal-item-date"
  }, fmtDate(p.updated))))));
}

// The Notes tab — list + search of every saved note.
function NotesView({
  onOpen
}) {
  useNotesVersion();
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("all"); // all | bookmark | highlight | note
  const [sort, setSort] = useState("recent"); // recent | ref
  const [group, setGroup] = useState(false); // group by book
  const [collapsed, setCollapsed] = useState(() => new Set()); // collapsed book keys
  const toggleSection = key => setCollapsed(s => {
    const n = new Set(s);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });
  const [authOpen, setAuthOpen] = useState(null); // null | "login" | "signup"
  const [mode, setMode] = useState("notes"); // notes | journal
  const acct = NotesStore.authInfo();
  const fileRef = useRef(null);
  let notes = NotesStore.search(q); // already newest-first
  if (filter === "bookmark") notes = notes.filter(n => n.bookmark);else if (filter === "highlight") notes = notes.filter(n => n.color);else if (filter === "note") notes = notes.filter(n => n.body && n.body.trim());

  // Canonical order: Bible books by BOOK_ORDER, non-canon after, by name.
  const bookRank = n => BOOK_ORDER[n.book] != null ? BOOK_ORDER[n.book] : 1000;
  const byRef = (a, b) => {
    const ra = bookRank(a),
      rb = bookRank(b);
    if (ra !== rb) return ra - rb;
    const na = a.bookName || a.book,
      nb = b.bookName || b.book;
    if (ra === 1000 && na !== nb) return na.localeCompare(nb);
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    return a.start.verse - b.start.verse;
  };
  if (sort === "ref") notes = [...notes].sort(byRef);

  // Optional grouping by book (sections in canonical order, items by reference).
  let sections = null;
  if (group) {
    const map = new Map();
    for (const n of notes) {
      if (!map.has(n.book)) map.set(n.book, {
        key: n.book,
        label: BOOK_LABELS[n.book] || n.bookName || n.book,
        rank: bookRank(n),
        items: []
      });
      map.get(n.book).items.push(n);
    }
    sections = [...map.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
    sections.forEach(s => s.items.sort(byRef));
  }
  const renderItem = n => /*#__PURE__*/React.createElement("li", {
    key: n.id,
    className: "notes-item",
    onClick: () => onOpen(n)
  }, /*#__PURE__*/React.createElement("div", {
    className: "notes-item-ref"
  }, (n.body || n.bookmark) && /*#__PURE__*/React.createElement("span", {
    className: "notes-item-type",
    "aria-hidden": "true"
  }, n.body ? /*#__PURE__*/React.createElement(Icon.Note, null) : /*#__PURE__*/React.createElement(Icon.Bookmark, null)), n.color && /*#__PURE__*/React.createElement("span", {
    className: "notes-item-dot",
    style: {
      background: NOTE_COLOR_CSS[n.color]
    }
  }), n.refLabel || n.book + " " + n.chapter), n.snippet && /*#__PURE__*/React.createElement("div", {
    className: "notes-item-snippet"
  }, "\u201C", n.snippet, "\u201D"), n.body && /*#__PURE__*/React.createElement("div", {
    className: "notes-item-body"
  }, n.body));
  const doExport = () => {
    const data = JSON.stringify(NotesStore.exportData(), null, 2);
    const url = URL.createObjectURL(new Blob([data], {
      type: "application/json"
    }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "lexica-notes-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const doImport = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const list = Array.isArray(parsed) ? parsed : parsed.notes || [];
        const r = NotesStore.importMerge(list);
        setMsg(`Imported ${r.added} new, ${r.updated} updated${r.skipped ? ", " + r.skipped + " skipped" : ""}.`);
      } catch (err) {
        setMsg("Couldn't read that file.");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // let the same file be re-picked
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "notes-view"
  }, /*#__PURE__*/React.createElement("div", {
    className: "notes-view-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "notes-view-titlerow"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "notes-view-title"
  }, "My Notes"), /*#__PURE__*/React.createElement("div", {
    className: "notes-tools"
  }, /*#__PURE__*/React.createElement("button", {
    className: "notes-tool-btn",
    onClick: doExport,
    disabled: NotesStore.all().length === 0 && NotesStore.journals().length === 0
  }, "Export"), /*#__PURE__*/React.createElement("button", {
    className: "notes-tool-btn",
    onClick: () => fileRef.current && fileRef.current.click()
  }, "Import"), /*#__PURE__*/React.createElement("input", {
    ref: fileRef,
    type: "file",
    accept: "application/json,.json",
    style: {
      display: "none"
    },
    onChange: doImport
  }))), msg && /*#__PURE__*/React.createElement("div", {
    className: "notes-msg"
  }, msg), /*#__PURE__*/React.createElement("div", {
    className: "notes-sync"
  }, acct.email ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "notes-sync-label"
  }, "Signed in:"), /*#__PURE__*/React.createElement("span", {
    className: "notes-acct-email"
  }, acct.email), /*#__PURE__*/React.createElement("button", {
    className: "notes-tool-btn",
    onClick: () => NotesStore.syncNow(),
    disabled: acct.syncing
  }, acct.syncing ? "Syncing…" : "Sync now"), /*#__PURE__*/React.createElement("button", {
    className: "notes-tool-btn",
    onClick: () => NotesStore.logout()
  }, "Log out")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "notes-sync-label"
  }, "Sync across devices:"), /*#__PURE__*/React.createElement("button", {
    className: "notes-tool-btn",
    onClick: () => setAuthOpen("login")
  }, "Log in"), /*#__PURE__*/React.createElement("button", {
    className: "notes-tool-btn",
    onClick: () => setAuthOpen("signup")
  }, "Sign up"))), acct.email ? /*#__PURE__*/React.createElement("div", {
    className: "notes-sync-hint"
  }, "Your notes sync to this account on every device you log into.") : /*#__PURE__*/React.createElement("div", {
    className: "notes-sync-hint"
  }, "Optional \u2014 sign in to sync your notes across devices. Notes work fine without an account."), /*#__PURE__*/React.createElement("div", {
    className: "notes-mode seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (mode === "notes" ? " on" : ""),
    onClick: () => setMode("notes")
  }, "Verse notes"), /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (mode === "journal" ? " on" : ""),
    onClick: () => setMode("journal")
  }, "Journal")), mode === "notes" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("input", {
    className: "notes-search",
    type: "text",
    placeholder: "Search your notes\u2026",
    value: q,
    onChange: e => setQ(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    className: "notes-controls"
  }, /*#__PURE__*/React.createElement("div", {
    className: "notes-filter seg"
  }, [["all", "All"], ["bookmark", "★ Bookmarks"], ["highlight", "🎨 Highlights"], ["note", "✎ Notes"]].map(([k, lbl]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: "seg-b" + (filter === k ? " on" : ""),
    onClick: () => setFilter(k)
  }, lbl))), /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (sort === "recent" ? " on" : ""),
    onClick: () => setSort("recent")
  }, "Recent"), /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (sort === "ref" ? " on" : ""),
    onClick: () => setSort("ref")
  }, "Reference")), /*#__PURE__*/React.createElement("button", {
    className: "notes-tool-btn" + (group ? " on" : ""),
    onClick: () => setGroup(g => !g)
  }, "Group by book")))), mode === "journal" ? /*#__PURE__*/React.createElement(JournalView, null) : notes.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "notes-empty"
  }, q || filter !== "all" ? "Nothing matches that." : "No notes yet. In the Library, select some text in a verse and choose “Add note.”") : group ? sections.map(s => {
    const open = !collapsed.has(s.key);
    return /*#__PURE__*/React.createElement("div", {
      key: s.key,
      className: "notes-group"
    }, /*#__PURE__*/React.createElement("button", {
      className: "notes-group-head" + (open ? " open" : ""),
      onClick: () => toggleSection(s.key),
      "aria-expanded": open
    }, /*#__PURE__*/React.createElement("span", {
      className: "notes-group-caret"
    }, "\u25B8"), /*#__PURE__*/React.createElement("span", {
      className: "notes-group-label"
    }, s.label), /*#__PURE__*/React.createElement("span", {
      className: "notes-group-count"
    }, s.items.length)), open && /*#__PURE__*/React.createElement("ul", {
      className: "notes-list"
    }, s.items.map(renderItem)));
  }) : /*#__PURE__*/React.createElement("ul", {
    className: "notes-list"
  }, notes.map(renderItem)), authOpen && /*#__PURE__*/React.createElement(AuthModal, {
    mode: authOpen,
    onClose: () => setAuthOpen(null)
  }));
}

// Centered login / sign-up dialog.
function AuthModal({
  mode,
  onClose
}) {
  const [m, setM] = useState(mode);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [gid, setGid] = useState(null); // Google Client ID, if configured
  const emailRef = useRef(null);
  const gbtnRef = useRef(null);
  useEffect(() => {
    requestAnimationFrame(() => emailRef.current && emailRef.current.focus());
  }, []);

  // Is "Sign in with Google" turned on for this site?
  useEffect(() => {
    fetch("/api/auth/config").then(r => r.json()).then(d => setGid(d.google_client_id || null)).catch(() => {});
  }, []);

  // Load Google's button + wire the callback (only when configured).
  useEffect(() => {
    if (!gid) return;
    let cancelled = false;
    const init = () => {
      if (cancelled || !window.google || !window.google.accounts || !gbtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: gid,
        callback: resp => {
          NotesStore.googleLogin(resp.credential).then(r => {
            if (r.ok) onClose();else setErr(r.error);
          });
        }
      });
      gbtnRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(gbtnRef.current, {
        theme: "outline",
        size: "large",
        width: 300,
        text: m === "signup" ? "signup_with" : "signin_with"
      });
    };
    if (window.google && window.google.accounts) {
      init();
      return () => {
        cancelled = true;
      };
    }
    let s = document.getElementById("gsi-script");
    if (!s) {
      s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.id = "gsi-script";
      document.head.appendChild(s);
    }
    s.addEventListener("load", init);
    return () => {
      cancelled = true;
      s && s.removeEventListener("load", init);
    };
  }, [gid, m]);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    const r = m === "signup" ? await NotesStore.signup(email, pass) : await NotesStore.login(email, pass);
    setBusy(false);
    if (r.ok) onClose();else setErr(r.error || "Something went wrong.");
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "auth-scrim",
    onClick: onClose
  }), /*#__PURE__*/React.createElement("div", {
    className: "auth-modal",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": m === "signup" ? "Sign up" : "Log in"
  }, /*#__PURE__*/React.createElement("div", {
    className: "auth-modal-head"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "auth-modal-title"
  }, m === "signup" ? "Create account" : "Log in"), /*#__PURE__*/React.createElement("button", {
    className: "detail-close",
    onClick: onClose,
    "aria-label": "Close"
  }, /*#__PURE__*/React.createElement(Icon.Close, null))), /*#__PURE__*/React.createElement("p", {
    className: "auth-modal-sub"
  }, "Sync your notes across devices."), gid && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "auth-google",
    ref: gbtnRef
  }), /*#__PURE__*/React.createElement("div", {
    className: "auth-or"
  }, /*#__PURE__*/React.createElement("span", null, "or"))), /*#__PURE__*/React.createElement("input", {
    ref: emailRef,
    className: "auth-input",
    type: "email",
    placeholder: "Email",
    autoComplete: "username",
    value: email,
    onChange: e => setEmail(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") submit();
    }
  }), /*#__PURE__*/React.createElement("input", {
    className: "auth-input",
    type: "password",
    placeholder: "Password",
    autoComplete: m === "signup" ? "new-password" : "current-password",
    value: pass,
    onChange: e => setPass(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") submit();
    }
  }), m === "signup" && /*#__PURE__*/React.createElement("div", {
    className: "auth-fine"
  }, "At least 8 characters."), err && /*#__PURE__*/React.createElement("div", {
    className: "auth-err"
  }, err), /*#__PURE__*/React.createElement("button", {
    className: "auth-submit",
    onClick: submit,
    disabled: busy
  }, busy ? "…" : m === "signup" ? "Create account" : "Log in"), /*#__PURE__*/React.createElement("div", {
    className: "auth-switch"
  }, m === "signup" ? /*#__PURE__*/React.createElement(React.Fragment, null, "Already have an account? ", /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setM("login");
      setErr("");
    }
  }, "Log in")) : /*#__PURE__*/React.createElement(React.Fragment, null, "New here? ", /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setM("signup");
      setErr("");
    }
  }, "Sign up")))));
}

// ============================================================
// CROSS-REFERENCE PANEL
// ============================================================
function CrossRefPanel({
  source,
  onClose,
  onNavigate,
  isMobile,
  translation,
  onAiSearch,
  overviewBack
}) {
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
    api.crossRefsCurated(source.book, source.chapter, source.verse).then(d => {
      if (cancelled) return;
      setRefs(d.refs || []);
      setSynthesis(d.synthesis || null);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [source && source.book, source && source.chapter, source && source.verse]);
  useEffect(() => {
    if (!showAbp || !refs.length) {
      setAbpTexts({});
      return;
    }
    let cancelled = false;
    Promise.all(refs.map(ref => api.verse(ref.book, ref.chapter, ref.verse).then(d => [ref.ref, d.text || ""]).catch(() => [ref.ref, ""]))).then(pairs => {
      if (!cancelled) setAbpTexts(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [refs, showAbp]);
  const verseText = ref => showAbp ? abpTexts[ref.ref] || ref.kjv_text : ref.kjv_text;
  const sourceRef = `${source.book} ${source.chapter}:${source.verse}`;
  const {
    sheetRef,
    scrollRef
  } = useSwipeToDismiss(onClose);
  return /*#__PURE__*/React.createElement("aside", {
    ref: isMobile ? sheetRef : null,
    className: "xref-panel " + (isMobile ? "detail-sheet" : "detail-side"),
    role: "dialog",
    "aria-label": "Related Passages"
  }, isMobile && /*#__PURE__*/React.createElement("div", {
    className: "sheet-drag-zone",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sheet-handle"
  })), /*#__PURE__*/React.createElement("div", {
    className: "detail-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "detail-head-l"
  }, /*#__PURE__*/React.createElement("span", {
    className: "detail-pos"
  }, sourceRef), /*#__PURE__*/React.createElement("span", {
    className: "xref-badge"
  }, "TSK")), overviewBack && !isMobile ? /*#__PURE__*/React.createElement("button", {
    className: "detail-back",
    onClick: onClose,
    "aria-label": "Back to overview"
  }, "\u2039 Overview") : /*#__PURE__*/React.createElement("button", {
    className: "detail-close",
    onClick: onClose,
    "aria-label": "Close"
  }, /*#__PURE__*/React.createElement(Icon.Close, null))), /*#__PURE__*/React.createElement("div", {
    className: "xref-body",
    ref: isMobile ? scrollRef : null
  }, /*#__PURE__*/React.createElement("h3", {
    className: "xref-title"
  }, "Related Passages"), loading ? /*#__PURE__*/React.createElement("p", {
    className: "xref-synthesis-loading"
  }, "Selecting relevant passages\u2026") : synthesis ? /*#__PURE__*/React.createElement("p", {
    className: "xref-synthesis"
  }, renderInlineMd(synthesis)) : null, !loading && onAiSearch && /*#__PURE__*/React.createElement("button", {
    className: "xref-ai-btn",
    onClick: () => {
      onClose();
      onAiSearch(sourceRef);
    }
  }, "Explore in the corpus \u2192"), loading ? /*#__PURE__*/React.createElement("div", {
    className: "lib-loading"
  }, "Loading\u2026") : refs.length === 0 ? /*#__PURE__*/React.createElement("p", {
    className: "detail-p"
  }, "No cross-references found.") : /*#__PURE__*/React.createElement("div", {
    className: "xref-list"
  }, refs.map(ref => /*#__PURE__*/React.createElement("div", {
    key: ref.ref,
    className: "xref-verse",
    onClick: () => onNavigate(ref.book, ref.chapter, ref.verse)
  }, /*#__PURE__*/React.createElement("span", {
    className: "xref-ref"
  }, ref.ref), /*#__PURE__*/React.createElement("p", {
    className: "xref-text"
  }, verseText(ref)))))));
}
function corpusWordLabel(w) {
  const e = w.english || "";
  if (e) return e;
  const kd = w.kjv_def || "";
  if (kd) {
    const first = kd.split(",").map(t => t.trim()).find(t => !t.startsWith("X ")) || kd.split(",")[0].trim();
    const result = first.replace(/\s*[(\[+].*/, '').trim();
    if (result) return result;
  }
  return w.translit || w.lemma || null;
}

// ============================================================
// SHARED VERSE ROW — used by both Search (CorpusGroup) and the Lexicon tab.
// Lazy-loads its own words; highlights any word whose Strong's is in citedStrongs.
// ============================================================
function VerseRow({
  book,
  chapter,
  verse,
  label,
  allResults,
  onWordClick,
  onReadInContext,
  textMode,
  primaryStrongs,
  citedStrongs,
  kjvCache
}) {
  const [words, setWords] = useState(null);
  const [kjvText, setKjvText] = useState(null);
  const [visible, setVisible] = useState(false);
  const rowRef = useRef(null);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        obs.disconnect();
      }
    }, {
      rootMargin: "300px"
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setWords(null);
    api.verseWords(book, chapter, verse).then(d => {
      if (!cancelled) setWords(d.words || []);
    }).catch(() => {
      if (!cancelled) setWords([]);
    });
    return () => {
      cancelled = true;
    };
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
    api.kjvVerseWords(book, chapter, verse).then(d => {
      if (!cancelled) setKjvText(Array.isArray(d) ? d : []);
    }).catch(() => {
      if (!cancelled) setKjvText([]);
    });
    return () => {
      cancelled = true;
    };
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

  return /*#__PURE__*/React.createElement("div", {
    className: "corpus-verse",
    ref: rowRef
  }, /*#__PURE__*/React.createElement("button", {
    className: "corpus-ref",
    onClick: () => onReadInContext?.(book, chapter, verse)
  }, label), /*#__PURE__*/React.createElement("span", {
    className: "corpus-text"
  }, textMode === "kjv" ? kjvText === null ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--ink-4)",
      fontSize: "13px"
    }
  }, "Loading\u2026") : kjvText.map((w, i) => {
    const sid = w.strongs_ids && w.strongs_ids.length ? w.strongs_ids[0] : null;
    const sidBare = sid ? sid.replace(/^[GH]/i, "") : null;
    const isCited = sid && citedStrongs != null && citedStrongs.size > 0 && (citedStrongs.has(sid) || citedStrongs.has(sidBare));
    const kjvEntry = sid ? {
      id: `kjvcorpus-${book}-${chapter}-${verse}-${i}`,
      strongs: sid,
      strongs_base: sid.slice(1),
      strongs_raw: sid.slice(1),
      greek: w.lemma || "",
      translit: w.xlit || "",
      gloss: w.word,
      ref: `${book} ${chapter}:${verse}`,
      book,
      chapter,
      verse,
      definition: "",
      derivation: "",
      is_function: false,
      isKjv: true,
      isHebrew: sid.startsWith("H")
    } : null;
    return /*#__PURE__*/React.createElement("span", {
      key: i,
      className: "lib-word" + (sid ? " lib-word-clickable" : "") + (w.italic ? " lib-kjv-italic" : "") + (isCited ? " cited" : ""),
      onClick: kjvEntry && onWordClick ? () => onWordClick(kjvEntry) : undefined
    }, /*#__PURE__*/React.createElement("span", {
      className: "lib-iw-english"
    }, w.word, w.punc || ""));
  }) : words === null ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--ink-4)",
      fontSize: "13px"
    }
  }, "Loading\u2026") : (() => {
    function renderCorpusWord(w, key) {
      const label = corpusWordLabel(w);
      if (!label) return null;
      const isPN = !!(w.is_pn || w.strongs_base === "*");
      const clickable = !!(w.strongs_base && (w.strongs_base !== "*" || w.english));
      const wnum = w.strongs && w.strongs !== "*" ? w.strongs : w.strongs_base;
      const foundEntry = !isPN && clickable && entryMap.get(wnum);
      const entry = clickable && (foundEntry ? {
        ...foundEntry,
        gloss: w.english || foundEntry.gloss
      } : {
        id: `corpus-${book}-${chapter}-${verse}-${key}`,
        strongs: strongsTag(wnum),
        strongs_base: w.strongs_base,
        strongs_raw: wnum,
        greek: w.lemma || "",
        translit: w.translit || "",
        gloss: label,
        ref: `${book} ${chapter}:${verse}`,
        book,
        chapter,
        verse,
        definition: "",
        derivation: "",
        is_function: false,
        ...(isPN ? {
          isPN: true,
          pnName: label
        } : {})
      });
      const hasPos = w.greek_pos !== null && w.greek_pos !== undefined;
      const bareNum = strongsBare(w.strongs_base);
      const isCited = clickable && citedStrongs != null && citedStrongs.size > 0 && (citedStrongs.has(w.strongs_base) || citedStrongs.has(bareNum));
      // Multi-word gloss with italic_words: split into separate chips (mirrors library)
      if (label.includes(' ') && w.italic_words) {
        const iset = new Set(w.italic_words.split(','));
        return /*#__PURE__*/React.createElement(React.Fragment, {
          key: key
        }, label.split(' ').filter(Boolean).map((word, pi) => {
          const bare = word.replace(/[^\w]/g, '').toLowerCase();
          const isItal = iset.has(bare);
          return /*#__PURE__*/React.createElement("span", {
            key: pi,
            className: "lib-word" + (!isItal && clickable ? " lib-word-clickable" : "") + (isItal ? " lib-abp-italic" : "") + (!isItal && isCited ? " cited" : ""),
            onClick: !isItal && clickable ? () => onWordClick(entry) : undefined
          }, /*#__PURE__*/React.createElement("span", {
            className: "lib-iw-english"
          }, word));
        }));
      }
      return /*#__PURE__*/React.createElement("span", {
        key: key,
        className: "lib-word" + (clickable ? " lib-word-clickable" : "") + (w.italic ? " lib-abp-italic" : "") + (isCited ? " cited" : ""),
        onClick: clickable ? () => onWordClick(entry) : undefined
      }, /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-pos-english"
      }, hasPos && /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-pos"
      }, w.greek_pos), /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-english"
      }, label)));
    }
    const groups = groupForGreekMode(words.filter(w => w.english).sort((a, b) => a.position - b.position));
    return groups.map((g, gi) => {
      if (!g.isBracket) return renderCorpusWord(g.word, `g${gi}`);
      const corpusBracketChar = (ch, k) => /*#__PURE__*/React.createElement("span", {
        key: k,
        className: "lib-bracket"
      }, /*#__PURE__*/React.createElement("span", {
        className: "lib-bracket-glyph"
      }, ch));
      // Glue "[" to the first word and "]" to the last word (nowrap units)
      // so a line break can only fall BETWEEN words inside the bracket —
      // never stranding a lone "[" at a line end or a "]" at a line start.
      const gw = g.words;
      return /*#__PURE__*/React.createElement("span", {
        key: `bg${gi}`,
        className: "lib-bracket-group"
      }, gw.length === 1 ? /*#__PURE__*/React.createElement("span", {
        className: "lib-bracket-unit"
      }, corpusBracketChar("[", "bl"), renderCorpusWord(gw[0], `bg${gi}w0`), corpusBracketChar("]", "br")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
        className: "lib-bracket-unit"
      }, corpusBracketChar("[", "bl"), renderCorpusWord(gw[0], `bg${gi}w0`)), gw.slice(1, -1).map((w, wi) => renderCorpusWord(w, `bg${gi}w${wi + 1}`)), /*#__PURE__*/React.createElement("span", {
        className: "lib-bracket-unit"
      }, renderCorpusWord(gw[gw.length - 1], `bg${gi}w${gw.length - 1}`), corpusBracketChar("]", "br"))));
    });
  })()));
}

// ============================================================
// CORPUS SEARCH — PASSAGE GROUP (collapsible book+chapter section)
// ============================================================
function CorpusGroup({
  label,
  verses,
  allResults,
  onWordClick,
  onReadInContext,
  textMode,
  primaryStrongs,
  citedStrongs,
  kjvCache
}) {
  const [open, setOpen] = useState(true);
  return /*#__PURE__*/React.createElement("div", {
    className: "corpus-group"
  }, /*#__PURE__*/React.createElement("button", {
    className: "corpus-group-head " + (open ? "open" : ""),
    onClick: () => setOpen(o => !o)
  }, /*#__PURE__*/React.createElement(Icon.Book, {
    style: {
      opacity: 0.5,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "corpus-group-label"
  }, label), /*#__PURE__*/React.createElement("span", {
    className: "corpus-group-count"
  }, verses.length, " verse", verses.length !== 1 ? "s" : ""), /*#__PURE__*/React.createElement("span", {
    className: "corpus-chevron " + (open ? "open" : "")
  })), open && /*#__PURE__*/React.createElement("div", {
    className: "corpus-group-body"
  }, verses.map(v => /*#__PURE__*/React.createElement(VerseRow, {
    key: `${v.book}-${v.chapter}-${v.verse}`,
    book: v.book,
    chapter: v.chapter,
    verse: v.verse,
    label: v.ref,
    allResults: allResults,
    onWordClick: onWordClick,
    onReadInContext: onReadInContext,
    textMode: textMode,
    primaryStrongs: primaryStrongs,
    citedStrongs: citedStrongs,
    kjvCache: kjvCache
  }))));
}

// ============================================================
// CORPUS SEARCH — OUTER CONTAINER
// ============================================================
function CorpusResults({
  allResults,
  primaryStrongs,
  citedStrongs,
  showAll,
  onWordClick,
  onReadInContext,
  corpusSort,
  textMode
}) {
  const [kjvCache, setKjvCache] = useState({}); // pre-fetched KJV verse words

  // Pre-fetch all KJV verse words in one batch when switching to KJV mode
  React.useEffect(() => {
    if (textMode !== "kjv" || !allResults.length) return;
    const seen = new Set();
    const refs = [];
    for (const e of allResults) {
      const key = `${e.book}:${e.chapter}:${e.verse}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({
          book: e.book,
          chapter: e.chapter,
          verse: e.verse
        });
      }
    }
    if (!refs.length) return;
    let cancelled = false;
    api.kjvVerseWordsBatch(refs).then(data => {
      if (!cancelled) setKjvCache(data);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
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
          verseOrder: []
        };
        gOrder.push(gk);
      }
      const vk = `${entry.book}-${entry.chapter}-${entry.verse}`;
      if (!gMap[gk].verseMap[vk]) {
        gMap[gk].verseMap[vk] = {
          book: entry.book,
          chapter: entry.chapter,
          verse: entry.verse,
          ref: entry.ref,
          is_primary: entry.is_primary,
          is_additional: entry.is_additional
        };
        gMap[gk].verseOrder.push(vk);
      }
    }
    return gOrder.map(gk => ({
      label: gMap[gk].label,
      verses: gMap[gk].verseOrder.map(vk => gMap[gk].verseMap[vk])
    })).sort((a, b) => {
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
  const primaryGroups = hasPrimary ? groups.map(g => ({
    ...g,
    verses: g.verses.filter(v => v.is_primary)
  })).filter(g => g.verses.length > 0) : groups;
  const additionalGroups = hasAdditional ? groups.map(g => ({
    ...g,
    verses: g.verses.filter(v => v.is_additional)
  })).filter(g => g.verses.length > 0) : [];
  const otherGroups = hasPrimary || hasAdditional ? groups.map(g => ({
    ...g,
    verses: g.verses.filter(v => !v.is_primary && !v.is_additional)
  })).filter(g => g.verses.length > 0) : [];
  const passageGroupProps = {
    allResults,
    onWordClick,
    onReadInContext,
    textMode,
    primaryStrongs,
    citedStrongs,
    kjvCache
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "corpus-groups"
  }, primaryGroups.map(g => /*#__PURE__*/React.createElement(CorpusGroup, _extends({
    key: g.label,
    label: g.label,
    verses: g.verses
  }, passageGroupProps))), additionalGroups.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "additional-refs-section"
  }, /*#__PURE__*/React.createElement("div", {
    className: "additional-refs-label"
  }, "Additional references"), additionalGroups.map(g => /*#__PURE__*/React.createElement(CorpusGroup, _extends({
    key: g.label,
    label: g.label,
    verses: g.verses
  }, passageGroupProps)))), showAll && otherGroups.map(g => /*#__PURE__*/React.createElement(CorpusGroup, _extends({
    key: g.label,
    label: g.label,
    verses: g.verses
  }, passageGroupProps))));
}

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
  let i = 0,
    key = 0,
    pos = lower.indexOf(t, i);
  while (pos !== -1) {
    if (pos > i) parts.push(text.slice(i, pos));
    parts.push(/*#__PURE__*/React.createElement("mark", {
      key: key++,
      className: "lib-search-mark"
    }, text.slice(pos, pos + term.length)));
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
      if (eng && eng.replace(TRAIL, "") === "") {
        // pure-punctuation token
        trailing += eng;
        continue;
      }
      const m = eng.match(TRAIL);
      if (m) {
        trailing += m[0];
        cleaned.push({
          ...w,
          english: eng.slice(0, eng.length - m[0].length).trimEnd()
        });
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
      while (li > 0 && !(cleaned[li].english || "").trim()) li--;
      cleaned[li] = {
        ...cleaned[li],
        english: (cleaned[li].english || "") + trailing
      };
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
    const bid = w.bracket_id !== null && w.bracket_id !== undefined ? w.bracket_id : null;
    if (bid === null) {
      groups.push({
        isBracket: false,
        word: w
      });
      cur = null;
    } else {
      if (!cur || cur.bid !== bid) {
        cur = {
          isBracket: true,
          bid,
          words: []
        };
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
  Gen: "Law",
  Exo: "Law",
  Lev: "Law",
  Num: "Law",
  Deu: "Law",
  Jos: "History",
  Jdg: "History",
  Rth: "History",
  "1Sa": "History",
  "2Sa": "History",
  "1Ki": "History",
  "2Ki": "History",
  "1Ch": "History",
  "2Ch": "History",
  Ezr: "History",
  Neh: "History",
  Est: "History",
  Job: "Wisdom",
  Psa: "Wisdom",
  Pro: "Wisdom",
  Ecc: "Wisdom",
  Son: "Wisdom",
  Isa: "Major Prophets",
  Jer: "Major Prophets",
  Lam: "Major Prophets",
  Eze: "Major Prophets",
  Dan: "Major Prophets",
  Hos: "Minor Prophets",
  Joe: "Minor Prophets",
  Amo: "Minor Prophets",
  Oba: "Minor Prophets",
  Jon: "Minor Prophets",
  Mic: "Minor Prophets",
  Nah: "Minor Prophets",
  Hab: "Minor Prophets",
  Zep: "Minor Prophets",
  Hag: "Minor Prophets",
  Zec: "Minor Prophets",
  Mal: "Minor Prophets",
  Mat: "Gospels",
  Mar: "Gospels",
  Luk: "Gospels",
  Joh: "Gospels",
  Act: "History",
  Rom: "Pauline Epistles",
  "1Co": "Pauline Epistles",
  "2Co": "Pauline Epistles",
  Gal: "Pauline Epistles",
  Eph: "Pauline Epistles",
  Php: "Pauline Epistles",
  Col: "Pauline Epistles",
  "1Th": "Pauline Epistles",
  "2Th": "Pauline Epistles",
  "1Ti": "Pauline Epistles",
  "2Ti": "Pauline Epistles",
  Tit: "Pauline Epistles",
  Phm: "Pauline Epistles",
  Heb: "General Epistles",
  Jas: "General Epistles",
  "1Pe": "General Epistles",
  "2Pe": "General Epistles",
  "1Jn": "General Epistles",
  "2Jn": "General Epistles",
  "3Jn": "General Epistles",
  Jud: "General Epistles",
  Rev: "Apocalyptic"
};
function LibNavPanel({
  books,
  selBook,
  setSelBook,
  selChapter,
  setSelChapter,
  isOverlay,
  onClose,
  navBookRef,
  nonCanon,
  nonCanonList,
  onPickNonCanon,
  translation,
  corpus,
  pickBible,
  esvOwner,
  nivOwner,
  hebPickable,
  otherOpen,
  setOtherOpen,
  chrono,
  orderMode,
  setOrder,
  chronoPos,
  onPickPassage
}) {
  const [query, setQuery] = useState("");
  const chronoMode = orderMode === "chronological" && chrono && !nonCanon;
  // The era a passage belongs to, so the active passage's era starts expanded.
  const curEraId = chrono && chrono.passages[chronoPos - 1] ? chrono.passages[chronoPos - 1].era : null;
  const [openEras, setOpenEras] = useState(() => new Set(curEraId ? [curEraId] : []));
  const toggleEra = id => setOpenEras(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const navActiveRef = useRef(null); // the active passage button (scroll into view)
  // Keep the active passage's era open and scroll it into view as you step through.
  useEffect(() => {
    if (!chronoMode || !curEraId) return;
    setOpenEras(s => s.has(curEraId) ? s : new Set(s).add(curEraId));
    requestAnimationFrame(() => navActiveRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    }));
  }, [chronoMode, chronoPos, curEraId]);
  // "Other" menu groups start collapsed (the list is long) — except the group of the
  // text that's currently open, so the active pick stays visible.
  const [openGroups, setOpenGroups] = useState(() => new Set(nonCanon ? [nonCanon.group] : []));
  const toggleGroup = g => setOpenGroups(s => {
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
      if (!cur || cur.key !== key) {
        cur = {
          key,
          t,
          div,
          books: []
        };
        out.push(cur);
      }
      cur.books.push(b);
    }
    return out;
  }, [filtered]);

  // When a non-canonical text is active, the nav shows that text's chapter chips
  // (picking WHICH non-canon text happens via the "Other" menu in the source bar).
  const nonCanonActive = nonCanon ? /*#__PURE__*/React.createElement("div", {
    className: "nav-group"
  }, /*#__PURE__*/React.createElement("div", {
    className: "nav-div"
  }, /*#__PURE__*/React.createElement("span", {
    className: "nav-div-t"
  }, "Other"), /*#__PURE__*/React.createElement("span", {
    className: "nav-div-n"
  }, nonCanon.name)), /*#__PURE__*/React.createElement("div", {
    ref: navBookRef
  }, /*#__PURE__*/React.createElement("button", {
    className: "nav-book on"
  }, /*#__PURE__*/React.createElement("span", {
    className: "nav-book-name"
  }, nonCanon.name)), /*#__PURE__*/React.createElement("div", {
    className: "nav-chips"
  }, Array.from({
    length: nonCanon.chapters
  }, (_, i) => i + 1).map(n => /*#__PURE__*/React.createElement("button", {
    key: n,
    className: "ch-chip" + (n === selChapter ? " on" : ""),
    onClick: () => setSelChapter(n)
  }, n))))) : null;

  // "More" button: ABP/KJV/BSB stay one-click; ESV/NIV/HEB + the non-canon books live
  // in this menu, so the row stays at four buttons no matter how many texts exist.
  const extraActive = !nonCanon && (translation === "esv" || translation === "niv" || translation === "heb");
  const moreActive = !!nonCanon || extraActive;
  const moreLabel = nonCanon ? nonCanon.abbr || nonCanon.name : translation === "esv" ? "ESV" : translation === "niv" ? "NIV" : translation === "heb" ? "HEB" : "More";
  return /*#__PURE__*/React.createElement("nav", {
    className: "nav" + (isOverlay ? " nav-overlay" : ""),
    "aria-label": "Books"
  }, /*#__PURE__*/React.createElement("div", {
    className: "nav-top"
  }, isOverlay && /*#__PURE__*/React.createElement("button", {
    className: "nav-x",
    onClick: onClose,
    "aria-label": "Close"
  }, "\u2715")), /*#__PURE__*/React.createElement("div", {
    className: "nav-source"
  }, /*#__PURE__*/React.createElement("div", {
    className: "seg nav-source-seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (!nonCanon && translation === "abp" ? " on" : ""),
    onClick: () => pickBible("abp")
  }, "ABP"), /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (!nonCanon && translation === "kjv" ? " on" : ""),
    onClick: () => pickBible("kjv")
  }, "KJV"), /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (!nonCanon && translation === "bsb" ? " on" : ""),
    onClick: () => pickBible("bsb")
  }, "BSB"), /*#__PURE__*/React.createElement("button", {
    className: "seg-b nav-other-seg" + (moreActive ? " on" : ""),
    onClick: () => setOtherOpen(o => !o),
    "aria-expanded": otherOpen
  }, /*#__PURE__*/React.createElement("span", {
    className: "nav-other-lbl"
  }, moreLabel), /*#__PURE__*/React.createElement("span", {
    className: "nav-other-caret" + (otherOpen ? " open" : "")
  }, "\u25BE")))), otherOpen && /*#__PURE__*/React.createElement("div", {
    className: "nav-other-inline"
  }, (esvOwner || nivOwner || hebPickable) && /*#__PURE__*/React.createElement("div", {
    className: "nav-more-bibles"
  }, esvOwner && /*#__PURE__*/React.createElement("button", {
    className: "lib-other-item" + (!nonCanon && translation === "esv" ? " on" : ""),
    onClick: () => {
      pickBible("esv");
      setOtherOpen(false);
      if (isOverlay) onClose();
    }
  }, "ESV"), nivOwner && /*#__PURE__*/React.createElement("button", {
    className: "lib-other-item" + (!nonCanon && translation === "niv" ? " on" : ""),
    onClick: () => {
      pickBible("niv");
      setOtherOpen(false);
      if (isOverlay) onClose();
    }
  }, "NIV"), hebPickable && /*#__PURE__*/React.createElement("button", {
    className: "lib-other-item" + (!nonCanon && translation === "heb" ? " on" : ""),
    onClick: () => {
      pickBible("heb");
      setOtherOpen(false);
      if (isOverlay) onClose();
    }
  }, "Hebrew OT (interlinear)")), nonCanonList && nonCanonList.length > 0 && nonCanonGroups(nonCanonList).map(grp => {
    const open = openGroups.has(grp.group);
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: grp.group
    }, /*#__PURE__*/React.createElement("button", {
      className: "lib-other-head lib-other-head-btn" + (open ? " open" : ""),
      onClick: () => toggleGroup(grp.group),
      "aria-expanded": open
    }, /*#__PURE__*/React.createElement("span", {
      className: "lib-other-head-caret"
    }, "\u25B8"), /*#__PURE__*/React.createElement("span", {
      className: "lib-other-head-lbl"
    }, grp.group), /*#__PURE__*/React.createElement("span", {
      className: "lib-other-head-count"
    }, grp.items.length)), open && grp.items.map(t => /*#__PURE__*/React.createElement("button", {
      key: t.id,
      className: "lib-other-item" + (nonCanon && nonCanon.id === t.id ? " on" : ""),
      onClick: () => {
        onPickNonCanon(t);
        setOtherOpen(false);
        if (isOverlay) onClose();
      }
    }, t.name)));
  })), /*#__PURE__*/React.createElement("div", {
    className: "nav-scroll"
  }, chronoMode && chrono.eras.map(era => {
    const open = openEras.has(era.id);
    const eraPassages = chrono.passages.filter(p => p.era === era.id);
    return /*#__PURE__*/React.createElement("div", {
      className: "nav-group",
      key: era.id
    }, /*#__PURE__*/React.createElement("button", {
      className: "nav-era" + (open ? " open" : ""),
      onClick: () => toggleEra(era.id),
      "aria-expanded": open,
      title: era.blurb
    }, /*#__PURE__*/React.createElement("span", {
      className: "nav-era-caret"
    }, "\u25B8"), /*#__PURE__*/React.createElement("span", {
      className: "nav-era-name"
    }, era.name), /*#__PURE__*/React.createElement("span", {
      className: "nav-era-count"
    }, eraPassages.length)), open && /*#__PURE__*/React.createElement("div", {
      className: "nav-passages"
    }, eraPassages.map(p => {
      const active = p.pos === chronoPos;
      return /*#__PURE__*/React.createElement("button", {
        key: p.pos,
        ref: active ? navActiveRef : null,
        className: "nav-passage" + (active ? " on" : ""),
        onClick: () => {
          onPickPassage(p);
          if (isOverlay) onClose();
        }
      }, p.label);
    })));
  }), !chronoMode && nonCanon && nonCanonActive, !chronoMode && !nonCanon && groups.map(g => /*#__PURE__*/React.createElement("div", {
    className: "nav-group",
    key: g.key
  }, /*#__PURE__*/React.createElement("div", {
    className: "nav-div"
  }, /*#__PURE__*/React.createElement("span", {
    className: "nav-div-t"
  }, g.t), /*#__PURE__*/React.createElement("span", {
    className: "nav-div-n"
  }, g.div)), g.books.map(b => {
    const active = !nonCanon && selBook && b.abbrev === selBook.abbrev;
    return /*#__PURE__*/React.createElement("div", {
      key: b.abbrev,
      ref: active ? navBookRef : null
    }, /*#__PURE__*/React.createElement("button", {
      className: "nav-book" + (active ? " on" : ""),
      onClick: () => {
        setSelBook(b);
        setSelChapter(1);
        if (isOverlay) onClose();
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "nav-book-name"
    }, b.name)), active && /*#__PURE__*/React.createElement("div", {
      className: "nav-chips"
    }, Array.from({
      length: b.chapters
    }, (_, i) => i + 1).map(n => /*#__PURE__*/React.createElement("button", {
      key: n,
      className: "ch-chip" + (n === selChapter ? " on" : ""),
      onClick: () => setSelChapter(n)
    }, n))));
  })))));
}

// ============================================================
// MOBILE BOOK PICKER — full-screen, two-screen (book grid → chapter grid)
// ============================================================
function MobileBookPicker({
  books,
  selBook,
  selChapter,
  nonCanon,
  nonCanonList,
  onDone,
  onClose,
  chronoOn,
  chrono,
  chronoPos,
  onPickPassage
}) {
  // A non-canonical book is identified by its `id`; a Bible book by its `abbrev`.
  const isNC = b => !!(b && b.id);
  // Chronological: the picker shows eras → passages instead of books → chapters.
  const curEraId = chrono && chrono.passages[chronoPos - 1] ? chrono.passages[chronoPos - 1].era : null;
  const [openEras, setOpenEras] = useState(() => new Set(curEraId ? [curEraId] : []));
  const toggleEra = id => setOpenEras(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  // If a non-canonical text is already open, jump straight to its chapter grid so the
  // reader can change chapter (this is the bug it fixes: the picker used to show only
  // the Bible books, stranding you on whatever Bible book was last selected).
  const [screen, setScreen] = useState(nonCanon ? "chapter" : "book");
  const [pickedBook, setPickedBook] = useState(nonCanon || null);
  // Every section (OT, NT, and each non-canonical group) starts collapsed EXCEPT the
  // one you're currently reading: the testament of the open Bible book, or the active
  // non-canonical text's group.
  const [openGroups, setOpenGroups] = useState(() => new Set([nonCanon ? nonCanon.group : selBook && NT_BOOKS.has(selBook.abbrev) ? "NT" : "OT"]));
  const toggleGroup = g => setOpenGroups(s => {
    const n = new Set(s);
    n.has(g) ? n.delete(g) : n.add(g);
    return n;
  });
  // Same swipe-down-to-close + at-top scroll arming as the hero / xref sheets.
  // ONE stable root so the refs survive the book→chapter screen switch.
  const {
    sheetRef,
    scrollRef
  } = useSwipeToDismiss(onClose);
  const otBooks = books.filter(b => !NT_BOOKS.has(b.abbrev));
  const ntBooks = books.filter(b => NT_BOOKS.has(b.abbrev));
  const onChapter = screen === "chapter";
  const isActive = b => isNC(b) ? nonCanon && nonCanon.id === b.id : selBook && b.abbrev === selBook.abbrev;
  return /*#__PURE__*/React.createElement("div", {
    className: "mpick",
    ref: sheetRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "sheet-drag-zone",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sheet-handle"
  })), /*#__PURE__*/React.createElement("div", {
    className: "mpick-head"
  }, !chronoOn && onChapter ? /*#__PURE__*/React.createElement("button", {
    className: "mpick-back",
    onClick: () => setScreen("book")
  }, "\u2039 Books") : /*#__PURE__*/React.createElement("span", {
    className: "mpick-head-spacer"
  }), /*#__PURE__*/React.createElement("span", {
    className: "mpick-title"
  }, chronoOn ? "Chronological" : onChapter ? pickedBook.name : "Books"), /*#__PURE__*/React.createElement("button", {
    className: "mpick-x",
    onClick: onClose
  }, "\u2715")), /*#__PURE__*/React.createElement("div", {
    className: "mpick-scroll",
    ref: scrollRef
  }, chronoOn ? chrono.eras.map(era => {
    const open = openEras.has(era.id);
    const eraPassages = chrono.passages.filter(p => p.era === era.id);
    return /*#__PURE__*/React.createElement("div", {
      key: era.id,
      className: "mpick-section"
    }, /*#__PURE__*/React.createElement("button", {
      className: "mpick-sec-label mpick-sec-btn" + (open ? " open" : ""),
      onClick: () => toggleEra(era.id),
      "aria-expanded": open
    }, /*#__PURE__*/React.createElement("span", {
      className: "mpick-sec-caret"
    }, "\u25B8"), /*#__PURE__*/React.createElement("span", {
      className: "mpick-sec-name"
    }, era.name), /*#__PURE__*/React.createElement("span", {
      className: "mpick-sec-count"
    }, eraPassages.length)), open && /*#__PURE__*/React.createElement("div", {
      className: "mpick-passages"
    }, eraPassages.map(p => /*#__PURE__*/React.createElement("button", {
      key: p.pos,
      className: "mpick-passage" + (p.pos === chronoPos ? " on" : ""),
      onClick: () => onPickPassage(p)
    }, p.label))));
  }) : onChapter ? /*#__PURE__*/React.createElement("div", {
    className: "mpick-grid"
  }, Array.from({
    length: pickedBook.chapters
  }, (_, i) => i + 1).map(n => {
    const active = isActive(pickedBook) && n === selChapter;
    return /*#__PURE__*/React.createElement("button", {
      key: n,
      className: "mpick-btn" + (active ? " on" : ""),
      onClick: () => onDone(pickedBook, n)
    }, n);
  })) : [["OT", otBooks], ["NT", ntBooks]].map(([label, bks]) => {
    const open = openGroups.has(label);
    return /*#__PURE__*/React.createElement("div", {
      key: label,
      className: "mpick-section"
    }, /*#__PURE__*/React.createElement("button", {
      className: "mpick-sec-label mpick-sec-btn" + (open ? " open" : ""),
      onClick: () => toggleGroup(label),
      "aria-expanded": open
    }, /*#__PURE__*/React.createElement("span", {
      className: "mpick-sec-caret"
    }, "\u25B8"), /*#__PURE__*/React.createElement("span", {
      className: "mpick-sec-name"
    }, label), /*#__PURE__*/React.createElement("span", {
      className: "mpick-sec-count"
    }, bks.length)), open && /*#__PURE__*/React.createElement("div", {
      className: "mpick-grid"
    }, bks.map(b => /*#__PURE__*/React.createElement("button", {
      key: b.abbrev,
      className: "mpick-btn" + (isActive(b) ? " on" : ""),
      onClick: () => {
        setPickedBook(b);
        setScreen("chapter");
      }
    }, b.abbrev.toUpperCase()))));
  }).concat((nonCanonList || []).length ? nonCanonGroups(nonCanonList).map(grp => {
    const open = openGroups.has(grp.group);
    return /*#__PURE__*/React.createElement("div", {
      key: grp.group,
      className: "mpick-section"
    }, /*#__PURE__*/React.createElement("button", {
      className: "mpick-sec-label mpick-sec-btn" + (open ? " open" : ""),
      onClick: () => toggleGroup(grp.group),
      "aria-expanded": open
    }, /*#__PURE__*/React.createElement("span", {
      className: "mpick-sec-caret"
    }, "\u25B8"), /*#__PURE__*/React.createElement("span", {
      className: "mpick-sec-name"
    }, grp.group), /*#__PURE__*/React.createElement("span", {
      className: "mpick-sec-count"
    }, grp.items.length)), open && /*#__PURE__*/React.createElement("div", {
      className: "mpick-grid"
    }, grp.items.map(t => /*#__PURE__*/React.createElement("button", {
      key: t.id,
      className: "mpick-btn mpick-btn-nc" + (isActive(t) ? " on" : ""),
      onClick: () => {
        setPickedBook(t);
        setScreen("chapter");
      }
    }, t.name))));
  }) : [])));
}

// ============================================================
// MOBILE READING OPTIONS — bottom sheet (swipe-to-dismiss, scrollable).
// Compacted to three groups: Text · Study layer · Display.
// ============================================================
function ModesSheet({
  corpus,
  translation,
  pickBible,
  esvOwner,
  nivOwner,
  hebPickable,
  toggleParallel,
  nonCanonList,
  compareAvail,
  compareActive,
  toggleCompare,
  showStrongs,
  showInterlinear,
  setOpt,
  chipMode,
  viewMode,
  libFontSize,
  changeFontSize,
  onClose,
  chrono,
  orderMode,
  setOrder
}) {
  const {
    sheetRef,
    scrollRef
  } = useSwipeToDismiss(onClose);
  const activeNonCanon = nonCanonList.find(t => t.id === corpus) || null;
  const proseLocked = !!(activeNonCanon && activeNonCanon.englishOnly) || translation === "bsb" || translation === "esv" || translation === "niv"; // English-only / BSB / ESV / NIV: no Greek toggles
  const hebMode = translation === "heb"; // Hebrew interlinear: always chips, no prose option
  const gray = proseLocked ? {
    opacity: 0.35,
    cursor: "default"
  } : undefined;
  // English-only "other books": Greek toggles stay locked, but line-vs-flow is allowed.
  const extraEnglish = !!(activeNonCanon && activeNonCanon.englishOnly);
  const layoutLocked = proseLocked && !extraEnglish;
  const viewChipOn = hebMode ? true : extraEnglish ? viewMode === "chip" : chipMode;
  // Text picker gestures: a TAP swaps to that single Bible; a LONG-PRESS (or right-click)
  // ticks it into / out of the side-by-side compare set. One shared timer is fine (touches
  // happen one at a time); the `fired` flag stops a long-press from also firing the tap.
  const pressRef = useRef({
    timer: null,
    fired: false
  });
  const pickHandlers = id => ({
    onClick: () => {
      if (pressRef.current.fired) {
        pressRef.current.fired = false;
        return;
      }
      pickBible(id);
    },
    onContextMenu: e => {
      e.preventDefault();
      toggleCompare(id);
    },
    onTouchStart: () => {
      const st = pressRef.current;
      st.fired = false;
      clearTimeout(st.timer);
      st.timer = setTimeout(() => {
        st.fired = true;
        toggleCompare(id);
        if (navigator.vibrate) navigator.vibrate(12);
      }, 500);
    },
    onTouchMove: () => clearTimeout(pressRef.current.timer),
    onTouchEnd: () => clearTimeout(pressRef.current.timer)
  });
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "sheet-scrim",
    onClick: onClose
  }), /*#__PURE__*/React.createElement("div", {
    className: "msheet",
    ref: sheetRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "sheet-drag-zone",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sheet-handle"
  })), /*#__PURE__*/React.createElement("div", {
    className: "msheet-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "msheet-title"
  }, "Reading"), /*#__PURE__*/React.createElement("button", {
    className: "msheet-x",
    onClick: onClose,
    "aria-label": "Close"
  }, "\u2715")), /*#__PURE__*/React.createElement("div", {
    className: "msheet-body",
    ref: scrollRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "mode-sec"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mode-lbl"
  }, "Text"), activeNonCanon ?
  /*#__PURE__*/
  /* Reading a non-canonical text: ABP/KJV/etc just jump back to the Bible. */
  React.createElement("div", {
    className: "mseg text-ed"
  }, /*#__PURE__*/React.createElement("button", {
    className: "mseg-b" + (corpus === "bible" && translation === "abp" ? " on" : ""),
    onClick: () => pickBible("abp")
  }, "ABP"), /*#__PURE__*/React.createElement("button", {
    className: "mseg-b" + (corpus === "bible" && translation === "kjv" ? " on" : ""),
    onClick: () => pickBible("kjv")
  }, "KJV"), /*#__PURE__*/React.createElement("button", {
    className: "mseg-b" + (corpus === "bible" && translation === "bsb" ? " on" : ""),
    onClick: () => pickBible("bsb")
  }, "BSB"), esvOwner && /*#__PURE__*/React.createElement("button", {
    className: "mseg-b" + (corpus === "bible" && translation === "esv" ? " on" : ""),
    onClick: () => pickBible("esv")
  }, "ESV"), nivOwner && /*#__PURE__*/React.createElement("button", {
    className: "mseg-b" + (corpus === "bible" && translation === "niv" ? " on" : ""),
    onClick: () => pickBible("niv")
  }, "NIV")) :
  /*#__PURE__*/
  /* Bible: one checkable row — tick 1 to read it, 2-4 to compare side by side.
     compareActive + toggleCompare already do the read/compare switching. */
  React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "mode-hint"
  }, "Tap to read \xB7 long-press to compare"), /*#__PURE__*/React.createElement("div", {
    className: "mseg text-ed text-pick"
  }, compareAvail.map(id => {
    const on = compareActive.includes(id);
    return /*#__PURE__*/React.createElement("button", _extends({
      key: id,
      className: "mseg-b" + (on ? " on" : ""),
      "aria-pressed": on
    }, pickHandlers(id)), on && /*#__PURE__*/React.createElement("span", {
      className: "mseg-chk",
      "aria-hidden": "true"
    }, "\u2713"), id.toUpperCase());
  })), /*#__PURE__*/React.createElement("div", {
    className: "text-mode-note"
  }, compareActive.length >= 2 ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon.Columns, {
    width: "14",
    height: "14"
  }), /*#__PURE__*/React.createElement("span", null, "Comparing ", compareActive.length, " \u2014 ", compareActive.map(x => x.toUpperCase()).join(" · "), " side by side")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon.Book, {
    width: "14",
    height: "14"
  }), /*#__PURE__*/React.createElement("span", null, "Reading ", (compareActive[0] || "abp").toUpperCase()))), hebPickable && /*#__PURE__*/React.createElement("button", {
    className: "mseg-b text-heb" + (translation === "heb" ? " on" : ""),
    "aria-pressed": translation === "heb",
    onClick: () => {
      pickBible("heb");
      onClose && onClose();
    },
    style: {
      marginTop: 6,
      width: "100%"
    }
  }, translation === "heb" && /*#__PURE__*/React.createElement("span", {
    className: "mseg-chk",
    "aria-hidden": "true"
  }, "\u2713"), "Hebrew OT (interlinear)"))), chrono && !activeNonCanon && /*#__PURE__*/React.createElement("div", {
    className: "mode-sec"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mode-lbl"
  }, "Order"), /*#__PURE__*/React.createElement("div", {
    className: "mseg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "mseg-b" + (orderMode !== "chronological" ? " on" : ""),
    onClick: () => setOrder("canonical")
  }, "Canonical"), /*#__PURE__*/React.createElement("button", {
    className: "mseg-b" + (orderMode === "chronological" ? " on" : ""),
    onClick: () => setOrder("chronological")
  }, "Chronological"))), /*#__PURE__*/React.createElement("div", {
    className: "mode-sec"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mode-lbl"
  }, "Study layer"), /*#__PURE__*/React.createElement("div", {
    className: "mtog"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mtog-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mtog-txt"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mtog-name"
  }, "Strong's numbers"), /*#__PURE__*/React.createElement("div", {
    className: "mtog-sub"
  }, "Tap a word for its lexicon entry")), /*#__PURE__*/React.createElement("button", {
    className: "switch" + (showStrongs ? " on" : ""),
    disabled: proseLocked,
    style: gray,
    onClick: () => !proseLocked && setOpt("showStrongs", !showStrongs),
    "aria-label": "Toggle Strong's",
    "aria-pressed": showStrongs
  })), /*#__PURE__*/React.createElement("div", {
    className: "mtog-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mtog-txt"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mtog-name"
  }, "Interlinear"), /*#__PURE__*/React.createElement("div", {
    className: "mtog-sub"
  }, "Stack Greek, transliteration & gloss")), /*#__PURE__*/React.createElement("button", {
    className: "switch" + (showInterlinear ? " on" : ""),
    disabled: proseLocked,
    style: gray,
    onClick: () => !proseLocked && setOpt("showInterlinear", !showInterlinear),
    "aria-label": "Toggle Interlinear",
    "aria-pressed": showInterlinear
  })))), /*#__PURE__*/React.createElement("div", {
    className: "mode-sec"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mode-lbl"
  }, "Display"), /*#__PURE__*/React.createElement("div", {
    className: "display-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mseg mseg-view"
  }, /*#__PURE__*/React.createElement("button", {
    className: "mseg-b" + (viewChipOn ? " on" : ""),
    disabled: layoutLocked,
    style: layoutLocked ? {
      opacity: 0.35,
      cursor: "default"
    } : undefined,
    title: extraEnglish ? "Line-by-line view" : "Chip view",
    "aria-label": extraEnglish ? "Line-by-line view" : "Chip view",
    "aria-pressed": viewChipOn,
    onClick: () => !layoutLocked && setOpt("viewMode", "chip")
  }, /*#__PURE__*/React.createElement(Icon.Grid, null)), /*#__PURE__*/React.createElement("button", {
    className: "mseg-b" + (!viewChipOn ? " on" : ""),
    disabled: hebMode || !extraEnglish && !proseLocked && (showStrongs || showInterlinear),
    style: hebMode || !extraEnglish && !proseLocked && (showStrongs || showInterlinear) ? {
      opacity: 0.35
    } : undefined,
    title: "Prose view",
    "aria-label": "Prose view",
    "aria-pressed": !viewChipOn,
    onClick: () => {
      if (hebMode) return;
      if (extraEnglish) {
        setOpt("viewMode", "prose");
        return;
      }
      if (!showStrongs && !showInterlinear) setOpt("viewMode", "prose");
    }
  }, /*#__PURE__*/React.createElement(Icon.Lines, null))), /*#__PURE__*/React.createElement("div", {
    className: "mseg font-picker"
  }, /*#__PURE__*/React.createElement("button", {
    className: "mseg-b",
    onClick: () => changeFontSize(-1)
  }, "A\u2212"), /*#__PURE__*/React.createElement("span", {
    className: "font-size-lbl"
  }, libFontSize), /*#__PURE__*/React.createElement("button", {
    className: "mseg-b",
    onClick: () => changeFontSize(+1)
  }, "A+")))))));
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
{
  id: "esdras1",
  name: "1 Esdras",
  abbr: "1Esd",
  chapters: 9,
  englishOnly: true,
  group: "Septuagint Apocrypha"
}, {
  id: "tobit",
  name: "Tobit",
  abbr: "Tob",
  chapters: 14,
  englishOnly: true,
  group: "Septuagint Apocrypha"
}, {
  id: "judith",
  name: "Judith",
  abbr: "Jdt",
  chapters: 16,
  englishOnly: true,
  group: "Septuagint Apocrypha"
}, {
  id: "esther_gk",
  name: "Esther (Greek)",
  abbr: "EsG",
  chapters: 10,
  englishOnly: true,
  group: "Septuagint Apocrypha"
}, {
  id: "maccabees1",
  name: "1 Maccabees",
  abbr: "1Mac",
  chapters: 16,
  englishOnly: true,
  group: "Septuagint Apocrypha"
}, {
  id: "maccabees2",
  name: "2 Maccabees",
  abbr: "2Mac",
  chapters: 15,
  englishOnly: true,
  group: "Septuagint Apocrypha"
}, {
  id: "maccabees3",
  name: "3 Maccabees",
  abbr: "3Mac",
  chapters: 7,
  englishOnly: true,
  group: "Septuagint Apocrypha"
}, {
  id: "maccabees4",
  name: "4 Maccabees",
  abbr: "4Mac",
  chapters: 18,
  englishOnly: true,
  group: "Septuagint Apocrypha"
}, {
  id: "wisdom",
  name: "Wisdom of Solomon",
  abbr: "Wis",
  chapters: 19,
  englishOnly: true,
  group: "Septuagint Apocrypha"
}, {
  id: "sirach",
  name: "Sirach",
  abbr: "Sir",
  chapters: 51,
  englishOnly: true,
  group: "Septuagint Apocrypha"
}, {
  id: "baruch",
  name: "Baruch",
  abbr: "Bar",
  chapters: 5,
  englishOnly: true,
  group: "Septuagint Apocrypha"
}, {
  id: "epjeremiah",
  name: "Letter of Jeremiah",
  abbr: "EpJer",
  chapters: 1,
  englishOnly: true,
  group: "Septuagint Apocrypha"
}, {
  id: "susanna",
  name: "Susanna",
  abbr: "Sus",
  chapters: 1,
  englishOnly: true,
  group: "Septuagint Apocrypha"
}, {
  id: "bel",
  name: "Bel and the Dragon",
  abbr: "Bel",
  chapters: 1,
  englishOnly: true,
  group: "Septuagint Apocrypha"
}, {
  id: "manasseh",
  name: "Prayer of Manasseh",
  abbr: "PrMan",
  chapters: 1,
  englishOnly: true,
  group: "Septuagint Apocrypha"
},
// Pseudepigrapha — Second Temple Jewish texts (R.H. Charles et al., public domain).
// 2 Esdras (= 4 Ezra) is the great Jewish apocalypse; not in the Greek LXX, so it sits
// here rather than with the Septuagint Apocrypha. WEB Apocrypha (public domain) English.
{
  id: "esdras2",
  name: "2 Esdras (4 Ezra)",
  abbr: "2Esd",
  chapters: 16,
  englishOnly: true,
  group: "Pseudepigrapha"
}, {
  id: "enoch",
  name: "1 Enoch",
  abbr: "1En",
  chapters: 108,
  englishOnly: true,
  group: "Pseudepigrapha"
}, {
  id: "enoch2",
  name: "2 Enoch",
  abbr: "2En",
  chapters: 68,
  englishOnly: true,
  group: "Pseudepigrapha"
}, {
  id: "jubilees",
  name: "Jubilees",
  abbr: "Jub",
  chapters: 50,
  englishOnly: true,
  group: "Pseudepigrapha"
}, {
  id: "baruch2",
  name: "2 Baruch",
  abbr: "2Bar",
  chapters: 85,
  englishOnly: true,
  group: "Pseudepigrapha"
},
// 3 Baruch / Greek Apocalypse of Baruch (Charles APOT, public domain) -- 17 ch + Prologue (ch 0).
{
  id: "baruch3",
  name: "3 Baruch",
  abbr: "3Bar",
  chapters: 17,
  englishOnly: true,
  group: "Pseudepigrapha"
}, {
  id: "apocabr",
  name: "Apocalypse of Abraham",
  abbr: "ApAb",
  chapters: 32,
  englishOnly: true,
  group: "Pseudepigrapha"
},
// chapter-level only: no freely-reachable copy is versified (see parse_assummoses.py)
{
  id: "assummoses",
  name: "Assumption of Moses",
  abbr: "AsMos",
  chapters: 12,
  englishOnly: true,
  group: "Pseudepigrapha"
},
// Latin Vita Adae et Evae (Charles APOT, public domain) -- 51 chapters.
{
  id: "adameve",
  name: "Life of Adam and Eve",
  abbr: "LAE",
  chapters: 51,
  englishOnly: true,
  group: "Pseudepigrapha"
},
// Psalms of Solomon (G.B. Gray, Charles APOT, public domain) -- 18 psalms.
{
  id: "psolomon",
  name: "Psalms of Solomon",
  abbr: "PsSol",
  chapters: 18,
  englishOnly: true,
  group: "Pseudepigrapha"
},
// Letter of Aristeas (H.T. Andrews, Charles APOT, public domain) -- one letter, cited by
// section 1-322 (loaded as a single chapter whose verses are the section numbers).
{
  id: "aristeas",
  name: "Letter of Aristeas",
  abbr: "Arist",
  chapters: 1,
  englishOnly: true,
  group: "Pseudepigrapha"
},
// Ascension of Isaiah (R.H. Charles, public domain) -- Martyrdom (1-5) + Vision (6-11).
{
  id: "ascisaiah",
  name: "Ascension of Isaiah",
  abbr: "AscIsa",
  chapters: 11,
  englishOnly: true,
  group: "Pseudepigrapha"
},
// Sibylline Oracles (Milton Terry, public domain) -- chapter = book, verse = line. The
// collection numbers its books 1-8 and 11-14 (chapters 9 & 10 carry a "no such book" note).
{
  id: "sibylline",
  name: "Sibylline Oracles",
  abbr: "SibOr",
  chapters: 14,
  englishOnly: true,
  group: "Pseudepigrapha"
},
// Testaments of the Twelve Patriarchs (R.H. Charles, APOT) -- twelve short books,
// each cited on its own (T. Reuben 1:1 ...), so each is a separate entry.
{
  id: "treuben",
  name: "Testament of Reuben",
  abbr: "TReu",
  chapters: 7,
  englishOnly: true,
  group: "Testaments (12 Patriarchs)"
}, {
  id: "tsimeon",
  name: "Testament of Simeon",
  abbr: "TSim",
  chapters: 9,
  englishOnly: true,
  group: "Testaments (12 Patriarchs)"
}, {
  id: "tlevi",
  name: "Testament of Levi",
  abbr: "TLevi",
  chapters: 19,
  englishOnly: true,
  group: "Testaments (12 Patriarchs)"
}, {
  id: "tjudah",
  name: "Testament of Judah",
  abbr: "TJud",
  chapters: 26,
  englishOnly: true,
  group: "Testaments (12 Patriarchs)"
}, {
  id: "tissachar",
  name: "Testament of Issachar",
  abbr: "TIss",
  chapters: 7,
  englishOnly: true,
  group: "Testaments (12 Patriarchs)"
}, {
  id: "tzebulun",
  name: "Testament of Zebulun",
  abbr: "TZeb",
  chapters: 10,
  englishOnly: true,
  group: "Testaments (12 Patriarchs)"
}, {
  id: "tdan",
  name: "Testament of Dan",
  abbr: "TDan",
  chapters: 7,
  englishOnly: true,
  group: "Testaments (12 Patriarchs)"
}, {
  id: "tnaphtali",
  name: "Testament of Naphtali",
  abbr: "TNaph",
  chapters: 9,
  englishOnly: true,
  group: "Testaments (12 Patriarchs)"
}, {
  id: "tgad",
  name: "Testament of Gad",
  abbr: "TGad",
  chapters: 8,
  englishOnly: true,
  group: "Testaments (12 Patriarchs)"
}, {
  id: "tasher",
  name: "Testament of Asher",
  abbr: "TAsh",
  chapters: 8,
  englishOnly: true,
  group: "Testaments (12 Patriarchs)"
}, {
  id: "tjoseph",
  name: "Testament of Joseph",
  abbr: "TJos",
  chapters: 20,
  englishOnly: true,
  group: "Testaments (12 Patriarchs)"
}, {
  id: "tbenjamin",
  name: "Testament of Benjamin",
  abbr: "TBen",
  chapters: 12,
  englishOnly: true,
  group: "Testaments (12 Patriarchs)"
},
// Apostolic Fathers — Greek-tagged interlinear (Brannan/Lake Greek + Lightfoot English).
// NOT englishOnly: these have the full Greek word-study layer like the Bible text.
// Traditional reading order. (Polycarp ch 10-14 survive only in Latin -> English
// shows there, no Greek chips.)
{
  id: "clement1",
  name: "1 Clement",
  abbr: "1Clem",
  chapters: 65,
  group: "Apostolic Fathers"
}, {
  id: "clement2",
  name: "2 Clement",
  abbr: "2Clem",
  chapters: 20,
  group: "Apostolic Fathers"
}, {
  id: "ign_eph",
  name: "Ignatius to the Ephesians",
  abbr: "IgEph",
  chapters: 21,
  group: "Apostolic Fathers"
}, {
  id: "ign_mag",
  name: "Ignatius to the Magnesians",
  abbr: "IgMag",
  chapters: 15,
  group: "Apostolic Fathers"
}, {
  id: "ign_tral",
  name: "Ignatius to the Trallians",
  abbr: "IgTra",
  chapters: 13,
  group: "Apostolic Fathers"
}, {
  id: "ign_rom",
  name: "Ignatius to the Romans",
  abbr: "IgRom",
  chapters: 10,
  group: "Apostolic Fathers"
}, {
  id: "ign_phld",
  name: "Ignatius to the Philadelphians",
  abbr: "IgPhl",
  chapters: 11,
  group: "Apostolic Fathers"
}, {
  id: "ign_smyrn",
  name: "Ignatius to the Smyrnaeans",
  abbr: "IgSmy",
  chapters: 13,
  group: "Apostolic Fathers"
}, {
  id: "ign_pol",
  name: "Ignatius to Polycarp",
  abbr: "IgPol",
  chapters: 8,
  group: "Apostolic Fathers"
}, {
  id: "polycarp",
  name: "Polycarp to the Philippians",
  abbr: "Pol",
  chapters: 14,
  group: "Apostolic Fathers"
}, {
  id: "mpolycarp",
  name: "Martyrdom of Polycarp",
  abbr: "MPol",
  chapters: 22,
  group: "Apostolic Fathers"
}, {
  id: "barnabas",
  name: "Epistle of Barnabas",
  abbr: "Barn",
  chapters: 21,
  group: "Apostolic Fathers"
}, {
  id: "didache",
  name: "Didache",
  abbr: "Did",
  chapters: 16,
  group: "Apostolic Fathers"
}, {
  id: "diognetus",
  name: "Epistle to Diognetus",
  abbr: "Diog",
  chapters: 12,
  group: "Apostolic Fathers"
}, {
  id: "shepherd",
  name: "Shepherd of Hermas",
  abbr: "Herm",
  chapters: 110,
  group: "Apostolic Fathers"
}];

// Group NONCANON entries by their `group` label, preserving array order, for the
// section-headed "Other" menus (nav source-picker dropdown + mobile sheet).
function nonCanonGroups(list) {
  const out = [];
  let cur = null;
  for (const t of list) {
    const g = t.group || "Other";
    if (!cur || cur.group !== g) {
      cur = {
        group: g,
        items: []
      };
      out.push(cur);
    }
    cur.items.push(t);
  }
  return out;
}

// ============================================================
// LIBRARY VIEW
// ============================================================
function LibraryView({
  nav,
  onNavChange,
  onWordClick,
  onVerseNumberClick,
  onOpenNote,
  onTranslationChange,
  isMobile,
  showSummary
}) {
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
  // Hebrew OT interlinear (PUBLIC, public-domain). hebOwner gates the toggle's
  // VISIBILITY during rollout; hebAvail = heb.db is loaded (flip the gate to that to
  // go fully public). Single-read mode for now (not in compare/chronological yet).
  const [hebVerses, setHebVerses] = useState([]);
  const [hebLoading, setHebLoading] = useState(false);
  const [hebOwner, setHebOwner] = useState(false);
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
  const [viewCh, setViewCh] = useState(null); // chrono: chapter currently scrolled into view (drives the toolbar play target)
  const [libOptions, setLibOptions] = useState({
    viewMode: "chip",
    showStrongs: false,
    showInterlinear: false
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
  const [corpus, setCorpus] = useState("bible"); // which text: "bible" | a non-canonical id (e.g. "didache")
  const [didVerses, setDidVerses] = useState([]);
  const [didLoading, setDidLoading] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false); // mobile: overview sheet
  // Chronological reading: the same reader, fed passages in event order. The list
  // is a static file (book + verse range pointers, no Bible text). "canonical" =
  // normal book/chapter order; "chronological" = walk `chrono.passages` in order.
  const [orderMode, setOrderMode] = useState("canonical"); // "canonical" | "chronological"
  const [chrono, setChrono] = useState(null); // { eras, passages } | null
  const [chronoPos, setChronoPos] = useState(1); // current passage position (1-based)
  const [chronoData, setChronoData] = useState(null); // loaded span: { pos, byCh:{ch:{abp,kjv,bsb}} }
  const [chronoLoading, setChronoLoading] = useState(false);
  const nonCanon = NONCANON.find(t => t.id === corpus) || null;
  const chronoOn = orderMode === "chronological" && !nonCanon && !!chrono;
  const curPassage = chronoOn ? chrono.passages[chronoPos - 1] || null : null;
  const highlightRef = useRef(null);
  const navBookRef = useRef(null);
  const readingRef = useRef(null);
  // Drag-select-to-note: the floating "Add note" bar + the captured anchor.
  const [noteSel, setNoteSel] = useState(null); // { rect, anchor } | null
  const justSelectedRef = useRef(false); // suppress the click that follows a drag
  const [flashMsg, setFlashMsg] = useState(""); // tiny confirmation toast ("Copied", etc.)
  const flashT = useRef(null);
  const flash = m => {
    setFlashMsg(m);
    clearTimeout(flashT.current);
    flashT.current = setTimeout(() => setFlashMsg(""), 1600);
  };
  // The line a verse becomes when sent to the journal: "Genesis 1:8 (ABP) — text".
  // No translation tag for non-canon texts (their book name already says it all).
  const journalLine = a => {
    const tag = nonCanon ? "" : translation === "parallel" ? compareSel.map(s => s.toUpperCase()).join("/") : (translation || "").toUpperCase();
    return a.refLabel + (tag ? " (" + tag + ")" : "") + " — " + a.snippet;
  };
  useNotesVersion(); // re-render markers when notes change
  // Who's signed in (re-read every render; setAuth notifies, so login/logout
  // re-renders us). The ESV toggle only ever shows when the server says "owner".
  const authEmail = (() => {
    try {
      return (NotesStore.authInfo() || {}).email || null;
    } catch (e) {
      return null;
    }
  })();
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.esvStatus().then(d => {
      if (!cancelled) setEsvOwner(!!(d && d.owner));
    }), api.nivStatus().then(d => {
      if (!cancelled) setNivOwner(!!(d && d.owner));
    }), api.hebStatus().then(d => {
      if (!cancelled) {
        setHebOwner(!!(d && d.owner));
        setHebAvail(!!(d && d.available));
      }
    })]).finally(() => {
      if (!cancelled) setGatedReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [authEmail]);
  // If the owner signs out (or it's revoked) while reading ESV/NIV, fall back to ABP
  // so they're never stuck on a now-forbidden text showing blank.
  useEffect(() => {
    if (!gatedReady) return; // owner status still loading — don't bounce a just-restored gated text
    if (!esvOwner && translation === "esv") {
      setTranslation("abp");
      onTranslationChange?.("abp");
    }
    if (!nivOwner && translation === "niv") {
      setTranslation("abp");
      onTranslationChange?.("abp");
    }
    // HEB is OT-only and owner-gated during rollout — bounce back to ABP if either
    // fails (signed out, or moved to an NT book while reading Hebrew).
    if (translation === "heb" && (!hebOwner || selBook && NT_BOOKS.has(selBook.abbrev))) {
      setTranslation("abp");
      onTranslationChange?.("abp");
    }
  }, [esvOwner, nivOwner, hebOwner, translation, selBook, gatedReady]);
  useEffect(() => {
    if (!nav?.book || !navBookRef.current || nav.book !== selBook?.abbrev) return;
    requestAnimationFrame(() => {
      // "nearest" so an already-visible book button doesn't scroll at all — "start"
      // dragged the whole window down (and pushed the verse off-screen) even when the
      // nav book was right there, e.g. clicking a verse number on a fresh Genesis 1.
      navBookRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
    });
  }, [nav?.book, selBook?.abbrev]);

  // When a non-canonical text is opened, its nav group moves to the top — bring it into view.
  useEffect(() => {
    if (!nonCanon || !navBookRef.current) return;
    requestAnimationFrame(() => {
      navBookRef.current?.scrollIntoView({
        behavior: "auto",
        block: "start"
      });
    });
  }, [nonCanon?.id]);
  const navVisible = !isMobile;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [modesOpen, setModesOpen] = useState(false);
  // In-text search ("find in the text you're reading")
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState(null); // null = no search run yet
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchScope, setSearchScope] = useState("all"); // "all" | "book" (current book only)
  const [searchTerm, setSearchTerm] = useState(""); // the term actually searched (for highlighting)

  useEffect(() => {
    api.books().then(data => {
      setBooks(data);
      if (!data.length) return;
      // Restore the last reading spot from a previous visit (book/chapter/translation, or an
      // open non-canonical text); fall back to Genesis. An explicit verse jump (nav.book — a
      // click from Search/cross-refs) runs in its own effect and overrides this afterward.
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem("lexica.lib.v1") || "null");
      } catch (e) {}
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
    if (!selBook && corpus === "bible") return; // nothing settled yet
    try {
      localStorage.setItem("lexica.lib.v1", JSON.stringify({
        corpus,
        book: selBook ? selBook.abbrev : null,
        chapter: selChapter,
        translation
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
  const pickPassage = p => {
    if (!p) return;
    const b = books.find(bk => bk.abbrev === p.book);
    if (!b) return;
    setChronoPos(p.pos);
    if (corpus !== "bible") setCorpus("bible");
    setSelBook(b);
    setSelChapter(p.start_ch);
  };
  // Step forward/back through the whole passage list (flows across era edges).
  const stepPassage = delta => {
    if (!chrono) return;
    const next = chronoPos + delta;
    if (next < 1 || next > chrono.passages.length) return;
    pickPassage(chrono.passages[next - 1]);
  };
  // Flip reading order. Entering chronological stashes the canonical spot and jumps
  // to the current passage; leaving restores the stashed canonical spot.
  const setOrder = mode => {
    if (mode === orderMode) return;
    if (mode === "chronological") {
      canonReturnRef.current = selBook ? {
        book: selBook,
        chapter: selChapter
      } : null;
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
      setCorpus("bible"); // a verse reference is a Bible verse — leave any open non-canonical text
      setOtherOpen(false); // close the "Other" picker if it was open
      // clear the old chapter's verses so the scroll-to-highlight waits for the NEW
      // chapter (otherwise it can fire on a stale same-numbered verse and burn its flag)
      setVerses([]);
      setKjvVerses([]);
      setBsbVerses([]);
      setSelBook(b);
      setSelChapter(nav.chapter || 1);
      if (nav.translation) {
        setTranslation(nav.translation);
        onTranslationChange?.(nav.translation);
      }
    }
  }, [nav, books]);
  useEffect(() => {
    if (!selBook || nonCanon || chronoOn) return; // non-canon + chronological load via their own effects below
    let cancelled = false;
    setLoading(true);
    setVerses([]);
    api.chapter(selBook.abbrev, selChapter).then(data => {
      if (!cancelled) {
        setVerses(data);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selBook && selBook.abbrev, selChapter, corpus, chronoOn]);

  // Chronological span loader: fetch every chapter the current passage covers, for
  // the active text(s). One state object keyed by chapter; the render trims each
  // chapter to the passage's verse window and stitches them with chapter markers.
  useEffect(() => {
    if (!chronoOn || !curPassage || !selBook) return;
    let cancelled = false;
    setChronoLoading(true);
    const {
      book,
      start_ch,
      end_ch
    } = curPassage;
    const chs = [];
    for (let c = start_ch; c <= end_ch; c++) chs.push(c);
    const need = translation === "parallel" ? compareSel : [translation];
    const fetchChapter = c => {
      const jobs = [];
      if (need.includes("abp")) jobs.push(api.chapter(book, c).then(d => ["abp", d]));
      if (need.includes("kjv")) jobs.push(api.kjvChapter(book, c).then(d => ["kjv", d]));
      if (need.includes("bsb")) jobs.push(api.bsbChapter(book, c).then(d => ["bsb", d]));
      if (need.includes("esv")) jobs.push(api.esvChapter(book, c).then(d => ["esv", d]));
      if (need.includes("niv")) jobs.push(api.nivChapter(book, c).then(d => ["niv", d]));
      return Promise.all(jobs).then(pairs => [c, Object.fromEntries(pairs)]);
    };
    Promise.all(chs.map(fetchChapter)).then(entries => {
      if (cancelled) return;
      setChronoData({
        pos: curPassage.pos,
        byCh: Object.fromEntries(entries)
      });
      setChronoLoading(false);
    }).catch(() => {
      if (!cancelled) setChronoLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [chronoOn, chronoPos, translation, corpus, compareSel]);

  // Non-canonical text loader (Didache, etc.) — keyed on the active text id + chapter.
  useEffect(() => {
    if (!nonCanon) return;
    let cancelled = false;
    setDidLoading(true);
    setDidVerses([]);
    api.extraChapter(nonCanon.id, selChapter).then(data => {
      if (!cancelled) {
        setDidVerses(data);
        setDidLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setDidLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [corpus, selChapter]);
  useEffect(() => {
    if (!selBook || nonCanon || chronoOn) return;
    if (translation !== "kjv" && !(translation === "parallel" && compareSel.includes("kjv"))) return;
    let cancelled = false;
    setKjvLoading(true);
    setKjvVerses([]);
    api.kjvChapter(selBook.abbrev, selChapter).then(data => {
      if (!cancelled) {
        setKjvVerses(data);
        setKjvLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setKjvLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selBook && selBook.abbrev, selChapter, translation, corpus, chronoOn, compareSel]);

  // BSB chapter loader — when BSB is the reading text OR a selected compare column.
  useEffect(() => {
    if (!selBook || nonCanon || chronoOn) return;
    if (translation !== "bsb" && !(translation === "parallel" && compareSel.includes("bsb"))) return;
    let cancelled = false;
    setBsbLoading(true);
    setBsbVerses([]);
    api.bsbChapter(selBook.abbrev, selChapter).then(data => {
      if (!cancelled) {
        setBsbVerses(data);
        setBsbLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setBsbLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selBook && selBook.abbrev, selChapter, translation, corpus, chronoOn, compareSel]);

  // ESV chapter loader — owner-only reading text. Each fetch carries the login
  // token; the server returns 404 (and api.esvChapter yields []) for non-owners.
  useEffect(() => {
    if (!selBook || nonCanon || chronoOn || !esvOwner) return;
    if (translation !== "esv" && !(translation === "parallel" && compareSel.includes("esv"))) return;
    let cancelled = false;
    setEsvLoading(true);
    setEsvVerses([]);
    api.esvChapter(selBook.abbrev, selChapter).then(data => {
      if (!cancelled) {
        setEsvVerses(data);
        setEsvLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setEsvLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selBook && selBook.abbrev, selChapter, translation, corpus, chronoOn, esvOwner, compareSel]);

  // NIV chapter loader — owner-only reading text (same as ESV, text only).
  useEffect(() => {
    if (!selBook || nonCanon || chronoOn || !nivOwner) return;
    if (translation !== "niv" && !(translation === "parallel" && compareSel.includes("niv"))) return;
    let cancelled = false;
    setNivLoading(true);
    setNivVerses([]);
    api.nivChapter(selBook.abbrev, selChapter).then(data => {
      if (!cancelled) {
        setNivVerses(data);
        setNivLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setNivLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selBook && selBook.abbrev, selChapter, translation, corpus, chronoOn, nivOwner, compareSel]);

  // Hebrew OT interlinear loader — PUBLIC text, OT books only, single-read mode
  // (not wired into compare / chronological yet).
  useEffect(() => {
    if (!selBook || nonCanon || chronoOn) return;
    if (translation !== "heb" || NT_BOOKS.has(selBook.abbrev)) return;
    let cancelled = false;
    setHebLoading(true);
    setHebVerses([]);
    api.hebChapter(selBook.abbrev, selChapter).then(data => {
      if (!cancelled) {
        setHebVerses(data);
        setHebLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setHebLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selBook && selBook.abbrev, selChapter, translation, corpus, chronoOn]);

  // Reset the chapter audio when the reading changes — the old mp3 is for the
  // previous chapter/passage. Press Listen to fetch the new one. (chronoPos covers
  // moving between chronological passages, which doesn't change selChapter.)
  useEffect(() => {
    setAudioUrl(null);
    setAudioKey(null);
    setAudioBusy(false);
    setAudioPlaying(false);
    setAudioCur(0);
    setAudioDur(0);
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
    fetchUrl(book, ch).then(d => {
      setAudioBusy(false);
      if (d && d.url) {
        setAudioUrl(d.url);
        setAudioKey(book + "-" + ch);
      } else flash("No audio for this chapter");
    }).catch(() => {
      setAudioBusy(false);
      flash("Audio unavailable");
    });
  };
  const seekAudio = e => {
    const a = audioRef.current;
    if (!a) return;
    const v = Number(e.target.value);
    a.currentTime = v;
    setAudioCur(v);
  };
  useEffect(() => {
    if (!nav?.scroll || loading || !verses.length) return;
    // Don't scroll while the requested chapter's verses are still the OLD chapter's —
    // otherwise we scroll to (and burn the scroll flag on) a wrong same-numbered verse.
    if (nav.chapter != null && nav.chapter !== selChapter) return;
    let raf,
      tries = 0;
    const tryScroll = () => {
      if (highlightRef.current) {
        highlightRef.current.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        onNavChange?.({
          ...nav,
          scroll: false
        });
      } else if (tries++ < 30) {
        raf = requestAnimationFrame(tryScroll); // highlight row not rendered yet — keep waiting
      }
    };
    raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
    // kjvVerses is in the deps so a KJV-mode jump re-runs once the KJV rows render
    // (the highlight ref lives on those rows, which load separately from the ABP set).
  }, [nav?.scroll, nav?.highlight, nav?.chapter, verses, kjvVerses, bsbVerses, loading, selChapter]);
  const maxChap = nonCanon ? nonCanon.chapters : selBook ? selBook.chapters : 1;

  // Pick a non-canonical text (from the "Other" menu / nav): switch the reader to it and
  // start at chapter 1. Parallel/KJV/BSB have no meaning for a non-canonical text,
  // so any of those falls back to the Greek interlinear (ABP single view).
  const pickNonCanon = t => {
    setCorpus(t.id);
    setSelChapter(1);
    setOtherOpen(false);
    if (translation === "kjv" || translation === "bsb" || translation === "esv" || translation === "niv" || translation === "parallel") {
      setTranslation("abp");
      onTranslationChange?.("abp");
    }
  };
  // Picking a Bible book from the nav returns to the Bible text.
  const selectBook = b => {
    setSelBook(b);
    setCorpus("bible");
  };
  // ABP / KJV always select a Bible edition — and clicking either while a
  // non-canonical text is open is the quick way back to the Bible.
  const pickBible = edition => {
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
  const compareAvail = COMPARE_ORDER.filter(id => id === "esv" ? esvOwner : id === "niv" ? nivOwner : true);
  const compareActive = translation === "parallel" ? compareSel.filter(id => compareAvail.includes(id)) : COMPARE_ORDER.includes(translation) ? [translation] : ["abp"];
  const toggleCompare = id => {
    const set = compareActive.includes(id) ? compareActive.filter(x => x !== id) : [...compareActive, id];
    const ordered = COMPARE_ORDER.filter(x => set.includes(x) && compareAvail.includes(x));
    setCompareSel(ordered);
    if (ordered.length >= 2) {
      setTranslation("parallel");
      onTranslationChange?.("parallel");
    } else {
      const fb = ordered[0] || "abp";
      setTranslation(fb);
      onTranslationChange?.(fb);
    }
  };
  // Plain on/off toggle (used by the mobile sheet header + as a quick flip). Turning
  // on keeps the current compareSel if it already has 2+, else defaults to ABP|KJV.
  const toggleParallel = () => {
    if (translation === "parallel") {
      setTranslation("abp");
      onTranslationChange?.("abp");
    } else {
      setCompareSel(prev => prev.filter(id => compareAvail.includes(id)).length >= 2 ? prev : ["abp", "kjv"]);
      setTranslation("parallel");
      onTranslationChange?.("parallel");
    }
  };
  // In-text search: which text to search. Bible → the active edition (Parallel
  // searches the English/KJV column); a non-canonical reader → that text's id.
  const readCorpus = corpus === "bible" ? translation === "parallel" ? "kjv" : translation : corpus;
  // ESV has no plain-text search route (owner-only reading text), so the reader's
  // in-text find is off for it — every other text supports it.
  const canSearch = !!readCorpus && translation !== "esv" && translation !== "niv";
  const searchName = corpus === "bible" ? readCorpus.toUpperCase() : nonCanon ? nonCanon.name : "";
  const runTextSearch = () => {
    const q = searchQ.trim();
    if (!q || !readCorpus) return;
    setSearchTerm(q);
    setSearchLoading(true);
    setSearchResults(null);
    const bookFilter = corpus === "bible" && searchScope === "book" ? selBook?.abbrev || "" : "";
    api.textSearch(q, readCorpus, "phrase", bookFilter).then(d => {
      setSearchResults(d.results || []);
      setSearchLoading(false);
    }).catch(() => {
      setSearchResults([]);
      setSearchLoading(false);
    });
  };
  // Jump to a hit. Bible → the shared nav path (loads chapter, highlights +
  // scrolls). Non-canonical → same text, just switch to that chapter.
  const jumpToResult = r => {
    setSearchOpen(false);
    if (corpus === "bible") {
      onNavChange?.({
        book: r.book,
        chapter: r.chapter,
        highlight: r.verse,
        scroll: true,
        translation
      });
    } else {
      setSelChapter(r.chapter);
    }
  };
  const showStrongs = libOptions.showStrongs || false;
  const showInterlinear = libOptions.showInterlinear || false;
  const viewMode = libOptions.viewMode || "chip";
  const setOpt = (key, val) => setLibOptions(prev => ({
    ...prev,
    [key]: val
  }));

  // English-only non-canonical texts (e.g. 1 Enoch) have no Greek, so the reader is
  // locked to Prose and the Greek-only toggles (Strong's / Interlinear / Parallel /
  // Chip) are disabled and grayed out.
  const bsbMode = translation === "bsb";
  const esvMode = translation === "esv";
  const nivMode = translation === "niv";
  const hebMode = translation === "heb"; // Hebrew interlinear: always chips, no prose option
  const proseLocked = !!(nonCanon && nonCanon.englishOnly) || bsbMode || esvMode || nivMode;
  const chipMode = !proseLocked && (viewMode === "chip" || showStrongs || showInterlinear);
  const wordMode = chipMode;
  const kjvWordMode = chipMode;
  // English-only "other books" have no Greek interlinear, so the Strong's / Interlinear
  // toggles stay locked — but they CAN switch between a verse-per-line layout (the
  // "chip" slot) and flowing prose. layoutLocked = can't even pick line vs flow.
  const extraEnglish = !!(nonCanon && nonCanon.englishOnly);
  const extraLineMode = extraEnglish && viewMode === "chip";
  const layoutLocked = proseLocked && !extraEnglish;
  const viewChipOn = hebMode ? true : extraEnglish ? viewMode === "chip" : chipMode;
  const POETRY_BOOKS = new Set(["Psa", "Pro", "Job", "Son", "Lam", "Ecc"]);
  const isPoetry = POETRY_BOOKS.has(selBook?.abbrev);

  // HEB toggle: owner-gated during rollout (flip hebOwner -> hebAvail to go public),
  // OT books only (no Hebrew NT), and not while a non-canon text is open.
  const hebPickable = hebOwner && !nonCanon && !!selBook && !NT_BOOKS.has(selBook.abbrev);

  // ---- Chronological span assembly --------------------------------------
  // Pull the active text(s) for the current passage out of the loaded span,
  // trim each chapter to the passage's verse window, and tag every verse with
  // its chapter (_ch). The renderers read _ch (defaulting to selChapter), so
  // canonical reading is unchanged — _ch is simply absent there.
  const chronoReady = chronoOn && chronoData && chronoData.pos === chronoPos;
  const flattenSpan = key => {
    if (!chronoReady || !curPassage) return [];
    const {
      start_ch,
      end_ch,
      start_v,
      end_v
    } = curPassage;
    const out = [];
    for (let c = start_ch; c <= end_ch; c++) {
      const arr = chronoData.byCh[c] && chronoData.byCh[c][key] || [];
      const lo = c === start_ch ? start_v : 1;
      const hi = c === end_ch ? end_v : Infinity;
      arr.forEach(v => {
        if (v.verse >= lo && v.verse <= hi) out.push({
          ...v,
          _ch: c
        });
      });
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
    const out = [];
    let lastCh = null;
    arr.forEach(v => {
      if (v._ch != null && v._ch !== lastCh) {
        out.push(/*#__PURE__*/React.createElement("div", {
          key: `cm-${v._ch}`,
          "data-ch": v._ch,
          className: "lib-chrono-chapmark"
        }, selBook ? selBook.name : "", " ", v._ch));
        // Audio progress bar above the chapter that's currently playing.
        if (audioCapable && audioUrl && curPassage && audioKey === curPassage.book + "-" + v._ch) {
          out.push(/*#__PURE__*/React.createElement("div", {
            key: `cb-${v._ch}`,
            className: "lib-chrono-audio-bar"
          }, audioProgress));
        }
        lastCh = v._ch;
      }
      out.push(renderFn(v));
    });
    return out;
  };
  const abpShowLoading = chronoOn ? chronoLoading || !chronoReady : loading;
  const kjvShowLoading = chronoOn ? chronoLoading || !chronoReady : kjvLoading;
  const bsbShowLoading = chronoOn ? chronoLoading || !chronoReady : bsbLoading;
  const esvShowLoading = chronoOn ? chronoLoading || !chronoReady : esvLoading;
  const nivShowLoading = chronoOn ? chronoLoading || !chronoReady : nivLoading;
  // Chapter audio (BSB + ESV only). Audio is one file per WHOLE chapter. ONE play/pause
  // icon in the toolbar + a progress bar under the toolbar (desktop AND mobile, same
  // spot). The button targets the chapter you're reading: canonical = the open chapter;
  // chrono = whichever chapter is scrolled into view (viewCh). Press play and you get
  // that chapter; it auto-advances to the next when one ends.
  const audioCapable = bsbMode || esvMode;
  const audioTarget = audioCapable ? {
    book: chronoOn ? curPassage && curPassage.book : selBook && selBook.abbrev,
    ch: chronoOn ? viewCh || curPassage && curPassage.start_ch : selChapter
  } : null;
  const targetKey = audioTarget && audioTarget.book ? audioTarget.book + "-" + audioTarget.ch : null;
  const onTargetNow = !!targetKey && audioKey === targetKey; // the chapter in view IS the loaded one
  // The icon follows ONLY whether sound is playing, so scrolling never desyncs it.
  const showPause = audioPlaying;
  const onToolbarAudio = () => {
    if (!audioTarget || !audioTarget.book || !audioTarget.ch) return;
    const a = audioRef.current;
    if (a && !a.paused) {
      a.pause();
      return;
    } // playing → pause
    if (a && onTargetNow) {
      a.play().catch(() => {});
      return;
    } // paused on the chapter in view → resume
    loadAudio(audioTarget.book, audioTarget.ch); // else start / switch to the chapter in view
  };
  const onAudioEnded = () => {
    setAudioPlaying(false);
    if (!chronoOn || !curPassage || !audioKey) return; // chrono: roll into the next chapter of the passage
    const cur = parseInt(audioKey.split("-")[1], 10);
    if (cur < curPassage.end_ch) loadAudio(curPassage.book, cur + 1);
  };
  // The (invisible) audio element renders once while a chapter is loaded so it can play.
  const audioEl = audioCapable && audioUrl ? /*#__PURE__*/React.createElement("audio", {
    ref: audioRef,
    src: audioUrl,
    preload: "metadata",
    onLoadedMetadata: e => setAudioDur(e.target.duration || 0),
    onTimeUpdate: e => setAudioCur(e.target.currentTime || 0),
    onPlay: () => setAudioPlaying(true),
    onPause: () => setAudioPlaying(false),
    onEnded: onAudioEnded
  }) : null;
  const audioProgress = /*#__PURE__*/React.createElement("input", {
    className: "lib-audio-bar",
    type: "range",
    min: "0",
    max: audioDur || 0,
    step: "0.1",
    value: Math.min(audioCur, audioDur || 0),
    onChange: seekAudio,
    "aria-label": "Audio position"
  });
  // Canonical: progress bar under the toolbar. Chrono: the bar moves inline, above the
  // chapter that's playing (rendered at its divider in withMarks); here we just mount
  // the hidden player.
  const audioBar = !audioEl ? null : chronoOn ? audioEl : /*#__PURE__*/React.createElement("div", {
    className: "lib-audio-bar-row"
  }, audioProgress, audioEl);
  const audioBtn = audioCapable ? /*#__PURE__*/React.createElement("button", {
    className: "lib-toggle lib-toggle-icon" + (showPause ? " on" : ""),
    disabled: audioBusy,
    title: showPause ? "Pause audio" : "Play chapter audio",
    "aria-label": showPause ? "Pause audio" : "Play chapter audio",
    "aria-pressed": showPause,
    onClick: onToolbarAudio
  }, showPause ? /*#__PURE__*/React.createElement(Icon.Pause, null) : /*#__PURE__*/React.createElement(Icon.Play, null)) : null;
  // Chrono: track which chapter is scrolled into view (~just above mid-screen), so the
  // toolbar play button AND the chapter overview both follow the chapter you're reading.
  useEffect(() => {
    if (!chronoOn) {
      setViewCh(null);
      return;
    }
    const compute = () => {
      const root = readingRef.current;
      if (!root) return;
      const marks = root.querySelectorAll(".lib-chrono-chapmark[data-ch]");
      if (!marks.length) return;
      // Switch when a chapter heading passes ~just-above the middle of the screen
      // (not the very top), so the "current" chapter matches what you're reading.
      const threshold = (window.innerHeight || 800) * 0.45;
      let cur = parseInt(marks[0].dataset.ch, 10);
      marks.forEach(m => {
        if (m.getBoundingClientRect().top <= threshold) cur = parseInt(m.dataset.ch, 10);
      });
      setViewCh(cur);
    };
    let raf = null;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        compute();
      });
    };
    compute();
    window.addEventListener("scroll", onScroll, true); // capture: also catches a nested scroll panel
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [chronoOn, audioCapable, chronoPos, translation, chronoReady, curPassage && curPassage.start_ch]);

  // Chapter overview target — in chrono it follows the chapter scrolled into view
  // (same cutoff as the audio); otherwise the open chapter.
  const sumBook = nonCanon ? nonCanon.id : chronoOn && curPassage ? curPassage.book : selBook && selBook.abbrev;
  const sumChapter = chronoOn && curPassage ? viewCh || curPassage.start_ch : selChapter;
  const sumLabel = nonCanon ? nonCanon.name : BOOK_LABELS[sumBook] || sumBook;
  const swipeRef = React.useRef(null);
  const tapMovedRef = React.useRef(false);
  const swipeHandlers = isMobile ? {
    onTouchStart: e => {
      tapMovedRef.current = false;
      swipeRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      };
    },
    onTouchMove: e => {
      if (!swipeRef.current) return;
      const dx = e.touches[0].clientX - swipeRef.current.x;
      const dy = e.touches[0].clientY - swipeRef.current.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) tapMovedRef.current = true;
    },
    // A swipe/scroll that ends over a word must NOT open its panel — only a real tap should.
    onClickCapture: e => {
      if (tapMovedRef.current) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    onTouchEnd: e => {
      if (!swipeRef.current) return;
      // If the touch produced a text selection (note-making), don't turn the page.
      if (window.getSelection && String(window.getSelection()).trim()) {
        swipeRef.current = null;
        return;
      }
      const dx = e.changedTouches[0].clientX - swipeRef.current.x;
      const dy = e.changedTouches[0].clientY - swipeRef.current.y;
      swipeRef.current = null;
      if (Math.abs(dx) < 50) return; // too short
      if (Math.abs(dy) > Math.abs(dx) * 0.6) return; // too vertical
      if (chronoOn) {
        // chronological: swipe walks passages
        stepPassage(dx < 0 ? 1 : -1);
      } else if (dx < 0 && selChapter < maxChap) {
        const c = selChapter + 1;
        setSelChapter(c);
        if (!nonCanon) onNavChange?.({
          ...nav,
          book: selBook?.abbrev,
          chapter: c,
          highlight: null
        });
      } else if (dx > 0 && selChapter > 1) {
        const c = selChapter - 1;
        setSelChapter(c);
        if (!nonCanon) onNavChange?.({
          ...nav,
          book: selBook?.abbrev,
          chapter: c,
          highlight: null
        });
      }
    }
  } : {};

  // --- Drag-select → note ---------------------------------------------------
  // Walk up from a selection edge to the nearest tagged verse row / word span.
  const _attrUp = (node, attr) => {
    let el = node && node.nodeType === 1 ? node : node ? node.parentElement : null;
    while (el && el !== readingRef.current && !(el.getAttribute && el.hasAttribute(attr))) el = el.parentElement;
    return el && el.getAttribute ? el.getAttribute(attr) : null;
  };
  const resolveSelection = () => {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setNoteSel(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      setNoteSel(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!readingRef.current || !readingRef.current.contains(range.commonAncestorContainer)) {
      setNoteSel(null);
      return;
    }
    const aV = _attrUp(range.startContainer, "data-note-verse");
    const bV = _attrUp(range.endContainer, "data-note-verse");
    if (aV == null && bV == null) {
      setNoteSel(null);
      return;
    }
    let startV = parseInt(aV != null ? aV : bV, 10);
    let endV = parseInt(bV != null ? bV : aV, 10);
    const aP = _attrUp(range.startContainer, "data-note-pos");
    const bP = _attrUp(range.endContainer, "data-note-pos");
    let startP = aP != null ? parseInt(aP, 10) : null;
    let endP = bP != null ? parseInt(bP, 10) : null;
    if (startV > endV || startV === endV && (startP || 0) > (endP || 0)) {
      [startV, endV] = [endV, startV];
      [startP, endP] = [endP, startP];
    }
    const bookId = nonCanon ? nonCanon.id : selBook ? selBook.abbrev : null;
    const bookName = nonCanon ? nonCanon.name : selBook ? selBook.name : "";
    if (!bookId) {
      setNoteSel(null);
      return;
    }
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
      rect: {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height
      },
      anchor: {
        corpus,
        translation,
        book: bookId,
        bookName,
        chapter: selCh,
        start: {
          verse: startV,
          pos: startP
        },
        end: {
          verse: endV,
          pos: endP
        },
        snippet: snippet.slice(0, 300),
        refLabel
      }
    });
  };
  const addNoteFromSelection = () => {
    if (!noteSel) return;
    // Reuse a note already on this exact text instead of making a duplicate.
    const existing = NotesStore.findAnchor(noteSel.anchor);
    const note = existing || NotesStore.create(noteSel.anchor);
    setNoteSel(null);
    if (window.getSelection) window.getSelection().removeAllRanges(); // dismiss the OS selection toolbar
    onOpenNote && onOpenNote(note.id);
  };
  // A color swatch in the popover → make a highlight (no editor; the paint is it).
  // If this exact text already has a record, just recolor it.
  const addHighlightFromSelection = color => {
    if (!noteSel) return;
    const existing = NotesStore.findAnchor(noteSel.anchor);
    if (existing) NotesStore.update(existing.id, {
      color
    });else NotesStore.create({
      ...noteSel.anchor,
      color
    });
    setNoteSel(null);
    if (window.getSelection) window.getSelection().removeAllRanges();
  };
  // Copy the selected verse text to the clipboard (also clears the OS bar on mobile).
  const copySelection = () => {
    if (!noteSel) return;
    const txt = noteSel.anchor.snippet || "";
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(txt);
    } catch (e) {}
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
    if (!id) {
      flash("Open a journal page first");
      return;
    }
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
    const onSel = () => {
      clearTimeout(t);
      t = setTimeout(() => resolveRef.current(), 200);
    };
    document.addEventListener("selectionchange", onSel);
    return () => {
      document.removeEventListener("selectionchange", onSel);
      clearTimeout(t);
    };
  }, [isMobile]);
  // One handler set on the reading area: swipe (mobile) + selection (all).
  const readingHandlers = {
    ...swipeHandlers,
    // A fresh press starts a new interaction: drop any open popover + the suppress flag.
    onMouseDown: () => {
      if (noteSel) setNoteSel(null);
      justSelectedRef.current = false;
    },
    onMouseUp: () => resolveSelection(),
    onTouchEnd: e => {
      if (swipeHandlers.onTouchEnd) swipeHandlers.onTouchEnd(e);
      setTimeout(resolveSelection, 0); // let the browser settle the selection first
    },
    onClickCapture: e => {
      if (justSelectedRef.current) {
        justSelectedRef.current = false;
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (swipeHandlers.onClickCapture) swipeHandlers.onClickCapture(e);
    }
  };

  // Notes/highlights are looked up per chapter. Canonical reading is one chapter
  // (ch defaults to selChapter); chronological spans several, so every note helper
  // takes the verse's chapter. A small per-render cache avoids re-querying the
  // store for each verse in a chapter.
  const noteBookId = nonCanon ? nonCanon.id : selBook ? selBook.abbrev : null;
  const _chNoteCache = {};
  const chapterNotesFor = ch => {
    if (!(ch in _chNoteCache)) _chNoteCache[ch] = NotesStore.forChapter(corpus, noteBookId, ch);
    return _chNoteCache[ch];
  };
  const noteForVerse = (verse, ch = selChapter) => chapterNotesFor(ch).find(n => verse >= n.start.verse && verse <= (n.end && n.end.verse || n.start.verse));
  // Highlight paint: the color (if any) for a given word. Highlights show in
  // EVERY translation (verses always line up). In the text where the highlight
  // was made we paint the exact words; in a DIFFERENT translation we can't line
  // up word-for-word, so a partial highlight rounds up to the whole verse.
  const hiForWord = (verse, pos, ch = selChapter) => {
    for (const n of chapterNotesFor(ch)) {
      if (!n.color) continue;
      const sv = n.start.verse,
        ev = n.end && n.end.verse || sv;
      if (verse < sv || verse > ev) continue;
      const sameText = !n.translation || !translation || n.translation === translation;
      const sp = n.start.pos,
        ep = n.end ? n.end.pos : null;
      if (!sameText || sp == null || pos == null) return n.color; // whole-verse paint
      if (verse === sv && pos < sp) continue;
      if (verse === ev && ep != null && pos > ep) continue;
      return n.color;
    }
    return null;
  };
  const hiClass = (verse, pos, ch = selChapter) => {
    const c = hiForWord(verse, pos, ch);
    return c ? " lib-hi lib-hi-" + c : "";
  };
  // A record is shown with a bookmark icon only when it's a PLAIN bookmark; once it
  // carries a note or a highlight color it shows the note (pencil) icon instead.
  const isBookmarkOnly = n => !!(n && n.bookmark && !n.body && !n.color);
  const markerIcon = n => isBookmarkOnly(n) ? /*#__PURE__*/React.createElement(Icon.Bookmark, null) : /*#__PURE__*/React.createElement(Icon.Note, null);
  const markerLabel = n => isBookmarkOnly(n) ? "Open bookmark" : "Open note";
  const noteMarker = (verse, ch = selChapter) => {
    const n = noteForVerse(verse, ch);
    if (!n) return null;
    return /*#__PURE__*/React.createElement("button", {
      className: "lib-note-dot",
      title: markerLabel(n),
      "aria-label": markerLabel(n),
      onClick: e => {
        e.stopPropagation();
        onOpenNote && onOpenNote(n.id);
      }
    }, markerIcon(n));
  };
  // Inline variant (prose flow / non-canon) — same icon logic, inline placement.
  const noteDotInline = (verse, ch = selChapter) => {
    const n = noteForVerse(verse, ch);
    if (!n) return null;
    return /*#__PURE__*/React.createElement("button", {
      className: "lib-note-dot lib-note-dot-inline",
      title: markerLabel(n),
      "aria-label": markerLabel(n),
      onClick: e => {
        e.stopPropagation();
        onOpenNote && onOpenNote(n.id);
      }
    }, markerIcon(n));
  };
  // Build the whole-verse anchor (incl. a readable snippet) for a verse number.
  const verseAnchor = (verse, fromEl, ch = selChapter) => {
    const bookId = nonCanon ? nonCanon.id : selBook ? selBook.abbrev : null;
    const bookName = nonCanon ? nonCanon.name : selBook ? selBook.name : "";
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
        chips.forEach(el => {
          const eng = el.querySelector(".lib-iw-english");
          const t = (eng ? eng.textContent : el.textContent).trim();
          if (t) parts.push(t);
        });
        snippet = parts.join(" ");
      } else {
        const clone = row.cloneNode(true);
        clone.querySelectorAll(".lib-vnum, .lib-flow-vnum, .lib-note-dot").forEach(el => el.remove());
        snippet = (clone.textContent || "").trim();
      }
    }
    return {
      corpus,
      translation,
      book: bookId,
      bookName,
      chapter: ch,
      start: {
        verse,
        pos: null
      },
      end: {
        verse,
        pos: null
      },
      snippet: snippet.slice(0, 300),
      refLabel: bookName + " " + ch + ":" + verse
    };
  };
  // Right-click / long-press a verse number opens a small menu (Bookmark · Note ·
  // colors). Left-click / tap stays cross-references.
  const [verseMenu, setVerseMenu] = useState(null); // { rect, verse, el } | null
  const openVerseMenu = (verse, el, ch = selChapter) => {
    const r = el.getBoundingClientRect();
    setVerseMenu({
      rect: {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height
      },
      verse,
      el,
      ch
    });
  };
  const vmBookmark = () => {
    const a = verseAnchor(verseMenu.verse, verseMenu.el, verseMenu.ch);
    if (!a) return setVerseMenu(null);
    const ex = NotesStore.findAnchor(a);
    if (ex) NotesStore.update(ex.id, {
      bookmark: true
    });else NotesStore.create({
      ...a,
      bookmark: true
    });
    setVerseMenu(null);
  };
  const vmNote = () => {
    const a = verseAnchor(verseMenu.verse, verseMenu.el, verseMenu.ch);
    if (!a) return setVerseMenu(null);
    const ex = NotesStore.findAnchor(a);
    const note = ex || NotesStore.create(a);
    setVerseMenu(null);
    onOpenNote && onOpenNote(note.id);
  };
  const vmColor = color => {
    const a = verseAnchor(verseMenu.verse, verseMenu.el, verseMenu.ch);
    if (!a) return setVerseMenu(null);
    const ex = NotesStore.findAnchor(a);
    if (ex) NotesStore.update(ex.id, {
      color
    });else NotesStore.create({
      ...a,
      color
    });
    setVerseMenu(null);
  };
  // Copy the whole verse text to the clipboard.
  const vmCopy = () => {
    const a = verseAnchor(verseMenu.verse, verseMenu.el, verseMenu.ch);
    if (!a) return setVerseMenu(null);
    setVerseMenu(null);
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(a.snippet || "");
    } catch (e) {}
    flash("Copied");
  };
  // Send the whole verse to the journal page currently open in the Notes tab.
  const vmJournal = () => {
    const a = verseAnchor(verseMenu.verse, verseMenu.el, verseMenu.ch);
    if (!a) return setVerseMenu(null);
    setVerseMenu(null);
    const id = NotesStore.getActiveJournal();
    if (!id) {
      flash("Open a journal page first");
      return;
    }
    NotesStore.appendToJournal(id, journalLine(a));
    flash("Added to journal");
  };
  // Shared press handlers for a verse number: right-click + mobile long-press.
  const vnumPressRef = useRef({
    timer: null,
    fired: false
  });
  const vnumNoteHandlers = (verse, ch = selChapter) => ({
    onContextMenu: e => {
      e.preventDefault();
      openVerseMenu(verse, e.currentTarget, ch);
    },
    onTouchStart: e => {
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
    onTouchEnd: () => clearTimeout(vnumPressRef.current.timer)
  });
  const changeFontSize = delta => {
    setLibFontSize(prev => {
      const next = Math.min(24, Math.max(13, prev + delta));
      localStorage.setItem("libFontSize", String(next));
      return next;
    });
  };
  const handleVerseNum = onVerseNumberClick && selBook ? (verse, ch = selChapter) => onVerseNumberClick(selBook.abbrev, ch, verse, translation) : null;
  const vnumEl = (verse, ch = selChapter) => /*#__PURE__*/React.createElement("span", _extends({
    className: "lib-vnum" + (handleVerseNum ? " lib-vnum-click" : ""),
    title: handleVerseNum ? "Click: cross-references · Right-click / long-press: add a note" : undefined,
    onClick: handleVerseNum ? () => {
      if (vnumPressRef.current.fired) {
        vnumPressRef.current.fired = false;
        return;
      }
      handleVerseNum(verse, ch);
    } : undefined
  }, vnumNoteHandlers(verse, ch)), verse);

  // Verse number for non-canonical texts: opens the note menu on right-click /
  // long-press, but no cross-references (those texts have none). Left-click is a no-op
  // (just swallows the click that follows a long-press).
  const noteVnum = (verse, cls = "lib-vnum") => /*#__PURE__*/React.createElement("span", _extends({
    className: cls + " lib-vnum-click",
    title: "Right-click / long-press: add a note",
    onClick: () => {
      if (vnumPressRef.current.fired) vnumPressRef.current.fired = false;
    }
  }, vnumNoteHandlers(verse)), verse);
  const joinProse = words => {
    const tokens = words.map(w => w.english).filter(Boolean);
    return tokens.reduce((acc, tok, i) => {
      if (i === 0) return tok;
      return /^[.,;:?!—)]/.test(tok) ? acc + tok : acc + " " + tok;
    }, "");
  };
  const renderProseWords = v => {
    const ch = v._ch ?? selChapter;
    const englishWords = getEnglishOrderWords(v.words);
    return englishWords.map((w, i) => {
      const text = w.english || "";
      if (!text) return null;
      const hc = hiClass(v.verse, w.position, ch); // highlight paint for this word
      const isPunct = /^[.,;:?!—)]/.test(text);
      if (isPunct) return /*#__PURE__*/React.createElement("span", {
        key: i,
        "data-note-pos": w.position,
        className: hc || undefined
      }, text);
      if (text.includes(' ')) {
        if (w.italic_words) {
          const iset = new Set(w.italic_words.split(','));
          return /*#__PURE__*/React.createElement("span", {
            key: i,
            "data-note-pos": w.position,
            className: hc || undefined
          }, text.split(' ').filter(Boolean).map((word, pi) => {
            const bare = word.replace(/[^\w]/g, '').toLowerCase();
            return /*#__PURE__*/React.createElement("span", {
              key: pi,
              className: iset.has(bare) ? "lib-prose-italic" : undefined
            }, word, " ");
          }));
        }
        if (w.italic) {
          const headBare = w.english_head ? w.english_head.replace(/[^\w]/g, '').toLowerCase() : null;
          return /*#__PURE__*/React.createElement("span", {
            key: i,
            "data-note-pos": w.position,
            className: hc || undefined
          }, text.split(' ').filter(Boolean).map((word, pi) => {
            const bare = word.replace(/[^\w]/g, '').toLowerCase();
            const isItalic = !headBare || bare === headBare;
            return /*#__PURE__*/React.createElement("span", {
              key: pi,
              className: isItalic ? "lib-prose-italic" : undefined
            }, word, " ");
          }));
        }
        return /*#__PURE__*/React.createElement("span", {
          key: i,
          "data-note-pos": w.position,
          className: hc || undefined
        }, text + " ");
      }
      return /*#__PURE__*/React.createElement("span", {
        key: i,
        "data-note-pos": w.position,
        className: (!!w.italic ? "lib-prose-italic" : "") + hc
      }, text + " ");
    });
  };

  // Hebrew OT interlinear verse — right-to-left chips (Hebrew over gloss over H-number).
  // Its own simple renderer (morphhb is one word = one chip; none of the ABP bracket /
  // italic / proper-noun machinery applies). Word-click hands a Hebrew entry (strongs
  // "H####") to the detail panel, which already routes H-numbers to the BDB sidebar.
  const renderHebVerse = v => {
    const ch = selChapter;
    const isHighlight = nav && nav.highlight === v.verse && (nav.chapter == null || nav.chapter === ch);
    const hebEntry = w => ({
      id: `heb-${selBook.abbrev}-${ch}-${v.verse}-${w.pos}`,
      strongs: w.strongs,
      // "H7307" -> isHebrewWord -> BDB fetch
      strongs_base: w.strongs,
      strongs_raw: (w.strongs || "").replace(/^H/, ""),
      greek: "",
      translit: w.translit || "",
      gloss: w.gloss || "",
      hebrew: w.hebrew,
      morph: w.morph || "",
      grammar: w.grammar || "",
      ref: `${selBook.abbrev} ${ch}:${v.verse}`,
      book: selBook.abbrev,
      chapter: ch,
      verse: v.verse,
      is_pn: false
    });
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: `heb-${ch}-${v.verse}`
    }, v.heading && /*#__PURE__*/React.createElement("div", {
      className: "lib-verse-row pericope-row"
    }, /*#__PURE__*/React.createElement("span", {
      className: "lib-vnum",
      "aria-hidden": "true"
    }), /*#__PURE__*/React.createElement("div", {
      className: "pericope-heading"
    }, v.heading)), /*#__PURE__*/React.createElement("div", {
      ref: isHighlight ? highlightRef : null,
      "data-note-verse": v.verse,
      "data-note-chapter": ch,
      className: "lib-verse-row lib-heb-row" + (isHighlight ? " lib-highlight" : "")
    }, vnumEl(v.verse, ch), /*#__PURE__*/React.createElement("span", {
      className: "lib-verse-content lib-heb-content"
    }, noteMarker(v.verse, ch), (v.words || []).map(w => {
      const clickable = !!(onWordClick && w.strongs);
      return /*#__PURE__*/React.createElement("span", {
        key: w.pos,
        "data-note-pos": w.pos,
        className: "lib-word lib-heb-word" + (clickable ? " lib-word-clickable" : "") + hiClass(v.verse, w.pos, ch),
        onClick: clickable ? () => onWordClick(hebEntry(w)) : undefined
      }, /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-heb"
      }, w.hebrew), showInterlinear && w.translit && /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-translit"
      }, w.translit), /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-english"
      }, w.gloss), showStrongs && (w.strongs ? /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-strongs"
      }, w.strongs) : /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-strongs",
        style: {
          visibility: "hidden"
        }
      }, "H0")), showInterlinear && w.grammar && /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-gram"
      }, w.grammar));
    }))));
  };
  const renderVerse = (v, skipHeading = false) => {
    const ch = v._ch ?? selChapter; // chronological rides the chapter on the verse
    const isHighlight = nav && nav.highlight === v.verse && (nav.chapter == null || nav.chapter === ch);
    const makeEntry = w => ({
      id: `lib-${selBook.abbrev}-${ch}-${v.verse}-${w.position}`,
      ...wordEntryCore(w, {
        ref: `${selBook.abbrev} ${ch}:${v.verse}`,
        book: selBook.abbrev,
        chapter: ch,
        verse: v.verse,
        gloss: w.english
      }),
      morph: w.morph || "",
      pn_type: w.pn_type || null,
      pn_types: w.pn_types || null
    });
    const chipLabel = w => {
      return w.english_head && w.english?.includes(' ') ? w.english_head : w.english || w.english_head || "";
    };

    // Plain chip (English mode or non-bracketed word in Greek mode)
    const chip = (w, key) => {
      const isPN = !!(w.is_pn || w.strongs_base === "*");
      const clickable = !!(onWordClick && w.strongs_base && (w.strongs_base !== "*" || w.english || w.english_head) && (w.english || w.english_head));

      // Split multi-word gloss: mute italic sub-words, style smcap sub-words, chip the rest
      if (w.italic_words && w.english && w.english.includes(' ')) {
        const italicSet = new Set(w.italic_words.split(','));
        const smcapSet = w.smcap_words ? new Set(w.smcap_words.split(',')) : new Set();
        const parts = w.english.split(' ');
        const hc = hiClass(v.verse, w.position, ch);
        return /*#__PURE__*/React.createElement(React.Fragment, {
          key: key
        }, (() => {
          const anchorIdx = strongsAnchorIndex(parts, italicSet, w);
          return parts.map((word, pi) => {
            const bare = word.replace(/[^\w]/g, '').toLowerCase();
            if (italicSet.has(bare)) {
              return /*#__PURE__*/React.createElement("span", {
                key: `${key}-p${pi}`,
                className: "lib-word lib-abp-italic" + (smcapSet.has(bare) ? " lib-smcap" : "") + hc
              }, showInterlinear && /*#__PURE__*/React.createElement("span", {
                className: "lib-iw-greek",
                style: {
                  visibility: "hidden"
                }
              }, "x"), /*#__PURE__*/React.createElement("span", {
                className: "lib-iw-english"
              }, word), showStrongs && /*#__PURE__*/React.createElement("span", {
                className: "lib-iw-strongs",
                style: {
                  visibility: "hidden"
                }
              }, "G0"));
            }
            const isSmcap = smcapSet.has(bare);
            return /*#__PURE__*/React.createElement("span", {
              key: `${key}-p${pi}`,
              className: "lib-word" + (isSmcap ? " lib-smcap" : "") + (clickable ? " lib-word-clickable" : "") + (isPN ? " lib-word-pn" : "") + hc,
              onClick: clickable ? () => onWordClick(isPN ? {
                ...makeEntry(w),
                isPN: true,
                pnName: w.english || w.english_head
              } : makeEntry(w)) : undefined
            }, showInterlinear && (pi === anchorIdx && w.lemma ? /*#__PURE__*/React.createElement("span", {
              className: "lib-iw-greek"
            }, w.lemma) : /*#__PURE__*/React.createElement("span", {
              className: "lib-iw-greek",
              style: {
                visibility: "hidden"
              }
            }, "x")), /*#__PURE__*/React.createElement("span", {
              className: "lib-iw-english"
            }, word), showStrongs && (pi === anchorIdx && w.strongs_base && w.strongs_base !== "*" ? /*#__PURE__*/React.createElement("span", {
              className: "lib-iw-strongs"
            }, w.strongs && w.strongs !== '*' ? 'G' + w.strongs : w.strongs_base) : /*#__PURE__*/React.createElement("span", {
              className: "lib-iw-strongs",
              style: {
                visibility: "hidden"
              }
            }, "G0")));
          });
        })());
      }
      const rawLabel = w.english || chipLabel(w);
      if (!rawLabel) return null;
      const label = isPN && rawLabel && !rawLabel.includes(' ') ? rawLabel[0].toUpperCase() + rawLabel.slice(1) : rawLabel;
      const isSmcap = w.smcap_words ? new Set(w.smcap_words.split(',')).has(label.replace(/[^\w]/g, '').toLowerCase()) : false;
      return /*#__PURE__*/React.createElement("span", {
        key: key,
        "data-note-pos": w.position,
        className: "lib-word" + (w.italic ? " lib-abp-italic" : "") + (isSmcap ? " lib-smcap" : "") + (clickable ? " lib-word-clickable" : "") + (isPN ? " lib-word-pn" : "") + hiClass(v.verse, w.position, ch),
        onClick: clickable ? () => onWordClick(isPN ? {
          ...makeEntry(w),
          isPN: true,
          pnName: label,
          gloss: label
        } : makeEntry(w)) : undefined
      }, showInterlinear && (w.lemma ? /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-greek"
      }, w.lemma) : /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-greek",
        style: {
          visibility: "hidden"
        }
      }, "x")), /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-english"
      }, label), showStrongs && (w.strongs_base && w.strongs_base !== "*" ? /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-strongs"
      }, w.strongs && w.strongs !== '*' ? 'G' + w.strongs : w.strongs_base) : /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-strongs",
        style: {
          visibility: "hidden"
        }
      }, "G0")));
    };

    // Bracket chip (bracketed word in Greek mode — shows inline position number)
    const bracketChip = (w, key) => {
      const isPN = !!(w.is_pn || w.strongs_base === "*");
      const clickable = !!(onWordClick && w.strongs_base && (w.strongs_base !== "*" || w.english));

      // Split multi-word gloss within a bracket word
      if (w.italic_words && w.english && w.english.includes(' ')) {
        const italicSet = new Set(w.italic_words.split(','));
        const smcapSet = w.smcap_words ? new Set(w.smcap_words.split(',')) : new Set();
        const parts = w.english.split(' ');
        const anchorIdx = strongsAnchorIndex(parts, italicSet, w);
        const hc = hiClass(v.verse, w.position, ch);
        return /*#__PURE__*/React.createElement(React.Fragment, {
          key: key
        }, parts.map((word, pi) => {
          const bare = word.replace(/[^\w]/g, '').toLowerCase();
          if (italicSet.has(bare)) {
            return /*#__PURE__*/React.createElement("span", {
              key: `${key}-p${pi}`,
              className: "lib-word lib-word-bracketed lib-abp-italic" + (smcapSet.has(bare) ? " lib-smcap" : "") + hc
            }, showInterlinear && /*#__PURE__*/React.createElement("span", {
              className: "lib-iw-greek",
              style: {
                visibility: "hidden"
              }
            }, "x"), /*#__PURE__*/React.createElement("span", {
              className: "lib-iw-pos-english"
            }, pi === 0 && w.greek_pos !== null && w.greek_pos !== undefined && /*#__PURE__*/React.createElement("span", {
              className: "lib-iw-pos"
            }, w.greek_pos), /*#__PURE__*/React.createElement("span", {
              className: "lib-iw-english"
            }, word)), showStrongs && /*#__PURE__*/React.createElement("span", {
              className: "lib-iw-strongs",
              style: {
                visibility: "hidden"
              }
            }, "G0"));
          }
          const isSmcap = smcapSet.has(bare);
          return /*#__PURE__*/React.createElement("span", {
            key: `${key}-p${pi}`,
            className: "lib-word lib-word-bracketed" + (isSmcap ? " lib-smcap" : "") + (clickable ? " lib-word-clickable" : "") + (isPN ? " lib-word-pn" : "") + hc,
            onClick: clickable ? () => onWordClick(isPN ? {
              ...makeEntry(w),
              isPN: true,
              pnName: w.english || w.english_head
            } : makeEntry(w)) : undefined
          }, showInterlinear && (pi === anchorIdx && w.lemma ? /*#__PURE__*/React.createElement("span", {
            className: "lib-iw-greek"
          }, w.lemma) : /*#__PURE__*/React.createElement("span", {
            className: "lib-iw-greek",
            style: {
              visibility: "hidden"
            }
          }, "x")), /*#__PURE__*/React.createElement("span", {
            className: "lib-iw-pos-english"
          }, pi === 0 && w.greek_pos !== null && w.greek_pos !== undefined && /*#__PURE__*/React.createElement("span", {
            className: "lib-iw-pos"
          }, w.greek_pos), /*#__PURE__*/React.createElement("span", {
            className: "lib-iw-english"
          }, word)), showStrongs && (pi === anchorIdx && w.strongs_base && w.strongs_base !== "*" ? /*#__PURE__*/React.createElement("span", {
            className: "lib-iw-strongs"
          }, w.strongs && w.strongs !== '*' ? 'G' + w.strongs : w.strongs_base) : /*#__PURE__*/React.createElement("span", {
            className: "lib-iw-strongs",
            style: {
              visibility: "hidden"
            }
          }, "G0")));
        }));
      }
      const rawLabel = w.english || chipLabel(w);
      if (!rawLabel) return null;
      const label = isPN && rawLabel && !rawLabel.includes(' ') ? rawLabel[0].toUpperCase() + rawLabel.slice(1) : rawLabel;
      const isSmcap = w.smcap_words ? new Set(w.smcap_words.split(',')).has(label.replace(/[^\w]/g, '').toLowerCase()) : false;
      return /*#__PURE__*/React.createElement("span", {
        key: key,
        "data-note-pos": w.position,
        className: "lib-word lib-word-bracketed" + (w.italic ? " lib-abp-italic" : "") + (isSmcap ? " lib-smcap" : "") + (clickable ? " lib-word-clickable" : "") + (isPN ? " lib-word-pn" : "") + hiClass(v.verse, w.position, ch),
        onClick: clickable ? () => onWordClick(isPN ? {
          ...makeEntry(w),
          isPN: true,
          pnName: label,
          gloss: label
        } : makeEntry(w)) : undefined
      }, showInterlinear && (w.lemma ? /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-greek"
      }, w.lemma) : /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-greek",
        style: {
          visibility: "hidden"
        }
      }, "x")), /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-pos-english"
      }, w.greek_pos !== null && w.greek_pos !== undefined && /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-pos"
      }, w.greek_pos), /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-english"
      }, label)), showStrongs && (w.strongs_base && w.strongs_base !== "*" ? /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-strongs"
      }, w.strongs && w.strongs !== '*' ? 'G' + w.strongs : w.strongs_base) : /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-strongs",
        style: {
          visibility: "hidden"
        }
      }, "G0")));
    };
    if (!wordMode) {
      return /*#__PURE__*/React.createElement(React.Fragment, {
        key: `${ch}-${v.verse}`
      }, !skipHeading && v.heading && /*#__PURE__*/React.createElement("div", {
        className: "lib-verse-row pericope-row"
      }, /*#__PURE__*/React.createElement("span", {
        className: "lib-vnum",
        "aria-hidden": "true"
      }), /*#__PURE__*/React.createElement("div", {
        className: "pericope-heading"
      }, v.heading)), /*#__PURE__*/React.createElement("div", {
        ref: isHighlight ? highlightRef : null,
        "data-note-verse": v.verse,
        "data-note-chapter": ch,
        className: "lib-verse-row" + (isHighlight ? " lib-highlight" : "")
      }, vnumEl(v.verse, ch), /*#__PURE__*/React.createElement("span", {
        className: "lib-verse-content"
      }, noteMarker(v.verse, ch), renderProseWords(v))));
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
        const gw = g.words.map(w => {
          if (w.greek_pos != null && w.greek_pos === lastGp) return {
            ...w,
            greek_pos: null
          };
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
          const lastEng = gw[li] && gw[li].english || "";
          const m = lastEng.match(TRAIL);
          if (m) {
            bracketTrail = m[0];
            gwR = gw.map((w, i) => i === li ? {
              ...w,
              english: lastEng.slice(0, m.index)
            } : w);
          }
        }
        const trailChar = (txt, k) => /*#__PURE__*/React.createElement("span", {
          key: k,
          className: "lib-bracket-trail"
        }, showInterlinear && /*#__PURE__*/React.createElement("span", {
          className: "lib-iw-greek",
          style: {
            visibility: "hidden"
          }
        }, "x"), /*#__PURE__*/React.createElement("span", {
          className: "lib-iw-english"
        }, txt), showStrongs && /*#__PURE__*/React.createElement("span", {
          className: "lib-iw-strongs",
          style: {
            visibility: "hidden"
          }
        }, "G0"));
        const bracketChar = (ch, k) => /*#__PURE__*/React.createElement("span", {
          key: k,
          className: "lib-bracket"
        }, showInterlinear && /*#__PURE__*/React.createElement("span", {
          className: "lib-iw-greek",
          style: {
            visibility: "hidden"
          }
        }, "x"), /*#__PURE__*/React.createElement("span", {
          className: "lib-bracket-glyph"
        }, ch), showStrongs && /*#__PURE__*/React.createElement("span", {
          className: "lib-iw-strongs",
          style: {
            visibility: "hidden"
          }
        }, "G0"));
        return /*#__PURE__*/React.createElement("span", {
          key: `bg${gi}`,
          className: "lib-bracket-group"
        }, gwR.length === 1 ? /*#__PURE__*/React.createElement("span", {
          className: "lib-bracket-unit"
        }, bracketChar("[", "bl"), bracketChip(gwR[0], `bg${gi}w0`), bracketChar("]", "br"), bracketTrail && trailChar(bracketTrail, "bt")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
          className: "lib-bracket-unit"
        }, bracketChar("[", "bl"), bracketChip(gwR[0], `bg${gi}w0`)), gwR.slice(1, -1).map((w, wi) => bracketChip(w, `bg${gi}w${wi + 1}`)), /*#__PURE__*/React.createElement("span", {
          className: "lib-bracket-unit"
        }, bracketChip(gwR[gwR.length - 1], `bg${gi}w${gwR.length - 1}`), bracketChar("]", "br"), bracketTrail && trailChar(bracketTrail, "bt"))));
      });
    }
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: `${ch}-${v.verse}`
    }, !skipHeading && v.heading && /*#__PURE__*/React.createElement("div", {
      className: "lib-verse-row pericope-row"
    }, /*#__PURE__*/React.createElement("span", {
      className: "lib-vnum",
      "aria-hidden": "true"
    }), /*#__PURE__*/React.createElement("div", {
      className: "pericope-heading"
    }, v.heading)), /*#__PURE__*/React.createElement("div", {
      ref: isHighlight ? highlightRef : null,
      "data-note-verse": v.verse,
      "data-note-chapter": ch,
      className: "lib-verse-row" + (isHighlight ? " lib-highlight" : "")
    }, vnumEl(v.verse, ch), /*#__PURE__*/React.createElement("span", {
      className: "lib-verse-content lib-verse-chips"
    }, noteMarker(v.verse, ch), content)));
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
      definition: "",
      derivation: "",
      is_function: false,
      isKjv: true,
      isHebrew: sid ? sid.startsWith("H") : false
    });
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: `${ch}-${v.verse}`
    }, !skipHeading && v.heading && /*#__PURE__*/React.createElement("div", {
      className: "lib-verse-row pericope-row"
    }, /*#__PURE__*/React.createElement("span", {
      className: "lib-vnum",
      "aria-hidden": "true"
    }), /*#__PURE__*/React.createElement("div", {
      className: "pericope-heading"
    }, v.heading)), /*#__PURE__*/React.createElement("div", {
      ref: isHighlight ? highlightRef : null,
      "data-note-verse": v.verse,
      "data-note-chapter": ch,
      className: "lib-verse-row" + (isHighlight ? " lib-highlight" : "")
    }, showVerseNum && vnumEl(v.verse, ch), /*#__PURE__*/React.createElement("span", {
      className: "lib-verse-content lib-verse-chips"
    }, showVerseNum && noteMarker(v.verse, ch), v.words.map((w, i) => {
      const sid = w.strongs_ids && w.strongs_ids.length ? w.strongs_ids[0] : null;
      const clickable = !!(onWordClick && sid);
      const isHebrew = sid ? sid.startsWith("H") : false;
      return /*#__PURE__*/React.createElement("span", {
        key: i,
        className: "lib-word lib-kjv-word" + (w.italic ? " lib-kjv-italic" : "") + (clickable ? " lib-word-clickable" : "") + hiClass(v.verse, null, ch),
        onClick: clickable ? () => onWordClick(makeKjvEntry(w, sid)) : undefined
      }, showInterlinear && (w.lemma ? /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-greek",
        dir: isHebrew ? "rtl" : undefined,
        style: isHebrew ? {
          fontFamily: "var(--f-serif)"
        } : undefined
      }, w.lemma) : /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-greek",
        style: {
          visibility: "hidden"
        }
      }, "x")), /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-english"
      }, w.word, w.punc || ""), showStrongs && (sid ? /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-strongs"
      }, sid) : /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-strongs",
        style: {
          visibility: "hidden"
        }
      }, "G0")));
    }))));
  };
  const renderKjvProse = (v, showVerseNum = true, skipHeading = false) => {
    const ch = v._ch ?? selChapter;
    const isHighlight = nav && nav.highlight === v.verse && (nav.chapter == null || nav.chapter === ch);
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: `${ch}-${v.verse}`
    }, !skipHeading && v.heading && /*#__PURE__*/React.createElement("div", {
      className: "lib-verse-row pericope-row"
    }, /*#__PURE__*/React.createElement("span", {
      className: "lib-vnum",
      "aria-hidden": "true"
    }), /*#__PURE__*/React.createElement("div", {
      className: "pericope-heading"
    }, v.heading)), /*#__PURE__*/React.createElement("div", {
      ref: isHighlight ? highlightRef : null,
      "data-note-verse": v.verse,
      "data-note-chapter": ch,
      className: "lib-verse-row" + (isHighlight ? " lib-highlight" : "")
    }, showVerseNum && vnumEl(v.verse, ch), /*#__PURE__*/React.createElement("span", {
      className: "lib-verse-content"
    }, showVerseNum && noteMarker(v.verse, ch), v.words.map((w, i) => /*#__PURE__*/React.createElement("span", {
      key: i,
      className: (w.italic ? "lib-prose-italic" : "") + hiClass(v.verse, null, ch)
    }, w.word, w.punc || "", " ")))));
  };

  // KJV / BSB / ESV read as continuous prose (paragraphs), the same flow ABP prose
  // uses — NOT one block per verse. Each verse is an inline run with a superscript
  // number; `inner` is that verse's text/words.
  const renderFlowVerse = (v, inner) => {
    const ch = v._ch ?? selChapter;
    const isHighlight = nav && nav.highlight === v.verse && (nav.chapter == null || nav.chapter === ch);
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: `${ch}-${v.verse}`
    }, v.heading && /*#__PURE__*/React.createElement("div", {
      className: "pericope-heading"
    }, v.heading), /*#__PURE__*/React.createElement("span", {
      ref: isHighlight ? highlightRef : null,
      className: "lib-flow-verse",
      "data-note-verse": v.verse,
      "data-note-chapter": ch
    }, /*#__PURE__*/React.createElement("sup", _extends({
      className: "lib-flow-vnum",
      title: handleVerseNum ? "Click: cross-references · Right-click / long-press: add a note" : undefined,
      onClick: handleVerseNum ? () => {
        if (vnumPressRef.current.fired) {
          vnumPressRef.current.fired = false;
          return;
        }
        handleVerseNum(v.verse, ch);
      } : undefined
    }, vnumNoteHandlers(v.verse, ch)), v.verse), noteDotInline(v.verse, ch), inner));
  };
  // Plain-text verse (BSB + ESV).
  const plainFlowInner = v => {
    const ch = v._ch ?? selChapter;
    return /*#__PURE__*/React.createElement("span", {
      className: "lib-bsb-text" + hiClass(v.verse, null, ch)
    }, v.verse_text, " ");
  };
  // KJV word list (keeps italic-addition styling), run together as prose.
  const kjvFlowInner = v => {
    const ch = v._ch ?? selChapter;
    return v.words.map((w, i) => /*#__PURE__*/React.createElement("span", {
      key: i,
      className: (w.italic ? "lib-prose-italic" : "") + hiClass(v.verse, null, ch)
    }, w.word, w.punc || "", " "));
  };

  // Non-canonical reader (Didache, etc.). The Greek interlinear is the normal reading,
  // exactly like Bible ABP. The readable English appears ONLY in Parallel — same
  // two-column layout as Bible parallel (Greek interlinear | English). No bracket /
  // ordering machinery; chips stay in natural Greek order. Word click → word-study.
  let _didCapNext = true; // reset per verse below; capitalize sentence-initial glosses
  const didChips = v => {
    _didCapNext = true;
    return v.words.map((w, i) => {
      const raw = w.english || "";
      if (!raw) return null;
      const label = _didCapNext ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw;
      _didCapNext = /[.!?][")'\]]*$/.test(raw); // next gloss starts a new sentence?
      const clickable = !!(onWordClick && w.strongs_base);
      const entry = {
        id: `extra-${corpus}-${selChapter}-${v.verse}-${w.position}`,
        strongs: w.strongs ? strongsTag(w.strongs) : "",
        strongs_base: w.strongs_base || "",
        strongs_raw: w.strongs || "",
        greek: w.lemma || w.greek || "",
        translit: w.translit || "",
        morph: "",
        gloss: label,
        english_head: label,
        // hero shows the gloss even when it's a short phrase
        ref: `${nonCanon ? nonCanon.name : "Extra"} ${selChapter}:${v.verse}`,
        book: corpus,
        chapter: selChapter,
        verse: v.verse,
        definition: "",
        derivation: "",
        is_function: false,
        is_pn: false,
        pn_type: null,
        pn_types: null,
        isExtra: true,
        extraBook: corpus,
        extraBookName: nonCanon ? nonCanon.name : ""
      };
      return /*#__PURE__*/React.createElement("span", {
        key: `d${i}`,
        className: "lib-word" + (clickable ? " lib-word-clickable" : "") + hiClass(v.verse, null),
        onClick: clickable ? () => onWordClick(entry) : undefined
      }, showInterlinear && (w.lemma ? /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-greek"
      }, w.lemma) : /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-greek",
        style: {
          visibility: "hidden"
        }
      }, "x")), /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-english"
      }, label), showStrongs && (w.strongs ? /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-strongs"
      }, "G" + w.strongs) : /*#__PURE__*/React.createElement("span", {
        className: "lib-iw-strongs",
        style: {
          visibility: "hidden"
        }
      }, "G0")));
    });
  };

  // Single view: Greek interlinear only (mirrors Bible ABP).
  const renderDidacheVerse = v => /*#__PURE__*/React.createElement(React.Fragment, {
    key: v.verse
  }, v.heading && /*#__PURE__*/React.createElement("div", {
    className: "lib-verse-row pericope-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lib-vnum",
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("div", {
    className: "pericope-heading"
  }, v.heading)), /*#__PURE__*/React.createElement("div", {
    className: "lib-verse-row lib-did-row",
    "data-note-verse": v.verse
  }, noteVnum(v.verse), /*#__PURE__*/React.createElement("span", {
    className: "lib-verse-content lib-verse-chips"
  }, noteMarker(v.verse), didChips(v))));

  // Prose view: our readable English as flowing text with verse numbers.
  const renderDidacheProse = () => /*#__PURE__*/React.createElement("div", {
    className: "lib-text-words lib-prose-flow"
  }, didVerses.map(v => /*#__PURE__*/React.createElement(React.Fragment, {
    key: v.verse
  }, v.heading && /*#__PURE__*/React.createElement("div", {
    className: "pericope-heading"
  }, v.heading), /*#__PURE__*/React.createElement("span", {
    className: "lib-flow-verse",
    "data-note-verse": v.verse
  }, /*#__PURE__*/React.createElement("sup", _extends({
    className: "lib-flow-vnum",
    title: "Right-click / long-press: add a note",
    onClick: () => {
      if (vnumPressRef.current.fired) vnumPressRef.current.fired = false;
    }
  }, vnumNoteHandlers(v.verse)), v.verse), noteDotInline(v.verse), /*#__PURE__*/React.createElement("span", {
    className: hiClass(v.verse, null) || undefined
  }, (v.english || "") + " ")))));

  // Verse-per-line view for English-only "other books": each verse on its own row
  // with its number, like the Bible's verse layout — but plain reading text, no
  // clickable word chips (these texts have no Greek interlinear). Notes + highlights
  // ride the whole verse, same as the flowing-prose view.
  const renderExtraLines = () => /*#__PURE__*/React.createElement("div", {
    className: "lib-text-words"
  }, didVerses.map(v => /*#__PURE__*/React.createElement(React.Fragment, {
    key: v.verse
  }, v.heading && /*#__PURE__*/React.createElement("div", {
    className: "lib-verse-row pericope-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lib-vnum",
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("div", {
    className: "pericope-heading"
  }, v.heading)), /*#__PURE__*/React.createElement("div", {
    className: "lib-verse-row",
    "data-note-verse": v.verse
  }, noteVnum(v.verse), /*#__PURE__*/React.createElement("span", {
    className: "lib-verse-content"
  }, noteMarker(v.verse), /*#__PURE__*/React.createElement("span", {
    className: hiClass(v.verse, null) || undefined
  }, v.english || ""))))));

  // Parallel view: Greek interlinear | readable English (same shape as Bible parallel).
  const renderDidacheParallelVerse = v => /*#__PURE__*/React.createElement(React.Fragment, {
    key: v.verse
  }, v.heading && /*#__PURE__*/React.createElement("div", {
    className: "lib-parallel-section-heading"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pericope-heading"
  }, v.heading)), /*#__PURE__*/React.createElement("div", {
    className: "lib-parallel-verse",
    "data-note-verse": v.verse
  }, /*#__PURE__*/React.createElement("div", {
    className: "lib-parallel-vnum"
  }, noteVnum(v.verse), noteMarker(v.verse)), /*#__PURE__*/React.createElement("div", {
    className: "lib-parallel-col"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lib-verse-chips"
  }, didChips(v))), /*#__PURE__*/React.createElement("div", {
    className: "lib-parallel-col"
  }, /*#__PURE__*/React.createElement("p", {
    className: "lib-did-eng" + hiClass(v.verse, null)
  }, v.english))));
  return /*#__PURE__*/React.createElement("div", {
    className: "library"
  }, navVisible && /*#__PURE__*/React.createElement(LibNavPanel, {
    books: books,
    selBook: selBook,
    setSelBook: selectBook,
    selChapter: selChapter,
    setSelChapter: setSelChapter,
    navBookRef: navBookRef,
    nonCanon: nonCanon,
    nonCanonList: NONCANON,
    onPickNonCanon: pickNonCanon,
    translation: translation,
    corpus: corpus,
    pickBible: pickBible,
    esvOwner: esvOwner,
    nivOwner: nivOwner,
    hebPickable: hebPickable,
    otherOpen: otherOpen,
    setOtherOpen: setOtherOpen,
    chrono: chrono,
    orderMode: orderMode,
    setOrder: setOrder,
    chronoPos: chronoPos,
    onPickPassage: pickPassage
  }), !navVisible && mobileNavOpen && /*#__PURE__*/React.createElement(MobileBookPicker, {
    books: books,
    selBook: selBook,
    selChapter: selChapter,
    nonCanon: nonCanon,
    nonCanonList: NONCANON,
    chronoOn: chronoOn,
    chrono: chrono,
    chronoPos: chronoPos,
    onPickPassage: p => {
      pickPassage(p);
      setMobileNavOpen(false);
    },
    onDone: (b, n) => {
      if (b.id) pickNonCanon(b);else selectBook(b);
      setSelChapter(n);
      setMobileNavOpen(false);
    },
    onClose: () => setMobileNavOpen(false)
  }), !navVisible && modesOpen && /*#__PURE__*/React.createElement(ModesSheet, {
    corpus: corpus,
    translation: translation,
    pickBible: pickBible,
    esvOwner: esvOwner,
    nivOwner: nivOwner,
    hebPickable: hebPickable,
    toggleParallel: toggleParallel,
    compareAvail: compareAvail,
    compareActive: compareActive,
    toggleCompare: toggleCompare,
    nonCanonList: NONCANON,
    showStrongs: showStrongs,
    showInterlinear: showInterlinear,
    setOpt: setOpt,
    chipMode: chipMode,
    viewMode: viewMode,
    libFontSize: libFontSize,
    changeFontSize: changeFontSize,
    chrono: chrono,
    orderMode: orderMode,
    setOrder: setOrder,
    onClose: () => setModesOpen(false)
  }), /*#__PURE__*/React.createElement("div", null, navVisible ? /*#__PURE__*/React.createElement("div", {
    className: "lib-bar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lib-bar-l"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bar-ch" + (chronoOn ? " bar-ch-chrono" : "")
  }, /*#__PURE__*/React.createElement("button", {
    className: "ch-nav",
    disabled: chronoOn ? chronoPos <= 1 : selChapter <= 1,
    onClick: () => {
      if (chronoOn) {
        stepPassage(-1);
        return;
      }
      const c = Math.max(1, selChapter - 1);
      setSelChapter(c);
      if (!nonCanon) onNavChange?.({
        ...nav,
        book: selBook?.abbrev,
        chapter: c,
        highlight: null
      });
    },
    "aria-label": chronoOn ? "Previous passage" : "Previous chapter"
  }, "\u2039"), /*#__PURE__*/React.createElement("button", {
    className: "ch-nav",
    disabled: chronoOn ? chrono && chronoPos >= chrono.passages.length : selChapter >= maxChap,
    onClick: () => {
      if (chronoOn) {
        stepPassage(1);
        return;
      }
      const c = Math.min(maxChap, selChapter + 1);
      setSelChapter(c);
      if (!nonCanon) onNavChange?.({
        ...nav,
        book: selBook?.abbrev,
        chapter: c,
        highlight: null
      });
    },
    "aria-label": chronoOn ? "Next passage" : "Next chapter"
  }, "\u203A")), chrono && !nonCanon && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "lib-bar-sep",
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("div", {
    className: "seg lib-order-seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (orderMode !== "chronological" ? " on" : ""),
    title: "Canonical order (books in order)",
    "aria-label": "Canonical order",
    onClick: () => setOrder("canonical")
  }, /*#__PURE__*/React.createElement(Icon.Book, null)), /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (orderMode === "chronological" ? " on" : ""),
    title: "Chronological order (events in sequence)",
    "aria-label": "Chronological order",
    onClick: () => setOrder("chronological")
  }, /*#__PURE__*/React.createElement(Icon.Clock, null)))), /*#__PURE__*/React.createElement("span", {
    className: "lib-bar-sep",
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("button", {
    className: "lib-toggle lib-toggle-icon" + (showStrongs ? " on" : ""),
    disabled: proseLocked,
    title: "Strong's numbers",
    "aria-label": "Strong's numbers",
    "aria-pressed": showStrongs,
    style: proseLocked ? {
      opacity: 0.35,
      cursor: "default"
    } : undefined,
    onClick: () => !proseLocked && setOpt("showStrongs", !showStrongs)
  }, /*#__PURE__*/React.createElement(Icon.Hash, null)), /*#__PURE__*/React.createElement("button", {
    className: "lib-toggle lib-toggle-icon" + (showInterlinear ? " on" : ""),
    disabled: proseLocked,
    title: "Interlinear",
    "aria-label": "Interlinear",
    "aria-pressed": showInterlinear,
    style: proseLocked ? {
      opacity: 0.35,
      cursor: "default"
    } : undefined,
    onClick: () => !proseLocked && setOpt("showInterlinear", !showInterlinear)
  }, /*#__PURE__*/React.createElement(Icon.Interlinear, null)), !nonCanon && /*#__PURE__*/React.createElement("div", {
    className: "lib-other-wrap"
  }, /*#__PURE__*/React.createElement("button", {
    className: "lib-toggle lib-toggle-icon" + (translation === "parallel" ? " on" : ""),
    title: "Compare translations",
    "aria-label": "Compare translations",
    "aria-pressed": translation === "parallel",
    "aria-expanded": compareOpen,
    onClick: () => setCompareOpen(o => !o)
  }, /*#__PURE__*/React.createElement(Icon.Columns, null)), compareOpen && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "lib-other-scrim",
    onClick: () => setCompareOpen(false)
  }), /*#__PURE__*/React.createElement("div", {
    className: "lib-other-menu lib-compare-menu"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lib-compare-title"
  }, "Compare (pick 2\u20134)"), compareAvail.map(id => /*#__PURE__*/React.createElement("label", {
    key: id,
    className: "lib-compare-opt"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: compareActive.includes(id),
    onChange: () => toggleCompare(id)
  }), /*#__PURE__*/React.createElement("span", null, id.toUpperCase())))))), /*#__PURE__*/React.createElement("span", {
    className: "lib-bar-sep",
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("div", {
    className: "seg lib-view-seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (viewChipOn ? " on" : ""),
    disabled: layoutLocked,
    title: extraEnglish ? "Line-by-line view" : "Chip view",
    "aria-label": extraEnglish ? "Line-by-line view" : "Chip view",
    "aria-pressed": viewChipOn,
    style: layoutLocked ? {
      opacity: 0.35,
      cursor: "default"
    } : undefined,
    onClick: () => !layoutLocked && setOpt("viewMode", "chip")
  }, /*#__PURE__*/React.createElement(Icon.Grid, null)), /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (!viewChipOn ? " on" : ""),
    disabled: hebMode || !extraEnglish && !proseLocked && (showStrongs || showInterlinear),
    title: "Prose view",
    "aria-label": "Prose view",
    "aria-pressed": !viewChipOn,
    style: hebMode || !extraEnglish && !proseLocked && (showStrongs || showInterlinear) ? {
      opacity: 0.35,
      cursor: "default"
    } : undefined,
    onClick: () => {
      if (hebMode) return;
      if (extraEnglish) {
        setOpt("viewMode", "prose");
        return;
      }
      if (!showStrongs && !showInterlinear) setOpt("viewMode", "prose");
    }
  }, /*#__PURE__*/React.createElement(Icon.Lines, null))), /*#__PURE__*/React.createElement("span", {
    className: "lib-bar-sep",
    "aria-hidden": "true"
  }), audioBtn, canSearch && /*#__PURE__*/React.createElement("button", {
    className: "lib-toggle lib-toggle-icon" + (searchOpen ? " on" : ""),
    title: "Search this text",
    "aria-label": "Search this text",
    "aria-pressed": searchOpen,
    onClick: () => setSearchOpen(o => !o)
  }, /*#__PURE__*/React.createElement(Icon.Search, null)), /*#__PURE__*/React.createElement("div", {
    className: "lib-other-wrap"
  }, /*#__PURE__*/React.createElement("button", {
    className: "lib-toggle lib-font-btn",
    onClick: () => setFontOpen(o => !o),
    title: "Text size",
    "aria-label": "Text size"
  }, "Aa \u25BE"), fontOpen && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "lib-other-scrim",
    onClick: () => setFontOpen(false)
  }), /*#__PURE__*/React.createElement("div", {
    className: "lib-other-menu lib-font-menu"
  }, /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-b",
    onClick: () => changeFontSize(-1)
  }, "A\u2212"), /*#__PURE__*/React.createElement("span", {
    className: "font-size-lbl"
  }, libFontSize), /*#__PURE__*/React.createElement("button", {
    className: "seg-b",
    onClick: () => changeFontSize(+1)
  }, "A+"))))))) : /*#__PURE__*/React.createElement("div", {
    className: "lib-toolbar"
  }, /*#__PURE__*/React.createElement("button", {
    className: "mbar-overview",
    onClick: () => setSummaryOpen(true),
    "aria-label": "Chapter overview"
  }, /*#__PURE__*/React.createElement(Icon.Info, null)), canSearch && /*#__PURE__*/React.createElement("button", {
    className: "mbar-overview mbar-search",
    onClick: () => setSearchOpen(o => !o),
    "aria-label": "Search this text"
  }, /*#__PURE__*/React.createElement(Icon.Search, null)), /*#__PURE__*/React.createElement("div", {
    className: "mbar-center"
  }, /*#__PURE__*/React.createElement("button", {
    className: "mbar-loc",
    onClick: () => setMobileNavOpen(true)
  }, chronoOn ? /*#__PURE__*/React.createElement("span", {
    className: "mbar-loc-name mbar-loc-chrono"
  }, curPassage ? curPassage.label : "—") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "mbar-loc-name"
  }, nonCanon ? nonCanon.name : selBook ? selBook.name : ""), /*#__PURE__*/React.createElement("span", {
    className: "mbar-loc-ch"
  }, selChapter)))), audioCapable && /*#__PURE__*/React.createElement("button", {
    className: "mbar-overview mbar-audio" + (showPause ? " on" : ""),
    disabled: audioBusy,
    onClick: onToolbarAudio,
    "aria-label": showPause ? "Pause audio" : "Play chapter audio"
  }, showPause ? /*#__PURE__*/React.createElement(Icon.Pause, null) : /*#__PURE__*/React.createElement(Icon.Play, null)), /*#__PURE__*/React.createElement("button", {
    className: "mbar-trans",
    onClick: () => setModesOpen(true),
    "aria-label": "Reading options"
  }, nonCanon ? nonCanon.abbr || nonCanon.name : translation === "parallel" ? "Par" : translation.toUpperCase())), audioBar, searchOpen && canSearch && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "lib-search-scrim",
    onClick: () => setSearchOpen(false)
  }), /*#__PURE__*/React.createElement("div", {
    className: "lib-search-panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lib-search-row"
  }, /*#__PURE__*/React.createElement("input", {
    className: "lib-search-input",
    type: "text",
    autoFocus: true,
    placeholder: `Search ${searchName}${corpus === "bible" && searchScope === "book" && selBook ? " · " + selBook.name : ""}…`,
    value: searchQ,
    onChange: e => setSearchQ(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") runTextSearch();
      if (e.key === "Escape") setSearchOpen(false);
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "lib-search-go",
    onClick: runTextSearch,
    "aria-label": "Search"
  }, "Go"), /*#__PURE__*/React.createElement("button", {
    className: "lib-search-x",
    onClick: () => setSearchOpen(false),
    "aria-label": "Close search"
  }, "\u2715")), corpus === "bible" && /*#__PURE__*/React.createElement("div", {
    className: "lib-search-scope seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (searchScope === "all" ? " on" : ""),
    onClick: () => setSearchScope("all")
  }, "Whole Bible"), /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (searchScope === "book" ? " on" : ""),
    onClick: () => setSearchScope("book")
  }, "This book")), /*#__PURE__*/React.createElement("div", {
    className: "lib-search-results"
  }, searchLoading ? /*#__PURE__*/React.createElement("div", {
    className: "lib-search-status"
  }, "Searching\u2026") : searchResults == null ? /*#__PURE__*/React.createElement("div", {
    className: "lib-search-status"
  }, "Type words and press Enter.") : searchResults.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "lib-search-status"
  }, "No matches.") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "lib-search-status"
  }, searchResults.length, searchResults.length === 1000 ? "+" : "", " match", searchResults.length === 1 ? "" : "es"), searchResults.map((r, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    className: "lib-search-hit",
    onClick: () => jumpToResult(r)
  }, /*#__PURE__*/React.createElement("span", {
    className: "lib-search-hit-ref"
  }, corpus === "bible" ? BOOK_LABELS[r.book] || r.book : searchName, " ", r.chapter, ":", r.verse), /*#__PURE__*/React.createElement("span", {
    className: "lib-search-hit-text"
  }, highlightTerm(r.text, searchTerm)))))))), /*#__PURE__*/React.createElement("div", _extends({
    ref: readingRef,
    className: "lib-reading" + (showInterlinear ? " lib-interlinear-on" : ""),
    style: {
      ...(translation === "parallel" ? {
        paddingTop: 0
      } : {}),
      "--lib-font-size": libFontSize + "px"
    }
  }, readingHandlers), nonCanon ? didLoading ? /*#__PURE__*/React.createElement("div", {
    className: "lib-loading"
  }, "Loading\u2026") : nonCanon.englishOnly ? extraLineMode ? renderExtraLines() : renderDidacheProse() : translation === "parallel" ? /*#__PURE__*/React.createElement("div", {
    className: "lib-parallel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lib-parallel-header"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lib-parallel-label"
  }, nonCanon.name, " \xB7 Greek"), /*#__PURE__*/React.createElement("span", {
    className: "lib-parallel-label"
  }, "English")), didVerses.map(renderDidacheParallelVerse)) : chipMode ? /*#__PURE__*/React.createElement("div", {
    className: "lib-text-words lib-did-text"
  }, didVerses.map(renderDidacheVerse)) : renderDidacheProse() : translation === "parallel" ? (() => {
    // Compare: render the selected texts (2-4) side by side. Each column
    // knows how to draw its own verse + its own number (shown on desktop,
    // hidden on mobile where the shared number sits above the stack).
    // Plain English columns (BSB/ESV/NIV) carry their own verse number too
    // (the shared one is mobile-only), so every desktop column shows it.
    // They also get the note anchor + highlight paint + note marker so notes
    // and highlights are SHARED across the compare columns: a highlight made
    // in any text paints the whole verse here, the pencil shows, and you can
    // drag-select inside the column to add a new one.
    const plainCol = v => {
      const pch = v._ch ?? selChapter;
      return /*#__PURE__*/React.createElement("span", {
        className: "lib-parallel-plain",
        "data-note-verse": v.verse,
        "data-note-chapter": pch
      }, vnumEl(v.verse, pch), noteDotInline(v.verse, pch), /*#__PURE__*/React.createElement("span", {
        className: "lib-bsb-text" + hiClass(v.verse, null, pch)
      }, v.verse_text));
    };
    const colDefs = {
      abp: {
        label: "ABP",
        view: abpView,
        loading: abpShowLoading,
        render: v => renderVerse(v, true)
      },
      kjv: {
        label: "KJV",
        view: kjvView,
        loading: kjvShowLoading,
        render: v => kjvWordMode ? renderKjvVerse(v, true, true) : renderKjvProse(v, true, true)
      },
      bsb: {
        label: "BSB",
        view: bsbView,
        loading: bsbShowLoading,
        render: plainCol
      },
      esv: {
        label: "ESV",
        view: esvView,
        loading: esvShowLoading,
        render: plainCol
      },
      niv: {
        label: "NIV",
        view: nivView,
        loading: nivShowLoading,
        render: plainCol
      }
    };
    const cols = compareSel.filter(id => colDefs[id] && compareAvail.includes(id)).map(id => ({
      id,
      ...colDefs[id]
    }));
    const n = Math.max(cols.length, 1);
    return /*#__PURE__*/React.createElement("div", {
      className: "lib-parallel lib-cmp-" + n
    }, /*#__PURE__*/React.createElement("div", {
      className: "lib-parallel-header"
    }, cols.map(c => /*#__PURE__*/React.createElement("span", {
      key: c.id,
      className: "lib-parallel-label"
    }, c.label))), cols.some(c => c.loading) ? /*#__PURE__*/React.createElement("div", {
      className: "lib-loading"
    }, "Loading\u2026") : (() => {
      // Key by chapter+verse so a chronological span (verse numbers repeat
      // across chapters) lines the texts up; canonical has one chapter.
      const cv = v => `${v._ch ?? selChapter}-${v.verse}`;
      const maps = {};
      cols.forEach(c => {
        maps[c.id] = Object.fromEntries(c.view.map(v => [cv(v), v]));
      });
      // Ordered union of every verse present in any selected text.
      const seen = new Set();
      const order = [];
      cols.forEach(c => c.view.forEach(v => {
        const k = cv(v);
        if (!seen.has(k)) {
          seen.add(k);
          order.push({
            k,
            ch: v._ch ?? selChapter,
            verse: v.verse
          });
        }
      }));
      order.sort((a, b) => a.ch - b.ch || a.verse - b.verse);
      const items = [];
      let lastCh = null;
      order.forEach(o => {
        if (chronoOn && o.ch !== lastCh) {
          items.push({
            type: 'chap',
            ch: o.ch
          });
          lastCh = o.ch;
        }
        let heading = null;
        for (const c of cols) {
          const vv = maps[c.id][o.k];
          if (vv && vv.heading) {
            heading = vv.heading;
            break;
          }
        }
        if (heading) items.push({
          type: 'heading',
          heading,
          key: `h-${o.k}`
        });
        items.push({
          type: 'verse',
          o
        });
      });
      return items.map(item => {
        if (item.type === 'chap') return /*#__PURE__*/React.createElement("div", {
          key: `cm-${item.ch}`,
          className: "lib-chrono-chapmark"
        }, selBook ? selBook.name : "", " ", item.ch);
        if (item.type === 'heading') return /*#__PURE__*/React.createElement("div", {
          key: item.key,
          className: "lib-parallel-section-heading"
        }, /*#__PURE__*/React.createElement("div", {
          className: "pericope-heading"
        }, item.heading));
        const o = item.o;
        return /*#__PURE__*/React.createElement("div", {
          key: o.k,
          className: "lib-parallel-verse"
        }, /*#__PURE__*/React.createElement("div", {
          className: "lib-parallel-vnum"
        }, vnumEl(o.verse, o.ch)), cols.map(c => {
          const vv = maps[c.id][o.k];
          return /*#__PURE__*/React.createElement("div", {
            key: c.id,
            className: "lib-parallel-col"
          }, /*#__PURE__*/React.createElement("span", {
            className: "lib-parallel-col-lbl"
          }, c.label), vv ? c.render(vv) : null);
        }));
      });
    })());
  })() : translation === "kjv" ? kjvShowLoading ? /*#__PURE__*/React.createElement("div", {
    className: "lib-loading"
  }, "Loading\u2026") : kjvWordMode ? /*#__PURE__*/React.createElement("div", {
    className: "lib-text-words"
  }, withMarks(kjvView, v => renderKjvVerse(v))) : /*#__PURE__*/React.createElement("div", {
    className: "lib-text-words lib-prose-flow"
  }, withMarks(kjvView, v => renderFlowVerse(v, kjvFlowInner(v)))) : translation === "bsb" ? bsbShowLoading ? /*#__PURE__*/React.createElement("div", {
    className: "lib-loading"
  }, "Loading\u2026") : /*#__PURE__*/React.createElement("div", {
    className: "lib-text-words lib-prose-flow"
  }, withMarks(bsbView, v => renderFlowVerse(v, plainFlowInner(v)))) : translation === "esv" ? esvShowLoading ? /*#__PURE__*/React.createElement("div", {
    className: "lib-loading"
  }, "Loading\u2026") : /*#__PURE__*/React.createElement("div", {
    className: "lib-text-words lib-prose-flow"
  }, withMarks(esvView, v => renderFlowVerse(v, plainFlowInner(v)))) : translation === "niv" ? nivShowLoading ? /*#__PURE__*/React.createElement("div", {
    className: "lib-loading"
  }, "Loading\u2026") : /*#__PURE__*/React.createElement("div", {
    className: "lib-text-words lib-prose-flow"
  }, withMarks(nivView, v => renderFlowVerse(v, plainFlowInner(v)))) : translation === "heb" ? hebLoading ? /*#__PURE__*/React.createElement("div", {
    className: "lib-loading"
  }, "Loading\u2026") : /*#__PURE__*/React.createElement("div", {
    className: "lib-text-words lib-heb-text"
  }, hebVerses.map(renderHebVerse)) : abpShowLoading ? /*#__PURE__*/React.createElement("div", {
    className: "lib-loading"
  }, "Loading\u2026") : wordMode ? /*#__PURE__*/React.createElement("div", {
    className: "lib-text-words"
  }, withMarks(abpView, v => renderVerse(v))) : isPoetry ? /*#__PURE__*/React.createElement("div", {
    className: "lib-text-words"
  }, withMarks(abpView, v => renderVerse(v))) : /*#__PURE__*/React.createElement("div", {
    className: "lib-text-words lib-prose-flow"
  }, withMarks(abpView, v => {
    const ch = v._ch ?? selChapter;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: `${ch}-${v.verse}`
    }, v.heading && /*#__PURE__*/React.createElement("div", {
      className: "pericope-heading"
    }, v.heading), /*#__PURE__*/React.createElement("span", {
      className: "lib-flow-verse",
      "data-note-verse": v.verse,
      "data-note-chapter": ch
    }, /*#__PURE__*/React.createElement("sup", _extends({
      className: "lib-flow-vnum",
      title: handleVerseNum ? "Click: cross-references · Right-click / long-press: add a note" : undefined,
      onClick: handleVerseNum ? () => {
        if (vnumPressRef.current.fired) {
          vnumPressRef.current.fired = false;
          return;
        }
        handleVerseNum(v.verse, ch);
      } : undefined
    }, vnumNoteHandlers(v.verse, ch)), v.verse), noteDotInline(v.verse, ch), renderProseWords(v)));
  })))), noteSel && /*#__PURE__*/React.createElement(NoteAddPopover, {
    rect: noteSel.rect,
    isMobile: isMobile,
    onAdd: addNoteFromSelection,
    onColor: addHighlightFromSelection,
    onCopy: copySelection,
    onJournal: journalFromSelection
  }), flashMsg && /*#__PURE__*/React.createElement("div", {
    className: "lib-flash"
  }, flashMsg), verseMenu && /*#__PURE__*/React.createElement(VerseNoteMenu, {
    rect: verseMenu.rect,
    isMobile: isMobile,
    onColor: vmColor,
    onNote: vmNote,
    onBookmark: vmBookmark,
    onCopy: vmCopy,
    onJournal: vmJournal,
    onClose: () => setVerseMenu(null)
  }), showSummary && (selBook || nonCanon) && /*#__PURE__*/React.createElement(SummaryPanel, {
    book: sumBook,
    chapter: sumChapter,
    bookLabel: sumLabel
  }), isMobile && summaryOpen && (selBook || nonCanon) && /*#__PURE__*/React.createElement(SummaryPanel, {
    isMobile: true,
    onClose: () => setSummaryOpen(false),
    book: sumBook,
    chapter: sumChapter,
    bookLabel: sumLabel
  }));
}

// ============================================================
// GLOSS GROUPINGS
// ============================================================
// ============================================================
// AI ANSWER STRIP
// ============================================================
function AIAnswer({
  query,
  explanation,
  keyStrongs,
  onPick
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: "ai-answer"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ai-answer-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ai-tag"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ai-dot"
  }), "Synthesis"), /*#__PURE__*/React.createElement("span", {
    className: "ai-q"
  }, "\"", query, "\"")), /*#__PURE__*/React.createElement("p", {
    className: "ai-answer-body"
  }, explanation), keyStrongs && keyStrongs.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "ai-cites"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ai-cites-label"
  }, "Cited:"), keyStrongs.map(ks => /*#__PURE__*/React.createElement("button", {
    key: ks.strongs,
    className: "ai-cite",
    onClick: () => onPick({
      id: `ks-${ks.strongs_base}`,
      strongs: ks.strongs,
      strongs_base: ks.strongs_base,
      strongs_raw: ks.strongs_base,
      greek: ks.lemma,
      translit: ks.translit,
      gloss: "",
      ref: "",
      book: "",
      chapter: 0,
      verse: 0,
      definition: ks.definition || "",
      derivation: ks.derivation || ""
    })
  }, ks.strongs, " ", ks.translit || ks.lemma))));
}

// ============================================================
// GUIDED TOUR
// ============================================================
const TOUR_STEPS = [{
  icon: "Book",
  label: "Welcome to Lexica",
  body: "Lexica is a Greek and Hebrew word study tool built for the diligent Berean. No prior training required. Every word traces back to its Greek or Hebrew source so you can read what the text actually says — before any theological framework is applied. You won't be a scholar overnight, but you'll immediately be a Berean."
}, {
  icon: "Search",
  label: "The Lexicon",
  body: "Search by English, Greek, Hebrew, transliteration, or Strong's number. Results span both Greek (LSJ) and Hebrew (BDB) — click any word for its full lexicon entry and a context-aware AI summary anchored in the source text."
}, {
  icon: "Book",
  label: "The Library",
  body: "Read in ABP Greek, KJV, or the Berean Standard Bible — on their own, in parallel, or compare them side by side. Switch between plain reading and a full interlinear (Hebrew over OT words, Greek over NT), follow the text in chronological order, or listen with read-along audio. Click any word for its lexicon entry; click any verse number for cross-references. Beyond the canon you'll also find the Apocrypha, 1 Enoch, and the Apostolic Fathers."
}, {
  icon: "Panel",
  label: "Cross-References",
  body: "Every verse connects to Torrey's Treasury of Scripture Knowledge — AI-curated to the strongest matches and synthesized into a thematic overview anchored in ABP vocabulary."
}, {
  icon: "Sparkle",
  label: "Ask the Corpus",
  body: "Ask in plain language: 'Where does pneuma appear in Genesis?' or 'Differences in how KJV and ABP render spirit in the OT.' The AI searches Greek and Hebrew simultaneously and cites specific passages."
}, {
  icon: "Note",
  label: "Notes & Highlights",
  body: "Highlight verses in five colors, write notes on any word or verse, drop bookmarks, and keep a free-form journal. It all saves in your browser automatically — no account required. Sign in with email or Google to sync everything across your devices."
}, {
  icon: "Book",
  label: "Support Lexica",
  body: "Lexica is free, independent, and has no ads. It's maintained by one person who thinks serious Bible study tools shouldn't cost hundreds of dollars. If it's been useful to your studies, a small contribution keeps it running.",
  donate: true
}];
function GuidedTour({
  onDone
}) {
  const [step, setStep] = useState(0);
  const cur = TOUR_STEPS[step];
  const StepIcon = Icon[cur.icon];
  const isLast = step === TOUR_STEPS.length - 1;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "tour-scrim",
    onClick: onDone
  }), /*#__PURE__*/React.createElement("div", {
    className: "tour-modal",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Welcome to Lexica"
  }, /*#__PURE__*/React.createElement("button", {
    className: "tour-skip",
    onClick: onDone
  }, "Skip"), /*#__PURE__*/React.createElement("div", {
    className: "tour-icon-wrap"
  }, /*#__PURE__*/React.createElement(StepIcon, {
    width: "20",
    height: "20"
  })), /*#__PURE__*/React.createElement("div", {
    className: "tour-step-num"
  }, step + 1, " of ", TOUR_STEPS.length), /*#__PURE__*/React.createElement("h2", {
    className: "tour-title"
  }, cur.label), /*#__PURE__*/React.createElement("p", {
    className: "tour-body"
  }, cur.body), cur.donate && /*#__PURE__*/React.createElement("div", {
    className: "tour-donate-btns"
  }, /*#__PURE__*/React.createElement("a", {
    className: "donate-btn kofi",
    href: "https://ko-fi.com/lexica",
    target: "_blank",
    rel: "noopener noreferrer"
  }, "\u2615 Ko-fi"), /*#__PURE__*/React.createElement("a", {
    className: "donate-btn github",
    href: "https://github.com/sponsors/jonathan-pernice",
    target: "_blank",
    rel: "noopener noreferrer"
  }, "\u2665 GitHub Sponsors")), /*#__PURE__*/React.createElement("div", {
    className: "tour-dots"
  }, TOUR_STEPS.map((_, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    className: "tour-dot" + (i === step ? " active" : ""),
    onClick: () => setStep(i),
    "aria-label": `Step ${i + 1}`
  }))), /*#__PURE__*/React.createElement("div", {
    className: "tour-nav"
  }, step > 0 && /*#__PURE__*/React.createElement("button", {
    className: "tour-btn tour-btn-prev",
    onClick: () => setStep(s => s - 1)
  }, "Previous"), isLast ? /*#__PURE__*/React.createElement("button", {
    className: "tour-btn tour-btn-done",
    onClick: onDone
  }, "Get started") : /*#__PURE__*/React.createElement("button", {
    className: "tour-btn tour-btn-next",
    onClick: () => setStep(s => s + 1)
  }, "Next"))));
}

// ============================================================
// ABOUT VIEW
// ============================================================
function AboutView({
  owner
}) {
  // The owner gets a private "Stats" view tucked behind a toggle here (no extra tab).
  const [tab, setTab] = useState("about");
  return /*#__PURE__*/React.createElement("div", {
    className: "about-view"
  }, /*#__PURE__*/React.createElement("div", {
    className: "about-inner"
  }, owner && /*#__PURE__*/React.createElement("div", {
    className: "seg about-owner-seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (tab === "about" ? " on" : ""),
    onClick: () => setTab("about")
  }, "About"), /*#__PURE__*/React.createElement("button", {
    className: "seg-b" + (tab === "stats" ? " on" : ""),
    onClick: () => setTab("stats")
  }, "Stats")), owner && tab === "stats" ? /*#__PURE__*/React.createElement(StatsView, null) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("h1", {
    className: "about-title"
  }, "About Lexica"), /*#__PURE__*/React.createElement("p", {
    className: "about-lead"
  }, "A Greek and Hebrew word study tool for the diligent Berean. No seminary required."), /*#__PURE__*/React.createElement("h2", {
    className: "about-h2"
  }, "What Lexica does"), /*#__PURE__*/React.createElement("p", {
    className: "about-p"
  }, "Lexica lets you trace any English word in the Bible back to its Greek or Hebrew source and explore its full meaning \u2014 not just the translation choice made by one committee. Every word links to the Liddell-Scott-Jones Greek lexicon (LSJ) or Brown-Driver-Briggs Hebrew lexicon (BDB), the two most comprehensive scholarly references available."), /*#__PURE__*/React.createElement("p", {
    className: "about-p"
  }, "The primary text is the ", /*#__PURE__*/React.createElement("b", null, "Apostolic Bible Polyglot (ABP)"), " \u2014 a word-for-word Greek interlinear covering both the Septuagint (OT) and New Testament. The ", /*#__PURE__*/React.createElement("b", null, "King James Version"), " and the ", /*#__PURE__*/React.createElement("b", null, "Berean Standard Bible"), " read alongside it \u2014 on their own, in parallel, or compared side by side \u2014 with read-along audio and an optional chronological reading order. Cross-references come from Torrey's Treasury of Scripture Knowledge."), /*#__PURE__*/React.createElement("p", {
    className: "about-p"
  }, "Beyond the canon, Lexica includes a library of related texts: the Septuagint Apocrypha, the Pseudepigrapha (1 Enoch, Jubilees, and more), and the Apostolic Fathers with full Greek interlinear."), /*#__PURE__*/React.createElement("h2", {
    className: "about-h2"
  }, "Your study, saved"), /*#__PURE__*/React.createElement("p", {
    className: "about-p"
  }, "Highlight verses, write notes on any word or verse, set bookmarks, and keep a free-form journal. Everything saves in your browser automatically \u2014 no account needed. Create a free account (email or Google) and your notes sync across every device. The app stays fully usable with no sign-in at all."), /*#__PURE__*/React.createElement("h2", {
    className: "about-h2"
  }, "The Berean approach"), /*#__PURE__*/React.createElement("p", {
    className: "about-p"
  }, "The Bereans \"received the word with all readiness of mind, and searched the scriptures daily\" (Acts 17:11). Lexica is built on that same posture: let the Greek and Hebrew speak first, before any theological system is imported. No commentary, no denominational lens, no conclusions pre-loaded. The text speaks \u2014 you decide what it means."), /*#__PURE__*/React.createElement("p", {
    className: "about-p"
  }, "Every AI-generated summary is anchored in the source vocabulary of the ABP. The system prompt explicitly forbids importing theology from outside the text."), /*#__PURE__*/React.createElement("h2", {
    className: "about-h2"
  }, "Methodology"), /*#__PURE__*/React.createElement("ul", {
    className: "about-ul"
  }, /*#__PURE__*/React.createElement("li", null, "Strong's numbers are the bridge between English, Greek, and Hebrew"), /*#__PURE__*/React.createElement("li", null, "Greek definitions draw from LSJ \u2014 the standard classical Greek reference"), /*#__PURE__*/React.createElement("li", null, "Hebrew definitions draw from BDB \u2014 the standard OT Hebrew reference"), /*#__PURE__*/React.createElement("li", null, "AI search generates SQL against the full lexicon corpus \u2014 not a summary or paraphrase"), /*#__PURE__*/React.createElement("li", null, "Translation comparisons surface where ABP, KJV, and the BSB make different rendering choices for the same source word")), /*#__PURE__*/React.createElement("h2", {
    className: "about-h2"
  }, "Support Lexica"), /*#__PURE__*/React.createElement("p", {
    className: "about-p"
  }, "Lexica is free, independent, and has no ads. It's maintained by one person who thinks serious Bible study tools shouldn't cost hundreds of dollars or require a seminary login. If it's been useful to you, a small contribution keeps the lights on."), /*#__PURE__*/React.createElement("div", {
    className: "about-donate"
  }, /*#__PURE__*/React.createElement("a", {
    className: "donate-btn kofi",
    href: "https://ko-fi.com/lexica",
    target: "_blank",
    rel: "noopener noreferrer"
  }, "\u2615 Ko-fi"), /*#__PURE__*/React.createElement("a", {
    className: "donate-btn github",
    href: "https://github.com/sponsors/jonathan-pernice",
    target: "_blank",
    rel: "noopener noreferrer"
  }, "\u2665 GitHub Sponsors")))));
}

// ============================================================
// LEXICON VIEW
// ============================================================
const _STRONGS_RE = /^[GgHh]?\d+(\.\d+)?$/;
function LexiconView({
  onNavigateToSearch,
  onNavigateToLibrary,
  onWordClick,
  pendingStrongs,
  onPendingStrongsConsumed,
  isMobile
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState(null);
  const [profile, setProfile] = useState(null);
  const [corpus, setCorpus] = useState("all"); // search-results scope: all | abp | kjv
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
  useEffect(() => {
    setLsjEntry(null);
    setLsjSummary(null);
  }, [profile?.strongs]);

  // Lazily fetch the LSJ entry + AI-curated summary when the Greek definition is
  // opened (Haiku, cached). Hebrew keeps its BDB definition. The /api/lsj endpoint
  // auto-falls back to strongs_def when there's no LSJ match.
  useEffect(() => {
    if (!showDef || !profile || !/^G/i.test(profile.strongs) || lsjEntry || lsjLoading) return;
    let cancelled = false;
    setLsjLoading(true);
    api.lsj(profile.lemma || "", profile.strongs.replace(/^[GH]/i, "")).then(d => {
      if (cancelled) return;
      const entry = d && !d.error ? d : null;
      setLsjEntry(entry);
      setLsjLoading(false);
      if (entry && entry.source !== "strongs") {
        setLsjSummaryLoading(true);
        api.lsjSummary(entry.key).then(s => {
          if (!cancelled) setLsjSummary(s);
        }).catch(() => {}).finally(() => {
          if (!cancelled) setLsjSummaryLoading(false);
        });
      }
    }).catch(() => {
      if (!cancelled) {
        setLsjEntry(null);
        setLsjLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
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
    const isHeb = /^H/i.test(strongs) || !/^[GgHh]/.test(strongs) && parseInt(strongs) > 5624;
    const c = corpusOverride ?? (isHeb ? "kjv" : "abp"); // drilling in always lands in a single corpus
    setProfileCorpus(c);
    try {
      const data = await api.lexiconProfile(strongs, c);
      if (data.error) setError(data.error);else setProfile(data);
    } catch (e) {
      setError("Failed to load word profile: " + e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (profile && pendingGloss) {
      selectGloss(pendingGloss);
      setPendingGloss(null);
    }
  }, [profile, pendingGloss]);

  // Search-results scope toggle (All / ABP / KJV). Only shown when no word is
  // in focus; re-runs the English search in that corpus.
  const switchCorpus = async c => {
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
      } catch {
        setError("Search failed.");
      } finally {
        setLoading(false);
      }
    }
  };

  // Profile corpus toggle (ABP / KJV). Reloads the focused word in that corpus.
  const switchProfileCorpus = async c => {
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
    } catch {} finally {
      setLoading(false);
    }
  };
  const switchTestament = async t => {
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
      } catch {
        setError("Search failed.");
      } finally {
        setLoading(false);
      }
    }
  };
  const fetchVerses = async (book, gloss) => {
    setVerseList(null);
    setVerseLoading(true);
    try {
      const data = await api.lexiconVerses(profile.strongs, book, profileCorpus, gloss);
      if (data.error) {
        setVerseList([{
          error: data.error
        }]);
      } else {
        setVerseList(data.verses || []);
        setBookGlosses(data.glosses && data.glosses.length ? data.glosses : null);
      }
    } catch (e) {
      setVerseList([{
        error: String(e)
      }]);
    } finally {
      setVerseLoading(false);
    }
  };
  const selectBook = async book => {
    if (selectedBook === book) {
      setSelectedBook(null);
      setVerseList(null);
      setBookGlosses(null);
      return;
    }
    setSelectedBook(book);
    await fetchVerses(book, selectedGloss);
  };
  const selectGloss = async gloss => {
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
  const _isGreekHebrew = s => /[Ͱ-Ͽἀ-῿֐-׿]/.test(s);

  // One "<Bible> renders this as" line. The active toggle's line is the
  // interactive one (click a rendering to filter the books/verses below); the
  // other Bible's line is shown read-only, just so you can see both at once.
  const renderGlossLine = (lineCorpus, label, list) => {
    if (!list || !list.length) return null;
    const interactive = profileCorpus === lineCorpus;
    return /*#__PURE__*/React.createElement("div", {
      className: "lexicon-glosses"
    }, /*#__PURE__*/React.createElement("div", {
      className: "lexicon-gloss-label"
    }, label), /*#__PURE__*/React.createElement("div", {
      className: "lexicon-dist-list"
    }, list.map((g, i) => /*#__PURE__*/React.createElement(React.Fragment, {
      key: g.gloss
    }, i > 0 && /*#__PURE__*/React.createElement("span", {
      className: "lexicon-dist-sep"
    }, " \xB7 "), interactive ? /*#__PURE__*/React.createElement("button", {
      className: "lexicon-dist-item" + (selectedGloss === g.gloss ? " selected" : ""),
      onClick: () => selectGloss(g.gloss)
    }, g.gloss, /*#__PURE__*/React.createElement("span", {
      className: "lexicon-dist-count"
    }, g.count)) : /*#__PURE__*/React.createElement("span", {
      className: "lexicon-dist-item lexicon-dist-item--ref"
    }, g.gloss, /*#__PURE__*/React.createElement("span", {
      className: "lexicon-dist-count"
    }, g.count))))));
  };

  // A result row's rendering preview: an ABP line and/or a KJV line, each
  // labeled with its ABP/KJV tag (so a single-Bible word still says which one).
  // Desktop caps each line at 6 renderings; mobile shows all (wraps).
  const renderRowPreview = g => {
    const line = (list, tag) => !list || list.length === 0 ? null : /*#__PURE__*/React.createElement("span", {
      className: "lex-prev-line",
      key: tag
    }, /*#__PURE__*/React.createElement("span", {
      className: "lex-prev-tag"
    }, tag), (isMobile ? list : list.slice(0, 6)).map(x => x.gloss).join(", "));
    return [line(g.abp_glosses, "ABP"), line(g.kjv_glosses, "KJV")];
  };

  // Light up every form of the focused word's Strong's in the verse list.
  const citedStrongs = useMemo(() => {
    if (!profile?.strongs) return new Set();
    const tag = profile.strongs;
    const base = tag.split(".")[0];
    return new Set([tag, base, base.replace(/^[GH]/i, "")]);
  }, [profile?.strongs]);
  const handleSubmit = async e => {
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
        if (!data.length) setError("No matches found.");else if (data.length === 1) loadProfile(data[0].strongs);else setMatches(data);
      } else {
        const data = await api.lexiconEnglish(q, corpus, testament);
        if (data.length) {
          setGroupings(data);
        } else {
          // No English meaning matched — the input may be a Greek/Hebrew word
          // typed in Latin letters (e.g. "pneuma"). Fall back to the lookup,
          // which matches transliterations accent-insensitively.
          const alt = await api.lexiconLookup(q);
          if (!alt.length) setError("No matches found for \"" + q + "\".");else if (alt.length === 1) loadProfile(alt[0].strongs);else setMatches(alt);
        }
      }
    } catch {
      setError("Search failed.");
    } finally {
      setLoading(false);
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "lexicon-view"
  }, /*#__PURE__*/React.createElement("section", {
    className: "search"
  }, /*#__PURE__*/React.createElement("div", {
    className: "search-cell"
  }, /*#__PURE__*/React.createElement("label", {
    className: "search-label"
  }, /*#__PURE__*/React.createElement("span", {
    className: "search-eyebrow"
  }, "Word lookup")), /*#__PURE__*/React.createElement("form", {
    className: "search-field",
    onSubmit: handleSubmit
  }, /*#__PURE__*/React.createElement(Icon.Search, {
    className: "search-icon"
  }), /*#__PURE__*/React.createElement("input", {
    className: "search-input",
    type: "text",
    value: query,
    onChange: e => setQuery(e.target.value),
    placeholder: "Greek, Hebrew, English, or Strong's (G4151, H7307)\u2026",
    autoFocus: true
  }), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "search-go",
    "aria-label": "Search",
    disabled: loading
  }, loading ? /*#__PURE__*/React.createElement("span", {
    className: "spinner"
  }) : /*#__PURE__*/React.createElement(Icon.ArrowRight, null))))), /*#__PURE__*/React.createElement("div", {
    className: "lexicon-toolbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lexicon-corpus-toggle"
  }, profile ?
  /*#__PURE__*/
  /* Drilled into a word: All is N/A (search-only); gray a corpus the
     word isn't in — but ABP stays live for backfilled proper nouns. */
  React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    className: "lct-btn",
    disabled: true,
    title: "Pick ABP or KJV to study this word"
  }, "All"), /*#__PURE__*/React.createElement("button", {
    className: "lct-btn" + (profileCorpus === "abp" ? " on" : ""),
    disabled: !profile.has_abp,
    onClick: () => switchProfileCorpus("abp")
  }, "ABP"), /*#__PURE__*/React.createElement("button", {
    className: "lct-btn" + (profileCorpus === "kjv" ? " on" : ""),
    disabled: !profile.has_kjv,
    onClick: () => switchProfileCorpus("kjv")
  }, "KJV")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    className: "lct-btn" + (corpus === "all" ? " on" : ""),
    onClick: () => switchCorpus("all")
  }, "All"), /*#__PURE__*/React.createElement("button", {
    className: "lct-btn" + (corpus === "abp" ? " on" : ""),
    onClick: () => switchCorpus("abp")
  }, "ABP"), /*#__PURE__*/React.createElement("button", {
    className: "lct-btn" + (corpus === "kjv" ? " on" : ""),
    onClick: () => switchCorpus("kjv")
  }, "KJV"))), /*#__PURE__*/React.createElement("div", {
    className: "lexicon-corpus-toggle"
  }, ["all", "ot", "nt"].map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    className: "lct-btn" + (testament === t ? " on" : ""),
    onClick: () => switchTestament(t)
  }, t === "all" ? "All" : t.toUpperCase())))), error && /*#__PURE__*/React.createElement("p", {
    className: "lexicon-error"
  }, error), matches && !profile && /*#__PURE__*/React.createElement("div", {
    className: "lexicon-matches"
  }, matches.map(m => /*#__PURE__*/React.createElement("button", {
    key: m.strongs,
    className: "lexicon-match-row",
    onClick: () => loadProfile(m.strongs)
  }, /*#__PURE__*/React.createElement("span", {
    className: "lexicon-match-strongs"
  }, m.strongs), /*#__PURE__*/React.createElement("span", {
    className: "lexicon-match-lemma"
  }, m.lemma), /*#__PURE__*/React.createElement("span", {
    className: "lexicon-match-translit"
  }, m.translit), /*#__PURE__*/React.createElement("span", {
    className: "lexicon-match-gloss"
  }, m.gloss)))), groupings && !profile && /*#__PURE__*/React.createElement("div", {
    className: "lexicon-results"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lexicon-dist-label"
  }, "rendered as \"", query.trim(), "\" \xB7 ", groupings.length, " ", groupings.length === 1 ? "word" : "words"), groupings.map(g => /*#__PURE__*/React.createElement("button", {
    key: g.strongs,
    className: "lexicon-result-row",
    onClick: () => loadProfile(g.strongs, corpus === "all" ? undefined : corpus)
  }, /*#__PURE__*/React.createElement("span", {
    className: "lexicon-result-topbar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lexicon-result-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lexicon-match-strongs"
  }, g.strongs), g.lemma && /*#__PURE__*/React.createElement("span", {
    className: "lexicon-match-lemma",
    dir: g.strongs[0] === "H" ? "rtl" : undefined
  }, g.lemma), g.translit && /*#__PURE__*/React.createElement("span", {
    className: "lexicon-match-translit"
  }, g.translit)), /*#__PURE__*/React.createElement("span", {
    className: "lexicon-result-end"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lexicon-result-count"
  }, g.count), /*#__PURE__*/React.createElement("span", {
    className: "lexicon-result-chev"
  }, "\u203A"))), /*#__PURE__*/React.createElement("span", {
    className: "lexicon-result-preview"
  }, renderRowPreview(g))))), profile && /*#__PURE__*/React.createElement("div", {
    className: "lexicon-profile"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lexicon-profile-header"
  }, (groupings || matches) && /*#__PURE__*/React.createElement("button", {
    className: "lexicon-back-btn",
    title: `Back to "${query.trim()}" results`,
    onClick: () => {
      setProfile(null);
      setSelectedBook(null);
      setVerseList(null);
    }
  }, "\u2190"), /*#__PURE__*/React.createElement("span", {
    className: "lexicon-lemma",
    dir: profile.strongs[0] === "H" ? "rtl" : undefined
  }, profile.lemma), /*#__PURE__*/React.createElement("span", {
    className: "lexicon-translit"
  }, profile.translit), /*#__PURE__*/React.createElement("span", {
    className: "lexicon-strongs-tag"
  }, profile.strongs), /*#__PURE__*/React.createElement("span", {
    className: "lexicon-total"
  }, testament === "all" ? profile.total : (filteredBooks || profile.books).filter(b => (b.testament || "").toLowerCase() === testament).reduce((s, b) => s + b.count, 0), " occurrences")), (profile.definition || /^G/i.test(profile.strongs)) && /*#__PURE__*/React.createElement("div", {
    className: "lexicon-def-section"
  }, /*#__PURE__*/React.createElement("button", {
    className: "lexicon-def-toggle",
    onClick: () => setShowDef(v => !v)
  }, "Definition", showDef && (!/^G/i.test(profile.strongs) ? /*#__PURE__*/React.createElement("span", {
    className: "lexicon-def-src"
  }, "BDB") : !lsjLoading && lsjEntry ? /*#__PURE__*/React.createElement("span", {
    className: "lexicon-def-src"
  }, lsjEntry.source === "strongs" ? "Strong's" : lsjEntry.source === "abp_ext" ? "ABP" : "LSJ") : null), " ", showDef ? "▲" : "▼"), showDef && (!/^G/i.test(profile.strongs) ? /*#__PURE__*/React.createElement("p", {
    className: "lexicon-definition"
  }, profile.definition) /* Hebrew: BDB */ : lsjLoading ? /*#__PURE__*/React.createElement("div", {
    className: "lsj-def lsj-def--loading"
  }, "Loading\u2026") : !lsjEntry ? /*#__PURE__*/React.createElement("p", {
    className: "lexicon-definition"
  }, profile.definition) /* no LSJ: strongs_def */ : lsjEntry.source === "strongs" ? /*#__PURE__*/React.createElement("div", {
    className: "lsj-def",
    dangerouslySetInnerHTML: {
      __html: lsjEntry.def_html
    }
  }) : lsjSummaryLoading ? /*#__PURE__*/React.createElement(LsjSummary, {
    data: null,
    loading: true
  }) : lsjSummary && lsjSummary.summary ? /*#__PURE__*/React.createElement(LsjSummary, {
    data: lsjSummary,
    loading: false
  }) : /*#__PURE__*/React.createElement("div", {
    className: "lsj-def",
    dangerouslySetInnerHTML: {
      __html: lsjEntry.def_html
    }
  }) /* AI down: raw LSJ */)), selectedBook ? (bookGlosses || profile.glosses) && (bookGlosses || profile.glosses).length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "lexicon-glosses"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lexicon-gloss-label"
  }, "In this book"), /*#__PURE__*/React.createElement("div", {
    className: "lexicon-dist-list"
  }, (bookGlosses || profile.glosses).map((g, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: g.gloss
  }, i > 0 && /*#__PURE__*/React.createElement("span", {
    className: "lexicon-dist-sep"
  }, " \xB7 "), /*#__PURE__*/React.createElement("button", {
    className: "lexicon-dist-item" + (selectedGloss === g.gloss ? " selected" : ""),
    onClick: () => selectGloss(g.gloss)
  }, g.gloss, /*#__PURE__*/React.createElement("span", {
    className: "lexicon-dist-count"
  }, g.count)))))) : /*#__PURE__*/React.createElement(React.Fragment, null, renderGlossLine("abp", "ABP renders this as", profile.abp_glosses), renderGlossLine("kjv", "KJV renders this as", profile.kjv_glosses)), /*#__PURE__*/React.createElement("div", {
    className: "lexicon-distribution"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lexicon-dist-header"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lexicon-dist-label"
  }, "Distribution by book")), /*#__PURE__*/React.createElement("div", {
    className: "lexicon-dist-list"
  }, (filteredBooks || profile.books).filter(b => testament === "all" || (b.testament || "").toLowerCase() === testament).map((b, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: b.book
  }, i > 0 && /*#__PURE__*/React.createElement("span", {
    className: "lexicon-dist-sep"
  }, " \xB7 "), /*#__PURE__*/React.createElement("button", {
    className: "lexicon-dist-item" + (selectedBook === b.book ? " selected" : ""),
    onClick: () => selectBook(b.book)
  }, b.name, /*#__PURE__*/React.createElement("span", {
    className: "lexicon-dist-count"
  }, b.count)))))), selectedBook && /*#__PURE__*/React.createElement("div", {
    className: "corpus-groups"
  }, verseLoading ? /*#__PURE__*/React.createElement("div", {
    className: "lexicon-verse-loading"
  }, "Loading\u2026") : verseList && verseList[0] && verseList[0].error ? /*#__PURE__*/React.createElement("div", {
    className: "lexicon-verse-loading",
    style: {
      color: "red"
    }
  }, verseList[0].error) : verseList && verseList.length ? /*#__PURE__*/React.createElement(CorpusGroup, {
    label: profile.books.find(b => b.book === selectedBook)?.name || selectedBook,
    verses: verseList.map(v => ({
      book: selectedBook,
      chapter: v.chapter,
      verse: v.verse,
      ref: `${selectedBook} ${v.chapter}:${v.verse}`
    })),
    allResults: [],
    onWordClick: onWordClick,
    onReadInContext: onNavigateToLibrary ? (b, c, vv) => onNavigateToLibrary(b, c, vv, profileCorpus) : undefined,
    textMode: profileCorpus === "kjv" ? "kjv" : "greek",
    primaryStrongs: null,
    citedStrongs: citedStrongs,
    kjvCache: {}
  }) : /*#__PURE__*/React.createElement("div", {
    className: "lexicon-verse-loading"
  }, "No verses."))));
}

// ============================================================
// STATS — owner-only visitor dashboard (in-house, from notes.db)
// ============================================================
function StatCard({
  n,
  label
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "stats-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stats-card-n"
  }, n != null ? n.toLocaleString() : "—"), /*#__PURE__*/React.createElement("div", {
    className: "stats-card-l"
  }, label));
}
function StatsView() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.stats().then(d => {
      if (cancelled) return;
      if (d) setData(d);else setErr(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (err) return /*#__PURE__*/React.createElement("div", {
    className: "stats-view"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stats-empty"
  }, "Couldn't load stats."));
  if (!data) return /*#__PURE__*/React.createElement("div", {
    className: "stats-view"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stats-empty"
  }, "Loading\u2026"));
  const maxV = Math.max(1, ...data.by_day.map(d => d.views));
  return /*#__PURE__*/React.createElement("div", {
    className: "stats-view"
  }, /*#__PURE__*/React.createElement("h1", {
    className: "stats-title"
  }, "Visitors"), /*#__PURE__*/React.createElement("div", {
    className: "stats-sub"
  }, "Your own visits aren't counted. No cookies, no IPs stored."), /*#__PURE__*/React.createElement("div", {
    className: "stats-cards"
  }, /*#__PURE__*/React.createElement(StatCard, {
    n: data.unique_visitors,
    label: "Unique visitors"
  }), /*#__PURE__*/React.createElement(StatCard, {
    n: data.total_views,
    label: "Total views"
  }), /*#__PURE__*/React.createElement(StatCard, {
    n: data.today,
    label: "Today"
  }), /*#__PURE__*/React.createElement(StatCard, {
    n: data.last7,
    label: "Last 7 days"
  }), /*#__PURE__*/React.createElement(StatCard, {
    n: data.last30,
    label: "Last 30 days"
  })), /*#__PURE__*/React.createElement("div", {
    className: "stats-section-title"
  }, "Views \u2014 last 30 days"), data.by_day.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "stats-empty"
  }, "No visits yet.") : /*#__PURE__*/React.createElement("div", {
    className: "stats-bars"
  }, data.by_day.map(d => /*#__PURE__*/React.createElement("div", {
    key: d.day,
    className: "stats-bar-col",
    title: `${d.day} · ${d.views} views · ${d.uniques} unique`
  }, /*#__PURE__*/React.createElement("div", {
    className: "stats-bar",
    style: {
      height: Math.max(2, Math.round(d.views / maxV * 100)) + "%"
    }
  })))), /*#__PURE__*/React.createElement("div", {
    className: "stats-section-title"
  }, "Top referrers"), data.top_ref.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "stats-empty"
  }, "None yet.") : /*#__PURE__*/React.createElement("div", {
    className: "stats-refs"
  }, data.top_ref.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.ref,
    className: "stats-ref-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "stats-ref-name"
  }, r.ref), /*#__PURE__*/React.createElement("span", {
    className: "stats-ref-n"
  }, r.n.toLocaleString())))));
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
  // Remember the active tab across refreshes (guard against a stale/removed value).
  const _VIEWS = ["library", "lexicon", "search", "notes", "about"];
  const [mainView, setMainView] = useState(() => {
    try {
      const v = localStorage.getItem("lexica.view.v1");
      return _VIEWS.includes(v) ? v : "library";
    } catch (e) {
      return "library";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("lexica.view.v1", mainView);
    } catch (e) {}
  }, [mainView]);
  const [libNav, setLibNav] = useState(null);
  const [libCrossRef, setLibCrossRef] = useState(null);
  const [lexiconPendingStrongs, setLexiconPendingStrongs] = useState(null);
  const [libTranslation, setLibTranslation] = useState("abp");
  const [activeNote, setActiveNote] = useState(null); // note id being edited

  // Open a note's editor — closes the word / cross-ref panels so one panel owns the slot.
  const openNote = id => {
    setActiveEntry(null);
    setLibCrossRef(null);
    setActiveNote(id);
  };
  // From the Notes tab: jump to the verse in the Library, then open the editor.
  const openNoteFromList = n => {
    if (n.corpus === "bible") {
      searchScrollRef.current = window.scrollY;
      setLibEverVisited(true);
      setMainView("library");
      setLibNav({
        book: n.book,
        chapter: n.chapter,
        highlight: n.start.verse,
        scroll: true,
        translation: n.translation === "kjv" ? "kjv" : "abp"
      });
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
    setLibCrossRef({
      book,
      chapter,
      verse,
      translation: translation || "abp"
    });
    setLibNav(prev => ({
      ...(prev || {}),
      book,
      chapter,
      highlight: verse
    }));
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
    if (mode === "ai" && aiMeta && aiMeta.keyStrongs && aiMeta.keyStrongs.length > 0) return aiMeta.keyStrongs;
    return null;
  }, [mode, aiMeta]);

  // Compute citedStrongs at App level — single source of truth, no prop-threading issues
  const citedStrongsApp = useMemo(() => {
    if (!primaryStrongs || !primaryStrongs.length) return null;
    const s = new Set();
    for (const p of primaryStrongs) {
      if (p.strongs_base) {
        const bare = strongsBare(p.strongs_base);
        s.add(p.strongs_base); // as-is (e.g. "4151" or "G4151")
        s.add(bare); // bare (e.g. "4151")
        s.add(`G${bare}`); // G-prefixed
        s.add(`H${bare}`); // H-prefixed
      }
    }
    return s.size > 0 ? s : null;
  }, [primaryStrongs]);

  // Count of distinct primary verses (AI mode only)
  const primaryVerseCount = useMemo(() => {
    if (mode !== "ai") return null;
    const seen = new Set();
    for (const e of allResults) {
      if (e.is_primary) seen.add(e.ref);
    }
    return seen.size;
  }, [allResults, mode]);
  const [showTour, setShowTour] = useState(() => {
    try {
      return !localStorage.getItem("lexica_tour_seen");
    } catch {
      return false;
    }
  });
  const handleTourDone = () => {
    try {
      localStorage.setItem("lexica_tour_seen", "1");
    } catch {}
    setShowTour(false);
  };
  const [libEverVisited, setLibEverVisited] = useState(true);
  const searchScrollRef = useRef(0);

  // Visitor stats: count this page load once (the server skips the owner's own
  // visits), and figure out whether the logged-in user is the owner so we can show
  // the private Stats tab. Re-check only when the signed-in email actually changes.
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    api.statsHit();
  }, []);
  useEffect(() => {
    let last;
    const check = () => {
      let email = null;
      try {
        email = (NotesStore.authInfo() || {}).email || null;
      } catch (e) {}
      if (email === last) return;
      last = email;
      api.statsOwner().then(d => setOwner(!!(d && d.owner)));
    };
    check();
    return NotesStore.subscribe(check); // setAuth notifies on login/logout
  }, []);
  const handleReadInContext = (book, chapter, verse) => {
    searchScrollRef.current = window.scrollY;
    setLibNav({
      book,
      chapter,
      highlight: verse,
      scroll: true
    });
    setLibEverVisited(true);
    setMainView("library");
  };
  const handleNavChange = view => {
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
    setActiveEntry(null); // close the word panel (bottom sheet on mobile) before showing the lexicon
    setLibCrossRef(null);
    setLexiconPendingStrongs({
      strongs,
      corpus
    }); // corpus: "abp" | "kjv" | undefined (default by language)
    handleNavChange("lexicon");
  };
  const handleAiSearch = async overrideQ => {
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
        setAiMeta({
          query: q,
          explanation: data.explanation || "",
          total: data.total || 0,
          keyStrongs: data.key_strongs || []
        });
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
  return /*#__PURE__*/React.createElement("div", {
    className: "app view-" + mainView + " " + (activeEntry || libCrossRef || activeNote || showLibSummary ? "has-detail" : "")
  }, /*#__PURE__*/React.createElement(Header, {
    activeView: mainView,
    onNavChange: handleNavChange
  }), isMobile && mainView !== "library" && /*#__PURE__*/React.createElement("div", {
    className: "mobile-brand-bar"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5a2.5 2.5 0 0 0 0 5H19v-3",
    stroke: "currentColor",
    strokeWidth: "1.6",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M11 7v6M14 10h-6",
    stroke: "currentColor",
    strokeWidth: "1.6",
    strokeLinecap: "round"
  })), /*#__PURE__*/React.createElement("span", {
    className: "mobile-brand-name"
  }, "Lexica"), /*#__PURE__*/React.createElement("span", {
    className: "mobile-brand-sub"
  }, "Greek & Hebrew Word Study")), /*#__PURE__*/React.createElement("main", {
    className: "main"
  }, libEverVisited && /*#__PURE__*/React.createElement("div", {
    style: {
      display: mainView === "library" ? undefined : "none"
    }
  }, /*#__PURE__*/React.createElement(LibraryView, {
    nav: libNav,
    onNavChange: setLibNav,
    onWordClick: e => {
      setLibCrossRef(null);
      setActiveNote(null);
      setActiveEntry(e);
    },
    onVerseNumberClick: handleVerseNumberClick,
    onOpenNote: openNote,
    onTranslationChange: setLibTranslation,
    isMobile: isMobile,
    showSummary: showLibSummary
  })), mainView === "about" && /*#__PURE__*/React.createElement(AboutView, {
    owner: owner
  }), mainView === "notes" && /*#__PURE__*/React.createElement(NotesView, {
    onOpen: openNoteFromList
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: mainView === "lexicon" ? undefined : "none"
    }
  }, /*#__PURE__*/React.createElement(LexiconView, {
    onNavigateToSearch: q => {
      handleNavChange("search");
      setQ2(q);
    },
    onNavigateToLibrary: (book, chapter, verse, corpus) => {
      searchScrollRef.current = window.scrollY;
      setLibNav({
        book,
        chapter,
        highlight: verse,
        scroll: true,
        translation: corpus === "kjv" ? "kjv" : "abp"
      });
      setLibEverVisited(true);
      setMainView("library");
    },
    onWordClick: e => setActiveEntry(e),
    pendingStrongs: lexiconPendingStrongs,
    onPendingStrongsConsumed: () => setLexiconPendingStrongs(null),
    isMobile: isMobile
  })), /*#__PURE__*/React.createElement("div", {
    className: "main-inner",
    style: {
      display: mainView === "library" || mainView === "about" || mainView === "lexicon" || mainView === "notes" ? "none" : undefined
    }
  }, /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(SearchBar, {
    q2: q2,
    setQ2: setQ2,
    onAiSearch: handleAiSearch,
    aiLoading: aiLoading
  }), aiNotice && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "14px",
      padding: "12px 16px",
      background: "var(--accent-soft, #f0f4ff)",
      border: "1px solid var(--accent, #b0bfff)",
      borderRadius: "10px",
      color: "var(--ink-2, #444)",
      fontSize: "14px"
    }
  }, aiNotice), error && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "14px",
      padding: "12px 16px",
      background: "#fef2f2",
      border: "1px solid #fecaca",
      borderRadius: "10px",
      color: "#b91c1c",
      fontSize: "14px"
    }
  }, error), aiMeta && /*#__PURE__*/React.createElement(AIAnswer, {
    query: aiMeta.query,
    explanation: aiMeta.explanation,
    keyStrongs: aiMeta.keyStrongs || [],
    onPick: e => setActiveEntry(e)
  }), mode === "ai" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "results-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "results-meta"
  }, /*#__PURE__*/React.createElement("span", {
    className: "results-count"
  }, loading || aiLoading ? "…" : primaryVerseCount), /*#__PURE__*/React.createElement("span", {
    className: "results-label"
  }, "primary ", primaryVerseCount === 1 ? "verse" : "verses"), !loading && aiMeta && aiMeta.total > primaryVerseCount && /*#__PURE__*/React.createElement("button", {
    className: "see-all-link",
    onClick: () => setShowAllAi(v => !v)
  }, showAllAi ? "Show less" : `See all ${aiMeta.total} occurrences`), searchLabel && !aiLoading && /*#__PURE__*/React.createElement("span", {
    className: "results-for"
  }, "for \"", /*#__PURE__*/React.createElement("b", null, searchLabel), "\"")), /*#__PURE__*/React.createElement("div", {
    className: "results-controls",
    style: {
      marginLeft: "auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "results-sort"
  }, /*#__PURE__*/React.createElement("button", {
    className: "sort-btn " + (corpusFilter === "all" ? "on" : ""),
    onClick: () => setCorpusFilter("all")
  }, "All"), /*#__PURE__*/React.createElement("button", {
    className: "sort-btn " + (corpusFilter === "ot" ? "on" : ""),
    onClick: () => setCorpusFilter("ot")
  }, "OT"), /*#__PURE__*/React.createElement("button", {
    className: "sort-btn " + (corpusFilter === "nt" ? "on" : ""),
    onClick: () => setCorpusFilter("nt")
  }, "NT"), /*#__PURE__*/React.createElement("span", {
    style: {
      margin: "0 4px",
      color: "var(--rule-2)"
    }
  }, "|"), /*#__PURE__*/React.createElement("button", {
    className: "sort-btn " + (corpusSort === "curated" ? "on" : ""),
    onClick: () => setCorpusSort("curated")
  }, "Curated"), /*#__PURE__*/React.createElement("button", {
    className: "sort-btn " + (corpusSort === "canonical" ? "on" : ""),
    onClick: () => setCorpusSort("canonical")
  }, "Canonical"), /*#__PURE__*/React.createElement("span", {
    style: {
      margin: "0 4px",
      color: "var(--rule-2)"
    }
  }, "|"), /*#__PURE__*/React.createElement("button", {
    className: "sort-btn " + (corpusTextMode === "abp" ? "on" : ""),
    onClick: () => setCorpusTextMode("abp")
  }, "ABP"), /*#__PURE__*/React.createElement("button", {
    className: "sort-btn " + (corpusTextMode === "kjv" ? "on" : ""),
    onClick: () => setCorpusTextMode("kjv")
  }, "KJV")))), loading || aiLoading ? /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      padding: "60px 20px",
      color: "var(--ink-3)",
      fontSize: "14px"
    }
  }, "Searching\u2026") : /*#__PURE__*/React.createElement(CorpusResults, {
    allResults: corpusFilteredResults,
    primaryStrongs: primaryStrongs,
    citedStrongs: citedStrongsApp,
    showAll: showAllAi,
    onWordClick: e => setActiveEntry(e),
    onReadInContext: handleReadInContext,
    corpusSort: corpusSort,
    textMode: corpusTextMode
  })), /*#__PURE__*/React.createElement("footer", {
    className: "foot"
  }, /*#__PURE__*/React.createElement("span", null, "Lexica \xB7 Greek Septuagint (LXX) \xB7 Apostolic Bible Polyglot Interlinear \xB7 Strong's Greek"))))), activeEntry && !isMobile && /*#__PURE__*/React.createElement(DetailPanel, {
    entry: activeEntry,
    isMobile: false,
    onClose: () => setActiveEntry(null),
    occurrences: countMap[activeEntry.strongs_raw] || 0,
    totalResults: allResults.length,
    onNavigateToLexicon: handleNavigateToLexicon,
    onReadInContext: handleReadInContext,
    overviewBack: mainView === "library"
  }), activeEntry && isMobile && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "sheet-scrim",
    onClick: () => setActiveEntry(null)
  }), /*#__PURE__*/React.createElement(DetailPanel, {
    entry: activeEntry,
    isMobile: true,
    onClose: () => setActiveEntry(null),
    occurrences: countMap[activeEntry.strongs_raw] || 0,
    totalResults: allResults.length,
    onNavigateToLexicon: handleNavigateToLexicon,
    onReadInContext: handleReadInContext
  })), activeNote && /*#__PURE__*/React.createElement(NotesPanel, {
    noteId: activeNote,
    isMobile: isMobile,
    onClose: () => setActiveNote(null)
  }), libCrossRef && !isMobile && /*#__PURE__*/React.createElement(CrossRefPanel, {
    source: libCrossRef,
    translation: libTranslation === "kjv" ? "kjv" : "abp",
    onClose: () => {
      setLibCrossRef(null);
      setLibNav(prev => prev ? {
        ...prev,
        highlight: null
      } : prev);
    },
    onNavigate: (book, chapter, verse) => {
      setMainView("library");
      setLibCrossRef(null);
      setLibNav({
        book,
        chapter,
        scroll: true,
        highlight: verse
      });
    },
    onAiSearch: q => {
      setLibCrossRef(null);
      handleAiSearch(q);
    },
    isMobile: false,
    overviewBack: true
  }), libCrossRef && isMobile && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "sheet-scrim",
    onClick: () => {
      setLibCrossRef(null);
      setLibNav(prev => prev ? {
        ...prev,
        highlight: null
      } : prev);
    }
  }), /*#__PURE__*/React.createElement(CrossRefPanel, {
    source: libCrossRef,
    translation: libTranslation === "kjv" ? "kjv" : "abp",
    onClose: () => {
      setLibCrossRef(null);
      setLibNav(prev => prev ? {
        ...prev,
        highlight: null
      } : prev);
    },
    onNavigate: (book, chapter, verse) => {
      setMainView("library");
      setLibCrossRef(null);
      setLibNav({
        book,
        chapter,
        scroll: true,
        highlight: verse
      });
    },
    onAiSearch: q => {
      setLibCrossRef(null);
      handleAiSearch(q);
    },
    isMobile: true
  })), showTour && /*#__PURE__*/React.createElement(GuidedTour, {
    onDone: handleTourDone
  }), isMobile && /*#__PURE__*/React.createElement("nav", {
    className: "mobile-tabs"
  }, /*#__PURE__*/React.createElement("button", {
    className: "mobile-tab" + (mainView === "library" ? " active" : ""),
    onClick: () => handleNavChange("library")
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5a2.5 2.5 0 0 0 0 5H19v-3"
  })), "Library"), /*#__PURE__*/React.createElement("button", {
    className: "mobile-tab" + (mainView === "lexicon" ? " active" : ""),
    onClick: () => handleNavChange("lexicon")
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 19V6a2 2 0 0 1 2-2h13"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M4 19a2 2 0 0 0 2 2h13V8H6a2 2 0 0 0-2 2"
  })), "Lexicon"), /*#__PURE__*/React.createElement("button", {
    className: "mobile-tab" + (mainView === "search" ? " active" : ""),
    onClick: () => handleNavChange("search")
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "11",
    r: "7"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "16.5",
    y1: "16.5",
    x2: "21",
    y2: "21"
  })), "Search"), /*#__PURE__*/React.createElement("button", {
    className: "mobile-tab" + (mainView === "notes" ? " active" : ""),
    onClick: () => handleNavChange("notes")
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M6 3h12v18l-6-4-6 4z"
  })), "Notes"), /*#__PURE__*/React.createElement("button", {
    className: "mobile-tab" + (mainView === "about" ? " active" : ""),
    onClick: () => handleNavChange("about")
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "8",
    x2: "12",
    y2: "8.5"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "12",
    x2: "12",
    y2: "16"
  })), "About")));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));
