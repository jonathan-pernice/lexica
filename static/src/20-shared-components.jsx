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

// Google-Maps-style bottom-sheet dismissal: drag the WHOLE card down to close,
// but only when the inner scroll area is already at the top — otherwise the body
// scrolls normally. Uses native non-passive listeners so we can block page scroll
// / pull-to-refresh while dragging (React's touch props are passive and can't).
function useSwipeToDismiss(onClose) {
  const sheetRef = React.useRef(null);
  const scrollRef = React.useRef(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  React.useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    let startY = 0, dragY = 0, active = false;
    const SNAP = 'transform 0.25s cubic-bezier(0.2,0.8,0.2,1)';

    const atTop = () => { const sc = scrollRef.current; return !sc || sc.scrollTop <= 0; };
    const onStart = (e) => {
      active = atTop();              // only arm the drag if the body is scrolled to the top
      startY = e.touches[0].clientY;
      dragY = 0;
    };
    const onMove = (e) => {
      if (!active) return;
      const d = e.touches[0].clientY - startY;
      if (d <= 0 || !atTop()) {       // pulling up, or body got scrolled → hand back to native scroll
        if (dragY) { el.style.transition = ''; el.style.transform = ''; dragY = 0; }
        active = false;
        return;
      }
      dragY = d;
      el.style.transition = 'none';
      el.style.transform = `translateY(${d}px)`;
      if (e.cancelable) e.preventDefault();   // stop the page scrolling / pull-to-refresh
    };
    const onEnd = () => {
      if (!active) return;
      active = false;
      if (dragY > 90) { closeRef.current?.(); return; }
      if (dragY) { el.style.transition = SNAP; el.style.transform = ''; }
      dragY = 0;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return { sheetRef, scrollRef };
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

function LeafletMap({ lat, lon, name }) {
  const mapRef = React.useRef(null);
  const instanceRef = React.useRef(null);
  const [ready, setReady] = React.useState(!!window.L);

  // Kick off the lazy load on first mount (no-op if Leaflet is already present).
  React.useEffect(() => {
    if (window.L) return;
    let cancelled = false;
    loadLeaflet().then(() => { if (!cancelled) setReady(true); }).catch(() => {});
    return () => { cancelled = true; };
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
      attributionControl: false,
    });
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map);
    window.L.marker([lat, lon]).addTo(map).bindPopup(name).openPopup();
    instanceRef.current = map;
    return () => { if (instanceRef.current) { instanceRef.current.remove(); instanceRef.current = null; } };
  }, [ready, lat, lon, name]);

  return <div ref={mapRef} className="metav-leaflet-map" />;
}
