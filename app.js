const DB_NAME='ibond-ledger',DB_VERSION=1,STORE='bonds',META='meta';
const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_CLIENT_ID=''; // Configure after creating Google OAuth Web client.
const $=s=>document.querySelector(s), money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n||0);
let db, bonds=[], sortNewest=true, tokenClient=null, accessToken=null;
const RATE_TABLE=[
 {start:'2026-05',fixed:.009,inflation:.0177},
 {start:'2025-11',fixed:.009,inflation:.0198},
 {start:'2025-05',fixed:.011,inflation:.0142},
 {start:'2024-11',fixed:.012,inflation:.0095},
 {start:'2024-05',fixed:.013,inflation:.0148},
 {start:'2023-11',fixed:.013,inflation:.0169},
 {start:'2023-05',fixed:.009,inflation:.0169},
 {start:'2022-11',fixed:.004,inflation:.0324},
 {start:'2022-05',fixed:0,inflation:.0481}
];
// Rate table is intentionally partial in v0.1. Bonds outside audited coverage show principal-only estimates.
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'id'});if(!d.objectStoreNames.contains(META))d.createObjectStore(META,{keyPath:'key'})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}
function getAll(){return new Promise((res,rej)=>{const r=tx(STORE).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function put(v,store=STORE){return new Promise((res,rej)=>{const r=tx(store,'readwrite').put(v);r.onsuccess=()=>res(v);r.onerror=()=>rej(r.error)})}
async function del(id){
 const existing=bonds.find(b=>b.id===id);if(!existing)return;
 const now=new Date().toISOString();await put({...existing,deletedAt:now,modifiedAt:now});await load();await changed()
}
function monthDiff(a,b=new Date()){const [y,m]=a.split('-').map(Number);return (b.getFullYear()-y)*12+(b.getMonth()+1-m)}
function addMonths(ym,n){let [y,m]=ym.split('-').map(Number);m=m-1+n;return new Date(y+Math.floor(m/12),((m%12)+12)%12,1)}
function fmtMonth(d){return d.toLocaleDateString('en-US',{month:'short',year:'numeric'})}
function issueFixed(issue){const eligible=RATE_TABLE.filter(r=>r.start<=issue).sort((a,b)=>b.start.localeCompare(a.start))[0];return eligible?.fixed??null}
function composite(fixed,infl){return fixed+2*infl+fixed*infl}
function estimateBond(b,now=new Date()){
 const age=Math.max(0,monthDiff(b.issueMonth,now)), principal=Number(b.amount);
 const fixed=issueFixed(b.issueMonth);
 if(fixed===null||b.issueMonth<'2022-05') return {value:null,redeemable:null,interest:null,rate:null,age,beta:true,unsupported:true};
 let value=principal, monthlyValues=[principal], rate=null;
 // Beta approximation: determine each 6-month earning period from issue-month anniversary and published semiannual tables.
 for(let i=0;i<age;i++){
   const period=Math.floor(i/6), periodStart=addMonths(b.issueMonth,period*6);
   const key=periodStart.getFullYear()+'-'+String(periodStart.getMonth()+1).padStart(2,'0');
   const rr=RATE_TABLE.filter(x=>x.start<=key).sort((a,c)=>c.start.localeCompare(a.start))[0];
   if(!rr){return {value:null,redeemable:null,interest:null,rate:null,beta:true,age,unsupported:true}}
   rate=composite(fixed,rr.inflation);
   value*=Math.pow(1+rate,1/6);
   monthlyValues.push(value);
 }
 let redeemable=age<12?0:value;
 if(age>=12&&age<60){const idx=Math.max(0,monthlyValues.length-4);redeemable=monthlyValues[idx]}
 return {value,redeemable,interest:value-principal,rate,beta:true,age,unlockDate:addMonths(b.issueMonth,12),penaltyEnd:addMonths(b.issueMonth,60),maturityDate:addMonths(b.issueMonth,360)};
}
function snapshot(){return {schemaVersion:1,exportedAt:new Date().toISOString(),bonds}}
function validBond(b){return b&&typeof b.id==='string'&&typeof b.issueMonth==='string'&&/^\d{4}-\d{2}$/.test(b.issueMonth)&&Number.isFinite(Number(b.amount))&&Number(b.amount)>=25&&typeof b.modifiedAt==='string'&&(!b.deletedAt||typeof b.deletedAt==='string')}
async function replaceBonds(next){
 if(!Array.isArray(next)||!next.every(validBond))throw Error('Invalid portfolio data');
 await new Promise((res,rej)=>{const t=db.transaction(STORE,'readwrite'),s=t.objectStore(STORE);s.clear();for(const b of next)s.put(b);t.oncomplete=res;t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||Error('Portfolio write aborted'))});
 await load()
}
function mergeBonds(local,cloud){
 const invalid=[...local,...cloud].filter(b=>!validBond(b));if(invalid.length)throw Error(invalid.length+' invalid bond record(s); sync stopped');
 const m=new Map();for(const b of [...local,...cloud]){const old=m.get(b.id);if(!old||b.modifiedAt>old.modifiedAt)m.set(b.id,b)}return [...m.values()]
}
function canonicalBonds(items){return [...items].sort((a,b)=>a.id.localeCompare(b.id)).map(b=>JSON.stringify(b)).join('\n')}
function sameBondSet(a,b){return canonicalBonds(a)===canonicalBonds(b)}
async function load(){bonds=await getAll();render()}
function render(){
 const active=bonds.filter(b=>!b.deletedAt),data=active.map(b=>({...b,calc:estimateBond(b)}));const principal=data.reduce((s,b)=>s+Number(b.amount),0),supported=data.filter(b=>!b.calc.unsupported),value=supported.reduce((s,b)=>s+b.calc.value,0),redeem=supported.reduce((s,b)=>s+b.calc.redeemable,0),interest=supported.reduce((s,b)=>s+b.calc.interest,0),pending=data.length-supported.length;
 $('#portfolioValue').textContent=money(value)+(pending?' • '+pending+' pending':'');$('#principal').textContent=money(principal);$('#redeemable').textContent=money(redeem)+(pending?' • '+pending+' pending':'');$('#portfolioChange').textContent='+'+money(interest)+' interest'+(pending?' • '+supported.length+' of '+data.length+' valued':'');
 $('#empty').hidden=active.length>0;const list=$('#bondList');list.innerHTML='';
 data.sort((a,b)=>sortNewest?b.issueMonth.localeCompare(a.issueMonth):a.issueMonth.localeCompare(b.issueMonth)).forEach(b=>{
  const el=document.createElement('article');el.className='bond card';el.innerHTML='<div class="bond-icon">I</div><div><h3></h3><p></p></div><div class="bond-value money"><b></b><small></small></div>';
  el.querySelector('h3').textContent=b.nickname||'I Bond';el.querySelector('p').textContent=fmtMonth(addMonths(b.issueMonth,0))+' • '+money(b.amount)+' principal'+(b.calc.unsupported?' • valuation pending':' • '+(b.calc.rate*100).toFixed(2)+'% rate • redeemable '+fmtMonth(b.calc.unlockDate)+' • penalty ends '+fmtMonth(b.calc.penaltyEnd)+' • matures '+fmtMonth(b.calc.maturityDate));
  el.querySelector('.bond-value b').textContent=b.calc.unsupported?'Estimate pending':money(b.calc.value);el.querySelector('.bond-value small').textContent=b.calc.unsupported?'Rate history pending':'+'+money(b.calc.interest);
  el.addEventListener('click',()=>editBond(b));list.appendChild(el);
 });
}
function editBond(b){$('#dialogTitle').textContent='Edit I Bond';$('#editId').value=b.id;$('#nickname').value=b.nickname||'';$('#issueMonth').value=b.issueMonth;$('#amount').value=b.amount;$('#bondDialog').showModal()}
function toast(s){const t=$('#toast');t.textContent=s;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
function applyTheme(v){localStorage.setItem('theme',v);document.documentElement.dataset.theme=v==='system'?'':v;$('#appearanceState').textContent=v[0].toUpperCase()+v.slice(1)}
async function exportBackup(){const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='ibond-ledger-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href);toast('Backup exported')}
async function importBackup(file){const data=JSON.parse(await file.text());if(data.schemaVersion!==1||!Array.isArray(data.bonds)||!data.bonds.every(validBond))throw Error('Unsupported or invalid backup');if(!confirm('Restore will replace the portfolio on this device. Continue?'))return;await replaceBonds(data.bonds);toast('Portfolio restored')}
async function getMeta(key){return new Promise((res,rej)=>{const r=tx(META).get(key);r.onsuccess=()=>res(r.result?.value);r.onerror=()=>rej(r.error)})}
async function setMeta(key,value){return put({key,value},META)}
function driveReady(){return GOOGLE_CLIENT_ID&&window.google?.accounts?.oauth2}
function initDrive(){if(!driveReady())return false;tokenClient=google.accounts.oauth2.initTokenClient({client_id:GOOGLE_CLIENT_ID,scope:DRIVE_SCOPE,callback:r=>{if(r.error)return toast('Google authorization failed');accessToken=r.access_token;syncDrive()}});return true}
async function driveFetch(url,opt={}){const r=await fetch(url,{...opt,headers:{Authorization:'Bearer '+accessToken,...(opt.headers||{})}});if(!r.ok)throw Error('Drive '+r.status);return r}
async function findDriveFile(){const q=encodeURIComponent("name='ibond-ledger.json' and 'appDataFolder' in parents and trashed=false");const r=await driveFetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q='+q+'&fields=files(id,name,modifiedTime)');return (await r.json()).files?.[0]}
async function downloadDrive(id){const r=await driveFetch('https://www.googleapis.com/drive/v3/files/'+id+'?alt=media');return r.json()}
async function uploadDrive(id,data){const body=JSON.stringify(data),boundary='ibondledgerboundary';const meta=id?{}:{name:'ibond-ledger.json',parents:['appDataFolder']};const payload='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(meta)+'\r\n--'+boundary+'\r\nContent-Type: application/json\r\n\r\n'+body+'\r\n--'+boundary+'--';const url=id?'https://www.googleapis.com/upload/drive/v3/files/'+id+'?uploadType=multipart':'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';return driveFetch(url,{method:id?'PATCH':'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body:payload})}
async function syncDrive(){
 try{
  $('#syncTitle').textContent='Syncing…';const file=await findDriveFile(),local=snapshot();
  if(!file){await uploadDrive(null,local)}
  else{
   const cloud=await downloadDrive(file.id);if(!Array.isArray(cloud.bonds)||!cloud.bonds.every(validBond))throw Error('Cloud portfolio is invalid');
   if(bonds.length===0&&cloud.bonds.length){await replaceBonds(cloud.bonds)}
   else{
    const merged=mergeBonds(bonds,cloud.bonds);
    const localChanged=!sameBondSet(merged,bonds),cloudChanged=!sameBondSet(merged,cloud.bonds);
    if(localChanged&&cloudChanged&&!confirm('Both this device and Google Drive contain newer changes. Merge both portfolios?')){$('#syncTitle').textContent='Sync unresolved';$('#syncStatus').textContent='No data was overwritten';toast('Sync left unchanged');return}
    if(localChanged)await replaceBonds(merged);
    if(cloudChanged)await uploadDrive(file.id,{schemaVersion:1,exportedAt:new Date().toISOString(),bonds:merged});
   }
  }
  const now=new Date().toISOString();await setMeta('lastSync',now);$('#syncTitle').textContent='Synced';$('#syncStatus').textContent='Google Drive • '+new Date(now).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});toast('Google Drive synced')
 }catch(e){$('#syncTitle').textContent='Sync needs attention';$('#syncStatus').textContent=e.message;toast('Sync failed')}
}
function requestSync(){if(!GOOGLE_CLIENT_ID)return toast('Google Drive setup needs an OAuth client ID');if(!initDrive())return toast('Google sign-in is still loading');tokenClient.requestAccessToken({prompt:accessToken?'':'consent'})}
async function changed(){await setMeta('lastChange',new Date().toISOString());if(accessToken)syncDrive()}
async function init(){
 db=await openDB();applyTheme(localStorage.getItem('theme')||'system');await load();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js');
 $('#addBtn').onclick=()=>{$('#dialogTitle').textContent='Add I Bond';$('#bondForm').reset();$('#editId').value='';$('#issueMonth').value=new Date().toISOString().slice(0,7);$('#bondDialog').showModal()};
 document.querySelectorAll('.close').forEach(x=>x.onclick=()=>$('#bondDialog').close());
 $('#bondForm').onsubmit=async e=>{e.preventDefault();const id=$('#editId').value||crypto.randomUUID();await put({id,nickname:$('#nickname').value.trim(),issueMonth:$('#issueMonth').value,amount:Number($('#amount').value),createdAt:bonds.find(x=>x.id===id)?.createdAt||new Date().toISOString(),modifiedAt:new Date().toISOString()});$('#bondDialog').close();await load();await changed();toast('Bond saved')};
 $('#sortBtn').onclick=()=>{sortNewest=!sortNewest;$('#sortBtn').textContent=sortNewest?'Newest first':'Oldest first';render()};
 $('#hideBtn').onclick=()=>document.body.classList.toggle('private');
 const openMore=()=>$('#moreDialog').showModal();$('#settingsBtn').onclick=openMore;document.querySelector('[data-tab="more"]').onclick=openMore;$('.close-more').onclick=()=>$('#moreDialog').close();
 $('#themeBtn').onclick=()=>$('#themeDialog').showModal();$('#appearanceBtn').onclick=()=>$('#themeDialog').showModal();$('.close-theme').onclick=()=>$('#themeDialog').close();document.querySelectorAll('[data-theme]').forEach(x=>x.onclick=()=>{applyTheme(x.dataset.theme);$('#themeDialog').close()});
 $('#exportBtn').onclick=exportBackup;$('#importFile').onchange=async e=>{try{await importBackup(e.target.files[0]);await changed()}catch(err){toast('Backup could not be imported')}};
 $('#driveBtn').onclick=requestSync;$('#syncBtn').onclick=requestSync;
 setTimeout(()=>{if(GOOGLE_CLIENT_ID)initDrive()},1200);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&accessToken)syncDrive()});
}
init();