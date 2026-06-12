// ============================================================
// STUDY MODULES — admin-only (the "engine")
// One Study tab with a sub-switch: Topics · Denominations · Arguments.
//   Topics       — a BROWSE: a subject broken into subtopic SECTIONS, each with its
//                  verses (mostly filled from MetaV; light editing). Shape:
//                  {title, intro, sections:[{heading, verses:[{ref,text}]}]}.
//   Denominations / Arguments — the CLAIM editor: a position with support + tension
//                  verses and a resolution (middle road / open mystery).
// Verses are entered as a REFERENCE; the ABP prose text auto-fills from the corpus.
// Backend: views_study.py (study.db). Every route is admin-gated (404 otherwise).
// ============================================================
const STUDY_MODULES = [
  { id: "topic", label: "Topics" },
  { id: "denomination", label: "Denominations" },
  { id: "argument", label: "Arguments" },
];
const CLAIM_TYPES = [
  { id: "denomination", label: "Denomination" },
  { id: "argument", label: "Argument" },
];
const STUDY_TYPE_LABEL = { topic: "Topic", denomination: "Denomination", argument: "Argument" };
// "name" = a person/place name-topic (MetaV), shown on the metaV sidebar, opened
// here read-only. Same shape as a topic, so it renders through TopicPage.
const isTopicLike = t => t === "topic" || t === "name";
// Subtopic headings arrive from Nave's as little sentences ("Father.") — drop a
// trailing period/comma so they read as headings, not sentences.
const cleanHeading = h => String(h || "").replace(/\s*[.,;:]+\s*$/, "");

function blankTopic() {
  return { id: "", type: "topic", title: "", intro: "", sections: [{ heading: "", verses: [] }], related: [], status: "draft", source: "" };
}
function blankClaim(type) {
  return {
    id: "", type: type || "denomination", title: "", heldBy: "", intro: "",
    support: [], tension: [], resolution: { mode: "middle", text: "" },
    notes: "", related: [], status: "draft",
  };
}
// An ARGUMENT is two-sided: a question, then Side A and Side B (each with its own
// claim + verses), then the shared resolution. A denomination stays one-sided
// (support/tension) in blankClaim above.
function blankArgument() {
  return {
    id: "", type: "argument", title: "", intro: "",
    sides: [{ claim: "", verses: [] }, { claim: "", verses: [] }],
    resolution: { mode: "middle", text: "" }, notes: "", related: [], status: "draft",
  };
}
// Arguments always show exactly two side slots — pad/trim so the layout stays stable.
function padSides(sides) {
  const a = (sides || []).slice(0, 2).map(s => ({ claim: (s && s.claim) || "", verses: (s && s.verses) || [] }));
  while (a.length < 2) a.push({ claim: "", verses: [] });
  return a;
}
// Flip a claim between denomination (support/tension) and argument (two sides)
// WITHOUT losing the verses already entered: support↔Side A, tension↔Side B.
function convertClaimType(entry, t) {
  if (t === entry.type) return entry;
  if (t === "argument") {
    const sides = (entry.sides && entry.sides.length)
      ? entry.sides
      : [{ claim: "", verses: entry.support || [] }, { claim: "", verses: entry.tension || [] }];
    return { ...entry, type: t, sides: padSides(sides) };
  }
  const s = entry.sides || [];
  return {
    ...entry, type: t, heldBy: entry.heldBy || "",
    support: (entry.support && entry.support.length) ? entry.support : ((s[0] && s[0].verses) || []),
    tension: (entry.tension && entry.tension.length) ? entry.tension : ((s[1] && s[1].verses) || []),
  };
}
function moveItem(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const a = arr.slice();
  const t = a[i]; a[i] = a[j]; a[j] = t;
  return a;
}

// Add a reference: resolves it to ABP prose, then hands {ref, text} up.
function AddRef({ onAdd, placeholder }) {
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
  return (
    <>
      <div className="study-add-row">
        <input className="study-add-input" type="text" value={ref}
          placeholder={placeholder || "Add a reference — e.g. Romans 10:17 (text fills in)"}
          onChange={e => { setRef(e.target.value); if (err) setErr(""); }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button className="study-add-btn" onClick={add} disabled={busy || !ref.trim()}>{busy ? "…" : "Add"}</button>
      </div>
      {err && <div className="study-add-err">{err}</div>}
    </>
  );
}

// Editable verse list (with remove).
function VerseRows({ items, onRemove }) {
  if (!items.length) return null;
  return (
    <div className="study-verse-list">
      {items.map((it, i) => (
        <div className="study-verse-row" key={i}>
          <span className="study-verse-ref">{it.ref}</span>
          <span className="study-verse-text">{it.text || <em className="study-verse-missing">not found — saved as a reference</em>}</span>
          <button className="study-x" onClick={() => onRemove(i)} aria-label="Remove verse" title="Remove">×</button>
        </div>
      ))}
    </div>
  );
}

// ---- Topics ---------------------------------------------------------------
function TopicSectionEdit({ section, idx, count, onChange, onRemove, onMove }) {
  return (
    <div className="study-section study-section--edit">
      <div className="study-section-bar">
        <input className="study-section-head-input" type="text" value={section.heading}
          placeholder="Section heading (optional)" onChange={e => onChange({ ...section, heading: e.target.value })} />
        <div className="study-section-tools">
          <button className="study-sec-tool" disabled={idx === 0} onClick={() => onMove(-1)} aria-label="Move up" title="Move up">↑</button>
          <button className="study-sec-tool" disabled={idx === count - 1} onClick={() => onMove(1)} aria-label="Move down" title="Move down">↓</button>
          <button className="study-sec-tool study-sec-tool--del" onClick={onRemove} aria-label="Remove section" title="Remove section">✕</button>
        </div>
      </div>
      <VerseRows items={section.verses} onRemove={i => onChange({ ...section, verses: section.verses.filter((_, j) => j !== i) })} />
      <AddRef onAdd={v => onChange({ ...section, verses: [...section.verses, v] })} placeholder="Add a reference to this section" />
    </div>
  );
}

// Which subtopic sections start open on the read page: a 1-section topic opens; a
// multi-section topic starts collapsed (you see the structure first, expand on demand).
function defaultOpenSecs(entry) {
  const secs = (entry && entry.sections) || [];
  return new Set(secs.length <= 1 ? secs.map((_, i) => i) : []);
}

function TopicPage({ entry, editing, onChange, onSave, onDelete, onClose, onToggleEdit, previewReader, saving, savedAt }) {
  const up = patch => onChange({ ...entry, ...patch });
  const verseCount = entry.sections.reduce((n, s) => n + s.verses.length, 0);
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState(false);
  const draftIntro = () => {
    if (drafting) return;
    setDrafting(true); setDraftErr(false);
    const slim = (entry.sections || []).map(s => ({ heading: s.heading, verses: (s.verses || []).slice(0, 2).map(v => ({ ref: v.ref, text: v.text })) }));
    api.studyDraftIntro({ title: entry.title, sections: slim }).then(d => {
      setDrafting(false);
      if (d && d.intro) up({ intro: d.intro }); else setDraftErr(true);
    });
  };
  const [openSecs, setOpenSecs] = useState(() => defaultOpenSecs(entry));
  useEffect(() => { setOpenSecs(defaultOpenSecs(entry)); }, [entry.id]);
  const allOpen = entry.sections.length > 0 && openSecs.size === entry.sections.length;
  const toggleAll = () => setOpenSecs(allOpen ? new Set() : new Set(entry.sections.map((_, i) => i)));
  const toggleSec = i => setOpenSecs(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  if (!editing) {
    return (
      <div className="study-topic">
        <div className="study-editor-bar">
          <button className="study-back" onClick={onClose}>‹ {previewReader ? "Back" : "All topics"}</button>
          {!previewReader && <button className="study-edit-btn" onClick={onToggleEdit}>Edit</button>}
        </div>
        <div className="study-eyebrow">Topic</div>
        <h1 className="study-topic-title">{entry.title}</h1>
        <div className="study-topic-meta">{entry.source === "metav" ? "from Nave's · " : ""}{entry.sections.length} sections · {verseCount} verses</div>
        {entry.intro && <p className="study-topic-intro">{entry.intro}</p>}
        {entry.sections.length === 0 ? (
          <div className="stats-empty">No verses yet — click Edit to add some.</div>
        ) : (
          <>
            {entry.sections.length > 1 && (
              <button className="study-collapse-all" onClick={toggleAll}>{allOpen ? "Collapse all" : "Expand all"}</button>
            )}
            {entry.sections.map((s, i) => {
              const isOpen = openSecs.has(i);
              return (
                <div className={"study-section study-section--collapsible" + (isOpen ? " open" : "")} key={i}>
                  <button className="study-section-toggle" onClick={() => toggleSec(i)} aria-expanded={isOpen}>
                    <span className="study-section-chevron">{isOpen ? "▾" : "▸"}</span>
                    <span className="study-section-head-text">{cleanHeading(s.heading) || "General references"}</span>
                    <span className="study-section-count">{s.verses.length}</span>
                  </button>
                  {isOpen && (
                    <div className="study-read-verses">
                      {s.verses.map((v, j) => (
                        <div className="study-read-verse" key={j}>
                          <span className="study-verse-ref">{v.ref}</span>
                          <span className="study-read-text">{v.text || <em className="study-verse-missing">(text not found)</em>}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="study-editor">
      <div className="study-editor-bar">
        <button className="study-back" onClick={() => entry.id ? onToggleEdit() : onClose()}>‹ {entry.id ? "Done editing" : "Cancel"}</button>
        <div className="study-editor-actions">
          {savedAt && !saving && <span className="study-saved">Saved ✓</span>}
          {entry.id && <button className="study-del" onClick={onDelete}>Delete</button>}
          <button className="study-save" onClick={onSave} disabled={saving || !entry.title.trim()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
      <div className="study-field">
        <label className="study-label">Topic</label>
        <input className="study-input" type="text" value={entry.title} placeholder="Subject — e.g. Faith" onChange={e => up({ title: e.target.value })} />
      </div>
      <div className="study-field">
        <label className="study-label">Intro <span className="study-label-hint">(optional)</span>
          <button type="button" className="study-ai-btn" disabled={drafting || !entry.title.trim()} onClick={draftIntro}>{drafting ? "Drafting…" : "✦ Draft with AI"}</button>
          {draftErr && <span className="study-ai-err">couldn't draft — try again</span>}
        </label>
        <textarea className="study-textarea study-textarea--sm" value={entry.intro} placeholder="A short, plain-English lead-in (or use Draft with AI)." onChange={e => up({ intro: e.target.value })} />
      </div>
      {entry.sections.map((s, i) => (
        <TopicSectionEdit key={i} section={s} idx={i} count={entry.sections.length}
          onChange={ns => up({ sections: entry.sections.map((x, j) => j === i ? ns : x) })}
          onRemove={() => up({ sections: entry.sections.filter((_, j) => j !== i) })}
          onMove={dir => up({ sections: moveItem(entry.sections, i, dir) })} />
      ))}
      <button className="study-add-section" onClick={() => up({ sections: [...entry.sections, { heading: "", verses: [] }] })}>+ Add section</button>
      <div className="study-field study-status-row">
        <span className="study-label">Visibility</span>
        <div className="seg">
          <button className={"seg-b" + (entry.status === "draft" ? " on" : "")} onClick={() => up({ status: "draft" })}>Draft</button>
          <button className={"seg-b" + (entry.status === "published" ? " on" : "")} onClick={() => up({ status: "published" })}>Published</button>
        </div>
        <span className="study-label-hint">Draft = only you. Published shows it in Preview as reader (still admin-only for now).</span>
      </div>
    </div>
  );
}

// ---- Claims (denomination / argument) -------------------------------------
function StudyVerseBucket({ kind, items, onAdd, onRemove }) {
  const isSupport = kind === "support";
  return (
    <div className={"study-bucket study-bucket--" + kind}>
      <div className="study-bucket-head">
        <span className="study-bucket-dot" aria-hidden="true" />
        <span className="study-bucket-name">{isSupport ? "Support" : "Tension"}</span>
        <span className="study-bucket-hint">{isSupport ? "verses used to hold it" : "verses that sit in conflict with it"}</span>
      </div>
      <VerseRows items={items} onRemove={onRemove} />
      <AddRef onAdd={onAdd} />
    </div>
  );
}

function StudyRelated({ items, onAdd, onRemove }) {
  const [val, setVal] = useState("");
  const add = () => { const v = val.trim(); if (!v) return; if (!items.includes(v)) onAdd(v); setVal(""); };
  return (
    <div className="study-related">
      {items.map((r, i) => (
        <span className="study-chip" key={i}>{r}<button className="study-chip-x" onClick={() => onRemove(i)} aria-label="Remove" title="Remove">×</button></span>
      ))}
      <input className="study-chip-input" type="text" value={val} placeholder="link a topic…"
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} onBlur={add} />
    </div>
  );
}

function StudyEditor({ entry, onChange, onSave, onDelete, onClose, onToggleEdit, saving, savedAt }) {
  const up = patch => onChange({ ...entry, ...patch });
  const isDenom = entry.type === "denomination";
  return (
    <div className="study-editor">
      <div className="study-editor-bar">
        <button className="study-back" onClick={() => entry.id ? onToggleEdit() : onClose()}>‹ {entry.id ? "Done editing" : "Cancel"}</button>
        <div className="study-editor-actions">
          {savedAt && !saving && <span className="study-saved">Saved ✓</span>}
          {entry.id && <button className="study-del" onClick={onDelete}>Delete</button>}
          <button className="study-save" onClick={onSave} disabled={saving || !entry.title.trim()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>

      <div className="study-field study-type-row">
        <span className="study-label">Type</span>
        <div className="seg">
          {CLAIM_TYPES.map(t => (
            <button key={t.id} className={"seg-b" + (entry.type === t.id ? " on" : "")} onClick={() => onChange(convertClaimType(entry, t.id))}>{t.label}</button>
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
          <input className="study-input" type="text" value={entry.title} placeholder={isDenom ? "What they hold — e.g. Baptism is required for salvation" : "The claim"} onChange={e => up({ title: e.target.value })} />
        </div>
      </div>

      <div className="study-field">
        <label className="study-label">Intro <span className="study-label-hint">(optional)</span></label>
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

// ---- Argument (two-sided) -------------------------------------------------
// One side card in the editor: its claim + its own verse list.
function ArgumentSideEdit({ side, label, onChange }) {
  return (
    <div className="study-side study-side--edit">
      <div className="study-side-label">{label}</div>
      <input className="study-side-claim-input" type="text" value={side.claim}
        placeholder="This side holds…" onChange={e => onChange({ ...side, claim: e.target.value })} />
      <div className="study-side-vlabel">Verses for this side</div>
      <VerseRows items={side.verses} onRemove={i => onChange({ ...side, verses: side.verses.filter((_, j) => j !== i) })} />
      <AddRef onAdd={v => onChange({ ...side, verses: [...side.verses, v] })} placeholder="Add a verse for this side" />
    </div>
  );
}

// An argument reads/edits like a topic page (read view + Edit toggle), but its body
// is the two-sided layout (Side A | Side B) plus the resolution that weighs them.
function ArgumentPage({ entry, editing, onChange, onSave, onDelete, onClose, onToggleEdit, previewReader, saving, savedAt }) {
  const up = patch => onChange({ ...entry, ...patch });
  const sides = padSides(entry.sides);
  const res = entry.resolution || { mode: "middle", text: "" };
  const setSide = (i, ns) => up({ sides: sides.map((x, j) => j === i ? ns : x) });

  if (!editing) {
    const verseCount = sides.reduce((n, s) => n + (s.verses ? s.verses.length : 0), 0);
    return (
      <div className="study-topic study-arg">
        <div className="study-editor-bar">
          <button className="study-back" onClick={onClose}>‹ {previewReader ? "Back" : "All arguments"}</button>
          {!previewReader && <button className="study-edit-btn" onClick={onToggleEdit}>Edit</button>}
        </div>
        <div className="study-eyebrow">Argument</div>
        <h1 className="study-topic-title">{entry.title}</h1>
        <div className="study-topic-meta">two sides · {verseCount} verses</div>
        {entry.intro && <p className="study-topic-intro">{entry.intro}</p>}
        <div className="study-sides study-sides--read">
          {sides.map((s, i) => (
            <div className="study-side study-side--read" key={i}>
              <div className="study-side-tag">Side {i === 0 ? "A" : "B"}</div>
              <div className="study-side-claim">{s.claim || <em className="study-verse-missing">(no claim yet)</em>}</div>
              {(s.verses && s.verses.length) ? (
                <div className="study-read-verses">
                  {s.verses.map((v, j) => (
                    <div className="study-read-verse" key={j}>
                      <span className="study-verse-ref">{v.ref}</span>
                      <span className="study-read-text">{v.text || <em className="study-verse-missing">(text not found)</em>}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="study-side-empty">No verses yet.</div>}
            </div>
          ))}
        </div>
        <div className="study-arg-res">
          <div className="study-arg-res-label">{res.mode === "mystery" ? "An open mystery" : "Where the text lands"}</div>
          <p className="study-arg-res-text">{res.text || <em className="study-verse-missing">(not written yet)</em>}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="study-editor">
      <div className="study-editor-bar">
        <button className="study-back" onClick={() => entry.id ? onToggleEdit() : onClose()}>‹ {entry.id ? "Done editing" : "Cancel"}</button>
        <div className="study-editor-actions">
          {savedAt && !saving && <span className="study-saved">Saved ✓</span>}
          {entry.id && <button className="study-del" onClick={onDelete}>Delete</button>}
          <button className="study-save" onClick={onSave} disabled={saving || !entry.title.trim()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>

      <div className="study-field study-type-row">
        <span className="study-label">Type</span>
        <div className="seg">
          {CLAIM_TYPES.map(t => (
            <button key={t.id} className={"seg-b" + (entry.type === t.id ? " on" : "")} onClick={() => onChange(convertClaimType(entry, t.id))}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="study-field">
        <label className="study-label">The question</label>
        <input className="study-input" type="text" value={entry.title} placeholder="What's disputed — e.g. Can a believer lose their salvation?" onChange={e => up({ title: e.target.value })} />
      </div>
      <div className="study-field">
        <label className="study-label">Intro <span className="study-label-hint">(optional)</span></label>
        <textarea className="study-textarea study-textarea--sm" value={entry.intro} placeholder="A short, plain-English lead-in to the question." onChange={e => up({ intro: e.target.value })} />
      </div>

      <div className="study-sides study-sides--edit">
        <ArgumentSideEdit side={sides[0]} label="Side A" onChange={ns => setSide(0, ns)} />
        <ArgumentSideEdit side={sides[1]} label="Side B" onChange={ns => setSide(1, ns)} />
      </div>

      <div className="study-field">
        <div className="study-res-head">
          <span className="study-label">Resolution</span>
          <div className="seg seg--res">
            <button className={"seg-b" + (res.mode === "middle" ? " on" : "")} onClick={() => up({ resolution: { ...res, mode: "middle" } })}>Middle road</button>
            <button className={"seg-b" + (res.mode === "mystery" ? " on" : "")} onClick={() => up({ resolution: { ...res, mode: "mystery" } })}>Open mystery</button>
          </div>
        </div>
        <textarea className="study-textarea" value={res.text}
          placeholder={res.mode === "mystery" ? "Why the text leaves this open — what we can and can't say." : "The middle road the text points to — how both sides are held together."}
          onChange={e => up({ resolution: { ...res, text: e.target.value } })} />
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

// ---- Reader views ---------------------------------------------------------
// A labeled read-only verse list (Support / Tension), for the denomination read view.
function DenomVerseList({ label, items }) {
  if (!items || !items.length) return null;
  return (
    <div className="study-section">
      <div className="study-section-head">{label}</div>
      <div className="study-read-verses">
        {items.map((v, j) => (
          <div className="study-read-verse" key={j}>
            <span className="study-verse-ref">{v.ref}</span>
            <span className="study-read-text">{v.text || <em className="study-verse-missing">(text not found)</em>}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Clean read view of a denomination (position + support/tension + resolution).
function DenominationRead({ entry, onClose, onToggleEdit, previewReader }) {
  const res = entry.resolution || { mode: "middle", text: "" };
  return (
    <div className="study-topic">
      <div className="study-editor-bar">
        <button className="study-back" onClick={onClose}>‹ {previewReader ? "Back" : "All denominations"}</button>
        {!previewReader && <button className="study-edit-btn" onClick={onToggleEdit}>Edit</button>}
      </div>
      <div className="study-eyebrow">Denomination</div>
      <h1 className="study-topic-title">{entry.title}</h1>
      {entry.heldBy && <div className="study-topic-meta">Held by {entry.heldBy}</div>}
      {entry.intro && <p className="study-topic-intro">{entry.intro}</p>}
      <DenomVerseList label="Support" items={entry.support} />
      <DenomVerseList label="Tension" items={entry.tension} />
      <div className="study-arg-res">
        <div className="study-arg-res-label">{res.mode === "mystery" ? "An open mystery" : "Where the text lands"}</div>
        <p className="study-arg-res-text">{res.text || <em className="study-verse-missing">(not written yet)</em>}</p>
      </div>
    </div>
  );
}

// ---- The Study tab --------------------------------------------------------
function StudyView({ pending, onConsumed }) {
  const [module, setModule] = useState("topic");
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editMode, setEditMode] = useState(false);   // read vs edit (read-first for all types)
  const [previewReader, setPreviewReader] = useState(false);  // admin: preview the clean reader view
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [q, setQ] = useState("");

  const load = mod => {
    setEntries(null);
    api.studyEntries(mod).then(d => {
      if (d && d.entries) { setEntries(d.entries); setErr(false); }
      else setErr(true);
    });
  };
  useEffect(() => { load(module); }, [module]);

  const pickModule = m => { if (m === module) return; setEditing(null); setSavedAt(null); setQ(""); setModule(m); };

  const openEntry = id => {
    setSavedAt(null);
    api.studyEntry(id).then(d => {
      if (!d) return;
      if (isTopicLike(d.type)) {
        setEditing({ id: d.id, type: d.type, title: d.title || "", intro: d.intro || "",
          sections: (d.sections || []).map(s => ({ heading: s.heading || "", verses: s.verses || [] })),
          related: d.related || [], status: d.status || "draft", source: d.source || "" });
        setEditMode(false);
      } else if (d.type === "argument") {
        setEditing({ id: d.id, type: "argument", title: d.title || "", intro: d.intro || "",
          sides: padSides(d.sides), resolution: d.resolution || { mode: "middle", text: "" },
          notes: d.notes || "", related: d.related || [], status: d.status || "draft" });
        setEditMode(false);
      } else {
        setEditing({ id: d.id, type: d.type, title: d.title || "", heldBy: d.heldBy || "", intro: d.intro || "",
          support: d.support || [], tension: d.tension || [], resolution: d.resolution || { mode: "middle", text: "" },
          notes: d.notes || "", related: d.related || [], status: d.status || "draft" });
        setEditMode(false);   // read-first; Edit opens the editor (admin only)
      }
    });
  };
  const newEntry = () => { setSavedAt(null); setEditMode(true); setEditing(module === "topic" ? blankTopic() : module === "argument" ? blankArgument() : blankClaim(module)); };

  // Opened from the metaV sidebar: jump straight into a name-topic's page.
  useEffect(() => {
    if (pending) { openEntry(pending); if (onConsumed) onConsumed(); }
  }, [pending]);

  const save = () => {
    if (!editing || !editing.title.trim() || saving) return;
    setSaving(true);
    let payload;
    if (isTopicLike(editing.type)) {
      payload = { ...editing, sections: editing.sections.map(s => ({ heading: s.heading, verses: s.verses.map(v => ({ ref: v.ref })) })) };
    } else if (editing.type === "argument") {
      payload = { ...editing, sides: padSides(editing.sides).map(s => ({ claim: s.claim, verses: (s.verses || []).map(v => ({ ref: v.ref })) })) };
    } else {
      payload = { ...editing, support: editing.support.map(v => ({ ref: v.ref })), tension: editing.tension.map(v => ({ ref: v.ref })) };
    }
    api.studySave(payload).then(d => {
      setSaving(false);
      if (d && d.id) { setEditing(e => ({ ...e, id: d.id })); setSavedAt(Date.now()); load(module); }
    });
  };
  const del = () => {
    if (!editing || !editing.id) { setEditing(null); return; }
    if (!window.confirm("Delete this entry?")) return;
    api.studyDelete(editing.id).then(() => { setEditing(null); load(module); });
  };

  if (err) return <div className="stats-view"><div className="stats-empty">Couldn't load study content. (Admin sign-in required.)</div></div>;

  if (editing) {
    const ro = previewReader || !editMode;   // read-only: preview mode, or not actively editing
    const close = () => { setEditing(null); setSavedAt(null); };
    if (isTopicLike(editing.type))
      return <div className="study-view"><TopicPage entry={editing} editing={!ro} onChange={setEditing} onSave={save} onDelete={del} onClose={close} onToggleEdit={() => setEditMode(m => !m)} previewReader={previewReader} saving={saving} savedAt={savedAt} /></div>;
    if (editing.type === "argument")
      return <div className="study-view"><ArgumentPage entry={editing} editing={!ro} onChange={setEditing} onSave={save} onDelete={del} onClose={close} onToggleEdit={() => setEditMode(m => !m)} previewReader={previewReader} saving={saving} savedAt={savedAt} /></div>;
    if (ro)
      return <div className="study-view"><DenominationRead entry={editing} onClose={close} onToggleEdit={() => setEditMode(true)} previewReader={previewReader} /></div>;
    return <div className="study-view"><StudyEditor entry={editing} onChange={setEditing} onSave={save} onDelete={del} onClose={close} onToggleEdit={() => setEditMode(false)} saving={saving} savedAt={savedAt} /></div>;
  }

  const isTopic = module === "topic";
  const moduleName = isTopic ? "Topics" : (module === "denomination" ? "Denominations" : "Arguments");
  const newLabel = isTopic ? "topic" : (module === "denomination" ? "denomination" : "argument");
  const qs = q.trim().toLowerCase();
  const pool = (entries || []).filter(e => !previewReader || e.status === "published");   // a reader only sees published
  const shown = pool.filter(e => !qs || (e.title || "").toLowerCase().includes(qs) || (e.heldBy || "").toLowerCase().includes(qs));
  return (
    <div className="study-view">
      <div className="study-sub">
        {STUDY_MODULES.map(m => (
          <button key={m.id} className={"study-sub-b" + (module === m.id ? " on" : "")} onClick={() => pickModule(m.id)}>{m.label}</button>
        ))}
        <button className={"study-preview-toggle" + (previewReader ? " on" : "")} onClick={() => setPreviewReader(p => !p)}
          title="See exactly what a reader sees — editing off, drafts hidden">
          {previewReader ? "✓ Previewing as reader" : "Preview as reader"}
        </button>
      </div>
      {previewReader && (
        <div className="study-preview-note">
          You're seeing what a reader sees — editing is off and drafts are hidden.
          <button className="study-preview-exit" onClick={() => setPreviewReader(false)}>Exit preview</button>
        </div>
      )}
      <div className="study-list-head">
        <h1 className="stats-title">{moduleName}</h1>
        {!previewReader && <button className="study-new" onClick={newEntry}>+ New {newLabel}</button>}
      </div>
      <div className="stats-sub">{isTopic
        ? "Browse a subject and its verses, grouped by subtopic. Mostly filled from MetaV — light edits only."
        : module === "argument"
        ? "Two sides laid out with their own verses, and where the text lands between them — or stays a mystery."
        : "A position with its support and tension verses, and where the text resolves it — or stays a mystery."}</div>

      {pool.length > 0 && (
        <input className="study-search-input" type="text" value={q}
          placeholder={"Search " + moduleName.toLowerCase() + "…"} onChange={e => setQ(e.target.value)} />
      )}

      {entries === null ? (
        <div className="stats-empty">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="stats-empty">{qs
          ? "No matches for “" + q + "”."
          : previewReader
          ? "Nothing published yet — mark an entry Published to show it here."
          : "Nothing here yet — start with “+ New " + newLabel + "”." + (isTopic ? " (Or import from MetaV.)" : "")}</div>
      ) : (
        <div className="study-rows">
          {shown.map(e => (
            <button className="study-row" key={e.id} onClick={() => openEntry(e.id)}>
              {!isTopic && <span className={"study-badge study-badge--" + e.type}>{STUDY_TYPE_LABEL[e.type] || e.type}</span>}
              <span className="study-row-title">{e.title}{e.heldBy ? <span className="study-row-held"> · {e.heldBy}</span> : null}</span>
              <span className="study-row-n">{e.n || 0} {isTopic ? "verses" : "refs"}</span>
              {!previewReader && e.status === "draft" && <span className="study-row-draft">draft</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
