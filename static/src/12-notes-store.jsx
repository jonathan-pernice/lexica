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
  yellow: "#ffe89e", green: "#bdeec0", blue: "#bfe0ff", pink: "#ffcfe1", orange: "#ffd6a6",
};

const NotesStore = (function () {
  const KEY = "lexica.notes.v1";
  const DEVKEY = "lexica.device.v1";
  const listeners = new Set();
  let cache = null;

  function load() {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { cache = []; }
    if (!Array.isArray(cache)) cache = [];
    return cache;
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* storage full / blocked */ }
    listeners.forEach(fn => { try { fn(); } catch (e) {} });
  }
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "n_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }
  // A stable per-browser id, made once — harmless now, helps a future account
  // merge tell this device's notes apart.
  function deviceId() {
    let d = null;
    try { d = localStorage.getItem(DEVKEY); } catch (e) {}
    if (!d) {
      d = newId();
      try { localStorage.setItem(DEVKEY, d); } catch (e) {}
    }
    return d;
  }

  return {
    // newest-edited first
    all() {
      return load().slice().sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
    },
    get(id) { return load().find(n => n.id === id) || null; },
    // An existing record pointing at the exact same words (same verse + word-spot
    // range), so we reuse it instead of stacking duplicates on the same text.
    findAnchor(a) {
      const sp = a.start.pos ?? null, ep = (a.end && a.end.pos) ?? null;
      const ev = (a.end && a.end.verse) || a.start.verse;
      return load().find(n =>
        n.corpus === a.corpus && n.book === a.book && n.chapter === a.chapter &&
        n.start.verse === a.start.verse && ((n.end && n.end.verse) || n.start.verse) === ev &&
        (n.start.pos ?? null) === sp && ((n.end && n.end.pos) ?? null) === ep
      ) || null;
    },
    // notes whose anchor lands in this chapter of this text
    forChapter(corpus, book, chapter) {
      return load().filter(n => n.corpus === corpus && n.book === book && n.chapter === chapter);
    },
    // anchor = { corpus, translation, book, bookName, chapter,
    //            start:{verse,pos}, end:{verse,pos}, snippet, refLabel }
    create(anchor) {
      const now = new Date().toISOString();
      const note = {
        id: newId(),
        device: deviceId(),
        body: "",
        color: null,          // highlight phase fills this
        created: now,
        updated: now,
        ...anchor,
      };
      load().push(note);
      persist();
      return note;
    },
    update(id, fields) {
      const n = this.get(id);
      if (!n) return null;
      Object.assign(n, fields, { updated: new Date().toISOString() });
      persist();
      return n;
    },
    remove(id) {
      cache = load().filter(n => n.id !== id);
      persist();
    },
    search(text) {
      const t = (text || "").toLowerCase().trim();
      const list = this.all();
      if (!t) return list;
      return list.filter(n =>
        (n.body || "").toLowerCase().includes(t) ||
        (n.snippet || "").toLowerCase().includes(t) ||
        (n.refLabel || "").toLowerCase().includes(t)
      );
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Backup: the saved file IS the migration format (same shape a server uses).
    exportData() {
      return { app: "lexica-notes", version: 1, exported: new Date().toISOString(), notes: load() };
    },
    // Restore / merge a backup. Each note carries its own id, so re-importing is
    // safe: same id = keep the newer copy, new id = add, nothing duplicates.
    importMerge(incoming) {
      if (!Array.isArray(incoming)) return { added: 0, updated: 0, skipped: 0 };
      const cur = load();
      const byId = new Map(cur.map(n => [n.id, n]));
      let added = 0, updated = 0, skipped = 0;
      for (const n of incoming) {
        if (!n || !n.id || !n.start) { skipped++; continue; }
        const ex = byId.get(n.id);
        if (!ex) { cur.push(n); byId.set(n.id, n); added++; }
        else if ((n.updated || "") > (ex.updated || "")) { Object.assign(ex, n); updated++; }
        else skipped++;
      }
      persist();
      return { added, updated, skipped };
    },
  };
})();

// Re-render a component whenever the note store changes.
function useNotesVersion() {
  const [, force] = useState(0);
  useEffect(() => NotesStore.subscribe(() => force(v => v + 1)), []);
}
