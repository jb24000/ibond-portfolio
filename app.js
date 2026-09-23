import {estimateBond,fmtMonthKey,currentIssueInfo,setRateUpdates,nextRatePeriod} from './ibond.js';

const DB_NAME='ibond-ledger',DB_VERSION=1,STORE='bonds',META='meta';
const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_CLIENT_ID='833599244995-si767imruqfvnulr7e16ifqpoeccmoja.apps.googleusercontent.com';
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n||0);
let db,bonds=[],rateUpdates=[],sortNewest=true,tokenClient=null,accessToken=null;

function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'id'});if(!d.objectStoreNames.contains(META))d.createObjectStore(META,{keyPath:'key'})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}
function getAll(){return new Promise((res,rej)=>{const r=tx(STORE).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function put(v,store=STORE){return new Promise((res,rej)=>{const r=tx(store,'readwrite').put(v);r.onsuccess=()=>res(v);r.onerror=()=>rej(r.error)})}
async function del(id){
 const existing=bonds.find(b=>b.id===id);if(!existing)return;
 const now=new Date().toISOString();await put({...existing,deletedAt:now,modifiedAt:now});await load();await changed();
}
function snapshot(){return {schemaVersion:2,exportedAt:new Date().toISOString(),bonds,rateUpdates}}
function validBond(b){return b&&typeof b.id==='string'&&typeof b.issueMonth==='string'&&/^\d{4}-\d{2}$/.test(b.issueMonth)&&Number.isFinite(Number(b.amount))&&Number(b.amount)>=25&&typeof b.modifiedAt==='string'&&(!b.deletedAt||typeof b.deletedAt==='string')}
async function replaceBonds(next){
 if(!Array.isArray(next)||!next.every(validBond))throw Error('Invalid portfolio data');
 await new Promise((res,rej)=>{const t=db.transaction(STORE,'readwrite'),s=t.objectStore(STORE);s.clear();for(const b of next)s.put(b);t.oncomplete=res;t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||Error('Portfolio write aborted'))});
 await load();
}
function mergeBonds(local,cloud){
 const invalid=[...local,...cloud].filter(b=>!validBond(b));if(invalid.length)throw Error(invalid.length+' invalid bond record(s); sync stopped');
 const m=new Map();for(const b of [...local,...cloud]){const old=m.get(b.id);if(!old){m.set(b.id,b);continue}const winner=b.modifiedAt>old.modifiedAt?b:old,sa=old.snowball,sb=b.snowball;let snowball=sa||sb||null;if(sa&&sb)snowball=Number(sb.importedAt)>Number(sa.importedAt)?sb:sa;m.set(b.id,{...winner,snowball})}return [...m.values()];
}
function stableRecordString(b){const keys=Object.keys(b).sort(),ordered={};for(const k of keys)ordered[k]=b[k];return JSON.stringify(ordered)}
function canonicalBonds(items){return [...items].sort((a,b)=>a.id.localeCompare(b.id)).map(stableRecordString).join('\n')}
function sameBondSet(a,b){return canonicalBonds(a)===canonicalBonds(b)}
async function load(){bonds=await getAll();rateUpdates=setRateUpdates(await getMeta('rateUpdates')||[]);await setMeta('rateUpdates',rateUpdates);render()}

function render(){
 const active=bonds.filter(b=>!b.deletedAt),data=active.map(b=>({...b,calc:estimateBond(b)}));
 const principal=data.reduce((s,b)=>s+Number(b.amount),0),supported=data.filter(b=>!b.calc.unsupported);
 const value=supported.reduce((s,b)=>s+b.calc.value,0),redeem=supported.reduce((s,b)=>s+b.calc.redeemable,0),interest=supported.reduce((s,b)=>s+b.calc.interest,0),pending=data.length-supported.length;
 $('#portfolioValue').textContent=money(value)+(pending?' • '+pending+' pending':'');
 $('#principal').textContent=money(principal);$('#redeemable').textContent=money(redeem)+(pending?' • '+pending+' pending':'');
 $('#portfolioChange').textContent=(interest>=0?'+':'')+money(interest)+' accrued interest'+(pending?' • '+supported.length+' of '+data.length+' valued':'');
 const info=currentIssueInfo();$('#rateBadge').textContent=info.rate==null?'Rate data unavailable':(info.projected?'Rate update required • through '+fmtMonthKey(info.dataThrough):'Current issue '+(info.rate*100).toFixed(2)+'%');if($('#rateState'))$('#rateState').textContent=info.projected?'Update required':'Through '+fmtMonthKey(info.dataThrough);
 $('#empty').hidden=active.length>0;const list=$('#bondList');list.innerHTML='';
 data.sort((a,b)=>sortNewest?b.issueMonth.localeCompare(a.issueMonth):a.issueMonth.localeCompare(b.issueMonth)).forEach(b=>{
  const el=document.createElement('article');el.className='bond card';
  el.innerHTML='<div class="bond-icon">I</div><div><h3></h3><p></p></div><div class="bond-value money"><b></b><small></small></div>';
  el.querySelector('h3').textContent=b.nickname||'I Bond';
  el.querySelector('p').textContent=fmtMonthKey(b.issueMonth)+' • '+money(b.amount)+' principal'+(b.calc.unsupported?' • valuation pending':' • '+(b.calc.rate*100).toFixed(2)+'% rate'+(b.calc.projected?' (unconfirmed)':'')+' • redeemable '+fmtMonthKey(b.calc.unlockDate)+' • penalty ends '+fmtMonthKey(b.calc.penaltyEnd));
  el.querySelector('.bond-value b').textContent=b.calc.unsupported?'Estimate pending':money(b.calc.value);
  el.querySelector('.bond-value small').textContent=b.calc.unsupported?'Rate data pending':'+'+money(b.calc.interest)+' accrued';
  el.addEventListener('click',()=>editBond(b));list.appendChild(el);
 });
 renderAnalytics(data,principal,value,redeem,interest,pending);
 renderTimeline(data);
}
function renderAnalytics(data,principal,value,redeem,interest,pending){
 if(!$('#analyticsBody'))return;
 const penalty=data.filter(b=>b.calc.age>=12&&b.calc.age<60).length,locked=data.filter(b=>b.calc.age<12).length;
 $('#analyticsBody').innerHTML=`<div class="metric-grid"><div><span>Bonds</span><strong>${data.length}</strong></div><div><span>Principal</span><strong>${money(principal)}</strong></div><div><span>Accrued value</span><strong>${money(value)}</strong></div><div><span>Redeemable</span><strong>${money(redeem)}</strong></div><div><span>Interest</span><strong>${money(interest)}</strong></div><div><span>Locked / penalty</span><strong>${locked} / ${penalty}</strong></div></div>${pending?'<p class="fine">'+pending+' bond(s) are pending rate coverage.</p>':''}`;
}
function renderTimeline(data){
 if(!$('#timelineBody'))return;
 const events=[];
 for(const b of data){if(b.calc.unsupported)continue;events.push([b.calc.unlockDate,'Redemption unlock',b.nickname||'I Bond']);events.push([b.calc.penaltyEnd,'3-month penalty ends',b.nickname||'I Bond']);events.push([b.calc.maturityDate,'30-year maturity',b.nickname||'I Bond'])}
 events.sort((a,b)=>a[0].localeCompare(b[0]));
 $('#timelineBody').innerHTML=events.length?events.map(e=>`<div class="timeline-row"><b>${fmtMonthKey(e[0])}</b><span>${e[1]} • ${escapeHtml(e[2])}</span></div>`).join(''):'<p class="fine">Add a bond to build your timeline.</p>';
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function editBond(b){$('#dialogTitle').textContent='Edit I Bond';$('#editId').value=b.id;$('#nickname').value=b.nickname||'';$('#issueMonth').value=b.issueMonth;$('#amount').value=b.amount;$('#deleteBtn').hidden=false;$('#bondDialog').showModal()}
function toast(s){const t=$('#toast');t.textContent=s;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}
function applyTheme(v){if(!['light','dark','system'].includes(v))return;localStorage.setItem('theme',v);if(v==='system')document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',v);$('#appearanceState').textContent=v[0].toUpperCase()+v.slice(1)}
async function exportBackup(){const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='ibond-ledger-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href);toast('Backup exported')}
const SNOWBALL_HEADERS=['Event','Date','Symbol','Price','Quantity','Currency','FeeTax','Exchange','Note'];
function issueTicker(issueMonth){return 'IB-'+issueMonth}
function localDateKey(d=new Date()){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function issueDate(issueMonth){return issueMonth+'-01'}
function safeCsvText(v){const s=String(v??'');return /^[=+\-@]/.test(s)?"'"+s:s}
function csvCell(v){const s=safeCsvText(v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function snowballDrift(){return bonds.filter(b=>b.snowball&&(b.deletedAt||Number(b.amount)!==Number(b.snowball.amount)||b.issueMonth!==b.snowball.issueMonth))}
function driftTickers(drift){const s=new Set();for(const b of drift){if(b.snowball?.issueMonth)s.add(issueTicker(b.snowball.issueMonth));if(!b.deletedAt&&b.issueMonth)s.add(issueTicker(b.issueMonth))}return s}
function snowballRows(mode,blockedTickers=new Set()){
 const active=bonds.filter(b=>!b.deletedAt),byIssue=new Map(),rows=[],buyIds=[],unsupportedTickers=[];
 for(const b of active){const ticker=issueTicker(b.issueMonth),group=byIssue.get(ticker)||{issueMonth:b.issueMonth,bonds:[]};group.bonds.push(b);byIssue.set(ticker,group)}
 for(const [ticker,g] of [...byIssue.entries()].sort((a,b)=>a[1].issueMonth.localeCompare(b[1].issueMonth))){
  if(mode==='full'||mode==='incremental')for(const b of g.bonds)if(mode==='full'||!b.snowball){rows.push(['Buy',issueDate(b.issueMonth),ticker,'1.00',Number(b.amount).toFixed(2),'USD','0','CUSTOM_HOLDING','Series I Savings Bond']);buyIds.push(b.id)}
  if(blockedTickers.has(ticker))continue;
  const valued=g.bonds.map(b=>({b,c:estimateBond(b)}));if(valued.some(x=>x.c.unsupported)){unsupportedTickers.push(ticker);continue}
  const invested=valued.reduce((s,x)=>s+Number(x.b.amount),0);if(invested===0)continue;
  const currentValue=valued.reduce((s,x)=>s+x.c.value,0),price=(currentValue/invested).toFixed(6);
  rows.push(['CUSTOM_HOLDING_PRICE',localDateKey(),ticker,price,'','USD','0','CUSTOM_HOLDING','Series I Savings Bond']);
 }return {rows,buyIds,unsupportedTickers};
}
async function stampSnowball(ids){const set=new Set(ids),now=Date.now();for(const b of bonds)if(set.has(b.id)&&!b.deletedAt)await put({...b,snowball:{importedAt:now,amount:Number(b.amount),issueMonth:b.issueMonth},modifiedAt:new Date().toISOString()});await load();await changed()}
async function migrateSnowballExportState(){const old=await getMeta('snowballExportedBondIds');if(!Array.isArray(old))return;await stampSnowball(old);await deleteMeta('snowballExportedBondIds')}
async function renderSnowballPending(){const p=await getMeta('snowballPending'),el=$('#snowballPending');if(!el)return;if(!p){el.hidden=true;return}el.hidden=false;$('#snowballPendingText').textContent='Did you import '+p.file+' into Snowball?';$('#snowballPendingYes').textContent='Yes, mark '+p.ids.length+' purchases as imported'}
async function resolveSnowballPending(action){const p=await getMeta('snowballPending');if(!p)return;if(action==='yes')await stampSnowball(p.ids);if(action!=='notyet'){await deleteMeta('snowballPending');await renderSnowballPending()}else toast('Pending Snowball import kept')}
function showSnowballDrift(drift){const box=$('#snowballDriftList');box.innerHTML='';for(const b of drift){const old=b.snowball,newTicker=b.deletedAt?'deleted':issueTicker(b.issueMonth),row=document.createElement('div');row.className='drift-row';const detail=b.deletedAt?'deleted':issueTicker(old.issueMonth)+' '+money(old.amount)+' → '+newTicker+' '+money(b.amount);row.innerHTML='<div><b></b><small></small></div><button class="secondary">Acknowledge</button>';row.querySelector('b').textContent=issueTicker(old.issueMonth);row.querySelector('small').textContent=detail;row.querySelector('button').onclick=async()=>{const current=bonds.find(x=>x.id===b.id);if(!current)return;await put({...current,snowball:current.deletedAt?null:{importedAt:Date.now(),amount:Number(current.amount),issueMonth:current.issueMonth},modifiedAt:new Date().toISOString()});await load();await changed();row.remove();if(!box.children.length)$('#snowballDriftDialog').close()};box.appendChild(row)}$('#snowballDriftDialog').showModal()}
function showSnowballStatus(){
 const box=$('#snowballStatusList');box.innerHTML='';
 for(const b of bonds.filter(x=>!x.deletedAt).sort((x,y)=>String(x.createdAt).localeCompare(String(y.createdAt)))){
  const row=document.createElement('label');row.className='drift-row';
  const cb=document.createElement('input');cb.type='checkbox';cb.checked=!!b.snowball;cb.dataset.id=b.id;
  const info=document.createElement('div'),title=document.createElement('b'),detail=document.createElement('small');
  title.textContent=(b.nickname||'I Bond')+' — '+money(b.amount);
  detail.textContent=issueTicker(b.issueMonth)+(b.snowball?' • already in Snowball':' • new / not imported');
  info.append(title,detail);row.append(cb,info);box.appendChild(row)
 }
 $('#snowballStatusDialog').showModal()
}
async function saveSnowballStatus(){
 const checks=[...document.querySelectorAll('#snowballStatusList input[type="checkbox"]')],now=Date.now();
 for(const cb of checks){
  const b=bonds.find(x=>x.id===cb.dataset.id);if(!b)continue;
  const next=cb.checked?{importedAt:b.snowball?.importedAt||now,amount:Number(b.amount),issueMonth:b.issueMonth}:null;
  if(JSON.stringify(next)!==JSON.stringify(b.snowball||null))await put({...b,snowball:next,modifiedAt:new Date().toISOString()})
 }
 await load();await changed();$('#snowballStatusDialog').close();toast('Snowball import status saved')
}
async function exportSnowballCsv(mode){
 const active=bonds.filter(b=>!b.deletedAt);if(!active.length)return toast('No bonds to export');
 const pending=await getMeta('snowballPending');if(pending&&mode!=='prices')return toast('Resolve the pending Snowball import first');
 if(mode==='full'&&!confirm('Only import this into an empty Snowball portfolio, or Buy rows will duplicate. Continue?'))return;
 if(mode==='incremental'&&!active.some(b=>b.snowball)){if(confirm('Are these purchases already in your Snowball portfolio?')){await stampSnowball(active.map(b=>b.id));toast('Existing purchases marked as imported');return}toast('Use Full history into an EMPTY Snowball portfolio');return}
 const drift=snowballDrift(),blocked=driftTickers(drift);if(drift.length){showSnowballDrift(drift);toast('These purchases changed after import. Fix them manually in Snowball: '+[...blocked].join(', '))}
 const {rows,buyIds,unsupportedTickers}=snowballRows(mode,blocked),csv=[SNOWBALL_HEADERS,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a'),date=localDateKey();a.href=URL.createObjectURL(blob);a.download='ibond-snowball-'+mode+'-'+date+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
 if((mode==='full'||mode==='incremental')&&buyIds.length){await setMeta('snowballPending',{file:a.download,ids:buyIds,createdAt:Date.now()});await renderSnowballPending()}
 const notes=[];if(unsupportedTickers.length)notes.push('Prices skipped for: '+unsupportedTickers.join(', '));if(mode==='incremental'&&buyIds.length){const snapTickers=new Set(active.filter(b=>b.snowball).map(b=>issueTicker(b.snowball.issueMonth))),newTickers=[...new Set(active.filter(b=>buyIds.includes(b.id)).map(b=>issueTicker(b.issueMonth)).filter(t=>!snapTickers.has(t)))];if(newTickers.length)notes.push('Create custom holding '+newTickers.join(', ')+' in Snowball before importing.')}toast(notes.join(' • ')||'Snowball CSV downloaded');
}
async function importBackup(file){const data=JSON.parse(await file.text());if(![1,2].includes(data.schemaVersion)||!Array.isArray(data.bonds)||!data.bonds.every(validBond))throw Error('Unsupported or invalid backup');if(!confirm('Restore will replace the portfolio on this device. Continue?'))return;await replaceBonds(data.bonds);if(Array.isArray(data.rateUpdates)){rateUpdates=setRateUpdates(data.rateUpdates);await setMeta('rateUpdates',rateUpdates)}await changed();render();toast('Portfolio restored')}
async function getMeta(key){return new Promise((res,rej)=>{const r=tx(META).get(key);r.onsuccess=()=>res(r.result?.value);r.onerror=()=>rej(r.error)})}
async function setMeta(key,value){return put({key,value},META)}
async function deleteMeta(key){return new Promise((res,rej)=>{const r=tx(META,'readwrite').delete(key);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}

function googleClientId(){return GOOGLE_CLIENT_ID}
function driveReady(){return googleClientId()&&window.google?.accounts?.oauth2}
function initDrive(){
 if(!driveReady())return false;
 tokenClient=google.accounts.oauth2.initTokenClient({client_id:googleClientId(),scope:DRIVE_SCOPE,callback:r=>{if(r.error)return toast('Google authorization failed');accessToken=r.access_token;syncDrive()}});
 return true;
}
async function driveFetch(url,opt={}){const r=await fetch(url,{...opt,headers:{Authorization:'Bearer '+accessToken,...(opt.headers||{})}});if(!r.ok){let detail='';try{const body=await r.clone().json();const reason=body?.error?.errors?.[0]?.reason||body?.error?.status||'';const message=body?.error?.message||'';detail=[reason,message].filter(Boolean).join(' — ')}catch{try{detail=(await r.clone().text()).slice(0,300)}catch{}}throw Error('Drive '+r.status+(detail?' • '+detail:''))}return r}
async function findDriveFile(){const q=encodeURIComponent("name='ibond-ledger.json' and 'appDataFolder' in parents and trashed=false");const r=await driveFetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q='+q+'&fields=files(id,name,modifiedTime)');return (await r.json()).files?.[0]}
async function downloadDrive(id){const r=await driveFetch('https://www.googleapis.com/drive/v3/files/'+id+'?alt=media');return r.json()}
async function uploadDrive(id,data){const body=JSON.stringify(data),boundary='ibondledgerboundary';const meta=id?{}:{name:'ibond-ledger.json',parents:['appDataFolder']};const payload='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(meta)+'\r\n--'+boundary+'\r\nContent-Type: application/json\r\n\r\n'+body+'\r\n--'+boundary+'--';const url=id?'https://www.googleapis.com/upload/drive/v3/files/'+id+'?uploadType=multipart':'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';return driveFetch(url,{method:id?'PATCH':'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body:payload})}
async function syncDrive(){
 try{
  $('#syncTitle').textContent='Syncing…';const file=await findDriveFile(),local=snapshot();
  if(!file)await uploadDrive(null,local);
  else{
   const cloud=await downloadDrive(file.id);if(!Array.isArray(cloud.bonds)||!cloud.bonds.every(validBond))throw Error('Cloud portfolio contains invalid data');if(Array.isArray(cloud.rateUpdates)){const m=new Map(rateUpdates.map(r=>[r.key,r]));for(const r of cloud.rateUpdates){const old=m.get(r.key);if(!old||String(r.modifiedAt||'')>String(old.modifiedAt||''))m.set(r.key,r)}rateUpdates=setRateUpdates([...m.values()]);await setMeta('rateUpdates',rateUpdates)}
   if(bonds.length===0&&cloud.bonds.length)await replaceBonds(cloud.bonds);
   else{
    const merged=mergeBonds(bonds,cloud.bonds),localChanged=!sameBondSet(merged,bonds),cloudChanged=!sameBondSet(merged,cloud.bonds);
    if(localChanged&&cloudChanged&&!confirm('Both this device and Google Drive contain changes. Merge both portfolios?')){$('#syncTitle').textContent='Sync unresolved';$('#syncStatus').textContent='No data was overwritten';toast('Sync left unchanged');return}
    if(localChanged)await replaceBonds(merged);
    if(cloudChanged||JSON.stringify(cloud.rateUpdates||[])!==JSON.stringify(rateUpdates))await uploadDrive(file.id,{schemaVersion:2,exportedAt:new Date().toISOString(),bonds:merged,rateUpdates});
   }
  }
  const now=new Date().toISOString();await setMeta('lastSync',now);$('#syncTitle').textContent='Synced';$('#syncStatus').textContent='Google Drive • '+new Date(now).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});toast('Google Drive synced');
 }catch(e){$('#syncTitle').textContent='Sync needs attention';$('#syncStatus').textContent=e.message;toast('Sync failed')}
}
function requestSync(){
 if(!initDrive())return toast('Google sign-in is still loading');
 tokenClient.requestAccessToken({prompt:accessToken?'':'consent'});
}
async function changed(){await setMeta('lastChange',new Date().toISOString());if(accessToken)syncDrive()}

async function init(){
 db=await openDB();if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});
 applyTheme(localStorage.getItem('theme')||'system');await load();await migrateSnowballExportState();await renderSnowballPending();
 if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js');
 if(googleClientId())$('#driveState').textContent='Configured';
 $('#addBtn').onclick=()=>{$('#dialogTitle').textContent='Add I Bond';$('#bondForm').reset();$('#editId').value='';$('#deleteBtn').hidden=true;$('#issueMonth').value=new Date().toISOString().slice(0,7);$('#bondDialog').showModal()};
 document.querySelectorAll('.close').forEach(x=>x.onclick=()=>$('#bondDialog').close());
 $('#bondForm').onsubmit=async e=>{e.preventDefault();const id=$('#editId').value||crypto.randomUUID(),existing=bonds.find(x=>x.id===id);await put({id,nickname:$('#nickname').value.trim(),issueMonth:$('#issueMonth').value,amount:Number($('#amount').value),snowball:existing?.snowball||null,createdAt:existing?.createdAt||new Date().toISOString(),modifiedAt:new Date().toISOString()});$('#bondDialog').close();await load();await changed();toast('Bond saved')};
 $('#deleteBtn').onclick=async()=>{const id=$('#editId').value;if(!id||!confirm('Delete this bond from the portfolio?'))return;$('#bondDialog').close();await del(id);toast('Bond deleted')};
 $('#sortBtn').onclick=()=>{sortNewest=!sortNewest;$('#sortBtn').textContent=sortNewest?'Newest first':'Oldest first';render()};
 $('#hideBtn').onclick=()=>document.body.classList.toggle('private');
 const openMore=()=>$('#moreDialog').showModal();$('#settingsBtn').onclick=openMore;document.querySelector('[data-tab="more"]').onclick=openMore;$('.close-more').onclick=()=>$('#moreDialog').close();
 document.querySelector('[data-tab="analytics"]').onclick=()=>$('#analyticsDialog').showModal();document.querySelector('[data-tab="timeline"]').onclick=()=>$('#timelineDialog').showModal();
 document.querySelectorAll('.close-panel').forEach(x=>x.onclick=()=>x.closest('dialog').close());
 $('#themeBtn').onclick=()=>$('#themeDialog').showModal();$('#appearanceBtn').onclick=()=>$('#themeDialog').showModal();$('.close-theme').onclick=()=>$('#themeDialog').close();document.querySelectorAll('.theme-options [data-theme]').forEach(x=>x.onclick=()=>{applyTheme(x.dataset.theme);$('#themeDialog').close()});
 $('#snowballPendingYes').onclick=()=>resolveSnowballPending('yes');$('#snowballPendingNotYet').onclick=()=>resolveSnowballPending('notyet');$('#snowballPendingDiscard').onclick=()=>resolveSnowballPending('discard');$('.close-drift').onclick=()=>$('#snowballDriftDialog').close();$('#exportBtn').onclick=exportBackup;$('#exportCsvFullBtn').onclick=()=>exportSnowballCsv('full');$('#exportCsvIncrementalBtn').onclick=()=>exportSnowballCsv('incremental');$('#exportCsvPricesBtn').onclick=()=>exportSnowballCsv('prices');$('#snowballStatusBtn').onclick=showSnowballStatus;$('#snowballStatusSave').onclick=saveSnowballStatus;$('.close-snowball-status').onclick=()=>$('#snowballStatusDialog').close();$('#importFile').onchange=async e=>{try{await importBackup(e.target.files[0])}catch(err){toast(err.message||'Backup could not be imported')}};
 $('#driveBtn').onclick=requestSync;$('#syncBtn').onclick=requestSync;
 $('#rateUpdateBtn').onclick=()=>{$('#ratePeriod').value=nextRatePeriod();$('#rateDialog').showModal()};
 document.querySelectorAll('.close-rate').forEach(x=>x.onclick=()=>$('#rateDialog').close());
 $('#rateForm').onsubmit=async e=>{e.preventDefault();const key=$('#ratePeriod').value,expected=nextRatePeriod();if(key!==expected){toast('Next rate period must be '+fmtMonthKey(expected));return}const fixed=Number($('#fixedRate').value)/100,inflation=Number($('#inflationRate').value)/100;if(!Number.isFinite(fixed)||!Number.isFinite(inflation)){toast('Enter valid rate values');return}const entry={key,fixed,inflation,modifiedAt:new Date().toISOString()};rateUpdates=setRateUpdates([...rateUpdates,entry]);if(!rateUpdates.some(r=>r.key===key)){toast('Rate update was rejected');return}await setMeta('rateUpdates',rateUpdates);$('#rateDialog').close();render();await changed();toast('Rate data updated')};
 const lastSync=await getMeta('lastSync');if(lastSync){$('#syncTitle').textContent='Last synced';$('#syncStatus').textContent='Google Drive • '+new Date(lastSync).toLocaleString()}
 setTimeout(()=>{if(googleClientId()&&initDrive())tokenClient.requestAccessToken({prompt:''})},1200);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&accessToken)syncDrive()});
}
init();