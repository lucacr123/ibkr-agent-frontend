import { useState, useEffect, useRef } from "react";

const C = {
  bg: "#0D0F14", surface: "#13161E", surfaceHigh: "#1A1E2A",
  border: "#252A38", gold: "#C9A84C", goldDim: "#2A2213", goldText: "#E8C87A",
  green: "#2ECC71", red: "#E74C3C", blue: "#4A9EFF", amber: "#F59E0B",
  textPrimary: "#EDF0F7", textMuted: "#5A6280", textDim: "#2A3050",
  mono: "'JetBrains Mono','Fira Mono',monospace",
};

const BACKEND = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

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
  return <Mono style={{ color: v >= 0 ? C.green : C.red, fontWeight: 600, ...style }}>{v >= 0 ? "+" : ""}€{Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Mono>;
}

function AllocationBar({ pct }) {
  return (
    <div style={{ height: 4, background: C.border, borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: C.gold, borderRadius: 2 }} />
    </div>
  );
}

export default function IBKRAgent() {
  const [tab, setTab] = useState("chat");
  const [messages, setMessages] = useState([{
    role: "assistant",
    content: "Connected to both your IBKR accounts (U11354150 EUR + U9733561 GBP). I can show your combined portfolio, allocation, P&L, and trade history across both. What would you like to know?"
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
  const [portfolioView, setPortfolioView] = useState("combined"); // combined | u1 | u2
  const chatEndRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    loadPortfolio();
    loadTasks();
    loadLog();
    checkStatus();
    checkPush();
  }, []);

  async function checkStatus() {
    try {
      const r = await fetch(`${BACKEND}/api/ibkr/status`);
      const d = await r.json();
      setIbkrOk(d.authenticated);
    } catch { setIbkrOk(false); }
  }

  async function loadPortfolio() {
    setPortLoading(true);
    try {
      const r = await fetch(`${BACKEND}/api/account`);
      setPortfolio(await r.json());
    } catch (e) { console.error(e); }
    setPortLoading(false);
  }

  async function loadTasks() {
    try { setTasks(await (await fetch(`${BACKEND}/api/tasks`)).json()); } catch {}
  }
  async function loadLog() {
    try { setTaskLog(await (await fetch(`${BACKEND}/api/log`)).json()); } catch {}
  }

  async function toggleTask(id, enabled) {
    await fetch(`${BACKEND}/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    loadTasks();
  }

  async function runTaskNow(id) {
    setRunningTask(id);
    await fetch(`${BACKEND}/api/tasks/${id}/run`, { method: "POST" });
    setTimeout(async () => { await loadTasks(); await loadLog(); setRunningTask(null); }, 30000);
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
      if (!publicKey) throw new Error("VAPID key not configured on server");
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
      if (sub) {
        await fetch(`${BACKEND}/api/push/unsubscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setPushStatus("idle");
    } catch {}
  }

  // ── Derived data ──────────────────────────────────────────────────
  const combined = portfolio?.combined;
  const acct1    = portfolio?.accounts?.find(a => a.accountId === "U11354150");
  const acct2    = portfolio?.accounts?.find(a => a.accountId === "U9733561");

  const fmtEUR = v => `€${parseFloat(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtGBP = v => `£${parseFloat(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = v => `${parseFloat(v || 0).toFixed(1)}%`;

  // ── Push banner ───────────────────────────────────────────────────
  const PushBanner = () => {
    if (pushStatus === "unsupported") return null;
    if (pushStatus === "subscribed") return (
      <div style={{ background: C.surfaceHigh, border: `1px solid ${C.green}44`, borderRadius: 12, padding: "11px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.green }}>🔔 Notifications on</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => fetch(`${BACKEND}/api/push/test`, { method: "POST" })} style={{ background: C.goldDim, border: "none", borderRadius: 8, padding: "5px 10px", color: C.goldText, fontSize: 12, cursor: "pointer" }}>Test</button>
          <button onClick={disablePush} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "5px 10px", color: C.textMuted, fontSize: 12, cursor: "pointer" }}>Off</button>
        </div>
      </div>
    );
    if (pushStatus === "denied") return (
      <div style={{ background: C.surfaceHigh, border: `1px solid ${C.red}44`, borderRadius: 12, padding: "11px 14px", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: C.red, fontWeight: 600 }}>🔕 Notifications blocked — enable in Safari settings</div>
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
                  {ibkrOk ? "2 accounts" : ibkrOk === false ? "Offline" : "Connecting"}
                </span>
              </div>
            </div>
          </div>
          {combined && (
            <div style={{ textAlign: "right" }}>
              <Mono style={{ fontSize: 17, fontWeight: 700 }}>{fmtEUR(combined.totalNetLiquidation)}</Mono>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Combined NLV</div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
        {[["chat","💬","Chat"],["portfolio","📊","Portfolio"],["schedule","⏱","Schedule"]].map(([id, icon, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ flex: 1, padding: "10px 0", background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: tab === id ? 700 : 400, color: tab === id ? C.goldText : C.textMuted, borderBottom: tab === id ? `2px solid ${C.gold}` : "2px solid transparent" }}>
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
              {["Combined portfolio", "Allocation breakdown", "P&L summary", "Recent trades", "Best performers"].map(q => (
                <button key={q} onClick={() => setInput(q)} style={{ background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 20, padding: "5px 11px", color: C.textMuted, fontSize: 12, cursor: "pointer" }}>{q}</button>
              ))}
            </div>
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: 14, display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: 8, alignItems: "flex-end" }}>
                {m.role === "assistant" && (
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: C.goldDim, border: `1px solid ${C.gold}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>🤖</div>
                )}
                <div style={{ maxWidth: "82%", padding: "10px 14px", borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: m.role === "user" ? "#1E3A5F" : C.surfaceHigh, border: m.role === "user" ? "none" : `1px solid ${C.border}`, color: C.textPrimary, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {m.loading ? <span style={{ opacity: 0.4 }}>Thinking…</span> : m.content}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div style={{ padding: "12px 14px", borderTop: `1px solid ${C.border}`, background: C.surface, display: "flex", gap: 10, flexShrink: 0 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder="Ask about your portfolio…"
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
              {/* View switcher */}
              <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                {[["combined","Combined"],["u1","U11354150 EUR"],["u2","U9733561 GBP"]].map(([v, label]) => (
                  <button key={v} onClick={() => setPortfolioView(v)}
                    style={{ flex: 1, padding: "7px 4px", background: portfolioView === v ? C.goldDim : C.surfaceHigh, border: `1px solid ${portfolioView === v ? C.gold : C.border}`, borderRadius: 8, color: portfolioView === v ? C.goldText : C.textMuted, fontSize: 11, cursor: "pointer", fontWeight: portfolioView === v ? 700 : 400 }}>
                    {label}
                  </button>
                ))}
              </div>

              {/* ── Combined view ── */}
              {portfolioView === "combined" && combined && (
                <>
                  {/* Summary cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 14 }}>
                    <Card style={{ gridColumn: "1/-1", padding: "14px 16px" }}>
                      <Label>Combined Net Liquidation</Label>
                      <Mono style={{ fontSize: 22, fontWeight: 700, color: C.goldText }}>{fmtEUR(combined.totalNetLiquidation)}</Mono>
                    </Card>
                    {[
                      { label: "Total Cash", val: fmtEUR(combined.totalCash) },
                      { label: "Stock Value", val: fmtEUR(combined.totalStockValue) },
                      { label: "Unrealized P&L", val: combined.totalUnrealizedPnlEUR, isPnl: true },
                      { label: "1Y Gain", val: combined.totalYtdGainEUR, isPnl: true },
                      { label: "1Y Return (TWR)", val: `${combined.avgYtdReturnPct > 0 ? "+" : ""}${combined.avgYtdReturnPct}%`, color: combined.avgYtdReturnPct >= 0 ? C.green : C.red },
                      { label: "Dividends", val: fmtEUR(combined.totalDividends) },
                      { label: "Commissions", val: fmtEUR(combined.totalCommissions) },
                    ].map(s => (
                      <Card key={s.label} style={{ padding: "12px 14px" }}>
                        <Label>{s.label}</Label>
                        {s.isPnl
                          ? <PnlText value={s.val} style={{ fontSize: 15 }} />
                          : <Mono style={{ fontSize: 15, fontWeight: 700, color: s.color || C.textPrimary }}>{s.val}</Mono>}
                      </Card>
                    ))}
                  </div>

                  {/* Combined positions */}
                  <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Positions — combined allocation</div>
                  {combined.positions.map(p => (
                    <Card key={p.symbol}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Mono style={{ fontSize: 15, fontWeight: 700 }}>{p.symbol}</Mono>
                            <span style={{ fontSize: 11, color: C.textMuted }}>{fmtPct(p.allocationPct)}</span>
                          </div>
                          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{p.description}</div>
                          <AllocationBar pct={p.allocationPct} />
                          {p.legs.length > 1 && (
                            <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
                              {p.legs.map(l => `${l.accountId}: ${l.quantity}`).join(" · ")}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                          <Mono style={{ fontSize: 14, fontWeight: 600 }}>{fmtEUR(p.totalValueEUR)}</Mono>
                          {p.totalUnrealEUR !== 0 && <div style={{ marginTop: 3 }}><PnlText value={p.totalUnrealEUR} style={{ fontSize: 12 }} /></div>}
                          {p.totalYtdPnl !== 0 && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>YTD: <PnlText value={p.totalYtdPnl} style={{ fontSize: 11 }} /></div>}
                        </div>
                      </div>
                    </Card>
                  ))}
                </>
              )}

              {/* ── Account 1 view ── */}
              {portfolioView === "u1" && acct1 && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 14 }}>
                    {[
                      { label: "Net Liquidation", val: fmtEUR(acct1.netLiquidation) },
                      { label: "Cash", val: fmtEUR(acct1.cash) },
                      { label: "Stock Value", val: fmtEUR(acct1.stockValue) },
                      { label: "Commissions YTD", val: fmtEUR(acct1.commissions) },
                    ].map(s => (
                      <Card key={s.label} style={{ padding: "12px 14px" }}>
                        <Label>{s.label}</Label>
                        <Mono style={{ fontSize: 15, fontWeight: 700 }}>{s.val}</Mono>
                      </Card>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Positions</div>
                  {acct1.positions.map(p => (
                    <Card key={p.symbol}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <div>
                          <Mono style={{ fontSize: 14, fontWeight: 700 }}>{p.symbol}</Mono>
                          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{p.quantity} × {p.currency} {p.markPrice}</div>
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

              {/* ── Account 2 view ── */}
              {portfolioView === "u2" && acct2 && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 14 }}>
                    {[
                      { label: "Net Liquidation", val: fmtGBP(acct2.netLiquidation) },
                      { label: "In EUR", val: fmtEUR(acct2.netLiquidationEUR) },
                      { label: "Cash", val: fmtGBP(acct2.cash) },
                      { label: "Stock Value", val: fmtGBP(acct2.stockValue) },
                      { label: "Commissions YTD", val: fmtGBP(acct2.commissions) },
                    ].map(s => (
                      <Card key={s.label} style={{ padding: "12px 14px" }}>
                        <Label>{s.label}</Label>
                        <Mono style={{ fontSize: 15, fontWeight: 700 }}>{s.val}</Mono>
                      </Card>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Positions</div>
                  {acct2.positions.map(p => (
                    <Card key={p.symbol}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <div>
                          <Mono style={{ fontSize: 14, fontWeight: 700 }}>{p.symbol}</Mono>
                          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{p.quantity} × {p.currency} {p.markPrice}</div>
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

              <button onClick={loadPortfolio} style={{ width: "100%", marginTop: 8, background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, color: C.textMuted, fontSize: 14, cursor: "pointer" }}>↻ Refresh</button>
            </>
          )}
        </div>
      )}

      {/* ══ SCHEDULE ══════════════════════════════════════════════ */}
      {tab === "schedule" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <PushBanner />
          <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Automated tasks (ET timezone)</div>
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
                    <div style={{ fontSize: 12, color: C.textPrimary, marginTop: 6, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{task.lastResult}</div>
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
              {taskLog.slice(0, 10).map((l, i) => (
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
