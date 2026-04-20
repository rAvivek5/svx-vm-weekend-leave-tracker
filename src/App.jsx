import React, { useState, useEffect, useCallback, useRef, createContext, useContext, memo } from "react";

const API_URL = "https://script.google.com/macros/s/AKfycbxTifB8XW136_ge84vlknQFOGqJhJDwGgFk-mkr_E9YeH5NthZRz8lWjNRx2RvnEHdK/exec";

async function api(action, params = {}, body = null) {
  const u = new URL(API_URL);
  u.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const opts = body ? { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "text/plain" }, redirect: "follow" } : { redirect: "follow" };
  const res = await fetch(u.toString(), opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error("Invalid response"); }
}

// PDF.js on demand
let pdfjsLoading = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfjsLoading) return pdfjsLoading;
  pdfjsLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error("Failed to load PDF.js"));
    document.head.appendChild(s);
  });
  return pdfjsLoading;
}

// ═══════════════════════════════════════════════════════════════
// DATE ENGINE
// ═══════════════════════════════════════════════════════════════
const MO=["January","February","March","April","May","June","July","August","September","October","November","December"];
const MS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DN=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DA=["Su","Mo","Tu","We","Th","Fr","Sa"];
const CY=new Date().getFullYear(),CM=new Date().getMonth();
const YEARS=[CY,CY+1,CY+2];
const MONTH_MAP={jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11};

function ymd(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function pYMD(s){const[y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d);}
function fmtRpt(s){const d=pYMD(s);return`${String(d.getDate()).padStart(2,"0")}-${MS[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;}
function fmtShort(s){const d=pYMD(s);return`${d.getDate()} ${MS[d.getMonth()]}`;}
function fmtLong(d){return`${d.getDate()} ${MS[d.getMonth()]} ${d.getFullYear()}`;}
function isWE(s){const w=pYMD(s).getDay();return w===0||w===6;}
function dow(s){return pYMD(s).getDay();}
function getPeriod(m,y){const pm=m===0?11:m-1,py=m===0?y-1:y;return{start:new Date(py,pm,16),end:new Date(y,m,15)};}
function periodDays(m,y){const{start,end}=getPeriod(m,y);const o=[];const c=new Date(start);while(c<=end){o.push(ymd(c));c.setDate(c.getDate()+1);}return o;}
function uniq(a){return Array.from(new Set(a)).sort();}
function initials(n){return(n||"?").split(" ").map(w=>w[0]).join("").toUpperCase();}

// DD-MMM-YYYY ↔ YYYY-MM-DD
function dmyToYmd(s){const m=s.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);if(!m)return"";const mi=MS.indexOf(m[2]);return`${m[3]}-${String(mi+1).padStart(2,"0")}-${m[1]}`;}
function ymdToDmy(s){const d=pYMD(s);return`${String(d.getDate()).padStart(2,"0")}-${MS[d.getMonth()]}-${d.getFullYear()}`;}

// ═══════════════════════════════════════════════════════════════
// PDF EXTRACTION — split into Public / Optional / Weekend sections
// Uses section headers as strict boundaries:
//   - "Public Holidays" begins the public section
//   - "Optional Holidays" begins the optional section
//   - "Holidays Falling on Weekends" ends optional (and is itself ignored)
// ═══════════════════════════════════════════════════════════════
function extractSections(text) {
  const lower = text.toLowerCase();
  const pubMatch = lower.search(/public\s+holidays?/);
  const optMatch = lower.search(/optional\s+holidays?/);
  const weMatch  = lower.search(/holidays\s+falling\s+on\s+weekends?/);

  // Public section: from "Public Holidays" heading to start of Optional (or Weekend if no Optional)
  let publicText = "";
  if (pubMatch >= 0) {
    let pubEnd = text.length;
    if (optMatch > pubMatch) pubEnd = optMatch;
    else if (weMatch > pubMatch) pubEnd = weMatch;
    publicText = text.substring(pubMatch, pubEnd);
  }

  // Optional section: from "Optional Holidays" heading to start of Weekend (or end)
  let optionalText = "";
  if (optMatch >= 0) {
    const optEnd = weMatch > optMatch ? weMatch : text.length;
    optionalText = text.substring(optMatch, optEnd);
  }

  // Weekend-only holidays are intentionally dropped entirely
  return { publicText, optionalText };
}

function extractDatesFromText(text) {
  const found = new Set();
  const add = (y, m, d) => {
    if (m < 0 || m > 11 || d < 1 || d > 31 || y < 2020 || y > 2100) return;
    const dt = new Date(y, m, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return;
    found.add(`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`);
  };

  // DD-MMM-YYYY (primary format in this PDF: "01-Jan-2026")
  const p1 = /\b(\d{1,2})[\s\-\/.]+([A-Za-z]{3,9})[\s\-\/.,]+(\d{4})\b/g;
  let m;
  while ((m = p1.exec(text)) !== null) {
    const mo = MONTH_MAP[m[2].toLowerCase()];
    if (mo !== undefined) add(parseInt(m[3]), mo, parseInt(m[1]));
  }
  // DD/MM/YYYY
  const p2 = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/g;
  while ((m = p2.exec(text)) !== null) {
    add(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  }
  // Month DD, YYYY
  const p3 = /\b([A-Za-z]+)[\s,]+(\d{1,2})[\s,]+(\d{4})\b/g;
  while ((m = p3.exec(text)) !== null) {
    const mo = MONTH_MAP[m[1].toLowerCase()];
    if (mo !== undefined) add(parseInt(m[3]), mo, parseInt(m[2]));
  }

  return Array.from(found).sort();
}

async function extractCategorizedHolidays(file) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let allText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    allText += content.items.map(it => it.str).join(" ") + "\n";
  }
  const { publicText, optionalText } = extractSections(allText);
  return {
    publicHolidays: extractDatesFromText(publicText),
    optionalHolidays: extractDatesFromText(optionalText),
  };
}

// ═══════════════════════════════════════════════════════════════
// THEMES
// ═══════════════════════════════════════════════════════════════
const dark={bg:"#07070c",s1:"#0d0d16",card:"#141422",hover:"#1b1b30",bd:"#20203a",bdHi:"#2c2c4c",tx:"#e6e6f4",sub:"#8585a8",dim:"#50506e",faint:"#2a2a44",ac:"#887cf8",acS:"rgba(136,124,248,0.10)",acB:"rgba(136,124,248,0.25)",acT:"#bbb2ff",ok:"#36d6a0",okS:"rgba(54,214,160,0.08)",okB:"rgba(54,214,160,0.25)",err:"#f97087",errS:"rgba(249,112,135,0.07)",errB:"rgba(249,112,135,0.20)",info:"#5eaafc",infoS:"rgba(94,170,252,0.07)",infoB:"rgba(94,170,252,0.20)",warn:"#fbc02d",warnS:"rgba(251,192,45,0.07)",warnB:"rgba(251,192,45,0.25)",cyan:"#20d4e8"};
const light={bg:"#f5f5fa",s1:"#e8e8f0",card:"#ffffff",hover:"#f0f0f8",bd:"#d0d0e0",bdHi:"#b8b8d0",tx:"#1a1a2e",sub:"#5a5a78",dim:"#8888a0",faint:"#c8c8d8",ac:"#6c5ce7",acS:"rgba(108,92,231,0.08)",acB:"rgba(108,92,231,0.20)",acT:"#5a4bd4",ok:"#00b894",okS:"rgba(0,184,148,0.08)",okB:"rgba(0,184,148,0.20)",err:"#e17055",errS:"rgba(225,112,85,0.06)",errB:"rgba(225,112,85,0.18)",info:"#0984e3",infoS:"rgba(9,132,227,0.06)",infoB:"rgba(9,132,227,0.18)",warn:"#e67e22",warnS:"rgba(230,126,34,0.06)",warnB:"rgba(230,126,34,0.25)",cyan:"#00b4d8"};
const ThemeCtx=createContext(dark);
function useTheme(){return useContext(ThemeCtx);}

function buildCSS(t){return`
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:${t.bg};color:${t.tx};font-family:'Outfit',system-ui,sans-serif}
input,select,button,textarea{font-family:inherit;color:${t.tx}}
input,textarea{background:${t.s1};border:1px solid ${t.bd};color:${t.tx}}
select{background:${t.s1};border:1px solid ${t.bd};color:${t.tx};-webkit-appearance:menulist;appearance:menulist}
select option{background:${t.card};color:${t.tx}}
input::placeholder{color:${t.dim}}
input:focus,select:focus{outline:none;border-color:${t.ac}}
button{background:none;border:none;cursor:pointer}
@keyframes fadeIn{from{opacity:0;transform:translateY(0.25rem)}to{opacity:1;transform:translateY(0)}}
@keyframes slideIn{from{opacity:0;transform:translateX(0.75rem)}to{opacity:1;transform:translateX(0)}}
@keyframes loading{0%,100%{opacity:1}50%{opacity:.3}}
::selection{background:${t.ac}30}
input[type="date"]::-webkit-calendar-picker-indicator{filter:${t===dark?"invert(.6)":"none"}}
::-webkit-scrollbar{height:0.3rem;width:0.3rem}
::-webkit-scrollbar-track{background:${t.s1}}
::-webkit-scrollbar-thumb{background:${t.bdHi};border-radius:0.15rem}
`;}

// ═══════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════
export default function App(){
  const[mode,setMode]=useState(()=>{try{return localStorage.getItem("svx_theme")||"dark";}catch{return"dark";}});
  const t=mode==="dark"?dark:light;
  useEffect(()=>{try{localStorage.setItem("svx_theme",mode);}catch{}},[mode]);

  const[scr,setScr]=useState("login");
  const[user,setUser]=useState(null);
  const[emps,setEmps]=useState([]);
  const[subs,setSubs]=useState({});
  const[period,setPeriod]=useState({month:CM,year:CY});
  const[open,setOpen]=useState(true);
  const[publicH,setPublicH]=useState([]);
  const[optionalH,setOptionalH]=useState([]);
  const[toast,setToast]=useState(null);
  const[busy,setBusy]=useState(false);
  const[err,setErr]=useState(null);
  const seq=useRef(0);

  const flash=(m,tp="ok")=>{setToast({m,t:tp});setTimeout(()=>setToast(null),3000);};
  const toggle=()=>setMode(m=>m==="dark"?"light":"dark");

  const load=useCallback(async fp=>{
    const id=++seq.current;setBusy(true);setErr(null);
    try{
      const st=await api("getSettings");if(id!==seq.current)return;
      const per=fp||st?.period||{month:CM,year:CY};setPeriod(per);setOpen(st?.open!==false);
      const[eR,subR,hR]=await Promise.all([
        api("getEmployees"),
        api("getSubmissions",{month:per.month,year:per.year}),
        api("getHolidays")
      ]);
      if(id!==seq.current)return;
      if(eR?.employees)setEmps(eR.employees);
      if(subR?.submissions)setSubs(subR.submissions);else setSubs({});
      setPublicH(hR?.publicHolidays||[]);
      setOptionalH(hR?.optionalHolidays||[]);
    }catch(e){if(id===seq.current)setErr(e.message||"Load failed");}
    if(id===seq.current)setBusy(false);
  },[]);

  const reloadSubs=useCallback(async()=>{setBusy(true);try{const r=await api("getSubmissions",{month:period.month,year:period.year});if(r?.submissions)setSubs(r.submissions);}catch{}setBusy(false);},[period.month,period.year]);
  const reloadEmps=useCallback(async()=>{setBusy(true);try{const r=await api("getEmployees");if(r?.employees)setEmps(r.employees);}catch{}setBusy(false);},[]);
  const reloadHolidays=useCallback(async()=>{try{const r=await api("getHolidays");setPublicH(r?.publicHolidays||[]);setOptionalH(r?.optionalHolidays||[]);}catch{}},[]);

  useEffect(()=>{if(scr!=="login"&&scr!=="manage"&&scr!=="holidays")load();},[scr,load]);

  const onSubmit=async(ek,data)=>{
    if(!open){flash("Entries closed","err");return;}
    if((data.weekendWork||[]).length>0&&!data.mailSent){flash("Mail to PM required","err");return;}
    setBusy(true);
    try{
      const r=await api("submit",{},{...data,month:period.month,year:period.year});
      if(r?.error){flash(r.error,"err");setBusy(false);return;}
      await reloadSubs();flash("Saved");
    }catch{flash("Submit failed","err");}
    setBusy(false);
  };
  const onReset=async()=>{setBusy(true);try{await api("reset",{},{month:period.month,year:period.year});await reloadSubs();flash("Reset","warn");}catch{flash("Failed","err");}setBusy(false);};
  const onSetPeriod=async np=>{setPeriod(np);setBusy(true);try{await api("setSettings",{},{period:np,open});const r=await api("getSubmissions",{month:np.month,year:np.year});if(r?.submissions)setSubs(r.submissions);else setSubs({});}catch{flash("Failed","err");}setBusy(false);};
  const onSetOpen=async v=>{setOpen(v);try{await api("setSettings",{},{period,open:v});}catch{};};

  const roster=emps.filter(e=>e.fullTime),extended=emps.filter(e=>!e.fullTime);
  const managers=[...new Set(emps.filter(e=>e.reportingManager).map(e=>e.reportingManager))].sort();

  return(
    <ThemeCtx.Provider value={t}>
      <div style={{fontFamily:"'Outfit',system-ui,sans-serif",background:t.bg,color:t.tx,minHeight:"100vh",transition:"background .3s,color .3s"}}>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>
        <style>{buildCSS(t)}</style>
        {toast&&<Toast m={toast.m} tp={toast.t}/>}
        {busy&&<div style={{position:"fixed",top:0,left:0,right:0,height:"0.15rem",background:`linear-gradient(90deg,transparent,${t.ac},transparent)`,animation:"loading .8s infinite",zIndex:9999}}/>}
        <div style={{maxWidth:"65rem",margin:"0 auto",padding:"0 1.25rem 3rem"}}>
          {scr==="login"&&<LoginPage onIn={(u,a)=>{setUser(u);setScr(a?"admin":"emp");}} toggle={toggle} mode={mode}/>}
          {scr!=="login"&&err&&<ErrorBox msg={err} onRetry={()=>load()}/>}
          {scr==="emp"&&!err&&<EmpPage user={user} subs={subs} period={period} open={open} publicH={publicH} optionalH={optionalH} onSubmit={onSubmit} onOut={()=>{setScr("login");setUser(null);}} toggle={toggle} mode={mode}/>}
          {scr==="admin"&&!err&&<AdminPage emps={emps} roster={roster} extended={extended} managers={managers} subs={subs} period={period} setPeriod={onSetPeriod} open={open} setOpen={onSetOpen} onReset={onReset} onOut={()=>{setScr("login");setUser(null);}} toggle={toggle} mode={mode} adminName={user?.name||"Admin"} publicH={publicH} optionalH={optionalH} onManage={()=>setScr("manage")} onHolidays={()=>setScr("holidays")}/>}
          {scr==="manage"&&!err&&<ManagePage emps={emps} onBack={()=>{reloadEmps();setScr("admin");}} flash={flash} toggle={toggle} mode={mode}/>}
          {scr==="holidays"&&!err&&<HolidaysPage publicH={publicH} optionalH={optionalH} onBack={()=>{reloadHolidays();setScr("admin");}} flash={flash} toggle={toggle} mode={mode}/>}
        </div>
      </div>
    </ThemeCtx.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════
// ATOMS
// ═══════════════════════════════════════════════════════════════
function Toast({m,tp}){const t=useTheme();const c=tp==="ok"?t.ok:tp==="err"?t.err:t.warn;return<div style={{position:"fixed",top:"1rem",right:"1rem",zIndex:9999,padding:"0.625rem 1.25rem",borderRadius:"0.625rem",background:t.card,border:`1px solid ${c}40`,color:c,fontSize:"0.8125rem",fontWeight:700,backdropFilter:"blur(1rem)",animation:"slideIn .2s ease",boxShadow:"0 0.25rem 1.5rem rgba(0,0,0,.25)"}}>{tp==="ok"?"✓":tp==="err"?"✕":"⚠"} {m}</div>;}
function ErrorBox({msg,onRetry}){const t=useTheme();return<div style={{margin:"4rem auto",maxWidth:"24rem",textAlign:"center",animation:"fadeIn .3s ease"}}><div style={{fontSize:"2.25rem",marginBottom:"0.625rem",opacity:.4}}>⚠</div><p style={{color:t.err,fontWeight:600,fontSize:"0.875rem",marginBottom:"1rem",lineHeight:1.5}}>{msg}</p><Btn primary onClick={onRetry}>Retry</Btn></div>;}
function ThemeBtn({toggle,mode}){const t=useTheme();return<button onClick={toggle} style={{padding:"0.35rem 0.7rem",borderRadius:"0.4rem",background:t.s1,border:`1px solid ${t.bd}`,color:t.sub,fontSize:"0.75rem",fontWeight:600,cursor:"pointer"}}>{mode==="dark"?"☀ Light":"🌙 Dark"}</button>;}
function Lbl({children}){const t=useTheme();return<label style={{display:"block",fontSize:"0.625rem",color:t.sub,marginBottom:"0.3rem",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em"}}>{children}</label>;}
function Inp({value,set,ph,type="text",disabled,onEnter}){const t=useTheme();return<input value={value} onChange={e=>set(e.target.value)} onKeyDown={e=>e.key==="Enter"&&onEnter&&onEnter()} type={type} placeholder={ph} disabled={disabled} style={{width:"100%",padding:"0.65rem 0.875rem",borderRadius:"0.5rem",fontSize:"0.875rem",opacity:disabled?.5:1,background:t.s1,border:`1px solid ${t.bd}`,color:t.tx}}/>;}
function Sel({value,onChange,children,style:sx,disabled}){const t=useTheme();return<select value={value} onChange={onChange} disabled={disabled} style={{width:"100%",padding:"0.6rem 0.75rem",borderRadius:"0.5rem",fontSize:"0.8125rem",background:t.s1,border:`1px solid ${t.bd}`,color:t.tx,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.5:1,...sx}}>{children}</select>;}
function Btn({children,onClick,primary,danger,small,muted,disabled,style:sx}){const t=useTheme();let bg="transparent",c=t.sub,bd=t.bd;if(primary){bg=`linear-gradient(135deg,${t.ac},${t.acT})`;c="#fff";bd="transparent";}if(danger){bg=t.errS;c=t.err;bd=t.errB;}if(muted)c=t.dim;return<button onClick={onClick} disabled={disabled} style={{padding:small?"0.35rem 0.7rem":"0.6rem 1.25rem",background:bg,color:c,border:`1px solid ${bd}`,borderRadius:small?"0.4rem":"0.625rem",fontSize:small?"0.6875rem":"0.8125rem",fontWeight:700,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.35:1,transition:"all .12s",lineHeight:1.3,...sx}}>{children}</button>;}
function Card({children,style:sx}){const t=useTheme();return<div style={{background:t.card,border:`1px solid ${t.bd}`,borderRadius:"0.75rem",padding:"1rem 1.15rem",marginBottom:"0.625rem",animation:"fadeIn .25s ease",...sx}}>{children}</div>;}

function TopBar({label,userName,period,onOut,toggle,mode,extra}){
  const t=useTheme();
  return<div style={{display:"flex",alignItems:"center",gap:"0.625rem",padding:"1rem 0 0.8rem",marginBottom:"0.5rem",borderBottom:`1px solid ${t.bd}`,flexWrap:"wrap"}}>
    <div style={{width:"2rem",height:"2rem",borderRadius:"0.5rem",background:t.acS,border:`1px solid ${t.acB}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.6875rem",fontWeight:800,color:t.acT,fontFamily:"'JetBrains Mono'",flexShrink:0}}>{initials(userName)}</div>
    <div style={{lineHeight:1.2,minWidth:0}}><div style={{fontWeight:700,fontSize:"0.8125rem",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{userName}</div><div style={{fontSize:"0.5625rem",color:t.dim,fontWeight:600,textTransform:"uppercase"}}>{label}</div></div>
    {period&&<span style={{padding:"0.2rem 0.625rem",borderRadius:"0.875rem",background:t.acS,border:`1px solid ${t.acB}`,fontSize:"0.6875rem",fontWeight:700,color:t.acT,whiteSpace:"nowrap"}}>{MO[period.month]} {period.year}</span>}
    {extra}
    <div style={{marginLeft:"auto",display:"flex",gap:"0.375rem",flexShrink:0}}>
      <ThemeBtn toggle={toggle} mode={mode}/>
      <Btn small muted onClick={onOut}>Sign out</Btn>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════
function LoginPage({onIn,toggle,mode}){
  const t=useTheme();
  const[tab,setTab]=useState("emp");
  const[email,setEmail]=useState("");const[au,setAu]=useState("");const[ap,setAp]=useState("");
  const[error,setError]=useState("");const[ld,setLd]=useState(false);

  const goEmp=async()=>{const e=email.trim().toLowerCase();if(!e){setError("Enter your email");return;}setLd(true);setError("");try{const r=await api("login",{type:"employee",email:e});r?.success?onIn(r,false):setError(r?.error||"Login failed");}catch{setError("Network error");}setLd(false);};
  const goAdm=async()=>{if(!au.trim()||!ap){setError("Fill all fields");return;}setLd(true);setError("");try{const r=await api("login",{type:"admin",username:au.trim().toLowerCase(),password:ap});r?.success?onIn({name:r.name,code:null},true):setError(r?.error||"Login failed");}catch{setError("Network error");}setLd(false);};

  return(
    <div style={{maxWidth:"25rem",margin:"0 auto",paddingTop:"6vh",animation:"fadeIn .4s ease"}}>
      <div style={{textAlign:"center",marginBottom:"2rem"}}>
        <div style={{display:"inline-flex",width:"3.25rem",height:"3.25rem",borderRadius:"0.875rem",background:t.acS,border:`1px solid ${t.acB}`,alignItems:"center",justifyContent:"center",marginBottom:"0.875rem"}}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={t.acT} strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <h1 style={{fontSize:"1.5rem",fontWeight:800,letterSpacing:"-0.03em",marginBottom:"0.15rem"}}>SVX Pune</h1>
        <p style={{fontSize:"0.6875rem",color:t.sub,letterSpacing:"0.12em",fontWeight:600,textTransform:"uppercase"}}>Weekend & Leave Tracker</p>
      </div>
      <div style={{position:"absolute",top:"1rem",right:"1rem"}}><ThemeBtn toggle={toggle} mode={mode}/></div>
      <div style={{background:t.card,border:`1px solid ${t.bd}`,borderRadius:"0.875rem",overflow:"hidden"}}>
        <div style={{display:"flex",borderBottom:`1px solid ${t.bd}`}}>
          {[["emp","Employee"],["adm","Admin"]].map(([k,l])=>
            <button key={k} onClick={()=>{setTab(k);setError("");}} style={{flex:1,padding:"0.75rem 0",borderBottom:tab===k?`2px solid ${t.ac}`:"2px solid transparent",color:tab===k?t.acT:t.dim,fontSize:"0.6875rem",fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em"}}>{l}</button>
          )}
        </div>
        <div style={{padding:"1.5rem 1.375rem"}}>
          {tab==="emp"?<>
            <Lbl>Email address</Lbl>
            <Inp value={email} set={v=>{setEmail(v);setError("");}} ph="firstname.lastname@nice.com" type="email" disabled={ld} onEnter={goEmp}/>
            <p style={{fontSize:"0.625rem",color:t.dim,marginTop:"0.375rem"}}>No password required</p>
          </>:<>
            <Lbl>Username</Lbl><Inp value={au} set={v=>{setAu(v);setError("");}} ph="Admin username" disabled={ld} onEnter={goAdm}/>
            <div style={{height:"0.75rem"}}/>
            <Lbl>Password</Lbl><Inp value={ap} set={v=>{setAp(v);setError("");}} ph="Admin password" type="password" disabled={ld} onEnter={goAdm}/>
          </>}
          {error&&<div style={{marginTop:"0.625rem",padding:"0.5rem 0.75rem",borderRadius:"0.5rem",background:t.errS,border:`1px solid ${t.errB}`,color:t.err,fontSize:"0.75rem",fontWeight:600}}>{error}</div>}
          <button onClick={tab==="emp"?goEmp:goAdm} disabled={ld} style={{marginTop:"1rem",width:"100%",padding:"0.75rem",background:ld?t.dim:`linear-gradient(135deg,${t.ac},${t.acT})`,color:"#fff",border:"none",borderRadius:"0.625rem",fontSize:"0.875rem",fontWeight:700,cursor:ld?"wait":"pointer"}}>{ld?"Signing in…":tab==="adm"?"Sign in as admin":"Continue"}</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE PAGE — dropdown-based leaves, categorized holidays
// ═══════════════════════════════════════════════════════════════
function EmpPage({user,subs,period,open,publicH,optionalH,onSubmit,onOut,toggle,mode}){
  const t=useTheme();const{month,year}=period;
  const days=periodDays(month,year);
  const publicSet=new Set(publicH);
  // Optional holidays are treated as regular weekdays — don't filter them
  // Only public holidays are blocked from leaves
  const weekdays=days.filter(d=>!isWE(d)); // all weekdays (incl. optional, excl. weekends)
  // Weekends that are NOT public holidays — if a weekend date is also a public holiday
  // it must ONLY appear in the public holiday section, never in weekend work.
  const weekends=days.filter(d=>isWE(d)&&!publicSet.has(d));
  const periodPublicHolidays=days.filter(d=>publicSet.has(d));

  const{start,end}=getPeriod(month,year);
  const ek=String(user.code||user.name),sk=`${ek}_${month}_${year}`,ex=subs[sk];

  // Leave state: map of date → "none" | "half" | "full"
  const[leaveMap,setLeaveMap]=useState({});
  const[ww,setWW]=useState([]);const[wwH,setWwH]=useState({});
  const[hw,setHw]=useState([]);const[hwH,setHwH]=useState({}); // holiday hours: date → "WS" | "OC"
  const[mail,setMail]=useState(false);
  const[error,setError]=useState("");const[editing,setEditing]=useState(false);

  // Build leave map from backend separate arrays
  useEffect(()=>{
    if(ex){
      const map={};
      (ex.leavesFull||[]).forEach(d=>{map[d]="full";});
      (ex.leavesHalf||[]).forEach(d=>{map[d]="half";});
      setLeaveMap(map);
      setWW(uniq(ex.weekendWork||[]));
      setHw(uniq(ex.holidayWork||[]));
      setWwH(ex.wwHours||{});
      setHwH(ex.hwHours||{});
      setMail(ex.mailSent||false);
      setEditing(false);
    }else{
      setLeaveMap({});setWW([]);setHw([]);setWwH({});setHwH({});setMail(false);setEditing(true);
    }
    setError("");
  },[sk,JSON.stringify(ex?.at)]);

  const formOn=editing||!ex;

  // ═══ CLICK CYCLE HANDLERS ═══
  // Leave cycle: none → full → half → none
  const cycleLeave=d=>{
    setLeaveMap(prev=>{
      const cur=prev[d]||"none";
      const next={...prev};
      if(cur==="none") next[d]="full";
      else if(cur==="full") next[d]="half";
      else delete next[d]; // half → none
      return next;
    });
  };

  // Weekend cycle: none → WS (half) → OC (full) → none
  // ww[] holds selected dates; wwH{} holds per-date hours ("WS" or "OC")
  const cycleWeekend=d=>{
    const curH=wwH[d]; // undefined if not selected
    setWW(prev=>{
      const inList=prev.includes(d);
      if(!inList) return uniq([...prev,d]); // add (none → WS)
      if(curH==="OC") return prev.filter(x=>x!==d); // OC → none, remove
      return prev; // WS → OC (stays in list)
    });
    setWwH(prev=>{
      const next={...prev};
      if(!curH) next[d]="WS"; // none → WS
      else if(curH==="WS") next[d]="OC"; // WS → OC
      else delete next[d]; // OC → none
      return next;
    });
  };

  // Holiday cycle: none → OC (full, = shift code) → WS (half) → none
  // Default full day so the employee's shift is applied in the report without extra clicks.
  const cycleHoliday=d=>{
    const curH=hwH[d];
    setHw(prev=>{
      const inList=prev.includes(d);
      if(!inList) return uniq([...prev,d]); // none → OC, add
      if(curH==="WS") return prev.filter(x=>x!==d); // WS → none, remove
      return prev; // OC → WS, stays in list
    });
    setHwH(prev=>{
      const next={...prev};
      if(!curH) next[d]="OC"; // none → OC (full day)
      else if(curH==="OC") next[d]="WS"; // OC → WS
      else delete next[d]; // WS → none
      return next;
    });
  };

  const leavesFull=Object.keys(leaveMap).filter(d=>leaveMap[d]==="full");
  const leavesHalf=Object.keys(leaveMap).filter(d=>leaveMap[d]==="half");

  const save=empty=>{
    if(!empty&&ww.length>0&&!mail){setError("Confirm mail to PM");return;}
    onSubmit(ek,{
      empCode:ek,empName:user.name,
      leavesFull:empty?[]:uniq(leavesFull),
      leavesHalf:empty?[]:uniq(leavesHalf),
      weekendWork:empty?[]:uniq(ww),
      holidayWork:empty?[]:uniq(hw),
      wwHours:empty?{}:wwH,
      hwHours:empty?{}:hwH,
      mailSent:empty?true:mail
    });
    setEditing(false);
  };

  return<div>
    <TopBar label={[user.code&&`#${user.code}`,user.empRole,user.reportingManager&&`RM: ${user.reportingManager}`].filter(Boolean).join(" · ")} userName={user.name} period={period} onOut={onOut} toggle={toggle} mode={mode}/>
    <div style={{margin:"0.375rem 0 0.625rem",padding:"0.5rem 0.875rem",borderRadius:"0.5rem",background:`${t.cyan}0c`,border:`1px solid ${t.cyan}18`,color:t.cyan,fontSize:"0.6875rem",fontWeight:600}}>
      {fmtLong(start)} — {fmtLong(end)}
      {!open&&<span style={{color:t.err,marginLeft:"0.5rem"}}>· Entries closed</span>}
      {periodPublicHolidays.length>0&&<span style={{marginLeft:"0.5rem",opacity:.7}}>· {periodPublicHolidays.length} public holiday{periodPublicHolidays.length!==1?"s":""}</span>}
    </div>

    {ex&&!editing&&(()=>{
      // Merge full+half leaves into one sorted list with markers
      const leaveEntries=[
        ...(ex.leavesFull||[]).map(d=>({d,kind:"Full"})),
        ...(ex.leavesHalf||[]).map(d=>({d,kind:"Half"}))
      ].sort((a,b)=>a.d.localeCompare(b.d));
      const leaveStr=leaveEntries.length?leaveEntries.map(e=>`${fmtShort(e.d)} (${e.kind})`).join(", "):"None";
      const lTotal=fmtDays((ex.leavesFull||[]).length,(ex.leavesHalf||[]).length);

      const wwList=(ex.weekendWork||[]).slice().sort();
      const wwFull=wwList.filter(d=>(ex.wwHours||{})[d]==="OC").length;
      const wwHalf=wwList.filter(d=>(ex.wwHours||{})[d]==="WS").length;
      const wwStr=wwList.length?wwList.map(d=>`${fmtShort(d)} (${(ex.wwHours||{})[d]==="OC"?"Full":"Half"})`).join(", "):"None";
      const wTotal=fmtDays(wwFull,wwHalf);

      const hwList=(ex.holidayWork||[]).slice().sort();
      const hwFull=hwList.filter(d=>(ex.hwHours||{})[d]==="OC").length;
      const hwHalf=hwList.filter(d=>(ex.hwHours||{})[d]==="WS").length;
      const hwStr=hwList.length?hwList.map(d=>`${fmtShort(d)} (${(ex.hwHours||{})[d]==="OC"?"Full":"Half"})`).join(", "):"None";
      const hTotal=fmtDays(hwFull,hwHalf);

      return <Card style={{background:t.okS,border:`1px solid ${t.okB}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:"0.75rem",flexWrap:"wrap",marginBottom:"0.625rem"}}>
          <div style={{color:t.ok,fontWeight:700,fontSize:"0.9375rem"}}>Submitted</div>
          {open&&<Btn small onClick={()=>setEditing(true)} style={{color:t.acT,borderColor:t.acB,flexShrink:0}}>Edit</Btn>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"auto 1fr auto",gap:"0.4rem 0.875rem",fontSize:"0.75rem",color:t.sub,alignItems:"baseline"}}>
          <span style={{fontWeight:600,color:t.tx}}>Leaves taken</span>
          <span>{leaveStr}</span>
          <span style={{color:t.err,fontWeight:700,fontFamily:"'JetBrains Mono'",fontSize:"0.6875rem",whiteSpace:"nowrap"}}>{lTotal}</span>

          <span style={{fontWeight:600,color:t.tx}}>Weekend work</span>
          <span>{wwStr}</span>
          <span style={{color:t.info,fontWeight:700,fontFamily:"'JetBrains Mono'",fontSize:"0.6875rem",whiteSpace:"nowrap"}}>{wTotal}</span>

          <span style={{fontWeight:600,color:t.tx}}>Work on public holidays</span>
          <span>{hwStr}</span>
          <span style={{color:t.warn,fontWeight:700,fontFamily:"'JetBrains Mono'",fontSize:"0.6875rem",whiteSpace:"nowrap"}}>{hTotal}</span>
        </div>
      </Card>;
    })()}

    {formOn&&open?<>
      {editing&&ex&&<div style={{padding:"0.4rem 0.875rem",borderRadius:"0.5rem",background:t.acS,border:`1px solid ${t.acB}`,color:t.acT,fontSize:"0.6875rem",fontWeight:600,marginBottom:"0.5rem"}}>Editing — update and save</div>}
      {error&&<div style={{margin:"0.375rem 0",padding:"0.4rem 0.875rem",borderRadius:"0.5rem",background:t.errS,border:`1px solid ${t.errB}`,color:t.err,fontSize:"0.75rem",fontWeight:600}}>{error}</div>}

      {/* LEAVES — click to cycle: none → full → half → none */}
      <Card>
        <SectionHeader icon="L" color={t.err} colorS={t.errS} colorB={t.errB} title="Leave days" countText={fmtDays(leavesFull.length,leavesHalf.length)}/>
        <LeaveGrid dates={weekdays} publicSet={publicSet} leaveMap={leaveMap} onClick={cycleLeave}/>
      </Card>

      {/* WEEKEND — click to cycle: none → half → full → none */}
      <Card>
        <SectionHeader icon="W" color={t.info} colorS={t.infoS} colorB={t.infoB} title="Weekend work" countText={fmtDays(ww.filter(d=>wwH[d]==="OC").length,ww.filter(d=>wwH[d]==="WS").length)}/>
        <div style={{padding:"0.625rem 0.875rem",borderRadius:"0.5625rem",background:mail?t.okS:t.s1,border:`1px solid ${mail?t.okB:t.bd}`,transition:"all .2s",marginBottom:"0.75rem"}}>
          <label style={{display:"flex",alignItems:"center",gap:"0.625rem",cursor:"pointer",fontSize:"0.8125rem",fontWeight:700,color:mail?t.ok:t.sub}}>
            <input type="checkbox" checked={mail} onChange={e=>setMail(e.target.checked)} style={{width:"1.05rem",height:"1.05rem",accentColor:t.ok,cursor:"pointer"}}/>
            I confirm mail has been sent to PM
            {mail&&<span style={{marginLeft:"auto",fontSize:"0.5625rem",fontWeight:800,textTransform:"uppercase",color:t.ok}}>Confirmed</span>}
          </label>
        </div>
        <div style={{opacity:mail?1:.2,pointerEvents:mail?"auto":"none",transition:"opacity .2s"}}>
          <WorkGrid dates={weekends} sel={ww} hours={wwH} onClick={cycleWeekend} c={t.info} cS={t.infoS} cB={t.infoB}/>
        </div>
      </Card>

      {/* HOLIDAY WORK — click to cycle: none → full → half → none (starts at full = shift code) */}
      {periodPublicHolidays.length>0&&<Card>
        <SectionHeader icon="H" color={t.warn} colorS={t.warnS} colorB={t.warnB} title="Work on public holidays" countText={fmtDays(hw.filter(d=>hwH[d]==="OC").length,hw.filter(d=>hwH[d]==="WS").length)}/>
        <WorkGrid dates={periodPublicHolidays} sel={hw} hours={hwH} onClick={cycleHoliday} c={t.warn} cS={t.warnS} cB={t.warnB}/>
      </Card>}

      <div style={{display:"flex",gap:"0.625rem",flexWrap:"wrap",marginTop:"0.375rem"}}>
        <Btn primary onClick={()=>save(false)}>{ex?"Update":"Save"} & submit</Btn>
        <Btn onClick={()=>save(true)}>No leaves / no weekend</Btn>
        {editing&&ex&&<Btn muted small onClick={()=>setEditing(false)}>Cancel</Btn>}
      </div>
    </>:null}
  </div>;
}

function SectionHeader({icon,color,colorS,colorB,title,countText}){
  const t=useTheme();
  return<div style={{display:"flex",alignItems:"center",gap:"0.625rem",marginBottom:"0.75rem"}}>
    <div style={{width:"1.875rem",height:"1.875rem",borderRadius:"0.5rem",background:colorS,border:`1px solid ${colorB}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.875rem",fontWeight:800,color:color,fontFamily:"'JetBrains Mono'",flexShrink:0}}>{icon}</div>
    <span style={{fontWeight:700,fontSize:"0.875rem",flex:1}}>{title}</span>
    <span style={{fontSize:"0.6875rem",color:t.sub,fontWeight:600}}>{countText}</span>
  </div>;
}

// Format day count as half-aware: full=1, half=0.5 → "1.5 days" or "0.5 day"
function fmtDays(full,half){
  const total=full+half*0.5;
  if(total===0) return "0 days";
  const str=total%1===0?String(total):total.toFixed(1);
  return `${str} ${total===1?"day":"days"}`;
}

// ═══════════════════════════════════════════════════════════════
// CLICK-BASED GRIDS (no dropdowns)
// Each cell is memoized so clicking one date doesn't re-render others.
// ═══════════════════════════════════════════════════════════════

// Leave cell — cycle: none → full → half → none. Public holidays are disabled.
const LeaveCell=React.memo(function LeaveCell({date,state,isPublic,onClick}){
  const t=useTheme();
  const dt=pYMD(date);
  const isFull=state==="full", isHalf=state==="half";
  let bg="transparent", bd=t.bd, fg=t.sub, label="";
  if(isPublic){ bg=t.warnS; bd=t.warnB; fg=t.warn; }
  else if(isFull){ bg=t.errS; bd=t.err; fg=t.err; label="F"; }
  else if(isHalf){ bg=t.errS+"40"; bd=t.errB; fg=t.err; label="½"; }
  return<button onClick={isPublic?undefined:()=>onClick(date)} disabled={isPublic}
    style={{padding:"0.55rem 0.25rem",borderRadius:"0.5rem",fontSize:"0.6875rem",fontWeight:700,
      border:`1.5px solid ${bd}`,background:bg,color:fg,fontFamily:"'JetBrains Mono'",textAlign:"center",
      transition:"all .1s",lineHeight:1.3,position:"relative",cursor:isPublic?"not-allowed":"pointer",
      opacity:isPublic?.6:1}}>
    {dt.getDate()} {MS[dt.getMonth()]}<br/>
    <span style={{fontSize:"0.5625rem",opacity:.7,fontWeight:500}}>{isPublic?"HOL":DA[dt.getDay()]}</span>
    {label&&<span style={{position:"absolute",top:"0.2rem",right:"0.3rem",fontSize:"0.6875rem",fontWeight:800,lineHeight:1}}>{label}</span>}
  </button>;
});

function LeaveGrid({dates,publicSet,leaveMap,onClick}){
  const cols=Math.min(Math.ceil(dates.length/2),9);
  return<div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:"0.4rem"}}>
    {dates.map(d=><LeaveCell key={d} date={d} state={leaveMap[d]||"none"} isPublic={publicSet.has(d)} onClick={onClick}/>)}
  </div>;
}

// Work cell (weekend OR holiday) — cycle: none → WS (half) → OC (full) → none
const WorkCell=React.memo(function WorkCell({date,hours,onClick,c,cS,cB}){
  const t=useTheme();
  const dt=pYMD(date);
  const isFull=hours==="OC", isHalf=hours==="WS";
  let bg="transparent", bd=t.bd, fg=t.sub, label="";
  if(isFull){ bg=cS; bd=c; fg=c; label="F"; }
  else if(isHalf){ bg=cS+"60"; bd=cB; fg=c; label="½"; }
  return<button onClick={()=>onClick(date)}
    style={{padding:"0.55rem 0.25rem",borderRadius:"0.5rem",fontSize:"0.6875rem",fontWeight:700,
      border:`1.5px solid ${bd}`,background:bg,color:fg,fontFamily:"'JetBrains Mono'",textAlign:"center",
      transition:"all .1s",lineHeight:1.3,position:"relative",cursor:"pointer"}}>
    {dt.getDate()} {MS[dt.getMonth()]}<br/>
    <span style={{fontSize:"0.5625rem",opacity:.7,fontWeight:500}}>{DA[dt.getDay()]}</span>
    {label&&<span style={{position:"absolute",top:"0.2rem",right:"0.3rem",fontSize:"0.6875rem",fontWeight:800,lineHeight:1}}>{label}</span>}
  </button>;
});

function WorkGrid({dates,sel,hours,onClick,c,cS,cB}){
  if(dates.length===0) return <p style={{fontSize:"0.75rem",color:"#888",fontStyle:"italic",textAlign:"center",padding:"0.5rem"}}>No dates in this period</p>;
  const cols=Math.min(Math.ceil(dates.length/2),7);
  return<div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:"0.4rem"}}>
    {dates.map(d=><WorkCell key={d} date={d} hours={hours[d]} onClick={onClick} c={c} cS={cS} cB={cB}/>)}
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// ADMIN PAGE
// ═══════════════════════════════════════════════════════════════
function AdminPage({emps,roster,extended,managers,subs,period,setPeriod,open,setOpen,onReset,onOut,toggle,mode,adminName,publicH,optionalH,onManage,onHolidays}){
  const t=useTheme();const{month,year}=period;
  const[expOpen,setExpOpen]=useState(false);
  const[pvM,setPvM]=useState(month);const[pvY,setPvY]=useState(year);
  const[pvSubs,setPvSubs]=useState(subs);const[pvLoading,setPvLoading]=useState(false);
  useEffect(()=>{setPvM(month);setPvY(year);setPvSubs(subs);},[month,year,subs]);
  const loadPreview=async(m,y)=>{if(m===month&&y===year){setPvSubs(subs);return;}setPvLoading(true);try{const r=await api("getSubmissions",{month:m,year:y});if(r?.submissions)setPvSubs(r.submissions);else setPvSubs({});}catch{setPvSubs({});}setPvLoading(false);};

  const days=periodDays(month,year),pvDays=periodDays(pvM,pvY);
  const publicSet=new Set(publicH);
  const getSub=emp=>subs[`${String(emp.code||emp.name)}_${month}_${year}`];
  const rc=roster.filter(e=>getSub(e)).length,ec=extended.filter(e=>getSub(e)).length;
  let tl=0,tw=0,th=0;
  emps.forEach(e=>{const s=getSub(e);if(s){tl+=(s.leavesFull||[]).length+(s.leavesHalf||[]).length;tw+=(s.weekendWork||[]).length;th+=(s.holidayWork||[]).length;}});

  function buildCSV(list){
    let csv="Name,Employee Code,"+days.map(fmtRpt).join(",")+"\n";
    csv+=",,"+days.map(d=>DN[dow(d)]).join(",")+"\n";
    list.forEach(emp=>{
      const s=getSub(emp);
      const fullSet=new Set(s?s.leavesFull:[]);
      const halfSet=new Set(s?s.leavesHalf:[]);
      const ws=new Set(s?s.weekendWork:[]);
      const hws=new Set(s?s.holidayWork:[]);
      const wh=s?(s.wwHours||{}):{};
      const sh=emp.shift||""; // blank if sheet has no shift — no hardcoded default
      csv+=`"${emp.name}",${emp.code||""},${days.map(d=>{
        if(isWE(d)) return ws.has(d)?(wh[d]||"OC"):"WO";
        if(publicSet.has(d)) return hws.has(d)?sh:"";
        if(fullSet.has(d)) return "";
        // halfSet OR no leave → shift (half-day shows shift per requirement)
        return sh;
      }).join(",")}\n`;
    });
    return csv;
  }
  const dl=(csv,nm)=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=nm;a.click();};
  const pre=`shift_type_roster_${MS[month]}${year}_SVX_Pune_Team`;

  return<div>
    <TopBar label="ADMIN" userName={adminName} period={period} onOut={onOut} toggle={toggle} mode={mode}
      extra={<div style={{display:"flex",gap:"0.375rem"}}>
        <Btn small primary onClick={onManage} style={{fontSize:"0.6875rem"}}>Manage Employees</Btn>
        <Btn small onClick={onHolidays} style={{fontSize:"0.6875rem",color:t.warn,borderColor:t.warnB,background:t.warnS}}>Holidays ({publicH.length}+{optionalH.length})</Btn>
      </div>}
    />

    <Card>
      <div style={{fontSize:"0.8125rem",fontWeight:700,marginBottom:"0.75rem"}}>Controls</div>
      <div style={{display:"flex",gap:"0.75rem",alignItems:"flex-end",flexWrap:"wrap"}}>
        <div style={{flex:"1 1 8rem"}}><Lbl>Month</Lbl><Sel value={month} onChange={e=>setPeriod({...period,month:+e.target.value})}>{MO.map((m,i)=><option key={i} value={i}>{m}</option>)}</Sel></div>
        <div style={{flex:"1 1 6rem"}}><Lbl>Year</Lbl><Sel value={year} onChange={e=>setPeriod({...period,year:+e.target.value})}>{YEARS.map(y=><option key={y} value={y}>{y}</option>)}</Sel></div>
        <label style={{display:"flex",alignItems:"center",gap:"0.4rem",padding:"0.5rem 0.875rem",borderRadius:"0.5rem",cursor:"pointer",fontSize:"0.75rem",fontWeight:700,background:open?t.okS:t.errS,border:`1px solid ${open?t.okB:t.errB}`,color:open?t.ok:t.err,whiteSpace:"nowrap"}}>
          <input type="checkbox" checked={open} onChange={e=>setOpen(e.target.checked)} style={{accentColor:t.ok,width:"0.9rem",height:"0.9rem"}}/>{open?"Open":"Closed"}
        </label>
      </div>
    </Card>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(8rem,1fr))",gap:"0.5rem",marginBottom:"0.625rem"}}>
      {[["Roster",`${rc}/${roster.length}`,t.ac],["Extended",`${ec}/${extended.length}`,t.cyan],["Leaves",tl,t.err],["Weekend",tw,t.info],["Holiday",th,t.warn]].map(([l,v,c])=>
        <div key={l} style={{background:t.card,border:`1px solid ${t.bd}`,borderRadius:"0.625rem",padding:"0.625rem 0.875rem"}}>
          <div style={{fontSize:"0.5625rem",color:t.dim,textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:700}}>{l}</div>
          <div style={{fontSize:"1.375rem",fontWeight:800,color:c,fontFamily:"'JetBrains Mono'",marginTop:"0.125rem"}}>{v}</div>
        </div>)}
    </div>

    <Card>
      <div style={{display:"flex",gap:"0.5rem",flexWrap:"wrap",alignItems:"center"}}>
        <div style={{position:"relative"}}>
          <Btn primary onClick={()=>setExpOpen(!expOpen)}>Export reports ▾</Btn>
          {expOpen&&<div style={{position:"absolute",top:"110%",left:0,zIndex:100,background:t.card,border:`1px solid ${t.bdHi}`,borderRadius:"0.625rem",padding:"0.375rem 0",minWidth:"17.5rem",boxShadow:"0 0.375rem 1.5rem rgba(0,0,0,.3)"}} onMouseLeave={()=>setExpOpen(false)}>
            <DDBtn onClick={()=>{dl(buildCSV(emps),`shift_type_roster_${MS[month]}${year}_whole_SVX_Pune_Team.csv`);setExpOpen(false);}}>Full team (all)</DDBtn>
            <DDBtn onClick={()=>{dl(buildCSV(roster),`${pre} - FullTime.csv`);setExpOpen(false);}}>Full-time only</DDBtn>
            <div style={{height:"1px",background:t.bd,margin:"0.25rem 0"}}/>
            <div style={{padding:"0.25rem 0.875rem",fontSize:"0.5625rem",color:t.dim,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em"}}>By manager (full-time)</div>
            {managers.map(m=><DDBtn key={m} onClick={()=>{dl(buildCSV(emps.filter(e=>e.reportingManager===m&&e.fullTime)),`${pre} - ${m}.csv`);setExpOpen(false);}}>{m}</DDBtn>)}
            {!managers.length&&<div style={{padding:"0.375rem 0.875rem",fontSize:"0.6875rem",color:t.dim,fontStyle:"italic"}}>No managers</div>}
          </div>}
        </div>
        <Btn danger onClick={()=>{if(confirm(`Reset ALL for ${MO[month]} ${year}?`))onReset();}}>Reset month</Btn>
      </div>
    </Card>

    <Card><div style={{fontWeight:700,fontSize:"0.8125rem",marginBottom:"0.5rem"}}>Roster ({roster.length})</div><DataTable list={roster} getSub={getSub} showCode/></Card>
    <Card><div style={{fontWeight:700,fontSize:"0.8125rem",marginBottom:"0.5rem"}}>Extended ({extended.length})</div><DataTable list={extended} getSub={getSub}/></Card>

    <Card>
      <div style={{display:"flex",alignItems:"center",gap:"0.625rem",marginBottom:"0.625rem",flexWrap:"wrap"}}>
        <span style={{fontWeight:700,fontSize:"0.8125rem",flex:"1 1 auto"}}>Shift preview</span>
        <Sel value={pvM} onChange={e=>{const m=+e.target.value;setPvM(m);loadPreview(m,pvY);}} style={{width:"auto",minWidth:"7rem",flex:"0 0 auto"}}>{MO.map((m,i)=><option key={i} value={i}>{m}</option>)}</Sel>
        <Sel value={pvY} onChange={e=>{const y=+e.target.value;setPvY(y);loadPreview(pvM,y);}} style={{width:"auto",minWidth:"5rem",flex:"0 0 auto"}}>{YEARS.map(y=><option key={y} value={y}>{y}</option>)}</Sel>
        {pvLoading&&<span style={{fontSize:"0.625rem",color:t.dim}}>Loading…</span>}
      </div>
      <ShiftGrid list={roster} dates={pvDays} subs={pvSubs} month={pvM} year={pvY} publicSet={publicSet}/>
    </Card>
  </div>;
}

function DDBtn({children,onClick}){const t=useTheme();return<button onClick={onClick} onMouseEnter={e=>e.currentTarget.style.background=t.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"} style={{display:"block",width:"100%",textAlign:"left",padding:"0.5rem 0.875rem",color:t.tx,fontSize:"0.75rem",fontWeight:500}}>{children}</button>;}

function DataTable({list,getSub,showCode}){
  const t=useTheme();
  const hdr=["Name",showCode&&"Code","Role","Shift","RM","Status","Full","Half","WE","Hol"].filter(Boolean);
  return<div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
    <table style={{width:"100%",borderCollapse:"collapse",minWidth:"44rem"}}>
      <thead><tr>{hdr.map((h,i)=><th key={i} style={{textAlign:"left",padding:"0.4rem 0.375rem",background:t.s1,fontWeight:700,fontSize:"0.5625rem",color:t.dim,borderBottom:`1px solid ${t.bd}`,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</th>)}</tr></thead>
      <tbody>{list.map(emp=>{const s=getSub(emp);return(
        <tr key={emp.code||emp.name} onMouseEnter={e=>e.currentTarget.style.background=t.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,fontWeight:600,fontSize:"0.75rem",whiteSpace:"nowrap"}}>{emp.name}</td>
          {showCode&&<td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,color:t.dim,fontFamily:"'JetBrains Mono'",fontSize:"0.625rem"}}>{emp.code||"—"}</td>}
          <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,color:t.sub,fontSize:"0.625rem",fontWeight:700}}>{emp.empRole||"—"}</td>
          <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,color:t.acT,fontFamily:"'JetBrains Mono'",fontSize:"0.6875rem",fontWeight:700}}>{emp.shift||"—"}</td>
          <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,color:t.dim,fontSize:"0.625rem"}}>{emp.reportingManager||"—"}</td>
          <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`}}><span style={{display:"inline-block",width:"0.5rem",height:"0.5rem",borderRadius:"50%",background:s?t.ok:t.faint,boxShadow:s?`0 0 0.25rem ${t.ok}50`:"none"}}/></td>
          <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,fontWeight:800,fontFamily:"'JetBrains Mono'",fontSize:"0.6875rem",color:s&&(s.leavesFull||[]).length?t.err:t.dim}}>{s?((s.leavesFull||[]).length||"—"):"—"}</td>
          <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,fontWeight:800,fontFamily:"'JetBrains Mono'",fontSize:"0.6875rem",color:s&&(s.leavesHalf||[]).length?t.warn:t.dim}}>{s?((s.leavesHalf||[]).length||"—"):"—"}</td>
          <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,fontWeight:800,fontFamily:"'JetBrains Mono'",fontSize:"0.6875rem",color:s&&(s.weekendWork||[]).length?t.info:t.dim}}>{s?((s.weekendWork||[]).length||"—"):"—"}</td>
          <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,fontWeight:800,fontFamily:"'JetBrains Mono'",fontSize:"0.6875rem",color:s&&(s.holidayWork||[]).length?t.warn:t.dim}}>{s?((s.holidayWork||[]).length||"—"):"—"}</td>
        </tr>);})}</tbody>
    </table>
  </div>;
}

function ShiftGrid({list,dates,subs,month,year,publicSet}){
  const t=useTheme();
  const cc={B:[t.sub,"transparent"],D:[t.acT,t.acS],WO:[t.dim,t.s1],OC:[t.ok,t.okS],WS:[t.info,t.infoS],"":[t.err,t.errS]};
  return<div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
    <table style={{borderCollapse:"collapse",minWidth:`${dates.length*1.625+6.25}rem`}}>
      <thead><tr>
        <th style={{position:"sticky",left:0,zIndex:2,background:t.card,padding:"0.2rem 0.25rem",borderBottom:`1px solid ${t.bd}`,textAlign:"left",fontSize:"0.4375rem",color:t.dim,minWidth:"5.625rem",fontWeight:700,textTransform:"uppercase"}}>Name</th>
        {dates.map(d=>{const dt=pYMD(d);const h=publicSet.has(d);return<th key={d} style={{padding:"0.125rem 0",borderBottom:`1px solid ${t.bd}`,textAlign:"left",fontSize:"0.4375rem",minWidth:"1.375rem",color:h?t.warn:isWE(d)?t.err:t.dim,fontWeight:h||isWE(d)?700:400,lineHeight:1.3}}>{dt.getDate()}<br/><span style={{fontSize:"0.375rem"}}>{h?"H":DA[dt.getDay()]}</span></th>;})}
      </tr></thead>
      <tbody>{list.map(emp=>{
        const s=subs[`${emp.code}_${month}_${year}`];
        const fullSet=new Set(s?s.leavesFull:[]);
        const halfSet=new Set(s?s.leavesHalf:[]);
        const ws=new Set(s?s.weekendWork:[]),hws=new Set(s?s.holidayWork:[]),wh=s?(s.wwHours||{}):{},sh=emp.shift||"";
        return<tr key={emp.code||emp.name}>
          <td style={{position:"sticky",left:0,zIndex:1,background:t.card,padding:"0.2rem 0.25rem",borderBottom:`1px solid ${t.bd}`,fontWeight:700,whiteSpace:"nowrap",fontSize:"0.4375rem"}}>{s&&<span style={{display:"inline-block",width:"0.375rem",height:"0.375rem",borderRadius:"50%",background:t.ok,marginRight:"0.2rem",verticalAlign:"middle"}}/>}{emp.name}</td>
          {dates.map(d=>{
            let code;
            if(isWE(d)) code=ws.has(d)?(wh[d]||"OC"):"WO";
            else if(publicSet.has(d)) code=hws.has(d)?sh:"";
            else if(fullSet.has(d)) code="";
            else code=sh; // half or no leave
            const[fg,bg]=cc[code]||cc.B;
            return<td key={d} style={{padding:"0.125rem 0",borderBottom:`1px solid ${t.bd}`,textAlign:"left",background:bg,color:fg,fontWeight:["OC","WS","D"].includes(code)?800:400,fontSize:"0.4375rem",fontFamily:"'JetBrains Mono'"}}>{code}</td>;
          })}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// MANAGE EMPLOYEES
// ═══════════════════════════════════════════════════════════════
function ManagePage({emps,onBack,flash,toggle,mode}){
  const t=useTheme();
  const[list,setList]=useState(emps);
  const[adding,setAdding]=useState(false);
  const[editIdx,setEditIdx]=useState(null);
  // Blank defaults — no hardcoded role/shift values. Admin types whatever values they use.
  const[form,setForm]=useState({name:"",code:"",email:"",fullTime:true,reportingManager:"",empRole:"",shift:""});
  const[saving,setSaving]=useState(false);

  // Sync with parent when props change
  useEffect(()=>{setList(emps);},[JSON.stringify(emps)]);

  // Fetch fresh on mount — don't trust stale parent state
  useEffect(()=>{
    let alive=true;
    api("getEmployees").then(r=>{if(alive&&r?.employees)setList(r.employees);}).catch(()=>{});
    return()=>{alive=false;};
  },[]);

  const resetForm=()=>setForm({name:"",code:"",email:"",fullTime:true,reportingManager:"",empRole:"",shift:""});
  const startEdit=(emp,i)=>{setEditIdx(i);setAdding(false);setForm({name:emp.name,code:emp.code||"",email:emp.email||"",fullTime:emp.fullTime,reportingManager:emp.reportingManager||"",empRole:emp.empRole||"",shift:emp.shift||""});};
  const startAdd=()=>{setEditIdx(null);setAdding(true);resetForm();};
  const cancel=()=>{setAdding(false);setEditIdx(null);resetForm();};

  const saveEmp=async()=>{
    if(!form.name.trim()||!form.email.trim()){flash("Name and email required","err");return;}
    setSaving(true);
    try{
      const payload={...form,code:form.code?Number(form.code):null,fullTime:form.fullTime?1:0};
      if(editIdx!==null) await api("updateEmployee",{},{index:editIdx,employee:payload});
      else await api("addEmployee",{},{employee:payload});
      const r=await api("getEmployees");
      if(r?.employees)setList(r.employees);
      flash(editIdx!==null?"Updated":"Added");
      cancel();
    }catch(e){flash("Save failed","err");}
    setSaving(false);
  };
  const deleteEmp=async(emp,i)=>{if(!confirm(`Remove ${emp.name}?`))return;setSaving(true);try{await api("deleteEmployee",{},{index:i});const r=await api("getEmployees");if(r?.employees)setList(r.employees);flash("Removed","warn");}catch{flash("Delete failed","err");}setSaving(false);};

  const formActive=adding||editIdx!==null;

  // Derive existing roles/shifts/managers from current employees so dropdowns
  // reflect actual data in the sheet — no hardcoded lists.
  const existingRoles=Array.from(new Set(list.map(e=>e.empRole).filter(Boolean))).sort();
  const existingShifts=Array.from(new Set(list.map(e=>e.shift).filter(Boolean))).sort();
  const existingMgrs=Array.from(new Set(list.map(e=>e.reportingManager).filter(Boolean))).sort();

  return<div>
    <TopBar label="EMPLOYEE MANAGEMENT" userName="Admin" period={null} onOut={onBack} toggle={toggle} mode={mode}
      extra={<Btn small onClick={onBack} style={{color:t.acT,borderColor:t.acB}}>← Back</Btn>}
    />
    {formActive&&<Card style={{border:`1px solid ${t.acB}`}}>
      <div style={{fontWeight:700,fontSize:"0.875rem",marginBottom:"0.75rem",color:t.acT}}>{editIdx!==null?"Edit Employee":"Add New Employee"}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(12rem,1fr))",gap:"0.625rem"}}>
        <div><Lbl>Name *</Lbl><Inp value={form.name} set={v=>setForm(f=>({...f,name:v}))} ph="Full name"/></div>
        <div><Lbl>Email *</Lbl><Inp value={form.email} set={v=>setForm(f=>({...f,email:v}))} ph="email@nice.com" type="email"/></div>
        <div><Lbl>Employee Code</Lbl><Inp value={form.code} set={v=>setForm(f=>({...f,code:v}))} ph="Blank for extended"/></div>
        <div>
          <Lbl>Role</Lbl>
          <input value={form.empRole} onChange={e=>setForm(f=>({...f,empRole:e.target.value}))} list="roles-list" placeholder={existingRoles.length?existingRoles.join(" / "):"Any role"}
            style={{width:"100%",padding:"0.65rem 0.875rem",borderRadius:"0.5rem",fontSize:"0.875rem",background:t.s1,border:`1px solid ${t.bd}`,color:t.tx}}/>
          <datalist id="roles-list">{existingRoles.map(r=><option key={r} value={r}/>)}</datalist>
        </div>
        <div>
          <Lbl>Shift</Lbl>
          <input value={form.shift} onChange={e=>setForm(f=>({...f,shift:e.target.value}))} list="shifts-list" placeholder={existingShifts.length?existingShifts.join(" / "):"Any shift code"}
            style={{width:"100%",padding:"0.65rem 0.875rem",borderRadius:"0.5rem",fontSize:"0.875rem",background:t.s1,border:`1px solid ${t.bd}`,color:t.tx}}/>
          <datalist id="shifts-list">{existingShifts.map(s=><option key={s} value={s}/>)}</datalist>
        </div>
        <div>
          <Lbl>Reporting Manager</Lbl>
          <input value={form.reportingManager} onChange={e=>setForm(f=>({...f,reportingManager:e.target.value}))} list="mgrs-list" placeholder="Manager name"
            style={{width:"100%",padding:"0.65rem 0.875rem",borderRadius:"0.5rem",fontSize:"0.875rem",background:t.s1,border:`1px solid ${t.bd}`,color:t.tx}}/>
          <datalist id="mgrs-list">{existingMgrs.map(m=><option key={m} value={m}/>)}</datalist>
        </div>
        <div><Lbl>Type</Lbl><Sel value={form.fullTime?"1":"0"} onChange={e=>setForm(f=>({...f,fullTime:e.target.value==="1"}))}><option value="1">Full-time (Roster)</option><option value="0">Contractor (Extended)</option></Sel></div>
      </div>
      <div style={{display:"flex",gap:"0.5rem",marginTop:"0.875rem"}}>
        <Btn primary onClick={saveEmp} disabled={saving}>{saving?"Saving…":editIdx!==null?"Update":"Add"}</Btn>
        <Btn muted onClick={cancel}>Cancel</Btn>
      </div>
    </Card>}
    {!formActive&&<div style={{marginBottom:"0.625rem"}}><Btn primary onClick={startAdd}>+ Add Employee</Btn></div>}
    <Card>
      <div style={{fontWeight:700,fontSize:"0.8125rem",marginBottom:"0.5rem"}}>All Employees ({list.length})</div>
      <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:"52rem"}}>
          <thead><tr>{["Name","Code","Email","Role","Type","Shift","RM","Actions"].map(h=><th key={h} style={{textAlign:"left",padding:"0.4rem 0.375rem",background:t.s1,fontWeight:700,fontSize:"0.5625rem",color:t.dim,borderBottom:`1px solid ${t.bd}`,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</th>)}</tr></thead>
          <tbody>{list.map((emp,i)=>(
            <tr key={i} onMouseEnter={e=>e.currentTarget.style.background=t.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,fontWeight:600,fontSize:"0.75rem"}}>{emp.name}</td>
              <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,fontFamily:"'JetBrains Mono'",fontSize:"0.625rem",color:t.dim}}>{emp.code||"—"}</td>
              <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,fontSize:"0.625rem",color:t.sub}}>{emp.email}</td>
              <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,fontSize:"0.625rem",fontWeight:700,color:t.acT}}>{emp.empRole||"—"}</td>
              <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`}}><span style={{padding:"0.15rem 0.5rem",borderRadius:"0.75rem",fontSize:"0.5625rem",fontWeight:700,background:emp.fullTime?t.okS:t.warnS,color:emp.fullTime?t.ok:t.warn,border:`1px solid ${emp.fullTime?t.okB:t.warnB}`}}>{emp.fullTime?"Roster":"Extended"}</span></td>
              <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,fontFamily:"'JetBrains Mono'",fontSize:"0.6875rem",fontWeight:700,color:t.acT}}>{emp.shift||"—"}</td>
              <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`,fontSize:"0.625rem",color:t.dim}}>{emp.reportingManager||"—"}</td>
              <td style={{padding:"0.4rem 0.375rem",borderBottom:`1px solid ${t.bd}`}}>
                <div style={{display:"flex",gap:"0.3rem"}}>
                  <Btn small onClick={()=>startEdit(emp,i)} style={{color:t.info,borderColor:t.infoB}}>Edit</Btn>
                  <Btn small danger onClick={()=>deleteEmp(emp,i)}>Delete</Btn>
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// HOLIDAYS PAGE — PDF categorizes automatically, admin reviews both buckets
// ═══════════════════════════════════════════════════════════════
function HolidaysPage({publicH,optionalH,onBack,flash,toggle,mode}){
  const t=useTheme();
  const[pubList,setPubList]=useState(uniq(publicH));
  const[optList,setOptList]=useState(uniq(optionalH));
  const[parsing,setParsing]=useState(false);
  const[extracted,setExtracted]=useState(null); // {publicHolidays, optionalHolidays}
  const[saving,setSaving]=useState(false);
  const[loading,setLoading]=useState(false);
  const[manualDate,setManualDate]=useState("");
  const[manualType,setManualType]=useState("public");
  const fileRef=useRef(null);

  // Sync local lists when parent props update (e.g., after fresh fetch)
  useEffect(()=>{setPubList(uniq(publicH));},[JSON.stringify(publicH)]);
  useEffect(()=>{setOptList(uniq(optionalH));},[JSON.stringify(optionalH)]);

  // Always fetch fresh holidays when this page mounts — don't trust parent state
  useEffect(()=>{
    let alive=true;
    setLoading(true);
    api("getHolidays").then(r=>{
      if(!alive)return;
      if(r?.publicHolidays) setPubList(uniq(r.publicHolidays));
      if(r?.optionalHolidays) setOptList(uniq(r.optionalHolidays));
    }).catch(()=>{}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[]);

  const onFile=async e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    if(!file.name.toLowerCase().endsWith(".pdf")){flash("Select a PDF","err");return;}
    setParsing(true);setExtracted(null);
    try{
      const result=await extractCategorizedHolidays(file);
      const totalFound=result.publicHolidays.length+result.optionalHolidays.length;
      if(totalFound===0){flash("No dates found","warn");}
      else{setExtracted(result);flash(`Found ${result.publicHolidays.length} public + ${result.optionalHolidays.length} optional`);}
    }catch(err){flash("Parse failed: "+err.message,"err");}
    setParsing(false);
    if(fileRef.current)fileRef.current.value="";
  };

  const applyExtracted=()=>{
    setPubList(uniq([...pubList,...extracted.publicHolidays]));
    setOptList(uniq([...optList,...extracted.optionalHolidays]));
    setExtracted(null);
    flash("Added to lists");
  };
  const removeExtracted=(d,type)=>{
    setExtracted(prev=>({...prev,[type]:prev[type].filter(x=>x!==d)}));
  };

  const removePub=d=>setPubList(p=>p.filter(x=>x!==d));
  const removeOpt=d=>setOptList(p=>p.filter(x=>x!==d));
  const addManual=()=>{
    if(!manualDate){flash("Pick a date","err");return;}
    const d=new Date(manualDate+"T00:00:00");
    const y=ymd(d);
    if(manualType==="public"){
      if(pubList.includes(y)){flash("Already in list","warn");return;}
      setPubList(uniq([...pubList,y]));
    }else{
      if(optList.includes(y)){flash("Already in list","warn");return;}
      setOptList(uniq([...optList,y]));
    }
    setManualDate("");
  };

  const saveAll=async()=>{
    setSaving(true);
    try{
      await api("setHolidays",{},{publicHolidays:uniq(pubList),optionalHolidays:uniq(optList)});
      flash("Saved");
    }catch{flash("Save failed","err");}
    setSaving(false);
  };

  return<div>
    <TopBar label="HOLIDAYS" userName="Admin" period={null} onOut={onBack} toggle={toggle} mode={mode}
      extra={<Btn small onClick={onBack} style={{color:t.acT,borderColor:t.acB}}>← Back</Btn>}
    />

    <Card>
      <div style={{fontWeight:700,fontSize:"0.875rem",marginBottom:"0.5rem"}}>Upload holiday PDF</div>
      <p style={{fontSize:"0.75rem",color:t.sub,marginBottom:"0.75rem",lineHeight:1.5}}>
        Auto-categorized into <strong style={{color:t.warn}}>Public</strong> and <strong style={{color:t.info}}>Optional</strong> based on section headers. Weekend-only holidays are ignored.
      </p>
      <input ref={fileRef} type="file" accept=".pdf,application/pdf" onChange={onFile} disabled={parsing||saving} style={{display:"block",padding:"0.6rem",borderRadius:"0.5rem",background:t.s1,border:`1px dashed ${t.bd}`,color:t.tx,fontSize:"0.8125rem",width:"100%",cursor:parsing?"wait":"pointer"}}/>
      {parsing&&<div style={{marginTop:"0.5rem",fontSize:"0.75rem",color:t.info}}>Parsing…</div>}
    </Card>

    {extracted&&<Card style={{border:`1px solid ${t.acB}`,background:t.acS}}>
      <div style={{fontWeight:700,fontSize:"0.875rem",color:t.acT,marginBottom:"0.5rem"}}>Review extracted ({extracted.publicHolidays.length}+{extracted.optionalHolidays.length})</div>
      {extracted.publicHolidays.length>0&&<div style={{marginBottom:"0.625rem"}}>
        <div style={{fontSize:"0.6875rem",fontWeight:700,color:t.warn,marginBottom:"0.375rem",textTransform:"uppercase",letterSpacing:"0.08em"}}>Public ({extracted.publicHolidays.length})</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:"0.3rem"}}>
          {extracted.publicHolidays.map(d=><span key={d} style={{display:"inline-flex",alignItems:"center",gap:"0.3rem",padding:"0.25rem 0.625rem",borderRadius:"0.875rem",fontSize:"0.6875rem",fontWeight:600,background:t.card,border:`1px solid ${t.warnB}`,color:t.warn,fontFamily:"'JetBrains Mono'"}}>{ymdToDmy(d)}<span onClick={()=>removeExtracted(d,"publicHolidays")} style={{cursor:"pointer",opacity:.6,fontSize:"0.875rem",lineHeight:1}}>×</span></span>)}
        </div>
      </div>}
      {extracted.optionalHolidays.length>0&&<div style={{marginBottom:"0.625rem"}}>
        <div style={{fontSize:"0.6875rem",fontWeight:700,color:t.info,marginBottom:"0.375rem",textTransform:"uppercase",letterSpacing:"0.08em"}}>Optional ({extracted.optionalHolidays.length})</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:"0.3rem"}}>
          {extracted.optionalHolidays.map(d=><span key={d} style={{display:"inline-flex",alignItems:"center",gap:"0.3rem",padding:"0.25rem 0.625rem",borderRadius:"0.875rem",fontSize:"0.6875rem",fontWeight:600,background:t.card,border:`1px solid ${t.infoB}`,color:t.info,fontFamily:"'JetBrains Mono'"}}>{ymdToDmy(d)}<span onClick={()=>removeExtracted(d,"optionalHolidays")} style={{cursor:"pointer",opacity:.6,fontSize:"0.875rem",lineHeight:1}}>×</span></span>)}
        </div>
      </div>}
      <div style={{display:"flex",gap:"0.5rem"}}>
        <Btn primary onClick={applyExtracted}>Add to lists</Btn>
        <Btn muted onClick={()=>setExtracted(null)}>Discard</Btn>
      </div>
    </Card>}

    <Card>
      <div style={{display:"flex",alignItems:"center",gap:"0.5rem",marginBottom:"0.625rem",flexWrap:"wrap"}}>
        <span style={{fontWeight:700,fontSize:"0.875rem",flex:1}}>Current holidays</span>
        {loading&&<span style={{fontSize:"0.6875rem",color:t.dim,fontWeight:600}}>Loading…</span>}
        <Btn primary onClick={saveAll} disabled={saving||loading} small>{saving?"Saving…":"Save to sheet"}</Btn>
      </div>

      <div style={{display:"flex",gap:"0.5rem",alignItems:"flex-end",marginBottom:"0.875rem",flexWrap:"wrap"}}>
        <div style={{flex:"1 1 10rem"}}><Lbl>Date</Lbl><input type="date" value={manualDate} onChange={e=>setManualDate(e.target.value)} style={{width:"100%",padding:"0.6rem 0.75rem",borderRadius:"0.5rem",background:t.s1,border:`1px solid ${t.bd}`,color:t.tx,fontSize:"0.8125rem"}}/></div>
        <div style={{minWidth:"7rem"}}><Lbl>Type</Lbl><Sel value={manualType} onChange={e=>setManualType(e.target.value)}><option value="public">Public</option><option value="optional">Optional</option></Sel></div>
        <Btn onClick={addManual} small style={{color:t.warn,borderColor:t.warnB}}>+ Add</Btn>
      </div>

      <div style={{marginBottom:"0.75rem"}}>
        <div style={{fontSize:"0.6875rem",fontWeight:700,color:t.warn,marginBottom:"0.375rem",textTransform:"uppercase",letterSpacing:"0.08em"}}>Public ({pubList.length})</div>
        {pubList.length===0?<p style={{fontSize:"0.75rem",color:t.dim,fontStyle:"italic"}}>None</p>:
          <div style={{display:"flex",flexWrap:"wrap",gap:"0.3rem"}}>
            {pubList.map(d=><span key={d} style={{display:"inline-flex",alignItems:"center",gap:"0.3rem",padding:"0.3rem 0.625rem",borderRadius:"0.875rem",fontSize:"0.6875rem",fontWeight:600,background:t.warnS,border:`1px solid ${t.warnB}`,color:t.warn,fontFamily:"'JetBrains Mono'"}}>{ymdToDmy(d)}<span onClick={()=>removePub(d)} style={{cursor:"pointer",opacity:.6,fontSize:"0.875rem",lineHeight:1}}>×</span></span>)}
          </div>
        }
      </div>
      <div>
        <div style={{fontSize:"0.6875rem",fontWeight:700,color:t.info,marginBottom:"0.375rem",textTransform:"uppercase",letterSpacing:"0.08em"}}>Optional ({optList.length})</div>
        {optList.length===0?<p style={{fontSize:"0.75rem",color:t.dim,fontStyle:"italic"}}>None</p>:
          <div style={{display:"flex",flexWrap:"wrap",gap:"0.3rem"}}>
            {optList.map(d=><span key={d} style={{display:"inline-flex",alignItems:"center",gap:"0.3rem",padding:"0.3rem 0.625rem",borderRadius:"0.875rem",fontSize:"0.6875rem",fontWeight:600,background:t.infoS,border:`1px solid ${t.infoB}`,color:t.info,fontFamily:"'JetBrains Mono'"}}>{ymdToDmy(d)}<span onClick={()=>removeOpt(d)} style={{cursor:"pointer",opacity:.6,fontSize:"0.875rem",lineHeight:1}}>×</span></span>)}
          </div>
        }
      </div>
    </Card>
  </div>;
}
