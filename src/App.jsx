import { useState, useEffect, useRef, useCallback } from "react";

// ─── Design tokens ────────────────────────────────────────────────
// Palette: deep charcoal base, warm gold accent (IBKR brand reference),
// monospaced data in cream. Signature: thin gold hairline separators
// + monospaced numbers throughout — the Bloomberg terminal aesthetic,
// but clean and mobile-first.
const C = {
  bg:          "#0D0F14",
  surface:     "#13161E",
  surfaceHigh: "#1A1E2A",
  border:      "#252A38",
  gold:        "#C9A84C",
  goldDim:     "#2A2213",
  goldText:    "#E8C87A",
  green:       "#2ECC71",
  red:         "#E74C3C",
  blue:        "#4A9EFF",
  textPrimary: "#EDF0F7",
  textMuted:   "#5A6280",
  textDim:     "#2A3050",
  mono:        "'JetBrains Mono', 'Fira Mono', monospace",
};

const BACKEND = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

// ─── Push helpers ─────────────────────────────────────────────────
function b64ToUint8(b) {
  const pad = "=".repeat((4 - b.length % 4) % 4);
  const raw = atob((b + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

// ─── Shared components ────────────────────────────────────────────
const Pill = ({ color = C.textMuted, children, style = {} }) => (
  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color, textTransform: "uppercase", ...style }}>
    {children}
  </span>
);

const Card = ({ children, style = {} }) => (
  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", marginBottom: 10, ...style }}>
    {children}
  </div>
);

const Mono = ({ children, style = {} }) => (
  <span style={{ fontFamily: C.mono, ...style }}>{children}</span>
);

function PnlBadge({ value }) {
  if (value === undefined || value === null) return null;
  const pos = parseFloat(value) >= 0;
  return (
    <Mono style={{ fontSize: 13, color: pos ? C.green : C.red, fontWeight: 600 }}>
      {pos ? "▲" : "▼"} ${Math.abs(parseFloat(value)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </Mono>
  );
}

// ─── Main App ─────────────────────────────────────────────────────
export default function IBKRAgent() {
  const [tab, setTab] = useState("chat");
  const [messages, setMessages] = useState([{
    role: "assistant",
    content: "Connected to your IBKR account. I can check positions & P&L, get real-time quotes, place and cancel orders, search instruments, and analyse your portfolio. What would you like to do?"
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [ibkrStatus, setIbkrStatus] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [taskLog, setTaskLog] = useState([]);
  const [runningTask, setRunningTask] = useState(null);
  const [pushStatus, setPushStatus] = useState("idle"); // idle | requesting | subscribed | denied | unsupported
  const chatEndRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    loadAccount();
    loadTasks();
    loadLog();
    checkIBKRStatus();
    checkPushStatus();
  }, []);

  // Poll task state every 5s to detect completion
  useEffect(() => {
    const t = setInterval(() => { if (runningTask) { loadTasks(); loadLog(); } }, 5000);
    return () => clearInterval(t);
  }, [runningTask]);

  // ── IBKR status ─────────────────────────────────────────────────
  async function checkIBKRStatus() {
    try {
      const res = await fetch(`${BACKEND}/api/ibkr/status`);
      setIbkrStatus(await res.json());
    } catch (e) { setIbkrStatus({ error: "Unreachable" }); }
  }

  // ── Account data ─────────────────────────────────────────────────
  async function loadAccount() {
    setAccountLoading(true);
    try {
      const res = await fetch(`${BACKEND}/api/account`);
      setAccount(await res.json());
    } catch (e) { console.error(e); }
    setAccountLoading(false);
  }

  // ── Tasks ────────────────────────────────────────────────────────
  async function loadTasks() {
    try { setTasks(await (await fetch(`${BACKEND}/api/tasks`)).json()); } catch (e) {}
  }

  async function loadLog() {
    try { setTaskLog(await (await fetch(`${BACKEND}/api/log`)).json()); } catch (e) {}
  }

  async function toggleTask(id, enabled) {
    await fetch(`${BACKEND}/api/tasks/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    loadTasks();
  }

  async function runTaskNow(id) {
    setRunningTask(id);
    await fetch(`${BACKEND}/api/tasks/${id}/run`, { method: "POST" });
    // Poll until done
    const poll = setInterval(async () => {
      await loadTasks();
      await loadLog();
      const t = tasks.find(t => t.id === id);
      if (t && !t.running) { clearInterval(poll); setRunningTask(null); }
    }, 3000);
    setTimeout(() => { clearInterval(poll); setRunningTask(null); }, 120000); // timeout 2 min
  }

  // ── Chat ─────────────────────────────────────────────────────────
  async function sendMessage() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { role: "user", content: text }, { role: "assistant", content: "", loading: true }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await res.json();
      setMessages(prev => [...prev.slice(0, -1), { role: "assistant", content: data.reply || data.error || "No response" }]);
    } catch (e) {
      setMessages(prev => [...prev.slice(0, -1), { role: "assistant", content: `Error: ${e.message}` }]);
    }
    setLoading(false);
  }

  // ── Push ─────────────────────────────────────────────────────────
  async function checkPushStatus() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setPushStatus("unsupported"); return; }
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) setPushStatus("subscribed");
      else if (Notification.permission === "denied") setPushStatus("denied");
    } catch (e) {}
  }

  async function enablePush() {
    setPushStatus("requesting");
    try {
      const { publicKey } = await (await fetch(`${BACKEND}/api/push/vapid-key`)).json();
      if (!publicKey) throw new Error("VAPID key not set on server — add VAPID_PUBLIC_KEY env var");
      if (await Notification.requestPermission() !== "granted") { setPushStatus("denied"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(publicKey) });
      await fetch(`${BACKEND}/api/push/subscribe`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub),
      });
      setPushStatus("subscribed");
    } catch (e) { setPushStatus("idle"); alert("Push setup failed: " + e.message); }
  }

  async function disablePush() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch(`${BACKEND}/api/push/unsubscribe`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setPushStatus("idle");
    } catch (e) {}
  }

  // ── UI helpers ───────────────────────────────────────────────────
  const fmt$ = v => v != null ? `$${parseFloat(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
  const plColor = v => parseFloat(v) >= 0 ? C.green : C.red;

  // ── IBKR status indicator ────────────────────────────────────────
  const connected = ibkrStatus?.authenticated === true;

  const PushBanner = () => {
    if (pushStatus === "unsupported" || pushStatus === "subscribed") return null;
    if (pushStatus === "denied") return (
      <div style={{ background: C.surfaceHigh, border: `1px solid ${C.red}44`, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.red }}>🔕 Notifications blocked</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>Safari Settings → this site → allow notifications to re-enable</div>
      </div>
    );
    return (
      <button onClick={enablePush} disabled={pushStatus === "requesting"}
        style={{ width: "100%", background: C.goldDim, border: `1px solid ${C.gold}55`, borderRadius: 12, padding: "13px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", textAlign: "left" }}>
        <span style={{ fontSize: 20 }}>🔔</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.goldText }}>
            {pushStatus === "requesting" ? "Setting up…" : "Enable push notifications"}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Alerts for tasks, orders, and P&L — even when app is closed</div>
        </div>
      </button>
    );
  };

  // ─────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif", color: C.textPrimary, maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", height: "100dvh" }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ padding: "14px 18px 12px", borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: C.goldDim, border: `1px solid ${C.gold}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📊</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.goldText, letterSpacing: "0.04em" }}>IBKR Agent</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? C.green : C.red }} />
                <Pill color={connected ? C.green : C.red}>{connected ? "Connected" : "Offline"}</Pill>
              </div>
            </div>
          </div>
          {account && (
            <div style={{ textAlign: "right" }}>
              <Mono style={{ fontSize: 17, fontWeight: 700, color: C.textPrimary }}>{fmt$(account.netliquidation)}</Mono>
              <div style={{ marginTop: 2 }}><PnlBadge value={account.unrealizedpnl} /></div>
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
        {[["chat","💬","Chat"], ["portfolio","📊","Portfolio"], ["schedule","⏱","Schedule"]].map(([id, icon, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ flex: 1, padding: "10px 0", background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: tab === id ? 700 : 400, color: tab === id ? C.goldText : C.textMuted, borderBottom: tab === id ? `2px solid ${C.gold}` : "2px solid transparent" }}>
            {icon} {label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          CHAT TAB
      ══════════════════════════════════════════════════════════ */}
      {tab === "chat" && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>

            {!connected && (
              <div style={{ background: C.surfaceHigh, border: `1px solid ${C.red}44`, borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.red }}>⚠️ IBKR Gateway offline</div>
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>Make sure the Client Portal Gateway is running and you're authenticated. <button onClick={checkIBKRStatus} style={{ background: "none", border: "none", color: C.gold, cursor: "pointer", fontSize: 12, padding: 0 }}>Retry</button></div>
              </div>
            )}

            <PushBanner />

            {/* Quick actions */}
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 16 }}>
              {[
                "Account summary",
                "Today's P&L",
                "Open orders",
                "Recent trades",
                "Portfolio allocation",
              ].map(q => (
                <button key={q} onClick={() => setInput(q)}
                  style={{ background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 20, padding: "5px 11px", color: C.textMuted, fontSize: 12, cursor: "pointer" }}>
                  {q}
                </button>
              ))}
            </div>

            {/* Messages */}
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: 14, display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: 8, alignItems: "flex-end" }}>
                {m.role === "assistant" && (
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: C.goldDim, border: `1px solid ${C.gold}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0, marginBottom: 2 }}>🤖</div>
                )}
                <div style={{
                  maxWidth: "82%", padding: "10px 14px",
                  borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  background: m.role === "user" ? "#1E3A5F" : C.surfaceHigh,
                  border: m.role === "user" ? "none" : `1px solid ${C.border}`,
                  color: C.textPrimary, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap",
                  fontFamily: m.loading ? "inherit" : "inherit",
                }}>
                  {m.loading
                    ? <span style={{ display: "flex", gap: 4 }}>{[0,1,2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: C.gold, opacity: 0.6, animation: `pulse 1.2s ${i * 0.2}s infinite` }} />)}</span>
                    : m.content}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input bar */}
          <div style={{ padding: "12px 14px", borderTop: `1px solid ${C.border}`, background: C.surface, display: "flex", gap: 10, flexShrink: 0 }}>
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder="Ask about positions, orders, prices…"
              style={{ flex: 1, background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", color: C.textPrimary, fontSize: 14, outline: "none", fontFamily: "inherit" }} />
            <button onClick={sendMessage} disabled={loading}
              style={{ background: loading ? C.goldDim : C.gold, border: "none", borderRadius: 12, width: 44, cursor: loading ? "default" : "pointer", color: "#0D0F14", fontSize: 20, fontWeight: 900, transition: "background 0.15s" }}>↑</button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          PORTFOLIO TAB
      ══════════════════════════════════════════════════════════ */}
      {tab === "portfolio" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {accountLoading && <div style={{ color: C.textMuted, textAlign: "center", padding: 48, fontSize: 14 }}>Loading account…</div>}

          {account && !accountLoading && (
            <>
              {/* Summary cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 16 }}>
                {[
                  { label: "Net Liquidation", val: fmt$(account.netliquidation) },
                  { label: "Cash", val: fmt$(account.totalcashvalue) },
                  { label: "Unrealized P&L", val: account.unrealizedpnl, isPnl: true },
                  { label: "Realized P&L", val: account.realizedpnl, isPnl: true },
                ].map(s => (
                  <Card key={s.label} style={{ padding: "12px 14px" }}>
                    <Pill color={C.textMuted}>{s.label}</Pill>
                    <div style={{ marginTop: 6 }}>
                      {s.isPnl
                        ? <PnlBadge value={s.val} />
                        : <Mono style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary }}>{s.val}</Mono>}
                    </div>
                  </Card>
                ))}
              </div>

              {/* Positions */}
              {account.positions?.length > 0 && (
                <>
                  <Pill color={C.textMuted} style={{ display: "block", marginBottom: 8 }}>Positions ({account.positions.length})</Pill>
                  {account.positions.map((p, i) => (
                    <Card key={i}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <Mono style={{ fontSize: 15, fontWeight: 700 }}>{p.symbol}</Mono>
                          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                            {p.position} shares · avg {fmt$(p.avgCost)}
                          </div>
                          <div style={{ fontSize: 11, color: C.textDim, marginTop: 1 }}>{p.assetClass}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <Mono style={{ fontSize: 14, fontWeight: 600 }}>{fmt$(p.mktValue)}</Mono>
                          <div style={{ marginTop: 3 }}><PnlBadge value={p.unrealizedPnl} /></div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </>
              )}

              {account.positions?.length === 0 && (
                <div style={{ textAlign: "center", color: C.textMuted, padding: "32px 0", fontSize: 14 }}>No open positions</div>
              )}

              <button onClick={loadAccount}
                style={{ width: "100%", marginTop: 6, background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, color: C.textMuted, fontSize: 14, cursor: "pointer" }}>
                ↻ Refresh
              </button>
            </>
          )}

          {account?.error && (
            <div style={{ color: C.red, fontSize: 14, textAlign: "center", padding: 24 }}>
              {account.error}<br /><span style={{ fontSize: 12, color: C.textMuted }}>Is the IBKR Gateway running?</span>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          SCHEDULE TAB
      ══════════════════════════════════════════════════════════ */}
      {tab === "schedule" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>

          {/* Push banner */}
          {pushStatus === "subscribed" ? (
            <div style={{ background: C.surfaceHigh, border: `1px solid ${C.green}44`, borderRadius: 12, padding: "12px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.green }}>🔔 Notifications active</div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>You'll be alerted when each task runs</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => fetch(`${BACKEND}/api/push/test`, { method: "POST" })}
                  style={{ background: C.goldDim, border: "none", borderRadius: 8, padding: "6px 10px", color: C.goldText, fontSize: 12, cursor: "pointer" }}>Test</button>
                <button onClick={disablePush}
                  style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px", color: C.textMuted, fontSize: 12, cursor: "pointer" }}>Off</button>
              </div>
            </div>
          ) : <PushBanner />}

          {/* Task cards */}
          <Pill color={C.textMuted} style={{ display: "block", marginBottom: 10 }}>Automated tasks (ET timezone)</Pill>
          {tasks.map(task => (
            <Card key={task.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <span style={{ fontSize: 16 }}>{task.icon}</span>
                    <span style={{ fontWeight: 600, fontSize: 14, color: C.textPrimary }}>{task.label}</span>
                  </div>
                  <Mono style={{ fontSize: 11, color: C.textMuted }}>{task.cron}</Mono>
                  {task.running && <div style={{ fontSize: 11, color: C.gold, marginTop: 4 }}>⏳ Running…</div>}
                  {task.lastRun && !task.running && (
                    <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
                      Last: {new Date(task.lastRun).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, marginLeft: 10 }}>
                  <button onClick={() => runTaskNow(task.id)} disabled={!!runningTask || task.running}
                    style={{ background: C.goldDim, border: `1px solid ${C.gold}44`, borderRadius: 8, padding: "6px 10px", color: C.goldText, fontSize: 12, cursor: "pointer", fontWeight: 600, opacity: (runningTask || task.running) ? 0.5 : 1 }}>
                    {task.running ? "…" : "Run"}
                  </button>
                  {/* Toggle */}
                  <div onClick={() => toggleTask(task.id, !task.enabled)}
                    style={{ width: 40, height: 22, borderRadius: 11, background: task.enabled ? C.gold : C.border, cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                    <div style={{ position: "absolute", top: 3, left: task.enabled ? 20 : 3, width: 16, height: 16, borderRadius: "50%", background: task.enabled ? "#0D0F14" : C.textMuted, transition: "left 0.2s" }} />
                  </div>
                </div>
              </div>
            </Card>
          ))}

          {/* Last result preview */}
          {tasks.filter(t => t.lastResult).map(task => (
            <div key={task.id + "_result"} style={{ background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 8 }}>
              <Pill color={C.textMuted}>{task.icon} Last result — {task.label}</Pill>
              <div style={{ fontSize: 12, color: C.textPrimary, marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                {task.lastResult.slice(0, 300)}{task.lastResult.length > 300 ? "…" : ""}
              </div>
            </div>
          ))}

          {/* Run log */}
          {taskLog.length > 0 && (
            <>
              <Pill color={C.textMuted} style={{ display: "block", margin: "14px 0 8px" }}>Run log</Pill>
              {taskLog.slice(0, 10).map((l, i) => (
                <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{l.task}</span>
                    <Mono style={{ fontSize: 11, color: C.textMuted, display: "block", marginTop: 2 }}>{new Date(l.time).toLocaleTimeString()}</Mono>
                  </div>
                  <Pill color={l.status === "done" ? C.green : l.status === "error" ? C.red : C.gold}>{l.status}</Pill>
                </div>
              ))}
            </>
          )}

          <button onClick={() => { loadTasks(); loadLog(); }}
            style={{ width: "100%", marginTop: 8, background: C.surfaceHigh, border: `1px solid ${C.border}`, borderRadius: 10, padding: 11, color: C.textMuted, fontSize: 14, cursor: "pointer" }}>
            ↻ Refresh
          </button>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,80%,100%{transform:scale(0.8);opacity:0.4} 40%{transform:scale(1);opacity:1} }
        input::placeholder { color: #3A4060; }
        * { -webkit-tap-highlight-color: transparent; }
        ::-webkit-scrollbar { width: 3px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #252A38; border-radius: 2px; }
      `}</style>
    </div>
  );
}
