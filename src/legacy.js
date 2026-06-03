import { K, KG, CONFIG_VERSION, applyUserKeys, ls, ss, clone, uid, hashPassword, genSalt, getUsers, saveUsers, registerUser, loginUser, saveSession, loadSession, clearSession, migrateExistingDataToUser, ensureAdminUser, getCurrentUser, setCurrentUser, getCurrentUserId } from "./core/storage.js";
import { initForCrm, buildBuyQuoteFromFile, recordReview } from "./features/quote/src/integration/crmBridge.js";


function showApp(){
  document.getElementById("auth-overlay").classList.add("hidden");
  document.getElementById("topbar-user").textContent = getCurrentUser().displayName;
  const authLogo = document.getElementById("auth-logo");
  const logoSrc = localStorage.getItem(K.logo)||"";
  if(authLogo && logoSrc){ authLogo.src=logoSrc; authLogo.style.display="block"; }
}

function showAuthOverlay(){
  document.getElementById("auth-overlay").classList.remove("hidden");
}

function wireAuthEvents(){
  document.getElementById("auth-tab-login").addEventListener("click",()=>{
    document.getElementById("auth-login-form").style.display="block";
    document.getElementById("auth-register-form").style.display="none";
    document.getElementById("auth-tab-login").classList.add("active");
    document.getElementById("auth-tab-register").classList.remove("active");
  });
  document.getElementById("auth-tab-register").addEventListener("click",()=>{
    document.getElementById("auth-login-form").style.display="none";
    document.getElementById("auth-register-form").style.display="block";
    document.getElementById("auth-tab-login").classList.remove("active");
    document.getElementById("auth-tab-register").classList.add("active");
  });

  document.getElementById("auth-login-btn").addEventListener("click", async ()=>{
    const u=document.getElementById("auth-username").value.trim();
    const p=document.getElementById("auth-password").value;
    const remember=document.getElementById("auth-remember").checked;
    document.getElementById("auth-login-err").textContent="Signing in…";
    let res;
    try { res = await loginUser(u, p); } catch(e) { document.getElementById("auth-login-err").textContent=e.message; return; }
    if(res.err){ document.getElementById("auth-login-err").textContent=res.err; return; }
    saveSession(res.user, remember);
    setCurrentUser({id:res.user.id, username:res.user.username, displayName:res.user.displayName, isAdmin:res.user.isAdmin});
    applyUserKeys(res.user.id);
    migrateExistingDataToUser(res.user.id);
    initForCrm({ userId: res.user.id });
    showApp();
    boot();
  });

  ["auth-username","auth-password"].forEach(id=>{
    document.getElementById(id).addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("auth-login-btn").click();});
  });

  document.getElementById("auth-reg-btn").addEventListener("click", async ()=>{
    const name=document.getElementById("reg-name").value.trim();
    const u=document.getElementById("reg-username").value.trim();
    const p=document.getElementById("reg-password").value;
    const c=document.getElementById("reg-confirm").value;
    const errEl=document.getElementById("auth-reg-err");
    if(!name){errEl.textContent="Please enter your name";return;}
    if(!u){errEl.textContent="Please enter a username";return;}
    if(p.length<6){errEl.textContent="Password must be at least 6 characters";return;}
    if(p!==c){errEl.textContent="Passwords do not match";return;}
    errEl.textContent="Creating account…";
    const res = await registerUser(u, p, name);
    if(res.err){errEl.textContent=res.err;return;}
    saveSession(res.user, true);
    setCurrentUser({id:res.user.id, username:res.user.username, displayName:res.user.displayName, isAdmin:res.user.isAdmin});
    applyUserKeys(res.user.id);
    initForCrm({ userId: res.user.id });
    showApp();
    boot();
  });

  document.getElementById("btn-logout").addEventListener("click",()=>{
    if(!confirm("Sign out?")) return;
    clearSession();
    location.reload();
  });

  const cnt = getUsers().length;
  document.getElementById("auth-footer").textContent = cnt>0 ? `${cnt} account${cnt!==1?"s":""} on this device` : "";
}

async function init(){
  if(!crypto?.subtle){
    document.getElementById("auth-login-err").textContent="⚠ App requires HTTPS or localhost to run. Open via a secure URL.";
    showAuthOverlay(); return;
  }
  await ensureAdminUser();
  const sess = loadSession();
  if(sess){
    setCurrentUser(sess);
    applyUserKeys(sess.userId);
    initForCrm({ userId: sess.userId });
    showApp();
    boot();
    return;
  }
  showAuthOverlay();
}

// ── HubSpot date field labels ──────────────────────────────────────────────────
const HS_DATE_FIELDS = {
  "close date":"Close Date","closedate":"Close Date",
  "est. close or rfx due date":"Close / RFx Date","rfx due date":"RFx Due Date",
  "est. close date":"Est. Close Date",
  "create date":"Create Date","createdate":"Create Date","deal created date":"Create Date",
  "last activity date":"Last Activity Date","notes_last_updated":"Last Activity Date",
  "last modified date":"Last Modified Date","hs_lastmodifieddate":"Last Modified Date",
  "last contact date":"Last Contact Date","notes_last_contacted":"Last Contact Date",
  "due date":"Due Date","expected close date":"Expected Close Date",
};

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  configVersion: CONFIG_VERSION,
  defaultMargin: 5,
  stages: [
    { id:"C",   label:"C",   weight:10, color:"#64748b" },
    { id:"B",   label:"B",   weight:25, color:"#6366f1" },
    { id:"BB",  label:"BB",  weight:40, color:"#3b82f6" },
    { id:"A",   label:"A",   weight:60, color:"#f59e0b" },
    { id:"AA",  label:"AA",  weight:75, color:"#f97316" },
    { id:"AAA", label:"AAA", weight:90, color:"#10b981" },
  ],
  statuses: [
    { id:"active",  label:"Active",  terminal:false, color:"#10b981" },
    { id:"on-hold", label:"On Hold", terminal:false, color:"#f59e0b" },
    { id:"won",     label:"Won",     terminal:true,  color:"#0052cc" },
    { id:"lost",    label:"Lost",    terminal:true,  color:"#64748b" },
  ],
};

// ── Config migration ──────────────────────────────────────────────────────────
function migrateConfig(saved) {
  if (!saved) return clone(DEFAULT_CONFIG);
  // Already current version — use as-is
  if (saved.configVersion === CONFIG_VERSION) return saved;
  // Merge: keep user's stages/statuses but fill in any missing structural fields
  const out = clone(DEFAULT_CONFIG);
  if (Array.isArray(saved.stages) && saved.stages.length) out.stages = saved.stages.map(s => ({ ...DEFAULT_CONFIG.stages.find(d=>d.id===s.id)||DEFAULT_CONFIG.stages[0], ...s }));
  if (Array.isArray(saved.statuses) && saved.statuses.length) out.statuses = saved.statuses.map(s => ({ ...DEFAULT_CONFIG.statuses.find(d=>d.id===s.id)||DEFAULT_CONFIG.statuses[0], ...s }));
  out.defaultMargin = saved.defaultMargin ?? DEFAULT_CONFIG.defaultMargin;
  out.configVersion = CONFIG_VERSION;
  ss(K.config, out);
  return out;
}

// ── State ─────────────────────────────────────────────────────────────────────
let config = clone(DEFAULT_CONFIG);
let opportunities = [];
let notes    = {};
let activity = {};
let oppFiles = {};
let tasks = [];
let currentView = "kanban";
let filterOpen = false;
let filters = { statuses:new Set(), stages:new Set(), dateFrom:"", dateTo:"", valMin:"", valMax:"", company:"" };
let listSort = { col:"name", dir:1 };
let dragCard = null;
let diffState = null;
let settingsDraft = null;
let notesOppId = null;
let chartMonthly = null, chartQuarterly = null, chartMargin = null;
let forecastDateField = "";
let fcMonthWin = "3m", fcQuarWin = "8q";
let fcCustomM = { from:"", to:"" }, fcCustomQ = { from:"", to:"" };
let currentOppDetailId = null;
let currentOppTab = "details";
let manualFilter = "pending";

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(s) { return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function fmt(v) { if(!v&&v!==0) return ""; return new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD",maximumFractionDigits:0}).format(v); }
function parseMoney(s) { return parseFloat(String(s||"").replace(/[^0-9.\-]/g,""))||0; }

// ── Date helpers ──────────────────────────────────────────────────────────────
function parseDate(str) {
  if(!str) return null;
  str=String(str).trim();
  const au=str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(au) return new Date(+au[3],+au[2]-1,+au[1]);
  const iso=str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(iso) return new Date(+iso[1],+iso[2]-1,+iso[3]);
  const d=new Date(str); return isNaN(d)?null:d;
}
function toISO(str) { const d=parseDate(str); if(!d) return ""; return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function fmtDate(iso) { if(!iso) return ""; const [y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; }
function pad(n) { return String(n).padStart(2,"0"); }
function daysDiff(iso) { if(!iso) return null; const [y,m,d]=iso.split("-").map(Number); const t=new Date(); t.setHours(0,0,0,0); return Math.floor((new Date(y,m-1,d)-t)/86400000); }
function fmtTs(iso) { if(!iso) return ""; const d=new Date(iso); return d.toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"})+" · "+d.toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit"}); }
function fmtActivityShort(iso) { if(!iso) return ""; const d=new Date(iso); const diff=Math.floor((Date.now()-d)/86400000); if(diff===0) return "Today"; if(diff===1) return "Yesterday"; if(diff<7) return diff+"d ago"; return d.toLocaleDateString("en-AU",{day:"numeric",month:"short"}); }

function effMargin(opp) { return opp.margin != null ? opp.margin : (config.defaultMargin ?? 5); }
function marginVal(opp) { return (opp.value||0) * effMargin(opp) / 100; }

let toastTimer;
function showToast(msg,type="") { const el=document.getElementById("toast"); el.textContent=msg; el.className="show"+(type?" "+type:""); clearTimeout(toastTimer); toastTimer=setTimeout(()=>{el.className="";},3000); }

// ── Expiry Dashboard ──────────────────────────────────────────────────────────
function renderExpiry(){
  const el=document.getElementById("expiry-view"); el.innerHTML="";
  const rows=[];
  opportunities.forEach(opp=>{
    const fd=getOppFileData(opp.id);
    ["sellQuotes","buyQuotes"].forEach(bucket=>{
      (fd[bucket]||[]).forEach(f=>{
        if(!f.expiryDate) return;
        rows.push({opp,file:f,quoteType:bucket==="sellQuotes"?"sell":"buy",daysLeft:daysDiff(f.expiryDate),cls:expiryClass(f.expiryDate),rowKind:"quote"});
      });
    });
    if(opp.dealRegExpiry){
      rows.push({opp,file:null,quoteType:"deal-reg",daysLeft:daysDiff(opp.dealRegExpiry),cls:expiryClass(opp.dealRegExpiry),rowKind:"dealreg"});
    }
  });
  rows.sort((a,b)=>{
    const order={overdue:0,soon:1,"":2};
    if(order[a.cls]!==order[b.cls]) return order[a.cls]-order[b.cls];
    return (a.daysLeft??9999)-(b.daysLeft??9999);
  });
  let fStatus="all"; let fType="all"; let fCat="all";
  el.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <h2 style="font-size:18px;font-weight:700;margin:0">Expiry Tracker</h2>
      <span id="exp-summary" style="font-size:12px;color:var(--muted)"></span>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
      <div style="display:flex;gap:4px">
        ${["all","overdue","soon",""].map(v=>`<button class="exp-filter-btn" data-group="status" data-val="${v}" style="font-size:11px;padding:4px 10px;border-radius:12px;border:1px solid var(--border);background:${v==="all"?"var(--accent)":"#fff"};color:${v==="all"?"#fff":"var(--text)"};cursor:pointer">${v==="all"?"All":v==="overdue"?"Overdue":v==="soon"?"Soon":"Active"}</button>`).join("")}
      </div>
      <div style="display:flex;gap:4px">
        ${["all","sell","buy","deal-reg"].map(v=>`<button class="exp-filter-btn" data-group="type" data-val="${v}" style="font-size:11px;padding:4px 10px;border-radius:12px;border:1px solid var(--border);background:${v==="all"?"var(--accent)":"#fff"};color:${v==="all"?"#fff":"var(--text)"};cursor:pointer">${v==="all"?"All Types":v==="sell"?"Sell":v==="buy"?"Buy":"Deal Reg"}</button>`).join("")}
      </div>
      <div style="display:flex;gap:4px">
        ${["all","hw","sw","ps"].map(v=>`<button class="exp-filter-btn" data-group="cat" data-val="${v}" style="font-size:11px;padding:4px 10px;border-radius:12px;border:1px solid var(--border);background:${v==="all"?"var(--accent)":"#fff"};color:${v==="all"?"#fff":"var(--text)"};cursor:pointer">${v==="all"?"All Categories":v==="hw"?"HW":v==="sw"?"SW":"PS"}</button>`).join("")}
      </div>
      <span id="exp-count" style="font-size:11px;color:var(--muted);margin-left:auto"></span>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid var(--border)">
          <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Status</th>
          <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Item</th>
          <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Type</th>
          <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Categories</th>
          <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Amount</th>
          <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Expiry</th>
          <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Days Left</th>
          <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Opportunity</th>
          <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Account</th>
          <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Stage</th>
        </tr></thead>
        <tbody id="exp-tbody"></tbody>
      </table>
    </div>
    ${!rows.length?'<p style="text-align:center;color:var(--muted);padding:40px">No expiry dates found. Add expiry dates to quotes or deal registrations.</p>':''}
  `;
  const tbody=document.getElementById("exp-tbody");
  const summary=document.getElementById("exp-summary");
  const countEl=document.getElementById("exp-count");
  function renderTable(){
    const filtered=rows.filter(r=>{
      if(fStatus!=="all"&&r.cls!==fStatus) return false;
      if(fType!=="all"&&r.quoteType!==fType) return false;
      if(fCat!=="all"&&r.rowKind==="dealreg") return false; // deal-reg rows have no category
      if(fCat!=="all"&&!(r.file?.categories||[]).some(c=>c.type===fCat)) return false;
      return true;
    });
    const overdueCnt=rows.filter(r=>r.cls==="overdue").length;
    const soonCnt=rows.filter(r=>r.cls==="soon").length;
    tbody.innerHTML=filtered.map(r=>{
      const stageObj=config.stages.find(s=>s.id===r.opp.stage);
      const clsColor=r.cls==="overdue"?"#de350b":r.cls==="soon"?"#ff8b00":"#10b981";
      const clsLabel=r.cls==="overdue"?"OVERDUE":r.cls==="soon"?"SOON":"OK";
      if(r.rowKind==="dealreg"){
        return `<tr class="exp-row" style="border-bottom:1px solid var(--border);transition:background .1s;background:#fffbf0" data-oppid="${r.opp.id}">
          <td style="padding:8px 6px"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:${clsColor}20;color:${clsColor}">${clsLabel}</span></td>
          <td style="padding:8px 6px;font-size:12px;font-weight:600;color:var(--text)">${r.opp.dealId?esc(r.opp.dealId):'<span style="color:var(--muted)">—</span>'}</td>
          <td style="padding:8px 6px"><span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:#e8f0fe;color:#1a73e8">Deal Reg</span></td>
          <td style="padding:8px 6px;font-size:12px;color:var(--muted)">—</td>
          <td style="padding:8px 6px;font-size:12px;color:var(--muted)">—</td>
          <td style="padding:8px 6px;font-size:12px">${fmtDate(r.opp.dealRegExpiry)}</td>
          <td style="padding:8px 6px;font-size:12px;font-weight:600;color:${r.cls==="overdue"?"#de350b":r.cls==="soon"?"#ff8b00":"var(--text)"}">${r.daysLeft!=null?(r.daysLeft<0?Math.abs(r.daysLeft)+"d overdue":r.daysLeft===0?"Today":r.daysLeft+"d"):"—"}</td>
          <td style="padding:8px 6px"><a class="exp-opp-link" data-id="${r.opp.id}" style="color:var(--accent);font-size:12px;cursor:pointer;font-weight:600">${esc(r.opp.name)}</a></td>
          <td style="padding:8px 6px;font-size:12px;color:var(--muted)">${esc(r.opp.account||"—")}</td>
          <td style="padding:8px 6px;font-size:12px"><span style="padding:2px 7px;border-radius:4px;background:${stageObj?.color||'#888'}20;color:${stageObj?.color||'#888'};font-weight:600">${esc(stageObj?.label||r.opp.stage)}</span></td>
        </tr>`;
      }
      const catPills=(r.file?.categories||[]).map(c=>`<span style="font-size:10px;font-weight:600;padding:1px 5px;border-radius:8px;background:${c.type==='hw'?'#e8f0fe':c.type==='sw'?'#e6f9f0':'#fff3e0'};color:${c.type==='hw'?'#1a73e8':c.type==='sw'?'#137333':'#e65100'}">${c.type.toUpperCase()}</span>`).join(" ");
      return `<tr class="exp-row" style="border-bottom:1px solid var(--border);transition:background .1s;cursor:default" data-oppid="${r.opp.id}" data-fid="${r.file.id}">
        <td style="padding:8px 6px"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:${clsColor}20;color:${clsColor}">${clsLabel}</span></td>
        <td style="padding:8px 6px"><a class="exp-file-link" data-oppid="${r.opp.id}" data-fid="${r.file.id}" style="color:var(--accent);font-size:12px;cursor:pointer;text-decoration:none;font-weight:600">${esc(r.file.name)}</a></td>
        <td style="padding:8px 6px;font-size:12px;text-transform:capitalize">${r.quoteType}</td>
        <td style="padding:8px 6px;font-size:12px">${catPills||'—'}</td>
        <td style="padding:8px 6px;font-size:12px;font-weight:600">${r.file.amount?fmt(r.file.amount):"—"}</td>
        <td style="padding:8px 6px;font-size:12px">${fmtDate(r.file.expiryDate)}</td>
        <td style="padding:8px 6px;font-size:12px;font-weight:600;color:${r.cls==="overdue"?"#de350b":r.cls==="soon"?"#ff8b00":"var(--text)"}">${r.daysLeft!=null?(r.daysLeft<0?Math.abs(r.daysLeft)+"d overdue":r.daysLeft===0?"Today":r.daysLeft+"d"):"—"}</td>
        <td style="padding:8px 6px"><a class="exp-opp-link" data-id="${r.opp.id}" style="color:var(--accent);font-size:12px;cursor:pointer;font-weight:600">${esc(r.opp.name)}</a></td>
        <td style="padding:8px 6px;font-size:12px;color:var(--muted)">${esc(r.opp.account||"—")}</td>
        <td style="padding:8px 6px;font-size:12px"><span style="padding:2px 7px;border-radius:4px;background:${stageObj?.color||'#888'}20;color:${stageObj?.color||'#888'};font-weight:600">${esc(stageObj?.label||r.opp.stage)}</span></td>
      </tr>`;
    }).join("");
    summary.textContent=`${overdueCnt} overdue · ${soonCnt} expiring soon · ${rows.filter(r=>r.cls==="").length} active`;
    countEl.textContent=`${filtered.length} item${filtered.length!==1?"s":""}`;
  }
  renderTable();
  el.querySelectorAll(".exp-filter-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const grp=btn.dataset.group; const val=btn.dataset.val;
      el.querySelectorAll(`.exp-filter-btn[data-group="${grp}"]`).forEach(b=>{b.style.background="#fff";b.style.color="var(--text)";});
      btn.style.background="var(--accent)";btn.style.color="#fff";
      if(grp==="status") fStatus=val;
      else if(grp==="type") fType=val;
      else fCat=val;
      renderTable();
    });
  });
  // Row hover highlight
  el.querySelectorAll(".exp-row").forEach(tr=>{
    tr.addEventListener("mouseenter",()=>tr.style.background="#f8f9fa");
    tr.addEventListener("mouseleave",()=>tr.style.background="");
  });
  // Opp link → open opp detail panel to Files tab
  el.querySelectorAll(".exp-opp-link").forEach(a=>a.addEventListener("click",e=>{
    e.stopPropagation();
    openOppDetail(a.dataset.id,"files");
  }));
  // File link → open opp detail panel to Files tab, then open inline preview
  el.querySelectorAll(".exp-file-link").forEach(a=>a.addEventListener("click",e=>{
    e.stopPropagation();
    const opp2=opportunities.find(o=>o.id===a.dataset.oppid); if(!opp2) return;
    const fd2=getOppFileData(opp2.id);
    const all=[...fd2.files,...fd2.sellQuotes,...fd2.buyQuotes];
    const f=all.find(x=>x.id===a.dataset.fid); if(!f) return;
    // Open the opp panel first so the preview renders inline within it
    openOppDetail(opp2.id,"files");
    // Small delay to let the panel render, then trigger inline preview
    setTimeout(()=>openPreview(f),120);
  }));
}

// ── Logo ──────────────────────────────────────────────────────────────────────
function updateHeaderLogo(){
  const src=localStorage.getItem(K.logo)||"";
  const img=document.getElementById("header-logo");
  if(img){img.src=src;img.style.display=src?"inline-block":"none";}
}

// ── Expiry badge ──────────────────────────────────────────────────────────────
function updateExpiryBadge(){
  const quoteCnt=opportunities.reduce((s,opp)=>{
    const fd=getOppFileData(opp.id);
    return s+[...(fd.sellQuotes||[]),...(fd.buyQuotes||[])].filter(f=>f.expiryDate&&(expiryClass(f.expiryDate)==="overdue"||expiryClass(f.expiryDate)==="soon")).length;
  },0);
  const dealRegCnt=opportunities.filter(o=>o.dealRegExpiry&&(expiryClass(o.dealRegExpiry)==="overdue"||expiryClass(o.dealRegExpiry)==="soon")).length;
  const cnt=quoteCnt+dealRegCnt;
  const badge=document.getElementById("expiry-badge");
  if(badge){badge.textContent=cnt;badge.style.display=cnt>0?"inline-block":"none";}
}

// ── Tasks persistence + badge ─────────────────────────────────────────────────
function saveTasks(){ ss(K.tasks, tasks); }
function updateTasksBadge(){
  const cnt=tasks.filter(t=>!t.done).length;
  const badge=document.getElementById("tasks-badge");
  if(badge){badge.textContent=cnt;badge.style.display=cnt>0?"inline-block":"none";}
}

// ── Tasks view ────────────────────────────────────────────────────────────────
function renderTasks(){
  const el=document.getElementById("tasks-view"); el.innerHTML="";
  const today=new Date().toISOString().slice(0,10);
  const weekEnd=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  let fDone="pending"; let fOpp="all"; let fDate="all";
  let showAddRow=false;
  function oppName(id){const o=opportunities.find(x=>x.id===id);return o?o.name:null;}
  function dueCss(t){if(t.done)return"color:var(--muted)";const dc=expiryClass(t.dueDate);return dc==="overdue"?"color:#de350b;font-weight:700":dc==="soon"?"color:#ff8b00;font-weight:600":"color:var(--text)";}
  function render(){
    let list=tasks;
    if(fDone==="pending") list=list.filter(t=>!t.done);
    else if(fDone==="done") list=list.filter(t=>t.done);
    if(fOpp==="unlinked") list=list.filter(t=>!t.oppId);
    if(fDate==="overdue") list=list.filter(t=>t.dueDate&&t.dueDate<today);
    else if(fDate==="today") list=list.filter(t=>t.dueDate===today);
    else if(fDate==="week") list=list.filter(t=>t.dueDate&&t.dueDate>=today&&t.dueDate<=weekEnd);
    // Group: overdue → today → upcoming → no-date → done
    const overdue=list.filter(t=>!t.done&&t.dueDate&&t.dueDate<today);
    const dueToday=list.filter(t=>!t.done&&t.dueDate===today);
    const upcoming=list.filter(t=>!t.done&&t.dueDate&&t.dueDate>today);
    const noDate=list.filter(t=>!t.done&&!t.dueDate);
    const done=list.filter(t=>t.done);
    function taskRow(t){
      const oName=t.oppId?oppName(t.oppId):null;
      const dc=expiryClass(t.dueDate);
      const duePill=t.dueDate?`<span style="font-size:11px;padding:2px 7px;border-radius:8px;margin-right:4px;background:${dc==='overdue'?'#fde8e8':dc==='soon'?'#fff3cd':'#f0f4f8'};color:${dc==='overdue'?'#de350b':dc==='soon'?'#ff8b00':'#5e6c84'}">${fmtDate(t.dueDate)}</span>`:"";
      return `<tr data-tid="${t.id}" style="border-bottom:1px solid var(--border);transition:background .1s">
        <td style="padding:8px 6px;width:32px"><input type="checkbox" class="tv-cb" data-tid="${t.id}" ${t.done?"checked":""} style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer" /></td>
        <td style="padding:8px 6px;font-size:13px;${t.done?"text-decoration:line-through;color:var(--muted)":"font-weight:500"}">${esc(t.title)}</td>
        <td style="padding:8px 6px;font-size:12px;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.notes?esc(t.notes):"—"}</td>
        <td style="padding:8px 6px;font-size:12px">${oName?`<a class="tv-opp-link" data-id="${t.oppId}" style="color:var(--accent);font-weight:600;cursor:pointer">${esc(oName)}</a>`:'<span style="color:var(--muted)">—</span>'}</td>
        <td style="padding:8px 6px">${duePill||'<span style="font-size:11px;color:var(--muted)">No date</span>'}</td>
        <td style="padding:8px 6px"><button class="tv-del" data-tid="${t.id}" style="background:none;border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;color:var(--muted);cursor:pointer">Delete</button></td>
      </tr>`;
    }
    function section(label,list2,color){
      if(!list2.length) return "";
      return `<tr><td colspan="6" style="padding:10px 6px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${color||'var(--muted)'};">${label}</td></tr>${list2.map(taskRow).join("")}`;
    }
    const addRowHtml=showAddRow?`<tr id="tv-add-row" style="border-bottom:2px solid var(--accent)">
      <td style="padding:8px 6px"></td>
      <td style="padding:8px 6px"><input class="op-input" id="tv-new-title" placeholder="Task title…" style="width:100%;min-width:160px" /></td>
      <td style="padding:8px 6px"><input class="op-input" id="tv-new-notes" placeholder="Notes (optional)" style="width:100%" /></td>
      <td style="padding:8px 6px">
        <select class="op-select" id="tv-new-opp" style="width:100%;font-size:12px;max-width:200px">
          <option value="">— No opportunity —</option>
          ${opportunities.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("")}
        </select>
      </td>
      <td style="padding:8px 6px"><input class="op-input" id="tv-new-due" type="date" style="width:140px" /></td>
      <td style="padding:8px 6px;display:flex;gap:6px">
        <button class="op-save-btn" id="tv-save-add" style="padding:6px 14px;font-size:12px">Save</button>
        <button id="tv-cancel-add" style="padding:6px 10px;font-size:12px;background:none;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer">Cancel</button>
      </td>
    </tr>`:"";
    const total=list.length;
    const openCnt=tasks.filter(t=>!t.done).length;
    el.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h2 style="font-size:18px;font-weight:700;margin:0">Tasks</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="font-size:12px;color:var(--muted)">${openCnt} open</span>
          <button class="op-save-btn" id="tv-add-btn" style="padding:7px 16px;font-size:12px">+ Add Task</button>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
        <div style="display:flex;gap:4px">
          ${["pending","done","all"].map(v=>`<button class="tv-filter-btn" data-group="done" data-val="${v}" style="font-size:11px;padding:4px 10px;border-radius:12px;border:1px solid var(--border);background:${v===fDone?"var(--accent)":"#fff"};color:${v===fDone?"#fff":"var(--text)"};cursor:pointer">${v==="pending"?"Pending":v==="done"?"Done":"All"}</button>`).join("")}
        </div>
        <div style="display:flex;gap:4px">
          ${["all","unlinked"].map(v=>`<button class="tv-filter-btn" data-group="opp" data-val="${v}" style="font-size:11px;padding:4px 10px;border-radius:12px;border:1px solid var(--border);background:${v===fOpp?"var(--accent)":"#fff"};color:${v===fOpp?"#fff":"var(--text)"};cursor:pointer">${v==="all"?"All Opps":"Unlinked"}</button>`).join("")}
        </div>
        <div style="display:flex;gap:4px">
          ${["all","overdue","today","week"].map(v=>`<button class="tv-filter-btn" data-group="date" data-val="${v}" style="font-size:11px;padding:4px 10px;border-radius:12px;border:1px solid var(--border);background:${v===fDate?"var(--accent)":"#fff"};color:${v===fDate?"#fff":"var(--text)"};cursor:pointer">${v==="all"?"All Dates":v==="overdue"?"Overdue":v==="today"?"Due Today":"This Week"}</button>`).join("")}
        </div>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="border-bottom:2px solid var(--border)">
            <th style="padding:8px 6px;width:32px"></th>
            <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Title</th>
            <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Notes</th>
            <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Opportunity</th>
            <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Due Date</th>
            <th style="padding:8px 6px;text-align:left;font-size:11px;color:var(--muted);font-weight:600"></th>
          </tr></thead>
          <tbody>
            ${addRowHtml}
            ${section("⚠ Overdue",overdue,"#de350b")}
            ${section("📅 Due Today",dueToday,"#1a73e8")}
            ${section("Upcoming",upcoming,"")}
            ${section("No Date",noDate,"")}
            ${done.length?`<tr><td colspan="6" style="padding:10px 6px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Completed (${done.length})</td></tr>${done.map(taskRow).join("")}`:""}
            ${!total?`<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--muted)">No tasks. Click "+ Add Task" to create one.</td></tr>`:""}
          </tbody>
        </table>
      </div>`;
    // wire events
    el.querySelectorAll(".tv-filter-btn").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const grp=btn.dataset.group,val=btn.dataset.val;
        if(grp==="done") fDone=val;
        else if(grp==="opp") fOpp=val;
        else fDate=val;
        render();
      });
    });
    el.querySelector("#tv-add-btn")?.addEventListener("click",()=>{showAddRow=true;render();});
    el.querySelector("#tv-cancel-add")?.addEventListener("click",()=>{showAddRow=false;render();});
    el.querySelector("#tv-save-add")?.addEventListener("click",()=>{
      const title=(document.getElementById("tv-new-title")?.value||"").trim();
      if(!title){showToast("Enter a task title","err");return;}
      const dueDate=document.getElementById("tv-new-due")?.value||"";
      const notes=(document.getElementById("tv-new-notes")?.value||"").trim();
      const oppId=document.getElementById("tv-new-opp")?.value||null;
      const ts=new Date().toISOString();
      tasks.push({id:uid(),title,notes,dueDate,oppId:oppId||null,done:false,createdAt:ts,updatedAt:ts});
      saveTasks(); updateTasksBadge(); showAddRow=false; render();
      showToast("Task added","ok");
    });
    el.querySelector("#tv-new-title")?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();el.querySelector("#tv-save-add")?.click();}});
    el.querySelectorAll(".tv-cb").forEach(cb=>{
      cb.addEventListener("change",()=>{
        const t=tasks.find(x=>x.id===cb.dataset.tid); if(!t) return;
        t.done=cb.checked; t.updatedAt=new Date().toISOString();
        saveTasks(); updateTasksBadge(); render();
      });
    });
    el.querySelectorAll(".tv-del").forEach(btn=>{
      btn.addEventListener("click",()=>{
        if(!confirm("Delete this task?")) return;
        tasks=tasks.filter(t=>t.id!==btn.dataset.tid);
        saveTasks(); updateTasksBadge(); render();
      });
    });
    el.querySelectorAll(".tv-opp-link").forEach(a=>{
      a.addEventListener("click",()=>openOppDetail(a.dataset.id,"tasks"));
    });
    // hover
    el.querySelectorAll("tr[data-tid]").forEach(tr=>{
      tr.addEventListener("mouseenter",()=>tr.style.background="#f8f9fa");
      tr.addEventListener("mouseleave",()=>tr.style.background="");
    });
  }
  render();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
function boot() {
  config = migrateConfig(ls(K.config));
  opportunities = ls(K.data)||[];
  notes    = ls(K.notes)||{};
  activity = ls(K.activity)||{};
  oppFiles = ls(K.files)||{};
  tasks    = ls(K.tasks)||[];
  forecastDateField = localStorage.getItem(K.fcField)||"";
  refreshLastUpload();
  checkNudge();
  buildFilterChips();
  wireEvents();
  updateManualTabBadge();
  updateHeaderLogo();
  updateExpiryBadge();
  updateTasksBadge();
  renderView();
}

function wireEvents() {
  document.getElementById("btn-upload").addEventListener("click",()=>fi().click());
  document.getElementById("empty-upload-btn").addEventListener("click",()=>fi().click());
  document.getElementById("nudge-cta").addEventListener("click",()=>fi().click());
  document.getElementById("nudge-dismiss").addEventListener("click",dismissNudge);
  document.getElementById("diff-dismiss").addEventListener("click",()=>document.getElementById("diff-banner").classList.remove("show"));
  fi().addEventListener("change",onFile);

  document.querySelectorAll(".view-tab").forEach(b=>b.addEventListener("click",()=>{
    currentView=b.dataset.view;
    document.querySelectorAll(".view-tab").forEach(x=>x.classList.toggle("active",x===b));
    renderView();
  }));

  document.getElementById("btn-filter").addEventListener("click",toggleFilters);
  document.getElementById("btn-clear-filters").addEventListener("click",clearFilters);
  document.getElementById("f-date-preset").addEventListener("change",e=>{
    const v=e.target.value;
    const custom=document.getElementById("f-date-custom");
    custom.style.display=v==="custom"?"flex":"none";
    if(v!=="custom"){const r=resolveDatePreset(v);filters.dateFrom=r.from;filters.dateTo=r.to;applyFilters();}
  });
  document.getElementById("f-date-from").addEventListener("change",e=>{filters.dateFrom=e.target.value;applyFilters();});
  document.getElementById("f-date-to").addEventListener("change",e=>{filters.dateTo=e.target.value;applyFilters();});
  document.getElementById("f-val-min").addEventListener("input",e=>{filters.valMin=e.target.value;applyFilters();});
  document.getElementById("f-val-max").addEventListener("input",e=>{filters.valMax=e.target.value;applyFilters();});
  let st,sc;
  document.getElementById("search").addEventListener("input",()=>{clearTimeout(st);st=setTimeout(renderView,160);});
  document.getElementById("f-company").addEventListener("input",e=>{clearTimeout(sc);filters.company=e.target.value.trim().toLowerCase();sc=setTimeout(applyFilters,160);});

  document.getElementById("btn-settings").addEventListener("click",openSettings);
  document.getElementById("sp-close").addEventListener("click",closeSettings);
  document.getElementById("sp-cancel").addEventListener("click",closeSettings);
  document.getElementById("sp-save").addEventListener("click",saveSettings);
  document.getElementById("add-stage-btn").addEventListener("click",addSettingsStage);
  document.getElementById("add-status-btn").addEventListener("click",addSettingsStatus);
  document.getElementById("settings-overlay").addEventListener("click",e=>{if(e.target===e.currentTarget)closeSettings();});

  document.getElementById("np-close").addEventListener("click",closeNotes);
  document.getElementById("notes-overlay").addEventListener("click",e=>{if(e.target===e.currentTarget)closeNotes();});
  document.getElementById("np-submit").addEventListener("click",submitNote);
  document.getElementById("np-textarea").addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();submitNote();}});

  document.getElementById("op-close").addEventListener("click",closeOppDetail);
  document.getElementById("opp-overlay").addEventListener("click",e=>{if(e.target===e.currentTarget)closeOppDetail();});
  document.querySelectorAll(".op-tab").forEach(t=>t.addEventListener("click",()=>switchOppTab(t.dataset.tab)));

  document.getElementById("mv-add-btn").addEventListener("click",openNewOppForm);
  document.getElementById("nop-close").addEventListener("click",closeNewOppForm);
  document.getElementById("nop-cancel").addEventListener("click",closeNewOppForm);
  document.getElementById("nop-save").addEventListener("click",createManualOpp);
  document.getElementById("new-opp-overlay").addEventListener("click",e=>{if(e.target===e.currentTarget)closeNewOppForm();});
  document.querySelectorAll(".mv-ftab").forEach(b=>b.addEventListener("click",()=>{manualFilter=b.dataset.mf;document.querySelectorAll(".mv-ftab").forEach(x=>x.classList.toggle("active",x===b));renderManual();}));

  document.getElementById("prev-close").addEventListener("click",closePreview);
  document.getElementById("preview-overlay").addEventListener("click",e=>{if(e.target===e.currentTarget)closePreview();});
  document.getElementById("inl-prev-close").addEventListener("click",closeInlinePreview);

  document.getElementById("dp-close").addEventListener("click",closeDrill);
  document.getElementById("drill-overlay").addEventListener("click",e=>{if(e.target===e.currentTarget)closeDrill();});

  document.getElementById("fc-inc-won").addEventListener("change",renderForecast);
  document.getElementById("fc-inc-lost").addEventListener("change",renderForecast);
  document.getElementById("fc-date-field").addEventListener("change",e=>{forecastDateField=e.target.value;localStorage.setItem(K.fcField,forecastDateField);renderForecast();});

  // Window preset buttons
  document.querySelectorAll("[data-win]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const w=btn.dataset.win;
      const isQ=w.endsWith("q");
      if(isQ){
        fcQuarWin=w;
        document.querySelectorAll("[data-win$='q']").forEach(b=>b.classList.toggle("active",b===btn));
        document.getElementById("fc-custom-quarterly").classList.toggle("show",w==="customq");
      } else {
        fcMonthWin=w;
        document.querySelectorAll("[data-win$='m']").forEach(b=>b.classList.toggle("active",b===btn));
        document.getElementById("fc-custom-monthly").classList.toggle("show",w==="customm");
      }
      renderForecast();
    });
  });
  document.getElementById("fc-m-from").addEventListener("change",e=>{fcCustomM.from=e.target.value;renderForecast();});
  document.getElementById("fc-m-to").addEventListener("change",e=>{fcCustomM.to=e.target.value;renderForecast();});
  document.getElementById("fc-q-from").addEventListener("change",e=>{fcCustomQ.from=e.target.value;renderForecast();});
  document.getElementById("fc-q-to").addEventListener("change",e=>{fcCustomQ.to=e.target.value;renderForecast();});
}

function fi() { return document.getElementById("file-input"); }

// ── Nudge ─────────────────────────────────────────────────────────────────────
function checkNudge() { const ts=localStorage.getItem(K.upload); if(!ts) return; if(localStorage.getItem(K.nudge)===todayStr()) return; if((Date.now()-new Date(ts))/86400000>=3) document.getElementById("nudge-banner").classList.add("show"); }
function dismissNudge() { localStorage.setItem(K.nudge,todayStr()); document.getElementById("nudge-banner").classList.remove("show"); }
function todayStr() { return new Date().toISOString().slice(0,10); }

// ── File handling ─────────────────────────────────────────────────────────────
function onFile(e) {
  const file=e.target.files[0]; if(!file) return;
  const isXL=/\.(xlsx|xls)$/i.test(file.name);
  const reader=new FileReader();
  reader.onload=ev=>{
    try { const rows=isXL?parseXLSX(ev.target.result):parseCSV(ev.target.result); if(!rows.length){showToast("No data rows found","err");return;} importData(rows); }
    catch(err){showToast("Parse error: "+err.message,"err");}
    e.target.value="";
  };
  if(isXL) reader.readAsArrayBuffer(file); else reader.readAsText(file);
}

function parseXLSX(ab) {
  const wb=XLSX.read(ab,{type:"array",cellDates:true});
  const ws=wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws,{defval:""}).map(row=>{
    const low={}; Object.keys(row).forEach(k=>{low[k.trim().toLowerCase()]=String(row[k]??"").trim();}); return normalise(low);
  }).filter(Boolean);
}

function parseCSV(text) {
  const lines=text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n");
  if(lines.length<2) return [];
  const headers=splitRow(lines[0]).map(h=>h.trim().toLowerCase());
  const rows=[];
  for(let i=1;i<lines.length;i++){
    if(!lines[i].trim()) continue;
    const vals=splitRow(lines[i]); const obj={}; headers.forEach((h,j)=>{obj[h]=(vals[j]||"").trim();}); const n=normalise(obj); if(n) rows.push(n);
  }
  return rows;
}

function splitRow(line) {
  const cols=[];let cur="",inQ=false;
  for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}else if(c===","&&!inQ){cols.push(cur);cur="";}else cur+=c;}
  cols.push(cur);return cols;
}

function gf(row,...keys){for(const k of keys)if(row[k]!==undefined&&row[k]!=="")return row[k];return "";}

function normalise(row) {
  const name=gf(row,"opportunity name","name","topic","subject","title","opportunity"); if(!name) return null;
  const id=gf(row,"opportunityid","id","opportunity id","crm id")||slugify(name)+"-"+uid();
  const rawStage=gf(row,"sales stage","stage","stepname","step name","pipeline stage","rating stage","deal stage");
  const stage=matchStage(rawStage);
  const rawStatus=gf(row,"status reason","status","statuscode","state","deal status");
  const status=matchStatus(rawStatus);
  const rawDate=gf(row,"est. close or rfx due date","rfx due date","est. close date","close date","estimated close date","closedate","target close date","expected close date","due date");
  const closeDate=toISO(rawDate);
  const value=parseMoney(gf(row,"est. revenue","estimated revenue","estimated value","revenue","value","deal size","amount","deal value","contract value"));
  const account=gf(row,"account name","account","company","customer","organisation","organization");
  const owner=gf(row,"owner","owning user","assigned to","salesperson","sales rep");

  // Collect all recognised HubSpot date fields present in this row
  const allDates={};
  Object.keys(HS_DATE_FIELDS).forEach(key=>{
    if(row[key]){const iso=toISO(row[key]);if(iso)allDates[HS_DATE_FIELDS[key]]=iso;}
  });

  return {id,name,account,owner,stage,status,value,closeDate,allDates,margin:null,description:"",_manual:false,addedToCRM:false,addedToCRMDate:null,_isNew:false};
}

function matchStage(raw) { if(!raw) return config.stages[0]?.id||"C"; const r=raw.trim().toUpperCase(); const ex=config.stages.find(s=>s.label.toUpperCase()===r||s.id.toUpperCase()===r); return ex?ex.id:config.stages[0]?.id||"C"; }
function matchStatus(raw) {
  if(!raw) return config.statuses.find(s=>!s.terminal)?.id||"active";
  const r=raw.trim().toLowerCase();
  const ex=config.statuses.find(s=>s.label.toLowerCase()===r||s.id.toLowerCase()===r); if(ex) return ex.id;
  if(r.includes("won")||r.includes("closed won")) return config.statuses.find(s=>s.id==="won")?.id||config.statuses.find(s=>s.terminal)?.id;
  if(r.includes("lost")||r.includes("closed lost")||r.includes("cancel")) return config.statuses.find(s=>s.id==="lost")?.id||config.statuses.filter(s=>s.terminal)[1]?.id||config.statuses.find(s=>s.terminal)?.id||config.statuses[0]?.id||"active";
  if(r.includes("hold")) return config.statuses.find(s=>s.id==="on-hold"||s.label.toLowerCase().includes("hold"))?.id||config.statuses.find(s=>!s.terminal)?.id||"active";
  return config.statuses.find(s=>!s.terminal)?.id||"active";
}
function slugify(s){return s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");}

// ── Import & diff ─────────────────────────────────────────────────────────────
function importData(incoming) {
  const manuals=opportunities.filter(o=>o._manual);
  const oldMap=new Map(opportunities.filter(o=>!o._manual).map(o=>[o.id,o]));
  const added=incoming.filter(o=>!oldMap.has(o.id));
  const removed=opportunities.filter(o=>!o._manual&&!new Map(incoming.map(x=>[x.id,x])).has(o.id));
  const imported=incoming.map(o=>{const old=oldMap.get(o.id); return {...o,stage:old?old.stage:o.stage,status:old?old.status:o.status,value:old?old.value:o.value,closeDate:old?old.closeDate:o.closeDate,margin:old?(old.margin??null):null,description:old?(old.description||""):"",ps:old?(old.ps||null):null,lineItems:old?(old.lineItems||null):null,_manual:false,addedToCRM:false,addedToCRMDate:null,_isNew:!old};});
  // Detect manual opps that now appear in the import (by name match)
  const importedNames=new Set(incoming.map(o=>o.name.toLowerCase()));
  const nowInCRM=manuals.filter(o=>!o.addedToCRM&&importedNames.has(o.name.toLowerCase()));
  if(nowInCRM.length) setTimeout(()=>showToast(`${nowInCRM.length} manual deal${nowInCRM.length>1?"s":""} found in import — check the Manual tab`),1200);
  opportunities=[...imported,...manuals];
  updateManualTabBadge();
  updateExpiryBadge();
  persistOpps();
  localStorage.setItem(K.upload,new Date().toISOString());
  refreshLastUpload(); dismissNudge();
  diffState={added,removed};
  showDiff(added,removed);
  buildFilterChips(); renderView();
  showToast(`Imported ${incoming.length} opportunit${incoming.length===1?"y":"ies"}`,"ok");
}

function showDiff(added,removed) {
  if(!added.length&&!removed.length){document.getElementById("diff-banner").classList.remove("show");return;}
  const tag=(n,c)=>n?`<span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;background:${c==="new"?"#e3fcef":"#ffebe6"};color:${c==="new"?"#006644":"#bf2600"}">${c==="new"?"+":"−"}${n} ${c==="new"?"added":"removed"}</span>`:"";
  document.getElementById("diff-new-tag").innerHTML=tag(added.length,"new");
  document.getElementById("diff-rm-tag").innerHTML=tag(removed.length,"rm");
  const parts=[]; if(added.length) parts.push(added.map(o=>o.name).join(", ")); if(removed.length) parts.push("Removed: "+removed.map(o=>o.name).join(", "));
  document.getElementById("diff-detail").textContent=parts.join(" · ").slice(0,120);
  document.getElementById("diff-banner").classList.add("show");
}

function refreshLastUpload() { const ts=localStorage.getItem(K.upload); const el=document.getElementById("last-upload"); if(!ts){el.textContent="";return;} const diff=Math.floor((Date.now()-new Date(ts))/86400000); el.textContent="Updated "+(diff===0?"today":diff===1?"yesterday":diff+" days ago"); }
function persistOpps() { ss(K.data,opportunities.map(o=>({...o,_isNew:false}))); }
function touchActivity(id) { activity[id]=new Date().toISOString(); ss(K.activity,activity); }

// ── Stage helpers ─────────────────────────────────────────────────────────────
function stageWeight(id){ return config.stages.find(s=>s.id===id)?.weight??0; }
function stageColor(id) { return config.stages.find(s=>s.id===id)?.color??"#888"; }
function statusObj(id)   { return config.statuses.find(s=>s.id===id)||null; }

// ── Filters ───────────────────────────────────────────────────────────────────
function buildFilterChips() {
  const sc=document.getElementById("f-status-chips"); const gc=document.getElementById("f-stage-chips");
  sc.innerHTML=""; gc.innerHTML="";
  config.statuses.forEach(s=>{const ch=mkChip(s.label,filters.statuses.has(s.id));ch.addEventListener("click",()=>{filters.statuses.has(s.id)?filters.statuses.delete(s.id):filters.statuses.add(s.id);ch.classList.toggle("on");applyFilters();});sc.appendChild(ch);});
  config.stages.forEach(s=>{const ch=mkChip(s.label,filters.stages.has(s.id));ch.addEventListener("click",()=>{filters.stages.has(s.id)?filters.stages.delete(s.id):filters.stages.add(s.id);ch.classList.toggle("on");applyFilters();});gc.appendChild(ch);});
}
function mkChip(label,active){const el=document.createElement("button");el.className="f-chip"+(active?" on":"");el.textContent=label;return el;}
function toggleFilters(){filterOpen=!filterOpen;document.getElementById("filter-bar").classList.toggle("open",filterOpen);document.getElementById("btn-filter").classList.toggle("active",filterOpen);}
function applyFilters(){updateFilterCount();renderView();}
function clearFilters(){
  filters={statuses:new Set(),stages:new Set(),dateFrom:"",dateTo:"",valMin:"",valMax:"",company:""};
  document.getElementById("f-date-preset").value="";
  document.getElementById("f-date-from").value="";document.getElementById("f-date-to").value="";
  document.getElementById("f-date-custom").style.display="none";
  document.getElementById("f-val-min").value="";document.getElementById("f-val-max").value="";
  document.getElementById("f-company").value="";
  buildFilterChips();applyFilters();
}
function updateFilterCount(){const dateActive=(filters.dateFrom||filters.dateTo)?1:0;const n=filters.statuses.size+filters.stages.size+dateActive+(filters.valMin?1:0)+(filters.valMax?1:0)+(filters.company?1:0);const el=document.getElementById("filter-count");el.textContent=n||"";el.classList.toggle("show",n>0);}
function resolveDatePreset(preset){
  if(!preset) return {from:"",to:""};
  const now=new Date(); now.setHours(0,0,0,0);
  const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const add=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;};
  const fy=(y,m)=>{const d=new Date(y,m,1);return d;};
  const ly=(y,m)=>{const d=new Date(y,m+1,0);return d;};
  const y=now.getFullYear(), m=now.getMonth();
  const qtr=Math.floor(m/3); // 0-3
  const qStart=(yr,q)=>fy(yr,q*3);
  const qEnd=(yr,q)=>ly(yr,q*3+2);
  const weekStart=d=>{const x=new Date(d);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;};
  const monthStart=(yr,mo)=>fy(yr,mo);
  const monthEnd=(yr,mo)=>ly(yr,mo);
  const map={
    today:        {from:iso(now),         to:iso(now)},
    tomorrow:     {from:iso(add(now,1)),  to:iso(add(now,1))},
    this_week:    {from:iso(weekStart(now)),to:iso(add(weekStart(now),6))},
    last_week:    {from:iso(add(weekStart(now),-7)),to:iso(add(weekStart(now),-1))},
    next_week:    {from:iso(add(weekStart(now),7)), to:iso(add(weekStart(now),13))},
    this_month:   {from:iso(monthStart(y,m)),   to:iso(monthEnd(y,m))},
    last_month:   {from:iso(monthStart(y,m-1)), to:iso(monthEnd(y,m-1))},
    next_month:   {from:iso(monthStart(y,m+1)), to:iso(monthEnd(y,m+1))},
    this_quarter: {from:iso(qStart(y,qtr)),     to:iso(qEnd(y,qtr))},
    last_quarter: {from:iso(qStart(y,qtr>0?qtr-1:3)), to:iso(qEnd(y,qtr>0?qtr-1:3))},
    next_quarter: {from:iso(qStart(y,qtr<3?qtr+1:0)), to:iso(qEnd(y,qtr<3?qtr+1:0))},
    this_year:    {from:iso(fy(y,0)),  to:iso(ly(y,11))},
    last_year:    {from:iso(fy(y-1,0)),to:iso(ly(y-1,11))},
    next_year:    {from:iso(fy(y+1,0)),to:iso(ly(y+1,11))},
    last_7:       {from:iso(add(now,-6)),  to:iso(now)},
    last_30:      {from:iso(add(now,-29)), to:iso(now)},
    last_90:      {from:iso(add(now,-89)), to:iso(now)},
    last_365:     {from:iso(add(now,-364)),to:iso(now)},
    next_30:      {from:iso(now), to:iso(add(now,30))},
    next_90:      {from:iso(now), to:iso(add(now,90))},
    q1_this:{from:iso(qStart(y,0)),  to:iso(qEnd(y,0))},
    q2_this:{from:iso(qStart(y,1)),  to:iso(qEnd(y,1))},
    q3_this:{from:iso(qStart(y,2)),  to:iso(qEnd(y,2))},
    q4_this:{from:iso(qStart(y,3)),  to:iso(qEnd(y,3))},
    q1_last:{from:iso(qStart(y-1,0)),to:iso(qEnd(y-1,0))},
    q2_last:{from:iso(qStart(y-1,1)),to:iso(qEnd(y-1,1))},
    q3_last:{from:iso(qStart(y-1,2)),to:iso(qEnd(y-1,2))},
    q4_last:{from:iso(qStart(y-1,3)),to:iso(qEnd(y-1,3))},
    q1_next:{from:iso(qStart(y+1,0)),to:iso(qEnd(y+1,0))},
    q2_next:{from:iso(qStart(y+1,1)),to:iso(qEnd(y+1,1))},
    q3_next:{from:iso(qStart(y+1,2)),to:iso(qEnd(y+1,2))},
    q4_next:{from:iso(qStart(y+1,3)),to:iso(qEnd(y+1,3))},
  };
  // handle last_quarter / next_quarter year roll
  if(preset==="last_quarter"){const lq=qtr===0?3:qtr-1;const ly2=qtr===0?y-1:y;return{from:iso(qStart(ly2,lq)),to:iso(qEnd(ly2,lq))};}
  if(preset==="next_quarter"){const nq=qtr===3?0:qtr+1;const ny=qtr===3?y+1:y;return{from:iso(qStart(ny,nq)),to:iso(qEnd(ny,nq))};}
  return map[preset]||{from:"",to:""};
}

function applyOpFilters(opps){
  const q=document.getElementById("search").value.trim().toLowerCase();
  return opps.filter(o=>{
    if(q&&!o.name.toLowerCase().includes(q)&&!(o.account||"").toLowerCase().includes(q)&&!(o.owner||"").toLowerCase().includes(q)) return false;
    if(filters.company&&!(o.account||"").toLowerCase().includes(filters.company)) return false;
    if(filters.statuses.size&&!filters.statuses.has(o.status)) return false;
    if(filters.stages.size&&!filters.stages.has(o.stage)) return false;
    if(filters.dateFrom&&o.closeDate&&o.closeDate<filters.dateFrom) return false;
    if(filters.dateTo&&o.closeDate&&o.closeDate>filters.dateTo) return false;
    if(filters.valMin&&o.value<+filters.valMin) return false;
    if(filters.valMax&&o.value>+filters.valMax) return false;
    return true;
  });
}

// ── View routing ──────────────────────────────────────────────────────────────
function renderView() {
  const hasData=opportunities.length>0||currentView==="manual"||currentView==="expiry"||currentView==="tasks";
  document.getElementById("board").style.display="none";
  document.getElementById("list-view").classList.remove("show");
  document.getElementById("forecast-view").classList.remove("show");
  document.getElementById("manual-view").classList.remove("show");
  document.getElementById("expiry-view").style.display="none";
  document.getElementById("tasks-view").style.display="none";
  document.getElementById("empty-state").classList.remove("show");
  document.getElementById("filter-bar").style.display="";
  if(!hasData){document.getElementById("empty-state").classList.add("show");return;}
  if(currentView==="kanban"){document.getElementById("board").style.display="flex";renderBoard();}
  else if(currentView==="list"){document.getElementById("list-view").classList.add("show");renderList();}
  else if(currentView==="forecast"){document.getElementById("forecast-view").classList.add("show");document.getElementById("filter-bar").style.display="none";renderForecast();}
  else if(currentView==="manual"){document.getElementById("manual-view").classList.add("show");document.getElementById("filter-bar").style.display="none";renderManual();}
  else if(currentView==="expiry"){document.getElementById("expiry-view").style.display="block";document.getElementById("filter-bar").style.display="none";renderExpiry();}
  else if(currentView==="tasks"){document.getElementById("tasks-view").style.display="block";document.getElementById("filter-bar").style.display="none";renderTasks();}
}

// ── Kanban rendering ──────────────────────────────────────────────────────────
function renderBoard() {
  const board=document.getElementById("board"); board.innerHTML="";
  const visible=applyOpFilters(opportunities);
  const nonTermIds=new Set(config.statuses.filter(s=>!s.terminal).map(s=>s.id));
  const allStatusIds=new Set(config.statuses.map(s=>s.id));
  const allStageIds=new Set(config.stages.map(s=>s.id));
  // Silently remap in-memory any opp whose stage ID no longer exists
  visible.filter(o=>!allStageIds.has(o.stage)).forEach(o=>{o.stage=config.stages[0]?.id||o.stage;});
  config.stages.forEach(stage=>{board.appendChild(buildColumn(stage,visible.filter(o=>o.stage===stage.id&&(nonTermIds.has(o.status)||!allStatusIds.has(o.status))),false));});
  config.statuses.filter(s=>s.terminal).forEach(st=>{board.appendChild(buildColumn({id:"__"+st.id,label:st.label,weight:null,color:st.color},visible.filter(o=>o.status===st.id),true));});
}

function buildColumn(stage,opps,isTerminal){
  const col=document.createElement("div"); col.className="column"+(isTerminal?" terminal":""); col.dataset.key=stage.id; col.style.setProperty("--col-color",stage.color);
  const pipeline=opps.reduce((s,o)=>s+(o.value||0),0);
  const weighted=isTerminal?pipeline:opps.reduce((s,o)=>s+(o.value||0)*stageWeight(o.stage)/100,0);
  const wLabel=isTerminal?"":stage.weight+"%";
  col.innerHTML=`<div class="col-header"><div class="col-h1"><span class="col-name">${esc(stage.label)}</span>${wLabel?`<span class="col-weight">${wLabel}</span>`:""}<span class="col-count">${opps.length}</span></div>${pipeline>0?`<div class="col-h2"><span class="col-pipeline">Pipeline ${fmt(pipeline)}</span><span class="col-weighted">Wtd ${fmt(weighted)}</span></div>`:""}</div><div class="col-body" data-key="${stage.id}">${!opps.length?'<p class="col-empty">Drop here</p>':""}</div>`;
  const body=col.querySelector(".col-body");
  body.addEventListener("dragover",e=>{e.preventDefault();body.classList.add("drag-over");});
  body.addEventListener("dragleave",e=>{if(!body.contains(e.relatedTarget))body.classList.remove("drag-over");});
  body.addEventListener("drop",e=>{e.preventDefault();body.classList.remove("drag-over");if(dragCard)onDrop(dragCard,stage);});
  opps.forEach(o=>body.appendChild(buildCard(o,stage)));
  return col;
}

function buildCard(opp,stage){
  const card=document.createElement("div"); card.className="card"; card.draggable=true; card.dataset.id=opp.id;
  const stObj=statusObj(opp.status); const stColor=stObj?.color||"#888";
  const weight=stageWeight(opp.stage); const wVal=(opp.value||0)*weight/100;
  card.style.borderLeftColor=stage.color; card.style.setProperty("--col-color",stage.color);
  if(stObj&&!stObj.terminal&&opp.status!==config.statuses.find(s=>!s.terminal)?.id) card.classList.add("status-on-hold");
  if(opp._isNew) card.style.outline="2px solid #10b981";
  const statusOptions=config.statuses.map(s=>`<option value="${esc(s.id)}"${s.id===opp.status?" selected":""}>${esc(s.label)}</option>`).join("");
  const actTs=activity[opp.id];
  const marg=effMargin(opp);
  card.innerHTML=`
    ${opp._isNew?'<span class="card-badge badge-new">New</span>':""}
    <a class="card-name-link">${esc(opp.name)}</a>
    ${opp.account?`<div class="card-account">${esc(opp.account)}</div>`:""}
    <div class="card-value-row">
      <span class="card-value">${opp.value?fmt(opp.value):"—"}</span>
      ${wVal>0?`<span class="card-weighted">Wtd <strong>${fmt(wVal)}</strong></span>`:""}
      ${opp.value?`<span class="card-margin-pill">${marg}% · ${fmt(marginVal(opp))}</span>`:""}
    </div>
    <div class="card-meta">
      <span class="card-date ${dateCss(opp.closeDate)}" title="Click to edit">${dateLabel(opp.closeDate)}</span>
      <select class="status-pill" style="background:${stColor}20;color:${stColor};border:1.5px solid ${stColor}60">${statusOptions}</select>
    </div>
    ${(()=>{const rc=expiryClass(opp.dealRegExpiry);return rc?`<div style="margin-top:4px"><span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:${rc==='overdue'?'#fde8e8':'#fff3cd'};color:${rc==='overdue'?'#de350b':'#ff8b00'}">REG EXP${opp.dealId?` · ${esc(opp.dealId)}`:''}</span></div>`:"";})()}
    ${actTs?`<div class="card-activity">Last: ${fmtActivityShort(actTs)}</div>`:""}`;

  card.addEventListener("dragstart",e=>{dragCard=card;card.classList.add("dragging");e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",opp.id);});
  card.addEventListener("dragend",()=>{card.classList.remove("dragging");dragCard=null;});
  card.querySelector(".card-name-link").addEventListener("click",e=>{e.stopPropagation();openOppDetail(opp.id,"details");});
  card.querySelector(".card-value").addEventListener("click",e=>{e.stopPropagation();startValueEdit(opp,card.querySelector(".card-value"),()=>renderBoard());});
  card.querySelector(".card-value").addEventListener("mousedown",e=>e.stopPropagation());
  card.querySelector(".card-date").addEventListener("click",e=>{e.stopPropagation();startDateEdit(opp,card.querySelector(".card-date"),()=>renderBoard());});
  card.querySelector(".card-date").addEventListener("mousedown",e=>e.stopPropagation());
  const sel=card.querySelector(".status-pill");
  sel.addEventListener("mousedown",e=>e.stopPropagation());
  sel.addEventListener("change",()=>onStatusChange(opp,sel.value,()=>renderBoard()));
  return card;
}

function dateCss(iso) { const d=daysDiff(iso); if(d===null) return ""; if(d<0) return "overdue"; if(d<=14) return "soon"; return ""; }
function dateLabel(iso) { if(!iso) return "Set date"; const d=daysDiff(iso); const label=fmtDate(iso); if(d<0) return "⚠ "+label; if(d<=14) return "⏳ "+label; return label; }

// ── Inline edits ──────────────────────────────────────────────────────────────
function startValueEdit(opp,el,onDone){
  const input=document.createElement("input"); input.className="card-value-input"; input.type="number"; input.value=opp.value||""; input.placeholder="Enter value";
  el.replaceWith(input); input.focus(); input.select();
  function commit(){const v=Math.max(0,parseFloat(input.value)||0);opp.value=v;touchActivity(opp.id);persistOpps();onDone();showToast("Value → "+fmt(v));}
  input.addEventListener("blur",commit);
  input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();input.blur();}if(e.key==="Escape"){input.removeEventListener("blur",commit);onDone();}e.stopPropagation();});
  input.addEventListener("mousedown",e=>e.stopPropagation());
}

function startDateEdit(opp,el,onDone){
  const input=document.createElement("input"); input.className="card-date-input"; input.type="date"; input.value=opp.closeDate||"";
  el.replaceWith(input); input.focus(); input.showPicker?.();
  function commit(){const v=input.value;opp.closeDate=v;touchActivity(opp.id);persistOpps();onDone();showToast(v?"Close date → "+fmtDate(v):"Close date cleared");}
  input.addEventListener("blur",commit);
  input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();input.blur();}if(e.key==="Escape"){input.removeEventListener("blur",commit);onDone();}e.stopPropagation();});
  input.addEventListener("mousedown",e=>e.stopPropagation());
}

function onStatusChange(opp,newId,onDone){const st=statusObj(newId);if(!st)return;opp.status=newId;touchActivity(opp.id);persistOpps();onDone();showToast("Status → "+st.label);}

function onDrop(cardEl,targetStage){
  const id=cardEl.dataset.id; const opp=opportunities.find(o=>o.id===id); if(!opp) return;
  const isTermTarget=targetStage.id.startsWith("__");
  if(isTermTarget){const statusId=targetStage.id.slice(2);const st=statusObj(statusId);if(st&&st.terminal){opp.status=statusId;touchActivity(opp.id);persistOpps();renderView();showToast("Moved to "+st.label);}}
  else{const wasTerminal=statusObj(opp.status)?.terminal;opp.stage=targetStage.id;if(wasTerminal)opp.status=config.statuses.find(s=>!s.terminal)?.id||opp.status;touchActivity(opp.id);persistOpps();renderView();showToast("Moved to "+targetStage.label);}
}

// ── List view ─────────────────────────────────────────────────────────────────
const LIST_COLS=[{key:"name",label:"Opportunity"},{key:"account",label:"Account"},{key:"stage",label:"Stage"},{key:"status",label:"Status"},{key:"value",label:"Value",num:true},{key:"weighted",label:"Weighted",num:true},{key:"margin",label:"Margin",num:true},{key:"closeDate",label:"Close Date"},{key:"activity",label:"Last Activity"},{key:"owner",label:"Owner"}];

function renderList(){
  const opps=sortOpps(applyOpFilters(opportunities));
  renderListHead();
  const tbody=document.getElementById("list-tbody"); tbody.innerHTML="";
  opps.forEach(o=>{
    const weight=stageWeight(o.stage); const wVal=(o.value||0)*weight/100;
    const stObj2=statusObj(o.status); const stColor=stObj2?.color||"#888";
    const stageObj=config.stages.find(s=>s.id===o.stage); const stagColor=stageObj?.color||"#888";
    const dClass=dateCss(o.closeDate); const dLabel=fmtDate(o.closeDate);
    const actTs=activity[o.id];
    const stOpts=config.statuses.map(s=>`<option value="${esc(s.id)}"${s.id===o.status?" selected":""}>${esc(s.label)}</option>`).join("");
    const stOpts2=config.stages.map(s=>`<option value="${esc(s.id)}"${s.id===o.stage?" selected":""}>${esc(s.label)}</option>`).join("");
    const tr=document.createElement("tr"); tr.style.borderLeft=`3px solid ${stagColor}`;
    tr.innerHTML=`
      <td><span class="lt-name">${esc(o.name)}</span> <button class="lt-note-btn" title="Notes">📝</button></td>
      <td>${esc(o.account||"")}</td>
      <td><select class="lt-select lt-stage-sel">${stOpts2}</select></td>
      <td><select class="lt-select lt-status-sel" style="color:${stColor};border-color:${stColor}40">${stOpts}</select></td>
      <td><span class="lt-val">${o.value?fmt(o.value):"—"}</span></td>
      <td style="color:${stagColor};font-weight:600">${wVal>0?fmt(wVal):"—"}</td>
      <td style="color:#10b981;font-weight:600">${effMargin(o)}% · ${o.value?fmt(marginVal(o)):"—"}</td>
      <td><span class="lt-date${dClass?" "+dClass:""}">${dLabel||"—"}</span></td>
      <td class="lt-activity">${actTs?fmtActivityShort(actTs):""}</td>
      <td>${esc(o.owner||"")}</td>`;
    tr.querySelector(".lt-name").addEventListener("click",()=>openOppDetail(o.id,"details"));
    tr.querySelector(".lt-note-btn").addEventListener("click",()=>openOppDetail(o.id,"notes"));
    tr.querySelector(".lt-val").addEventListener("click",e=>{e.stopPropagation();startValueEdit(o,tr.querySelector(".lt-val"),()=>renderList());});
    tr.querySelector(".lt-date").addEventListener("click",e=>{e.stopPropagation();startDateEdit(o,tr.querySelector(".lt-date"),()=>renderList());});
    tr.querySelector(".lt-stage-sel").addEventListener("change",function(){const wasTerminal=statusObj(o.status)?.terminal;o.stage=this.value;if(wasTerminal)o.status=config.statuses.find(s=>!s.terminal)?.id||o.status;touchActivity(o.id);persistOpps();renderList();showToast("Stage → "+config.stages.find(s=>s.id===this.value)?.label);});
    tr.querySelector(".lt-status-sel").addEventListener("change",function(){onStatusChange(o,this.value,()=>renderList());});
    tbody.appendChild(tr);
  });
}

function renderListHead(){
  const row=document.getElementById("list-thead-row"); row.innerHTML="";
  LIST_COLS.forEach(col=>{
    const th=document.createElement("th"); const isSorted=listSort.col===col.key;
    th.innerHTML=`${esc(col.label)}<span class="sort-icon">${isSorted?(listSort.dir===1?"↑":"↓"):"↕"}</span>`;
    if(isSorted) th.classList.add("sorted");
    th.addEventListener("click",()=>{if(listSort.col===col.key)listSort.dir*=-1;else{listSort.col=col.key;listSort.dir=1;}renderList();});
    row.appendChild(th);
  });
}

function sortOpps(opps){
  return [...opps].sort((a,b)=>{
    let va,vb;
    if(listSort.col==="weighted"){va=(a.value||0)*stageWeight(a.stage)/100;vb=(b.value||0)*stageWeight(b.stage)/100;}
    else if(listSort.col==="margin"){va=effMargin(a);vb=effMargin(b);}
    else if(listSort.col==="activity"){va=activity[a.id]||"";vb=activity[b.id]||"";}
    else{va=a[listSort.col]||"";vb=b[listSort.col]||"";}
    if(typeof va==="number") return (va-vb)*listSort.dir;
    return String(va).localeCompare(String(vb))*listSort.dir;
  });
}

// ── Manual deals view ────────────────────────────────────────────────────────
function updateManualTabBadge(){
  const pending=opportunities.filter(o=>o._manual&&!o.addedToCRM).length;
  const btn=document.getElementById("manual-tab-btn");
  if(btn) btn.textContent=pending>0?`Manual (${pending})`:"Manual";
}

function renderManual(){
  const all=opportunities.filter(o=>o._manual);
  const visible=manualFilter==="pending"?all.filter(o=>!o.addedToCRM):manualFilter==="added"?all.filter(o=>o.addedToCRM):all;
  const el=document.getElementById("mv-list");
  if(!visible.length){
    el.innerHTML=`<div class="mv-empty">${all.length===0?"No manual deals yet. Click <strong>+ New Opportunity</strong> to add one.":"No deals match this filter."}</div>`;
    return;
  }
  el.innerHTML="";
  visible.sort((a,b)=>{if(a.addedToCRM!==b.addedToCRM)return a.addedToCRM?1:-1;return (b.value||0)-(a.value||0);}).forEach(o=>{
    const stageObj=config.stages.find(s=>s.id===o.stage);
    const stObj=statusObj(o.status);const stColor=stObj?.color||"#888";
    const card=document.createElement("div"); card.className="mv-card"+(o.addedToCRM?" added-crm":"");
    if(stageObj) card.style.borderLeftColor=stageObj.color;
    const noteCount=(notes[o.id]||[]).length;
    const fileData=oppFiles[o.id]||{files:[],sellQuotes:[],buyQuotes:[]};
    const fileCount=(fileData.files||[]).length+(fileData.sellQuotes||[]).length+(fileData.buyQuotes||[]).length;
    card.innerHTML=`
      <button class="mv-check${o.addedToCRM?" done":""}" data-id="${esc(o.id)}" title="${o.addedToCRM?"Mark as not added":"Mark as added to CRM"}">${o.addedToCRM?"✓":""}</button>
      <div class="mv-body">
        <div class="mv-name${o.addedToCRM?" done-name":""}">${esc(o.name)}</div>
        <div class="mv-meta">
          ${stageObj?`<span class="mv-badge" style="background:${stageObj.color}20;color:${stageObj.color}">${esc(stageObj.label)}</span>`:""}
          ${stObj?`<span class="mv-badge" style="background:${stColor}20;color:${stColor}">${esc(stObj.label)}</span>`:""}
          ${o.account?`<span>🏢 ${esc(o.account)}</span>`:""}
          ${o.value?`<span>💰 ${fmt(o.value)} · ${effMargin(o)}% margin</span>`:""}
          ${o.closeDate?`<span>📅 Closes ${fmtDate(o.closeDate)}</span>`:""}
          ${noteCount?`<span>📝 ${noteCount} note${noteCount>1?"s":""}</span>`:""}
          ${fileCount?`<span>📎 ${fileCount} file${fileCount>1?"s":""}</span>`:""}
          ${o.addedToCRM&&o.addedToCRMDate?`<span class="mv-crm-tag">✓ Added to CRM ${fmtDate(o.addedToCRMDate)}</span>`:""}
        </div>
      </div>
      <div class="mv-actions">
        <button class="mv-edit-btn" data-id="${esc(o.id)}">Edit</button>
        <button class="mv-del-btn" data-id="${esc(o.id)}">Delete</button>
      </div>`;
    card.querySelector(".mv-name").addEventListener("click",()=>openOppDetail(o.id,"details"));
    card.querySelector(".mv-check").addEventListener("click",()=>toggleAddedToCRM(o.id));
    card.querySelector(".mv-edit-btn").addEventListener("click",()=>openOppDetail(o.id,"details"));
    card.querySelector(".mv-del-btn").addEventListener("click",()=>{if(confirm("Delete this opportunity?"))deleteOpp(o.id);});
    el.appendChild(card);
  });
}

function toggleAddedToCRM(id){
  const o=opportunities.find(x=>x.id===id); if(!o) return;
  o.addedToCRM=!o.addedToCRM;
  o.addedToCRMDate=o.addedToCRM?todayStr():null;
  persistOpps(); renderManual(); updateManualTabBadge();
  showToast(o.addedToCRM?"Marked as Added to CRM ✓":"Unmarked","ok");
}

function openNewOppForm(){
  const over=document.getElementById("new-opp-overlay");
  document.getElementById("nop-name").value="";
  document.getElementById("nop-account").value="";
  document.getElementById("nop-value").value="";
  document.getElementById("nop-margin").value="";
  document.getElementById("nop-closedate").value="";
  document.getElementById("nop-owner").value="";
  document.getElementById("nop-desc").value="";
  const ss=document.getElementById("nop-stage"); ss.innerHTML=config.stages.map(s=>`<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("");
  const st=document.getElementById("nop-status"); st.innerHTML=config.statuses.map(s=>`<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("");
  over.classList.add("open");
  setTimeout(()=>document.getElementById("nop-name").focus(),100);
}

function closeNewOppForm(){document.getElementById("new-opp-overlay").classList.remove("open");}

function createManualOpp(){
  const name=document.getElementById("nop-name").value.trim();
  if(!name){document.getElementById("nop-name").focus();showToast("Name is required","err");return;}
  const mRaw=document.getElementById("nop-margin").value;
  const opp={
    id:"manual-"+uid(), name,
    account:document.getElementById("nop-account").value.trim(),
    owner:document.getElementById("nop-owner").value.trim(),
    stage:document.getElementById("nop-stage").value,
    status:document.getElementById("nop-status").value,
    value:Math.max(0,parseFloat(document.getElementById("nop-value").value)||0),
    closeDate:document.getElementById("nop-closedate").value,
    allDates:{}, margin:mRaw!==""?parseFloat(mRaw)||null:null,
    description:document.getElementById("nop-desc").value,
    _manual:true, addedToCRM:false, addedToCRMDate:null, _isNew:false
  };
  opportunities.push(opp);
  persistOpps(); closeNewOppForm(); updateManualTabBadge();
  if(currentView==="manual") renderManual();
  else { renderView(); }
  showToast("Opportunity created","ok");
}

// ── Notes panel (legacy — redirects to detail panel) ──────────────────────────
function closeNotes(){document.getElementById("notes-overlay").classList.remove("open");notesOppId=null;}
function submitNote(){}

// ── Forecast ──────────────────────────────────────────────────────────────────
function getOppDate(o){ if(!forecastDateField||forecastDateField==="") return o.closeDate; return o.allDates?.[forecastDateField]||""; }

function renderForecast(){
  const incWon=document.getElementById("fc-inc-won").checked;
  const incLost=document.getElementById("fc-inc-lost").checked;
  const termWon=config.statuses.find(s=>s.id==="won"||s.label.toLowerCase()==="won")?.id;
  const termLost=config.statuses.find(s=>s.id==="lost"||s.label.toLowerCase()==="lost")?.id;
  let pool=opportunities.filter(o=>{const st=statusObj(o.status);if(!st)return true;if(st.terminal){if(o.status===termWon)return incWon;if(o.status===termLost)return incLost;return false;}return true;});
  const dated=pool.filter(o=>getOppDate(o));
  const undated=pool.length-dated.length;
  document.getElementById("fc-undated").textContent=undated>0?`${undated} opp${undated===1?"":"s"} excluded (no date)`:"";

  // Populate date field dropdown
  const allFields=new Set();
  opportunities.forEach(o=>Object.keys(o.allDates||{}).forEach(k=>allFields.add(k)));
  const sel=document.getElementById("fc-date-field");
  const prev=sel.value;
  sel.innerHTML='<option value="">Close Date (default)</option>';
  [...allFields].sort().forEach(f=>{ const opt=document.createElement("option"); opt.value=f; opt.textContent=f; opt.selected=(f===prev); sel.appendChild(opt); });
  if(allFields.size===0) sel.parentElement.style.display="none"; else sel.parentElement.style.display="";

  const monthly=groupByMonth(dated);
  const quarterly=groupByQuarter(dated);
  renderForecastChart("chart-monthly",monthly,"monthly");
  renderForecastChart("chart-quarterly",quarterly,"quarterly");
  renderForecastTable("tbl-monthly","fc-monthly-total",monthly,"monthly");
  renderForecastTable("tbl-quarterly","fc-quarterly-total",quarterly,"quarterly");
  renderMarginForecast(monthly);
}

function monthRange(){
  const today=new Date();
  if(fcMonthWin==="customm"){
    if(!fcCustomM.from||!fcCustomM.to) return {start:today,count:12};
    const s=parseDate(fcCustomM.from), e=parseDate(fcCustomM.to);
    if(!s||!e) return {start:today,count:12};
    const count=(e.getFullYear()-s.getFullYear())*12+(e.getMonth()-s.getMonth())+1;
    return {start:s,count:Math.max(1,Math.min(count,60))};
  }
  const n=parseInt(fcMonthWin)||12;
  return {start:today,count:n};
}

function quarterRange(){
  const today=new Date();
  if(fcQuarWin==="customq"){
    if(!fcCustomQ.from||!fcCustomQ.to) return {startYear:today.getFullYear(),startQ:Math.floor(today.getMonth()/3),count:8};
    const s=parseDate(fcCustomQ.from), e=parseDate(fcCustomQ.to);
    if(!s||!e) return {startYear:today.getFullYear(),startQ:Math.floor(today.getMonth()/3),count:8};
    const sQ=Math.floor(s.getMonth()/3), eQ=Math.floor(e.getMonth()/3);
    const count=(e.getFullYear()-s.getFullYear())*4+(eQ-sQ)+1;
    return {startYear:s.getFullYear(),startQ:sQ,count:Math.max(1,Math.min(count,24))};
  }
  const n=parseInt(fcQuarWin)||8;
  return {startYear:today.getFullYear(),startQ:Math.floor(today.getMonth()/3),count:n};
}

function groupByMonth(opps){
  const {start,count}=monthRange();
  const buckets={};
  for(let i=0;i<count;i++){
    const d=new Date(start.getFullYear(),start.getMonth()+i,1);
    const key=`${d.getFullYear()}-${pad(d.getMonth()+1)}`;
    buckets[key]={label:d.toLocaleDateString("en-AU",{month:"short",year:"numeric"}),pipeline:0,weighted:0,count:0,totalWeight:0,totalMargin:0,marginRevenue:0,weightedMargin:0,oppIds:[]};
  }
  opps.forEach(o=>{const dt=getOppDate(o);if(!dt)return;const key=dt.slice(0,7);if(!buckets[key])return;const w=stageWeight(o.stage);const mv=marginVal(o);buckets[key].pipeline+=(o.value||0);buckets[key].weighted+=(o.value||0)*w/100;buckets[key].count++;buckets[key].totalWeight+=w;buckets[key].totalMargin+=effMargin(o);buckets[key].marginRevenue+=mv;buckets[key].weightedMargin+=mv*w/100;buckets[key].oppIds.push(o.id);});
  return Object.values(buckets);
}

function groupByQuarter(opps){
  const {startYear,startQ,count}=quarterRange();
  const buckets={};
  for(let i=0;i<count;i++){const q=(startQ+i)%4;const y=startYear+Math.floor((startQ+i)/4);const key=`${y}-Q${q+1}`;buckets[key]={label:`Q${q+1} ${y}`,pipeline:0,weighted:0,count:0,totalWeight:0,totalMargin:0,marginRevenue:0,weightedMargin:0,oppIds:[]};}
  opps.forEach(o=>{const dt=getOppDate(o);if(!dt)return;const [y,m]=dt.split("-").map(Number);const q=Math.floor((m-1)/3)+1;const key=`${y}-Q${q}`;if(!buckets[key])return;const w=stageWeight(o.stage);const mv=marginVal(o);buckets[key].pipeline+=(o.value||0);buckets[key].weighted+=(o.value||0)*w/100;buckets[key].count++;buckets[key].totalWeight+=w;buckets[key].totalMargin+=effMargin(o);buckets[key].marginRevenue+=mv;buckets[key].weightedMargin+=mv*w/100;buckets[key].oppIds.push(o.id);});
  return Object.values(buckets);
}

function renderForecastChart(canvasId,data,type){
  const el=document.getElementById(canvasId);
  if(type==="monthly"){if(chartMonthly){chartMonthly.destroy();chartMonthly=null;}}
  else{if(chartQuarterly){chartQuarterly.destroy();chartQuarterly=null;}}
  const chart=new Chart(el,{
    type:"bar",
    data:{labels:data.map(d=>d.label),datasets:[
      {label:"Pipeline",data:data.map(d=>d.pipeline),backgroundColor:"rgba(0,82,204,.18)",borderColor:"rgba(0,82,204,.7)",borderWidth:1.5,borderRadius:4},
      {label:"Weighted",data:data.map(d=>Math.round(d.weighted)),backgroundColor:"rgba(16,185,129,.25)",borderColor:"rgba(16,185,129,.8)",borderWidth:1.5,borderRadius:4},
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:"top",labels:{font:{size:11},boxWidth:12}},tooltip:{callbacks:{label:ctx=>" "+ctx.dataset.label+": "+fmt(ctx.parsed.y)}}},
      scales:{x:{grid:{display:false},ticks:{font:{size:11}}},y:{ticks:{font:{size:11},callback:v=>v>=1e6?fmt(v/1e6).replace("A$","")+"M":v>=1000?fmt(v/1000).replace("A$","")+"K":fmt(v)},grid:{color:"rgba(0,0,0,.05)"}}},
      onClick:(evt,elements)=>{if(elements.length){const b=data[elements[0].index];if(b.oppIds.length)openDrill(b);}}
    }
  });
  if(type==="monthly") chartMonthly=chart; else chartQuarterly=chart;
}

function renderForecastTable(tbodyId,totalId,data,type){
  const tbody=document.getElementById(tbodyId);
  let totalPipeline=0,totalWeighted=0,totalDeals=0;
  tbody.innerHTML=data.map(d=>{
    totalPipeline+=d.pipeline;totalWeighted+=d.weighted;totalDeals+=d.count;
    const avgW=d.count>0?Math.round(d.totalWeight/d.count):0;const zero=d.count===0;
    return `<tr data-ids="${esc(JSON.stringify(d.oppIds))}" data-label="${esc(d.label)}" data-pipeline="${d.pipeline}" data-weighted="${Math.round(d.weighted)}" style="cursor:${zero?"default":"pointer"}">
      <td>${esc(d.label)}</td>
      <td class="${zero?"zero":""}">${d.count||"—"}</td>
      <td class="${zero?"zero":""}">${d.pipeline?fmt(d.pipeline):"—"}</td>
      <td class="${zero?"zero":""}">${d.weighted?fmt(Math.round(d.weighted)):"—"}</td>
      <td class="${zero?"zero":""}">${d.count?avgW+"%":"—"}</td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("tr[data-ids]").forEach(tr=>{
    tr.addEventListener("click",()=>{
      try{const ids=JSON.parse(tr.dataset.ids);if(!ids.length)return;openDrill({oppIds:ids,label:tr.dataset.label,pipeline:+tr.dataset.pipeline,weighted:+tr.dataset.weighted,count:ids.length});}catch{}
    });
  });
  document.getElementById(totalId).textContent=totalDeals?`Total: ${totalDeals} deal${totalDeals===1?"":"s"} · Pipeline ${fmt(totalPipeline)} · Weighted ${fmt(Math.round(totalWeighted))}`:"";
}

// ── Drill-down panel ──────────────────────────────────────────────────────────
function openDrill(bucket){
  const opps=bucket.oppIds.map(id=>opportunities.find(o=>o.id===id)).filter(Boolean).sort((a,b)=>(b.value||0)-(a.value||0));
  document.getElementById("dp-title").textContent=bucket.label;
  document.getElementById("dp-sub").textContent=`${opps.length} deal${opps.length===1?"":"s"} · Pipeline ${fmt(bucket.pipeline)} · Weighted ${fmt(Math.round(bucket.weighted))}`;
  const tbody=document.getElementById("dp-tbody");
  if(!opps.length){tbody.innerHTML=`<tr><td colspan="7" class="dp-empty">No deals in this period.</td></tr>`;}
  else{
    tbody.innerHTML=opps.map(o=>{
      const stageObj=config.stages.find(s=>s.id===o.stage);const stObj=statusObj(o.status);const stColor=stObj?.color||"#888";
      const weight=stageWeight(o.stage);const wVal=(o.value||0)*weight/100;
      return `<tr>
        <td><span class="dp-name" data-id="${esc(o.id)}">${esc(o.name)}</span></td>
        <td>${esc(o.account||"")}</td>
        <td>${stageObj?`<span class="dp-stage" style="background:${stageObj.color}20;color:${stageObj.color}">${esc(stageObj.label)}</span>`:""}</td>
        <td><span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;background:${stColor}20;color:${stColor}">${esc(stObj?.label||"")}</span></td>
        <td>${o.value?fmt(o.value):"—"}</td>
        <td style="color:${stageObj?.color||"#888"};font-weight:600">${wVal>0?fmt(wVal):"—"}</td>
        <td>${fmtDate(o.closeDate)||"—"}</td>
      </tr>`;
    }).join("");
    tbody.querySelectorAll(".dp-name").forEach(el=>{
      el.addEventListener("click",()=>{closeDrill();openOppDetail(el.dataset.id,"notes");});
    });
  }
  document.getElementById("drill-overlay").classList.add("open");
}

function closeDrill(){document.getElementById("drill-overlay").classList.remove("open");}

// ── Margin forecast ───────────────────────────────────────────────────────────
function renderMarginForecast(monthly){
  if(chartMargin){chartMargin.destroy();chartMargin=null;}
  const el=document.getElementById("chart-margin");
  chartMargin=new Chart(el,{
    type:"bar",
    data:{labels:monthly.map(d=>d.label),datasets:[
      {label:"Margin Revenue",data:monthly.map(d=>Math.round(d.marginRevenue)),backgroundColor:"rgba(16,185,129,.25)",borderColor:"rgba(16,185,129,.8)",borderWidth:1.5,borderRadius:4},
      {label:"Wtd Margin",data:monthly.map(d=>Math.round(d.weightedMargin)),backgroundColor:"rgba(99,102,241,.2)",borderColor:"rgba(99,102,241,.7)",borderWidth:1.5,borderRadius:4},
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"top",labels:{font:{size:11},boxWidth:12}},tooltip:{callbacks:{label:ctx=>" "+ctx.dataset.label+": "+fmt(ctx.parsed.y)}}},scales:{x:{grid:{display:false},ticks:{font:{size:11}}},y:{ticks:{font:{size:11},callback:v=>v>=1e6?fmt(v/1e6).replace("A$","")+"M":v>=1000?fmt(v/1000).replace("A$","")+"K":fmt(v)},grid:{color:"rgba(0,0,0,.05)"}}}}
  });
  const tbody=document.getElementById("tbl-margin");
  let totMR=0,totWM=0,totDeals=0;
  tbody.innerHTML=monthly.map(d=>{
    totMR+=d.marginRevenue;totWM+=d.weightedMargin;totDeals+=d.count;
    const avgM=d.count>0?Math.round(d.totalMargin/d.count):0;const zero=d.count===0;
    return `<tr><td>${esc(d.label)}</td><td class="${zero?"zero":""}">${d.count||"—"}</td><td class="${zero?"zero":""}">${d.count?avgM+"%":"—"}</td><td class="${zero?"zero":""}">${d.marginRevenue?fmt(Math.round(d.marginRevenue)):"—"}</td><td class="${zero?"zero":""}">${d.weightedMargin?fmt(Math.round(d.weightedMargin)):"—"}</td></tr>`;
  }).join("");
  document.getElementById("fc-margin-total").textContent=totDeals?`Total: ${totDeals} deal${totDeals===1?"":"s"} · Margin Revenue ${fmt(Math.round(totMR))} · Wtd Margin ${fmt(Math.round(totWM))}`:"";
}

// ── Opportunity detail panel ──────────────────────────────────────────────────
function openOppDetail(oppId, tab="details"){
  currentOppDetailId=oppId;
  const opp=opportunities.find(o=>o.id===oppId); if(!opp) return;
  document.getElementById("op-title").textContent=opp.name;
  document.getElementById("op-account-sub").textContent=opp.account||"";
  document.getElementById("opp-overlay").classList.add("open");
  switchOppTab(tab);
}

function switchOppTab(tab){
  currentOppTab=tab;
  document.querySelectorAll(".op-tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===tab));
  document.querySelectorAll(".op-tab-pane").forEach(p=>p.classList.toggle("active",p.dataset.tab===tab));
  const opp=opportunities.find(o=>o.id===currentOppDetailId); if(!opp) return;
  if(tab==="details") renderOppDetails(opp);
  else if(tab==="notes") renderOppNotes(opp);
  else if(tab==="files") renderOppFiles(opp.id);
  else if(tab==="tasks") renderOppTasks(opp.id);
}

function updateOppTabCounts(oppId){
  const nc=(notes[oppId]||[]).length; const fd=getOppFileData(oppId); const fc=fd.files.length+fd.sellQuotes.length+fd.buyQuotes.length;
  const oppTasksOpen=tasks.filter(t=>t.oppId===oppId&&!t.done).length;
  const nt=document.querySelector(".op-tab[data-tab='notes']");
  const ft=document.querySelector(".op-tab[data-tab='files']");
  if(nt) nt.textContent=nc>0?`Notes (${nc})`:"Notes";
  if(ft) ft.textContent=fc>0?`Files (${fc})`:"Files";
  const badge=document.getElementById("op-tasks-badge");
  if(badge){badge.textContent=oppTasksOpen;badge.style.display=oppTasksOpen>0?"inline":"none";}
}

function renderOppDetails(opp){
  // Lazy migration: old ps → lineItems
  if(!opp.lineItems && opp.ps){
    opp.lineItems={
      hw:{sell:0,buy:0}, sw:{sell:0,buy:0},
      ps:{enabled:opp.ps.enabled||false,units:opp.ps.units||1,unitType:opp.ps.unitType||"days",buyRate:opp.ps.buy||1200,sellRate:opp.ps.sell||2000}
    };
  } else if(!opp.lineItems){
    opp.lineItems={hw:{sell:0,buy:0},sw:{sell:0,buy:0},ps:{enabled:false,units:1,unitType:"days",buyRate:1200,sellRate:2000}};
  }
  const li=opp.lineItems;
  const el=document.getElementById("op-details-pane");
  const w=stageWeight(opp.stage); const wVal=(opp.value||0)*w/100; const marg=effMargin(opp); const mVal=marginVal(opp);
  const stageOpts=config.stages.map(s=>`<option value="${esc(s.id)}"${s.id===opp.stage?" selected":""}>${esc(s.label)}</option>`).join("");
  const statusOpts=config.statuses.map(s=>`<option value="${esc(s.id)}"${s.id===opp.status?" selected":""}>${esc(s.label)}</option>`).join("");
  // Margin from quotes
  const fd=getOppFileData(opp.id);
  const latestSell=[...fd.sellQuotes].sort((a,b)=>b.addedAt.localeCompare(a.addedAt))[0];
  const latestBuy=[...fd.buyQuotes].sort((a,b)=>b.addedAt.localeCompare(a.addedAt))[0];
  const hasQuoteMargin=latestSell?.amount&&latestBuy?.amount&&latestSell.amount>0;
  const quoteMarginPct=hasQuoteMargin?Math.round(((latestSell.amount-latestBuy.amount)/latestSell.amount)*1000)/10:null;
  const quotePanelHtml=`<div class="op-quote-margin-panel" id="op-quote-margin-panel">
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Margin from Quotes</div>
    ${hasQuoteMargin?`
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <span style="font-size:12px">Sell: <strong>${fmt(latestSell.amount)}</strong></span>
      <span style="font-size:12px">Buy: <strong>${fmt(latestBuy.amount)}</strong></span>
      <span style="font-size:13px;font-weight:700;color:${quoteMarginPct>=0?"#10b981":"#de350b"}">${quoteMarginPct}% implied margin</span>
      <button class="op-push-margin-btn" id="op-push-margin-btn" data-margin="${quoteMarginPct}">↑ Push to Margin</button>
    </div>`:`<p style="font-size:12px;color:var(--muted);margin:0">Upload both a sell and buy quote with amounts to calculate implied margin.</p>`}
  </div>`;
  el.innerHTML=`<div class="op-form">
    <div class="op-2col">
      <div class="op-field"><label class="op-field-label">Opportunity Name</label><input class="op-input" id="op-f-name" value="${esc(opp.name)}" /></div>
      <div class="op-field"><label class="op-field-label">Account / Company</label><input class="op-input" id="op-f-account" value="${esc(opp.account||'')}" /></div>
      <div class="op-field"><label class="op-field-label">Stage</label><select class="op-select" id="op-f-stage">${stageOpts}</select></div>
      <div class="op-field"><label class="op-field-label">Status</label><select class="op-select" id="op-f-status">${statusOpts}</select></div>
      <div class="op-field"><label class="op-field-label">Value ($)</label><input class="op-input" id="op-f-value" type="number" min="0" value="${opp.value||''}" placeholder="0" /></div>
      <div class="op-field"><label class="op-field-label">Margin % <span style="font-weight:400;color:var(--muted)">(default ${config.defaultMargin??5}%)</span></label><input class="op-input" id="op-f-margin" type="number" min="0" max="100" step="0.1" value="${opp.margin!=null?opp.margin:''}" placeholder="${config.defaultMargin??5}" /></div>
      <div class="op-field"><label class="op-field-label">Close Date</label><input class="op-input" id="op-f-closedate" type="date" value="${opp.closeDate||''}" /></div>
      <div class="op-field"><label class="op-field-label">Owner</label><input class="op-input" id="op-f-owner" value="${esc(opp.owner||'')}" /></div>
      <div class="op-field"><label class="op-field-label">Deal ID <span style="font-weight:400;color:var(--muted)">(registration)</span></label><input class="op-input" id="op-f-dealid" value="${esc(opp.dealId||'')}" placeholder="e.g. REG-12345" /></div>
      <div class="op-field"><label class="op-field-label">Deal Reg Expiry ${opp.dealRegExpiry?`<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px;margin-left:4px;background:${expiryClass(opp.dealRegExpiry)==='overdue'?'#fde8e8':expiryClass(opp.dealRegExpiry)==='soon'?'#fff3cd':'#e8f5e9'};color:${expiryClass(opp.dealRegExpiry)==='overdue'?'#de350b':expiryClass(opp.dealRegExpiry)==='soon'?'#ff8b00':'#137333'}">${expiryClass(opp.dealRegExpiry)==='overdue'?'OVERDUE':expiryClass(opp.dealRegExpiry)==='soon'?'SOON':'OK'}</span>`:''}</label><input class="op-input" id="op-f-dealregexpiry" type="date" value="${opp.dealRegExpiry||''}" /></div>
    </div>
    <div class="op-calcs" id="op-calcs">
      <span class="op-calc-item">Weighted: <strong>${fmt(wVal)}</strong></span>
      <span class="op-calc-item">Margin Revenue: <strong>${fmt(mVal)}</strong></span>
      <span class="op-calc-item">Effective Margin: <strong>${marg}%</strong></span>
    </div>
    ${quotePanelHtml}
    <div class="op-li-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Line Items</span>
        <button class="op-push-margin-btn" id="op-li-load" style="font-size:11px">Load from Quotes</button>
      </div>
      <table class="op-li-table">
        <thead><tr><th></th><th>Sell ($)</th><th>Buy ($)</th><th>Margin</th></tr></thead>
        <tbody>
          <tr>
            <td style="font-size:12px;font-weight:600;color:var(--text)">Hardware</td>
            <td><input class="op-input op-li-input" id="li-hw-sell" type="number" min="0" value="${li.hw.sell||''}" placeholder="0" /></td>
            <td><input class="op-input op-li-input" id="li-hw-buy" type="number" min="0" value="${li.hw.buy||''}" placeholder="0" /></td>
            <td><span id="li-hw-marg" class="op-li-marg">—</span></td>
          </tr>
          <tr>
            <td style="font-size:12px;font-weight:600;color:var(--text)">Software</td>
            <td><input class="op-input op-li-input" id="li-sw-sell" type="number" min="0" value="${li.sw.sell||''}" placeholder="0" /></td>
            <td><input class="op-input op-li-input" id="li-sw-buy" type="number" min="0" value="${li.sw.buy||''}" placeholder="0" /></td>
            <td><span id="li-sw-marg" class="op-li-marg">—</span></td>
          </tr>
          <tr class="op-li-ps-row">
            <td style="font-size:12px;font-weight:600;color:var(--text)">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="checkbox" id="li-ps-toggle" ${li.ps.enabled?"checked":""} style="accent-color:var(--accent)" />
                Prof. Services
              </label>
              <div id="li-ps-unit-row" style="display:${li.ps.enabled?"flex":"none"};gap:6px;margin-top:6px;align-items:center">
                <input class="op-input op-li-input" id="li-ps-units" type="number" min="0" step="0.5" value="${li.ps.units}" style="width:60px" />
                <select class="op-select" id="li-ps-unit-type" style="width:80px;font-size:11px;padding:4px 6px">
                  <option value="hours"${li.ps.unitType==="hours"?" selected":""}>Hours</option>
                  <option value="days"${li.ps.unitType==="days"?" selected":""}>Days</option>
                  <option value="weeks"${li.ps.unitType==="weeks"?" selected":""}>Weeks</option>
                </select>
              </div>
            </td>
            <td>
              <div id="li-ps-sell-wrap" style="display:${li.ps.enabled?"block":"none"}">
                <label class="op-field-label" style="font-size:10px">Per unit</label>
                <input class="op-input op-li-input" id="li-ps-sell" type="number" min="0" value="${li.ps.sellRate}" placeholder="2000" />
              </div>
            </td>
            <td>
              <div id="li-ps-buy-wrap" style="display:${li.ps.enabled?"block":"none"}">
                <label class="op-field-label" style="font-size:10px">Per unit</label>
                <input class="op-input op-li-input" id="li-ps-buy" type="number" min="0" value="${li.ps.buyRate}" placeholder="1200" />
              </div>
            </td>
            <td><span id="li-ps-marg" class="op-li-marg">—</span></td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="op-li-total-row">
            <td style="font-size:12px;font-weight:700">TOTAL</td>
            <td style="font-weight:700"><span id="li-total-sell">—</span></td>
            <td style="font-weight:700"><span id="li-total-buy">—</span></td>
            <td><span id="li-total-marg" style="font-weight:700;color:var(--accent)">—</span></td>
          </tr>
        </tfoot>
      </table>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="op-save-btn" id="op-li-sync" style="padding:7px 16px;font-size:12px">Sync to Deal Value &amp; Margin</button>
      </div>
    </div>
    <div class="op-field op-field-full"><label class="op-field-label">Description / Notes</label><textarea class="op-textarea" id="op-f-desc" rows="4" placeholder="Add context, key info, or background about this opportunity…">${esc(opp.description||'')}</textarea></div>
    <div class="op-actions">
      <button class="op-save-btn" id="op-save-btn">Save Changes</button>
      <button class="op-delete-btn" id="op-delete-btn">Delete Opportunity</button>
    </div>
  </div>`;
  function recalc(){
    const v=parseFloat(document.getElementById("op-f-value").value)||0;
    const mRaw=document.getElementById("op-f-margin").value;
    const m=mRaw!==""?parseFloat(mRaw)||0:config.defaultMargin??5;
    const stId=document.getElementById("op-f-stage").value;
    const sw=stageWeight(stId);
    document.getElementById("op-calcs").innerHTML=`<span class="op-calc-item">Weighted: <strong>${fmt(v*sw/100)}</strong></span><span class="op-calc-item">Margin Revenue: <strong>${fmt(v*m/100)}</strong></span><span class="op-calc-item">Effective Margin: <strong>${m}%</strong></span>`;
  }
  function liveLineCalc(){
    const hwSell=parseFloat(document.getElementById("li-hw-sell").value)||0;
    const hwBuy=parseFloat(document.getElementById("li-hw-buy").value)||0;
    const swSell=parseFloat(document.getElementById("li-sw-sell").value)||0;
    const swBuy=parseFloat(document.getElementById("li-sw-buy").value)||0;
    const psOn=document.getElementById("li-ps-toggle").checked;
    const psUnits=parseFloat(document.getElementById("li-ps-units")?.value)||0;
    const psSellRate=parseFloat(document.getElementById("li-ps-sell")?.value)||0;
    const psBuyRate=parseFloat(document.getElementById("li-ps-buy")?.value)||0;
    const psSell=psOn?psSellRate*psUnits:0;
    const psBuy=psOn?psBuyRate*psUnits:0;
    const rowMarg=(s,b)=>s>0?Math.round((s-b)/s*1000)/10+"%" :"—";
    document.getElementById("li-hw-marg").textContent=rowMarg(hwSell,hwBuy);
    document.getElementById("li-sw-marg").textContent=rowMarg(swSell,swBuy);
    document.getElementById("li-ps-marg").textContent=psOn?rowMarg(psSell,psBuy):"—";
    const tSell=hwSell+swSell+psSell;
    const tBuy=hwBuy+swBuy+psBuy;
    document.getElementById("li-total-sell").textContent=tSell?fmt(tSell):"—";
    document.getElementById("li-total-buy").textContent=tBuy?fmt(tBuy):"—";
    document.getElementById("li-total-marg").textContent=rowMarg(tSell,tBuy);
  }
  ["op-f-value","op-f-margin","op-f-stage"].forEach(id=>document.getElementById(id)?.addEventListener("input",recalc));
  el.querySelectorAll(".op-li-input").forEach(inp=>inp.addEventListener("input",liveLineCalc));
  document.getElementById("li-ps-toggle").addEventListener("change",function(){
    document.getElementById("li-ps-unit-row").style.display=this.checked?"flex":"none";
    document.getElementById("li-ps-sell-wrap").style.display=this.checked?"block":"none";
    document.getElementById("li-ps-buy-wrap").style.display=this.checked?"block":"none";
    liveLineCalc();
  });
  liveLineCalc();
  document.getElementById("op-li-load").addEventListener("click",()=>{
    const fd2=getOppFileData(opp.id);
    let loaded=[];
    ["hw","sw","ps"].forEach(cat=>{
      const latestSell=[...fd2.sellQuotes].sort((a,b)=>b.addedAt.localeCompare(a.addedAt))
        .find(q=>(q.categories||[]).some(c=>c.type===cat));
      const latestBuy=[...fd2.buyQuotes].sort((a,b)=>b.addedAt.localeCompare(a.addedAt))
        .find(q=>(q.categories||[]).some(c=>c.type===cat));
      if(latestSell){
        const catAmt=(latestSell.categories||[]).find(c=>c.type===cat)?.amount||latestSell.amount||0;
        if(cat==="ps"){const u=parseFloat(document.getElementById("li-ps-units")?.value)||1;document.getElementById("li-ps-sell").value=u>0?Math.round(catAmt/u):catAmt;}
        else document.getElementById(`li-${cat}-sell`).value=catAmt||"";
        loaded.push(cat.toUpperCase()+" sell");
      }
      if(latestBuy){
        const catAmt=(latestBuy.categories||[]).find(c=>c.type===cat)?.amount||latestBuy.amount||0;
        if(cat==="ps"){const u=parseFloat(document.getElementById("li-ps-units")?.value)||1;document.getElementById("li-ps-buy").value=u>0?Math.round(catAmt/u):catAmt;}
        else document.getElementById(`li-${cat}-buy`).value=catAmt||"";
        loaded.push(cat.toUpperCase()+" buy");
      }
    });
    liveLineCalc();
    showToast(loaded.length?`Loaded: ${loaded.join(", ")}`:"No tagged quotes found","ok");
  });
  document.getElementById("op-li-sync").addEventListener("click",()=>{
    const hwSell=parseFloat(document.getElementById("li-hw-sell").value)||0;
    const hwBuy=parseFloat(document.getElementById("li-hw-buy").value)||0;
    const swSell=parseFloat(document.getElementById("li-sw-sell").value)||0;
    const swBuy=parseFloat(document.getElementById("li-sw-buy").value)||0;
    const psOn=document.getElementById("li-ps-toggle").checked;
    const psUnits=parseFloat(document.getElementById("li-ps-units")?.value)||0;
    const psSellRate=parseFloat(document.getElementById("li-ps-sell")?.value)||0;
    const psBuyRate=parseFloat(document.getElementById("li-ps-buy")?.value)||0;
    const psSell=psOn?psSellRate*psUnits:0;
    const psBuy=psOn?psBuyRate*psUnits:0;
    const tSell=hwSell+swSell+psSell;
    const tBuy=hwBuy+swBuy+psBuy;
    const blended=tSell>0?Math.round((tSell-tBuy)/tSell*1000)/10:0;
    document.getElementById("op-f-value").value=tSell.toFixed(2);
    document.getElementById("op-f-margin").value=blended;
    recalc();
    showToast(`Synced: Value ${fmt(tSell)} · Margin ${blended}%`,"ok");
  });
  document.getElementById("op-push-margin-btn")?.addEventListener("click",function(){
    document.getElementById("op-f-margin").value=this.dataset.margin;
    recalc(); showToast("Quote margin pushed to deal");
  });
  document.getElementById("op-save-btn").addEventListener("click",()=>saveOppDetail(opp));
  document.getElementById("op-delete-btn").addEventListener("click",()=>deleteOpp(opp.id));
  updateOppTabCounts(opp.id);
}

function saveOppDetail(opp){
  opp.name=document.getElementById("op-f-name").value.trim()||opp.name;
  opp.account=document.getElementById("op-f-account").value.trim();
  opp.owner=document.getElementById("op-f-owner").value.trim();
  opp.stage=document.getElementById("op-f-stage").value;
  opp.status=document.getElementById("op-f-status").value;
  opp.value=Math.max(0,parseFloat(document.getElementById("op-f-value").value)||0);
  const mRaw=document.getElementById("op-f-margin").value;
  opp.margin=mRaw!==""?Math.max(0,Math.min(100,parseFloat(mRaw)||0)):null;
  opp.closeDate=document.getElementById("op-f-closedate").value;
  opp.dealId=document.getElementById("op-f-dealid").value.trim();
  opp.dealRegExpiry=document.getElementById("op-f-dealregexpiry").value;
  opp.description=document.getElementById("op-f-desc").value;
  // Line items
  const liHwSell=parseFloat(document.getElementById("li-hw-sell")?.value)||0;
  const liHwBuy=parseFloat(document.getElementById("li-hw-buy")?.value)||0;
  const liSwSell=parseFloat(document.getElementById("li-sw-sell")?.value)||0;
  const liSwBuy=parseFloat(document.getElementById("li-sw-buy")?.value)||0;
  const liPsOn=document.getElementById("li-ps-toggle")?.checked||false;
  const liPsUnits=parseFloat(document.getElementById("li-ps-units")?.value)||1;
  const liPsUnitType=document.getElementById("li-ps-unit-type")?.value||"days";
  const liPsSell=parseFloat(document.getElementById("li-ps-sell")?.value)||2000;
  const liPsBuy=parseFloat(document.getElementById("li-ps-buy")?.value)||1200;
  opp.lineItems={hw:{sell:liHwSell,buy:liHwBuy},sw:{sell:liSwSell,buy:liSwBuy},ps:{enabled:liPsOn,units:liPsUnits,unitType:liPsUnitType,sellRate:liPsSell,buyRate:liPsBuy}};
  delete opp.ps;
  touchActivity(opp.id); persistOpps();
  document.getElementById("op-title").textContent=opp.name;
  document.getElementById("op-account-sub").textContent=opp.account||"";
  renderOppDetails(opp);
  showToast("Changes saved","ok");
  updateManualTabBadge();
  if(currentView==="kanban") renderBoard(); else if(currentView==="list") renderList(); else if(currentView==="manual") renderManual();
}

function deleteOpp(id){
  if(!confirm("Delete this opportunity? This cannot be undone.")) return;
  opportunities=opportunities.filter(o=>o.id!==id);
  persistOpps(); closeOppDetail(); renderView();
  showToast("Opportunity deleted");
}

function renderOppNotes(opp){
  const el=document.getElementById("op-notes-pane");
  const oppNotes=[...(notes[opp.id]||[])].reverse();
  el.innerHTML=`<div class="op-notes-list">${!oppNotes.length?'<p class="op-no-notes">No notes yet.</p>':oppNotes.map(n=>`<div class="np-note"><div class="np-note-ts">${fmtTs(n.ts)}</div><div class="np-note-text">${esc(n.text)}</div></div>`).join("")}</div>
    <div class="np-add" style="border-top:1px solid var(--border);padding-top:12px">
      <textarea class="np-textarea" id="op-note-ta" placeholder="Add a note… (Ctrl+Enter to save)"></textarea>
      <button class="np-submit" id="op-note-btn">Add Note</button>
    </div>`;
  document.getElementById("op-note-btn").addEventListener("click",()=>submitOppNote(opp.id));
  document.getElementById("op-note-ta").addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();submitOppNote(opp.id);}});
  updateOppTabCounts(opp.id);
}

function submitOppNote(oppId){
  const ta=document.getElementById("op-note-ta"); const text=ta.value.trim(); if(!text) return;
  if(!notes[oppId]) notes[oppId]=[];
  notes[oppId].push({id:uid(),text,ts:new Date().toISOString()});
  ss(K.notes,notes); touchActivity(oppId); ta.value="";
  const opp=opportunities.find(o=>o.id===oppId); if(opp) renderOppNotes(opp);
  showToast("Note added","ok");
}

function renderOppTasks(oppId){
  const el=document.getElementById("op-tasks-pane"); if(!el) return;
  const oppTasks=tasks.filter(t=>t.oppId===oppId);
  const open=oppTasks.filter(t=>!t.done);
  const done=oppTasks.filter(t=>t.done);
  const now=new Date().toISOString().slice(0,10);
  function taskRowHtml(t){
    const dc=expiryClass(t.dueDate);
    const duePill=t.dueDate?`<span style="font-size:10px;font-weight:600;padding:1px 6px;border-radius:8px;margin-left:6px;background:${dc==='overdue'?'#fde8e8':dc==='soon'?'#fff3cd':'#f0f4f8'};color:${dc==='overdue'?'#de350b':dc==='soon'?'#ff8b00':'#5e6c84'}">${fmtDate(t.dueDate)}</span>`:"";
    return `<div class="opp-task-row" data-tid="${t.id}" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
      <input type="checkbox" class="opp-task-cb" data-tid="${t.id}" ${t.done?"checked":""} style="accent-color:var(--accent);width:15px;height:15px;flex-shrink:0;cursor:pointer" />
      <span style="flex:1;font-size:13px;${t.done?"text-decoration:line-through;color:var(--muted)":""}">${esc(t.title)}${duePill}</span>
      ${t.notes?`<span style="font-size:11px;color:var(--muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t.notes)}">${esc(t.notes)}</span>`:""}
      <button class="opp-task-del" data-tid="${t.id}" style="flex-shrink:0;background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:2px 4px;border-radius:3px" title="Delete">×</button>
    </div>`;
  }
  el.innerHTML=`
    <div style="padding:0 0 12px">
      <div style="display:flex;gap:6px;margin-bottom:12px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:1;min-width:160px">
          <label class="op-field-label" style="font-size:10px">Task title</label>
          <input class="op-input" id="opp-task-title" placeholder="Add a task…" style="width:100%" />
        </div>
        <div>
          <label class="op-field-label" style="font-size:10px">Due date</label>
          <input class="op-input" id="opp-task-due" type="date" style="width:140px" />
        </div>
        <div>
          <label class="op-field-label" style="font-size:10px">Notes</label>
          <input class="op-input" id="opp-task-notes" placeholder="Optional notes" style="width:160px" />
        </div>
        <button class="op-save-btn" id="opp-task-add" style="padding:7px 16px;font-size:12px;align-self:flex-end">+ Add</button>
      </div>
      ${open.length?open.map(taskRowHtml).join(""):'<p style="font-size:12px;color:var(--muted);padding:8px 0">No open tasks for this opportunity.</p>'}
      ${done.length?`<details style="margin-top:12px"><summary style="font-size:11px;font-weight:700;color:var(--muted);cursor:pointer;text-transform:uppercase;letter-spacing:.05em">Completed (${done.length})</summary>${done.map(taskRowHtml).join("")}</details>`:""}
    </div>`;
  document.getElementById("opp-task-add").addEventListener("click",()=>{
    const title=document.getElementById("opp-task-title").value.trim();
    if(!title){showToast("Enter a task title","err");return;}
    const dueDate=document.getElementById("opp-task-due").value;
    const notes=document.getElementById("opp-task-notes").value.trim();
    const ts=new Date().toISOString();
    tasks.push({id:uid(),title,notes,dueDate,oppId,done:false,createdAt:ts,updatedAt:ts});
    saveTasks(); updateTasksBadge(); updateOppTabCounts(oppId); renderOppTasks(oppId);
    showToast("Task added","ok");
  });
  document.getElementById("opp-task-title").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();document.getElementById("opp-task-add").click();}});
  el.querySelectorAll(".opp-task-cb").forEach(cb=>{
    cb.addEventListener("change",()=>{
      const t=tasks.find(x=>x.id===cb.dataset.tid); if(!t) return;
      t.done=cb.checked; t.updatedAt=new Date().toISOString();
      saveTasks(); updateTasksBadge(); updateOppTabCounts(oppId); renderOppTasks(oppId);
    });
  });
  el.querySelectorAll(".opp-task-del").forEach(btn=>{
    btn.addEventListener("click",()=>{
      if(!confirm("Delete this task?")) return;
      tasks=tasks.filter(t=>t.id!==btn.dataset.tid);
      saveTasks(); updateTasksBadge(); updateOppTabCounts(oppId); renderOppTasks(oppId);
    });
  });
  updateOppTabCounts(oppId);
}

function getOppFileData(oppId){
  const raw=oppFiles[oppId];
  if(!raw) return {files:[],sellQuotes:[],buyQuotes:[]};
  if(Array.isArray(raw)) return {files:raw,sellQuotes:[],buyQuotes:[]};
  return {files:raw.files||[],sellQuotes:raw.sellQuotes||[],buyQuotes:raw.buyQuotes||[]};
}
function setOppFileData(oppId,data){ oppFiles[oppId]=data; }

function renderOppFiles(oppId){
  const el=document.getElementById("op-files-pane");
  const fd=getOppFileData(oppId);
  const hasGeneral=fd.files.length>0;
  el.innerHTML=`
    <div style="margin-bottom:18px">
      <div style="font-size:13px;font-weight:700;margin-bottom:6px;color:var(--text)">📊 Sell Quotes</div>
      ${hasGeneral?'<p class="drag-hint">Drag a file from General Files here to add as a sell quote</p>':""}
      <div class="quote-drop-zone" id="sell-drop-zone">${renderQuoteSection(fd.sellQuotes,"sell")}</div>
      <button class="sp-add" id="add-sell-btn" style="margin-top:6px">+ Add Sell Quote (upload)</button>
    </div>
    <div style="margin-bottom:18px">
      <div style="font-size:13px;font-weight:700;margin-bottom:6px;color:var(--text)">🏷 Buy Quotes</div>
      ${hasGeneral?'<p class="drag-hint">Drag a file from General Files here to add as a buy quote</p>':""}
      <div class="quote-drop-zone" id="buy-drop-zone">${renderQuoteSection(fd.buyQuotes,"buy")}</div>
      <button class="sp-add" id="add-buy-btn" style="margin-top:6px">+ Add Buy Quote (upload)</button>
    </div>
    <div>
      <div style="font-size:13px;font-weight:700;margin-bottom:6px;color:var(--text)">📎 General Files</div>
      ${hasGeneral?'<p class="drag-hint">Drag any file below onto a quote section above to promote it</p>':""}
      <div class="op-file-drop" id="op-file-drop">
        <div style="color:var(--muted);font-size:13px">
          <div style="font-size:24px;margin-bottom:6px">📎</div>
          <div>Drop files or <label for="op-file-input" style="color:var(--accent);cursor:pointer;text-decoration:underline">browse</label></div>
          <div style="font-size:11px;margin-top:3px">Max 2 MB · Stored in browser</div>
        </div>
        <input type="file" id="op-file-input" multiple style="display:none" />
      </div>
      <div class="op-file-list" id="op-general-list">
        ${!hasGeneral?'<p style="font-size:12px;color:var(--muted);padding:4px 0">No files yet — upload above or drag from desktop.</p>':
          fd.files.map(f=>`<div class="op-file-item general-file-item" draggable="true" data-fid="${esc(f.id)}">${fileItemHtml(f,"files")}</div>`).join("")}
      </div>
    </div>
    <div id="quote-form-area"></div>`;

  // Common wiring
  el.querySelectorAll(".op-file-del").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();deleteOppFileById(oppId,btn.dataset.fid,btn.dataset.bucket);}));
  el.querySelectorAll(".op-file-prev").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();const fd2=getOppFileData(oppId);const all=[...fd2.files,...fd2.sellQuotes,...fd2.buyQuotes];const f=all.find(x=>x.id===btn.dataset.fid);if(f)openPreview(f);}));
  el.querySelectorAll(".op-expiry-input").forEach(inp=>inp.addEventListener("change",()=>saveExpiryDate(oppId,inp.dataset.fid,inp.dataset.bucket,inp.value)));
  el.querySelectorAll(".op-cat-edit-btn").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();openCategoryForm(oppId,btn.dataset.fid,btn.dataset.bucket);}));
  document.getElementById("add-sell-btn").addEventListener("click",()=>openQuoteForm(oppId,"sell"));
  document.getElementById("add-buy-btn").addEventListener("click",()=>openQuoteForm(oppId,"buy"));
  document.getElementById("op-file-input").addEventListener("change",e=>{Array.from(e.target.files).forEach(f=>addOppFile(oppId,f,"files"));e.target.value="";});

  // External file drops onto the General zone
  const extDrop=document.getElementById("op-file-drop");
  extDrop.addEventListener("dragover",e=>{if(e.dataTransfer.types.includes("Files")){e.preventDefault();extDrop.classList.add("dragging");}});
  extDrop.addEventListener("dragleave",()=>extDrop.classList.remove("dragging"));
  extDrop.addEventListener("drop",e=>{
    if(!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault(); extDrop.classList.remove("dragging");
    Array.from(e.dataTransfer.files).forEach(f=>addOppFile(oppId,f,"files"));
  });

  // Drag general items → quote zones
  let draggedFid=null;
  el.querySelectorAll(".general-file-item[draggable]").forEach(item=>{
    item.addEventListener("dragstart",e=>{
      draggedFid=item.dataset.fid;
      e.dataTransfer.setData("text/plain",draggedFid);
      e.dataTransfer.effectAllowed="move";
      setTimeout(()=>item.classList.add("dragging-out"),0);
    });
    item.addEventListener("dragend",()=>{item.classList.remove("dragging-out");draggedFid=null;});
  });

  ["sell","buy"].forEach(type=>{
    const zone=document.getElementById(`${type}-drop-zone`);
    zone.addEventListener("dragover",e=>{
      if(!draggedFid) return;
      e.preventDefault(); e.dataTransfer.dropEffect="move";
      zone.classList.add(`drag-over-${type}`);
    });
    zone.addEventListener("dragleave",e=>{if(!zone.contains(e.relatedTarget))zone.classList.remove(`drag-over-${type}`);});
    zone.addEventListener("drop",e=>{
      e.preventDefault(); zone.classList.remove(`drag-over-${type}`);
      const fid=e.dataTransfer.getData("text/plain")||draggedFid; if(!fid) return;
      const fd2=getOppFileData(oppId); const file=fd2.files.find(x=>x.id===fid); if(!file) return;
      openPromoteForm(oppId,fid,type);
    });
  });

  updateOppTabCounts(oppId);
  updateExpiryBadge();
}

function renderQuoteSection(quotes,type){
  if(!quotes||!quotes.length) return `<p style="font-size:12px;color:var(--muted);padding:6px 2px">No ${type} quotes yet — upload one or drag a file from General Files.</p>`;
  const sorted=[...quotes].sort((a,b)=>b.addedAt.localeCompare(a.addedAt));
  const bucket=type==="sell"?"sellQuotes":"buyQuotes";
  return sorted.map((f,i)=>`<div class="op-file-item" style="${i===0?"border:1.5px solid "+(type==="sell"?"#0052cc":"#10b981")+";background:"+(type==="sell"?"#f0f6ff":"#f0fdf8")+"":""}">${i===0?`<span style="font-size:10px;font-weight:700;color:${type==="sell"?"var(--accent)":"#10b981"};margin-right:4px;flex-shrink:0">★ LATEST</span>`:""}${fileItemHtml(f,bucket)}</div>`).join("");
}

function fileItemHtml(f,bucket="files"){
  const expClass=expiryClass(f.expiryDate);
  const expLabel=f.expiryDate?`<span style="font-size:10px;font-weight:600;${expClass==="overdue"?"color:#de350b":expClass==="soon"?"color:#ff8b00":"color:var(--muted)"}">Expires ${fmtDate(f.expiryDate)}${expClass==="overdue"?" ⚠":expClass==="soon"?" ⏳":""}</span>`:"";
  const amtLabel=f.amount?`<span style="font-size:11px;font-weight:700;color:var(--text)">💲${fmt(f.amount)}</span>`:"";
  const catPills=(f.categories||[]).map(c=>`<span style="font-size:10px;font-weight:600;padding:1px 6px;border-radius:10px;background:${c.type==='hw'?'#e8f0fe':c.type==='sw'?'#e6f9f0':'#fff3e0'};color:${c.type==='hw'?'#1a73e8':c.type==='sw'?'#137333':'#e65100'}">${c.type.toUpperCase()}${c.amount?` ${fmt(c.amount)}`:''}</span>`).join('');
  return `<span class="op-file-icon">${fileIcon(f.type)}</span>
    <div class="op-file-info">
      <a class="op-file-name" href="${esc(f.dataUrl)}" download="${esc(f.name)}">${esc(f.name)}</a>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:2px">
        ${amtLabel}
        <span class="op-file-meta">${fmtFileSize(f.size)} · ${fmtTs(f.addedAt)}</span>
        ${expLabel}
        ${catPills?`<div style="display:flex;gap:4px;flex-wrap:wrap">${catPills}</div>`:""}
        <label style="font-size:10px;color:var(--muted)">Expiry: <input class="op-expiry-input" type="date" data-fid="${esc(f.id)}" data-bucket="${esc(bucket)}" value="${f.expiryDate||''}" style="font-size:10px;border:1px solid var(--border);border-radius:3px;padding:1px 4px;outline:none" /></label>
      </div>
    </div>
    <div style="display:flex;gap:4px;flex-shrink:0">
      <button class="op-file-prev mv-edit-btn" data-fid="${esc(f.id)}" style="font-size:10px;padding:3px 7px">View</button>
      ${(bucket==="sellQuotes"||bucket==="buyQuotes")?`<button class="op-cat-edit-btn" data-fid="${esc(f.id)}" data-bucket="${esc(bucket)}" style="font-size:10px;padding:3px 7px;border:1px solid var(--border);border-radius:var(--radius);background:#fff;cursor:pointer;white-space:nowrap">✏ Categories</button>`:""}
      <button class="op-file-del" data-fid="${esc(f.id)}" data-bucket="${esc(bucket)}">×</button>
    </div>`;
}

function expiryClass(iso){const d=daysDiff(iso);if(d===null)return"";if(d<0)return"overdue";if(d<=14)return"soon";return"";}

function openQuoteForm(oppId,type){
  const area=document.getElementById("quote-form-area");
  area.innerHTML=`<div style="background:#f8f9fa;border-radius:var(--radius);padding:14px;margin-top:14px">
    <div style="font-size:12px;font-weight:700;margin-bottom:10px">${type==="sell"?"Sell":"Buy"} Quote Details</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div><label class="op-field-label">Amount ($)</label><input class="op-input" id="qf-amount" type="number" min="0" placeholder="0" /></div>
      <div><label class="op-field-label">Expiry Date</label><input class="op-input" id="qf-expiry" type="date" /></div>
    </div>
    <div style="margin-bottom:10px">
      <label class="op-field-label">Categories (optional)</label>
      <div id="qf-cats" style="display:flex;flex-direction:column;gap:6px;margin-top:4px">
        ${['hw','sw','ps'].map(c=>`<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer">
          <input type="checkbox" class="qf-cat-cb" data-cat="${c}" style="accent-color:var(--accent)" />
          <span style="width:100px">${c==='hw'?'Hardware':c==='sw'?'Software':'Prof. Services'}</span>
          <span style="font-size:11px;color:var(--muted)">Amount: $</span>
          <input class="qf-cat-amt op-input" data-cat="${c}" type="number" min="0" style="width:100px;display:none;padding:3px 6px" placeholder="0" />
        </label>`).join('')}
        <div style="font-size:11px;color:var(--muted)" id="qf-unalloc"></div>
      </div>
    </div>
    <div style="margin-bottom:10px"><label class="op-field-label">File (required)</label><input type="file" id="qf-file" style="font-size:12px;width:100%" /></div>
    <div style="display:flex;gap:8px">
      <button class="op-save-btn" id="qf-save" style="padding:7px 16px;font-size:12px">Upload Quote</button>
      <button class="nop-cancel" id="qf-cancel" style="padding:7px 14px;font-size:12px">Cancel</button>
    </div>
  </div>`;
  document.getElementById("qf-cancel").addEventListener("click",()=>area.innerHTML="");
  area.querySelectorAll(".qf-cat-cb").forEach(cb=>{
    cb.addEventListener("change",()=>{
      const amtEl=area.querySelector(`.qf-cat-amt[data-cat="${cb.dataset.cat}"]`);
      amtEl.style.display=cb.checked?"inline-block":"none";
      updateUnalloc();
    });
  });
  function updateUnalloc(){
    const total=parseFloat(area.querySelector("#qf-amount").value)||0;
    const catSum=[...area.querySelectorAll(".qf-cat-cb:checked")].reduce((s,cb)=>{
      return s+(parseFloat(area.querySelector(`.qf-cat-amt[data-cat="${cb.dataset.cat}"]`).value)||0);
    },0);
    const ua=area.querySelector("#qf-unalloc");
    if(ua) ua.textContent=total>0?`Unallocated: ${fmt(total-catSum)}`:"";
  }
  area.querySelectorAll(".qf-cat-amt").forEach(i=>i.addEventListener("input",updateUnalloc));
  area.querySelector("#qf-amount").addEventListener("input",updateUnalloc);

  // Phase 3: auto-fill buy quote from file using mock extractor
  if(type==="buy"){
    document.getElementById("qf-file").addEventListener("change", async (e)=>{
      const file=e.target.files[0]; if(!file) return;
      try {
        showToast("Analysing quote…");
        const { buyQuote } = await buildBuyQuoteFromFile(
          file,
          { name: file.name, type: file.type, size: file.size },
          { extractorId: "mock" }
        );
        if(buyQuote.amount) { area.querySelector("#qf-amount").value=buyQuote.amount; updateUnalloc(); }
        (buyQuote.categories||[]).forEach(c=>{
          const cb=area.querySelector(`.qf-cat-cb[data-cat="${c.type}"]`);
          if(cb){ cb.checked=true; cb.dispatchEvent(new Event("change"));
            const amtEl=area.querySelector(`.qf-cat-amt[data-cat="${c.type}"]`);
            if(amtEl&&c.amount) amtEl.value=c.amount; }
        });
        area._predicted={ buyQuote };
        updateUnalloc();
        showToast("Auto-filled from quote — please review","ok");
      } catch(err){ /* silent — user still fills manually */ }
    });
  }

  document.getElementById("qf-save").addEventListener("click",()=>{
    const fileEl=document.getElementById("qf-file");
    const file=fileEl.files[0]; if(!file){showToast("Select a file","err");return;}
    if(file.size>2*1024*1024){showToast("File too large (max 2MB)","err");return;}
    const amount=parseFloat(document.getElementById("qf-amount").value)||null;
    const expiry=document.getElementById("qf-expiry").value;
    const reader=new FileReader();
    reader.onload=ev=>{
      const cats=[...area.querySelectorAll(".qf-cat-cb:checked")].map(cb=>{
        const amt=parseFloat(area.querySelector(`.qf-cat-amt[data-cat="${cb.dataset.cat}"]`)?.value)||null;
        return {type:cb.dataset.cat,amount:amt};
      });
      const checkedCount=area.querySelectorAll(".qf-cat-cb:checked").length;
      const finalCats=cats.map(c=>({...c,amount:c.amount!=null?c.amount:(checkedCount===1?(parseFloat(area.querySelector("#qf-amount")?.value)||null):null)}));
      const fd=getOppFileData(oppId);
      const bucket=type==="sell"?"sellQuotes":"buyQuotes";
      fd[bucket].push({id:uid(),name:file.name,type:file.type,size:file.size,addedAt:new Date().toISOString(),expiryDate:expiry||null,amount,dataUrl:ev.target.result,categories:finalCats.length?finalCats:[]});
      setOppFileData(oppId,fd);
      try{ss(K.files,oppFiles);}catch{showToast("Storage full","err");fd[bucket].pop();return;}
      renderOppFiles(oppId); showToast(`${type==="sell"?"Sell":"Buy"} quote added`,"ok");
      updateExpiryBadge();
      if(type==="buy"&&area._predicted){
        try{ recordReview(area._predicted.buyQuote, {amount,categories:finalCats}, {fileName:file.name}); }catch{}
        area._predicted=null;
      }
    };
    reader.readAsDataURL(file);
  });
  area.querySelector("#qf-amount")?.focus();
}

// Move a file from general → sell/buy quote with optional amount & expiry
function openPromoteForm(oppId,fid,type){
  const area=document.getElementById("quote-form-area");
  const fd=getOppFileData(oppId); const file=fd.files.find(x=>x.id===fid); if(!file) return;
  const typeLabel=type==="sell"?"Sell":"Buy";
  area.innerHTML=`<div style="background:${type==="sell"?"#f0f6ff":"#f0fdf8"};border:1.5px solid ${type==="sell"?"#0052cc":"#10b981"};border-radius:var(--radius);padding:14px;margin-top:14px">
    <div style="font-size:12px;font-weight:700;margin-bottom:4px;color:${type==="sell"?"var(--accent)":"#10b981"}">Move <em>${esc(file.name)}</em> → ${typeLabel} Quote</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">Fill in the quote details then confirm. The file will move from General Files into ${typeLabel} Quotes.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div><label class="op-field-label">Amount ($)</label><input class="op-input" id="pf-amount" type="number" min="0" placeholder="0" value="${file.amount||''}" /></div>
      <div><label class="op-field-label">Expiry Date</label><input class="op-input" id="pf-expiry" type="date" value="${file.expiryDate||''}" /></div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="op-save-btn" id="pf-confirm" style="padding:7px 16px;font-size:12px;background:${type==="sell"?"var(--accent)":"#10b981"}">Move to ${typeLabel} Quotes</button>
      <button class="nop-cancel" id="pf-cancel" style="padding:7px 14px;font-size:12px">Cancel</button>
    </div>
  </div>`;
  area.scrollIntoView({behavior:"smooth",block:"nearest"});
  document.getElementById("pf-cancel").addEventListener("click",()=>area.innerHTML="");
  document.getElementById("pf-confirm").addEventListener("click",()=>{
    const amount=parseFloat(document.getElementById("pf-amount").value)||null;
    const expiry=document.getElementById("pf-expiry").value||null;
    const fd2=getOppFileData(oppId);
    const idx=fd2.files.findIndex(x=>x.id===fid); if(idx<0) return;
    const [moved]=fd2.files.splice(idx,1);
    moved.amount=amount; moved.expiryDate=expiry;
    const bucket=type==="sell"?"sellQuotes":"buyQuotes";
    fd2[bucket].push(moved);
    setOppFileData(oppId,fd2); ss(K.files,oppFiles);
    renderOppFiles(oppId); showToast(`Moved to ${typeLabel} Quotes ✓`,"ok");
  });
}

function openCategoryForm(oppId, fid, bucket){
  const area=document.getElementById("quote-form-area");
  const fd=getOppFileData(oppId);
  const quotes=fd[bucket]||[];
  const file=quotes.find(x=>x.id===fid); if(!file) return;
  const existing=file.categories||[];
  const typeLabel=bucket==="sellQuotes"?"Sell":"Buy";
  const accentColor=bucket==="sellQuotes"?"var(--accent)":"#10b981";
  const bgColor=bucket==="sellQuotes"?"#f0f6ff":"#f0fdf8";
  const borderColor=bucket==="sellQuotes"?"#0052cc":"#10b981";

  function catRow(cat, label, existingAmt, existingChecked){
    return `<label style="display:flex;align-items:center;gap:10px;font-size:12px;cursor:pointer;padding:6px 8px;border-radius:var(--radius);background:${existingChecked?'#fff':''};border:1px solid ${existingChecked?'var(--border)':'transparent'}">
      <input type="checkbox" class="cef-cb" data-cat="${cat}" ${existingChecked?"checked":""} style="accent-color:var(--accent);width:15px;height:15px" />
      <span style="width:130px;font-weight:${existingChecked?'600':'400'}">${label}</span>
      <span style="font-size:11px;color:var(--muted)">$</span>
      <input class="cef-amt op-input" data-cat="${cat}" type="number" min="0" style="width:110px;display:${existingChecked?'block':'none'};padding:4px 8px" placeholder="Amount" value="${existingAmt!=null?existingAmt:''}" />
    </label>`;
  }

  const hwEx=existing.find(c=>c.type==="hw"); const swEx=existing.find(c=>c.type==="sw"); const psEx=existing.find(c=>c.type==="ps");
  area.innerHTML=`<div style="background:${bgColor};border:1.5px solid ${borderColor};border-radius:var(--radius);padding:14px;margin-top:14px">
    <div style="font-size:12px;font-weight:700;margin-bottom:4px;color:${accentColor}">✏ Edit Categories — ${typeLabel} Quote: <em>${esc(file.name)}</em></div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:12px">Classify this quote as HW / SW / PS or any combination. Per-category amounts should add up to the quote total${file.amount?` (${fmt(file.amount)})`:""}.  Leave all unchecked to remove categorisation.</p>
    <div style="margin-bottom:6px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:6px">Quote total: <strong style="color:var(--text)">${file.amount?fmt(file.amount):"—"}</strong></div>
      <div id="cef-cats" style="display:flex;flex-direction:column;gap:4px">
        ${catRow("hw","Hardware",hwEx?.amount,!!hwEx)}
        ${catRow("sw","Software",swEx?.amount,!!swEx)}
        ${catRow("ps","Prof. Services",psEx?.amount,!!psEx)}
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:8px;min-height:16px" id="cef-unalloc"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="op-save-btn" id="cef-save" style="padding:7px 16px;font-size:12px;background:${accentColor}">Save Categories</button>
      <button class="nop-cancel" id="cef-cancel" style="padding:7px 14px;font-size:12px">Cancel</button>
    </div>
  </div>`;

  area.scrollIntoView({behavior:"smooth",block:"nearest"});
  document.getElementById("cef-cancel").addEventListener("click",()=>area.innerHTML="");

  function updateUnalloc(){
    const total=file.amount||0;
    const sum=[...area.querySelectorAll(".cef-cb:checked")].reduce((s,cb)=>s+(parseFloat(area.querySelector(`.cef-amt[data-cat="${cb.dataset.cat}"]`)?.value)||0),0);
    const ua=document.getElementById("cef-unalloc");
    if(!ua) return;
    if(!total){ua.textContent="";return;}
    const diff=total-sum;
    const absDiff=Math.abs(diff);
    if(Math.abs(diff)<0.01){ua.innerHTML=`<span style="color:#10b981;font-weight:600">✓ Fully allocated (${fmt(total)})</span>`;}
    else if(diff>0){ua.innerHTML=`Unallocated: <strong style="color:#ff8b00">${fmt(absDiff)}</strong>`;}
    else{ua.innerHTML=`Over by: <strong style="color:#de350b">${fmt(absDiff)}</strong>`;}
  }

  area.querySelectorAll(".cef-cb").forEach(cb=>{
    cb.addEventListener("change",()=>{
      const amt=area.querySelector(`.cef-amt[data-cat="${cb.dataset.cat}"]`);
      amt.style.display=cb.checked?"block":"none";
      if(!cb.checked) amt.value="";
      updateUnalloc();
    });
  });
  area.querySelectorAll(".cef-amt").forEach(i=>i.addEventListener("input",updateUnalloc));
  updateUnalloc();

  document.getElementById("cef-save").addEventListener("click",()=>{
    const checked=[...area.querySelectorAll(".cef-cb:checked")];
    const newCats=checked.map(cb=>{
      const rawAmt=area.querySelector(`.cef-amt[data-cat="${cb.dataset.cat}"]`)?.value;
      const amt=rawAmt!==""&&rawAmt!=null?parseFloat(rawAmt)||null:null;
      // If only one category checked and no amount given, default to quote total
      return {type:cb.dataset.cat, amount: amt!=null?amt:(checked.length===1?(file.amount||null):null)};
    });
    file.categories=newCats;
    setOppFileData(oppId,fd);
    try{ss(K.files,oppFiles);}catch{showToast("Storage full","err");return;}
    area.innerHTML="";
    renderOppFiles(oppId);
    updateExpiryBadge();
    showToast(newCats.length?`Categories saved: ${newCats.map(c=>c.type.toUpperCase()).join(", ")}`:"Categories cleared","ok");
  });
}

function fileIcon(type){if(!type)return"📄";if(type.startsWith("image/"))return"🖼";if(type.includes("pdf"))return"📕";if(type.includes("excel")||type.includes("spreadsheet"))return"📊";if(type.includes("word")||type.includes("document"))return"📝";return"📄";}
function fmtFileSize(b){if(b<1024)return b+"B";if(b<1048576)return(b/1024).toFixed(1)+"KB";return(b/1048576).toFixed(1)+"MB";}

function addOppFile(oppId,file,bucket="files"){
  if(file.size>2*1024*1024){showToast("File too large (max 2MB)","err");return;}
  const reader=new FileReader();
  reader.onload=ev=>{
    const fd=getOppFileData(oppId);
    fd[bucket].push({id:uid(),name:file.name,type:file.type,size:file.size,addedAt:new Date().toISOString(),expiryDate:null,dataUrl:ev.target.result});
    setOppFileData(oppId,fd);
    try{ss(K.files,oppFiles);}catch{showToast("Storage full — file not saved","err");fd[bucket].pop();return;}
    renderOppFiles(oppId); showToast("File added: "+file.name,"ok");
  };
  reader.readAsDataURL(file);
}

function deleteOppFileById(oppId,fileId,bucket="files"){
  const fd=getOppFileData(oppId);
  fd[bucket]=fd[bucket].filter(f=>f.id!==fileId);
  setOppFileData(oppId,fd); ss(K.files,oppFiles); renderOppFiles(oppId);
}

function saveExpiryDate(oppId,fileId,bucket,val){
  const fd=getOppFileData(oppId);
  const f=(fd[bucket]||[]).find(x=>x.id===fileId); if(!f) return;
  f.expiryDate=val||null; setOppFileData(oppId,fd); ss(K.files,oppFiles);
  showToast(val?"Expiry date saved":"Expiry date cleared");
}

// ── File preview ──────────────────────────────────────────────────────────────
function buildPreviewContent(file,bodyEl){
  bodyEl.innerHTML="";
  if(file.type.startsWith("image/")){
    const img=document.createElement("img"); img.src=file.dataUrl; bodyEl.appendChild(img);
  } else if(file.type.includes("pdf")){
    const iframe=document.createElement("iframe"); iframe.src=file.dataUrl; bodyEl.appendChild(iframe);
  } else if(file.type.includes("excel")||file.type.includes("spreadsheet")||/\.(xlsx|xls)$/i.test(file.name)){
    try{
      const base64=file.dataUrl.split(",")[1];
      const wb=XLSX.read(base64,{type:"base64",cellStyles:true,cellDates:true});
      const wrap=document.createElement("div"); wrap.className="prev-xl-wrap";
      bodyEl.appendChild(wrap);
      let activeSheet=wb.SheetNames[0];
      let selectedCell=null;
      function isNumeric(v){return typeof v==="number";}
      function fmtCell(cell){
        if(!cell) return "";
        if(cell.t==="d") return cell.v instanceof Date?cell.v.toLocaleDateString("en-AU"):cell.w||"";
        return cell.w!=null?cell.w:String(cell.v??"");
      }
      function argbToRgba(argb){
        if(!argb||argb.length<6) return null;
        const hex=argb.length===8?argb.slice(2):argb; // strip alpha prefix
        if(!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
        return "#"+hex;
      }
      function cellStyle(cell){
        if(!cell||!cell.s) return "";
        const s=cell.s; let css="";
        // Background fill
        const fg=s.fill?.fgColor; const bg=s.fill?.bgColor;
        const fillHex=argbToRgba(fg?.rgb||fg?.argb)||argbToRgba(bg?.rgb||bg?.argb);
        if(fillHex&&fillHex!=="FFFFFFFF"&&fillHex!=="ffffff"&&fillHex!=="#ffffff") css+=`background:${fillHex};`;
        // Font
        const f=s.font||{};
        if(f.bold) css+="font-weight:700;";
        if(f.italic) css+="font-style:italic;";
        if(f.underline) css+="text-decoration:underline;";
        const fontColor=argbToRgba(f.color?.rgb||f.color?.argb);
        if(fontColor&&fontColor!=="FF000000"&&fontColor!=="#000000") css+=`color:${fontColor};`;
        if(f.sz&&f.sz!==10&&f.sz!==11) css+=`font-size:${Math.min(16,Math.max(9,f.sz))}px;`;
        // Alignment
        const a=s.alignment||{};
        if(a.horizontal==="center") css+="text-align:center;";
        else if(a.horizontal==="right") css+="text-align:right;";
        if(a.wrapText) css+="white-space:normal;min-height:36px;";
        return css;
      }
      function renderSheet(sheetName){
        const ws=wb.Sheets[sheetName];
        const ref=ws["!ref"];
        if(!ref){wrap.querySelector(".prev-xl-body").innerHTML='<p style="padding:20px;color:var(--muted);font-size:13px">Sheet is empty.</p>';return;}
        const range=XLSX.utils.decode_range(ref);
        const rowCount=range.e.r-range.s.r+1;
        const colCount=range.e.c-range.s.c+1;
        // Build merge map: addr → {colspan,rowspan} or null (skip)
        const merges=ws["!merges"]||[];
        const mergeSpan={}; const mergeSkip=new Set();
        merges.forEach(m=>{
          const masterAddr=XLSX.utils.encode_cell({r:m.s.r,c:m.s.c});
          mergeSpan[masterAddr]={colspan:m.e.c-m.s.c+1,rowspan:m.e.r-m.s.r+1};
          for(let r=m.s.r;r<=m.e.r;r++) for(let c=m.s.c;c<=m.e.c;c++){
            if(r===m.s.r&&c===m.s.c) continue;
            mergeSkip.add(XLSX.utils.encode_cell({r,c}));
          }
        });
        // Column widths
        const cols=ws["!cols"]||[];
        const colWidths=[];
        for(let c=range.s.c;c<=range.e.c;c++){
          const col=cols[c]; colWidths.push(col?.wch?Math.min(300,Math.max(60,col.wch*7)):90);
        }
        // Row heights
        const rowDefs=ws["!rows"]||[];
        // Build table
        let html='<table class="prev-xl-table"><colgroup><col style="width:36px">';
        colWidths.forEach(w=>html+=`<col style="width:${w}px">`);
        html+='</colgroup><thead><tr><th class="row-num"></th>';
        // Column letters header
        for(let c=range.s.c;c<=range.e.c;c++) html+=`<th style="text-align:center;color:var(--muted);font-weight:400;font-size:10px">${XLSX.utils.encode_col(c)}</th>`;
        html+='</tr></thead><tbody>';
        for(let r=range.s.r;r<=range.e.r;r++){
          const rDef=rowDefs[r]; const rh=rDef?.hpx?`height:${rDef.hpx}px`:"";
          html+=`<tr style="${rh}"><td class="row-num">${r-range.s.r+1}</td>`;
          for(let c=range.s.c;c<=range.e.c;c++){
            const addr=XLSX.utils.encode_cell({r,c});
            if(mergeSkip.has(addr)) continue;
            const cell=ws[addr];
            const val=fmtCell(cell);
            const span=mergeSpan[addr]||{};
            const colAttr=span.colspan?` colspan="${span.colspan}"`:"";
            const rowAttr=span.rowspan?` rowspan="${span.rowspan}"`:"";
            const isNum=cell&&isNumeric(cell.v)&&!span.colspan;
            const inlineStyle=cellStyle(cell)+(isNum&&!cell?.s?.alignment?"text-align:right;":"");
            const numClass=isNum?" xl-num":"";
            html+=`<td class="${numClass}" data-addr="${addr}"${colAttr}${rowAttr} style="${inlineStyle}" title="${esc(val)}">${esc(val)}</td>`;
          }
          html+='</tr>';
        }
        html+='</tbody></table>';
        wrap.querySelector(".prev-xl-body").innerHTML=html;
        wrap.querySelector(".prev-xl-info").textContent=`${rowCount} rows · ${colCount} cols`;
        wrap.querySelectorAll(".prev-xl-body td[data-addr]").forEach(td=>{
          td.addEventListener("click",e=>{
            e.stopPropagation();
            if(selectedCell) selectedCell.classList.remove("xl-selected");
            td.classList.add("xl-selected"); selectedCell=td;
            const cell=ws[td.dataset.addr];
            wrap.querySelector(".prev-xl-cellval").textContent=td.dataset.addr+" : "+(cell?fmtCell(cell):"");
          });
        });
        applySearch(wrap.querySelector(".prev-xl-search").value);
      }
      function applySearch(q){
        const term=q.trim().toLowerCase();
        wrap.querySelectorAll(".prev-xl-body td[data-addr]").forEach(td=>{
          td.classList.toggle("xl-match",!!(term&&td.textContent.toLowerCase().includes(term)));
        });
      }
      // Tabs
      const tabsHtml=wb.SheetNames.map(n=>`<button class="prev-xl-tab${n===activeSheet?" active":""}" data-sheet="${esc(n)}">${esc(n)}</button>`).join("");
      wrap.innerHTML=`
        <div class="prev-xl-toolbar">
          <input class="prev-xl-search" type="search" placeholder="Search cells…" />
          <span class="prev-xl-cellval" style="font-size:11px;color:var(--accent);font-weight:600;min-width:120px"></span>
          <span class="prev-xl-info" style="font-size:11px;color:var(--muted);margin-left:auto"></span>
        </div>
        ${wb.SheetNames.length>1?`<div class="prev-xl-tabs">${tabsHtml}</div>`:""}
        <div class="prev-xl-body"></div>`;
      renderSheet(activeSheet);
      wrap.querySelectorAll(".prev-xl-tab").forEach(btn=>{
        btn.addEventListener("click",()=>{
          wrap.querySelectorAll(".prev-xl-tab").forEach(b=>b.classList.remove("active"));
          btn.classList.add("active");
          activeSheet=btn.dataset.sheet;
          selectedCell=null;
          renderSheet(activeSheet);
        });
      });
      wrap.querySelector(".prev-xl-search").addEventListener("input",function(){applySearch(this.value);});
    }catch(err){bodyEl.innerHTML='<div class="prev-unsupported"><span style="font-size:32px">📊</span><span>Could not parse spreadsheet</span></div>';}
  } else {
    bodyEl.innerHTML=`<div class="prev-unsupported"><span style="font-size:32px">${fileIcon(file.type)}</span><span>No preview available for this file type.</span><a href="${esc(file.dataUrl)}" download="${esc(file.name)}" style="color:var(--accent);text-decoration:underline">Download instead</a></div>`;
  }
}

function openPreview(file){
  // If the opp detail panel is open, show inline split-pane
  if(document.getElementById("opp-overlay").classList.contains("open")){
    openInlinePreview(file); return;
  }
  document.getElementById("prev-title").textContent=file.name;
  buildPreviewContent(file,document.getElementById("prev-body"));
  document.getElementById("preview-overlay").classList.add("open");
}

function openInlinePreview(file){
  document.getElementById("inl-prev-title").textContent=file.name;
  buildPreviewContent(file,document.getElementById("inl-prev-body"));
  document.getElementById("opp-preview-side").style.display="flex";
  document.getElementById("opp-preview-side").style.flexDirection="column";
  document.getElementById("opp-panel").classList.add("split");
}

function closeInlinePreview(){
  document.getElementById("opp-preview-side").style.display="none";
  document.getElementById("inl-prev-body").innerHTML="";
  document.getElementById("opp-panel").classList.remove("split");
}

function closePreview(){document.getElementById("preview-overlay").classList.remove("open");}

function closeOppDetail(){closeInlinePreview();document.getElementById("opp-overlay").classList.remove("open");currentOppDetailId=null;}
function openNotes(oppId){openOppDetail(oppId,"notes");}

// ── Settings ──────────────────────────────────────────────────────────────────
function openSettings(){
  settingsDraft=clone(config);
  renderSettingsEditor();
  document.getElementById("settings-overlay").classList.add("open");
  const savedLogo=localStorage.getItem(K.logo)||"";
  const prev=document.getElementById("sp-logo-preview");
  const ph=document.getElementById("sp-logo-placeholder");
  const clr=document.getElementById("sp-logo-clear");
  if(savedLogo){prev.src=savedLogo;prev.style.display="inline-block";ph.style.display="none";clr.style.display="inline-block";}
  else{prev.style.display="none";ph.style.display="inline-block";clr.style.display="none";}
  // Use a flag object scoped to this settings session
  const logoState={pending:undefined,clear:false};
  document._logoState=logoState;
  const oldFileInput=document.getElementById("sp-logo-file");
  const newFileInput=oldFileInput.cloneNode(true);
  oldFileInput.parentNode.replaceChild(newFileInput,oldFileInput);
  newFileInput.addEventListener("change",function(){
    const f=this.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=ev=>{
      if(ev.target.result.length>400000){showToast("Image too large (max ~300KB)","err");return;}
      prev.src=ev.target.result;prev.style.display="inline-block";ph.style.display="none";
      document.getElementById("sp-logo-clear").style.display="inline-block";
      logoState.pending=ev.target.result; logoState.clear=false;
    };
    r.readAsDataURL(f);
  });
  const oldClr=document.getElementById("sp-logo-clear");
  const newClr=oldClr.cloneNode(true);
  oldClr.parentNode.replaceChild(newClr,oldClr);
  newClr.addEventListener("click",()=>{
    prev.src="";prev.style.display="none";ph.style.display="inline-block";newClr.style.display="none";
    logoState.pending=null; logoState.clear=true;
  });
}
function closeSettings(){document.getElementById("settings-overlay").classList.remove("open");settingsDraft=null;}
function renderSettingsEditor(){renderStagesEditor();renderStatusesEditor();document.getElementById("sp-margin").value=settingsDraft.defaultMargin??5;}

function renderStagesEditor(){
  const el=document.getElementById("stages-editor");el.innerHTML="";
  settingsDraft.stages.forEach((s,i)=>{
    const row=document.createElement("div");row.className="stage-row";
    row.innerHTML=`<input class="sp-input" value="${esc(s.label)}" placeholder="Label" data-field="label" data-i="${i}" /><input class="sp-input" type="number" min="0" max="100" value="${s.weight}" data-field="weight" data-i="${i}" /><input class="sp-color" type="color" value="${s.color}" data-field="color" data-i="${i}" /><span></span><button class="sp-del" data-i="${i}">×</button>`;
    row.querySelectorAll("[data-field]").forEach(inp=>{const u=()=>{const fi=+inp.dataset.i,f=inp.dataset.field;settingsDraft.stages[fi][f]=f==="weight"?+inp.value:inp.value;};inp.addEventListener("input",u);inp.addEventListener("change",u);});
    row.querySelector(".sp-del").addEventListener("click",()=>{settingsDraft.stages.splice(i,1);renderStagesEditor();});
    el.appendChild(row);
  });
}

function renderStatusesEditor(){
  const el=document.getElementById("statuses-editor");el.innerHTML="";
  settingsDraft.statuses.forEach((s,i)=>{
    const row=document.createElement("div");row.className="status-row";
    row.innerHTML=`<input class="sp-input" value="${esc(s.label)}" placeholder="Label" data-field="label" data-i="${i}" /><label class="sp-check-wrap"><input type="checkbox" ${s.terminal?"checked":""} data-field="terminal" data-i="${i}" /> Terminal</label><input class="sp-color" type="color" value="${s.color}" data-field="color" data-i="${i}" /><button class="sp-del" data-i="${i}">×</button>`;
    row.querySelectorAll("[data-field]").forEach(inp=>{const u=()=>{const fi=+inp.dataset.i,f=inp.dataset.field;settingsDraft.statuses[fi][f]=f==="terminal"?inp.checked:inp.value;};inp.addEventListener("change",u);inp.addEventListener("input",u);});
    row.querySelector(".sp-del").addEventListener("click",()=>{settingsDraft.statuses.splice(i,1);renderStatusesEditor();});
    el.appendChild(row);
  });
}

function addSettingsStage(){settingsDraft.stages.push({id:uid(),label:"New",weight:50,color:"#6366f1"});renderStagesEditor();}
function addSettingsStatus(){settingsDraft.statuses.push({id:uid(),label:"New Status",terminal:false,color:"#6366f1"});renderStatusesEditor();}

function saveSettings(){
  settingsDraft.stages.forEach(s=>{if(!s.id||s.id.length<2)s.id=slugify(s.label)||uid();});
  settingsDraft.statuses.forEach(s=>{if(!s.id||s.id.length<2)s.id=slugify(s.label)||uid();});
  settingsDraft.defaultMargin=Math.max(0,Math.min(100,parseFloat(document.getElementById("sp-margin").value)||5));
  settingsDraft.configVersion=CONFIG_VERSION;
  config=clone(settingsDraft);ss(K.config,config);
  const ls2=document._logoState||{};
  if(ls2.clear){localStorage.removeItem(K.logo);}
  else if(ls2.pending){try{localStorage.setItem(K.logo,ls2.pending);}catch(e){showToast("Logo too large to store — try a smaller image","err");}}
  updateHeaderLogo();
  closeSettings();buildFilterChips();renderView();
  showToast("Settings saved","ok");
}

wireAuthEvents();
init();
