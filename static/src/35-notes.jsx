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
function NoteAddPopover({ rect, isMobile, onAdd, onColor, onCopy, onJournal }) {
  if (!rect) return null;
  let style;
  if (isMobile) {
    style = { position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 72, zIndex: 1000 };
  } else {
    const W = 360;
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
      <button className="note-popover-btn" onClick={onAdd}><Icon.Note/><span className="note-btn-lbl">Note</span></button>
      {onJournal && <button className="note-popover-btn" onClick={onJournal}><Icon.Book/><span className="note-btn-lbl">Journal</span></button>}
      {onCopy && <button className="note-popover-btn" onClick={onCopy}><Icon.Copy/><span className="note-btn-lbl">Copy</span></button>}
    </div>
  );
}

// Menu shown when you right-click / long-press a verse number: Bookmark · Note · colors.
function VerseNoteMenu({ rect, isMobile, onBookmark, onNote, onColor, onCopy, onJournal, onClose }) {
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
        <div className="note-swatches">
          {NOTE_COLORS.map(c => (
            <button key={c} className="note-swatch" style={{ background: NOTE_COLOR_CSS[c] }}
              title={"Highlight " + c} aria-label={"Highlight " + c} onClick={() => onColor(c)} />
          ))}
        </div>
        <button className="note-popover-btn" onClick={onNote}><Icon.Note/><span className="note-btn-lbl">Note</span></button>
        {onJournal && <button className="note-popover-btn" onClick={onJournal}><Icon.Book/><span className="note-btn-lbl">Journal</span></button>}
        {onCopy && <button className="note-popover-btn" onClick={onCopy}><Icon.Copy/><span className="note-btn-lbl">Copy</span></button>}
        <button className="note-popover-btn" onClick={onBookmark}><Icon.Bookmark/><span className="note-btn-lbl">Bookmark</span></button>
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

// One free-form journal page (plain text). No verse anchor — a title + a big
// box you type into. Autosaves as you write; rides the same store/sync as notes.
const JOURNAL_MAX = 60000;   // chars; stays safely under the server's 64KB page cap
function JournalEditor({ pageId, onBack }) {
  const page = NotesStore.get(pageId);
  const [title, setTitle] = useState(page ? (page.title || "") : "");
  const [body, setBody] = useState(page ? (page.body || "") : "");
  const saveTimer = useRef(null);
  const first = useRef(true);

  // This is now the page that "send verse to journal" (in the reader) targets.
  useEffect(() => { NotesStore.setActiveJournal(pageId); }, [pageId]);

  // Autosave ~0.8s after you stop typing. Skip the very first run so just
  // opening a page doesn't re-stamp it as edited.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { NotesStore.update(pageId, { title, body }); }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [title, body]);

  const back = () => {
    clearTimeout(saveTimer.current);
    // A page never given a title or any text is a thrown-away draft — discard it.
    if (!title.trim() && !body.trim()) NotesStore.remove(pageId);
    else NotesStore.update(pageId, { title, body });
    onBack();
  };
  const del = () => { clearTimeout(saveTimer.current); NotesStore.remove(pageId); onBack(); };

  if (!page) { onBack(); return null; }
  const near = body.length > JOURNAL_MAX - 2000;

  return (
    <div className="journal-editor">
      <div className="journal-editor-bar">
        <button className="notes-tool-btn" onClick={back}>‹ Back</button>
        <button className="note-del" onClick={del}>Delete</button>
      </div>
      <input
        className="journal-title-input"
        type="text"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Page title"
      />
      <textarea
        className="journal-textarea"
        value={body}
        maxLength={JOURNAL_MAX}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write freely — thoughts, questions, an outline, a study…"
      />
      <div className={"journal-count" + (near ? " warn" : "")}>
        {body.length.toLocaleString()} characters{near ? " — near the page limit; start a new page for more" : ""}
      </div>
    </div>
  );
}

// The Journal side of the Notes tab — a list of free-form pages + an editor.
function JournalView() {
  useNotesVersion();
  const [editing, setEditing] = useState(null);
  const pages = NotesStore.journals();

  if (editing) return <JournalEditor pageId={editing} onBack={() => setEditing(null)} />;

  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(); } catch (e) { return ""; } };
  const newPage = () => { const p = NotesStore.createJournal(); setEditing(p.id); };

  return (
    <div className="journal-view">
      <div className="journal-toolbar">
        <button className="notes-tool-btn on" onClick={newPage}>+ New page</button>
      </div>
      {pages.length === 0 ? (
        <div className="notes-empty">No journal pages yet. Tap “New page” to start writing — free-form, not tied to any verse.</div>
      ) : (
        <ul className="journal-list">
          {pages.map(p => (
            <li key={p.id} className="journal-item" onClick={() => setEditing(p.id)}>
              <div className="journal-item-title">{(p.title || "").trim() || "Untitled page"}</div>
              {(p.body || "").trim() && <div className="journal-item-preview">{p.body.trim().slice(0, 160)}</div>}
              <div className="journal-item-date">{fmtDate(p.updated)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The Notes tab — list + search of every saved note.
function NotesView({ onOpen }) {
  useNotesVersion();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");   // all | bookmark | highlight | note
  const [sort, setSort] = useState("recent");     // recent | ref
  const [group, setGroup] = useState(false);      // group by book
  const [collapsed, setCollapsed] = useState(() => new Set());   // collapsed book keys
  const toggleSection = (key) => setCollapsed(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const [authOpen, setAuthOpen] = useState(null);   // null | "login" | "signup"
  const [mode, setMode] = useState("notes");        // notes | journal
  const acct = NotesStore.authInfo();
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
        {(n.body || n.bookmark) && (
          <span className="notes-item-type" aria-hidden="true">{n.body ? <Icon.Note/> : <Icon.Bookmark/>}</span>
        )}
        {n.color && <span className="notes-item-dot" style={{ background: NOTE_COLOR_CSS[n.color] }} />}
        {n.refLabel || (n.book + " " + n.chapter)}
      </div>
      {n.snippet && <div className="notes-item-snippet">“{n.snippet}”</div>}
      {n.body && <div className="notes-item-body">{n.body}</div>}
    </li>
  );

  return (
    <div className="notes-view">
      <div className="notes-view-head">
        <div className="notes-view-titlerow">
          <h2 className="notes-view-title">My Notes</h2>
          <div className="notes-acct">
            {acct.email ? (
              <>
                <span className="notes-acct-email" title={acct.email}>{acct.email}</span>
                <button className="notes-tool-btn" onClick={() => NotesStore.logout()}>Log out</button>
              </>
            ) : (
              <>
                <button className="notes-tool-btn" onClick={() => setAuthOpen("login")}>Log in</button>
                <button className="notes-tool-btn" onClick={() => setAuthOpen("signup")}>Sign up</button>
              </>
            )}
          </div>
        </div>
        <div className="notes-mode seg">
          <button className={"seg-b" + (mode === "notes" ? " on" : "")} onClick={() => setMode("notes")}>Verse notes</button>
          <button className={"seg-b" + (mode === "journal" ? " on" : "")} onClick={() => setMode("journal")}>Journal</button>
        </div>
        {mode === "notes" && <>
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
        </>}
      </div>
      {mode === "journal" ? <JournalView/> : notes.length === 0 ? (
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
      {authOpen && <AuthModal mode={authOpen} onClose={() => setAuthOpen(null)} />}
    </div>
  );
}

// Centered login / sign-up dialog.
function AuthModal({ mode, onClose }) {
  const [m, setM] = useState(mode);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [gid, setGid] = useState(null);     // Google Client ID, if configured
  const emailRef = useRef(null);
  const gbtnRef = useRef(null);
  useEffect(() => { requestAnimationFrame(() => emailRef.current && emailRef.current.focus()); }, []);

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
        callback: (resp) => {
          NotesStore.googleLogin(resp.credential).then(r => { if (r.ok) onClose(); else setErr(r.error); });
        },
      });
      gbtnRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(gbtnRef.current, { theme: "outline", size: "large", width: 300, text: m === "signup" ? "signup_with" : "signin_with" });
    };
    if (window.google && window.google.accounts) { init(); return () => { cancelled = true; }; }
    let s = document.getElementById("gsi-script");
    if (!s) {
      s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true; s.defer = true; s.id = "gsi-script";
      document.head.appendChild(s);
    }
    s.addEventListener("load", init);
    return () => { cancelled = true; s && s.removeEventListener("load", init); };
  }, [gid, m]);

  const submit = async () => {
    if (busy) return;
    setBusy(true); setErr("");
    const r = m === "signup" ? await NotesStore.signup(email, pass) : await NotesStore.login(email, pass);
    setBusy(false);
    if (r.ok) onClose();
    else setErr(r.error || "Something went wrong.");
  };

  return (
    <>
      <div className="auth-scrim" onClick={onClose} />
      <div className="auth-modal" role="dialog" aria-modal="true" aria-label={m === "signup" ? "Sign up" : "Log in"}>
        <div className="auth-modal-head">
          <h3 className="auth-modal-title">{m === "signup" ? "Create account" : "Log in"}</h3>
          <button className="detail-close" onClick={onClose} aria-label="Close"><Icon.Close/></button>
        </div>
        <p className="auth-modal-sub">Sync your notes across devices.</p>
        {gid && (
          <>
            <div className="auth-google" ref={gbtnRef} />
            <div className="auth-or"><span>or</span></div>
          </>
        )}
        <input ref={emailRef} className="auth-input" type="email" placeholder="Email" autoComplete="username"
          value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        <input className="auth-input" type="password" placeholder="Password"
          autoComplete={m === "signup" ? "new-password" : "current-password"}
          value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        {m === "signup" && <div className="auth-fine">At least 8 characters.</div>}
        {err && <div className="auth-err">{err}</div>}
        <button className="auth-submit" onClick={submit} disabled={busy}>
          {busy ? "…" : (m === "signup" ? "Create account" : "Log in")}
        </button>
        <div className="auth-switch">
          {m === "signup"
            ? <>Already have an account? <button onClick={() => { setM("login"); setErr(""); }}>Log in</button></>
            : <>New here? <button onClick={() => { setM("signup"); setErr(""); }}>Sign up</button></>}
        </div>
      </div>
    </>
  );
}
