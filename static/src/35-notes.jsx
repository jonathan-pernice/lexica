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
function NoteAddPopover({ rect, isMobile, onAdd, onColor }) {
  if (!rect) return null;
  let style;
  if (isMobile) {
    style = { position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 72, zIndex: 1000 };
  } else {
    const W = 232;
    style = {
      position: "fixed",
      top: Math.max(8, rect.top - 48),
      left: Math.min(window.innerWidth - W - 8, Math.max(8, rect.left + rect.width / 2 - W / 2)),
      zIndex: 1000,
    };
  }
  // preventDefault on mousedown so pressing a button doesn't clear the selection
  return (
    <div className={"note-popover" + (isMobile ? " note-popover-mobile" : "")} style={style} onMouseDown={(e) => e.preventDefault()}>
      <div className="note-swatches">
        {NOTE_COLORS.map(c => (
          <button key={c} className="note-swatch" style={{ background: NOTE_COLOR_CSS[c] }}
            title={"Highlight " + c} aria-label={"Highlight " + c} onClick={() => onColor(c)} />
        ))}
      </div>
      <button className="note-popover-btn" onClick={onAdd}>
        <Icon.Bookmark/> Note
      </button>
    </div>
  );
}

// Menu shown when you right-click / long-press a verse number: Bookmark · Note · colors.
function VerseNoteMenu({ rect, isMobile, onBookmark, onNote, onColor, onClose }) {
  if (!rect) return null;
  let style;
  if (isMobile) {
    style = { position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 72, zIndex: 1000 };
  } else {
    const W = 270;
    style = {
      position: "fixed",
      top: Math.min(window.innerHeight - 56, rect.top + rect.height + 6),
      left: Math.min(window.innerWidth - W - 8, Math.max(8, rect.left)),
      zIndex: 1000,
    };
  }
  return (
    <>
      <div className="note-menu-scrim" onClick={onClose} />
      <div className={"note-popover" + (isMobile ? " note-popover-mobile" : "")} style={style} onMouseDown={(e) => e.preventDefault()}>
        <button className="note-popover-btn" onClick={onBookmark}><Icon.Bookmark/> Bookmark</button>
        <button className="note-popover-btn" onClick={onNote}>✎ Note</button>
        <div className="note-swatches">
          {NOTE_COLORS.map(c => (
            <button key={c} className="note-swatch" style={{ background: NOTE_COLOR_CSS[c] }}
              title={"Highlight " + c} aria-label={"Highlight " + c} onClick={() => onColor(c)} />
          ))}
        </div>
      </div>
    </>
  );
}

// A row of color swatches + a clear button, for the editor.
function NoteColorRow({ value, onPick }) {
  return (
    <div className="note-color-row">
      {NOTE_COLORS.map(c => (
        <button key={c}
          className={"note-swatch" + (value === c ? " on" : "")}
          style={{ background: NOTE_COLOR_CSS[c] }}
          title={"Highlight " + c} aria-label={"Highlight " + c}
          onClick={() => onPick(value === c ? null : c)} />
      ))}
      <button className={"note-swatch note-swatch-none" + (!value ? " on" : "")}
        title="No highlight" aria-label="No highlight" onClick={() => onPick(null)}>✕</button>
    </div>
  );
}

// Write / edit / delete a single note. Reuses the .detail shell.
function NotesPanel({ noteId, isMobile, onClose }) {
  const note = NotesStore.get(noteId);
  const [body, setBody] = useState(note ? (note.body || "") : "");
  const [color, setColor] = useState(note ? (note.color || null) : null);
  const [bookmark, setBookmark] = useState(note ? !!note.bookmark : false);
  const taRef = useRef(null);

  useEffect(() => {
    setBody(note ? (note.body || "") : "");
    setColor(note ? (note.color || null) : null);
    setBookmark(note ? !!note.bookmark : false);
    // Desktop: focus the box right away. Mobile: DON'T — auto-popping the
    // on-screen keyboard covers a freshly opened sheet. The user taps to type.
    if (!isMobile) requestAnimationFrame(() => taRef.current && taRef.current.focus());
  }, [noteId]);

  const save = () => { NotesStore.update(noteId, { body, color, bookmark }); onClose(); };
  const del = () => { NotesStore.remove(noteId); onClose(); };
  // Closing a record that's blank AND uncolored AND not bookmarked discards it
  // (id minted on create, so a thrown-away draft shouldn't linger).
  const close = () => {
    if (!body.trim() && !color && !bookmark) NotesStore.remove(noteId);
    else NotesStore.update(noteId, { body, color, bookmark });
    onClose();
  };
  // Swipe-down-to-close on mobile (same hook the word / xref / summary sheets use).
  const { sheetRef, scrollRef } = useSwipeToDismiss(close);

  if (!note) return null;

  const head = (
    <div className="detail-head">
      <div className="detail-head-l">
        <span className="detail-pos">{note.refLabel || (note.book + " " + note.chapter)}</span>
      </div>
      <button className={"note-bm-toggle" + (bookmark ? " on" : "")} onClick={() => setBookmark(b => !b)}
        title={bookmark ? "Bookmarked" : "Bookmark this"} aria-label="Toggle bookmark" aria-pressed={bookmark}>
        <Icon.Bookmark/>
      </button>
      <button className="detail-close" onClick={close} aria-label="Close"><Icon.Close/></button>
    </div>
  );
  const content = (
    <div className="detail-body note-edit-body" ref={isMobile ? scrollRef : undefined}>
      {note.snippet && <blockquote className="note-snippet">“{note.snippet}”</blockquote>}
      <NoteColorRow value={color} onPick={setColor} />
      <textarea
        ref={taRef}
        className="note-textarea"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write your note…"
      />
      <div className="note-actions">
        <button className="note-save" onClick={save}>Save</button>
        <button className="note-del" onClick={del}>Delete</button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <>
        <div className="sheet-scrim" onClick={close}/>
        <aside ref={sheetRef} className="detail detail-sheet note-sheet" role="dialog" aria-label="Note">
          <div className="sheet-drag-zone" aria-hidden="true"><div className="sheet-handle"></div></div>
          {head}
          {content}
        </aside>
      </>
    );
  }
  return (
    <aside className="detail detail-side note-side" role="complementary" aria-label="Note">
      {head}
      {content}
    </aside>
  );
}

// The Notes tab — list + search of every saved note.
function NotesView({ onOpen }) {
  useNotesVersion();
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("all");   // all | bookmark | highlight | note
  const [sort, setSort] = useState("recent");     // recent | ref
  const [group, setGroup] = useState(false);      // group by book
  const [collapsed, setCollapsed] = useState(() => new Set());   // collapsed book keys
  const toggleSection = (key) => setCollapsed(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const acct = NotesStore.authInfo();
  const fileRef = useRef(null);
  let notes = NotesStore.search(q);               // already newest-first
  if (filter === "bookmark") notes = notes.filter(n => n.bookmark);
  else if (filter === "highlight") notes = notes.filter(n => n.color);
  else if (filter === "note") notes = notes.filter(n => n.body && n.body.trim());

  // Canonical order: Bible books by BOOK_ORDER, non-canon after, by name.
  const bookRank = (n) => (BOOK_ORDER[n.book] != null ? BOOK_ORDER[n.book] : 1000);
  const byRef = (a, b) => {
    const ra = bookRank(a), rb = bookRank(b);
    if (ra !== rb) return ra - rb;
    const na = a.bookName || a.book, nb = b.bookName || b.book;
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
      if (!map.has(n.book)) map.set(n.book, { key: n.book, label: BOOK_LABELS[n.book] || n.bookName || n.book, rank: bookRank(n), items: [] });
      map.get(n.book).items.push(n);
    }
    sections = [...map.values()].sort((a, b) => (a.rank - b.rank) || a.label.localeCompare(b.label));
    sections.forEach(s => s.items.sort(byRef));
  }

  const renderItem = (n) => (
    <li key={n.id} className="notes-item" onClick={() => onOpen(n)}>
      <div className="notes-item-ref">
        {n.color && <span className="notes-item-dot" style={{ background: NOTE_COLOR_CSS[n.color] }} />}
        {n.bookmark && <span className="notes-item-bm">★</span>}
        {n.refLabel || (n.book + " " + n.chapter)}
      </div>
      {n.snippet && <div className="notes-item-snippet">“{n.snippet}”</div>}
      {n.body && <div className="notes-item-body">{n.body}</div>}
    </li>
  );

  const doExport = () => {
    const data = JSON.stringify(NotesStore.exportData(), null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "lexica-notes-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const doImport = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const list = Array.isArray(parsed) ? parsed : (parsed.notes || []);
        const r = NotesStore.importMerge(list);
        setMsg(`Imported ${r.added} new, ${r.updated} updated${r.skipped ? ", " + r.skipped + " skipped" : ""}.`);
      } catch (err) { setMsg("Couldn't read that file."); }
    };
    reader.readAsText(file);
    e.target.value = "";   // let the same file be re-picked
  };

  return (
    <div className="notes-view">
      <div className="notes-view-head">
        <div className="notes-view-titlerow">
          <h2 className="notes-view-title">My Notes</h2>
          <div className="notes-tools">
            <button className="notes-tool-btn" onClick={doExport} disabled={NotesStore.all().length === 0}>Export</button>
            <button className="notes-tool-btn" onClick={() => fileRef.current && fileRef.current.click()}>Import</button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={doImport} />
          </div>
        </div>
        {msg && <div className="notes-msg">{msg}</div>}
        <div className="notes-sync">
          {acct.email ? (
            <>
              <span className="notes-sync-label">Signed in:</span>
              <span className="notes-acct-email">{acct.email}</span>
              <button className="notes-tool-btn" onClick={() => NotesStore.syncNow()} disabled={acct.syncing}>{acct.syncing ? "Syncing…" : "Sync now"}</button>
              <button className="notes-tool-btn" onClick={() => NotesStore.logout()}>Log out</button>
            </>
          ) : (
            <form className="notes-auth" onSubmit={(e) => e.preventDefault()}>
              <input className="notes-sync-input" type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input className="notes-sync-input" type="password" placeholder="Password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
              <button className="notes-tool-btn" onClick={async () => { const r = await NotesStore.login(email, pass); setMsg(r.ok ? "Signed in — syncing." : r.error); if (r.ok) { setEmail(""); setPass(""); } }}>Log in</button>
              <button className="notes-tool-btn" onClick={async () => { const r = await NotesStore.signup(email, pass); setMsg(r.ok ? "Account created — syncing." : r.error); if (r.ok) { setEmail(""); setPass(""); } }}>Sign up</button>
            </form>
          )}
        </div>
        {acct.email
          ? <div className="notes-sync-hint">Your notes sync to this account on every device you log into.</div>
          : <div className="notes-sync-hint">Optional — sign in to sync your notes across devices. Notes work fine without an account.</div>}
        <input
          className="notes-search"
          type="text"
          placeholder="Search your notes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="notes-controls">
          <div className="notes-filter seg">
            {[["all", "All"], ["bookmark", "★ Bookmarks"], ["highlight", "🎨 Highlights"], ["note", "✎ Notes"]].map(([k, lbl]) => (
              <button key={k} className={"seg-b" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{lbl}</button>
            ))}
          </div>
          <div className="seg">
            <button className={"seg-b" + (sort === "recent" ? " on" : "")} onClick={() => setSort("recent")}>Recent</button>
            <button className={"seg-b" + (sort === "ref" ? " on" : "")} onClick={() => setSort("ref")}>Reference</button>
          </div>
          <button className={"notes-tool-btn" + (group ? " on" : "")} onClick={() => setGroup(g => !g)}>Group by book</button>
        </div>
      </div>
      {notes.length === 0 ? (
        <div className="notes-empty">
          {q || filter !== "all"
            ? "Nothing matches that."
            : "No notes yet. In the Library, select some text in a verse and choose “Add note.”"}
        </div>
      ) : group ? (
        sections.map(s => {
          const open = !collapsed.has(s.key);
          return (
            <div key={s.key} className="notes-group">
              <button className={"notes-group-head" + (open ? " open" : "")} onClick={() => toggleSection(s.key)} aria-expanded={open}>
                <span className="notes-group-caret">▸</span>
                <span className="notes-group-label">{s.label}</span>
                <span className="notes-group-count">{s.items.length}</span>
              </button>
              {open && <ul className="notes-list">{s.items.map(renderItem)}</ul>}
            </div>
          );
        })
      ) : (
        <ul className="notes-list">{notes.map(renderItem)}</ul>
      )}
    </div>
  );
}
