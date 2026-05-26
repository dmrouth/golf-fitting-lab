import { useState, useEffect, useRef, useCallback } from "react";

const CLUBS = ["4i","5i","6i","7i","8i","9i","PW","GW","SW","LW"];
const STORAGE_KEY = "golf-fitting-lab-v4";

// ── Corrected smash factor ranges (physically realistic, elite ball striker scale)
// Green = elite, Yellow = solid amateur, Red = below threshold
// All other ranges: tour-level benchmarks scaled per club
const CLUB_RANGES = {
  "4i": { smash:[1.38,1.42,1.33,1.38], launchAngle:[14,17,12,19], attackAngle:[-5,-1,-7,1], totalSpin:[4000,5200,3500,5800], offlineSpread:[0,28,28,38], peakHeight:[90,130,70,145], descentAngle:[38,46,34,50] },
  "5i": { smash:[1.37,1.41,1.32,1.37], launchAngle:[15,18,13,20], attackAngle:[-5,-1,-7,1], totalSpin:[4500,5700,4000,6300], offlineSpread:[0,26,26,36], peakHeight:[88,128,68,142], descentAngle:[39,47,35,51] },
  "6i": { smash:[1.35,1.39,1.30,1.35], launchAngle:[16,20,14,22], attackAngle:[-5,-1,-7,1], totalSpin:[5000,6300,4500,6900], offlineSpread:[0,24,24,34], peakHeight:[86,124,66,138], descentAngle:[40,48,36,52] },
  "7i": { smash:[1.33,1.37,1.28,1.33], launchAngle:[18,22,16,24], attackAngle:[-5,-1,-7,1], totalSpin:[5500,6800,5000,7400], offlineSpread:[0,22,22,32], peakHeight:[84,120,64,134], descentAngle:[42,50,38,54] },
  "8i": { smash:[1.30,1.34,1.25,1.30], launchAngle:[20,24,18,26], attackAngle:[-5,-1,-7,1], totalSpin:[6200,7600,5600,8200], offlineSpread:[0,20,20,30], peakHeight:[82,116,62,130], descentAngle:[44,52,40,56] },
  "9i": { smash:[1.27,1.32,1.22,1.27], launchAngle:[22,26,20,28], attackAngle:[-6,-2,-8,0], totalSpin:[7000,8500,6400,9200], offlineSpread:[0,18,18,28], peakHeight:[78,112,58,126], descentAngle:[46,54,42,58] },
  "PW": { smash:[1.24,1.29,1.19,1.24], launchAngle:[24,28,22,30], attackAngle:[-6,-2,-8,0], totalSpin:[8000,9500,7400,10200], offlineSpread:[0,15,15,24], peakHeight:[74,108,54,122], descentAngle:[48,56,44,60] },
  "GW": { smash:[1.22,1.27,1.17,1.22], launchAngle:[26,30,24,32], attackAngle:[-6,-2,-8,0], totalSpin:[8500,10200,7900,11000], offlineSpread:[0,13,13,22], peakHeight:[70,104,50,118], descentAngle:[50,58,46,62] },
  "SW": { smash:[1.18,1.24,1.13,1.18], launchAngle:[28,34,26,36], attackAngle:[-8,-3,-10,0], totalSpin:[9000,11000,8400,12000], offlineSpread:[0,12,12,20], peakHeight:[65,100,45,115], descentAngle:[52,62,48,66] },
  "LW": { smash:[1.15,1.21,1.10,1.15], launchAngle:[30,38,28,42], attackAngle:[-9,-4,-12,0], totalSpin:[9500,12000,9000,13000], offlineSpread:[0,12,12,20], peakHeight:[60,95,40,110], descentAngle:[54,66,50,70] },
};

function getRangeColor(club, metric, value) {
  if (value == null || !CLUB_RANGES[club]?.[metric]) return "#ddeedd";
  const [gMin, gMax, yMin, yMax] = CLUB_RANGES[club][metric];
  const v = metric === "offlineSpread" ? Math.abs(value) : value;
  if (v >= gMin && v <= gMax) return "#4ade80";
  if (v >= yMin && v <= yMax) return "#facc15";
  return "#f87171";
}

// ── Storage with explicit fallback to in-memory only
const memoryStore = { configs: [], sessions: [] };

async function storageLoad() {
  // Try window.storage first
  if (typeof window !== "undefined" && window.storage?.get) {
    try {
      const r = await window.storage.get(STORAGE_KEY);
      if (r?.value) return JSON.parse(r.value);
    } catch(e) { console.warn("window.storage.get failed:", e); }
  }
  // Fallback: return in-memory store
  return { configs: [...memoryStore.configs], sessions: [...memoryStore.sessions] };
}

async function storageSave(data) {
  // Always update in-memory store as source of truth
  memoryStore.configs  = data.configs;
  memoryStore.sessions = data.sessions;
  // Also try window.storage
  if (typeof window !== "undefined" && window.storage?.set) {
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch(e) { console.warn("window.storage.set failed:", e); }
  }
  return false;
}

// ── CSV parser
function parseCSV(text) {
  const shots = [];
  for (const line of text.trim().split("\n")) {
    const c = line.split(",");
    const num = parseInt(c[0]);
    if (isNaN(num) || num < 1) continue;
    const pd = s => {
      if (!s) return null; s = s.trim();
      const m = s.match(/([\d.]+)\s*(L|R|DN|UP|I-O|O-I)?/);
      if (!m) return null;
      const v = parseFloat(m[1]);
      return (m[2]==="L"||m[2]==="DN"||m[2]==="I-O") ? -v : v;
    };
    const ps = s => {
      if (!s) return null; s = s.trim();
      const m = s.match(/([\d.]+)\s*(L|R)?/);
      if (!m) return null;
      return m[2]==="L" ? -parseFloat(m[1]) : parseFloat(m[1]);
    };
    shots.push({
      num,
      carry: parseFloat(c[3])||null, total: parseFloat(c[4])||null,
      peakHeight: parseFloat(c[5])||null, offline: pd(c[6]),
      descentAngle: parseFloat(c[8])||null, hangTime: parseFloat(c[9])||null,
      ballSpeed: parseFloat(c[10])||null, launchAngle: parseFloat(c[11])||null,
      sideSpin: ps(c[13]), backSpin: parseFloat(c[14])||null,
      totalSpin: parseFloat(c[15])||null, spinAxis: ps(c[16]),
      clubSpeed: parseFloat(c[17])||null, smash: parseFloat(c[19])||null,
      attackAngle: pd(c[20]), clubPath: pd(c[21]),
    });
  }
  return shots;
}

// ── Analysis — always trims worst 20%
function analyze(shots) {
  if (!shots.length) return null;
  const scored = [...shots]
    .map(s => ({ ...s, score: (s.smash||1.15) - Math.abs(s.offline||0)*0.01 }))
    .sort((a,b) => b.score - a.score);
  const kept = scored.slice(0, Math.ceil(shots.length * 0.8));
  const avg = k => { const v=kept.map(s=>s[k]).filter(x=>x!=null&&!isNaN(x)); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; };
  const spd = k => { const v=kept.map(s=>s[k]).filter(x=>x!=null&&!isNaN(x)); return v.length ? Math.max(...v)-Math.min(...v) : null; };
  return {
    n: kept.length, nTotal: shots.length,
    carry: avg("carry"), carrySpread: spd("carry"),
    offline: avg("offline"), offlineSpread: spd("offline"),
    smash: avg("smash"), ballSpeed: avg("ballSpeed"), clubSpeed: avg("clubSpeed"),
    launchAngle: avg("launchAngle"), peakHeight: avg("peakHeight"),
    descentAngle: avg("descentAngle"), spinAxis: avg("spinAxis"),
    totalSpin: avg("totalSpin"), backSpin: avg("backSpin"),
    attackAngle: avg("attackAngle"), clubPath: avg("clubPath"), hangTime: avg("hangTime"),
    leftMisses:    kept.filter(s=>(s.offline||0)<-15).length,
    rightMisses:   kept.filter(s=>(s.offline||0)>15).length,
    straightShots: kept.filter(s=>Math.abs(s.offline||0)<=15).length,
  };
}

// ── Claude API
async function callClaude(prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, messages:[{role:"user",content:prompt}] }),
  });
  const d = await r.json();
  return d.content?.[0]?.text || "Analysis unavailable.";
}

// ── Formatters
const f  = (v,d=1) => v==null ? "—" : Number(v).toFixed(d);
const fd = (v,d=1) => v==null ? "—" : Math.abs(v)<0.05 ? "0" : `${Math.abs(v).toFixed(d)}${v<0?"L":"R"}`;
const fa = v => v==null ? "—" : Math.abs(v)<0.05 ? "0°" : `${Math.abs(v).toFixed(1)}° ${v<0?"DN":"UP"}`;

// ── Defaults
const BLANK_CFG = { name:"", club:"8i", head:"", loft:"", lie:"3° Upright", length:'+3/4"', shaft:"", shaftWeight:"", flex:"Stiff", grip:"MCC+4 Midsize", gripSize:"Midsize", swingWeight:"", notes:"" };
const BLANK_SESS = { name:"", configId:"", csvText:"", date:new Date().toISOString().slice(0,10), surface:"Mat", chokeDown:"None" };

// ── Palette
const C = {
  bg:"#030a03", card:"#050d05", accent:"#4ade80", muted:"#2a5a2a", faint:"#0d1a0d",
  text:"#ddeedd", dim:"#2a5a2a", dimmer:"#1a3a1a",
};

export default function App() {
  const [ready,     setReady]     = useState(false);
  const [storageOK, setStorageOK] = useState(null); // null=unknown, true=ok, false=memory-only
  const [configs,   setConfigs]   = useState([]);
  const [sessions,  setSessions]  = useState([]);
  const [tab,       setTab]       = useState("sessions");
  const [sel,       setSel]       = useState([]);
  const [analyzing, setAnalyzing] = useState(null);
  const [cmpAI,     setCmpAI]     = useState("");
  const [newCfg,    setNewCfg]    = useState(BLANK_CFG);
  const [newSess,   setNewSess]   = useState(BLANK_SESS);
  const [err,       setErr]       = useState("");
  const [toast,     setToast]     = useState("");
  const [toastType, setToastType] = useState("ok"); // "ok" | "warn" | "err"
  const timer = useRef(null);

  // Load on mount
  useEffect(() => {
    storageLoad().then(d => {
      setConfigs(d.configs || []);
      setSessions(d.sessions || []);
      setReady(true);
    });
  }, []);

  // Persist on every change after load — explicitly pass current state
  const persist = useCallback(async (nextConfigs, nextSessions) => {
    const ok = await storageSave({ configs: nextConfigs, sessions: nextSessions });
    setStorageOK(ok);
  }, []);

  const pop = (msg, type="ok") => {
    setToast(msg); setToastType(type);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 3000);
  };

  // ── Config actions
  const saveCfg = () => {
    if (!newCfg.name.trim()) { pop("Config name is required", "err"); return; }
    const cfg = { ...newCfg, id: Date.now().toString() };
    const next = [...configs, cfg];
    setConfigs(next);
    persist(next, sessions);
    setNewCfg(BLANK_CFG);
    pop("Configuration saved ✓");
    setTab("configs");
  };

  const delCfg = id => {
    const nextC = configs.filter(c => c.id !== id);
    const nextS = sessions.filter(s => s.configId !== id);
    setConfigs(nextC); setSessions(nextS); setSel(p => p.filter(x => x !== id));
    persist(nextC, nextS);
  };

  // ── Session actions
  const importSess = () => {
    setErr("");
    if (!newSess.name.trim() || !newSess.configId || !newSess.csvText.trim()) {
      setErr("Fill all fields and paste CSV data."); return;
    }
    try {
      const shots = parseCSV(newSess.csvText);
      if (!shots.length) { setErr("No valid shot rows found — check CSV format."); return; }
      const analysis = analyze(shots);
      const sess = { ...newSess, id: Date.now().toString(), shots, analysis, aiAnalysis: null };
      const next = [...sessions, sess];
      setSessions(next);
      persist(configs, next);
      setNewSess(BLANK_SESS);
      pop(`Imported ${shots.length} shots — kept best ${analysis.n} ✓`);
      setTab("sessions");
    } catch(e) { setErr("Parse error: " + e.message); }
  };

  const delSess = id => {
    const next = sessions.filter(s => s.id !== id);
    setSessions(next);
    persist(configs, next);
  };

  // ── AI analysis
  const analyzeSession = async id => {
    const sess = sessions.find(s => s.id === id);
    const cfg  = configs.find(c => c.id === sess?.configId);
    if (!sess || !cfg) return;
    setAnalyzing(id);
    const a = sess.analysis;
    const surfNote  = sess.surface==="Mat" ? "Session hit off a mat — attack angle and spin may read differently vs grass." : "Session hit off grass — real turf interaction reflected.";
    const chokeNote = (sess.chokeDown && sess.chokeDown!=="None") ? `Player choked down ${sess.chokeDown}.` : "Full grip, no choke-down.";
    const prompt = `Expert golf club fitter analyzing a session for Daniel Routh: 6'3.5", wrist-to-floor 39", 13 handicap, early extension, pull-hook miss. Blueprint S irons baseline +1.5" / Modus 105 Stiff.

Config: ${cfg.club} | Lie: ${cfg.lie} | Length: ${cfg.length} | Shaft: ${cfg.shaft} ${cfg.flex} ${cfg.shaftWeight}g | Grip: ${cfg.grip} ${cfg.gripSize} | SW: ${cfg.swingWeight}${cfg.notes?` | Notes: ${cfg.notes}`:""}
Surface: ${sess.surface} | Choke-down: ${sess.chokeDown||"None"}
${surfNote} ${chokeNote}

Stats (worst 20% auto-filtered, ${a.n}/${a.nTotal} shots kept):
Carry: ${f(a.carry)} yds (spread ${f(a.carrySpread)}) | Smash: ${f(a.smash,2)} | Ball: ${f(a.ballSpeed)} mph | Club: ${f(a.clubSpeed)} mph
Launch: ${f(a.launchAngle)}° | Peak: ${f(a.peakHeight)} ft | Descent: ${f(a.descentAngle)}° | Hang: ${f(a.hangTime)}s
Offline avg: ${fd(a.offline)} | Spread: ${f(a.offlineSpread)} yds | Spin Axis: ${fd(a.spinAxis)}°
Spin: ${f(a.totalSpin,0)} total / ${f(a.backSpin,0)} back rpm | AoA: ${fa(a.attackAngle)} | Path: ${fd(a.clubPath)}° I-O
Misses: ${a.leftMisses}L / ${a.straightShots}str / ${a.rightMisses}R

4-5 paragraphs: contact quality, dispersion, face/path relationship, attack angle, whether this config is working. Note surface and choke-down context where relevant. Direct and specific — use the actual numbers.`;
    const text = await callClaude(prompt);
    const next = sessions.map(s => s.id===id ? {...s, aiAnalysis:text} : s);
    setSessions(next);
    persist(configs, next);
    setAnalyzing(null);
  };

  // ── Compare AI
  const runCmpAI = async () => {
    setAnalyzing("cmp"); setCmpAI("");
    const blocks = sel.map(cid => {
      const cfg   = configs.find(c => c.id===cid);
      const slist = sessions.filter(s => s.configId===cid);
      const shots = slist.flatMap(s => s.shots||[]);
      const a     = shots.length ? analyze(shots) : null;
      const surfs  = [...new Set(slist.map(s=>s.surface).filter(Boolean))].join("/") || "unknown";
      const chokes = [...new Set(slist.map(s=>s.chokeDown).filter(x=>x&&x!=="None"))].join(", ") || "none";
      if (!a) return `Config: ${cfg?.name}\nNo data.`;
      return `Config: ${cfg?.name} | Lie: ${cfg?.lie} | Length: ${cfg?.length} | Shaft: ${cfg?.shaft} ${cfg?.flex} | SW: ${cfg?.swingWeight} | Surface: ${surfs} | Choke: ${chokes}
Smash: ${f(a.smash,2)} | Carry: ${f(a.carry)} yds | Offline: ${fd(a.offline)} avg / ${f(a.offlineSpread)} yd spread
AoA: ${fa(a.attackAngle)} | Path: ${fd(a.clubPath)}° | Spin Axis: ${fd(a.spinAxis)}° | Misses: ${a.leftMisses}L/${a.straightShots}str/${a.rightMisses}R`;
    }).join("\n\n");
    const text = await callClaude(`Expert golf fitter comparing configs for Daniel: 6'3.5", WTF 39", 13 hdcp, early extension, pull-hook. Identify which variables drive differences, note surface/choke context. Clear recommendation.\n\n${blocks}\n\n3-4 paragraphs, direct.`);
    setCmpAI(text); setAnalyzing(null);
  };

  const toggleSel = id => setSel(p => p.includes(id) ? p.filter(x=>x!==id) : p.length<3 ? [...p,id] : p);
  const cmpData = sel.map(cid => {
    const cfg   = configs.find(c=>c.id===cid);
    const shots = sessions.filter(s=>s.configId===cid).flatMap(s=>s.shots||[]);
    return { cfg, a: shots.length ? analyze(shots) : null, n: sessions.filter(s=>s.configId===cid).length };
  });

  // ── Shared styles
  const SI = { background:"#071007", border:`1px solid ${C.faint}`, borderRadius:5, color:C.text, padding:"7px 10px", fontSize:13, width:"100%", boxSizing:"border-box", outline:"none" };
  const SL = { color:"#4a7a4a", fontSize:11, marginBottom:3, display:"block", letterSpacing:0.5, textTransform:"uppercase" };
  const SB = { background:C.accent, border:"none", color:C.bg, borderRadius:5, padding:"9px 22px", fontSize:13, fontWeight:700, cursor:"pointer" };
  const SBO= { background:"none", border:`1px solid ${C.muted}`, color:C.accent, borderRadius:5, padding:"6px 14px", fontSize:12, cursor:"pointer" };
  const SCd= { border:`1px solid ${C.faint}`, borderRadius:8, padding:"14px 16px", marginBottom:10, background:C.card };
  const tb = active => ({ background:"none", border:"none", borderBottom:`2px solid ${active?C.accent:"transparent"}`, color:active?C.accent:C.muted, padding:"8px 14px", fontSize:13, fontWeight:active?700:400, cursor:"pointer", fontFamily:"Georgia,serif" });

  // ── Color-coded stat row
  const StatRow = ({label, val, color="#ddeedd", sub=""}) => (
    <div style={{borderBottom:`1px solid ${C.faint}`,padding:"5px 0"}}>
      <div style={{color:"#3a6a3a",fontSize:11}}>{label}</div>
      <div style={{color, fontSize:13, fontFamily:"monospace", fontWeight:color!=="#ddeedd"?600:400}}>
        {val}{sub && <span style={{color:"#2a4a2a",fontSize:11,fontWeight:400}}> {sub}</span>}
      </div>
    </div>
  );

  const StatGrid = ({a, club}) => {
    if (!a) return null;
    const rc = (metric, val) => getRangeColor(club||"8i", metric, val);
    return (
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 14px",marginTop:10}}>
        <StatRow label="Carry"        val={`${f(a.carry)} yds`}       sub={`±${f((a.carrySpread||0)/2)} spread`}/>
        <StatRow label="Offline Avg"  val={fd(a.offline)}             sub={`${f(a.offlineSpread)} yd spread`} color={rc("offlineSpread",a.offlineSpread)}/>
        <StatRow label="Smash Factor" val={f(a.smash,2)}              color={rc("smash",a.smash)}/>
        <StatRow label="Ball Speed"   val={`${f(a.ballSpeed)} mph`}/>
        <StatRow label="Club Speed"   val={`${f(a.clubSpeed)} mph`}/>
        <StatRow label="Launch Angle" val={`${f(a.launchAngle)}°`}    color={rc("launchAngle",a.launchAngle)}/>
        <StatRow label="Peak Height"  val={`${f(a.peakHeight)} ft`}   color={rc("peakHeight",a.peakHeight)}/>
        <StatRow label="Descent Angle"val={`${f(a.descentAngle)}°`}   color={rc("descentAngle",a.descentAngle)}/>
        <StatRow label="Attack Angle" val={fa(a.attackAngle)}         color={rc("attackAngle",a.attackAngle)}/>
        <StatRow label="Club Path"    val={`${fd(a.clubPath)}° I-O`}/>
        <StatRow label="Spin Axis"    val={`${fd(a.spinAxis)}°`}/>
        <StatRow label="Total Spin"   val={`${f(a.totalSpin,0)} rpm`} color={rc("totalSpin",a.totalSpin)}/>
        <StatRow label="Miss Pattern" val={`${a.leftMisses}L / ${a.straightShots}str / ${a.rightMisses}R`}/>
        <StatRow label="Shots Kept"   val={`${a.n} / ${a.nTotal}`}    sub="(worst 20% removed)"/>
      </div>
    );
  };

  const Legend = () => (
    <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:12,flexWrap:"wrap"}}>
      <span style={{color:C.muted,fontSize:10,letterSpacing:1}}>RANGE:</span>
      {[["#4ade80","Optimal"],["#facc15","Near"],["#f87171","Outside"]].map(([clr,lbl])=>(
        <span key={lbl} style={{display:"flex",alignItems:"center",gap:5}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:clr,display:"inline-block"}}/>
          <span style={{color:clr,fontSize:11}}>{lbl}</span>
        </span>
      ))}
    </div>
  );

  const Badge = ({children}) => (
    <span style={{background:"#0a1a0a",color:"#3a7a3a",fontSize:10,padding:"2px 8px",borderRadius:3,border:`1px solid ${C.faint}`}}>{children}</span>
  );

  const toastColor = toastType==="err" ? "#f87171" : toastType==="warn" ? "#facc15" : C.accent;

  if (!ready) return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:C.dimmer,fontFamily:"Georgia,serif"}}>
      Loading…
    </div>
  );

  return (
    <div style={{background:C.bg,minHeight:"100vh",color:C.text,fontFamily:"Georgia,serif",maxWidth:880,margin:"0 auto",padding:"20px 14px"}}>

      {/* Toast */}
      {toast && (
        <div style={{position:"fixed",top:14,right:14,background:"#071407",border:`1px solid ${toastColor}`,color:toastColor,padding:"8px 16px",borderRadius:6,fontSize:13,zIndex:999,boxShadow:"0 4px 20px rgba(0,0,0,0.6)",maxWidth:300}}>
          {toast}
        </div>
      )}

      {/* Storage warning banner */}
      {storageOK === false && (
        <div style={{background:"#1a0e00",border:"1px solid #7a5a00",borderRadius:6,padding:"8px 14px",marginBottom:14,fontSize:12,color:"#facc15"}}>
          ⚠ Persistent storage unavailable — data is saved in-memory this session only. Refreshing will clear it.
        </div>
      )}

      {/* Header */}
      <div style={{marginBottom:22}}>
        <div style={{fontSize:10,letterSpacing:4,color:"#1a4a1a",marginBottom:2}}>DANIEL ROUTH · DFW</div>
        <h1 style={{margin:0,fontSize:26,fontWeight:900,color:C.text,letterSpacing:-0.5}}>Club Fitting Lab</h1>
        <div style={{color:C.dimmer,fontSize:12,marginTop:3}}>Track variables · Import sessions · Isolate what works · Worst 20% auto-filtered</div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",borderBottom:`1px solid ${C.faint}`,marginBottom:22,flexWrap:"wrap"}}>
        {[["sessions",`Sessions (${sessions.length})`],["configs",`Configs (${configs.length})`],["compare","Compare"],["add-config","+ Config"],["add-session","+ Session"]].map(([k,l])=>(
          <button key={k} style={tb(tab===k)} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {/* ── SESSIONS */}
      {tab==="sessions" && (
        <div>
          {!sessions.length && <div style={{color:"#0e2a0e",fontSize:14,padding:"50px 0",textAlign:"center"}}>No sessions yet — create a config first, then import a session.</div>}
          {sessions.map(sess => {
            const cfg = configs.find(c=>c.id===sess.configId);
            return (
              <div key={sess.id} style={SCd}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{flex:1}}>
                    <div style={{color:C.text,fontWeight:700,fontSize:15}}>{sess.name}</div>
                    <div style={{color:C.dim,fontSize:12,marginTop:2}}>{cfg?.name||"Unknown config"} · {sess.date}</div>
                    <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
                      <Badge>{sess.surface||"Mat"}</Badge>
                      <Badge>Choke: {sess.chokeDown||"None"}</Badge>
                      {sess.analysis && <Badge>{sess.analysis.nTotal} shots → {sess.analysis.n} kept</Badge>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center",marginLeft:8}}>
                    <button onClick={()=>analyzeSession(sess.id)} disabled={!!analyzing} style={SBO}>
                      {analyzing===sess.id ? "Analyzing…" : "AI Analysis"}
                    </button>
                    <button onClick={()=>delSess(sess.id)} style={{background:"none",border:"none",color:C.dimmer,cursor:"pointer",fontSize:20,lineHeight:1}}>×</button>
                  </div>
                </div>
                {sess.analysis && <><Legend/><StatGrid a={sess.analysis} club={cfg?.club}/></>}
                {sess.aiAnalysis && (
                  <div style={{marginTop:14,padding:"12px 14px",background:C.bg,borderRadius:6,border:`1px solid ${C.faint}`}}>
                    <div style={{color:C.muted,fontSize:10,letterSpacing:2,marginBottom:8}}>AI ANALYSIS</div>
                    <div style={{color:"#8ab58a",fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{sess.aiAnalysis}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── CONFIGS */}
      {tab==="configs" && (
        <div>
          <div style={{color:C.dimmer,fontSize:12,marginBottom:14}}>Select up to 3 to compare</div>
          {!configs.length && <div style={{color:"#0e2a0e",fontSize:14,padding:"50px 0",textAlign:"center"}}>No configurations yet.</div>}
          {configs.map(cfg => {
            const active = sel.includes(cfg.id);
            return (
              <div key={cfg.id} onClick={()=>toggleSel(cfg.id)} style={{...SCd,border:`2px solid ${active?C.accent:C.faint}`,background:active?"#061206":C.card,cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <div>
                    <div style={{color:C.text,fontWeight:700}}>{cfg.name}</div>
                    <div style={{color:C.dim,fontSize:12,marginTop:3}}>{cfg.club} · Lie {cfg.lie} · Length {cfg.length}</div>
                    <div style={{color:C.dimmer,fontSize:11,marginTop:2}}>{cfg.shaft} {cfg.flex} · SW {cfg.swingWeight} · {sessions.filter(s=>s.configId===cfg.id).length} session(s)</div>
                    {cfg.notes && <div style={{color:"#0e2a0e",fontSize:11,marginTop:2}}>{cfg.notes}</div>}
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    {active && <Badge>✓</Badge>}
                    <button onClick={e=>{e.stopPropagation();delCfg(cfg.id);}} style={{background:"none",border:"none",color:C.dimmer,cursor:"pointer",fontSize:20,lineHeight:1}}>×</button>
                  </div>
                </div>
              </div>
            );
          })}
          {sel.length>=2 && <button onClick={()=>setTab("compare")} style={{...SB,width:"100%",marginTop:8}}>Compare {sel.length} Selected →</button>}
        </div>
      )}

      {/* ── COMPARE */}
      {tab==="compare" && (
        <div>
          {sel.length<2 && <div style={{color:C.dimmer,fontSize:14}}>Select 2–3 configurations from the Configs tab.</div>}
          {cmpData.length>=2 && (
            <>
              <Legend/>
              <div style={{display:"grid",gridTemplateColumns:`140px repeat(${cmpData.length},1fr)`,gap:4,marginBottom:14}}>
                <div/>
                {cmpData.map(({cfg,n})=>(
                  <div key={cfg.id} style={{background:"#071007",borderRadius:6,padding:"8px 10px"}}>
                    <div style={{color:C.accent,fontWeight:700,fontSize:13}}>{cfg.name}</div>
                    <div style={{color:C.muted,fontSize:10,marginTop:2}}>{cfg.lie} · {cfg.length}</div>
                    <div style={{color:C.dimmer,fontSize:10}}>{n} session(s)</div>
                  </div>
                ))}
              </div>
              {[
                {label:"Carry",         metric:null,            fn:a=>`${f(a.carry)} yds`},
                {label:"Carry Spread",  metric:null,            fn:a=>`${f(a.carrySpread)} yds`},
                {label:"Offline Avg",   metric:null,            fn:a=>fd(a.offline)},
                {label:"Offline Spread",metric:"offlineSpread", fn:a=>`${f(a.offlineSpread)} yds`},
                {label:"Smash Factor",  metric:"smash",         fn:a=>f(a.smash,2)},
                {label:"Ball Speed",    metric:null,            fn:a=>`${f(a.ballSpeed)} mph`},
                {label:"Club Speed",    metric:null,            fn:a=>`${f(a.clubSpeed)} mph`},
                {label:"Launch Angle",  metric:"launchAngle",   fn:a=>`${f(a.launchAngle)}°`},
                {label:"Peak Height",   metric:"peakHeight",    fn:a=>`${f(a.peakHeight)} ft`},
                {label:"Descent Angle", metric:"descentAngle",  fn:a=>`${f(a.descentAngle)}°`},
                {label:"Attack Angle",  metric:"attackAngle",   fn:a=>fa(a.attackAngle)},
                {label:"Club Path",     metric:null,            fn:a=>`${fd(a.clubPath)}°`},
                {label:"Spin Axis",     metric:null,            fn:a=>`${fd(a.spinAxis)}°`},
                {label:"Total Spin",    metric:"totalSpin",     fn:a=>`${f(a.totalSpin,0)} rpm`},
                {label:"Left Misses",   metric:null,            fn:a=>a.leftMisses},
                {label:"Right Misses",  metric:null,            fn:a=>a.rightMisses},
                {label:"Straight",      metric:null,            fn:a=>a.straightShots},
              ].map(row=>(
                <div key={row.label} style={{display:"grid",gridTemplateColumns:`140px repeat(${cmpData.length},1fr)`,borderBottom:`1px solid ${C.faint}`,padding:"4px 0"}}>
                  <span style={{color:C.dim,fontSize:11,display:"flex",alignItems:"center"}}>{row.label}</span>
                  {cmpData.map(({cfg,a})=>{
                    const color = (a&&row.metric) ? getRangeColor(cfg.club,row.metric,a[row.metric]) : C.text;
                    return <span key={cfg.id} style={{color,fontSize:13,fontFamily:"monospace",padding:"0 10px",fontWeight:color!==C.text?600:400}}>{a?row.fn(a):"—"}</span>;
                  })}
                </div>
              ))}
              <button onClick={runCmpAI} disabled={!!analyzing} style={{...SB,width:"100%",marginTop:18}}>
                {analyzing==="cmp" ? "Analyzing…" : "Get AI Comparison"}
              </button>
              {cmpAI && (
                <div style={{marginTop:14,padding:"14px 16px",background:C.bg,borderRadius:6,border:`1px solid ${C.faint}`}}>
                  <div style={{color:C.muted,fontSize:10,letterSpacing:2,marginBottom:8}}>AI COMPARISON</div>
                  <div style={{color:"#8ab58a",fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{cmpAI}</div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── ADD CONFIG */}
      {tab==="add-config" && (
        <div style={{maxWidth:560}}>
          <div style={{color:C.muted,fontSize:11,letterSpacing:2,marginBottom:16}}>NEW CONFIGURATION</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {[
              {k:"name",        l:"Config Name *",    ph:'e.g. 8i — 3° Upright +3/4"', full:true},
              {k:"club",        l:"Club",             type:"sel", opts:CLUBS},
              {k:"head",        l:"Head / Model",     ph:"Ping Blueprint S"},
              {k:"loft",        l:"Loft (°)",         ph:"37"},
              {k:"lie",         l:"Lie Angle",        ph:"3° Upright"},
              {k:"length",      l:"Length",           ph:'+3/4"'},
              {k:"shaft",       l:"Shaft",            ph:"Modus 105"},
              {k:"shaftWeight", l:"Shaft Weight (g)", ph:"105"},
              {k:"flex",        l:"Flex",             ph:"Stiff"},
              {k:"grip",        l:"Grip",             ph:"MCC+4 Midsize"},
              {k:"gripSize",    l:"Grip Size",        ph:"Midsize"},
              {k:"swingWeight", l:"Swing Weight",     ph:"E2"},
              {k:"notes",       l:"Notes",            ph:"Other variables, context…", full:true},
            ].map(fi=>(
              <div key={fi.k} style={{gridColumn:fi.full?"1 / -1":"auto"}}>
                <label style={SL}>{fi.l}</label>
                {fi.type==="sel"
                  ? <select value={newCfg[fi.k]} onChange={e=>setNewCfg({...newCfg,[fi.k]:e.target.value})} style={SI}>
                      {fi.opts.map(o=><option key={o}>{o}</option>)}
                    </select>
                  : <input value={newCfg[fi.k]} onChange={e=>setNewCfg({...newCfg,[fi.k]:e.target.value})} placeholder={fi.ph} style={SI}/>
                }
              </div>
            ))}
          </div>
          <button onClick={saveCfg} style={{...SB,marginTop:18}}>Save Configuration</button>
        </div>
      )}

      {/* ── ADD SESSION */}
      {tab==="add-session" && (
        <div style={{maxWidth:680}}>
          <div style={{color:C.muted,fontSize:11,letterSpacing:2,marginBottom:16}}>IMPORT SESSION</div>
          {!configs.length && <div style={{color:"#f87171",fontSize:13,marginBottom:12}}>Create a configuration first.</div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div>
              <label style={SL}>Session Name *</label>
              <input value={newSess.name} onChange={e=>setNewSess({...newSess,name:e.target.value})} placeholder="e.g. 8i Session 1 — Range" style={SI}/>
            </div>
            <div>
              <label style={SL}>Date</label>
              <input type="date" value={newSess.date} onChange={e=>setNewSess({...newSess,date:e.target.value})} style={SI}/>
            </div>
            <div style={{gridColumn:"1 / -1"}}>
              <label style={SL}>Configuration *</label>
              <select value={newSess.configId} onChange={e=>setNewSess({...newSess,configId:e.target.value})} style={SI}>
                <option value="">Select a configuration…</option>
                {configs.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={SL}>Hitting Surface</label>
              <select value={newSess.surface} onChange={e=>setNewSess({...newSess,surface:e.target.value})} style={SI}>
                <option>Mat</option>
                <option>Grass</option>
              </select>
            </div>
            <div>
              <label style={SL}>Choke-Down</label>
              <select value={newSess.chokeDown} onChange={e=>setNewSess({...newSess,chokeDown:e.target.value})} style={SI}>
                <option>None</option>
                <option>1/4"</option>
                <option>1/2"</option>
                <option>3/4"</option>
                <option>1"</option>
                <option>1.5"</option>
                <option>2"</option>
              </select>
            </div>
            <div style={{gridColumn:"1 / -1"}}>
              <label style={SL}>Paste CSV Data * — worst 20% auto-removed on import</label>
              <textarea value={newSess.csvText} onChange={e=>setNewSess({...newSess,csvText:e.target.value})}
                placeholder="Paste the full CSV export from your launch monitor here…" rows={10}
                style={{...SI,resize:"vertical",fontFamily:"monospace",fontSize:11,lineHeight:1.4}}/>
            </div>
          </div>
          {err && <div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <button onClick={importSess} style={SB}>Import Session</button>
        </div>
      )}

    </div>
  );
}
