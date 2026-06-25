import { useState, useEffect, useRef, useCallback } from "react";

const C = {
  bg: "#0D0F14", surface: "#13161E", surfaceHigh: "#1A1E2A",
  border: "#252A38", gold: "#C9A84C", goldDim: "#2A2213", goldText: "#E8C87A",
  green: "#2ECC71", red: "#E74C3C", blue: "#4A9EFF", amber: "#F59E0B",
  textPrimary: "#EDF0F7", textMuted: "#5A6280", textDim: "#2A3050",
  mono: "'JetBrains Mono','Fira Mono',monospace",
};

const BACKEND = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

// Yahoo Finance symbol map for portfolio holdings
const YF_SYMBOLS = {
  CSPX: "CSPX.L", CSNDX: "CNDX.SW", CSSX5E: "CSSX5E.SW",
  IEEM: "IEEM.L", IUSE: "IUSE.L", NQSE: "NQSE.DE",
  VUAG: "VUAG.L", VWRL: "VWRL.L", VFEM: "VFEM.L",
};

function b64ToUint8(b) {
  const pad = "=".repeat((4 - b.length % 4) % 4);
  const raw = atob((b + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

const Mono  = ({ children, style = {} }) => <span style={{ fontFamily: C.mono, ...style }}>{children}</span>;
const Label = ({ children }) => <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{children}</div>;
const Card  = ({ children, style = {} }) => <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", marginBottom: 10, ...style }}>{children}</div>;

function PnlText({ value, style = {} }) {
  const v = parseFloat(value || 0);
  if (v === 0) return <Mono style={{ color: C.textMuted, ...style }}>—</Mono>;
  return <Mono style={{ color: v >= 0 ? C.green : C.red, fontWeight: 600, ...style }}>{v >= 0 ? "+" : ""}€{Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Mono>;
}

function AllocationBar({ pct }) {
  return (
    <div style={{ height: 4, background: C.border, borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: C.gold, borderRadius: 2 }} />
    </div>
  );
}

// ── Shared chart helpers ─────────────────────────────────────────
function niceStep(range, ticks = 5) {
  const raw = range / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const n of [1, 2, 2.5, 5, 10]) if (n * mag >= raw) return n * mag;
  return mag * 10;
}
function yTicks(min, max, ticks = 5) {
  const step = niceStep(max - min || 1, ticks);
  const start = Math.floor(min / step) * step;
  const result = [];
  for (let v = start; v <= max + step * 0.1; v += step) result.push(+v.toFixed(10));
  return result;
}
function fmtTick(v) {
  const abs = Math.abs(v);
  if (abs >= 1000) return (v / 1000).toFixed(1) + "k";
  if (abs >= 1)    return v % 1 === 0 ? v.toFixed(0) : v.toFixed(2);
  return v.toFixed(3);
}

// Shared SVG chart with Y-axis
function SVGChart({ series, color, height = 140, showZero = false, gradId = "g0" }) {
  if (!series || !series.length) return null;
  const parsed = series.map(v => (v === null || v === undefined) ? null : parseFloat(v));
  series = parsed;
  const vals = series.filter(v => v !== null && !isNaN(v));
  if (!vals.length) return null;
  const min = Math.min(...vals), max = Math.max(...vals);
  const ticks = yTicks(min, max, 4);
  const lo = ticks[0], hi = ticks[ticks.length - 1], vRange = hi - lo || 1;
  const W = 300, H = height, YAXIS = 38, PAD = 6;

  const toY = v => H - ((v - lo) / vRange) * (H - PAD * 2) - PAD;
  const toX = i => YAXIS + (i / Math.max(series.filter(v=>v!==null).length - 1, 1)) * W;

  // Build points only from non-null values
  const nonNull = series.map((v, i) => ({ v, ni: i })).filter(p => p.v !== null && !isNaN(p.v));
  const pts = nonNull.map(({ v }, ni) => `${YAXIS + (ni / Math.max(nonNull.length - 1, 1)) * W},${toY(v)}`).join(" ");

  const zeroY = showZero && lo < 0 && hi > 0 ? toY(0) : null;
  const lastVal = nonNull[nonNull.length - 1]?.v;
  const lineCol = color || (lastVal >= 0 ? C.green : C.red);

  return (
    <svg viewBox={`0 0 ${W + YAXIS} ${H}`} style={{ width: "100%", height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineCol} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineCol} stopOpacity="0" />
        </linearGradient>
        <clipPath id={`clip_${gradId}`}>
          <rect x={YAXIS} y={0} width={W} height={H} />
        </clipPath>
      </defs>

      {/* Y-axis grid lines + labels */}
      {ticks.map((t, i) => {
        const y = toY(t);
        if (y < 0 || y > H) return null;
        return (
          <g key={i}>
            <line x1={YAXIS} y1={y} x2={YAXIS + W} y2={y}
              stroke={C.border} strokeWidth="1" strokeDasharray={t === 0 ? "none" : "3,4"} opacity="0.6" />
            <text x={YAXIS - 3} y={y + 3.5} textAnchor="end"
              style={{ fontSize: 8, fill: C.textMuted, fontFamily: C.mono }}>{fmtTick(t)}</text>
          </g>
        );
      })}

      {/* Zero line bold */}
      {zeroY !== null && (
        <line x1={YAXIS} y1={zeroY} x2={YAXIS + W} y2={zeroY}
          stroke={C.textDim} strokeWidth="1.5" />
      )}

      {/* Area fill */}
      {pts && (
        <polygon
          points={`${YAXIS},${H} ${pts} ${YAXIS + W},${H}`}
          fill={`url(#${gradId})`} clipPath={`url(#clip_${gradId})`} />
      )}

      {/* Line */}
      {pts && (
        <polyline points={pts} fill="none" stroke={lineCol} strokeWidth="1.8"
          clipPath={`url(#clip_${gradId})`} />
      )}

      {/* Y axis border */}
      <line x1={YAXIS} y1={0} x2={YAXIS} y2={H} stroke={C.border} strokeWidth="1" />
    </svg>
  );
}

// ── Line chart (price) ────────────────────────────────────────────
function LineChart({ bars, height = 140 }) {
  if (!bars?.length) return null;
  const closes = bars.map(b => parseFloat(b.close)).filter(v => !isNaN(v));
  const first = closes[0], last = closes[closes.length - 1];
  const col = last >= first ? C.green : C.red;
  return <SVGChart series={closes} color={col} height={height} gradId="price_line" />;
}

// ── Candlestick chart ─────────────────────────────────────────────
function CandlestickChart({ bars, height = 200 }) {
  if (!bars?.length) return null;
  const recent = bars.slice(-80);
  const highs  = recent.map(b => b.high).filter(Boolean);
  const lows   = recent.map(b => b.low).filter(Boolean);
  if (!highs.length) return null;
  const rawMin = Math.min(...lows), rawMax = Math.max(...highs);
  const ticks  = yTicks(rawMin, rawMax, 4);
  const lo = ticks[0], hi = ticks[ticks.length - 1], vRange = hi - lo || 1;
  const W = 300, H = height, YAXIS = 38, PAD = 4;
  const toY = v => H - ((v - lo) / vRange) * (H - PAD * 2) - PAD;
  const candleW = Math.max(2, (W / recent.length) - 1);

  return (
    <svg viewBox={`0 0 ${W + YAXIS} ${H}`} style={{ width: "100%", height }} preserveAspectRatio="none">
      {/* Y axis */}
      {ticks.map((t, i) => {
        const y = toY(t);
        if (y < 0 || y > H) return null;
        return (
          <g key={i}>
            <line x1={YAXIS} y1={y} x2={YAXIS + W} y2={y} stroke={C.border} strokeWidth="1" strokeDasharray="3,4" opacity="0.6" />
            <text x={YAXIS - 3} y={y + 3.5} textAnchor="end"
              style={{ fontSize: 8, fill: C.textMuted, fontFamily: C.mono }}>{fmtTick(t)}</text>
          </g>
        );
      })}
      <line x1={YAXIS} y1={0} x2={YAXIS} y2={H} stroke={C.border} strokeWidth="1" />
      {/* Candles */}
      {recent.map((b, i) => {
        if (!b.open || !b.close || !b.high || !b.low) return null;
        const bull = b.close >= b.open;
        const col  = bull ? C.green : C.red;
        const x    = YAXIS + (i / recent.length) * W;
        const yH = toY(b.high), yL = toY(b.low);
        const yO = toY(b.open), yC = toY(b.close);
        const bodyT = Math.min(yO, yC), bodyH = Math.max(Math.abs(yC - yO), 1);
        return (
          <g key={i}>
            <line x1={x + candleW / 2} y1={yH} x2={x + candleW / 2} y2={yL} stroke={col} strokeWidth="1" />
            <rect x={x} y={bodyT} width={candleW} height={bodyH} fill={col} opacity="0.9" />
          </g>
        );
      })}
    </svg>
  );
}

// ── Inline chat chart ────────────────────────────────────────────
function InlineChart({ symbol, range = "1y" }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState("line");

  useEffect(() => {
    const interval = range === "1d" ? "5m" : range === "5d" ? "1h" : "1d";
    fetch(`${BACKEND}/api/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [symbol, range]);

  if (loading) return <div style={{ padding: "12px 0", color: C.textMuted, fontSize: 12 }}>Loading chart…</div>;
  if (!data?.bars?.length) return <div style={{ padding: "8px 0", color: C.red, fontSize: 12 }}>No chart data for {symbol}</div>;

  const bars   = data.bars;
  const first  = bars[0].close, last = bars[bars.length - 1].close;
  const chg    = last - first, chgPct = ((chg / first) * 100).toFixed(2);
  const chgCol = chg >= 0 ? C.green : C.red;

  return (
    <div style={{ marginTop: 10, background: C.surfaceHigh, borderRadius: 12, padding: "12px 14px", border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <Mono style={{ fontSize: 14, fontWeight: 700 }}>{data.symbol}</Mono>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{range.toUpperCase()} · {data.currency}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <Mono style={{ fontSize: 16, fontWeight: 700 }}>{last?.toFixed(2)}</Mono>
          <div style={{ fontSize: 12, color: chgCol }}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)} ({chg >= 0 ? "+" : ""}{chgPct}%)</div>
        </div>
      </div>
      {type === "line" ? <LineChart bars={bars} height={150} /> : <CandlestickChart bars={bars} height={190} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <div style={{ fontSize: 10, color: C.textDim }}>{bars[0]?.date} → {bars[bars.length-1]?.date}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {[["line","Line"],["candle","Candle"]].map(([t,l]) => (
            <button key={t} onClick={() => setType(t)}
              style={{ padding: "3px 8px", background: type===t ? C.goldDim : "none", border: `1px solid ${type===t ? C.gold : C.border}`, borderRadius: 6, color: type===t ? C.goldText : C.textMuted, fontSize: 10, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Quant metric chart ───────────────────────────────────────────
function QuantChart({ symbol, metric, range, label, data: propData = null }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (propData) {
      setData(propData);
      setLoading(false);
      return;
    }
    // Fallback: fetch from cache endpoint
    fetch(`${BACKEND}/api/analytics/${encodeURIComponent(symbol)}?range=${range}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [symbol, metric, range, propData]);

  if (loading) return <div style={{ padding: "10px 0", color: C.textMuted, fontSize: 12 }}>Loading {label}…</div>;
  if (!data) return null;
  // Series can be at top level (when passed directly) or nested
  const series = data[metric];
  if (!series) return null;

  const dates   = data.dates || [];
  const nonNull = series.filter(v => v !== null);
  if (!nonNull.length) return null;

  const last      = nonNull[nonNull.length - 1];
  const isZscore  = metric.includes("Zscore") || metric.includes("zscore");
  const isDd      = metric.includes("drawdown") || metric.includes("Drawdown");
  const lineCol   = isZscore ? C.gold : isDd ? C.red : (last >= 0 ? C.green : C.red);
  const lastCol   = isZscore ? C.gold : isDd ? C.red : (last >= 0 ? C.green : C.red);
  const showZero  = !isDd && nonNull.some(v => v < 0) && nonNull.some(v => v > 0);

  return (
    <div style={{ marginTop: 10, background: C.surfaceHigh, borderRadius: 12, padding: "12px 14px 8px", border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted }}>{label}</div>
        <Mono style={{ fontSize: 14, fontWeight: 700, color: lastCol }}>{last?.toFixed(3)}</Mono>
      </div>
      <SVGChart series={series} color={lineCol} height={110} showZero={showZero} gradId={`qc_${metric}_${symbol}`} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <div style={{ fontSize: 9, color: C.textDim }}>{dates[0]}</div>
        <div style={{ fontSize: 9, color: C.textDim }}>{dates[dates.length-1]}</div>
      </div>
    </div>
  );
}

// ── Rolling Beta chart (fetches benchmark separately) ─────────────
function RollingBetaChart({ symbol, range, window: win = 30, benchmark = "^GSPC" }) {
  const [betaSeries, setBetaSeries] = useState(null);
  const [dates, setDates]           = useState(null);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    async function compute() {
      setLoading(true);
      try {
        const [ar, br] = await Promise.all([
          fetch(`${BACKEND}/api/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`).then(r=>r.json()),
          fetch(`${BACKEND}/api/chart/${encodeURIComponent(benchmark)}?range=${range}&interval=1d`).then(r=>r.json()),
        ]);
        const ac = ar.bars?.map(b => b.close).filter(Boolean) || [];
        const bc = br.bars?.map(b => b.close).filter(Boolean) || [];
        const ds = ar.bars?.map(b => b.date) || [];

        // Align lengths
        const len = Math.min(ac.length, bc.length);
        const a = ac.slice(-len), b = bc.slice(-len), d = ds.slice(-len);

        // Daily returns
        const aRet = a.slice(1).map((v,i) => (v - a[i]) / a[i]);
        const bRet = b.slice(1).map((v,i) => (v - b[i]) / b[i]);

        // Rolling beta (window days)
        const series = new Array(win).fill(null);
        for (let i = win; i <= aRet.length; i++) {
          const ar_ = aRet.slice(i - win, i);
          const br_ = bRet.slice(i - win, i);
          const ma = ar_.reduce((s,v)=>s+v,0)/ar_.length;
          const mb = br_.reduce((s,v)=>s+v,0)/br_.length;
          const cov = ar_.reduce((s,v,j)=>s+(v-ma)*(br_[j]-mb),0)/ar_.length;
          const vb  = br_.reduce((s,v)=>s+(v-mb)**2,0)/br_.length;
          series.push(vb===0 ? null : +(cov/vb).toFixed(4));
        }
        setBetaSeries(series);
        setDates(d);
      } catch {}
      setLoading(false);
    }
    compute();
  }, [symbol, range, win]);

  if (loading) return <div style={{ padding: "10px 0", color: C.textMuted, fontSize: 12 }}>Computing rolling beta vs {benchmark}…</div>;
  if (!betaSeries) return null;

  const nonNull = betaSeries.filter(v => v !== null);
  if (!nonNull.length) return null;
  const last = nonNull[nonNull.length - 1];

  return (
    <div style={{ marginTop: 10, background: C.surfaceHigh, borderRadius: 12, padding: "12px 14px 8px", border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted }}>Rolling Beta vs {benchmark} ({win}d)</div>
        <Mono style={{ fontSize: 14, fontWeight: 700, color: C.blue }}>{last?.toFixed(3)}</Mono>
      </div>
      <SVGChart series={betaSeries} color={C.blue} height={110} showZero={true} gradId={`beta_${symbol}`} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <div style={{ fontSize: 9, color: C.textDim }}>{dates?.[0]}</div>
        <div style={{ fontSize: 9, color: C.textDim }}>{dates?.[dates.length-1]}</div>
      </div>
    </div>
  );
}

// Parse message content — split on @@CHART:...@@ and @@QUANT:...@@ tags
function MessageContent({ content }) {
  if (!content) return null;
  const TAG_RE = /(@@(?:CHART|QUANT):[^@]+@@)/g;
  const parts = content.split(TAG_RE);
  return (
    <>
      {parts.map((part, i) => {
        // Price chart: @@CHART:SYMBOL:RANGE@@
        const cm = part.match(/^@@CHART:([^:]+):([^@]+)@@$/);
        if (cm) return <InlineChart key={i} symbol={cm[1]} range={cm[2]} />;
        // Quant chart: @@QUANT:SYMBOL:METRIC:RANGE:LABEL@@
        const qm = part.match(/^@@QUANT:([^:]+):([^:]+):([^:]+):([^@]+)@@$/);
        if (qm) return <QuantChart key={i} symbol={qm[1]} metric={qm[2]} range={qm[3]} label={qm[4]} />;
        if (part) return <span key={i} style={{ whiteSpace: "pre-wrap" }}>{part}</span>;
        return null;
      })}
    </>
  );
}

export default function IBKRAgent() {
  const [tab, setTab] = useState("chat");
  const [messages, setMessages] = useState([{
    role: "assistant",
    content: "Connected to both IBKR accounts + live market data for any stock worldwide. I can show charts, quotes, portfolio analysis, P&L, and trade history. What would you like?"
  }]);
  const [input, setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [portfolio, setPortfolio] = useState(null);
  const [portLoading, setPortLoading] = useState(false);
  const [tasks, setTasks]   = useState([]);
  const [taskLog, setTaskLog] = useState([]);
  const [runningTask, setRunningTask] = useState(null);
  const [pushStatus, setPushStatus]   = useState("idle");
  const [ibkrOk, setIbkrOk] = useState(null);
  const [portfolioView, setPortfolioView] = useState("combined");
  // Charts
  const [chartSymbol, setChartSymbol] = useState("");
  const [chartInput, setChartInput]   = useState("");
  const [chartRange, setChartRange]   = useState("1y");
  const [chartType, setChartType]     = useState("line");
  const [chartData, setChartData]     = useState(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [quotes, setQuotes]           = useState([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  // Portfolio performance chart
  const [perfData, setPerfData]       = useState(null);
  const [quantData, setQuantData]     = useState(null);
  const [quantLoading, setQuantLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    loadPortfolio(); loadTasks(); loadLog(); checkStatus(); checkPush();
  }, []);

  async function checkStatus() {
    try { const r = await fetch(`${BACKEND}/api/ibkr/status`); const d = await r.json(); setIbkrOk(d.authenticated); } catch { setIbkrOk(false); }
  }
  async function loadPortfolio() {
    setPortLoading(true);
    try { const r = await fetch(`${BACKEND}/api/account`); setPortfolio(await r.json()); } catch {}
    setPortLoading(false);
  }
  async function loadTasks() { try { setTasks(await (await fetch(`${BACKEND}/api/tasks`)).json()); } catch {} }
  async function loadLog()   { try { setTaskLog(await (await fetch(`${BACKEND}/api/log`)).json()); } catch {} }

  // Load quotes for all portfolio holdings
  async function loadQuotes() {
    if (!portfolio?.combined?.positions?.length) return;
    setQuotesLoading(true);
    const syms = portfolio.combined.positions.map(p => YF_SYMBOLS[p.symbol] || p.symbol).join(",");
    try {
      const r = await fetch(`${BACKEND}/api/quotes?symbols=${encodeURIComponent(syms)}`);
      setQuotes(await r.json());
    } catch {}
    setQuotesLoading(false);
  }

  // Load chart for a symbol
  async function loadChart(sym, range = chartRange) {
    if (!sym) return;
    setChartLoading(true);
    setChartData(null);
    setQuantData(null);
    try {
      const r = await fetch(`${BACKEND}/api/chart/${encodeURIComponent(sym)}?range=${range}&interval=${range === "1d" ? "5m" : range === "5d" ? "1h" : "1d"}`);
      const d = await r.json();
      setChartData(d);
      setChartSymbol(sym);
      // Also load quant data async
      loadQuantData(sym, range);
    } catch {}
    setChartLoading(false);
  }

  // Load quant analytics for current chart symbol
  async function loadQuantData(sym, range = chartRange) {
    if (!sym) return;
    setQuantLoading(true);
    setQuantData(null);
    try {
      // Compute directly on backend (caches result server-side)
      const r = await fetch(`${BACKEND}/api/analytics/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: sym, range, rolling_window: 30 }),
      });
      const d = await r.json();
      if (d.series) setQuantData({ ...d.series, symbol: sym, range });
    } catch {}
    setQuantLoading(false);
  }

  // Load portfolio performance from equity summary history
  async function loadPerfChart() {
    try {
      // Use the equity summary data we already have in the Flex data
      const r = await fetch(`${BACKEND}/api/account`);
      const d = await r.json();
      // Build performance series from accounts
      const series = d.accounts?.map(a => ({
        accountId: a.accountId,
        currency:  a.baseCurrency,
        current:   a.netLiquidation,
        starting:  a.startingValue / a.acctFxToEUR, // back to native currency
        gain:      a.ytdGainEUR,
        twr:       a.ytdReturn,
      }));
      setPerfData({ accounts: series, combined: d.combined });
    } catch {}
  }

  async function toggleTask(id, enabled) {
    await fetch(`${BACKEND}/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    loadTasks();
  }
  async function runTaskNow(id) {
    setRunningTask(id);
    await fetch(`${BACKEND}/api/tasks/${id}/run`, { method: "POST" });
    setTimeout(async () => { await loadTasks(); await loadLog(); setRunningTask(null); }, 60000);
  }
  async function sendMessage() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { role: "user", content: text }, { role: "assistant", content: "", loading: true }]);
    setInput(""); setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, history }) });
      const d = await r.json();
      setMessages(prev => [...prev.slice(0, -1), { role: "assistant", content: d.reply || d.error || "No response" }]);
    } catch (e) {
      setMessages(prev => [...prev.slice(0, -1), { role: "assistant", content: `Error: ${e.message}` }]);
    }
    setLoading(false);
  }
  async function checkPush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setPushStatus("unsupported"); return; }
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) setPushStatus("subscribed");
      else if (Notification.permission === "denied") setPushStatus("denied");
    } catch {}
  }
  async function enablePush() {
    setPushStatus("requesting");
    try {
      const { publicKey } = await (await fetch(`${BACKEND}/api/push/vapid-key`)).json();
      if (!publicKey) throw new Error("VAPID key not configured");
      if (await Notification.requestPermission() !== "granted") { setPushStatus("denied"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(publicKey) });
      await fetch(`${BACKEND}/api/push/subscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
      setPushStatus("subscribed");
    } catch (e) { setPushStatus("idle"); alert("Push failed: " + e.message); }
  }
  async function disablePush() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await fetch(`${BACKEND}/api/push/unsubscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
      setPushStatus("idle");
    } catch {}
  }

  const combined = portfolio?.combined;
  const acct1    = portfolio?.accounts?.find(a => a.accountId === "U11354150");
  const acct2    = portfolio?.accounts?.find(a => a.accountId === "U9733561");
  const fmtEUR = v => `€${parseFloat(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtGBP = v => `£${parseFloat(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = v => `${parseFloat(v || 0).toFixed(1)}%`;

  const PushBanner = () => {
    if (pushStatus === "unsupported" || pushStatus === "subscribed") return null;
    if (pushStatus === "denied") return (
      <div style={{ background: C.surfaceHigh, border: `1px solid ${C.red}44`, borderRadius: 12, padding: "11px 14px", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: C.red, fontWeight: 600 }}>🔕 Notifications blocked</div>
      </div>
    );
    return (
      <button onClick={enablePush} disabled={pushStatus === "requesting"} style={{ width: "100%", background: C.goldDim, border: `1px solid ${C.gold}55`, borderRadius: 12, padding: "13px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", textAlign: "left" }}>
        <span style={{ fontSize: 20 }}>🔔</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.goldText }}>{pushStatus === "requesting" ? "Setting up…" : "Enable push notifications"}</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Alerts for tasks and P&L — even when app is closed</div>
        </div>
      </button>
    );
  };

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "Inter,system-ui,sans-serif", color: C.textPrimary, maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", height: "100dvh" }}>

      {/* Header */}
      <div style={{ padding: "14px 18px 12px", borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: C.goldDim, border: `1px solid ${C.gold}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📊</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.goldText }}>IBKR Agent</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: ibkrOk ? C.green : ibkrOk === false ? C.red : C.amber }} />
                <span style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {ibkrOk ? "2 accounts connected" : ibkrOk === false ? "Offline" : "Connecting"}
                </span>
              </div>
            </div>
          </div>
          {combined && (
            <div style={{ textAlign: "right" }}>
              <Mono style={{ fontSize: 17, fontWeight: 700 }}>{fmtEUR(combined.totalNetLiquidation)}</Mono>
              {combined.avgYtdReturnPct !== 0 && (
                <div style={{ fontSize: 11, color: combined.avgYtdReturnPct >= 0 ? C.green : C.red, marginTop: 1 }}>
                  {combined.avgYtdReturnPct > 0 ? "▲" : "▼"} {Math.abs(combined.avgYtdReturnPct)}% 1Y
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
        {[["chat","💬","Chat"],["portfolio","📊","Portfolio"],["charts","📈","Charts"],["schedule","⏱","Schedule"]].map(([id, icon, label]) => (
          <button key={id} onClick={() => { setTab(id); if (id === "charts" && !quotes.length) loadQuotes(); if (id === "charts") loadPerfChart(); }}
            style={{ flex: 1, padding: "10px 0", background: "none", border: "none", cursor: "pointer", fontSize: 11, fontWeight: tab === id ? 700 : 400, color: tab === id ? C.goldText : C.textMuted, borderBottom: tab === id ? `2px solid ${C.gold}` : "2px solid transparent" }}>
            {icon} {label}
          </button>
        ))}
      </div>

      {/* ══ CHAT ══════════════════════════════════════════════════ */}
      {tab === "chat" && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            <PushBanner />
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 16 }}>
              {["Combined portfolio", "Show CSPX chart", "All holdings quotes", "P&L summary", "Compare CSPX vs S&P"].map(q => (
                <button key={q} onClick={() => setInput(q)} style={{ background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 20, padding: "5px 11px", color: C.textMuted, fontSize: 12, cursor: "pointer" }}>{q}</button>
              ))}
            </div>
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: 14, display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: 8, alignItems: "flex-end" }}>
                {m.role === "assistant" && (
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: C.goldDim, border: `1px solid ${C.gold}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>🤖</div>
                )}
                <div style={{ maxWidth: "82%", padding: "10px 14px", borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: m.role === "user" ? "#1E3A5F" : C.surfaceHigh, border: m.role === "user" ? "none" : `1px solid ${C.border}`, color: C.textPrimary, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {m.loading ? <span style={{ opacity: 0.4 }}>Thinking…</span> : <MessageContent content={m.content} />}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div style={{ padding: "12px 14px", borderTop: `1px solid ${C.border}`, background: C.surface, display: "flex", gap: 10, flexShrink: 0 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder="Ask about portfolio, charts, any stock…"
              style={{ flex: 1, background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", color: C.textPrimary, fontSize: 14, outline: "none", fontFamily: "inherit" }} />
            <button onClick={sendMessage} disabled={loading}
              style={{ background: loading ? C.goldDim : C.gold, border: "none", borderRadius: 12, width: 44, cursor: loading ? "default" : "pointer", color: "#0D0F14", fontSize: 20, fontWeight: 900 }}>↑</button>
          </div>
        </div>
      )}

      {/* ══ PORTFOLIO ═════════════════════════════════════════════ */}
      {tab === "portfolio" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {portLoading && <div style={{ color: C.textMuted, textAlign: "center", padding: 48 }}>Loading…</div>}
          {portfolio && !portLoading && (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                {[["combined","Combined"],["u1","EUR Account"],["u2","GBP Account"]].map(([v, label]) => (
                  <button key={v} onClick={() => setPortfolioView(v)}
                    style={{ flex: 1, padding: "7px 4px", background: portfolioView === v ? C.goldDim : C.surfaceHigh, border: `1px solid ${portfolioView === v ? C.gold : C.border}`, borderRadius: 8, color: portfolioView === v ? C.goldText : C.textMuted, fontSize: 11, cursor: "pointer", fontWeight: portfolioView === v ? 700 : 400 }}>
                    {label}
                  </button>
                ))}
              </div>

              {portfolioView === "combined" && combined && (
                <>
                  <Card style={{ gridColumn: "1/-1", padding: "16px" }}>
                    <Label>Combined Net Liquidation</Label>
                    <Mono style={{ fontSize: 24, fontWeight: 700, color: C.goldText }}>{fmtEUR(combined.totalNetLiquidation)}</Mono>
                    {combined.avgYtdReturnPct !== 0 && (
                      <div style={{ marginTop: 6, display: "flex", gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 2 }}>1Y RETURN</div>
                          <Mono style={{ fontSize: 14, fontWeight: 700, color: combined.avgYtdReturnPct >= 0 ? C.green : C.red }}>
                            {combined.avgYtdReturnPct > 0 ? "+" : ""}{combined.avgYtdReturnPct}%
                          </Mono>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 2 }}>1Y GAIN</div>
                          <PnlText value={combined.totalYtdGainEUR} style={{ fontSize: 14 }} />
                        </div>
                      </div>
                    )}
                  </Card>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 14 }}>
                    {[
                      { label: "Total Cash", val: fmtEUR(combined.totalCash) },
                      { label: "Stock Value", val: fmtEUR(combined.totalStockValue) },
                      { label: "Unrealized P&L", val: combined.totalUnrealizedPnlEUR, isPnl: true },
                      { label: "Dividends (1Y)", val: fmtEUR(combined.totalDividends) },
                      { label: "Commissions (1Y)", val: fmtEUR(combined.totalCommissions) },
                      { label: "Broker Interest", val: fmtEUR(combined.totalBrokerInterest) },
                    ].map(s => (
                      <Card key={s.label} style={{ padding: "12px 14px" }}>
                        <Label>{s.label}</Label>
                        {s.isPnl ? <PnlText value={s.val} style={{ fontSize: 15 }} /> : <Mono style={{ fontSize: 15, fontWeight: 700 }}>{s.val}</Mono>}
                      </Card>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Positions — combined allocation</div>
                  {combined.positions.map(p => (
                    <Card key={p.symbol}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Mono style={{ fontSize: 15, fontWeight: 700 }}>{p.symbol}</Mono>
                            <span style={{ fontSize: 11, color: C.textMuted }}>{fmtPct(p.allocationPct)}</span>
                            <button onClick={() => { loadChart(YF_SYMBOLS[p.symbol] || p.symbol); setTab("charts"); }}
                              style={{ marginLeft: "auto", background: C.goldDim, border: `1px solid ${C.gold}44`, borderRadius: 6, padding: "2px 8px", color: C.goldText, fontSize: 11, cursor: "pointer" }}>Chart</button>
                          </div>
                          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{p.description}</div>
                          <AllocationBar pct={p.allocationPct} />
                          {p.legs.length > 1 && (
                            <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>{p.legs.map(l => `${l.accountId.slice(-7)}: ${l.quantity}`).join(" · ")}</div>
                          )}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                          <Mono style={{ fontSize: 14, fontWeight: 600 }}>{fmtEUR(p.totalValueEUR)}</Mono>
                          {p.totalUnrealEUR !== 0 && <div style={{ marginTop: 3 }}><PnlText value={p.totalUnrealEUR} style={{ fontSize: 12 }} /></div>}
                        </div>
                      </div>
                    </Card>
                  ))}
                </>
              )}

              {portfolioView === "u1" && acct1 && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 14 }}>
                    {[
                      { label: "Net Liquidation", val: fmtEUR(acct1.netLiquidation) },
                      { label: "Cash", val: fmtEUR(acct1.cash) },
                      { label: "1Y Return", val: `${acct1.ytdReturn > 0 ? "+" : ""}${acct1.ytdReturn?.toFixed(2)}%`, color: acct1.ytdReturn >= 0 ? C.green : C.red },
                      { label: "1Y Gain", val: fmtEUR(acct1.ytdGainEUR) },
                    ].map(s => (
                      <Card key={s.label} style={{ padding: "12px 14px" }}>
                        <Label>{s.label}</Label>
                        <Mono style={{ fontSize: 15, fontWeight: 700, color: s.color || C.textPrimary }}>{s.val}</Mono>
                      </Card>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Positions</div>
                  {acct1.positions.map(p => (
                    <Card key={p.symbol}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <div>
                          <Mono style={{ fontSize: 14, fontWeight: 700 }}>{p.symbol}</Mono>
                          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{p.quantity} × {p.currency} {parseFloat(p.markPrice).toFixed(2)}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <Mono style={{ fontSize: 14, fontWeight: 600 }}>{p.currency} {parseFloat(p.positionValue).toFixed(2)}</Mono>
                          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{fmtPct(p.percentOfAccountNAV)} of account</div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </>
              )}

              {portfolioView === "u2" && acct2 && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 14 }}>
                    {[
                      { label: "Net Liquidation", val: fmtGBP(acct2.netLiquidation) },
                      { label: "In EUR", val: fmtEUR(acct2.netLiquidationEUR) },
                      { label: "Cash", val: fmtGBP(acct2.cash) },
                      { label: "1Y Return", val: `${acct2.ytdReturn > 0 ? "+" : ""}${acct2.ytdReturn?.toFixed(2)}%`, color: acct2.ytdReturn >= 0 ? C.green : C.red },
                    ].map(s => (
                      <Card key={s.label} style={{ padding: "12px 14px" }}>
                        <Label>{s.label}</Label>
                        <Mono style={{ fontSize: 15, fontWeight: 700, color: s.color || C.textPrimary }}>{s.val}</Mono>
                      </Card>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Positions</div>
                  {acct2.positions.map(p => (
                    <Card key={p.symbol}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <div>
                          <Mono style={{ fontSize: 14, fontWeight: 700 }}>{p.symbol}</Mono>
                          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{p.quantity} × {p.currency} {parseFloat(p.markPrice).toFixed(2)}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <Mono style={{ fontSize: 14, fontWeight: 600 }}>{p.currency} {parseFloat(p.positionValue).toFixed(2)}</Mono>
                          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{fmtPct(p.percentOfAccountNAV)}</div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </>
              )}
              <button onClick={loadPortfolio} style={{ width: "100%", marginTop: 8, background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, color: C.textMuted, fontSize: 14, cursor: "pointer" }}>↻ Refresh</button>
            </>
          )}
        </div>
      )}

      {/* ══ CHARTS ════════════════════════════════════════════════ */}
      {tab === "charts" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>

          {/* Symbol search */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input value={chartInput} onChange={e => setChartInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && loadChart(chartInput.trim())}
              placeholder="Enter symbol e.g. CSPX.L, AAPL, BTC-USD"
              style={{ flex: 1, background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", color: C.textPrimary, fontSize: 13, outline: "none" }} />
            <button onClick={() => loadChart(chartInput.trim())}
              style={{ background: C.gold, border: "none", borderRadius: 10, padding: "9px 14px", color: "#0D0F14", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Go</button>
          </div>

          {/* Quick access — portfolio holdings */}
          <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Your holdings</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {Object.entries(YF_SYMBOLS).map(([ibkr, yf]) => (
              <button key={ibkr} onClick={() => { setChartInput(yf); loadChart(yf); }}
                style={{ background: chartSymbol === yf ? C.goldDim : C.surfaceHigh, border: `1px solid ${chartSymbol === yf ? C.gold : C.border}`, borderRadius: 8, padding: "5px 10px", color: chartSymbol === yf ? C.goldText : C.textMuted, fontSize: 12, cursor: "pointer" }}>
                {ibkr}
              </button>
            ))}
          </div>

          {/* Range selector */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {["1mo","3mo","6mo","ytd","1y","2y","5y"].map(r => (
              <button key={r} onClick={() => { setChartRange(r); if (chartSymbol) loadChart(chartSymbol, r); }}
                style={{ flex: 1, padding: "6px 0", background: chartRange === r ? C.goldDim : C.surfaceHigh, border: `1px solid ${chartRange === r ? C.gold : C.border}`, borderRadius: 6, color: chartRange === r ? C.goldText : C.textMuted, fontSize: 11, cursor: "pointer", fontWeight: chartRange === r ? 700 : 400 }}>
                {r.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Chart type toggle */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {[["line","Line"],["candle","Candle"]].map(([t, l]) => (
              <button key={t} onClick={() => setChartType(t)}
                style={{ flex: 1, padding: "7px 0", background: chartType === t ? C.goldDim : C.surfaceHigh, border: `1px solid ${chartType === t ? C.gold : C.border}`, borderRadius: 8, color: chartType === t ? C.goldText : C.textMuted, fontSize: 12, cursor: "pointer", fontWeight: chartType === t ? 700 : 400 }}>
                {l}
              </button>
            ))}
          </div>

          {/* Price chart */}
          {chartLoading && <div style={{ color: C.textMuted, textAlign: "center", padding: 40 }}>Loading chart…</div>}
          {chartData && !chartLoading && (
            <Card style={{ padding: "14px 14px 8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <Mono style={{ fontSize: 16, fontWeight: 700 }}>{chartData.symbol}</Mono>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{chartData.range?.toUpperCase()} · {chartData.currency}</div>
                </div>
                {chartData.bars?.length > 0 && (() => {
                  const first = chartData.bars[0].close, last = chartData.bars[chartData.bars.length - 1].close;
                  const chg = last - first, chgPct = ((chg / first) * 100).toFixed(2);
                  const col = chg >= 0 ? C.green : C.red;
                  return (
                    <div style={{ textAlign: "right" }}>
                      <Mono style={{ fontSize: 18, fontWeight: 700 }}>{last?.toFixed(2)}</Mono>
                      <div style={{ fontSize: 13, color: col, marginTop: 2 }}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)} ({chg >= 0 ? "+" : ""}{chgPct}%)</div>
                    </div>
                  );
                })()}
              </div>
              {chartType === "line"
                ? <LineChart bars={chartData.bars} height={160} />
                : <CandlestickChart bars={chartData.bars} height={200} />}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                <div style={{ fontSize: 10, color: C.textDim }}>{chartData.bars?.[0]?.date}</div>
                <div style={{ fontSize: 10, color: C.textDim }}>{chartData.bars?.[chartData.bars.length-1]?.date}</div>
              </div>
            </Card>
          )}

          {/* Quant panels — auto-load when chart is selected */}
          {quantLoading && chartSymbol && (
            <div style={{ color: C.textMuted, fontSize: 12, textAlign: "center", padding: "12px 0" }}>Computing Z-score, volatility, beta…</div>
          )}
          {quantData && !quantLoading && (() => {
            const { dates, priceZscore, rollingVol, rollingSharpe, drawdownSeries } = quantData;
            if (!dates || !priceZscore) return (
              <div style={{ color: C.red, fontSize: 12, padding: "8px 0" }}>
                Quant data incomplete — keys: {Object.keys(quantData).join(", ")}
              </div>
            );

            // Compute rolling beta vs SPX inline from cached data
            // We'll use the QuantChart component which fetches from /api/analytics
            const sym = quantData.symbol;
            const rng = quantData.range;

            // Summary stats from last values
            const lastZ   = priceZscore?.filter(v => v !== null).slice(-1)[0];
            const lastVol = rollingVol?.filter(v => v !== null).slice(-1)[0];
            const lastSharpe = rollingSharpe?.filter(v => v !== null).slice(-1)[0];
            const lastDD  = drawdownSeries?.slice(-1)[0];

            return (
              <>
                {/* Stats row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 7, marginBottom: 12 }}>
                  {[
                    { label: "Z-Score", val: lastZ?.toFixed(2), color: lastZ > 2 ? C.red : lastZ < -2 ? C.green : C.gold },
                    { label: "Ann. Vol", val: lastVol ? lastVol.toFixed(1) + "%" : "—", color: C.textPrimary },
                    { label: "Sharpe", val: lastSharpe?.toFixed(2), color: lastSharpe > 1 ? C.green : lastSharpe < 0 ? C.red : C.amber },
                    { label: "Max DD", val: lastDD ? lastDD.toFixed(1) + "%" : "—", color: C.red },
                  ].map(s => (
                    <div key={s.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{s.label}</div>
                      <Mono style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{s.val ?? "—"}</Mono>
                    </div>
                  ))}
                </div>

                {/* Z-Score chart — pass data directly, no second fetch */}
                <QuantChart symbol={sym} metric="priceZscore" range={rng} label="Z-Score — price vs 30d rolling mean" data={quantData} />

                {/* Rolling Vol chart */}
                <QuantChart symbol={sym} metric="rollingVol" range={rng} label="Rolling Vol % annualised (30d)" data={quantData} />

                {/* Rolling Sharpe chart */}
                <QuantChart symbol={sym} metric="rollingSharpe" range={rng} label="Rolling Sharpe Ratio (30d)" data={quantData} />

                {/* Drawdown chart */}
                <QuantChart symbol={sym} metric="drawdownSeries" range={rng} label="Drawdown % from peak" data={quantData} />

                {/* Rolling Beta vs SPX — fetches benchmark independently */}
                <RollingBetaChart symbol={sym} range={rng} window={30} benchmark="^GSPC" />
              </>
            );
          })()}

          {/* Live quotes for holdings */}
          {quotes.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "16px 0 8px" }}>Live quotes — holdings</div>
              {quotes.map(q => {
                const chgColor = q.changePct >= 0 ? C.green : C.red;
                return (
                  <Card key={q.symbol} style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <Mono style={{ fontSize: 13, fontWeight: 700 }}>{q.symbol}</Mono>
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>{q.shortName?.slice(0, 30)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <Mono style={{ fontSize: 14, fontWeight: 600 }}>{q.price?.toFixed(2)}</Mono>
                        <div style={{ fontSize: 12, color: chgColor, marginTop: 1 }}>
                          {q.changePct >= 0 ? "+" : ""}{q.changePct?.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
              <button onClick={loadQuotes} style={{ width: "100%", marginTop: 4, background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, color: C.textMuted, fontSize: 13, cursor: "pointer" }}>↻ Refresh quotes</button>
            </>
          )}

          {!quotes.length && !quotesLoading && !chartData && (
            <div style={{ textAlign: "center", color: C.textMuted, padding: "32px 0", fontSize: 14 }}>
              Enter a symbol above or tap a holding to see its chart
            </div>
          )}
        </div>
      )}

      {/* ══ SCHEDULE ══════════════════════════════════════════════ */}
      {tab === "schedule" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {pushStatus === "subscribed" ? (
            <div style={{ background: C.surfaceHigh, border: `1px solid ${C.green}44`, borderRadius: 12, padding: "11px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.green }}>🔔 Notifications active</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => fetch(`${BACKEND}/api/push/test`, { method: "POST" })} style={{ background: C.goldDim, border: "none", borderRadius: 8, padding: "5px 10px", color: C.goldText, fontSize: 12, cursor: "pointer" }}>Test</button>
                <button onClick={disablePush} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "5px 10px", color: C.textMuted, fontSize: 12, cursor: "pointer" }}>Off</button>
              </div>
            </div>
          ) : <PushBanner />}

          <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Automated tasks (London time)</div>
          {tasks.map(task => (
            <Card key={task.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 16 }}>{task.icon}</span>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{task.label}</span>
                    {task.running && <span style={{ fontSize: 11, color: C.amber }}>running…</span>}
                  </div>
                  <Mono style={{ fontSize: 11, color: C.textMuted }}>{task.cronDisplay || task.cron}</Mono>
                  {task.lastRun && !task.running && (
                    <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>Last: {new Date(task.lastRun).toLocaleString()}</div>
                  )}
                  {task.lastResult && (
                    <div style={{ fontSize: 12, color: C.textPrimary, marginTop: 8, lineHeight: 1.6, whiteSpace: "pre-wrap", borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>{task.lastResult}</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, marginLeft: 10 }}>
                  <button onClick={() => runTaskNow(task.id)} disabled={!!runningTask || task.running}
                    style={{ background: C.goldDim, border: `1px solid ${C.gold}44`, borderRadius: 8, padding: "6px 10px", color: C.goldText, fontSize: 12, cursor: "pointer", fontWeight: 600, opacity: (runningTask || task.running) ? 0.5 : 1 }}>
                    {runningTask === task.id ? "…" : "Run"}
                  </button>
                  <div onClick={() => toggleTask(task.id, !task.enabled)}
                    style={{ width: 40, height: 22, borderRadius: 11, background: task.enabled ? C.gold : C.border, cursor: "pointer", position: "relative", flexShrink: 0 }}>
                    <div style={{ position: "absolute", top: 3, left: task.enabled ? 20 : 3, width: 16, height: 16, borderRadius: "50%", background: task.enabled ? "#0D0F14" : C.textMuted, transition: "left 0.2s" }} />
                  </div>
                </div>
              </div>
            </Card>
          ))}

          {taskLog.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "14px 0 8px" }}>Run log</div>
              {taskLog.slice(0, 8).map((l, i) => (
                <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{l.task}</span>
                    <Mono style={{ fontSize: 11, color: C.textMuted, display: "block", marginTop: 2 }}>{new Date(l.time).toLocaleString()}</Mono>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: l.status === "done" ? C.green : l.status === "error" ? C.red : C.amber, textTransform: "uppercase" }}>{l.status}</span>
                </div>
              ))}
            </>
          )}
          <button onClick={() => { loadTasks(); loadLog(); }} style={{ width: "100%", marginTop: 8, background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 10, padding: 11, color: C.textMuted, fontSize: 14, cursor: "pointer" }}>↻ Refresh</button>
        </div>
      )}

      <style>{`
        input::placeholder { color: #3A4060; }
        * { -webkit-tap-highlight-color: transparent; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #252A38; border-radius: 2px; }
      `}</style>
    </div>
  );
}
