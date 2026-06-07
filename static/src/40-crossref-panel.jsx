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
  const { sheetRef, scrollRef } = useSwipeToDismiss(onClose);

  return (
    <aside ref={isMobile ? sheetRef : null} className={"xref-panel " + (isMobile ? "detail-sheet" : "detail-side")} role="dialog" aria-label="Related Passages">
      {isMobile && <div className="sheet-drag-zone" aria-hidden="true"><div className="sheet-handle"></div></div>}
      <div className="detail-head">
        <div className="detail-head-l">
          <span className="detail-pos">{sourceRef}</span>
          <span className="xref-badge">TSK</span>
        </div>
        <button className="detail-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="xref-body" ref={isMobile ? scrollRef : null}>
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
