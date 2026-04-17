import { useState, useEffect, useCallback } from "react";

const API_URL = "https://script.google.com/macros/s/AKfycbzU8QCaRViYlUQ0YmEfKVUV81WQ5IdrSiQZoTJm7g8Wb_1p1WNjt_zUTgaIf27uTSbb/exec";

async function api(action, params = {}, body = null) {
  const u = new URL(API_URL);
  u.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const o = body ? { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "text/plain" }, redirect: "follow" } : { redirect: "follow" };
  const r = await fetch(u.toString(), o);
  return await r.json();
}

const MO = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Dynamic year range: current year + next 2
const NOW_Y = new Date().getFullYear();
const YEARS = [NOW_Y, NOW_Y + 1, NOW_Y + 2];

// Leap year check: divisible by 4, except centuries unless divisible by 400
function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0); }

function getPeriod(m, y) {
  const pm = m === 0 ? 11 : m - 1;
  const py = m === 0 ? y - 1 : y;
  return { start: new Date(py, pm, 16), end: new Date(y, m, 15) };
}

const toISO = d => d.toISOString().split("T")[0];

// DD-MMM-YY format for reports: 16-Feb-26
function fmtReport(d) {
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mmm = MS[dt.getMonth()];
  const yy = String(dt.getFullYear()).slice(-2);
  return `${dd}-${mmm}-${yy}`;
}

// Display format for chips/UI
const fmtS = d => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const fmtD = d => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const isWE = d => { const x = new Date(d).getDay(); return x === 0 || x === 6; };
const ini = n => (n || "?").split(" ").map(w => w[0]).join("").toUpperCase();
const allDays = (s, e) => { const a = []; let c = new Date(s); while (c <= e) { a.push(new Date(c)); c.setDate(c.getDate() + 1); } return a; };
const dAbbr = d => ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][new Date(d).getDay()];

const T = { bg: "#060609", s1: "#0c0c14", cd: "#14141e", ch: "#1a1a28", bd: "#1f1f32", bh: "#2d2d48", tx: "#e2e2f0", sb: "#7e7ea0", dm: "#484868", ac: "#8b7cf7", aD: "rgba(139,124,247,0.1)", aB: "rgba(139,124,247,0.22)", aT: "#b5aaff", g: "#34d399", gD: "rgba(52,211,153,0.08)", gB: "rgba(52,211,153,0.22)", r: "#fb7185", rD: "rgba(251,113,133,0.07)", rB: "rgba(251,113,133,0.18)", b: "#60a5fa", bD: "rgba(96,165,250,0.07)", bB: "rgba(96,165,250,0.18)", y: "#fbbf24", yD: "rgba(251,191,36,0.07)", cy: "#22d3ee" };

// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [scr, setScr] = useState("login");
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [emps, setEmps] = useState([]);
  const [subs, setSubs] = useState({});
  const [period, setPeriod] = useState({ month: new Date().getMonth(), year: NOW_Y });
  const [open, setOpen] = useState(true);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const flash = (m, t = "ok") => { setToast({ m, t }); setTimeout(() => setToast(null), 3200); };

  const loadAll = useCallback(async (p) => {
    const per = p || period; setBusy(true);
    try {
      const [eR, sR, subR] = await Promise.all([api("getEmployees"), api("getSettings"), api("getSubmissions", { month: per.month, year: per.year })]);
      if (eR?.employees) setEmps(eR.employees);
      if (sR?.period) setPeriod(sR.period);
      if (sR?.open !== undefined) setOpen(sR.open);
      if (subR?.submissions) setSubs(subR.submissions);
    } catch { flash("Load error", "err"); }
    setBusy(false);
  }, [period.month, period.year]);

  const refreshSubs = useCallback(async () => {
    setBusy(true);
    try { const r = await api("getSubmissions", { month: period.month, year: period.year }); if (r?.submissions) setSubs(r.submissions); } catch {}
    setBusy(false);
  }, [period.month, period.year]);

  useEffect(() => { if (scr !== "login") loadAll(); }, [scr, loadAll]);

  const doSubmit = async (ek, data) => {
    if (!open) { flash("Entries closed", "err"); return; }
    if ((data.weekendWork || []).length > 0 && !data.mailSent) { flash("Mail to PM required", "err"); return; }
    setBusy(true);
    const r = await api("submit", {}, { ...data, month: period.month, year: period.year });
    if (r?.error) { flash(r.error, "err"); setBusy(false); return; }
    await refreshSubs(); flash("Saved"); setBusy(false);
  };

  const doReset = async () => { setBusy(true); await api("reset", {}, { month: period.month, year: period.year }); await refreshSubs(); flash("Reset", "warn"); setBusy(false); };
  const doSetPeriod = async np => { setPeriod(np); setBusy(true); await api("setSettings", {}, { period: np, open }); const r = await api("getSubmissions", { month: np.month, year: np.year }); if (r?.submissions) setSubs(r.submissions); setBusy(false); };
  const doSetOpen = async v => { setOpen(v); await api("setSettings", {}, { period, open: v }); };

  return (
    <div style={{ fontFamily: "'Outfit',system-ui,sans-serif", background: T.bg, color: T.tx, minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
      <style>{`@keyframes fu{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}@keyframes sr{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}}@keyframes pl{0%,100%{opacity:1}50%{opacity:.4}}::selection{background:${T.ac}35}input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(.55)}::-webkit-scrollbar{height:5px;width:5px}::-webkit-scrollbar-track{background:${T.s1}}::-webkit-scrollbar-thumb{background:${T.bh};border-radius:3px}`}</style>
      {toast && <Tst m={toast.m} t={toast.t} />}
      {busy && <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent,${T.ac},transparent)`, animation: "pl 1s infinite", zIndex: 9999 }} />}
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "0 1.25rem 3rem" }}>
        {scr === "login" && <Login onIn={(emp, adm) => { setUser(emp); setIsAdmin(adm); setScr(adm ? "admin" : "emp"); }} />}
        {scr === "emp" && <EmpScreen user={user} subs={subs} period={period} open={open} emps={emps} onSubmit={doSubmit} onOut={() => { setScr("login"); setUser(null); }} />}
        {scr === "admin" && <AdminScreen emps={emps} subs={subs} period={period} setPeriod={doSetPeriod} open={open} setOpen={doSetOpen} onReset={doReset} onOut={() => { setScr("login"); setUser(null); }} />}
      </div>
    </div>
  );
}

function Tst({ m, t }) { const c = t === "ok" ? T.g : t === "err" ? T.r : T.y; return <div style={{ position: "fixed", top: 14, right: 14, zIndex: 9999, padding: "10px 18px", borderRadius: 10, background: `${c}12`, border: `1px solid ${c}28`, color: c, fontSize: 13, fontWeight: 700, fontFamily: "'Outfit'", backdropFilter: "blur(12px)", animation: "sr .25s ease" }}>{t === "ok" ? "✓" : t === "err" ? "✕" : "!"} {m}</div>; }

// ═══════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════
function Login({ onIn }) {
  const [tab, setTab] = useState("emp");
  const [email, setEmail] = useState(""); const [au, setAu] = useState(""); const [ap, setAp] = useState("");
  const [err, setErr] = useState(""); const [ld, setLd] = useState(false);

  const goEmp = async () => { const e = email.trim().toLowerCase(); if (!e) { setErr("Enter email"); return; } setLd(true); try { const r = await api("login", { type: "employee", email: e }); if (r?.success) onIn(r, false); else setErr(r?.error || "Failed"); } catch { setErr("Network error"); } setLd(false); };
  const goAdm = async () => { if (!au.trim() || !ap) { setErr("Fill all fields"); return; } setLd(true); try { const r = await api("login", { type: "admin", username: au.trim().toLowerCase(), password: ap }); if (r?.success) onIn({ name: r.name, code: null }, true); else setErr(r?.error || "Failed"); } catch { setErr("Network error"); } setLd(false); };

  const inp = (v, fn, ph, ty = "text") => <input value={v} onChange={e => { fn(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && (tab === "emp" ? goEmp() : goAdm())} type={ty} placeholder={ph} disabled={ld} style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", background: T.s1, border: `1px solid ${T.bd}`, borderRadius: 10, color: T.tx, fontSize: 14, outline: "none", fontFamily: "inherit", opacity: ld ? .5 : 1 }} />;

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", paddingTop: "5vh", animation: "fu .4s ease" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ display: "inline-flex", width: 56, height: 56, borderRadius: 15, background: T.aD, border: `1px solid ${T.aB}`, alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={T.aT} strokeWidth="1.7"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: "-0.04em" }}>SVX Pune</h1>
        <p style={{ fontSize: 12, color: T.sb, margin: "4px 0 0", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase" }}>Weekend & Leave Tracker</p>
      </div>
      <div style={{ background: T.cd, border: `1px solid ${T.bd}`, borderRadius: 16, overflow: "hidden" }}>
        <div style={{ display: "flex", borderBottom: `1px solid ${T.bd}` }}>
          {[["emp", "Employee"], ["adm", "Admin"]].map(([k, l]) => <button key={k} onClick={() => { setTab(k); setErr(""); }} style={{ flex: 1, padding: "12px", background: "none", border: "none", borderBottom: tab === k ? `2px solid ${T.ac}` : "2px solid transparent", color: tab === k ? T.aT : T.dm, fontSize: 11, fontWeight: 800, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "inherit" }}>{l}</button>)}
        </div>
        <div style={{ padding: "1.4rem" }}>
          {tab === "emp" ? <><Lbl>Email address</Lbl>{inp(email, setEmail, "firstname.lastname@niceactimize.com", "email")}<p style={{ fontSize: 10, color: T.dm, marginTop: 6 }}>No password needed</p></> : <><Lbl>Username</Lbl>{inp(au, setAu, "adminvivek/adminsuraj")}<div style={{ height: 12 }} /><Lbl>Password</Lbl>{inp(ap, setAp, "Admin password", "password")}</>}
          {err && <div style={{ marginTop: 10, padding: "7px 12px", borderRadius: 8, background: T.rD, border: `1px solid ${T.rB}`, color: T.r, fontSize: 12, fontWeight: 600 }}>{err}</div>}
          <button onClick={tab === "emp" ? goEmp : goAdm} disabled={ld} style={{ marginTop: 16, width: "100%", padding: "12px", background: ld ? T.dm : `linear-gradient(135deg,${T.ac},#6e5fd4)`, color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: ld ? "wait" : "pointer", fontFamily: "inherit" }}>{ld ? "Signing in..." : tab === "adm" ? "Sign in as admin" : "Continue with email"}</button>
        </div>
      </div>
    </div>
  );
}

function Lbl({ children }) { return <label style={{ display: "block", fontSize: 10, color: T.sb, marginBottom: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>{children}</label>; }

// ═══════════════════════════════════════════════════════════════
// SHARED
// ═══════════════════════════════════════════════════════════════
function Nav({ label, user, period, onOut }) {
  const { start, end } = getPeriod(period.month, period.year);
  return <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "1rem 0 .85rem", marginBottom: 6, borderBottom: `1px solid ${T.bd}`, flexWrap: "wrap" }}>
    <div style={{ width: 32, height: 32, borderRadius: 9, background: T.aD, border: `1px solid ${T.aB}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: T.aT, fontFamily: "'JetBrains Mono'" }}>{ini(user.name)}</div>
    <div style={{ lineHeight: 1.25 }}><div style={{ fontWeight: 700, fontSize: 13 }}>{user.name}</div><div style={{ fontSize: 9, color: T.dm, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div></div>
    <span style={{ padding: "3px 11px", borderRadius: 16, background: T.aD, border: `1px solid ${T.aB}`, fontSize: 11, fontWeight: 700, color: T.aT }}>{MO[period.month]} {period.year}</span>
    <span style={{ fontSize: 10, color: T.dm }}>{fmtD(start)} — {fmtD(end)}</span>
    <div style={{ marginLeft: "auto" }}><Btn small muted onClick={onOut}>Sign out</Btn></div>
  </div>;
}
function Btn({ children, onClick, primary, danger, small, muted, disabled, style: sx }) {
  let bg = "transparent", c = T.sb, bd = T.bd;
  if (primary) { bg = `linear-gradient(135deg,${T.ac},#6e5fd4)`; c = "#fff"; bd = "transparent"; }
  if (danger) { bg = T.rD; c = T.r; bd = T.rB; } if (muted) c = T.dm;
  return <button onClick={onClick} disabled={disabled} style={{ padding: small ? "5px 11px" : "9px 18px", background: bg, color: c, border: `1px solid ${bd}`, borderRadius: small ? 7 : 10, fontSize: small ? 11 : 13, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: disabled ? .35 : 1, transition: "all .15s", ...sx }}>{children}</button>;
}
function Crd({ children, style: sx }) { return <div style={{ background: T.cd, border: `1px solid ${T.bd}`, borderRadius: 13, padding: "1rem 1.2rem", marginBottom: 9, animation: "fu .3s ease", ...sx }}>{children}</div>; }
const _i = { width: "100%", boxSizing: "border-box", padding: "9px 12px", background: T.s1, border: `1px solid ${T.bd}`, borderRadius: 9, color: T.tx, fontSize: 13, outline: "none", fontFamily: "inherit" };
const _s = { ..._i, cursor: "pointer", appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23484868' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center" };

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE SCREEN — 2-row date grid, WS default, readable labels
// ═══════════════════════════════════════════════════════════════
function EmpScreen({ user, subs, period, open, emps, onSubmit, onOut }) {
  const { month, year } = period;
  const [leaves, setLeaves] = useState([]);
  const [ww, setWW] = useState([]);
  const [wwH, setWwH] = useState({});
  const [mail, setMail] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);

  const { start, end } = getPeriod(month, year);
  const ek = user.code || user.name;
  const ex = subs[`${ek}_${month}_${year}`];
  const days = allDays(start, end);
  const weekdays = days.filter(d => !isWE(d));
  const weekends = days.filter(d => isWE(d));

  useEffect(() => {
    if (ex) { setLeaves(ex.leaves || []); setWW(ex.weekendWork || []); setWwH(ex.wwHours || {}); setMail(ex.mailSent || false); setEditing(false); }
    else { setLeaves([]); setWW([]); setWwH({}); setMail(false); setEditing(true); }
    setErr("");
  }, [month, year, ex ? ex.at : null]);

  const on = editing || !ex;
  const toggleLeave = ds => { if (leaves.includes(ds)) setLeaves(leaves.filter(x => x !== ds)); else setLeaves([...leaves, ds].sort()); };
  const toggleWW = ds => {
    if (ww.includes(ds)) { setWW(ww.filter(x => x !== ds)); setWwH(p => { const n = { ...p }; delete n[ds]; return n; }); }
    else { setWW([...ww, ds].sort()); setWwH(p => ({ ...p, [ds]: "WS" })); } // WS default
  };
  const setWWDur = (ds, dur) => setWwH(p => ({ ...p, [ds]: dur }));
  const save = empty => { if (!empty && ww.length > 0 && !mail) { setErr("Mail to PM required"); return; } onSubmit(ek, { empCode: ek, empName: user.name, leaves: empty ? [] : leaves, weekendWork: empty ? [] : ww, wwHours: empty ? {} : wwH, mailSent: empty ? true : mail }); setEditing(false); };

  // Split dates into 2 balanced rows
  const half = n => Math.ceil(n.length / 2);

  return <div>
    <Nav label={[user.code && `#${user.code}`, user.fullTime ? "Roster" : "Extended", user.reportingManager && `RM: ${user.reportingManager}`].filter(Boolean).join(" · ")} user={user} period={period} onOut={onOut} />
    <div style={{ margin: "8px 0", padding: "8px 12px", borderRadius: 9, background: `${T.cy}08`, border: `1px solid ${T.cy}15`, color: T.cy, fontSize: 11, fontWeight: 600 }}>Month: {MO[month]} {year} (set by admin){!open && <span style={{ color: T.r, marginLeft: 4 }}>· Closed</span>}</div>

    {ex && !editing && <Crd style={{ background: T.gD, border: `1px solid ${T.gB}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ color: T.g, fontWeight: 700, fontSize: 14 }}>Submitted for {MO[month]}</div>
          <div style={{ color: T.sb, fontSize: 12, marginTop: 3 }}>Leaves: {(ex.leaves || []).length ? ex.leaves.map(d => fmtS(d)).join(", ") : "None"}</div>
          <div style={{ color: T.sb, fontSize: 12, marginTop: 1 }}>Weekend: {(ex.weekendWork || []).length ? ex.weekendWork.map(d => `${fmtS(d)} (${(ex.wwHours || {})[d] === "OC" ? "Full Day" : "Half Day"})`).join(", ") : "None"}</div>
        </div>
        {open && <Btn small onClick={() => setEditing(true)} style={{ color: T.aT, borderColor: T.aB }}>Edit</Btn>}
      </div>
    </Crd>}

    {on && open ? <>
      {editing && ex && <div style={{ padding: "6px 12px", borderRadius: 8, background: T.aD, border: `1px solid ${T.aB}`, color: T.aT, fontSize: 11, fontWeight: 600, marginBottom: 8 }}>Editing mode</div>}
      {err && <div style={{ margin: "6px 0", padding: "7px 12px", borderRadius: 8, background: T.rD, border: `1px solid ${T.rB}`, color: T.r, fontSize: 12, fontWeight: 600 }}>{err}</div>}

      {/* LEAVES — 2-row grid */}
      <Crd>
        <Sec icon="L" color={T.r} title="Leave days" sub={`Click to toggle · ${leaves.length} selected`} />
        <DateGrid dates={weekdays} selected={leaves} onToggle={toggleLeave} selBg={T.rD} selBd={T.rB} selC={T.r} />
      </Crd>

      {/* WEEKEND — 2-row grid + per-date dropdown */}
      <Crd>
        <Sec icon="W" color={T.b} title="Weekend work" sub={`${ww.length} selected`} />
        <div style={{ padding: "10px 14px", borderRadius: 10, background: mail ? T.gD : T.s1, border: `1px solid ${mail ? T.gB : T.bd}`, transition: "all .25s", margin: "12px 0" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, color: mail ? T.g : T.sb }}>
            <input type="checkbox" checked={mail} onChange={e => setMail(e.target.checked)} style={{ width: 17, height: 17, accentColor: T.g, cursor: "pointer" }} />
            I confirm mail has been sent to PM
            {mail && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: T.g, letterSpacing: "0.06em" }}>Confirmed</span>}
          </label>
        </div>
        <div style={{ opacity: mail ? 1 : .3, pointerEvents: mail ? "auto" : "none", transition: "opacity .25s" }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(half(weekends), 7)}, 1fr)`, gap: 6 }}>
            {weekends.map(d => { const ds = toISO(d); const sel = ww.includes(ds); const dur = wwH[ds] || "WS";
              return <div key={ds} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <button onClick={() => toggleWW(ds)} style={{ padding: "8px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700, border: `1.5px solid ${sel ? T.bB : T.bd}`, background: sel ? T.bD : "transparent", color: sel ? T.b : T.sb, cursor: "pointer", fontFamily: "'JetBrains Mono'", textAlign: "center", transition: "all .15s", lineHeight: 1.3 }}>
                  {d.getDate()} {MS[d.getMonth()]}<br /><span style={{ fontSize: 9, opacity: .7, fontWeight: 500 }}>{dAbbr(d)}</span>
                </button>
                {sel && <select value={dur} onChange={e => setWWDur(ds, e.target.value)} style={{ fontSize: 10, padding: "4px 6px", borderRadius: 6, background: T.s1, border: `1px solid ${T.bB}`, color: T.b, fontFamily: "'Outfit'", fontWeight: 600, cursor: "pointer", textAlign: "center" }}>
                  <option value="WS">Half Day (4 hrs)</option>
                  <option value="OC">Full Day (8+ hrs)</option>
                </select>}
              </div>;
            })}
          </div>
          {!mail && <p style={{ fontSize: 10, color: T.dm, marginTop: 8, fontStyle: "italic" }}>Confirm mail to enable</p>}
        </div>
      </Crd>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
        <Btn primary onClick={() => save(false)}>{ex ? "Update" : "Save"} & submit</Btn>
        <Btn onClick={() => save(true)}>No leaves / no weekend</Btn>
        {editing && ex && <Btn muted small onClick={() => setEditing(false)}>Cancel</Btn>}
      </div>
    </> : null}
  </div>;
}

// 2-row balanced date grid component
function DateGrid({ dates, selected, onToggle, selBg, selBd, selC }) {
  const cols = Math.ceil(dates.length / 2);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(cols, 10)}, 1fr)`, gap: 5, marginTop: 12 }}>
      {dates.map(d => {
        const ds = toISO(d); const sel = selected.includes(ds);
        return <button key={ds} onClick={() => onToggle(ds)} style={{ padding: "7px 2px", borderRadius: 8, fontSize: 11, fontWeight: 700, border: `1.5px solid ${sel ? selBd : T.bd}`, background: sel ? selBg : "transparent", color: sel ? selC : T.sb, cursor: "pointer", fontFamily: "'JetBrains Mono'", textAlign: "center", transition: "all .15s", lineHeight: 1.3, minWidth: 0 }}>
          {d.getDate()} {MS[d.getMonth()]}<br /><span style={{ fontSize: 8, opacity: .65, fontWeight: 500 }}>{dAbbr(d)}</span>
        </button>;
      })}
    </div>
  );
}

function Sec({ icon, color, title, sub }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <div style={{ width: 28, height: 28, borderRadius: 8, background: `${color}12`, border: `1px solid ${color}28`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color, fontFamily: "'JetBrains Mono'" }}>{icon}</div>
    <div><div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div><div style={{ fontSize: 11, color: T.dm }}>{sub}</div></div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// ADMIN SCREEN
// ═══════════════════════════════════════════════════════════════
function AdminScreen({ emps, subs, period, setPeriod, open, setOpen, onReset, onOut }) {
  const { month, year } = period;
  const [expOpen, setExpOpen] = useState(false);

  const roster = emps.filter(e => e.fullTime);
  const extended = emps.filter(e => !e.fullTime);
  const managers = [...new Set(emps.filter(e => e.reportingManager).map(e => e.reportingManager))].sort();

  const get = emp => subs[`${(emp.code || emp.name)}_${month}_${year}`];
  const rc = roster.filter(e => get(e)).length;
  const ec = extended.filter(e => get(e)).length;
  let tl = 0, tw = 0; emps.forEach(e => { const s = get(e); if (s) { tl += (s.leaves || []).length; tw += (s.weekendWork || []).length; } });

  // CSV builder — DD-MMM-YY date headers, shift from sheet, no RM column
  function buildCSV(list) {
    const { start, end } = getPeriod(month, year);
    const ad = allDays(start, end);
    const dn = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let csv = "Name,Employee Code," + ad.map(d => fmtReport(d)).join(",") + "\n";
    csv += ",," + ad.map(d => dn[d.getDay()]).join(",") + "\n";
    list.forEach(emp => {
      const s = get(emp), ls = new Set(s ? s.leaves : []), ws = new Set(s ? s.weekendWork : []), wh = s ? (s.wwHours || {}) : {};
      const shift = emp.shift || "B";
      csv += `"${emp.name}",${emp.code || ""},${ad.map(d => { const ds = toISO(d); return isWE(d) ? (ws.has(ds) ? (wh[ds] || "OC") : "WO") : (ls.has(ds) ? "" : shift); }).join(",")}\n`;
    });
    return csv;
  }

  const pre = `shift_type_roster_${MS[month]}${year}_SVX_Pune_Team`;
  const dl = (csv, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = name; a.click(); };

  // Reports: full team, full-time, per-manager (full-time only) — NO BA team
  const reports = [
    { label: "Full team (all employees)", fn: () => dl(buildCSV(emps), `shift_type_roster_${MS[month]}${year}_whole_SVX_Pune_Team.csv`), cat: "main" },
    { label: "Full-time employees only", fn: () => dl(buildCSV(roster), `${pre} - FullTime.csv`), cat: "main" },
    ...managers.map(m => ({
      label: m,
      fn: () => dl(buildCSV(emps.filter(e => e.reportingManager === m && e.fullTime)), `${pre} - ${m}.csv`),
      cat: "mgr"
    })),
  ];

  return <div>
    <Nav label="ADMIN" user={{ name: "Admin" }} period={period} onOut={onOut} />

    {/* CONTROLS — dynamic years */}
    <Crd>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.aT} strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Controls</span>
        {isLeapYear(year) && month === 1 && <span style={{ fontSize: 9, color: T.cy, fontWeight: 600, marginLeft: 6 }}>Leap year — Feb has 29 days</span>}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ minWidth: 140 }}>
          <Lbl>Month</Lbl>
          <select style={{ ..._s, width: "100%" }} value={month} onChange={e => setPeriod({ ...period, month: +e.target.value })}>
            {MO.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 100 }}>
          <Lbl>Year</Lbl>
          <select style={{ ..._s, width: "100%" }} value={year} onChange={e => setPeriod({ ...period, year: +e.target.value })}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 12px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 700, background: open ? T.gD : T.rD, border: `1px solid ${open ? T.gB : T.rB}`, color: open ? T.g : T.r }}>
          <input type="checkbox" checked={open} onChange={e => setOpen(e.target.checked)} style={{ accentColor: T.g, width: 15, height: 15 }} />{open ? "Open" : "Closed"}
        </label>
      </div>
    </Crd>

    {/* STATS */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8, marginBottom: 9 }}>
      {[["Roster", `${rc}/${roster.length}`, T.ac], ["Extended", `${ec}/${extended.length}`, T.cy], ["Leaves", tl, T.r], ["Weekend", tw, T.b]].map(([l, v, c]) =>
        <div key={l} style={{ background: T.cd, border: `1px solid ${T.bd}`, borderRadius: 11, padding: "11px 14px" }}>
          <div style={{ fontSize: 9, color: T.dm, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>{l}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: c, fontFamily: "'JetBrains Mono'", marginTop: 1 }}>{v}</div>
        </div>
      )}
    </div>

    {/* EXPORT */}
    <Crd>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative" }}>
          <Btn primary onClick={() => setExpOpen(!expOpen)}>Export reports ▾</Btn>
          {expOpen && <div style={{ position: "absolute", top: "110%", left: 0, zIndex: 100, background: T.cd, border: `1px solid ${T.bh}`, borderRadius: 11, padding: "6px 0", minWidth: 280, boxShadow: "0 8px 32px rgba(0,0,0,.5)" }} onMouseLeave={() => setExpOpen(false)}>
            {reports.filter(r => r.cat === "main").map(r => <ExBtn key={r.label} onClick={() => { r.fn(); setExpOpen(false); }}>{r.label}</ExBtn>)}
            <div style={{ height: 1, background: T.bd, margin: "4px 0" }} />
            <div style={{ padding: "4px 14px", fontSize: 9, color: T.dm, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>By reporting manager (full-time only)</div>
            {managers.map(m => <ExBtn key={m} onClick={() => { reports.find(r => r.label === m).fn(); setExpOpen(false); }}>{m}</ExBtn>)}
            {managers.length === 0 && <div style={{ padding: "6px 14px", fontSize: 11, color: T.dm, fontStyle: "italic" }}>No managers</div>}
          </div>}
        </div>
        <Btn danger onClick={() => { if (confirm(`Reset ALL for ${MO[month]} ${year}?`)) onReset(); }}>Reset month</Btn>
      </div>
      <p style={{ fontSize: 10, color: T.dm, marginTop: 8 }}>Reports use shift from Employees sheet. Dates formatted as DD-MMM-YY.</p>
    </Crd>

    {/* TABLES */}
    <Crd><div style={{ fontWeight: 700, fontSize: 13, marginBottom: 9 }}>Roster / full-time ({roster.length})</div><EmpTbl list={roster} getSub={get} showCode /></Crd>
    <Crd><div style={{ fontWeight: 700, fontSize: 13, marginBottom: 9 }}>Extended ({extended.length})</div><EmpTbl list={extended} getSub={get} /></Crd>
    <Crd><div style={{ fontWeight: 700, fontSize: 13, marginBottom: 9 }}>Shift roster preview</div><Grid list={roster} month={month} year={year} subs={subs} /></Crd>
  </div>;
}

function ExBtn({ children, onClick }) { return <button onClick={onClick} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", background: "none", border: "none", color: T.tx, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }} onMouseEnter={e => e.currentTarget.style.background = T.ch} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{children}</button>; }

function EmpTbl({ list, getSub, showCode }) {
  return <div style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr>{["Name", showCode && "Code", "Shift", "RM", "", "Leaves", "#", "Weekend", "#"].filter(Boolean).map((h, i) => <th key={i} style={{ textAlign: ["", "#"].includes(h) ? "center" : "left", padding: "8px 6px", background: T.s1, fontWeight: 700, fontSize: 9, color: T.dm, borderBottom: `1px solid ${T.bd}`, textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</th>)}</tr></thead>
      <tbody>{list.map(emp => { const s = getSub(emp); return (
        <tr key={emp.code || emp.name} onMouseEnter={e => e.currentTarget.style.background = T.ch} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${T.bd}`, fontWeight: 600, fontSize: 12, whiteSpace: "nowrap" }}>{emp.name}</td>
          {showCode && <td style={{ padding: "8px 6px", borderBottom: `1px solid ${T.bd}`, color: T.dm, fontFamily: "'JetBrains Mono'", fontSize: 10 }}>{emp.code || "—"}</td>}
          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${T.bd}`, color: T.aT, fontFamily: "'JetBrains Mono'", fontSize: 11, fontWeight: 700 }}>{emp.shift || "B"}</td>
          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${T.bd}`, color: T.dm, fontSize: 10 }}>{emp.reportingManager || "—"}</td>
          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${T.bd}`, textAlign: "center" }}><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: s ? T.g : T.dm, boxShadow: s ? `0 0 5px ${T.g}50` : "none" }} /></td>
          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${T.bd}`, fontSize: 10, color: T.sb, maxWidth: 160 }}>{s ? ((s.leaves || []).length ? s.leaves.map(d => fmtS(d)).join(", ") : "—") : "—"}</td>
          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${T.bd}`, textAlign: "center", fontWeight: 800, fontFamily: "'JetBrains Mono'", fontSize: 11, color: s && (s.leaves || []).length ? T.r : T.dm }}>{s ? (s.leaves || []).length : "—"}</td>
          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${T.bd}`, fontSize: 10, color: T.sb, maxWidth: 160 }}>{s ? ((s.weekendWork || []).length ? s.weekendWork.map(d => `${fmtS(d)}(${(s.wwHours || {})[d] === "OC" ? "Full" : "Half"})`).join(", ") : "—") : "—"}</td>
          <td style={{ padding: "8px 6px", borderBottom: `1px solid ${T.bd}`, textAlign: "center", fontWeight: 800, fontFamily: "'JetBrains Mono'", fontSize: 11, color: s && (s.weekendWork || []).length ? T.b : T.dm }}>{s ? (s.weekendWork || []).length : "—"}</td>
        </tr>); })}</tbody>
    </table>
  </div>;
}

function Grid({ list, month, year, subs }) {
  const { start, end } = getPeriod(month, year);
  const ad = allDays(start, end);
  const cc = { B: [T.sb, "transparent"], D: [T.aT, T.aD], WO: [T.dm, T.s1], OC: [T.g, T.gD], WS: [T.b, T.bD], "": [T.r, T.rD] };
  return <div style={{ overflowX: "auto" }}>
    <table style={{ borderCollapse: "collapse", minWidth: ad.length * 26 + 110 }}>
      <thead><tr>
        <th style={{ position: "sticky", left: 0, zIndex: 2, background: T.cd, padding: "3px 4px", borderBottom: `1px solid ${T.bd}`, textAlign: "left", fontSize: 7, color: T.dm, minWidth: 90, fontWeight: 700, textTransform: "uppercase" }}>Name</th>
        {ad.map(d => <th key={toISO(d)} style={{ padding: "2px 0", borderBottom: `1px solid ${T.bd}`, textAlign: "center", fontSize: 7, minWidth: 22, color: isWE(d) ? T.r : T.dm, fontWeight: isWE(d) ? 700 : 400, lineHeight: 1.3 }}>{d.getDate()}<br /><span style={{ fontSize: 6 }}>{dAbbr(d)}</span></th>)}
      </tr></thead>
      <tbody>{list.map(emp => {
        const s = subs[`${emp.code}_${month}_${year}`];
        const ls = new Set(s ? s.leaves : []), ws = new Set(s ? s.weekendWork : []), wh = s ? (s.wwHours || {}) : {};
        const shift = emp.shift || "B";
        return <tr key={emp.code || emp.name}>
          <td style={{ position: "sticky", left: 0, zIndex: 1, background: T.cd, padding: "3px 4px", borderBottom: `1px solid ${T.bd}`, fontWeight: 700, whiteSpace: "nowrap", fontSize: 7 }}>{emp.name}</td>
          {ad.map(d => { const ds = toISO(d), code = isWE(d) ? (ws.has(ds) ? (wh[ds] || "OC") : "WO") : (ls.has(ds) ? "" : shift); const [fg, bg] = cc[code] || cc.B;
            return <td key={ds} style={{ padding: "2px 0", borderBottom: `1px solid ${T.bd}`, textAlign: "center", background: bg, color: fg, fontWeight: ["OC", "WS", "D"].includes(code) ? 800 : 400, fontSize: 7, fontFamily: "'JetBrains Mono'" }}>{code}</td>;
          })}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
