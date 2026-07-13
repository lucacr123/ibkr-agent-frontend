import { useState, useEffect, useRef, cloneElement } from "react";

const C = {
  bg:"#0D0F14",surface:"#13161E",surfaceHigh:"#1A1E2A",
  border:"#252A38",gold:"#C9A84C",goldDim:"#2A2213",goldText:"#E8C87A",
  green:"#2ECC71",red:"#E74C3C",blue:"#4A9EFF",amber:"#F59E0B",
  textPrimary:"#EDF0F7",textMuted:"#5A6280",textDim:"#2A3050",
  mono:"'JetBrains Mono','Fira Mono',monospace",
};
const BACKEND = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
const YF = { CSPX:"CSPX.L",CSNDX:"CNDX.L",CSSX5E:"CSSX5E.SW",IEEM:"IEEM.L",IUSE:"IUSE.L",NQSE:"NQSE.DE",SPCX:"SPCX.L",VUAG:"VUAG.L",VWRL:"VWRL.L",VFEM:"VFEM.L" };

function b64ToUint8(b){const pad="=".repeat((4-b.length%4)%4);const raw=atob((b+pad).replace(/-/g,"+").replace(/_/g,"/"));return new Uint8Array([...raw].map(c=>c.charCodeAt(0)));}
const Mono=({children,style={}})=><span style={{fontFamily:C.mono,...style}}>{children}</span>;
const Card=({children,style={}})=><div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 16px",marginBottom:10,...style}}>{children}</div>;
function PnlText({value,style={}}){const v=parseFloat(value||0);if(v===0)return<Mono style={{color:C.textMuted,...style}}>—</Mono>;return<Mono style={{color:v>=0?C.green:C.red,fontWeight:600,...style}}>{v>=0?"+":""}€{Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</Mono>;}
function AllocationBar({pct}){return<div style={{height:4,background:C.border,borderRadius:2,marginTop:6,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(pct,100)}%`,background:C.gold,borderRadius:2}}/></div>;}
function ExpandableChart({title="Chart",children,inlineHeight=120}){
  const [open,setOpen]=useState(false);
  // Clone child and pass isExpanded prop so the chart can adjust its rendering
  const expandedChild = open ? cloneElement(children, { isExpanded: true }) : null;
  return <>
    <div onClick={()=>setOpen(true)} title="Click to expand" style={{cursor:"zoom-in",overflow:"hidden",width:"100%",minWidth:0,height:inlineHeight,display:"block"}}>{children}</div>
    {open&&<div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.82)",display:"flex",alignItems:"center",justifyContent:"center",padding:18}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"min(980px,96vw)",maxHeight:"90vh",background:C.surface,border:`1px solid ${C.border}`,borderRadius:18,padding:16,boxShadow:"0 24px 80px rgba(0,0,0,0.45)",cursor:"default",display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexShrink:0}}><div style={{fontWeight:700,color:C.goldText}}>{title}</div><button onClick={()=>setOpen(false)} style={{background:C.surfaceHigh,border:`1px solid ${C.border}`,color:C.textMuted,borderRadius:8,padding:"6px 10px",cursor:"pointer"}}>Close</button></div>
        <div style={{flex:1,minHeight:400,overflow:"hidden",display:"flex"}}>{expandedChild}</div>
      </div>
    </div>}
  </>;
}


// ── Y-axis helpers ────────────────────────────────────────────────
function niceStep(r,t=5){const raw=r/t;const mag=Math.pow(10,Math.floor(Math.log10(raw)));for(const n of[1,2,2.5,5,10])if(n*mag>=raw)return n*mag;return mag*10;}
function yTicks(min,max){const step=niceStep(max-min||1,4);const start=Math.floor(min/step)*step;const r=[];for(let v=start;v<=max+step*0.1;v+=step)r.push(+v.toFixed(10));return r;}
function fmtTick(v){const a=Math.abs(v);if(a>=1000)return(v/1000).toFixed(1)+"k";if(a>=1)return v%1===0?v.toFixed(0):v.toFixed(2);return v.toFixed(3);}

// ── Core chart (price line) ──────────────────────────────────────

// ── Mean-Variance Optimisation ────────────────────────────────────
function MVOPanel({ mvo }) {
  const [view, setView] = useState("assets"); // assets | weights | frontier
  if (!mvo) return null;
  const { currentPortfolio:cur, maxSharpePortfolio:ms, minVolPortfolio:mv,
          assetStats=[], scatterPoints=[], frontier=[] } = mvo;

  const msMap  = Object.fromEntries(ms.weights.map(w=>[w.symbol,w.weightPct]));
  const mvMap  = Object.fromEntries(mv.weights.map(w=>[w.symbol,w.weightPct]));
  const curMap = Object.fromEntries(cur.weights.map(w=>[w.symbol,w.weightPct]));

  // Chart bounds from scatter + frontier + key points
  const allPts = [...scatterPoints, ...frontier,
    {vol:cur.annVolPct,ret:cur.annRetPct},
    {vol:ms.annVolPct, ret:ms.annRetPct},
    {vol:mv.annVolPct, ret:mv.annRetPct}];
  const minV=Math.min(...allPts.map(p=>p.vol));
  const maxV=Math.max(...allPts.map(p=>p.vol));
  const minR=Math.min(...allPts.map(p=>p.ret));
  const maxR=Math.max(...allPts.map(p=>p.ret));
  const padV=(maxV-minV)*0.02, padR=(maxR-minR)*0.02;
  const vMin=minV-padV, vMax=maxV+padV, rMin=minR-padR, rMax=maxR+padR;

  const W=500, H=260, PL=48, PR=14, PT=14, PB=32;
  const pw=W-PL-PR, ph=H-PT-PB;
  const toX=v=>PL+(v-vMin)/(vMax-vMin||1)*pw;
  const toY=r=>PT+(1-(r-rMin)/(rMax-rMin||1))*ph;

  // Frontier polyline
  const fPts = frontier.map(p=>`${toX(p.vol).toFixed(1)},${toY(p.ret).toFixed(1)}`).join(" ");

  const th = {padding:"4px 8px",color:C.textMuted,fontWeight:600,fontSize:11,borderBottom:`1px solid ${C.border}`,textAlign:"right"};
  const td = (col,left) => ({padding:"4px 8px",color:col||C.textPrimary,fontSize:11,fontFamily:"monospace",textAlign:left?"left":"right",borderBottom:`1px solid ${C.border}22`});

  return (
    <Card style={{marginBottom:12}}>
      <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>Mean-Variance Optimisation</div>
      <div style={{fontSize:10,color:C.textDim,marginBottom:8}}>{mvo.method}</div>

      {/* Summary stats */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10}}>
        {[["Current Portfolio",cur,C.blue],["Max Sharpe",ms,C.green],["Min Volatility",mv,C.amber]].map(([label,p,col])=>(
          <div key={label} style={{background:C.surface,borderRadius:8,padding:"8px 10px",borderLeft:`3px solid ${col}`}}>
            <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",marginBottom:4}}>{label}</div>
            <div style={{fontSize:11,fontFamily:"monospace"}}>
              <div>Ret: <span style={{color:p.annRetPct>=0?C.green:C.red,fontWeight:700}}>{p.annRetPct}%</span></div>
              <div>Vol: <span style={{color:C.textPrimary}}>{p.annVolPct}%</span></div>
              <div>Sharpe: <span style={{color:p.sharpe>=1?C.green:p.sharpe>=0.5?C.amber:C.red,fontWeight:700}}>{p.sharpe}</span></div>
            </div>
          </div>
        ))}
      </div>

      {/* Tab toggle */}
      <div style={{display:"flex",gap:6,marginBottom:10}}>
        {[["assets","Per-Asset Stats"],["weights","Weights"],["frontier","Frontier"]].map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)}
            style={{background:view===v?C.goldDim:"transparent",border:`1px solid ${view===v?C.gold:C.border}`,borderRadius:8,padding:"4px 10px",color:view===v?C.gold:C.textMuted,fontSize:11,cursor:"pointer"}}>
            {l}
          </button>
        ))}
      </div>

      {/* Per-asset stats */}
      {view==="assets" && assetStats.length>0 && (
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>
              {["Asset","1Y Return","Ann. Vol","Sharpe"].map(h=>(
                <th key={h} style={{...th,textAlign:h==="Asset"?"left":"right"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {assetStats.map(a=>(
                <tr key={a.symbol}>
                  <td style={td(C.textPrimary,true)}><strong>{a.symbol}</strong></td>
                  <td style={td(a.annRetPct>=0?C.green:C.red)}>{a.annRetPct}%</td>
                  <td style={td(C.textPrimary)}>{a.annVolPct}%</td>
                  <td style={td(a.sharpe>=1?C.green:a.sharpe>=0.5?C.amber:C.red)}>{a.sharpe}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Weight comparison */}
      {view==="weights" && (
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>
              {["Asset","Current","Max Sharpe","Min Vol","Δ→MaxSharpe"].map(h=>(
                <th key={h} style={{...th,textAlign:h==="Asset"?"left":"right"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {cur.weights.map(({symbol:sym})=>{
                const c=curMap[sym]||0, s=msMap[sym]||0, v=mvMap[sym]||0, d=+(s-c).toFixed(1);
                return (
                  <tr key={sym}>
                    <td style={td(C.textPrimary,true)}><strong>{sym}</strong></td>
                    <td style={td(C.blue)}>{c.toFixed(1)}%</td>
                    <td style={td(C.green)}>{s.toFixed(1)}%</td>
                    <td style={td(C.amber)}>{v.toFixed(1)}%</td>
                    <td style={td(d>0?C.green:d<0?C.red:C.textDim)}>{d>0?"+":""}{d}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Efficient frontier */}
      {view==="frontier" && (
        <ExpandableChart title="Efficient Frontier" inlineHeight={220}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:H,display:"block"}} preserveAspectRatio="xMidYMid meet">
            {/* Gridlines */}
            {[0,0.25,0.5,0.75,1].map((t,i)=>{
              const y=PT+t*ph, r=rMax-t*(rMax-rMin);
              const x=PL+t*pw, v=vMin+t*(vMax-vMin);
              return <g key={i}>
                <line x1={PL} y1={y} x2={W-PR} y2={y} stroke={C.border} strokeWidth="0.4" strokeDasharray="2,4" opacity="0.5"/>
                <text x={PL-4} y={y+3} fontSize="9" fill={C.textMuted} textAnchor="end">{r.toFixed(1)}%</text>
                <line x1={x} y1={PT} x2={x} y2={PT+ph} stroke={C.border} strokeWidth="0.4" strokeDasharray="2,4" opacity="0.5"/>
                <text x={x} y={H-6} fontSize="9" fill={C.textMuted} textAnchor="middle">{v.toFixed(1)}%</text>
              </g>;
            })}
            {/* Scatter points */}
            {scatterPoints.map((p,i)=>(
              <circle key={i} cx={toX(p.vol)} cy={toY(p.ret)} r="1.2"
                fill={p.sharpe>ms.sharpe*0.85?C.green:C.blue} opacity="0.25"/>
            ))}
            {/* Efficient frontier LINE */}
            {fPts && <polyline points={fPts} fill="none" stroke={C.green} strokeWidth="2" opacity="0.8"/>}
            {/* Current */}
            <circle cx={toX(cur.annVolPct)} cy={toY(cur.annRetPct)} r="6" fill={C.blue} stroke="#fff" strokeWidth="1.5"/>
            <text x={toX(cur.annVolPct)+9} y={toY(cur.annRetPct)+4} fontSize="10" fill={C.blue} fontWeight="bold">Current</text>
            {/* Max Sharpe */}
            <circle cx={toX(ms.annVolPct)} cy={toY(ms.annRetPct)} r="6" fill={C.green} stroke="#fff" strokeWidth="1.5"/>
            <text x={toX(ms.annVolPct)+9} y={toY(ms.annRetPct)+4} fontSize="10" fill={C.green} fontWeight="bold">Max Sharpe</text>
            {/* Min Vol */}
            <circle cx={toX(mv.annVolPct)} cy={toY(mv.annRetPct)} r="6" fill={C.amber} stroke="#fff" strokeWidth="1.5"/>
            <text x={toX(mv.annVolPct)+9} y={toY(mv.annRetPct)+4} fontSize="10" fill={C.amber} fontWeight="bold">Min Vol</text>
            {/* Axis labels */}
            <text x={PL+pw/2} y={H-1} fontSize="10" fill={C.textDim} textAnchor="middle">Annualised Volatility %</text>
          </svg>
        </ExpandableChart>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CHART PRIMITIVES — single source of truth for all charts in the app
// Auto-scaling Y axis, proper X date axis, no clamping
// ═══════════════════════════════════════════════════════════════════

function niceTicks(min, max, n=5) {
  if (min === max) { return [min - 1, min, min + 1]; }
  const range = max - min;
  const rough = range / n;
  const mag   = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm  = rough / mag;
  const step  = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  const s     = step * mag;
  // Start from first tick AT OR ABOVE min, end at last tick AT OR BELOW max
  const first = Math.ceil(min / s) * s;
  const ticks = [];
  for (let v = first; v <= max + s * 0.001; v += s)
    ticks.push(+v.toFixed(10));
  // Always include min and max so axis fits data exactly
  if (ticks[0] > min) ticks.unshift(+min.toFixed(4));
  if (ticks[ticks.length-1] < max) ticks.push(+max.toFixed(4));
  return ticks;
}

function xDateTicks(dates, n=6) {
  if (!dates?.length) return [];
  const out  = [];
  const step = Math.max(1, Math.floor(dates.length / n));
  for (let i = 0; i < dates.length; i += step)
    out.push({ i, label: (dates[i]||"").slice(0,7) });
  const last = dates.length - 1;
  if (!out.find(t => t.i === last))
    out.push({ i: last, label: (dates[last]||"").slice(0,7) });
  return out;
}

// Core line chart — used everywhere
function LineChart({ values, dates, color, id="lc", showZero=false, yFmt, height=160 }) {
  if (!values?.length) return null;
  const vals = values.filter(v => v !== null && !isNaN(v));
  if (!vals.length) return null;

  const vMin0 = Math.min(...vals), vMax0 = Math.max(...vals);
  const ticks = niceTicks(vMin0, vMax0);
  const vMin  = ticks[0], vMax = ticks[ticks.length-1], vRange = vMax - vMin || 1;

  const W = 320, H = height, PL = 46, PR = 8, PT = 8, PB = 28;
  const plotW = W-PL-PR, plotH = H-PT-PB;
  const toX = i => PL + (i / Math.max(values.length-1,1)) * plotW;
  const toY = v => PT + (1 - (v-vMin)/vRange) * plotH;

  const clipId = `cl_${id}`, gradId = `gr_${id}`;
  const fmt    = yFmt || (v => Math.abs(v)>=1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(2));
  const zeroY  = (showZero && vMin < 0 && vMax > 0) ? toY(0) : null;

  // Build line segments (skip nulls)
  const segments = [];
  let seg = [];
  values.forEach((v,i) => {
    if (v===null||isNaN(v)) { if (seg.length){segments.push(seg);seg=[];} }
    else seg.push(`${toX(i).toFixed(1)},${toY(v).toFixed(1)}`);
  });
  if (seg.length) segments.push(seg);

  const xTicks = xDateTicks(dates);
  const col    = color || C.blue;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height,display:"block"}} preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id={clipId}><rect x={PL} y={PT} width={plotW} height={plotH}/></clipPath>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.22"/>
          <stop offset="100%" stopColor={col} stopOpacity="0"/>
        </linearGradient>
      </defs>

      {/* Y gridlines + labels */}
      {ticks.map((t,i) => {
        const y = toY(t);
        if (y < PT-4 || y > PT+plotH+4) return null;
        return <g key={i}>
          <line x1={PL} y1={y} x2={PL+plotW} y2={y} stroke={C.border} strokeWidth="0.5" strokeDasharray={t===0?"":"2,4"} opacity="0.6"/>
          <text x={PL-4} y={y+3.5} textAnchor="end" fontSize="9" fill={C.textMuted} fontFamily={C.mono}>{fmt(t)}</text>
        </g>;
      })}

      {zeroY!==null && <line x1={PL} y1={zeroY} x2={PL+plotW} y2={zeroY} stroke={C.textDim} strokeWidth="1.2"/>}
      <line x1={PL} y1={PT} x2={PL} y2={PT+plotH} stroke={C.border} strokeWidth="1"/>
      <line x1={PL} y1={PT+plotH} x2={PL+plotW} y2={PT+plotH} stroke={C.border} strokeWidth="1"/>

      {/* Line + fill, clipped */}
      <g clipPath={`url(#${clipId})`}>
        {segments.map((s,i) => {
          const x0=s[0].split(",")[0], xN=s[s.length-1].split(",")[0];
          return <g key={i}>
            <polygon points={`${x0},${PT+plotH} ${s.join(" ")} ${xN},${PT+plotH}`} fill={`url(#${gradId})`}/>
            <polyline points={s.join(" ")} fill="none" stroke={col} strokeWidth="1.8"/>
          </g>;
        })}
      </g>

      {/* X date axis */}
      {xTicks.map((t,i) => (
        <g key={i}>
          <line x1={toX(t.i)} y1={PT+plotH} x2={toX(t.i)} y2={PT+plotH+3} stroke={C.border} strokeWidth="1"/>
          <text x={toX(t.i)} y={H-4} textAnchor="middle" fontSize="9" fill={C.textMuted} fontFamily={C.mono}>{t.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ── Price chart ───────────────────────────────────────────────────
function PriceChart({bars, height=160, id="pc"}) {
  if (!bars?.length) return null;
  const closes = bars.map(b => { const v = parseFloat(b.close); return isNaN(v) ? null : v; });
  const dates  = bars.map(b => b.date);
  const valid  = closes.filter(v => v !== null);
  if (!valid.length) return null;
  const col = valid[valid.length-1] >= valid[0] ? C.green : C.red;
  return (
    <ExpandableChart title="Price chart" inlineHeight={height}>
      <LineChart values={closes} dates={dates} color={col} id={id} height={height} yFmt={v=>v>=1000?`${(v/1000).toFixed(1)}k`:v.toFixed(2)}/>
    </ExpandableChart>
  );
}

// ── Candlestick chart ─────────────────────────────────────────────
function CandleChart({bars, height=200, id="cc"}) {
  if (!bars?.length) return null;
  const recent = bars.slice(-80);
  const highs  = recent.map(b => parseFloat(b.high)).filter(v=>!isNaN(v));
  const lows   = recent.map(b => parseFloat(b.low)).filter(v=>!isNaN(v));
  if (!highs.length) return null;

  const pad    = (Math.max(...highs) - Math.min(...lows)) * 0.04;
  const ticks  = niceTicks(Math.min(...lows)-pad, Math.max(...highs)+pad);
  const vMin   = ticks[0], vMax = ticks[ticks.length-1], vRange = vMax-vMin||1;
  const W=320,H=height,PL=46,PR=8,PT=8,PB=28;
  const plotW=W-PL-PR, plotH=H-PT-PB;
  const toY = v => PT + (1-(v-vMin)/vRange)*plotH;
  const toX = i => PL + (i/Math.max(recent.length-1,1))*plotW;
  const cw  = Math.max(2, plotW/recent.length - 1);
  const xTicks = xDateTicks(recent.map(b=>b.date));

  return (
    <ExpandableChart title="Candlestick chart" inlineHeight={height}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height,display:"block"}} preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id={`cc_${id}`}><rect x={PL} y={PT} width={plotW} height={plotH}/></clipPath></defs>
        {ticks.map((t,i)=>{const y=toY(t);return(
          <g key={i}>
            <line x1={PL} y1={y} x2={PL+plotW} y2={y} stroke={C.border} strokeWidth="0.5" strokeDasharray="2,4" opacity="0.6"/>
            <text x={PL-4} y={y+3.5} textAnchor="end" fontSize="9" fill={C.textMuted} fontFamily={C.mono}>{t>=1000?`${(t/1000).toFixed(1)}k`:t.toFixed(0)}</text>
          </g>
        );})}
        <line x1={PL} y1={PT} x2={PL} y2={PT+plotH} stroke={C.border} strokeWidth="1"/>
        <line x1={PL} y1={PT+plotH} x2={PL+plotW} y2={PT+plotH} stroke={C.border} strokeWidth="1"/>
        <g clipPath={`url(#cc_${id})`}>
          {recent.map((b,i)=>{
            const o=parseFloat(b.open),c=parseFloat(b.close),h=parseFloat(b.high),l=parseFloat(b.low);
            if(isNaN(o)||isNaN(c))return null;
            const col=c>=o?C.green:C.red, cx=toX(i)+cw/2;
            return <g key={i}>
              <line x1={cx} y1={toY(h)} x2={cx} y2={toY(l)} stroke={col} strokeWidth="1"/>
              <rect x={toX(i)} y={Math.min(toY(o),toY(c))} width={cw} height={Math.max(1,Math.abs(toY(c)-toY(o)))} fill={col} opacity="0.9"/>
            </g>;
          })}
        </g>
        {xTicks.map((t,i)=>(
          <g key={i}>
            <line x1={toX(t.i)} y1={PT+plotH} x2={toX(t.i)} y2={PT+plotH+3} stroke={C.border} strokeWidth="1"/>
            <text x={toX(t.i)} y={H-4} textAnchor="middle" fontSize="9" fill={C.textMuted} fontFamily={C.mono}>{t.label}</text>
          </g>
        ))}
      </svg>
    </ExpandableChart>
  );
}

// ── Quant series panel ────────────────────────────────────────────
function QuantPanel({label, series, dates, color, showZero=false, id="qp"}) {
  if (!series?.length) return null;
  const vals = series.filter(v => v!==null&&!isNaN(v));
  if (!vals.length) return null;
  const last = vals[vals.length-1];
  const col  = color || (last>=0 ? C.green : C.red);
  return (
    <ExpandableChart title={label} inlineHeight={130}>
      <div style={{marginTop:10,background:C.surfaceHigh,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 12px 4px",overflow:"hidden"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontSize:11,color:C.textMuted,fontWeight:600}}>{label}</span>
          <Mono style={{fontSize:13,fontWeight:700,color:col}}>{last.toFixed(3)}</Mono>
        </div>
        <LineChart values={series} dates={dates} color={col} id={id} height={90} showZero={showZero} yFmt={v=>v.toFixed(2)}/>
      </div>
    </ExpandableChart>
  );
}

// ── Return distribution histogram ─────────────────────────────────
function DistributionPanel({label, distribution, id="dist"}) {
  if (!distribution?.length) return null;
  const max = Math.max(...distribution.map(b=>b.count||0),1);
  const W=320,H=120,PL=36,PR=8,PT=8,PB=28;
  const plotW=W-PL-PR, plotH=H-PT-PB;
  const bw = plotW/distribution.length;
  return (
    <ExpandableChart title={label} inlineHeight={140}>
      <div style={{marginTop:10,background:C.surfaceHigh,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 12px 4px"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
          <span style={{fontSize:11,color:C.textMuted,fontWeight:600}}>{label}</span>
          <Mono style={{fontSize:13,fontWeight:700,color:C.goldText}}>{distribution.reduce((s,b)=>s+(b.count||0),0)} obs</Mono>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:H,display:"block"}} preserveAspectRatio="xMidYMid meet">
          {[0,0.25,0.5,0.75,1].map((p,i)=>{const y=PT+plotH-p*plotH; return(
            <g key={i}>
              <line x1={PL} y1={y} x2={PL+plotW} y2={y} stroke={C.border} strokeWidth="0.5" strokeDasharray="2,4" opacity="0.5"/>
              <text x={PL-3} y={y+3} textAnchor="end" fontSize="8" fill={C.textMuted} fontFamily={C.mono}>{Math.round(max*p)}</text>
            </g>
          );})}
          <line x1={PL} y1={PT} x2={PL} y2={PT+plotH} stroke={C.border} strokeWidth="1"/>
          <line x1={PL} y1={PT+plotH} x2={PL+plotW} y2={PT+plotH} stroke={C.border} strokeWidth="1"/>
          {distribution.map((b,i)=>{
            const h=((b.count||0)/max)*plotH;
            return <rect key={i} x={PL+i*bw+1} y={PT+plotH-h} width={Math.max(1,bw-2)} height={h} fill={C.gold} opacity="0.85" rx="1"/>;
          })}
          {[0,Math.floor(distribution.length/2),distribution.length-1].map(i=>(
            <text key={i} x={PL+i*bw+bw/2} y={H-4} textAnchor="middle" fontSize="8" fill={C.textMuted} fontFamily={C.mono}>
              {distribution[i]?.binStart?.toFixed(1)}%
            </text>
          ))}
        </svg>
      </div>
    </ExpandableChart>
  );
}



// ── Inline quant chart from @@QUANT tags ──────────────────────────
function InlineQuant({symbol,metric,range="1y",label}){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let cancelled=false;
    async function go(){
      setLoading(true);setData(null);
      try{
        let r=await fetch(`${BACKEND}/api/analytics/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}`);
        let d=await r.json();
        if(!r.ok||d.error){
          r=await fetch(`${BACKEND}/api/analytics/compute`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol,range,rolling_window:30})});
          d=await r.json();
        }
        if(!cancelled)setData(d);
      }catch(e){ if(!cancelled)setData({error:e.message}); }
      if(!cancelled)setLoading(false);
    }
    go();
    return()=>{cancelled=true;};
  },[symbol,metric,range]);
  if(loading)return<div style={{padding:"12px 0",color:C.textMuted,fontSize:12}}>Loading {label||metric}…</div>;
  if(!data||data.error){if(symbol==="PORTFOLIO"||symbol==="portfolio")return null;return<div style={{color:C.red,fontSize:12}}>No quant data for {symbol}</div>;}
  if(metric==="rollingSharpe"||metric==="rollingSharpe30")return null;
  if(metric==="distribution")return<DistributionPanel label={label||"Return Distribution"} distribution={data.distribution} id={`iq_${symbol}_${metric}`}/>;
  const series=data[metric];
  const showZero=!["rollingVol","rollingVaR95","rollingVaR99"].includes(metric);
  const color=metric.includes("VaR")?C.red:metric==="rollingVol"?C.blue:metric==="drawdownSeries"?C.red:metric==="priceZscore"?C.gold:undefined;
  return<QuantPanel label={label||metric} series={series} dates={data.dates} color={color} showZero={showZero} id={`iq_${symbol}_${metric}`}/>;
}

// ── Rolling Beta (fetches SPX independently) ──────────────────────
function BetaPanel({symbol,range}){
  const [series,setSeries]=useState(null);
  const [dates,setDates]=useState(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let cancelled=false;
    async function go(){
      setLoading(true);setSeries(null);
      try{
        const [a,b]=await Promise.all([
          fetch(`${BACKEND}/api/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`).then(r=>r.json()),
          fetch(`${BACKEND}/api/chart/%5EGSPC?range=${range}&interval=1d`).then(r=>r.json()),
        ]);
        if(cancelled)return;
        const ac=a.bars?.map(b=>parseFloat(b.close)).filter(v=>!isNaN(v))||[];
        const bc=b.bars?.map(b=>parseFloat(b.close)).filter(v=>!isNaN(v))||[];
        const ds=a.bars?.map(b=>b.date)||[];
        const len=Math.min(ac.length,bc.length);
        const ar=ac.slice(-len),br=bc.slice(-len),dr=ds.slice(-len);
        const aRet=ar.slice(1).map((v,i)=>(v-ar[i])/ar[i]);
        const bRet=br.slice(1).map((v,i)=>(v-br[i])/br[i]);
        const WIN=30;
        const out=new Array(WIN).fill(null);
        for(let i=WIN;i<=aRet.length;i++){
          const aw=aRet.slice(i-WIN,i),bw=bRet.slice(i-WIN,i);
          const ma=aw.reduce((s,v)=>s+v,0)/WIN,mb=bw.reduce((s,v)=>s+v,0)/WIN;
          const cov=aw.reduce((s,v,j)=>s+(v-ma)*(bw[j]-mb),0)/WIN;
          const vb=bw.reduce((s,v)=>s+(v-mb)**2,0)/WIN;
          out.push(vb===0?null:+(cov/vb).toFixed(4));
        }
        setSeries(out);setDates(dr);
      }catch{}
      if(!cancelled)setLoading(false);
    }
    go();
    return()=>{cancelled=true;};
  },[symbol,range]);
  if(loading)return<div style={{padding:"10px 0",color:C.textMuted,fontSize:12}}>Computing rolling beta vs S&P 500…</div>;
  if(!series)return null;
  return<QuantPanel label="Rolling Beta vs S&P 500 (30d)" series={series} dates={dates} color={C.blue} showZero={true} id={`beta_${symbol}`}/>;
}

// ── Inline chat chart ─────────────────────────────────────────────
function InlineChart({symbol,range="1y"}){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [type,setType]=useState("line");
  useEffect(()=>{
    const interval=range==="1d"?"5m":range==="5d"?"1h":"1d";
    fetch(`${BACKEND}/api/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`)
      .then(r=>r.json()).then(d=>{setData(d);setLoading(false);}).catch(()=>setLoading(false));
  },[symbol,range]);
  if(loading)return<div style={{padding:"12px 0",color:C.textMuted,fontSize:12}}>Loading {symbol}…</div>;
  if(!data?.bars?.length)return<div style={{color:C.red,fontSize:12}}>No data for {symbol}</div>;
  const first=parseFloat(data.bars[0].close),last=parseFloat(data.bars[data.bars.length-1].close);
  const chg=last-first,chgPct=((chg/first)*100).toFixed(2);
  return(
    <div style={{marginTop:10,background:C.surfaceHigh,borderRadius:12,padding:"12px 14px",border:`1px solid ${C.border}`}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
        <div><Mono style={{fontSize:14,fontWeight:700}}>{data.symbol}</Mono><div style={{fontSize:10,color:C.textMuted,marginTop:2}}>{range.toUpperCase()} · {data.currency}</div></div>
        <div style={{textAlign:"right"}}><Mono style={{fontSize:16,fontWeight:700}}>{last.toFixed(2)}</Mono><div style={{fontSize:12,color:chg>=0?C.green:C.red}}>{chg>=0?"+":""}{chg.toFixed(2)} ({chg>=0?"+":""}{chgPct}%)</div></div>
      </div>
      {type==="line"?<PriceChart bars={data.bars} height={150} id={`ic_${symbol}`}/>:<CandleChart bars={data.bars} height={190} id={`ic_c_${symbol}`}/>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
        <div style={{fontSize:10,color:C.textDim}}>{data.bars[0]?.date} → {data.bars[data.bars.length-1]?.date}</div>
        <div style={{display:"flex",gap:6}}>
          {[["line","Line"],["candle","Candle"]].map(([t,l])=>(
            <button key={t} onClick={()=>setType(t)} style={{padding:"3px 8px",background:type===t?C.goldDim:"none",border:`1px solid ${type===t?C.gold:C.border}`,borderRadius:6,color:type===t?C.goldText:C.textMuted,fontSize:10,cursor:"pointer"}}>{l}</button>
          ))}
        </div>
      </div>
    </div>
  );
}


function InlinePortfolioChart({range="1y"}){
  const [data,setData]=useState(null); const [loading,setLoading]=useState(true);
  useEffect(()=>{let cancelled=false;(async()=>{setLoading(true);try{const r=await fetch(`${BACKEND}/api/portfolio/analytics?range=${encodeURIComponent(range)}`);const d=await r.json();if(!cancelled)setData(d);}catch(e){if(!cancelled)setData({error:e.message});}if(!cancelled)setLoading(false);})();return()=>{cancelled=true};},[range]);
  if(loading)return <div style={{padding:"12px 0",color:C.textMuted,fontSize:12}}>Reconstructing weighted portfolio…</div>;
  if(!data||data.error)return <div style={{color:C.red,fontSize:12}}>No portfolio chart data</div>;
  const bars=(data.dates||[]).map((date,i)=>({date,close:data.portfolioIndex?.[i]})).filter(b=>Number.isFinite(b.close));
  return <div style={{marginTop:10}}><PriceChart bars={bars} height={180} id="portfolio_inline"/><div style={{fontSize:10,color:C.textDim,marginTop:6}}>Current weights × aligned Yahoo 1Y daily returns. Start index = 100.</div></div>;
}

function SimpleTable({rows}){
  if(!rows?.length)return null;
  const headers=rows[0]; const body=rows.slice(1);
  return <div style={{overflowX:"auto",margin:"8px 0",border:`1px solid ${C.border}`,borderRadius:10}}><table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
    <thead><tr>{headers.map((h,i)=><th key={i} style={{textAlign:"left",padding:"7px 8px",background:C.surface,color:C.goldText,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
    <tbody>{body.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j} style={{padding:"6px 8px",borderBottom:i<body.length-1?`1px solid ${C.border}`:"none",fontFamily:/^-?\d+(\.\d+)?%?$/.test(c)?C.mono:undefined,whiteSpace:"nowrap"}}>{c}</td>)}</tr>)}</tbody>
  </table></div>;
}
function parseMarkdownTable(txt){
  const lines=txt.trim().split(/\n/).filter(Boolean);
  if(lines.length<2||!lines[0].includes("|")||!/^[\s|:-]+$/.test(lines[1]))return null;
  return lines.filter((_,i)=>i!==1).map(l=>l.trim().replace(/^\||\|$/g,"").split("|").map(x=>x.trim()));
}

// ── Message content parser ────────────────────────────────────────
function MessageContent({content}){
  if(!content)return null;
  const tokenRe=/(@@(?:CHART|QUANT|PORTFOLIO):[^@]+@@)/g;
  const chunks=content.split(tokenRe);
  return <>{chunks.map((chunk,i)=>{
    const cm=chunk.match(/^@@CHART:([^:]+):([^@]+)@@$/);
    if(cm)return <InlineChart key={i} symbol={cm[1]} range={cm[2]}/>;
    const qm=chunk.match(/^@@QUANT:([^:]+):([^:]+):([^:]+):([^@]+)@@$/);
    if(qm)return <InlineQuant key={i} symbol={qm[1]} metric={qm[2]} range={qm[3]} label={qm[4]}/>;
    const pm=chunk.match(/^@@PORTFOLIO:([^@]+)@@$/);
    if(pm)return <InlinePortfolioChart key={i} range={pm[1]}/>;
    if(!chunk)return null;
    const blocks=chunk.split(/(\n\s*\|[^\n]+\|\s*\n\s*\|[\s|:-]+\|[\s\S]*?(?=\n\n|$))/g);
    return <span key={i}>{blocks.map((b,j)=>{const tbl=parseMarkdownTable(b);return tbl?<SimpleTable key={j} rows={tbl}/>:<span key={j} style={{whiteSpace:"pre-wrap"}}>{b}</span>;})}</span>;
  })}</>;
}

// ── Main app ─────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]=useState("chat");
  const [messages,setMessages]=useState([{role:"assistant",content:"Connected to both IBKR accounts + live market data. I can show charts, quotes, quant analytics, portfolio analysis, and trade history. What would you like?"}]);
  const [input,setInput]=useState("");
  const [loading,setLoading]=useState(false);
  const [portfolio,setPortfolio]=useState(null);
  const [portLoading,setPortLoading]=useState(false);
  const [portfolioView,setPortfolioView]=useState("combined");
  const [tasks,setTasks]=useState([]);
  const [taskLog,setTaskLog]=useState([]);
  const [runningTask,setRunningTask]=useState(null);
  const [pushStatus,setPushStatus]=useState("idle");
  const [ibkrOk,setIbkrOk]=useState(null);
  // Charts
  const [chartSymbol,setChartSymbol]=useState("");
  const [chartInput,setChartInput]=useState("");
  const [chartRange,setChartRange]=useState("1y");
  const [chartType,setChartType]=useState("line");
  const [chartData,setChartData]=useState(null);
  const [chartLoading,setChartLoading]=useState(false);
  const [quotes,setQuotes]=useState([]);
  // Quant
  const [quantData,setQuantData]=useState(null);
  const [quantLoading,setQuantLoading]=useState(false);
  // Symbol news
  const [symbolNews,setSymbolNews]=useState([]);
  const [newsLoading,setNewsLoading]=useState(false);
  // Regime
  const [regimeData,setRegimeData]=useState(null);
  const [regimeLoading,setRegimeLoading]=useState(false);
  const [regimeError,setRegimeError]=useState(null);
  const chatEndRef=useRef(null);
  useEffect(()=>{chatEndRef.current?.scrollIntoView({behavior:"smooth"});},[messages]);
  useEffect(()=>{loadPortfolio();loadTasks();loadLog();checkStatus();checkPush();},[]);

  async function checkStatus(){try{const r=await fetch(`${BACKEND}/api/ibkr/status`);const d=await r.json();setIbkrOk(d.authenticated);}catch{setIbkrOk(false);}}
  async function loadPortfolio(){setPortLoading(true);try{const r=await fetch(`${BACKEND}/api/account`);setPortfolio(await r.json());}catch{}setPortLoading(false);}
  async function loadTasks(){try{setTasks(await(await fetch(`${BACKEND}/api/tasks`)).json());}catch{}}
  async function loadLog(){try{setTaskLog(await(await fetch(`${BACKEND}/api/log`)).json());}catch{}}
  async function toggleTask(id,enabled){await fetch(`${BACKEND}/api/tasks/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled})});loadTasks();}
  async function runTaskNow(id){setRunningTask(id);await fetch(`${BACKEND}/api/tasks/${id}/run`,{method:"POST"});setTimeout(async()=>{await loadTasks();await loadLog();setRunningTask(null);},60000);}

  async function loadQuotes(){
    if(!portfolio?.combined?.positions?.length)return;
    const syms=portfolio.combined.positions.map(p=>YF[p.symbol]||p.symbol).join(",");
    try{const r=await fetch(`${BACKEND}/api/quotes?symbols=${encodeURIComponent(syms)}`);setQuotes(await r.json());}catch{}
  }

  async function loadChart(sym,range=chartRange){
    if(!sym)return;
    setChartLoading(true);setChartData(null);setQuantData(null);
    try{
      const r=await fetch(`${BACKEND}/api/chart/${encodeURIComponent(sym)}?range=${range}&interval=${range==="1d"?"5m":range==="5d"?"1h":"1d"}`);
      const d=await r.json();
      setChartData(d);setChartSymbol(sym);
      loadQuantData(sym,range);
      loadSymbolNews(sym);
    }catch{}
    setChartLoading(false);
  }

  async function loadQuantData(sym,range){
    if(!sym)return;
    setQuantLoading(true);setQuantData(null);
    try{
      const r=await fetch(`${BACKEND}/api/analytics/compute`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol:sym,range:range||"1y",rolling_window:30})});
      const d=await r.json();
      console.log("quant response keys:",Object.keys(d));
      // Server returns: { dates, closes, returns, distribution, rolling VaR, priceZscore, rollingSharpe, rollingVol, drawdownSeries, summary, symbol, range }
      if(d.dates&&d.priceZscore){
        setQuantData(d);
        console.log("quantData set, priceZscore length:",d.priceZscore.length);
      } else {
        console.error("unexpected quant response:",d);
      }
    }catch(e){console.error("quant error:",e);}
    setQuantLoading(false);
  }

  async function loadSymbolNews(sym){
    if(!sym)return;
    setNewsLoading(true);setSymbolNews([]);
    try{const r=await fetch(`${BACKEND}/api/news/symbol/${encodeURIComponent(sym)}?limit=5`);const d=await r.json();setSymbolNews(d.news||[]);}catch{}
    setNewsLoading(false);
  }
  async function loadRegime(){
    setRegimeLoading(true);setRegimeError(null);setRegimeData(null);
    try{const r=await fetch(`${BACKEND}/api/regime`);const d=await r.json();if(d.error)setRegimeError(d.error);else setRegimeData(d);}catch(e){setRegimeError(e.message);}
    setRegimeLoading(false);
  }
  async function sendMessage(){
    if(!input.trim()||loading)return;
    const text=input.trim();
    const history=messages.map(m=>({role:m.role,content:m.content}));
    setMessages(prev=>[...prev,{role:"user",content:text},{role:"assistant",content:"",loading:true}]);
    setInput("");setLoading(true);
    try{
      const r=await fetch(`${BACKEND}/api/chat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:text,history})});
      const d=await r.json();
      setMessages(prev=>[...prev.slice(0,-1),{role:"assistant",content:d.reply||d.error||"No response"}]);
    }catch(e){setMessages(prev=>[...prev.slice(0,-1),{role:"assistant",content:`Error: ${e.message}`}]);}
    setLoading(false);
  }

  async function checkPush(){
    if(!("serviceWorker"in navigator)||!("PushManager"in window)){setPushStatus("unsupported");return;}
    try{const reg=await navigator.serviceWorker.register("/sw.js");await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();if(sub)setPushStatus("subscribed");else if(Notification.permission==="denied")setPushStatus("denied");}catch{}
  }
  async function enablePush(){
    setPushStatus("requesting");
    try{
      const{publicKey}=await(await fetch(`${BACKEND}/api/push/vapid-key`)).json();
      if(!publicKey)throw new Error("VAPID key not configured");
      if(await Notification.requestPermission()!=="granted"){setPushStatus("denied");return;}
      const reg=await navigator.serviceWorker.ready;
      const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToUint8(publicKey)});
      await fetch(`${BACKEND}/api/push/subscribe`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(sub)});
      setPushStatus("subscribed");
    }catch(e){setPushStatus("idle");alert("Push failed: "+e.message);}
  }
  async function disablePush(){
    try{const reg=await navigator.serviceWorker.getRegistration();const sub=await reg?.pushManager.getSubscription();if(sub){await fetch(`${BACKEND}/api/push/unsubscribe`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({endpoint:sub.endpoint})});await sub.unsubscribe();}setPushStatus("idle");}catch{}
  }

  const combined=portfolio?.combined;
  const acct1=portfolio?.accounts?.find(a=>a.accountId==="U11354150");
  const acct2=portfolio?.accounts?.find(a=>a.accountId==="U9733561");
  const fmtEUR=v=>`€${parseFloat(v||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const fmtGBP=v=>`£${parseFloat(v||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const fmtPct=v=>`${parseFloat(v||0).toFixed(1)}%`;

  const PushBanner=()=>{
    if(pushStatus==="unsupported"||pushStatus==="subscribed")return null;
    if(pushStatus==="denied")return<div style={{background:C.surfaceHigh,border:`1px solid ${C.red}44`,borderRadius:12,padding:"11px 14px",marginBottom:12}}><div style={{fontSize:13,color:C.red,fontWeight:600}}>🔕 Notifications blocked</div></div>;
    return<button onClick={enablePush} disabled={pushStatus==="requesting"} style={{width:"100%",background:C.goldDim,border:`1px solid ${C.gold}55`,borderRadius:12,padding:"13px 16px",marginBottom:12,display:"flex",alignItems:"center",gap:12,cursor:"pointer",textAlign:"left"}}><span style={{fontSize:20}}>🔔</span><div><div style={{fontSize:14,fontWeight:600,color:C.goldText}}>{pushStatus==="requesting"?"Setting up…":"Enable push notifications"}</div><div style={{fontSize:11,color:C.textMuted,marginTop:2}}>Alerts for tasks — even when app is closed</div></div></button>;
  };

  return(
    <div style={{background:C.bg,minHeight:"100vh",fontFamily:"Inter,system-ui,sans-serif",color:C.textPrimary,maxWidth:480,margin:"0 auto",display:"flex",flexDirection:"column",height:"100dvh"}}>

      {/* Header */}
      <div style={{padding:"14px 18px 12px",borderBottom:`1px solid ${C.border}`,background:C.surface,flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:32,height:32,borderRadius:8,background:C.goldDim,border:`1px solid ${C.gold}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>📊</div>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:C.goldText}}>IBKR Agent</div>
              <div style={{display:"flex",alignItems:"center",gap:5,marginTop:1}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:ibkrOk?C.green:ibkrOk===false?C.red:C.amber}}/>
                <span style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em"}}>{ibkrOk?"2 accounts":ibkrOk===false?"Offline":"Connecting"}</span>
              </div>
            </div>
          </div>
          {combined&&<div style={{textAlign:"right"}}><Mono style={{fontSize:17,fontWeight:700}}>{fmtEUR(combined.totalNetLiquidation)}</Mono>{combined.avgYtdReturnPct!==0&&<div style={{fontSize:11,color:combined.avgYtdReturnPct>=0?C.green:C.red,marginTop:1}}>{combined.avgYtdReturnPct>0?"▲":"▼"} {Math.abs(combined.avgYtdReturnPct)}% 1Y</div>}</div>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,background:C.surface,flexShrink:0}}>
        {[["chat","💬","Chat"],["portfolio","📊","Portfolio"],["charts","📈","Charts"],["regime","🔴","Regime"],["schedule","⏱","Schedule"]].map(([id,icon,label])=>(
          <button key={id} onClick={()=>{setTab(id);if(id==="charts"&&!quotes.length)loadQuotes();if(id==="regime"&&!regimeData&&!regimeLoading)loadRegime();}}
            style={{flex:1,padding:"10px 0",background:"none",border:"none",cursor:"pointer",fontSize:11,fontWeight:tab===id?700:400,color:tab===id?C.goldText:C.textMuted,borderBottom:tab===id?`2px solid ${C.gold}`:"2px solid transparent"}}>
            {icon} {label}
          </button>
        ))}
      </div>

      {/* ══ CHAT ══════════════════════════════════════════════════ */}
      {tab==="chat"&&(
        <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden"}}>
          <div style={{flex:1,overflowY:"auto",padding:16}}>
            <PushBanner/>
            <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:16}}>
              {["Combined Portfolio Overview","Latest Market News","PnL Summary","Var & Risk report"].map(q=>(
                <button key={q} onClick={()=>setInput(q)} style={{background:C.surfaceHigh,border:`1px solid ${C.border}`,borderRadius:20,padding:"5px 11px",color:C.textMuted,fontSize:12,cursor:"pointer"}}>{q}</button>
              ))}
            </div>
            {messages.map((m,i)=>(
              <div key={i} style={{marginBottom:14,display:"flex",flexDirection:m.role==="user"?"row-reverse":"row",gap:8,alignItems:"flex-end"}}>
                {m.role==="assistant"&&<div style={{width:26,height:26,borderRadius:"50%",background:C.goldDim,border:`1px solid ${C.gold}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,flexShrink:0}}>🤖</div>}
                <div style={{maxWidth:"82%",padding:"10px 14px",borderRadius:m.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",background:m.role==="user"?"#1E3A5F":C.surfaceHigh,border:m.role==="user"?"none":`1px solid ${C.border}`,color:C.textPrimary,fontSize:14,lineHeight:1.6,overflow:"hidden",minWidth:0}}>
                  {m.loading?<span style={{opacity:0.4}}>Thinking…</span>:<MessageContent content={m.content}/>}
                </div>
              </div>
            ))}
            <div ref={chatEndRef}/>
          </div>
          <div style={{padding:"12px 14px",borderTop:`1px solid ${C.border}`,background:C.surface,display:"flex",gap:10,flexShrink:0}}>
            <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendMessage()}
              placeholder="Ask about portfolio, charts, any stock…"
              style={{flex:1,background:C.surfaceHigh,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",color:C.textPrimary,fontSize:14,outline:"none",fontFamily:"inherit"}}/>
            <button onClick={sendMessage} disabled={loading} style={{background:loading?C.goldDim:C.gold,border:"none",borderRadius:12,width:44,cursor:loading?"default":"pointer",color:"#0D0F14",fontSize:20,fontWeight:900}}>↑</button>
          </div>
        </div>
      )}

      {/* ══ PORTFOLIO ═════════════════════════════════════════════ */}
      {tab==="portfolio"&&(
        <div style={{flex:1,overflowY:"auto",padding:16}}>
          {portLoading&&<div style={{color:C.textMuted,textAlign:"center",padding:48}}>Loading…</div>}
          {portfolio&&!portLoading&&(
            <>
              <div style={{display:"flex",gap:6,marginBottom:14}}>
                {[["combined","Combined"],["u1","EUR Account"],["u2","GBP Account"]].map(([v,label])=>(
                  <button key={v} onClick={()=>setPortfolioView(v)} style={{flex:1,padding:"7px 4px",background:portfolioView===v?C.goldDim:C.surfaceHigh,border:`1px solid ${portfolioView===v?C.gold:C.border}`,borderRadius:8,color:portfolioView===v?C.goldText:C.textMuted,fontSize:11,cursor:"pointer",fontWeight:portfolioView===v?700:400}}>{label}</button>
                ))}
              </div>

              {portfolioView==="combined"&&combined&&(
                <>
                  <Card style={{padding:"16px"}}>
                    <div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Combined Net Liquidation</div>
                    <Mono style={{fontSize:24,fontWeight:700,color:C.goldText}}>{fmtEUR(combined.totalNetLiquidation)}</Mono>
                    {combined.avgYtdReturnPct!==0&&<div style={{marginTop:6}}>
                      <div style={{fontSize:10,color:C.textMuted,marginBottom:2}}>1Y RETURN</div><Mono style={{fontSize:14,fontWeight:700,color:combined.avgYtdReturnPct>=0?C.green:C.red}}>{combined.avgYtdReturnPct>0?"+":""}{combined.avgYtdReturnPct}%</Mono>
                    </div>}
                  </Card>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:14}}>
                    {[{label:"Cash",val:fmtEUR(combined.totalCash)},{label:"Stock Value",val:fmtEUR(combined.totalStockValue)},{label:"Unrealized P&L",val:combined.totalUnrealizedPnlEUR,isPnl:true},{label:"Dividends (1Y)",val:fmtEUR(combined.totalDividends)},{label:"Commissions",val:fmtEUR(combined.totalCommissions)},{label:"Broker Interest",val:fmtEUR(combined.totalBrokerInterest)},{label:"Net Deposited (1Y)",val:fmtEUR(combined.totalNetDeposits)}].map(s=>(
                      <Card key={s.label} style={{padding:"12px 14px"}}>
                        <div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{s.label}</div>
                        {s.isPnl?<PnlText value={s.val} style={{fontSize:15}}/>:<Mono style={{fontSize:15,fontWeight:700}}>{s.val}</Mono>}
                      </Card>
                    ))}
                  </div>

                  {combined.metrics1Y&&(
                    <>
                      <div style={{fontSize:11,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",margin:"4px 0 8px"}}>1Y portfolio risk metrics</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:14}}>
                        {[
                          {label:"Sharpe",val:combined.metrics1Y.sharpe!==null&&combined.metrics1Y.sharpe!==undefined?combined.metrics1Y.sharpe.toFixed(2):"—",color:combined.metrics1Y.sharpe>1?C.green:combined.metrics1Y.sharpe<0?C.red:C.amber},
                          {label:"1Y return",val:combined.metrics1Y.annualizedReturnPct!==null&&combined.metrics1Y.annualizedReturnPct!==undefined?combined.metrics1Y.annualizedReturnPct.toFixed(1)+"%":"—",color:combined.metrics1Y.annualizedReturnPct>=0?C.green:C.red},
                          {label:"Max DD",val:combined.metrics1Y.maxDrawdownPct!==null&&combined.metrics1Y.maxDrawdownPct!==undefined?combined.metrics1Y.maxDrawdownPct.toFixed(1)+"%":"—",color:C.red},
                          {label:"VaR 95",val:combined.metrics1Y.var95Pct!==null&&combined.metrics1Y.var95Pct!==undefined?combined.metrics1Y.var95Pct.toFixed(2)+"%":"—",color:C.red},
                          {label:"Info Ratio",val:combined.metrics1Y.informationRatioVsSPX!==null?combined.metrics1Y.informationRatioVsSPX?.toFixed(2):"—",color:C.blue},
                          {label:"Avg daily",val:combined.metrics1Y.averageDailyReturnPct!==null&&combined.metrics1Y.averageDailyReturnPct!==undefined?combined.metrics1Y.averageDailyReturnPct.toFixed(3)+"%":"—",color:combined.metrics1Y.averageDailyReturnPct>=0?C.green:C.red},
                          {label:"Calmar",val:combined.metrics1Y.calmar!==null?combined.metrics1Y.calmar?.toFixed(2):"—",color:C.gold},
                          {label:"Ann. Vol",val:combined.metrics1Y.annualizedVolPct!==null&&combined.metrics1Y.annualizedVolPct!==undefined?combined.metrics1Y.annualizedVolPct.toFixed(1)+"%":"—",color:C.textPrimary},
                          {label:"Sortino",val:combined.metrics1Y.sortino?.toFixed(2),color:combined.metrics1Y.sortino>1?C.green:combined.metrics1Y.sortino<0?C.red:C.amber},
                          {label:"CVaR 95",val:combined.metrics1Y.cvar95Pct!==null&&combined.metrics1Y.cvar95Pct!==undefined?combined.metrics1Y.cvar95Pct.toFixed(2)+"%":"—",color:C.red},
                        ].map(st=>(
                          <Card key={st.label} style={{padding:"10px 8px",marginBottom:0,textAlign:"center"}}>
                            <div style={{fontSize:9,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{st.label}</div>
                            <Mono style={{fontSize:13,fontWeight:700,color:st.color}}>{st.val??"—"}</Mono>
                          </Card>
                        ))}
                      </div>
                      <div style={{fontSize:10,color:C.textDim,margin:"-6px 0 12px"}}>Method: current weights × 1Y Yahoo daily-return correlation/covariance matrix. Sharpe/Sortino = (return − risk-free rate) / vol, risk-free = {combined.metrics1Y.riskFreeRatePct??"3.64"}% (SOFR); benchmark = SPX.</div>
                      {combined.metrics1Y.drawdownSeries&&<QuantPanel label="Portfolio drawdown % from peak" series={combined.metrics1Y.drawdownSeries} dates={combined.metrics1Y.dates} color={C.red} showZero={false} id="pf_drawdown"/>}
                      {combined.metrics1Y.portfolioIndex&&<div style={{marginBottom:12,marginTop:4}}><PriceChart bars={combined.metrics1Y.dates.map((date,i)=>({date,close:combined.metrics1Y.portfolioIndex[i]}))} height={170} id="pf_index"/><div style={{fontSize:10,color:C.textDim,marginTop:4}}>Reconstructed portfolio index (current weights × 1Y daily returns). Start = 100.</div></div>}

                      {/* ── PCA Analysis ──────────────────────────── */}
                      {combined.metrics1Y.pca&&(()=>{
                        const{components,nAssets,totalVarianceExplainedPct}=combined.metrics1Y.pca;
                        return(
                          <Card style={{padding:"14px 14px 10px",marginTop:4}}>
                            <div style={{fontSize:13,fontWeight:700,marginBottom:2}}>PCA — Principal Component Analysis</div>
                            <div style={{fontSize:11,color:C.textMuted,marginBottom:12}}>{components.length} components explain {totalVarianceExplainedPct}% of variance across {nAssets} holdings (1Y daily returns, correlation-based)</div>
                            {components.map(c=>{
                              const maxAbs=Math.max(...c.loadings.map(l=>Math.abs(l.loading)),0.01);
                              return(
                                <div key={c.pc} style={{marginBottom:14,paddingBottom:12,borderBottom:c.pc<components.length?`1px solid ${C.border}`:"none"}}>
                                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                                    <span style={{fontSize:12,fontWeight:700,color:C.gold}}>PC{c.pc}</span>
                                    <span style={{fontSize:11,color:C.textMuted}}>{c.varExplainedPct}% var · cum {c.cumVarExplainedPct}%</span>
                                  </div>
                                  {c.loadings.sort((a,b)=>Math.abs(b.loading)-Math.abs(a.loading)).map(l=>{
                                    const w=Math.abs(l.loading)/maxAbs*100;
                                    const col=l.loading>=0?C.green:C.red;
                                    return(
                                      <div key={l.symbol} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                                        <Mono style={{fontSize:10,color:C.textMuted,width:55,flexShrink:0}}>{l.symbol}</Mono>
                                        <div style={{flex:1,background:C.border,borderRadius:3,height:10,position:"relative",overflow:"hidden"}}>
                                          <div style={{position:"absolute",left:l.loading>=0?"50%":`${50-w/2}%`,width:`${w/2}%`,height:"100%",background:col,opacity:0.85}}/>
                                          <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:C.textDim}}/>
                                        </div>
                                        <Mono style={{fontSize:10,color:col,width:42,textAlign:"right",flexShrink:0}}>{l.loading>=0?"+":""}{l.loading.toFixed(2)}</Mono>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                            <div style={{fontSize:10,color:C.textDim,marginTop:4}}>PC1 typically captures broad market direction. Loadings show how much each holding contributes to that component — same sign = move together, opposite sign = move apart.</div>
                          </Card>
                        );
                      })()}

                      {/* ── Fama-French 3-Factor Regression ──────── */}
                      {combined.metrics1Y.famaFrench&&(()=>{
                        const ff=combined.metrics1Y.famaFrench;
                        const FactorBar=({label,val,desc,range=2})=>{
                          const pct=Math.max(-100,Math.min(100,(val/range)*100));
                          const col=val>=0?C.green:C.red;
                          return(
                            <div style={{marginBottom:12}}>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                                <span style={{fontSize:11,fontWeight:600,color:C.textPrimary}}>{label}</span>
                                <Mono style={{fontSize:13,fontWeight:700,color:col}}>{val>=0?"+":""}{val.toFixed(3)}</Mono>
                              </div>
                              <div style={{background:C.border,borderRadius:3,height:10,position:"relative",overflow:"hidden"}}>
                                <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:C.textDim,zIndex:1}}/>
                                <div style={{position:"absolute",left:val>=0?"50%":`${50+pct/2}%`,width:`${Math.abs(pct)/2}%`,height:"100%",background:col,opacity:0.85}}/>
                              </div>
                              <div style={{fontSize:10,color:C.textMuted,marginTop:3}}>{desc}</div>
                            </div>
                          );
                        };
                        return(
                          <Card style={{padding:"14px 14px 10px",marginTop:4}}>
                            <div style={{fontSize:13,fontWeight:700,marginBottom:2}}>Fama-French 5-Factor Regression</div>
                            <div style={{fontSize:11,color:C.textMuted,marginBottom:14}}>OLS on {ff.n} days · R² = {(ff.rSquared*100).toFixed(1)}% · ETF proxies: URTH, IWM, IWD/IWF, UUP, EEM</div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
                              <div style={{background:C.surfaceHigh,borderRadius:8,padding:"8px 10px",textAlign:"center"}}>
                                <div style={{fontSize:9,color:C.textMuted,marginBottom:3}}>ALPHA (ann.)</div>
                                <Mono style={{fontSize:14,fontWeight:700,color:ff.alpha>=0?C.green:C.red}}>{ff.alpha>=0?"+":""}{ff.alpha}%</Mono>
                              </div>
                              <div style={{background:C.surfaceHigh,borderRadius:8,padding:"8px 10px",textAlign:"center"}}>
                                <div style={{fontSize:9,color:C.textMuted,marginBottom:3}}>R-SQUARED</div>
                                <Mono style={{fontSize:14,fontWeight:700,color:C.blue}}>{(ff.rSquared*100).toFixed(1)}%</Mono>
                              </div>
                            </div>
                            <FactorBar label="Market Beta (Mkt-RF, MSCI World)" val={ff.betaMarket} desc="Sensitivity to overall global equity market moves. 1.0 = moves with the world market." range={1.5}/>
                            <FactorBar label="Size (SMB)" val={ff.betaSize} desc="Positive = tilted small-cap, negative = tilted large-cap." range={1}/>
                            <FactorBar label="Value (HML)" val={ff.betaValue} desc="Positive = tilted value stocks, negative = tilted growth stocks." range={1}/>
                            <FactorBar label="USD Strength (DXY)" val={ff.betaUSDStrength} desc="Positive = portfolio benefits when the US Dollar strengthens, negative = hurt by a stronger dollar." range={1}/>
                            <FactorBar label="Emerging Markets" val={ff.betaEmergingMkts} desc="Positive = tilted emerging markets, negative = tilted developed markets." range={1}/>
                            <div style={{fontSize:10,color:C.textDim,marginTop:4}}>{ff.method}</div>
                          </Card>
                        );
                      })()}
                    </>
                  )}
                  {combined.metrics1Y?.mvo && <MVOPanel mvo={combined.metrics1Y.mvo}/>}
                  <div style={{fontSize:11,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Positions — combined allocation</div>
                  {combined.positions.map(p=>(
                    <Card key={p.symbol}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <Mono style={{fontSize:15,fontWeight:700}}>{p.symbol}</Mono>
                            <span style={{fontSize:11,color:C.textMuted}}>{fmtPct(p.allocationPct)}</span>
                            <button onClick={()=>{const sym=YF[p.symbol]||p.symbol;setChartInput(sym);setTab("charts");loadChart(sym);}} style={{marginLeft:"auto",background:C.goldDim,border:`1px solid ${C.gold}44`,borderRadius:6,padding:"2px 8px",color:C.goldText,fontSize:11,cursor:"pointer"}}>Chart</button>
                          </div>
                          <div style={{fontSize:12,color:C.textMuted,marginTop:2}}>{p.description}</div>
                          <AllocationBar pct={p.allocationPct}/>
                          {p.legs.length>1&&<div style={{fontSize:11,color:C.textDim,marginTop:4}}>{p.legs.map(l=>`${l.accountId.slice(-7)}: ${l.quantity}`).join(" · ")}</div>}
                        </div>
                        <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                          <Mono style={{fontSize:14,fontWeight:600}}>{fmtEUR(p.totalValueEUR)}</Mono>
                          {p.totalUnrealEUR!==0&&<div style={{marginTop:3}}><PnlText value={p.totalUnrealEUR} style={{fontSize:12}}/></div>}
                        </div>
                      </div>
                    </Card>
                  ))}
                </>
              )}

              {portfolioView==="u1"&&acct1&&(
                <>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:14}}>
                    {[{label:"Net Liquidation",val:fmtEUR(acct1.netLiquidation)},{label:"Cash",val:fmtEUR(acct1.cash)},{label:"1Y Return",val:`${acct1.ytdReturn>0?"+":""}${acct1.ytdReturn?.toFixed(2)}%`,color:acct1.ytdReturn>=0?C.green:C.red},{label:"Stock Value",val:fmtEUR(acct1.stockValue)}].map(s=>(
                      <Card key={s.label} style={{padding:"12px 14px"}}><div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{s.label}</div><Mono style={{fontSize:15,fontWeight:700,color:s.color||C.textPrimary}}>{s.val}</Mono></Card>
                    ))}
                  </div>
                  {acct1.positions.map(p=>(
                    <Card key={p.symbol}><div style={{display:"flex",justifyContent:"space-between"}}><div><Mono style={{fontSize:14,fontWeight:700}}>{p.symbol}</Mono><div style={{fontSize:12,color:C.textMuted,marginTop:2}}>{p.quantity} × {p.currency} {parseFloat(p.markPrice).toFixed(2)}</div></div><div style={{textAlign:"right"}}><Mono style={{fontSize:14,fontWeight:600}}>{p.currency} {parseFloat(p.positionValue).toFixed(2)}</Mono><div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{fmtPct(p.percentOfAccountNAV)}</div></div></div></Card>
                  ))}
                </>
              )}

              {portfolioView==="u2"&&acct2&&(
                <>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:14}}>
                    {[{label:"Net Liquidation",val:fmtGBP(acct2.netLiquidation)},{label:"In EUR",val:fmtEUR(acct2.netLiquidationEUR)},{label:"Cash",val:fmtGBP(acct2.cash)},{label:"1Y Return",val:`${acct2.ytdReturn>0?"+":""}${acct2.ytdReturn?.toFixed(2)}%`,color:acct2.ytdReturn>=0?C.green:C.red}].map(s=>(
                      <Card key={s.label} style={{padding:"12px 14px"}}><div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{s.label}</div><Mono style={{fontSize:15,fontWeight:700,color:s.color||C.textPrimary}}>{s.val}</Mono></Card>
                    ))}
                  </div>
                  {acct2.positions.map(p=>(
                    <Card key={p.symbol}><div style={{display:"flex",justifyContent:"space-between"}}><div><Mono style={{fontSize:14,fontWeight:700}}>{p.symbol}</Mono><div style={{fontSize:12,color:C.textMuted,marginTop:2}}>{p.quantity} × {p.currency} {parseFloat(p.markPrice).toFixed(2)}</div></div><div style={{textAlign:"right"}}><Mono style={{fontSize:14,fontWeight:600}}>{p.currency} {parseFloat(p.positionValue).toFixed(2)}</Mono><div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{fmtPct(p.percentOfAccountNAV)}</div></div></div></Card>
                  ))}
                </>
              )}
              <button onClick={loadPortfolio} style={{width:"100%",marginTop:8,background:C.surfaceHigh,border:`1px solid ${C.border}`,borderRadius:10,padding:12,color:C.textMuted,fontSize:14,cursor:"pointer"}}>↻ Refresh</button>
            </>
          )}
        </div>
      )}

      {/* ══ CHARTS ════════════════════════════════════════════════ */}
      {tab==="charts"&&(
        <div style={{flex:1,overflowY:"auto",padding:16}}>
          {/* Search */}
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            <input value={chartInput} onChange={e=>setChartInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&loadChart(chartInput.trim())}
              placeholder="Symbol e.g. CSPX.L, AAPL, BTC-USD"
              style={{flex:1,background:C.surfaceHigh,border:`1px solid ${C.border}`,borderRadius:10,padding:"9px 12px",color:C.textPrimary,fontSize:13,outline:"none"}}/>
            <button onClick={()=>loadChart(chartInput.trim())} style={{background:C.gold,border:"none",borderRadius:10,padding:"9px 14px",color:"#0D0F14",fontSize:13,fontWeight:700,cursor:"pointer"}}>Go</button>
          </div>
          {/* Holdings quick buttons */}
          <div style={{fontSize:11,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Your holdings</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
            {Object.entries(YF).map(([ibkr,yf])=>(
              <button key={ibkr} onClick={()=>{setChartInput(yf);loadChart(yf);}}
                style={{background:chartSymbol===yf?C.goldDim:C.surfaceHigh,border:`1px solid ${chartSymbol===yf?C.gold:C.border}`,borderRadius:8,padding:"5px 10px",color:chartSymbol===yf?C.goldText:C.textMuted,fontSize:12,cursor:"pointer"}}>{ibkr}</button>
            ))}
          </div>
          {/* Range */}
          <div style={{display:"flex",gap:6,marginBottom:12}}>
            {["1mo","3mo","6mo","ytd","1y","2y","5y"].map(r=>(
              <button key={r} onClick={()=>{setChartRange(r);if(chartSymbol)loadChart(chartSymbol,r);}}
                style={{flex:1,padding:"6px 0",background:chartRange===r?C.goldDim:C.surfaceHigh,border:`1px solid ${chartRange===r?C.gold:C.border}`,borderRadius:6,color:chartRange===r?C.goldText:C.textMuted,fontSize:11,cursor:"pointer",fontWeight:chartRange===r?700:400}}>{r.toUpperCase()}</button>
            ))}
          </div>
          {/* Chart type */}
          <div style={{display:"flex",gap:6,marginBottom:14}}>
            {[["line","Line"],["candle","Candle"]].map(([t,l])=>(
              <button key={t} onClick={()=>setChartType(t)} style={{flex:1,padding:"7px 0",background:chartType===t?C.goldDim:C.surfaceHigh,border:`1px solid ${chartType===t?C.gold:C.border}`,borderRadius:8,color:chartType===t?C.goldText:C.textMuted,fontSize:12,cursor:"pointer",fontWeight:chartType===t?700:400}}>{l}</button>
            ))}
          </div>

          {/* Price chart */}
          {chartLoading&&<div style={{color:C.textMuted,textAlign:"center",padding:40}}>Loading chart…</div>}
          {chartData&&!chartLoading&&(
            <Card style={{padding:"14px 14px 8px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div><Mono style={{fontSize:16,fontWeight:700}}>{chartData.symbol}</Mono><div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{chartData.range?.toUpperCase()} · {chartData.currency}</div></div>
                {chartData.bars?.length>0&&(()=>{
                  const first=parseFloat(chartData.bars[0].close),last=parseFloat(chartData.bars[chartData.bars.length-1].close);
                  const chg=last-first,chgPct=((chg/first)*100).toFixed(2),col=chg>=0?C.green:C.red;
                  return<div style={{textAlign:"right"}}><Mono style={{fontSize:18,fontWeight:700}}>{last.toFixed(2)}</Mono><div style={{fontSize:13,color:col,marginTop:2}}>{chg>=0?"+":""}{chg.toFixed(2)} ({chg>=0?"+":""}{chgPct}%)</div></div>;
                })()}
              </div>
              {chartType==="line"?<PriceChart bars={chartData.bars} height={160} id="main_price"/>:<CandleChart bars={chartData.bars} height={200} id="main_candle"/>}
              <div style={{display:"flex",justifyContent:"space-between",marginTop:8}}>
                <div style={{fontSize:10,color:C.textDim}}>{chartData.bars?.[0]?.date}</div>
                <div style={{fontSize:10,color:C.textDim}}>{chartData.bars?.[chartData.bars.length-1]?.date}</div>
              </div>
            </Card>
          )}

          {(newsLoading||symbolNews.length>0)&&(
            <div style={{marginTop:12,background:C.surfaceHigh,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontSize:11,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>📰 Latest Headlines</div>
              {newsLoading&&<div style={{fontSize:12,color:C.textMuted}}>Loading…</div>}
              {symbolNews.map((n,i)=>(
                <div key={i} style={{marginBottom:i<symbolNews.length-1?10:0,paddingBottom:i<symbolNews.length-1?10:0,borderBottom:i<symbolNews.length-1?`1px solid ${C.border}`:"none"}}>
                  <a href={n.link||"#"} target="_blank" rel="noopener noreferrer" style={{fontSize:13,color:C.textPrimary,textDecoration:"none",lineHeight:1.45,display:"block"}}>{n.title}</a>
                  <div style={{fontSize:10,color:C.textMuted,marginTop:3}}>{n.publisher}{n.published?` · ${new Date(n.published).toLocaleDateString()}`:""}</div>
                </div>
              ))}
            </div>
          )}
          {/* Quant panels */}
          {quantLoading&&<div style={{color:C.textMuted,fontSize:12,textAlign:"center",padding:"16px 0"}}>⏳ Computing Z-score, volatility, Sharpe, drawdown…</div>}
          {quantData&&!quantLoading&&(()=>{
            const s=quantData.summary||{};
            const dates=quantData.dates;
            return(
              <>
                {/* Stats */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:7,marginBottom:4,marginTop:8}}>
                  {[
                    {label:"Z-Score (ret)",val:(s.currentReturnZscore30??s.currentReturnZscore)?.toFixed(3),color:(s.currentReturnZscore30??s.currentReturnZscore)>2?C.red:(s.currentReturnZscore30??s.currentReturnZscore)<-2?C.green:C.gold},
                    {label:"Ann. Vol",val:s.annualizedVol?s.annualizedVol.toFixed(1)+"%":"—",color:C.textPrimary},
                    {label:"VaR 95",val:s.var95!==null&&s.var95!==undefined?s.var95.toFixed(2)+"%":"—",color:C.red},
                    {label:"CVaR 95",val:s.cvar95!==null&&s.cvar95!==undefined?s.cvar95.toFixed(2)+"%":"—",color:C.red},
                    {label:"Sharpe",val:s.sharpe?.toFixed(2),color:s.sharpe>1?C.green:s.sharpe<0?C.red:C.amber},
                    {label:"Skew",val:s.skewness?.toFixed(2),color:s.skewness<0?C.red:C.green},
                    {label:"Kurt",val:s.kurtosis?.toFixed(2),color:C.amber},
                    {label:"Max DD",val:s.maxDrawdown!==null&&s.maxDrawdown!==undefined?s.maxDrawdown.toFixed(1)+"%":"—",color:C.red},
                  ].map(st=>(
                    <div key={st.label} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"9px 8px",textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{st.label}</div>
                      <Mono style={{fontSize:13,fontWeight:700,color:st.color}}>{st.val??"—"}</Mono>
                    </div>
                  ))}
                </div>
                <QuantPanel label="Z-Score of Returns (30d rolling)" series={quantData.priceZscore30||quantData.priceZscore} dates={dates} color={C.gold} showZero={true} id="q_zscore"/>
                <QuantPanel label="Daily Returns %" series={quantData.returns} dates={dates} showZero={true} id="q_returns"/>
                <DistributionPanel label="Return Distribution" distribution={quantData.distribution} id="q_dist"/>
                <QuantPanel label="Rolling Volatility % ann. (30d)" series={quantData.rollingVol} dates={dates} color={C.blue} showZero={false} id="q_vol"/>
                <QuantPanel label="Rolling VaR 95% (30d)" series={quantData.rollingVaR95} dates={dates} color={C.red} showZero={false} id="q_var95"/>
                <QuantPanel label="Rolling VaR 99% (30d)" series={quantData.rollingVaR99} dates={dates} color={C.red} showZero={false} id="q_var99"/>
                {/* Rolling Sharpe removed */}
                <QuantPanel label="Drawdown % from peak" series={quantData.drawdownSeries} dates={dates} color={C.red} showZero={false} id="q_dd"/>
                
              </>
            );
          })()}

          {/* Live quotes */}
          {quotes.length>0&&(
            <>
              <div style={{fontSize:11,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",margin:"16px 0 8px"}}>Live quotes</div>
              {quotes.map(q=>(
                <Card key={q.symbol} style={{padding:"10px 14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div><Mono style={{fontSize:13,fontWeight:700}}>{q.symbol}</Mono><div style={{fontSize:11,color:C.textMuted,marginTop:1}}>{q.shortName?.slice(0,30)}</div></div>
                    <div style={{textAlign:"right"}}><Mono style={{fontSize:14,fontWeight:600}}>{q.price?.toFixed(2)}</Mono><div style={{fontSize:12,color:q.changePct>=0?C.green:C.red,marginTop:1}}>{q.changePct>=0?"+":""}{q.changePct?.toFixed(2)}%</div></div>
                  </div>
                </Card>
              ))}
              <button onClick={loadQuotes} style={{width:"100%",marginTop:4,background:C.surfaceHigh,border:`1px solid ${C.border}`,borderRadius:10,padding:10,color:C.textMuted,fontSize:13,cursor:"pointer"}}>↻ Refresh quotes</button>
            </>
          )}
          {!chartData&&!chartLoading&&<div style={{textAlign:"center",color:C.textMuted,padding:"32px 0",fontSize:14}}>Tap a holding above or enter a symbol to see charts</div>}
        </div>
      )}


      {/* ══ REGIME ════════════════════════════════════════════════ */}
      {tab==="regime"&&(
        <div style={{flex:1,overflowY:"auto",padding:16}}>
          <div style={{fontSize:11,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:12}}>Market Regime · Full-sample HMM · VIX + MOVE + iTraxx vol (5Y)</div>
          {!regimeData&&!regimeLoading&&!regimeError&&(
            <button onClick={loadRegime} style={{width:"100%",background:C.goldDim,border:`1px solid ${C.gold}44`,borderRadius:12,padding:18,color:C.goldText,fontSize:15,fontWeight:700,cursor:"pointer"}}>🔴 Run HMM Regime Detection</button>
          )}
          {regimeLoading&&(
            <div style={{textAlign:"center",padding:"48px 0"}}>
              <div style={{fontSize:28,marginBottom:12}}>⏳</div>
              <div style={{color:C.textMuted,fontSize:14,fontWeight:600}}>Fitting HMM model…</div>
              <div style={{color:C.textDim,fontSize:12,marginTop:8,lineHeight:1.6}}>Fetching 5Y of VIX · OVX · XTC5 (Xtrackers iTraxx)<br/>Running Baum-Welch EM (100 iters)<br/>~20 seconds</div>
            </div>
          )}
          {regimeError&&(
            <div style={{background:"#2A1A1A",border:`1px solid ${C.red}44`,borderRadius:12,padding:16,marginBottom:12}}>
              <div style={{color:C.red,fontWeight:600,marginBottom:6}}>❌ Error</div>
              <div style={{color:C.textMuted,fontSize:12,fontFamily:C.mono}}>{regimeError}</div>
              <button onClick={loadRegime} style={{marginTop:12,background:C.surfaceHigh,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 16px",color:C.textMuted,fontSize:13,cursor:"pointer"}}>↻ Retry</button>
            </div>
          )}
          {regimeData&&!regimeLoading&&(()=>{
            const{portfolioIndex,normalStats,stressStats,normalDist,stressDist,currentRegime,currentStressProb,currentVix,stressProbFull,normalDays,stressDays,featureDays,stateMeans,method}=regimeData;
            const isStress=currentRegime===1;
            const stressPct=currentStressProb!==null?(currentStressProb*100).toFixed(1):"—";
            return(<>
              {/* Banner */}
              <div style={{background:isStress?"#2A1A1A":"#1A2A1A",border:`2px solid ${isStress?C.red:C.green}`,borderRadius:14,padding:"14px 18px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:11,color:C.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Current Regime</div>
                  <div style={{fontSize:22,fontWeight:800,color:isStress?C.red:C.green}}>{isStress?"🔴 STRESS":"🟢 NORMAL"}</div>
                  <div style={{fontSize:12,color:C.textMuted,marginTop:4}}>VIX: <Mono style={{color:C.textPrimary}}>{currentVix?.toFixed(1)}</Mono> · MOVE: <Mono style={{color:C.textPrimary}}>{regimeData.currentMove?.toFixed(1)}</Mono> · iTraxx vol: <Mono style={{color:C.textPrimary}}>{regimeData.currentDxstVol?.toFixed(1)}%</Mono> · P(stress): <Mono style={{color:isStress?C.red:C.green}}>{stressPct}%</Mono></div>
                  <div style={{fontSize:11,color:C.textDim,marginTop:3}}>Normal: {normalDays}d · Stress: {stressDays}d (last 1Y)</div>
                </div>
                <svg viewBox="0 0 70 70" style={{width:70,height:70,flexShrink:0,display:"block"}}>
                  <circle cx="35" cy="35" r="28" fill="none" stroke={C.border} strokeWidth="7"/>
                  <circle cx="35" cy="35" r="28" fill="none" stroke={isStress?C.red:C.green} strokeWidth="7"
                    strokeDasharray={`${(currentStressProb||0)*175.9} 175.9`} strokeLinecap="round" transform="rotate(-90 35 35)"/>
                  <text x="35" y="38" textAnchor="middle" style={{fontSize:12,fontWeight:700,fill:isStress?C.red:C.green,fontFamily:C.mono}}>{stressPct}%</text>
                </svg>
              </div>

              {/* Panel 1: Portfolio 1Y with regime shading */}
              {portfolioIndex?.length>0&&(()=>{
                const vals=portfolioIndex.map(p=>p.value);
                const dates=portfolioIndex.map(p=>p.date);
                const regimes=portfolioIndex.map(p=>p.regime);
                const H=160;
                // Build stress segments for shading overlay
                const stressSegs=[];let ss=null;
                regimes.forEach((r,i)=>{
                  if(r===1&&ss===null)ss=i;
                  if(r!==1&&ss!==null){stressSegs.push([ss,i-1]);ss=null;}
                });
                if(ss!==null)stressSegs.push([ss,regimes.length-1]);
                const n=vals.length;
                return(
                  <Card style={{padding:"12px 14px 8px"}}>
                    <div style={{marginBottom:8}}>
                      <div style={{fontSize:13,fontWeight:700}}>Portfolio Value — Last 1Y</div>
                      <div style={{fontSize:10,color:C.textMuted,marginTop:2}}><span style={{color:C.green}}>▬</span> Normal &nbsp;<span style={{color:C.red}}>▬</span> Stress</div>
                    </div>
                    <ExpandableChart title="Portfolio Index" inlineHeight={H}>
                      <div style={{position:"relative",height:H}}>
                        <LineChart values={vals} dates={dates} color={C.gold} id="port_idx" height={H} yFmt={v=>v.toFixed(1)}/>
                        {/* Regime shading overlay — red for stress periods */}
                        <svg viewBox={`0 0 320 ${H}`} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none"}} preserveAspectRatio="xMidYMid meet">
                          {stressSegs.map(([s,e],i)=>(
                            <rect key={i}
                              x={46+(s/Math.max(n-1,1))*266}
                              y={8}
                              width={Math.max(1,((e-s)/Math.max(n-1,1))*266)}
                              height={H-36}
                              fill={C.red} opacity="0.15"/>
                          ))}
                        </svg>
                      </div>
                    </ExpandableChart>
                    <div style={{height:8}}/>
                  </Card>
                );
              })()}

              {/* Panel 2: Stress probability 5Y */}
              {stressProbFull?.length>0&&(()=>{
                return(
                  <Card style={{padding:"12px 14px 8px"}}>
                    <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>Stress Probability P(stress) — Last 1Y</div>
                    <ExpandableChart title="Stress Probability" inlineHeight={110}>
                      <LineChart
                        values={stressProbFull.map(s=>s.prob)}
                        dates={stressProbFull.map(s=>s.date)}
                        color={C.red} id="stress_prob" height={110}
                        showZero={false} yFmt={v=>v.toFixed(2)}
                      />
                    </ExpandableChart>
                    <div style={{height:8}}/>
                  </Card>
                );
              })()}

              {/* Panel 3: Regime stats */}
              {normalStats&&stressStats&&(
                <Card style={{padding:"12px 14px 10px"}}>
                  <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>Regime Statistics — Last 1Y</div>
                  {[
                    {label:"Ann. Return",  n:`${normalStats.annualizedRetPct>=0?"+":""}${normalStats.annualizedRetPct}%`, s:`${stressStats.annualizedRetPct>=0?"+":""}${stressStats.annualizedRetPct}%`},
                    {label:"Ann. Vol",     n:`${normalStats.annualizedVolPct}%`, s:`${stressStats.annualizedVolPct}%`},
                    {label:"Daily Vol",    n:`${normalStats.dailyVolPct}%`,      s:`${stressStats.dailyVolPct}%`},
                    {label:"VaR 95%",      n:normalStats.var95Pct!==null?`${normalStats.var95Pct}%`:"—", s:stressStats.var95Pct!==null?`${stressStats.var95Pct}%`:"—"},
                    {label:"CVaR 95%",     n:normalStats.cvar95Pct!==null?`${normalStats.cvar95Pct}%`:"—", s:stressStats.cvar95Pct!==null?`${stressStats.cvar95Pct}%`:"—"},
                    {label:"Avg Drawdown", n:`${normalStats.avgDrawdownPct}%`,   s:`${stressStats.avgDrawdownPct}%`},
                    {label:"Max Drawdown", n:`${normalStats.maxDrawdownPct}%`,   s:`${stressStats.maxDrawdownPct}%`},
                    {label:"Sharpe",       n:normalStats.sharpe??'—',            s:stressStats.sharpe??'—'},
                    {label:"Days",         n:normalDays,                         s:stressDays},
                  ].map(row=>(
                    <div key={row.label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:`1px solid ${C.border}`}}>
                      <span style={{fontSize:11,color:C.textMuted,width:90}}>{row.label}</span>
                      <Mono style={{fontSize:12,fontWeight:600,color:C.green,width:80,textAlign:"center"}}>{row.n}</Mono>
                      <Mono style={{fontSize:12,fontWeight:600,color:C.red,width:80,textAlign:"center"}}>{row.s}</Mono>
                    </div>
                  ))}
                  <div style={{display:"flex",justifyContent:"space-around",marginTop:8}}>
                    <span style={{fontSize:10,color:C.green,fontWeight:700}}>🟢 NORMAL</span>
                    <span style={{fontSize:10,color:C.red,fontWeight:700}}>🔴 STRESS</span>
                  </div>
                </Card>
              )}

              {/* Panel 4: Distributions */}
              {normalDist?.length>0&&stressDist?.length>0&&(()=>{
                const DistChart=({dist,col,label,stats})=>{
                  if(!dist?.length)return null;
                  const maxC=Math.max(...dist.map(b=>b.count||0),1);
                  const W=260,H=90,P=4,Y=30;
                  const bw=W/dist.length;
                  return(
                    <div style={{background:C.surfaceHigh,border:`1px solid ${col}33`,borderRadius:12,padding:"12px 12px 8px",marginBottom:10}}>
                      <div style={{fontSize:12,fontWeight:700,color:col,marginBottom:6}}>{label}</div>
                      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:8}}>
                        {[{k:"Ann Vol",v:stats?.annualizedVolPct+"%"},{k:"VaR 95",v:stats?.var95Pct+"%"},{k:"CVaR 95",v:stats?.cvar95Pct+"%"},{k:"Avg DD",v:stats?.avgDrawdownPct+"%"},{k:"Sharpe",v:stats?.sharpe??'—'}].map(m=>(
                          <div key={m.k} style={{textAlign:"center"}}>
                            <div style={{fontSize:9,color:C.textMuted,textTransform:"uppercase"}}>{m.k}</div>
                            <Mono style={{fontSize:12,fontWeight:700,color:col}}>{m.v}</Mono>
                          </div>
                        ))}
                      </div>
                      <svg viewBox={`0 0 ${W+Y} ${H}`} style={{width:"100%",height:H,display:"block"}} preserveAspectRatio="xMidYMid meet">
                        {[0,0.5,1].map((p,i)=>{const y=H-P-p*(H-P*2);return(<g key={i}><line x1={Y} y1={y} x2={Y+W} y2={y} stroke={C.border} strokeWidth="1" strokeDasharray="3,3" opacity="0.5"/><text x={Y-3} y={y+3.5} textAnchor="end" style={{fontSize:8,fill:C.textMuted,fontFamily:C.mono}}>{Math.round(maxC*p)}</text></g>);})}
                        <line x1={Y} y1={0} x2={Y} y2={H} stroke={C.border} strokeWidth="1"/>
                        {dist.map((b,i)=>{const h=((b.count||0)/maxC)*(H-P*2);return<rect key={i} x={Y+i*bw+0.5} y={H-P-h} width={Math.max(1,bw-1)} height={h} fill={col} opacity="0.85" rx="1"/>;
                        })}
                      </svg>
                      <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
                        <span style={{fontSize:8,color:C.textDim}}>{dist[0]?.binStart}%</span>
                        <span style={{fontSize:8,color:C.textDim}}>daily return</span>
                        <span style={{fontSize:8,color:C.textDim}}>{dist[dist.length-1]?.binEnd}%</span>
                      </div>
                    </div>
                  );
                };
                return(<>
                  <DistChart dist={normalDist} col={C.green} label={`🟢 Normal — ${normalDays}d (last 1Y)`} stats={normalStats}/>
                  <DistChart dist={stressDist}  col={C.red}   label={`🔴 Stress — ${stressDays}d (last 1Y)`}  stats={stressStats}/>
                </>);
              })()}

              {/* Feature means */}
              {stateMeans&&(
                <Card style={{padding:"12px 14px 10px"}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.textMuted,marginBottom:8}}>Feature means by regime (5Y)</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                    {["VIX","MOVE","DXST_ann_vol(iTraxx)"].map(f=>(
                      <div key={f} style={{background:C.surfaceHigh,borderRadius:8,padding:"8px 10px"}}>
                        <div style={{fontSize:10,color:C.textMuted,marginBottom:4}}>{f}</div>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          <Mono style={{fontSize:11,color:C.green}}>{stateMeans[0]?.[f]??'—'}</Mono>
                          <span style={{fontSize:9,color:C.textDim}}>vs</span>
                          <Mono style={{fontSize:11,color:C.red}}>{stateMeans[1]?.[f]??'—'}</Mono>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              <div style={{fontSize:10,color:C.textDim,padding:"6px 0",lineHeight:1.5}}>{method}</div>
              <button onClick={loadRegime} style={{width:"100%",marginTop:4,background:C.surfaceHigh,border:`1px solid ${C.border}`,borderRadius:10,padding:11,color:C.textMuted,fontSize:13,cursor:"pointer"}}>↻ Re-run model</button>
            </>);
          })()}
        </div>
      )}

      {/* ══ SCHEDULE ══════════════════════════════════════════════ */}
      {tab==="schedule"&&(
        <div style={{flex:1,overflowY:"auto",padding:16}}>
          {pushStatus==="subscribed"?(
            <div style={{background:C.surfaceHigh,border:`1px solid ${C.green}44`,borderRadius:12,padding:"11px 14px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:13,fontWeight:600,color:C.green}}>🔔 Notifications active</div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>fetch(`${BACKEND}/api/push/test`,{method:"POST"})} style={{background:C.goldDim,border:"none",borderRadius:8,padding:"5px 10px",color:C.goldText,fontSize:12,cursor:"pointer"}}>Test</button>
                <button onClick={disablePush} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,padding:"5px 10px",color:C.textMuted,fontSize:12,cursor:"pointer"}}>Off</button>
              </div>
            </div>
          ):<PushBanner/>}
          <div style={{fontSize:11,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Automated tasks (London time)</div>
          <div style={{background:C.surfaceHigh,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",marginBottom:12,fontSize:12,color:C.textMuted,lineHeight:1.5}}>
            ⚠️ Tasks run automatically on Railway. If Railway sleeps between requests, tasks may not fire. Check Railway logs if tasks are missing. You can always run manually below.
          </div>
          {tasks.map(task=>(
            <Card key={task.id}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <span style={{fontSize:16}}>{task.icon}</span>
                    <span style={{fontWeight:600,fontSize:14}}>{task.label}</span>
                    {task.running&&<span style={{fontSize:11,color:C.amber}}>running…</span>}
                  </div>
                  <Mono style={{fontSize:11,color:C.textMuted}}>{task.cronDisplay||task.cron}</Mono>
                  {task.lastRun&&!task.running&&<div style={{fontSize:11,color:C.textDim,marginTop:4}}>Last: {new Date(task.lastRun).toLocaleString()}</div>}
                  {task.lastResult&&<div style={{fontSize:12,color:C.textPrimary,marginTop:8,lineHeight:1.6,whiteSpace:"pre-wrap",borderTop:`1px solid ${C.border}`,paddingTop:8}}>{task.lastResult}</div>}
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0,marginLeft:10}}>
                  <button onClick={()=>runTaskNow(task.id)} disabled={!!runningTask||task.running}
                    style={{background:C.goldDim,border:`1px solid ${C.gold}44`,borderRadius:8,padding:"6px 10px",color:C.goldText,fontSize:12,cursor:"pointer",fontWeight:600,opacity:(runningTask||task.running)?0.5:1}}>
                    {runningTask===task.id?"…":"Run"}
                  </button>
                  <div onClick={()=>toggleTask(task.id,!task.enabled)} style={{width:40,height:22,borderRadius:11,background:task.enabled?C.gold:C.border,cursor:"pointer",position:"relative",flexShrink:0}}>
                    <div style={{position:"absolute",top:3,left:task.enabled?20:3,width:16,height:16,borderRadius:"50%",background:task.enabled?"#0D0F14":C.textMuted,transition:"left 0.2s"}}/>
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {taskLog.length>0&&(
            <>
              <div style={{fontSize:11,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",margin:"14px 0 8px"}}>Run log</div>
              {taskLog.slice(0,8).map((l,i)=>(
                <div key={i} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"9px 12px",marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div><span style={{fontSize:13,fontWeight:600}}>{l.task}</span><Mono style={{fontSize:11,color:C.textMuted,display:"block",marginTop:2}}>{new Date(l.time).toLocaleString()}</Mono></div>
                  <span style={{fontSize:11,fontWeight:600,color:l.status==="done"?C.green:l.status==="error"?C.red:C.amber,textTransform:"uppercase"}}>{l.status}</span>
                </div>
              ))}
            </>
          )}
          <button onClick={()=>{loadTasks();loadLog();}} style={{width:"100%",marginTop:8,background:C.surfaceHigh,border:`1px solid ${C.border}`,borderRadius:10,padding:11,color:C.textMuted,fontSize:14,cursor:"pointer"}}>↻ Refresh</button>
          <button onClick={async()=>{const r=await fetch(`${BACKEND}/api/email/report`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})});const d=await r.json();alert(d.ok?"✅ Email sent!":"❌ "+(d.error||d.reason||"Failed"));}} style={{width:"100%",marginTop:8,background:C.goldDim,border:`1px solid ${C.gold}44`,borderRadius:10,padding:11,color:C.goldText,fontSize:14,cursor:"pointer",fontWeight:600}}>📧 Send Portfolio Report Email Now</button>
        </div>
      )}

      <style>{`input::placeholder{color:#3A4060;}*{-webkit-tap-highlight-color:transparent;}::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:#252A38;border-radius:2px;}`}</style>
    </div>
  );
}
