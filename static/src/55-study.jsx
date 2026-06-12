// ============================================================
// STUDY MODULES — admin-only authored study content (the "engine")
// One shape, three views: a study TOPIC, a DENOMINATION's belief, or one side of
// an ARGUMENT. Each entry = a position + support verses + tension verses + a
// resolution (the middle road, or an open mystery) + notes + related links.
// Verses are entered as a REFERENCE; the ABP prose text auto-fills from the corpus.
// Backend: views_study.py (study.db). Every route is admin-gated (404 otherwise).
// ============================================================
const STUDY_TYPES = [
  { id: "topic", label: "Topic" },
  { id: "denomination", label: "Denomination" },
  { id: "argument", label: "Argument" },
];
const STUDY_TYPE_LABEL = { topic: "Topic", denomination: "Denomination", argument: "Argument" };

function blankStudyEntry(type) {
  return {
    id: "", type: type || "topic", title: "", heldBy: "", intro: "",
    support: [], tension: [], resolution: { mode: "middle", text: "" },
    notes: "", related: [], status: "draft",
  };
}

// One verse bucket (Support or Tension): a list of refs with their auto-filled
// text, plus an add row that resolves the reference as you type it in.
function StudyVerseBucket({ kind, items, onAdd, onRemove }) {
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const add = () => {
    const r = ref.trim();
    if (!r || busy) return;
    setBusy(true); setErr("");
    api.studyVerse(r).then(d => {
      setBusy(false);
      if (d && d.verses && d.verses.length) {
        onAdd({ ref: r, text: d.verses.map(v => v.text).join(" ") });
        setRef("");
      } else {
        setErr((d && d.error) || "Couldn't find that reference.");
      }
    });
  };
  const isSupport = kind === "support";
  return (
    <div className={"study-bucket study-bucket--" + kind}>
      <div className="study-bucket-head">
        <span className="study-bucket-dot" aria-hidden="true" />
        <span className="study-bucket-name">{isSupport ? "Support" : "Tension"}</span>
        <span className="study-bucket-hint">{isSupport ? "verses used to hold it" : "verses that sit in conflict with it"}</span>
      </div>
      {items.length > 0 && (
        <div className="study-verse-list">
          {items.map((it, i) => (
            <div className="study-verse-row" key={i}>
              <span className="study-verse-ref">{it.ref}</span>
              <span className="study-verse-text">{it.text || <em className="study-verse-missing">not found — saved as a reference</em>}</span>
              <button className="study-x" onClick={() => onRemove(i)} aria-label="Remove verse" title="Remove">×</button>
            </div>
          ))}
        </div>
      )}
      <div className="study-add-row">
        <input
          className="study-add-input"
          type="text"
          value={ref}
          placeholder="Add a reference — e.g. Romans 10:17 (text fills in)"
          onChange={e => { setRef(e.target.value); if (err) setErr(""); }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button className="study-add-btn" onClick={add} disabled={busy || !ref.trim()}>{busy ? "…" : "Add"}</button>
      </div>
      {err && <div className="study-add-err">{err}</div>}
    </div>
  );
}

// Free-text chips of related entry/topic names.
function StudyRelated({ items, onAdd, onRemove }) {
  const [val, setVal] = useState("");
  const add = () => {
    const v = val.trim();
    if (!v) return;
    if (!items.includes(v)) onAdd(v);
    setVal("");
  };
  return (
    <div className="study-related">
      {items.map((r, i) => (
        <span className="study-chip" key={i}>{r}<button className="study-chip-x" onClick={() => onRemove(i)} aria-label="Remove" title="Remove">×</button></span>
      ))}
      <input
        className="study-chip-input"
        type="text"
        value={val}
        placeholder="link a topic…"
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        onBlur={add}
      />
    </div>
  );
}

// The full entry editor.
function StudyEditor({ entry, onChange, onSave, onDelete, onClose, saving, savedAt }) {
  const up = patch => onChange({ ...entry, ...patch });
  const isDenom = entry.type === "denomination";
  return (
    <div className="study-editor">
      <div className="study-editor-bar">
        <button className="study-back" onClick={onClose}>‹ All entries</button>
        <div className="study-editor-actions">
          {savedAt && !saving && <span className="study-saved">Saved ✓</span>}
          {entry.id && <button className="study-del" onClick={onDelete}>Delete</button>}
          <button className="study-save" onClick={onSave} disabled={saving || !entry.title.trim()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>

      <div className="study-field study-type-row">
        <span className="study-label">Type</span>
        <div className="seg">
          {STUDY_TYPES.map(t => (
            <button key={t.id} className={"seg-b" + (entry.type === t.id ? " on" : "")} onClick={() => up({ type: t.id })}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="study-head-row">
        {isDenom && (
          <div className="study-field study-field--held">
            <label className="study-label">Held by</label>
            <input className="study-input" type="text" value={entry.heldBy} placeholder="e.g. Church of Christ" onChange={e => up({ heldBy: e.target.value })} />
          </div>
        )}
        <div className="study-field study-field--title">
          <label className="study-label">{entry.type === "argument" ? "Position (one side)" : "Position"}</label>
          <input className="study-input" type="text" value={entry.title} placeholder={isDenom ? "What they hold — e.g. Baptism is required for salvation" : "The topic or claim"} onChange={e => up({ title: e.target.value })} />
        </div>
      </div>

      <div className="study-field">
        <label className="study-label">Intro <span className="study-label-hint">(optional, one or two lines)</span></label>
        <textarea className="study-textarea study-textarea--sm" value={entry.intro} placeholder="A short, plain-English lead-in." onChange={e => up({ intro: e.target.value })} />
      </div>

      <StudyVerseBucket kind="support" items={entry.support}
        onAdd={v => up({ support: [...entry.support, v] })}
        onRemove={i => up({ support: entry.support.filter((_, j) => j !== i) })} />

      <StudyVerseBucket kind="tension" items={entry.tension}
        onAdd={v => up({ tension: [...entry.tension, v] })}
        onRemove={i => up({ tension: entry.tension.filter((_, j) => j !== i) })} />

      <div className="study-field">
        <div className="study-res-head">
          <span className="study-label">Resolution</span>
          <div className="seg seg--res">
            <button className={"seg-b" + (entry.resolution.mode === "middle" ? " on" : "")} onClick={() => up({ resolution: { ...entry.resolution, mode: "middle" } })}>Middle road</button>
            <button className={"seg-b" + (entry.resolution.mode === "mystery" ? " on" : "")} onClick={() => up({ resolution: { ...entry.resolution, mode: "mystery" } })}>Open mystery</button>
          </div>
        </div>
        <textarea className="study-textarea" value={entry.resolution.text}
          placeholder={entry.resolution.mode === "mystery" ? "Why the text leaves this open — what we can and can't say." : "The middle road the text points to — how the support and tension are held together."}
          onChange={e => up({ resolution: { ...entry.resolution, text: e.target.value } })} />
      </div>

      <div className="study-field">
        <label className="study-label">Your notes <span className="study-label-hint">(private)</span></label>
        <textarea className="study-textarea study-textarea--sm" value={entry.notes} placeholder="Commentary, cross-links, things to revisit." onChange={e => up({ notes: e.target.value })} />
      </div>

      <div className="study-field">
        <label className="study-label">Related</label>
        <StudyRelated items={entry.related}
          onAdd={r => up({ related: [...entry.related, r] })}
          onRemove={i => up({ related: entry.related.filter((_, j) => j !== i) })} />
      </div>

      <div className="study-field study-status-row">
        <span className="study-label">Visibility</span>
        <div className="seg">
          <button className={"seg-b" + (entry.status === "draft" ? " on" : "")} onClick={() => up({ status: "draft" })}>Draft</button>
          <button className={"seg-b" + (entry.status === "published" ? " on" : "")} onClick={() => up({ status: "published" })}>Published</button>
        </div>
        <span className="study-label-hint">Draft = only you. Published is reserved for a future public reader.</span>
      </div>
    </div>
  );
}

function StudyView() {
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState(false);
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const load = () => {
    api.studyEntries("all").then(d => {
      if (d && d.entries) { setEntries(d.entries); setErr(false); }
      else setErr(true);
    });
  };
  useEffect(() => { load(); }, []);

  const openEntry = id => {
    setSavedAt(null);
    api.studyEntry(id).then(d => {
      if (!d) return;
      setEditing({
        id: d.id, type: d.type, title: d.title || "", heldBy: d.heldBy || "", intro: d.intro || "",
        support: d.support || [], tension: d.tension || [],
        resolution: d.resolution || { mode: "middle", text: "" },
        notes: d.notes || "", related: d.related || [], status: d.status || "draft",
      });
    });
  };
  const newEntry = () => { setSavedAt(null); setEditing(blankStudyEntry("topic")); };
  const save = () => {
    if (!editing || !editing.title.trim() || saving) return;
    setSaving(true);
    const payload = {
      ...editing,
      support: editing.support.map(v => ({ ref: v.ref })),
      tension: editing.tension.map(v => ({ ref: v.ref })),
    };
    api.studySave(payload).then(d => {
      setSaving(false);
      if (d && d.id) {
        setEditing(e => ({ ...e, id: d.id }));
        setSavedAt(Date.now());
        load();
      }
    });
  };
  const del = () => {
    if (!editing || !editing.id) { setEditing(null); return; }
    if (!window.confirm("Delete this entry?")) return;
    api.studyDelete(editing.id).then(() => { setEditing(null); load(); });
  };

  if (err) return <div className="stats-view"><div className="stats-empty">Couldn't load study entries. (Admin sign-in required.)</div></div>;

  if (editing) {
    return (
      <div className="study-view">
        <StudyEditor entry={editing} onChange={setEditing} onSave={save} onDelete={del} onClose={() => { setEditing(null); setSavedAt(null); }} saving={saving} savedAt={savedAt} />
      </div>
    );
  }

  const shown = (entries || []).filter(e => filter === "all" || e.type === filter);
  return (
    <div className="study-view">
      <div className="study-list-head">
        <h1 className="stats-title">Study modules</h1>
        <button className="study-new" onClick={newEntry}>+ New entry</button>
      </div>
      <div className="stats-sub">Author topics, denomination beliefs, and arguments — each as a position with its support and tension verses.</div>

      <div className="study-filter seg">
        {[["all", "All"], ["topic", "Topics"], ["denomination", "Denominations"], ["argument", "Arguments"]].map(([id, lbl]) => (
          <button key={id} className={"seg-b" + (filter === id ? " on" : "")} onClick={() => setFilter(id)}>{lbl}</button>
        ))}
      </div>

      {entries === null ? (
        <div className="stats-empty">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="stats-empty">{(entries.length === 0) ? "No entries yet — start with “+ New entry”." : "None of this type yet."}</div>
      ) : (
        <div className="study-rows">
          {shown.map(e => (
            <button className="study-row" key={e.id} onClick={() => openEntry(e.id)}>
              <span className={"study-badge study-badge--" + e.type}>{STUDY_TYPE_LABEL[e.type] || e.type}</span>
              <span className="study-row-title">{e.title}{e.heldBy ? <span className="study-row-held"> · {e.heldBy}</span> : null}</span>
              {e.status === "draft" && <span className="study-row-draft">draft</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
