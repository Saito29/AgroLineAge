/* AgroLineAge — Livestock Family Tree. No build step, no secrets. Data: this browser (works offline) + optional Google Drive sync. */
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6),norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const STAT=['Alive','Sold','Deceased'],OCOL=['#1f7a5c','#2f6fb5','#b5651d','#8a4a8f','#b8962e','#c0395d','#3a8f9e','#6b7f2a'];
const ACT={Vaccination:'💉',Deworming:'💊',Treatment:'🩺','Vet check-up':'🩺',Breeding:'💞','Birth / offspring':'🍼',Weighing:'⚖️',Feeding:'🌾','Insurance claim':'📄',Sold:'💰',Mortality:'🕊️',Other:'📝'};
const TERMS={goat:['Doe','Buck'],pig:['Sow','Boar'],cow:['Cow','Bull'],cattle:['Cow','Bull'],carabao:['Cow','Bull'],sheep:['Ewe','Ram'],chicken:['Hen','Rooster'],duck:['Duck','Drake']};
const W=190,H=128,GX=26,GY=74;
CFG.INSURERS=CFG.INSURERS||['PCIC (Philippine Crop Insurance Corp.)','CLIMBS','Private insurance company','Cooperative / mutual aid fund','Other'];
let S={v:2,orgs:[],farmers:[],animals:[],acts:[],pos:{},upd:0};
let col=new Set(),focus=null,sel=null,view='l',orgF='all',V={x:40,y:30,k:1},G={},tok=null,tc=null,fileId=null,timer=null,user=null,forceOff=false,mId=null,OP={},PT={s:'d',m:'d'},lastSync=null,busy=false;
const by=id=>S.animals.find(a=>a.id==id),fm=id=>S.farmers.find(f=>f.id==id),og=id=>S.orgs.find(o=>o.id==id);
const farmerOrg=f=>f&&og(f.org),ownerOrg=a=>farmerOrg(fm(a.owner)),oc=o=>(o&&o.color)||'#8a8f8c';
const kidsAll=id=>S.animals.filter(a=>a.parent==id);
const desc=(id,s=new Set())=>{kidsAll(id).forEach(k=>{if(!s.has(k.id)){s.add(k.id);desc(k.id,s)}});return s};
const actsOf=id=>S.acts.filter(x=>x.animal==id).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
const ico=s=>{s=(s||'').toLowerCase();return s.includes('pig')?'🐖':s.includes('carabao')?'🐃':s.includes('cow')||s.includes('cattle')?'🐄':s.includes('goat')?'🐐':s.includes('sheep')?'🐑':s.includes('chick')?'🐔':s.includes('duck')?'🦆':'🐾'};
const sexT=a=>{const s=(a.sex==='F'||a.sex==='M')?(a.species||'').toLowerCase():'',k=Object.keys(TERMS).find(x=>s.includes(x));return a.sex=='F'?(k?TERMS[k][0]:'Female'):a.sex=='M'?(k?TERMS[k][1]:'Male'):'Sex unknown'};
const insName=a=>a.insurer=='Other'?(a.insOther||'Other'):(a.insurer||'');
const peso=n=>n===''||n==null||isNaN(n)?'':'₱'+Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
const age=b=>{if(!b)return'';const d=new Date(b);if(isNaN(d))return'';let m=(new Date().getFullYear()-d.getFullYear())*12+new Date().getMonth()-d.getMonth();if(m<0)return'';return m<12?m+' mo':Math.floor(m/12)+' yr'+(m%12?' '+m%12+' mo':'')};
const fsize=n=>n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';

// ---------- data / migration ----------
function migrate(d){d=d&&typeof d=='object'?d:{};
  const s={v:2,orgs:d.orgs||[],farmers:d.farmers||[],animals:d.animals||[],acts:d.acts||[],pos:d.pos||{},upd:d.upd||0};
  if(!s.orgs.length&&s.farmers.length)s.orgs.push({id:'O'+uid(),name:CFG.ORG_NAME||'My organization',color:OCOL[0],location:'',notes:''}); // data from the older single-organization version
  s.orgs.forEach((o,i)=>{o.color=o.color||OCOL[i%OCOL.length]});
  s.farmers.forEach(f=>{if(!s.orgs.some(o=>o.id==f.org))f.org=s.orgs[0].id});
  s.animals.forEach(a=>{a.status=a.status||'Alive';a.insured=a.insured||'No';a.att=a.att||[];a.parent=a.parent||''});s.acts.forEach(x=>{x.att=x.att||[]});return s}
function persist(noR){S.upd=Date.now();try{localStorage.setItem('lt2',JSON.stringify(S));localStorage.setItem('lt2d','1')}catch(e){setSt('Browser storage is full — export a backup',1)}
  if(!noR)render();clearTimeout(timer);if(window.AGRO_PERSIST)window.AGRO_PERSIST();else if(canSync())timer=setTimeout(driveSave,1500);stat()}
const dirty=()=>localStorage.getItem('lt2d')=='1';

// ---------- attachments (stored on this device in IndexedDB; uploaded to Drive when signed in) ----------
const idb=new Promise((res,rej)=>{const r=indexedDB.open('agrolineage',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
const tx=async(m,f)=>{const d=await idb;return new Promise((res,rej)=>{const t=d.transaction('files',m),q=f(t.objectStore('files'));t.oncomplete=()=>res(q.result);t.onerror=()=>rej(t.error)})};
const fPut=(id,v)=>tx('readwrite',s=>s.put(v,id)),fGet=id=>tx('readonly',s=>s.get(id)),fDel=id=>tx('readwrite',s=>s.delete(id));
const allAtts=()=>[...S.animals.flatMap(a=>a.att||[]),...S.acts.flatMap(x=>x.att||[])];
const findAtt=id=>allAtts().find(m=>m.id==id);
async function saveFiles(files){const out=[];for(const f of files){if(f.size>(CFG.MAX_FILE_MB||10)*1048576)throw new Error(`"${f.name}" is larger than ${CFG.MAX_FILE_MB||10} MB.`);
  const id='X'+uid();await fPut(id,{blob:f});out.push({id,name:f.name,type:f.type||'application/octet-stream',size:f.size})}return out}
function dropFile(m){if(window.AGRO_DELETE_ATTACHMENT){window.AGRO_DELETE_ATTACHMENT(m);return}fDel(m.id).catch(()=>0);if(m.dr&&canSync())dr('https://www.googleapis.com/drive/v3/files/'+m.dr.id,{method:'DELETE'}).catch(()=>0)}
async function openAtt(id){const m=findAtt(id);if(!m)return;if(window.AGRO_OPEN_ATTACHMENT)return window.AGRO_OPEN_ATTACHMENT(m);let r;try{r=await fGet(id)}catch(e){}
  if(!r&&m.dr&&canSync()){try{const b=await(await dr('https://www.googleapis.com/drive/v3/files/'+m.dr.id+'?alt=media')).blob();r={blob:b};fPut(id,r).catch(()=>0)}catch(e){}}
  if(r){const u=URL.createObjectURL(new Blob([r.blob],{type:m.type}));if(!window.open(u,'_blank')){const a=document.createElement('a');a.href=u;a.download=m.name;a.click()}setTimeout(()=>URL.revokeObjectURL(u),60000)}
  else if(m.dr&&m.dr.link)window.open(m.dr.link,'_blank');else alert('This file is not on this device yet. Sign in and go online to download it from Google Drive.')}
const attOwner=(k,id)=>k=='A'?by(id):S.acts.find(x=>x.id==id);
function addAtt(k,id){const i=document.createElement('input');i.type='file';i.multiple=true;i.onchange=async()=>{try{const t=attOwner(k,id);t.att=(t.att||[]).concat(await saveFiles([...i.files]))}catch(e){return alert(e.message)}persist()};i.click()}
function rmAtt(k,id,aid){if(!confirm('Remove this attachment?'))return;const t=attOwner(k,id),m=t.att.find(x=>x.id==aid);dropFile(m);t.att=t.att.filter(x=>x.id!=aid);persist()}
const attList=(L,k,id)=>(L&&L.length?L.map(m=>`<div class="att">📎 <a onclick="openAtt('${m.id}')" title="${esc(m.name)}">${esc(m.name)}</a><span class="mu">${fsize(m.size||0)}</span>${k?`<button class="sm d" title="Remove" onclick="rmAtt('${k}','${id}','${m.id}')">✕</button>`:''}</div>`).join(''):'<span class="mu">No attachments.</span>');

// ---------- online / offline + Google ----------
const canSync=()=>!!tok&&navigator.onLine&&!forceOff;
function setSt(t,bad){$('st').textContent=t;$('st').className=bad?'err':''}
function stat(){if(window.AGRO_SUPABASE)return;let t;if(!tok)t=dirty()||S.animals.length?'Saved on this device only — sign in to sync to Google Drive':'';
  else if(forceOff||!navigator.onLine)t=dirty()?'Offline — changes are saved here and will sync when you are back online':'Offline — everything is saved on this device';
  else t=dirty()?'Unsynced changes…':'Synced to Google Drive ✓'+(lastSync?' '+lastSync.toLocaleTimeString():'');setSt(t)}
function netUI(){const on=navigator.onLine&&!forceOff;$('net').className=on?'':'off';$('net').lastChild.textContent=on?'Online':forceOff?'Offline (manual)':'Offline';if($('ob'))$('ob').textContent=forceOff?'Go online':'Work offline';stat()}
function toggleOffline(){forceOff=!forceOff;localStorage.setItem('lt2o',forceOff?'1':'');netUI();if(canSync()&&dirty())driveSave()}
addEventListener('online',()=>{netUI();if(canSync()&&dirty())driveSave()});addEventListener('offline',netUI);
async function dr(url,o={}){const r=await fetch(url,{...o,headers:{Authorization:'Bearer '+tok,...o.headers}});
  if(r.status==401){tok=null;showUser();setSt('Google session expired — sign in again to keep syncing',1);throw 0}
  if(!r.ok){setSt('Drive error '+r.status,1);throw new Error(await r.text())}return r}
async function up(name,mime,body,id,convert){const meta=id?{}:{name};if(!id&&convert)meta.mimeType=convert;if(!id&&CFG.FOLDER_ID)meta.parents=[CFG.FOLDER_ID];const b='b'+uid();
  const blob=new Blob([`--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`,body,`\r\n--${b}--`]);
  const r=await dr(`https://www.googleapis.com/upload/drive/v3/files${id?'/'+id:''}?uploadType=multipart&fields=id,webViewLink`,{method:id?'PATCH':'POST',headers:{'Content-Type':'multipart/related; boundary='+b},body:blob});return r.json()}
async function driveSave(){if(!canSync()||busy)return;busy=true;const v=S.upd;
  try{setSt('Syncing…');
    for(const m of allAtts())if(!m.dr){const r=await fGet(m.id).catch(()=>0);if(r){const x=await up(m.name,m.type,r.blob);m.dr={id:x.id,link:x.webViewLink}}}
    const r=await up('livestock-tree.json','application/json',JSON.stringify(S),fileId);fileId=r.id;localStorage.setItem('lt2f',fileId);localStorage.setItem('lt2',JSON.stringify(S));
    lastSync=new Date();if(S.upd==v)localStorage.removeItem('lt2d');stat()}
  catch(e){if(e)setSt('Sync failed — changes are kept on this device',1)}busy=false;if(canSync()&&dirty()&&S.upd!=v)timer=setTimeout(driveSave,1500)}
async function driveLoad(){try{setSt('Loading from Google Drive…');
  const q=encodeURIComponent(`name='livestock-tree.json' and trashed=false`+(CFG.FOLDER_ID?` and '${CFG.FOLDER_ID}' in parents`:''));
  const l=await(await dr('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id)')).json();
  if(!l.files.length)return driveSave();
  fileId=l.files[0].id;localStorage.setItem('lt2f',fileId);const d=migrate(await(await dr(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)).json());
  const localHas=S.animals.length||S.farmers.length||S.orgs.length;
  let useDrive=d.upd>S.upd;
  if(useDrive&&localHas&&dirty())useDrive=confirm('Google Drive has a newer copy, but this device has changes that were never synced.\n\nOK = use the Drive copy (this device\'s unsynced changes are lost)\nCancel = keep this device and overwrite Drive');
  if(useDrive){S=d;localStorage.setItem('lt2',JSON.stringify(S));localStorage.removeItem('lt2d');lastSync=new Date();render(true);stat()}else await driveSave()}catch(e){}}
function signIn(){
  if(!CFG.CLIENT_ID)return alert('Set CLIENT_ID in src/js/config.js first.');
  if(!navigator.onLine||forceOff)return alert('You are offline. Go online to sign in.');
  if(!window.google)return alert('The Google sign-in script has not loaded yet. Check your connection and try again.');
  tc=tc||google.accounts.oauth2.initTokenClient({client_id:CFG.CLIENT_ID,scope:'https://www.googleapis.com/auth/drive.file openid email profile',
    callback:async r=>{if(!r.access_token)return setSt('Sign-in cancelled',1);tok=r.access_token;
      try{const u=await(await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+tok}})).json();user={name:u.name,email:u.email,picture:u.picture};localStorage.setItem('lt2u',JSON.stringify(user))}catch(e){user=user||{name:'Google account'}}
      showUser();driveLoad()},error_callback:()=>setSt('Sign-in cancelled',1)});
  tc.requestAccessToken()}
function signOut(){if(!confirm('Sign out of Google? Your data stays on this device; Drive sync stops until you sign in again.'))return;
  const t=tok;tok=null;fileId=null;localStorage.removeItem('lt2f');localStorage.removeItem('lt2u');if(t&&window.google)try{google.accounts.oauth2.revoke(t,()=>{})}catch(e){}
  user=null;showUser();stat()}
function showUser(){const on=!!tok;$('gb').hidden=on;$('gx').hidden=!on;
  $('usr').innerHTML=on&&user?`${user.picture?`<img src="${esc(user.picture)}" alt="" referrerpolicy="no-referrer">`:'<span class="ph">👤</span>'}<div><b>${esc(user.name||'')}</b><br>${esc(user.email||'')}</div>`:'';
  const old=JSON.parse(localStorage.getItem('lt2u')||'null');$('gb').textContent=!on&&old&&old.name?'Reconnect as '+old.name:'Sign in with Google';stat()}

// ---------- tree building + layout ----------
function roots(){
  const vs=new Set(S.animals.filter(a=>orgF=='all'||(fm(a.owner)||{}).org==orgF).map(a=>a.id));
  const An=(a,same)=>{const ks=S.animals.filter(k=>k.parent==a.id&&vs.has(k.id)&&(!same||k.owner==a.owner)),c=col.has(a.id)&&ks.length>0;return{id:a.id,t:'a',r:a,n:ks.length,c,k:c?[]:ks.map(k=>An(k,same))}};
  if(view=='o')return S.orgs.filter(o=>orgF=='all'||o.id==orgF).map(o=>{const fs=S.farmers.filter(f=>f.org==o.id),c=col.has(o.id)&&fs.length>0;
    return{id:o.id,t:'o',r:o,n:fs.length,c,k:c?[]:fs.map(f=>{const tops=S.animals.filter(a=>a.owner==f.id&&!(by(a.parent)&&by(a.parent).owner==f.id)),branches=[];
      S.animals.filter(a=>vs.has(a.id)).forEach(a=>(window.AGRO_TRANSFER_HISTORY?.(a.id)||[]).forEach((transfer,index)=>{if(transfer.previous_owner_id==f.id)branches.push({id:`x${f.id}_${a.id}_${index}`,t:'x',r:a,transfer,step:index+1,targetId:a.id,n:0,c:false,k:[]})}));
      const c2=col.has(f.id)&&(tops.length+branches.length)>0;
      return{id:f.id,t:'f',r:f,n:tops.length+branches.length,c:c2,k:c2?[]:[...tops.map(a=>An(a,true)),...branches]}})}});
  const rs=focus?(vs.has(focus)?[by(focus)]:[]):S.animals.filter(a=>vs.has(a.id)&&!vs.has(a.parent));
  return rs.map(a=>An(a,false))}
const meas=n=>n.sw=n.k.length?Math.max(W,n.k.reduce((s,c)=>s+meas(c),0)+GX*(n.k.length-1)):W;
function place(n,l,d,p){n.x=l+n.sw/2-W/2;n.y=d*(H+GY);n.p=p;const tot=n.k.reduce((s,c)=>s+c.sw,0)+GX*Math.max(0,n.k.length-1);let x=l+(n.sw-tot)/2;n.k.forEach(c=>{place(c,x,d+1,n.id);x+=c.sw+GX})}
const flat=(n,o)=>{o.push(n);n.k.forEach(c=>flat(c,o))};
function cardHtml(n){const r=n.r,g=G[n.id],tg=n.n?`<button class="tg" data-a="tg" title="Show / hide what is below">${n.c?'▸ '+n.n:'▾'}</button>`:'';let cls='card',oc_,inner;
  if(n.t=='a'){const o=ownerOrg(r),f=fm(r.owner);oc_=oc(o);cls+=' an sx-'+(r.sex||'U')+(r.status=='Deceased'?' dead':'');
    inner=`<i class="ob"></i><button class="inf" data-a="info" title="Open details &amp; activities">ⓘ</button><div class="t1"><span class="av">${ico(r.species)}</span><b>${esc(r.tag)}</b></div><div class="t2"><span class="sx">${sexT(r)}</span> · ${esc(r.species)}${r.breed?' · '+esc(r.breed):''}</div><div class="t3">👤 ${esc(f?f.name:'No owner')}${r.born?' · '+esc(r.born):''}</div><div class="t4"><span class="pill st-${esc(r.status)}">${esc(r.status)}</span>${o?`<span class="oc" title="${esc(o.name)}">${esc(o.name)}</span>`:''}${r.insured=='Yes'?'<span title="Insured">🛡</span>':''}</div>`}
  else if(n.t=='f'){const o=farmerOrg(r);oc_=oc(o);cls+=' fr';inner=`<i class="ob"></i><div class="t1"><span class="av">🧑‍🌾</span><b>${esc(r.name)}</b></div><div class="t2">${esc(r.farm||'')}</div><div class="t3">${S.animals.filter(a=>a.owner==r.id).length} animals</div><div class="t4"><span class="oc">${esc(o?o.name:'')}</span></div>`}
  else if(n.t=='x'){const recipient=fm(n.transfer.new_owner_id);oc_=oc(farmerOrg(fm(n.transfer.previous_owner_id)));cls+=' transfer-ref sx-'+(r.sex||'U')+(r.status=='Deceased'?' dead':'');inner=`<i class="ob"></i><button class="inf" data-a="info" title="Open the shared animal record">i</button><div class="t1"><span class="av">${ico(r.species)}</span><b>${esc(r.tag)}</b></div><div class="t2"><span class="sx">${sexT(r)}</span> · ${esc(r.species)}${r.breed?' · '+esc(r.breed):''}</div><div class="t3">Transferred to ${esc(recipient?recipient.name:'new owner')}</div><div class="t4"><span class="rollover-copy-label" title="Rollover copy · transfer #${n.step} · ${esc(n.transfer.transferred_at||'date not recorded')}">ROLLOVER COPY · #${n.step} · ${esc(n.transfer.transferred_at||'date not recorded')}</span><span class="pill st-${esc(r.status)}">${esc(r.status)}</span></div>`}
  else{oc_=oc(r);cls+=' og';inner=`<i class="ob"></i><div class="t1"><span class="av">🏢</span><b>${esc(r.name)}</b></div><div class="t2">${esc(r.location||'')}</div><div class="t3">${S.farmers.filter(f=>f.org==r.id).length} farmers · ${S.animals.filter(a=>(fm(a.owner)||{}).org==r.id).length} animals</div>`}
  return `<div class="${cls}${sel==(n.t=='x'?r.id:n.id)?' sel':''}${n.c?' cn':''}" id="c-${n.id}" style="left:${g.x}px;top:${g.y}px;--oc:${oc_}">${inner}${tg}</div>`}
function edges(){let h='';for(const id in G){const g=G[id],a=G[g.p];if(!a)continue;const x1=a.x+W/2,y1=a.y+H,x2=g.x+W/2,y2=g.y,ym=Math.max(y1+14,(y1+y2)/2),cross=g.n.t=='a'&&a.n.t=='a'&&g.n.r.owner!=a.n.r.owner;
  h+=`<path ${cross?'class="x"':''} d="M${x1} ${y1}V${ym}H${x2}V${y2}"/>`}
  for(const id in G){const g=G[id];if(g.n.t!='x')continue;const target=G[g.n.targetId];if(!target)continue;const x1=g.x+W,y1=g.y+H/2,x2=target.x,y2=target.y+H/2,mid=(x1+x2)/2;h+=`<path class="ownership-link" d="M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}"/>`}
  $('ed').innerHTML=h}
function applyV(){$('wd').style.transform=`translate(${V.x}px,${V.y}px) scale(${V.k})`;$('zp').textContent=Math.round(V.k*100)+'%'}
function render(refit){
  if(focus&&!by(focus))focus=null;if(orgF!='all'&&!og(orgF))orgF='all';if(sel&&!by(sel)&&!fm(sel)&&!og(sel))sel=null;
  const R=roots();let x=0;R.forEach(r=>{meas(r);place(r,x,0,null);x+=r.sw+GX*2});
  const nodes=[];R.forEach(r=>flat(r,nodes));const P=S.pos[view]||{};G={};
  nodes.forEach(n=>{const o=P[n.id]||{dx:0,dy:0};G[n.id]={bx:n.x,by:n.y,x:n.x+o.dx,y:n.y+o.dy,p:n.p,n}});
  $('nd').innerHTML=nodes.map(cardHtml).join('');edges();
  if(!nodes.length)$('nd').innerHTML=`<div class="mu" style="position:absolute;left:30px;top:30px;width:420px;font-size:15px">${!S.orgs.length?'Welcome! Start by adding an organization (🏢 Organizations), then a farmer, then livestock.':!S.farmers.length?'Add a farmer to this organization, then add livestock.':'No livestock to show here yet — use “+ Animal”.'}</div>`;
  $('vw').value=view;$('fo').innerHTML='<option value="all">All organizations</option>'+S.orgs.map(o=>`<option value="${o.id}" ${o.id==orgF?'selected':''}>${esc(o.name)}</option>`).join('');
  $('dl').innerHTML=S.animals.map(a=>`<option value="${esc(a.tag)} [${a.id}]">${esc((fm(a.owner)||{}).name||'')}</option>`).join('')+S.farmers.map(f=>`<option value="${esc(f.name)}">farmer</option>`).join('');
  legend();side();if($('dm').open){if(by(mId))$('dm').innerHTML=mHtml();else $('dm').close()}
  if(refit===true)fit();else applyV()}
function legend(){let b='';if(focus){const ch=[];let p=by(focus);while(p){ch.unshift(p);p=by(p.parent)}
    b+='<span><a onclick="focus=null;render(true)">Full tree</a>'+ch.map(x=>' › '+(x.id==focus?'<b>'+esc(x.tag)+'</b>':`<a onclick="focus='${x.id}';render(true)">${esc(x.tag)}</a>`)).join('')+' <button class="sm" onclick="focus=null;render(true)">← Back to full tree</button></span>'}
  const sw=(bg,bd,t)=>`<span class="lg"><i style="background:${bg};border-color:${bd}"></i>${t}</span>`;
  b+=sw('var(--fbg)','var(--fbd)','Female (doe, sow, cow…)')+sw('var(--mbg)','var(--mbd)','Male (buck, boar, bull…)')+sw('var(--alive)','var(--alive)','Alive')+sw('var(--sold)','var(--sold)','Sold')+sw('var(--dead)','var(--dead)','Deceased')+'<span class="lg">┄ dashed line: parent owned by another farmer</span>'
   +S.orgs.map(o=>`<span class="lg o" title="Show only this organization" onclick="setOrgF('${o.id}')"><i style="background:${o.color}"></i>${esc(o.name)}</span>`).join('');$('bc').innerHTML=b}
function setOrgF(id){orgF=orgF==id?'all':id;focus=null;render(true)}

// ---------- pan / zoom / drag ----------
const cv=$('cv'),pts=new Map();let drag=null,pan=null,pin=null;
function zoomAt(px,py,k){k=Math.max(.15,Math.min(2.5,k));V.x=px-(px-V.x)*(k/V.k);V.y=py-(py-V.y)*(k/V.k);V.k=k;applyV()}
function zoomBy(f){zoomAt(cv.clientWidth/2,cv.clientHeight/2,V.k*f)}
function fit(){const g=Object.values(G);if(!g.length){V={x:40,y:30,k:1};return applyV()}
  const x0=Math.min(...g.map(a=>a.x)),x1=Math.max(...g.map(a=>a.x+W)),y0=Math.min(...g.map(a=>a.y)),y1=Math.max(...g.map(a=>a.y+H+14)),cw=cv.clientWidth,ch=cv.clientHeight;
  const k=Math.max(.15,Math.min(1.1,(cw-60)/(x1-x0),(ch-60)/(y1-y0)));V={k,x:(cw-(x1-x0)*k)/2-x0*k,y:Math.max(20,(ch-(y1-y0)*k)/2)-y0*k};applyV()}
function centerOn(id){const g=G[id];if(!g)return;V.x=cv.clientWidth/2-(g.x+W/2)*V.k;V.y=cv.clientHeight/2-(g.y+H/2)*V.k;applyV()}
const branch=id=>Object.keys(G).filter(i=>{let p=G[i].p;while(p){if(p==id)return true;p=G[p]&&G[p].p}return false});
function resetLayout(){if(!S.pos[view]||!Object.keys(S.pos[view]).length)return fit();delete S.pos[view];persist(true);render(true)}
cv.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pts.size==2){const [a,b]=[...pts.values()];pin={d:Math.hypot(a.x-b.x,a.y-b.y)||1,k:V.k};drag=pan=null;cv.classList.remove('pan');return}
  const c=e.target.closest('.card');cv.setPointerCapture(e.pointerId);
  if(c)drag={id:c.id.slice(2),sx:e.clientX,sy:e.clientY,moved:false,set:[],orig:{}};
  else{pan={sx:e.clientX,sy:e.clientY,vx:V.x,vy:V.y};cv.classList.add('pan')}});
cv.addEventListener('pointermove',e=>{if(!pts.has(e.pointerId))return;pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pin&&pts.size==2){const [a,b]=[...pts.values()],r=cv.getBoundingClientRect();zoomAt((a.x+b.x)/2-r.left,(a.y+b.y)/2-r.top,pin.k*Math.hypot(a.x-b.x,a.y-b.y)/pin.d);return}
  if(drag){if(!drag.moved){if(Math.hypot(e.clientX-drag.sx,e.clientY-drag.sy)<5)return;drag.moved=true;drag.set=$('db').checked?[drag.id,...branch(drag.id)]:[drag.id];
      drag.set.forEach(i=>{drag.orig[i]={x:G[i].x,y:G[i].y};$('c-'+i)?.classList.add('dd')})}
    const dx=(e.clientX-drag.sx)/V.k,dy=(e.clientY-drag.sy)/V.k;drag.set.forEach(i=>{const g=G[i],o=drag.orig[i],el=$('c-'+i);g.x=o.x+dx;g.y=o.y+dy;if(el){el.style.left=g.x+'px';el.style.top=g.y+'px'}});edges()}
  else if(pan){V.x=pan.vx+e.clientX-pan.sx;V.y=pan.vy+e.clientY-pan.sy;applyV()}});
const endP=e=>{pts.delete(e.pointerId);if(pts.size<2)pin=null;
  if(drag){if(drag.moved){const P=S.pos[view]||(S.pos[view]={});drag.set.forEach(i=>{const g=G[i];if(g)P[i]={dx:g.x-g.bx,dy:g.y-g.by};$('c-'+i)?.classList.remove('dd')});persist(true)}
    else if(e.type=='pointerup')pick(drag.id);drag=null}
  if(pan){pan=null;cv.classList.remove('pan')}};
cv.addEventListener('pointerup',endP);cv.addEventListener('pointercancel',endP);
cv.addEventListener('wheel',e=>{e.preventDefault();const r=cv.getBoundingClientRect();zoomAt(e.clientX-r.left,e.clientY-r.top,V.k*Math.exp(-e.deltaY*(e.ctrlKey?.01:.0015)))},{passive:false});
cv.addEventListener('click',e=>{const b=e.target.closest('button[data-a]');if(!b)return;const id=b.closest('.card').id.slice(2),n=G[id]?.n,animalId=n?.t=='x'?n.r.id:id;b.dataset.a=='info'?openM(animalId):tog(id)});
cv.addEventListener('dblclick',e=>{const c=e.target.closest('.card'),n=c&&G[c.id.slice(2)]?.n;if(n&&(n.t=='a'||n.t=='x'))openM(n.r.id)});
function pick(id){const n=G[id]?.n;id=n?.t=='x'?n.r.id:id;sel=id;document.querySelectorAll('.card.sel').forEach(c=>c.classList.remove('sel'));$('c-'+id)?.classList.add('sel');side()}
function tog(id){col.has(id)?col.delete(id):col.add(id);render()}
function setAll(v){col=new Set(v?[...S.animals.filter(a=>kidsAll(a.id).length).map(a=>a.id),...S.farmers.map(f=>f.id),...S.orgs.map(o=>o.id)]:[]);render(true)}
function bc2(id,v){[id,...desc(id)].forEach(x=>{if(kidsAll(x).length)v?col.add(x):col.delete(x)});if(!v)col.delete(id);render()}
function goto(id,open){const a=by(id);let f=fm(id);
  if(a){f=fm(a.owner);if(orgF!='all'&&(f||{}).org!=orgF){orgF='all'}if(focus&&focus!=id&&!desc(focus).has(id))focus=null;let p=by(a.parent);while(p){col.delete(p.id);p=by(p.parent)}col.delete(a.owner);col.delete((f||{}).org)}
  else if(f){orgF='all';view='o';col.delete(f.org)}
  sel=id;render();centerOn(id);const el=$('c-'+id);if(el){el.classList.add('hit');setTimeout(()=>el.classList.remove('hit'),2500)}if(open)openM(id)}
$('q').onchange=e=>{const v=e.target.value.trim().toLowerCase();if(!v)return;const m=v.match(/\[(.+)\]$/),
  a=(m&&by(m[1]))||S.animals.find(x=>x.tag.toLowerCase()==v)||S.animals.find(x=>x.tag.toLowerCase().includes(v)),
  f=S.farmers.find(x=>x.name.toLowerCase()==v)||S.farmers.find(x=>x.name.toLowerCase().includes(v)),o=S.orgs.find(x=>x.name.toLowerCase().includes(v));
  if(a)goto(a.id);else if(f)goto(f.id);else if(o){orgF=o.id;focus=null;render(true)}else alert('No match')};

// ---------- details panel (side + modal), collapsible sections, activity tab ----------
const sec=(k,t,b,def=true)=>`<details ${(k in OP?OP[k]:def)?'open':''} ontoggle="OP['${k}']=this.open"><summary>${t}</summary><div>${b}</div></details>`;
const kv=L=>'<dl class="kv">'+L.filter(x=>x[1]!==''&&x[1]!=null).map(([a,b])=>`<dt>${a}</dt><dd>${b}</dd>`).join('')+'</dl>';
const chip=(a,c)=>`<span class="chip ${a.sex||''}"><a onclick="${c=='m'?`openM('${a.id}')`:`goto('${a.id}')`}" style="cursor:pointer">${ico(a.species)} ${esc(a.tag)}</a><button title="Open details &amp; activities" onclick="openM('${a.id}')">🔍</button></span>`;
function setTab(c,t){PT[c]=t;c=='m'?$('dm').innerHTML=mHtml():side()}
function transferAnimal(id){
  const a=by(id);if(!a)return;
  const destinations=S.farmers.filter(f=>f.id!==a.owner);
  if(!destinations.length)return alert('Add another farmer before transferring this animal.');
  const history=window.AGRO_TRANSFER_HISTORY?.(id)||[],nextRollover=history.length+1;
  $('dg').innerHTML=`<h3>Transfer livestock ownership</h3><p class="mu">This will be rollover #${nextRollover} for <b>${esc(a.tag)}</b>. The animal keeps the same identity, parent, activities, attachments, and records.</p><div class="transfer-preserve"><b>Family links stay intact</b><span>Existing offspring remain linked to this parent and keep their current owners. Offspring added afterward will use the new owner and create a new branch in the same family tree.</span></div><label for="transfer-owner">New owner</label><select id="transfer-owner">${destinations.map(f=>`<option value="${esc(f.id)}">${esc(f.name)} — ${esc((farmerOrg(f)||{}).name||'No organization')}</option>`).join('')}</select><label for="transfer-date">Transfer date</label><input id="transfer-date" type="date" value="${new Date().toISOString().slice(0,10)}"><label for="transfer-reference">Reference (optional)</label><input id="transfer-reference" maxlength="120" placeholder="Sale, handover, or record number"><label for="transfer-notes">Notes (optional)</label><textarea id="transfer-notes" rows="3" maxlength="1000" placeholder="Add context for the next owner"></textarea><div id="transfer-error" class="err" role="alert"></div><div class="row"><button class="p" id="transfer-submit">Record rollover #${nextRollover}</button><button id="transfer-cancel">Cancel</button></div>`;
  $('dg').showModal();$('transfer-cancel').onclick=()=>$('dg').close();
  $('transfer-submit').onclick=async()=>{
    const button=$('transfer-submit'),newOwnerId=$('transfer-owner').value,transferredAt=$('transfer-date').value;
    if(!newOwnerId||newOwnerId===a.owner)return $('transfer-error').textContent='Choose a different owner.';
    if(!transferredAt)return $('transfer-error').textContent='Enter the transfer date.';
    if(a.born&&transferredAt<a.born)return $('transfer-error').textContent='Transfer date cannot be before the animal’s birth.';
    button.disabled=true;$('transfer-error').textContent='Recording ownership change…';
    try {
      await window.AGRO_TRANSFER_ANIMAL({animalId:id,expectedOwnerId:a.owner,newOwnerId,transferredAt,reference:$('transfer-reference').value.trim(),notes:$('transfer-notes').value.trim()});
      $('dg').close();
      if($('dm').open)openM(id);
    } catch(error) { $('transfer-error').textContent=error.message||'Could not record this transfer.';button.disabled=false; }
  };
}
function apanel(a,c){const o=ownerOrg(a),f=fm(a.owner),p=by(a.parent),ks=kidsAll(a.id),L=actsOf(a.id),tab=PT[c]||'d',transfers=window.AGRO_TRANSFER_HISTORY?.(a.id)||[];
  let h=`<h3 class="animal-title">${ico(a.species)} ${esc(a.tag)}${transfers.length?` <span class="rollover-badge">${transfers.length} rollover${transfers.length===1?'':'s'}</span>`:''}</h3><div class="hd"><span class="sxb ${a.sex||'U'}">${sexT(a)}</span><span class="pill st-${esc(a.status)}">${esc(a.status)}</span>${o?`<span class="oc" style="--oc:${o.color}">${esc(o.name)}</span>`:''}${a.insured=='Yes'?'<span class="sxb U">🛡 Insured</span>':''}</div>
  <div class="tabs"><button class="${tab=='d'?'on':''}" onclick="setTab('${c}','d')">Details</button><button class="${tab=='a'?'on':''}" onclick="setTab('${c}','a')">Activity (${L.length})</button></div>`;
  if(tab=='a')return h+`<div class="row" style="margin:0 0 8px"><button class="p" onclick="editAct('${a.id}')">+ Add activity</button></div>`+(L.length?L.map(actHtml).join(''):'<p class="mu">No activities recorded yet. Add vaccinations, treatments, breeding, weighing and more.</p>');
  const cover=a.insured=='Yes'&&(a.covStart||a.covEnd)?esc(a.covStart||'?')+' → '+esc(a.covEnd||'?')+(a.covEnd&&a.covEnd<new Date().toISOString().slice(0,10)?' <b class="err">(expired)</b>':''):'';
  h+=sec('basic','Basic information',kv([['Species',esc(a.species)],['Breed',esc(a.breed)],['Sex',sexT(a)],['Born',esc(a.born)+(age(a.born)?' ('+age(a.born)+')':'')],['Status',`<span class="pill st-${esc(a.status)}">${esc(a.status)}</span>`]]))
   +sec('owner','Owner &amp; organization',kv([['Farmer',esc(f?f.name:'none')],['Organization',o?`<span class="sw" style="background:${o.color}"></span> ${esc(o.name)}`:''],['Farm',esc(f&&f.farm)],['Phone',esc(f&&f.phone)],['Location',esc(f&&f.location)]]))
   +sec('lineage','Lineage',`<b>Parent:</b> ${p?chip(p,c)+` <span class="mu">(${esc((fm(p.owner)||{}).name||'?')})</span>`:'<span class="mu">founder — no parent</span>'}<br><b>Offspring (${ks.length}):</b> ${ks.map(k=>chip(k,c)).join('')||'<span class="mu">none</span>'}`)
   +sec('ownership',`Ownership path (${transfers.length})`,`<p class="mu ownership-intro">One animal identity, carried through each change of owner. Its parent and offspring links stay on the family tree.</p><div class="owner-path">${transfers.length?`<div class="owner-path-node"><span class="owner-path-dot"></span><div><small>FIRST OWNER</small><b>${esc(transfers[0].previousOwnerName)}</b><span>Original record holder</span></div></div>${transfers.map((item,index)=>`<div class="owner-path-node"><span class="owner-path-dot"></span><div><small>ROLLOVER #${index+1}</small><b>${esc(item.newOwnerName)}</b><span>${esc(item.transferred_at)}${item.reference?` · ${esc(item.reference)}`:''}</span>${item.notes?`<em>${esc(item.notes)}</em>`:''}</div></div>`).join('')}`:`<div class="owner-path-node owner-path-node-current"><span class="owner-path-dot"></span><div><small>FIRST OWNER</small><b>${esc(f?f.name:'Unknown')}</b><span>Original record holder · no rollovers recorded</span></div></div>`}</div>`)
   +sec('ins','Insurance',kv([['Insured',a.insured=='Yes'?'Yes':'No'],['Agency',esc(a.insured=='Yes'?insName(a):'')],['Policy no.',esc(a.insured=='Yes'?a.policy:'')],['Coverage',cover]]))
   +sec('att',`Attachments (${(a.att||[]).length})`,attList(a.att,'A',a.id)+`<div class="row"><button class="sm" onclick="addAtt('A','${a.id}')">＋ Attach file</button></div>`)
   +(a.notes?sec('notes','Notes',`<span>${esc(a.notes).replace(/\n/g,'<br>')}</span>`):'');
  return h+`<div class="row animal-actions"><button class="p" onclick="editA(null,'${a.id}')">+ Offspring</button><button onclick="editA('${a.id}')">Edit</button><button onclick="transferAnimal('${a.id}')">Transfer / rollover</button><button onclick="$('dm').close();view='l';focus='${a.id}';render(true)">View this branch</button>${ks.length?`<button onclick="bc2('${a.id}',1)">Collapse below</button><button onclick="bc2('${a.id}',0)">Expand below</button>`:''}<button class="d" onclick="delA('${a.id}')">Delete…</button></div>`}
function actHtml(x){const nd=x.next&&x.next>=new Date().toISOString().slice(0,10);
  return `<details class="act" ${OP['t'+x.id]?'open':''} ontoggle="OP['t'+'${x.id}']=this.open"><summary><b>${ACT[x.type]||'📝'} ${esc(x.title||x.type)}</b><span class="m">${esc(x.date||'')} · ${esc(x.type)}${x.cost!==''&&x.cost!=null?' · '+peso(x.cost):''}</span></summary><div>
  ${kv([['Date',esc(x.date)],['Type',esc(x.type)],['Performed by',esc(x.by)],['Cost',peso(x.cost)],['Next due',x.next?`<span class="${nd?'due':''}">${esc(x.next)}</span>`:'']])}
  ${x.notes?`<p>${esc(x.notes).replace(/\n/g,'<br>')}</p>`:''}${(x.att||[]).length?attList(x.att,null):''}
  <div class="row"><button class="sm" onclick="editAct('${x.animal}','${x.id}')">Edit</button><button class="sm" onclick="addAtt('T','${x.id}')">＋ Attach</button><button class="sm d" onclick="delAct('${x.id}')">Delete</button></div></div></details>`}
function fpanel(f){const o=farmerOrg(f),L=S.animals.filter(a=>a.owner==f.id);
  return `<h3>🧑‍🌾 ${esc(f.name)}</h3><div class="hd">${o?`<span class="oc" style="--oc:${o.color}">${esc(o.name)}</span>`:''}</div>`+sec('fi','Farmer',kv([['Farm',esc(f.farm)],['Phone',esc(f.phone)],['Location',esc(f.location)],['Notes',esc(f.notes)]]))
   +sec('fa',`Livestock (${L.length})`,L.map(a=>chip(a,'s')).join('')||'<span class="mu">none yet</span>')
   +`<div class="row"><button class="p" onclick="editA(null,null,'${f.id}')">+ Animal</button><button onclick="editF('${f.id}')">Edit</button><button class="d" onclick="delF('${f.id}')">Delete…</button></div>`}
function opanel(o){const fs=S.farmers.filter(f=>f.org==o.id),n=S.animals.filter(a=>(fm(a.owner)||{}).org==o.id).length;
  return `<h3>🏢 ${esc(o.name)}</h3><div class="hd"><span class="oc" style="--oc:${o.color}">${fs.length} farmers · ${n} animals</span></div>`+sec('oi','Organization',kv([['Location',esc(o.location)],['Notes',esc(o.notes)]]))
   +sec('of',`Farmers (${fs.length})`,fs.map(f=>`<span class="chip"><a style="cursor:pointer" onclick="goto('${f.id}')">🧑‍🌾 ${esc(f.name)}</a></span>`).join('')||'<span class="mu">none yet</span>')
   +`<div class="row"><button class="p" onclick="orgView('${o.id}')">View lineage</button><button onclick="editF(null,'${o.id}')">+ Farmer</button><button onclick="editOrg('${o.id}')">Edit</button><button class="d" onclick="delOrg('${o.id}')">Delete…</button></div>`}
function side(){const s=$('side');s.innerHTML=by(sel)?apanel(by(sel),'s'):fm(sel)?fpanel(fm(sel)):og(sel)?opanel(og(sel)):'<p class="mu">Click a card to see its details here.<br>Use <b>ⓘ</b> on a card (or double-click it) to open the details and the activity log in a window. Drag cards to rearrange, drag the background to pan, scroll to zoom.</p>'}
const mHtml=()=>`<div class="row" style="justify-content:space-between;margin:0 0 4px"><span class="mu">Livestock details</span><button onclick="$('dm').close()">✕ Close</button></div>`+apanel(by(mId),'m');
function openM(id){if(!by(id))return;mId=id;$('dm').innerHTML=mHtml();if(!$('dm').open)$('dm').showModal()}
$('dm').onclick=e=>{if(e.target==e.currentTarget)e.currentTarget.close()};
function orgView(id){$('dm').open&&$('dm').close();$('dg').open&&$('dg').close();orgF=id;view='l';focus=null;render(true)}

// ---------- generic form ----------
function form(title,fs,v,ok){
  const fh=f=>{const x=v[f.k];let i;
    if(f.t=='sel')i=`<select id="e_${f.k}">${f.o.map(([a,b])=>`<option value="${esc(a)}" ${a==x?'selected':''}>${esc(b)}</option>`).join('')}</select>`;
    else if(f.t=='ta')i=`<textarea id="e_${f.k}" rows="3">${esc(x)}</textarea>`;
    else if(f.t=='note')i=`<p class="mu" style="margin:4px 0">${f.l}</p>`;
    else if(f.t=='file')i=((x||[]).map(m=>`<label class="att" style="color:var(--tx)"><input type="checkbox" data-rm="${m.id}"> Remove “${esc(m.name)}”</label>`).join(''))+`<input id="e_${f.k}" type="file" multiple>`;
    else i=`<input id="e_${f.k}" type="${f.t||'text'}" value="${esc(x)}" ${f.list?`list="${f.list}"`:''} ${f.t=='number'?'min="0" step="any"':''}>`;
    return `<div class="fl" data-k="${f.k}" ${f.dep?`data-dep="${f.dep[0]}" data-val="${esc(f.dep[1])}"`:''} style="${f.w?'grid-column:1/-1':''}">${f.t=='note'?'':`<label>${f.l}</label>`}${i}</div>`};
  $('dg').innerHTML=`<h3 style="margin-bottom:6px">${title}</h3><div class="two">${fs.map(fh).join('')}</div><datalist id="sp"><option>Pig<option>Cow<option>Carabao<option>Goat<option>Sheep<option>Chicken<option>Duck</datalist><div id="ee" class="err"></div><div class="row"><button class="p" id="sv">Save</button><button onclick="$('dg').close()">Cancel</button></div>`;
  const val={},cur=k=>{const el=$('e_'+k);return el?el.value:v[k]},shown=k=>{const f=fs.find(z=>z.k==k);return !f.dep||(shown(f.dep[0])&&cur(f.dep[0])==f.dep[1])};
  const upd=()=>$('dg').querySelectorAll('.fl[data-dep]').forEach(d=>d.hidden=!shown(d.dataset.k));$('dg').onchange=upd;upd();
  $('sv').onclick=async()=>{const o={};
    for(const f of fs){if(f.t=='note')continue;if(!shown(f.k)){o[f.k]=f.t=='file'?{keep:v[f.k]||[],drop:[],add:[]}:'';continue}const el=$('e_'+f.k);
      if(f.t=='file'){const rm=new Set([...$('dg').querySelectorAll('[data-rm]:checked')].map(c=>c.dataset.rm));o[f.k]={keep:(v[f.k]||[]).filter(m=>!rm.has(m.id)),drop:(v[f.k]||[]).filter(m=>rm.has(m.id)),add:[...el.files]};
        const big=o[f.k].add.find(z=>z.size>(CFG.MAX_FILE_MB||10)*1048576);if(big)return $('ee').textContent=`"${big.name}" is larger than ${CFG.MAX_FILE_MB||10} MB.`}
      else o[f.k]=el.value.trim()}
    $('sv').disabled=true;let e;try{e=await ok(o)}catch(x){e=x.message||'Could not save.'}
    if(e){$('ee').textContent=e;$('sv').disabled=false}else $('dg').close()};
  $('dg').showModal()}
async function fin(x){x.drop.forEach(dropFile);return x.keep.concat(await saveFiles(x.add))}

// ---------- organizations ----------
function orgDlg(){const rows=S.orgs.map(o=>{const nf=S.farmers.filter(f=>f.org==o.id).length,na=S.animals.filter(a=>(fm(a.owner)||{}).org==o.id).length;
  return `<tr><td><span class="sw" style="background:${o.color}"></span></td><td><b>${esc(o.name)}</b><br><span class="mu">${esc(o.location||'')}</span></td><td class="mu">${nf} farmers<br>${na} animals</td><td style="text-align:right"><button class="sm p" onclick="orgView('${o.id}')">View lineage</button> <button class="sm" onclick="editOrg('${o.id}',1)">Edit</button> <button class="sm d" onclick="delOrg('${o.id}',1)">Delete</button></td></tr>`}).join('');
  $('dg').innerHTML=`<h3>🏢 Organizations</h3>${rows?`<table class="t">${rows}</table>`:'<p class="mu">No organizations yet.</p>'}<div class="row"><button class="p" onclick="editOrg(null,1)">+ Add organization</button><button onclick="$('dg').close()">Close</button></div>`;if(!$('dg').open)$('dg').showModal()}
function editOrg(id,back){const o=id?og(id):{color:OCOL[S.orgs.length%OCOL.length]};
  form(id?'Edit organization':'Add organization',[{k:'name',l:'Organization name *'},{k:'color',l:'Color (used on cards and legend)',t:'color'},{k:'location',l:'Location / municipality',w:1},{k:'notes',l:'Notes',t:'ta',w:1}],o,x=>{
    if(!x.name)return'Name is required.';if(S.orgs.some(z=>z.id!=id&&norm(z.name)==norm(x.name)))return'An organization with this name already exists.';
    if(id)Object.assign(o,x);else{x.id='O'+uid();S.orgs.push(x);sel=x.id}persist();if(back)setTimeout(orgDlg,0)})}
function delOrg(id,back){const o=og(id),fs=S.farmers.filter(f=>f.org==id),as=S.animals.filter(a=>fs.some(f=>f.id==a.owner));
  $('dg').innerHTML=`<h3>Delete ${esc(o.name)}?</h3><p>${fs.length||as.length?`This organization has <b>${fs.length}</b> farmers and <b>${as.length}</b> animals. Deleting it permanently removes <b>all of them</b>, including their activities and attachments.`:'This organization is empty.'}</p><div class="row"><button class="d" onclick="doDelOrg('${id}',${back?1:0})">Delete${fs.length?' organization and everything in it':''}</button><button onclick="${back?'orgDlg()':'$(\'dg\').close()'}">Cancel</button></div>`;if(!$('dg').open)$('dg').showModal()}
function doDelOrg(id,back){const fs=new Set(S.farmers.filter(f=>f.org==id).map(f=>f.id));purge(new Set(S.animals.filter(a=>fs.has(a.owner)).map(a=>a.id)));
  S.farmers=S.farmers.filter(f=>!fs.has(f.id));S.orgs=S.orgs.filter(o=>o.id!=id);if(orgF==id)orgF='all';sel=null;persist();back?orgDlg():$('dg').close()}

// ---------- farmers / animals / activities ----------
function editF(id,orgId){if(!S.orgs.length){alert('Add an organization first.');return editOrg()}
  const f=id?fm(id):{org:orgId||(orgF!='all'?orgF:S.orgs[0].id)};
  form(id?'Edit farmer':'Add farmer',[{k:'name',l:'Farmer name *'},{k:'org',l:'Organization *',t:'sel',o:S.orgs.map(o=>[o.id,o.name])},{k:'farm',l:'Farm name'},{k:'phone',l:'Phone'},{k:'location',l:'Location',w:1},{k:'notes',l:'Notes',t:'ta',w:1}],f,x=>{
    if(!x.name)return'Farmer name is required.';if(S.farmers.some(z=>z.id!=id&&z.org==x.org&&norm(z.name)==norm(x.name)))return'This farmer already exists in that organization.';
    if(id)Object.assign(f,x);else{x.id='F'+uid();S.farmers.push(x);sel=x.id}persist()})}
function editA(id,par,owner){if(!S.farmers.length)return alert('Add a farmer first.');const pa=by(par),dflt=S.farmers.find(f=>orgF=='all'||f.org==orgF)||S.farmers[0];
  const a=id?by(id):{parent:par||'',owner:owner||(pa?pa.owner:dflt.id),species:pa?pa.species:'',breed:pa?pa.breed:'',status:'Alive',insured:'No',insurer:CFG.INSURERS[0],att:[]},bad=id?new Set([id,...desc(id)]):new Set();
  form(id?'Edit animal':'Add animal',[
    {k:'tag',l:'Tag / name *'},{k:'species',l:'Species *',list:'sp'},{k:'breed',l:'Breed'},{k:'sex',l:'Sex',t:'sel',o:[['','Unknown'],['F','Female (doe / sow / cow / ewe)'],['M','Male (buck / boar / bull / ram)']]},
    {k:'born',l:'Date of birth',t:'date'},{k:'status',l:'Status',t:'sel',o:STAT.map(x=>[x,x])},
    ...(id?[]:[{k:'owner',l:'Owner (farmer) *',t:'sel',w:1,o:S.farmers.map(f=>[f.id,f.name+' — '+((farmerOrg(f)||{}).name||'no org')])}]),
    {k:'parent',l:'Parent (dam / sire)',t:'sel',w:1,o:[['','— none (founder)']].concat(S.animals.filter(x=>!bad.has(x.id)).map(x=>[x.id,x.tag+' ('+x.species+') — '+((fm(x.owner)||{}).name||'?')]))},
    {k:'insured',l:'Insured?',t:'sel',o:[['No','No'],['Yes','Yes']]},{k:'insurer',l:'Insurance agency',t:'sel',o:CFG.INSURERS.map(x=>[x,x]),dep:['insured','Yes']},
    {k:'insOther',l:'Agency name (other)',dep:['insurer','Other'],w:1},{k:'policy',l:'Policy / certificate no.',dep:['insured','Yes']},
    {k:'covStart',l:'Coverage start',t:'date',dep:['insured','Yes']},{k:'covEnd',l:'Coverage end',t:'date',dep:['insured','Yes']},
    {k:'notes',l:'Notes',t:'ta',w:1},{k:'att',l:'Attachments (photos, certificates, vet records, policy…)',t:'file',w:1}],a,async x=>{
    if(!x.tag||!x.species||!(id?a.owner:x.owner))return'Tag, species and owner are required.';
    const ownerId=id?a.owner:x.owner,org=(fm(ownerId)||{}).org;if(S.animals.some(z=>z.id!=id&&norm(z.tag)==norm(x.tag)&&(fm(z.owner)||{}).org==org))return'This tag is already used in that organization.';
    if(x.parent&&bad.has(x.parent))return'Invalid parent (circular).';const p=by(x.parent);if(p&&p.born&&x.born&&x.born<p.born)return'Born before its parent.';
    if(x.covStart&&x.covEnd&&x.covEnd<x.covStart)return'Coverage end is before the start.';
    x.att=await fin(x.att);if(id)Object.assign(a,x);else{x.id='A'+uid();S.animals.push(x);sel=x.id;col.delete(x.parent)}persist()})}
function editAct(aid,id){const a=by(aid),x=id?S.acts.find(z=>z.id==id):{date:new Date().toISOString().slice(0,10),type:'Vaccination',att:[]};
  form((id?'Edit':'Add')+' activity — '+a.tag,[{k:'date',l:'Date *',t:'date'},{k:'type',l:'Activity type',t:'sel',o:Object.keys(ACT).map(t=>[t,ACT[t]+' '+t])},
    {k:'title',l:'Title (e.g. “ASF vaccine, dose 1”)',w:1},{k:'_n',t:'note',l:'Choosing “Sold” or “Mortality” also updates the animal’s status.'},{k:'notes',l:'Description / findings',t:'ta',w:1},
    {k:'by',l:'Performed by (vet, technician…)'},{k:'cost',l:'Cost (₱)',t:'number'},{k:'next',l:'Next due date',t:'date'},{k:'att',l:'Attachments (photos, receipts, reports…)',t:'file',w:1}],x,async o=>{
    if(!o.date)return'Date is required.';o.att=await fin(o.att);delete o._n;if(o.cost!=='')o.cost=Number(o.cost);
    if(id)Object.assign(x,o);else{o.id='T'+uid();o.animal=aid;S.acts.push(o)}
    if(o.type=='Sold')a.status='Sold';if(o.type=='Mortality')a.status='Deceased';PT.s=PT.m='a';OP['t'+(id||o.id)]=true;persist()})}
function delAct(id){if(!confirm('Delete this activity and its attachments?'))return;const x=S.acts.find(z=>z.id==id);(x.att||[]).forEach(dropFile);S.acts=S.acts.filter(z=>z.id!=id);persist()}
function purge(ids){S.animals.filter(a=>ids.has(a.id)).forEach(a=>(a.att||[]).forEach(dropFile));S.acts.filter(x=>ids.has(x.animal)).forEach(x=>(x.att||[]).forEach(dropFile));
  S.acts=S.acts.filter(x=>!ids.has(x.animal));S.animals=S.animals.filter(a=>!ids.has(a.id));S.animals.forEach(a=>{if(ids.has(a.parent))a.parent=''})}
function delA(id){const a=by(id),n=desc(id).size,k=kidsAll(id).length,pa=by(a.parent),nA=actsOf(id).length;
  $('dg').innerHTML=`<h3>Delete ${esc(a.tag)}?</h3><p>${k?`It has <b>${k}</b> offspring (<b>${n}</b> descendants in total). `:'No offspring. '}${nA?`Its <b>${nA}</b> activities and all attachments will be deleted too.`:''}</p><div class="row">${k?`<button class="d" onclick="doDel('${id}',0)">Delete only this animal; offspring move up to ${pa?esc(pa.tag):'founders'}</button><button class="d" onclick="doDel('${id}',1)">Delete it AND all ${n} descendants</button>`:`<button class="d" onclick="doDel('${id}',0)">Delete</button>`}<button onclick="$('dg').close()">Cancel</button></div>`;$('dg').showModal()}
function doDel(id,all){const a=by(id);if(all){const s=desc(id);s.add(id);purge(s)}else{kidsAll(id).forEach(k=>k.parent=a.parent);purge(new Set([id]))}sel=null;$('dg').close();persist()}
function delF(id){const L=S.animals.filter(a=>a.owner==id);
  $('dg').innerHTML=`<h3>Delete ${esc(fm(id).name)}?</h3><p>${L.length?`This farmer owns <b>${L.length}</b> animals. They (with their activities and attachments) will be deleted too.`:'This farmer has no animals.'}</p><div class="row"><button class="d" onclick="doDelF('${id}')">Delete</button><button onclick="$('dg').close()">Cancel</button></div>`;$('dg').showModal()}
function doDelF(id){purge(new Set(S.animals.filter(a=>a.owner==id).map(a=>a.id)));S.farmers=S.farmers.filter(f=>f.id!=id);sel=null;$('dg').close();persist()}

// ---------- Excel export (farmer NAME + ORGANIZATION, never internal IDs) ----------
const HO=['Organization','Color','Location','Notes'],HF=['Farmer Name','Organization','Farm','Phone','Location','Notes'],
 HA=['Tag','Species','Breed','Sex','Born','Status','Farmer Name','Organization','Parent Tag','Parent Organization','Insured','Insurance Agency','Policy No.','Coverage Start','Coverage End','Notes'],
 HC=['Livestock Tag','Farmer Name','Organization','Date','Activity Type','Title','Notes','Performed By','Cost','Next Due'];
function xlsx(){const wb=XLSX.utils.book_new(),add=(rows,name,H)=>{const ws=XLSX.utils.json_to_sheet(rows,{header:H});ws['!cols']=H.map(h=>({wch:Math.max(h.length+4,16)}));XLSX.utils.book_append_sheet(wb,ws,name)};
  add(S.orgs.map(o=>({Organization:o.name,Color:o.color,Location:o.location||'',Notes:o.notes||''})),'Organizations',HO);
  add(S.farmers.map(f=>({'Farmer Name':f.name,Organization:(farmerOrg(f)||{}).name||'',Farm:f.farm||'',Phone:f.phone||'',Location:f.location||'',Notes:f.notes||''})),'Farmers',HF);
  add(S.animals.map(a=>{const p=by(a.parent),y=a.insured=='Yes';return{Tag:a.tag,Species:a.species,Breed:a.breed||'',Sex:a.sex=='F'?'Female':a.sex=='M'?'Male':'',Born:a.born||'',Status:a.status,'Farmer Name':(fm(a.owner)||{}).name||'',Organization:(ownerOrg(a)||{}).name||'','Parent Tag':p?p.tag:'','Parent Organization':p?(ownerOrg(p)||{}).name||'':'',Insured:a.insured||'No','Insurance Agency':y?insName(a):'','Policy No.':y?a.policy||'':'','Coverage Start':y?a.covStart||'':'','Coverage End':y?a.covEnd||'':'',Notes:a.notes||''}}),'Livestock',HA);
  add(S.acts.map(x=>{const a=by(x.animal)||{};return{'Livestock Tag':a.tag||'','Farmer Name':(fm(a.owner)||{}).name||'',Organization:(ownerOrg(a)||{}).name||'',Date:x.date||'','Activity Type':x.type,Title:x.title||'',Notes:x.notes||'','Performed By':x.by||'',Cost:x.cost??'','Next Due':x.next||''}}),'Activities',HC);return wb}
function pptx(){const p=new PptxGenJS(),h=t=>({text:t,options:{bold:true}});let s=p.addSlide();
  s.addText((CFG.ORG_NAME||'Livestock')+' — Lineage report',{x:.5,y:2,w:9,fontSize:28,bold:true});s.addText(`${S.orgs.length} organizations · ${S.farmers.length} farmers · ${S.animals.length} animals`,{x:.5,y:3,w:9,fontSize:16});
  S.orgs.forEach(o=>S.farmers.filter(f=>f.org==o.id).forEach(f=>{const as=S.animals.filter(a=>a.owner==f.id);for(let i=0;i<Math.max(as.length,1);i+=11){s=p.addSlide();
    s.addText(`${f.name} — ${o.name}`,{x:.4,y:.3,w:9,fontSize:22,bold:true});s.addText([f.farm,f.phone,f.location].filter(Boolean).join('  ·  '),{x:.4,y:.8,w:9,fontSize:12});
    s.addTable([['Tag','Species','Sex','Born','Status','Insured','Parent'].map(h)].concat(as.slice(i,i+11).map(a=>{const q=by(a.parent);return[a.tag,a.species,sexT(a),a.born||'',a.status,a.insured=='Yes'?insName(a)||'Yes':'No',q?q.tag+' ('+((fm(q.owner)||{}).name||'?')+')':'—'].map(t=>({text:String(t)}))})),{x:.4,y:1.2,w:9.2,fontSize:10})}}));return p}
const MX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',MP='application/vnd.openxmlformats-officedocument.presentationml.presentation';
function exportDlg(){$('dg').innerHTML=`<h3>Export</h3><p>Data is shared through the connected Supabase project.</p><div class="row"><button onclick="ex('xd')">Download .xlsx</button><button onclick="ex('pd')">Download .pptx</button></div><div id="ee" style="margin-top:8px"></div><div class="row"><button onclick="$('dg').close()">Close</button></div>`;$('dg').showModal()}
async function ex(k){const e=$('ee');try{
  if(k=='xd')return XLSX.writeFile(xlsx(),'livestock-tree.xlsx');if(k=='pd')return pptx().writeFile({fileName:'livestock-tree.pptx'});
  e.textContent='Uploading…';let r;
  if(k=='pu')r=await up('livestock-tree.pptx',MP,await pptx().write({outputType:'arraybuffer'}));
  else r=await up(k=='gs'?'Livestock tree (Sheet)':'livestock-tree.xlsx',MX,XLSX.write(xlsx(),{type:'array',bookType:'xlsx'}),null,k=='gs'?'application/vnd.google-apps.spreadsheet':null);
  e.innerHTML=`Saved ✓ <a href="${r.webViewLink}" target="_blank">Open in Drive</a>`}catch(x){e.textContent='Export failed.'}}

// ---------- Excel import (matches columns by header name; farmers & organizations by NAME) ----------
const nr=o=>{const r={};for(const k in o)r[norm(k)]=typeof o[k]=='string'?o[k].trim():o[k];return r};
const gs=(r,...ks)=>{for(const k of ks){const v=r[k];if(v!==''&&v!=null)return String(v).trim()}return''};
const p2=n=>String(n).padStart(2,'0'),ymd=(y,m,d)=>`${y}-${p2(m)}-${p2(d)}`;
function dstr(v){if(v===''||v==null)return'';
  if(typeof v=='number'&&v>20000&&v<80000){const d=new Date(Math.round((v-25569)*864e5));return ymd(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate())} // Excel serial date
  if(v instanceof Date&&!isNaN(v))return ymd(v.getFullYear(),v.getMonth()+1,v.getDate());
  const s=String(v).trim();let m=s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return ymd(m[1],+m[2],+m[3]);
  m=s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);if(m){let a=+m[1],b=+m[2];if(a>12){const t=a;a=b;b=t}return ymd(m[3],a,b)}
  const d=new Date(s);return isNaN(d)?'?'+s:ymd(d.getFullYear(),d.getMonth()+1,d.getDate())}
const SX=s=>{s=norm(s);return /^(f|female|doe|sow|cow|ewe|hen|heifer|gilt|nanny|duck)$/.test(s)?'F':/^(m|male|buck|boar|bull|ram|rooster|steer|barrow|billy|drake|cock)$/.test(s)?'M':''};
const ST=s=>{s=norm(s);return!s?'':s.includes('sold')?'Sold':/dead|decease|mortal|died|death|dies|lost/.test(s)?'Deceased':'Alive'};
function parseBook(wb){let cnt=0;const nid=p=>p+uid()+(++cnt).toString(36),sh={};
  wb.SheetNames.forEach(n=>sh[norm(n)]=XLSX.utils.sheet_to_json(wb.Sheets[n],{defval:'',raw:true}).map(nr));
  const pk=(...n)=>{for(const k of n)if(sh[k])return sh[k];return null};
  const SO=pk('organizations','organization','orgs'),SF=pk('farmers','farmer'),SC=pk('activities','activity','activitylog');
  const SA=pk('livestock','animals','animal')||((!SO&&!SF&&!SC)?sh[norm(wb.SheetNames[0])]:null)||[];
  const D={orgs:[],farmers:[],animals:[],acts:[]},err=[],warn=[],lF={},lA={},pend=[];
  const orgGet=(name,color)=>{name=String(name||'').trim()||'Unassigned';let o=D.orgs.find(x=>norm(x.name)==norm(name));if(!o){o={id:nid('O'),name,color:/^#[0-9a-f]{6}$/i.test(color||'')?color:OCOL[D.orgs.length%OCOL.length],location:'',notes:''};D.orgs.push(o)}return o};
  const O=n=>(D.orgs.find(o=>o.id==n)||{}).name;
  (SO||[]).forEach(r=>{const n=gs(r,'organization','organizationname','name','org');if(!n)return;const o=orgGet(n,gs(r,'color','colour'));o.location=gs(r,'location','municipality','address');o.notes=gs(r,'notes')});
  (SF||[]).forEach((r,i)=>{const n=gs(r,'farmername','name','farmer');if(!n)return;if(!gs(r,'organization','org','organizationname'))warn.push(`Farmers row ${i+2}: no organization → “Unassigned”`);
    const o=orgGet(gs(r,'organization','org','organizationname'));let f=D.farmers.find(x=>x.org==o.id&&norm(x.name)==norm(n));
    if(!f)D.farmers.push(f={id:nid('F'),name:n,org:o.id,farm:'',phone:'',location:'',notes:''});Object.assign(f,{farm:gs(r,'farm','farmname')||f.farm,phone:gs(r,'phone','contact','contactnumber')||f.phone,location:gs(r,'location','address')||f.location,notes:gs(r,'notes')||f.notes});
    if(gs(r,'id'))lF[gs(r,'id')]=f});
  SA.forEach((r,i)=>{const row=`Livestock row ${i+2}`,tag=gs(r,'tag','livestocktag','animaltag','tagnumber','name');if(!tag){if(Object.values(r).some(v=>v!==''))err.push(`${row}: missing tag`);return}
    const fn=gs(r,'farmername','farmer','ownername','owner'),on=gs(r,'organization','org','organizationname');let f=lF[gs(r,'ownerid')];
    if(!f){if(!fn){err.push(`${row} (${tag}): missing farmer name`);return}
      const c=D.farmers.filter(x=>norm(x.name)==norm(fn)&&(!on||norm(O(x.org))==norm(on)));
      if(c.length>1){err.push(`${row} (${tag}): farmer “${fn}” exists in several organizations — fill in the Organization column`);return}
      if(c.length)f=c[0];else{const o=orgGet(on);D.farmers.push(f={id:nid('F'),name:fn,org:o.id,farm:'',phone:'',location:'',notes:''});warn.push(`${row}: farmer “${fn}” was not on the Farmers sheet — created under “${o.name}”`)}}
    const org=f.org;if(D.animals.some(x=>norm(x.tag)==norm(tag)&&D.farmers.find(z=>z.id==x.owner).org==org)){err.push(`${row}: duplicate tag “${tag}” in ${O(org)}`);return}
    const ag=gs(r,'insuranceagency','agency','insurer','insurancecompany'),iy=gs(r,'insured','insurance'),y=/^(y|yes|true|1|insured)$/.test(norm(iy))||(!iy&&!!ag),known=CFG.INSURERS.find(z=>norm(z)==norm(ag));
    const a={id:nid('A'),tag,species:gs(r,'species','type','animal'),breed:gs(r,'breed'),sex:SX(gs(r,'sex','gender')),born:dstr(r.born||r.dateofbirth||r.birthdate||r.dob||r.birthday||''),status:ST(gs(r,'status')),owner:f.id,parent:'',insured:iy||ag?(y?'Yes':'No'):'',
      insurer:y?(known||(ag?'Other':'')):'',insOther:y&&ag&&!known?ag:'',policy:gs(r,'policyno','policynumber','policy'),covStart:dstr(r.coveragestart||r.insurancestart||''),covEnd:dstr(r.coverageend||r.insuranceend||''),notes:gs(r,'notes'),att:[]};
    ['born','covStart','covEnd'].forEach(k=>{if(String(a[k]).startsWith('?')){warn.push(`${row} (${tag}): couldn't read date “${a[k].slice(1)}” — left blank`);a[k]=''}});
    if(!a.species)warn.push(`${row} (${tag}): species is empty`);D.animals.push(a);if(gs(r,'id'))lA[gs(r,'id')]=a;pend.push([a,gs(r,'parenttag','parent','sire','dam'),gs(r,'parentorganization','parentorg'),gs(r,'parentid'),row])});
  pend.forEach(([a,pt,po,pid,row])=>{let p=null;if(!pt&&pid)p=lA[pid];else if(pt){const own=D.farmers.find(z=>z.id==a.owner).org;let c=D.animals.filter(x=>x!==a&&norm(x.tag)==norm(pt)&&(!po||norm(O(D.farmers.find(z=>z.id==x.owner).org))==norm(po)));
      if(c.length>1){const same=c.filter(x=>D.farmers.find(z=>z.id==x.owner).org==own);if(same.length)c=same}
      if(c.length>1){err.push(`${row} (${a.tag}): parent “${pt}” matches several animals — fill in Parent Organization`);return}p=c[0]}
    if(pt&&!p)err.push(`${row} (${a.tag}): parent “${pt}” not found`);else if(p)a.parent=p.id});
  const byId=Object.fromEntries(D.animals.map(a=>[a.id,a]));D.animals.forEach(a=>{const s=new Set([a.id]);let p=byId[a.parent];while(p){if(s.has(p.id)){err.push(`${a.tag}: circular lineage`);break}s.add(p.id);p=byId[p.parent]}});
  (SC||[]).forEach((r,i)=>{const row=`Activities row ${i+2}`,tag=gs(r,'livestocktag','animaltag','tag');if(!tag)return;const fn=gs(r,'farmername','farmer'),on=gs(r,'organization','org');
    const c=D.animals.filter(a=>norm(a.tag)==norm(tag)&&(!fn||norm(D.farmers.find(z=>z.id==a.owner).name)==norm(fn))&&(!on||norm(O(D.farmers.find(z=>z.id==a.owner).org))==norm(on)));
    if(c.length!=1){warn.push(`${row}: ${c.length?'tag “'+tag+'” is ambiguous — add Farmer Name / Organization':'livestock “'+tag+'” not found'} — skipped`);return}
    const ty=Object.keys(ACT).find(k=>norm(k)==norm(gs(r,'activitytype','type')))||'Other',cost=gs(r,'cost');let d=dstr(r.date||''),nx=dstr(r.nextdue||r.next||'');if(d.startsWith('?'))d='';if(nx.startsWith('?'))nx='';
    D.acts.push({id:nid('T'),animal:c[0].id,date:d,type:ty,title:gs(r,'title'),notes:gs(r,'notes','description'),by:gs(r,'performedby','by'),cost:cost===''||isNaN(cost)?'':Number(cost),next:nx,att:[]})});
  return{D,err,warn}}
function mergeIn(D){const om={},fmap={},am={},ne=o=>Object.fromEntries(Object.entries(o).filter(([k,v])=>v!==''&&v!=null));
  D.orgs.forEach(o=>{let e=S.orgs.find(x=>norm(x.name)==norm(o.name));if(e)Object.assign(e,ne({location:o.location,notes:o.notes}));else S.orgs.push(e={...o});om[o.id]=e.id});
  D.farmers.forEach(f=>{const org=om[f.org];let e=S.farmers.find(x=>x.org==org&&norm(x.name)==norm(f.name));if(e)Object.assign(e,ne({farm:f.farm,phone:f.phone,location:f.location,notes:f.notes}));else S.farmers.push(e={...f,org});fmap[f.id]=e.id});
  D.animals.forEach(a=>{const owner=fmap[a.owner],org=fm(owner).org,{id,parent,att,...rest}=a;let e=S.animals.find(x=>norm(x.tag)==norm(a.tag)&&(fm(x.owner)||{}).org==org);
    if(e)Object.assign(e,ne(rest),{owner});else S.animals.push(e={...rest,id,owner,parent:'',status:rest.status||'Alive',insured:rest.insured||'No',att:[]});am[a.id]=e.id});
  D.animals.forEach(a=>{if(a.parent&&am[a.parent])by(am[a.id]).parent=am[a.parent]});
  D.acts.forEach(x=>{const aid=am[x.animal];if(!aid||S.acts.some(z=>z.animal==aid&&z.date==x.date&&z.type==x.type&&(z.title||'')==(x.title||'')))return;S.acts.push({...x,animal:aid})});
  S.animals.forEach(a=>{const s=new Set([a.id]);let p=by(a.parent);while(p){if(s.has(p.id)){a.parent='';break}s.add(p.id);p=by(p.parent)}})}
let IMP=null;
$('f').onchange=async e=>{const fl=e.target.files[0];if(!fl)return;e.target.value='';let wb;
  try{wb=XLSX.read(await fl.arrayBuffer(),{type:'array'})}catch(x){return alert('Could not read this file. Use an .xlsx or .csv file.')}
  IMP=parseBook(wb);const{D,err,warn}=IMP;
  $('dg').innerHTML=`<h3>Import preview</h3><p>${D.orgs.length} organizations · ${D.farmers.length} farmers · ${D.animals.length} livestock · ${D.acts.length} activities</p>
  ${err.length?`<p><b class="err">${err.length} problem${err.length>1?'s':''} to fix in the file first:</b></p><div class="err" style="max-height:150px;overflow:auto">${err.slice(0,40).map(esc).join('<br>')}</div>`:'<p>✓ No problems found.</p>'}
  ${warn.length?`<p class="mu">Notes:</p><div class="mu" style="max-height:110px;overflow:auto">${warn.slice(0,25).map(esc).join('<br>')}</div>`:''}
  ${err.length?'':`<label><input type="radio" name="im" value="merge" checked> <b>Merge</b> into current data (matches organizations, farmers and tags by name; keeps attachments)</label><label><input type="radio" name="im" value="replace"> <b>Replace</b> all current data</label>`}
  <div class="row">${err.length?'':'<button class="p" id="ok">Import</button>'}<button onclick="$(\'dg\').close()">Cancel</button></div>`;
  if(!err.length)$('ok').onclick=()=>{const m=document.querySelector('input[name=im]:checked').value;
    if(m=='replace'){if(!confirm('Replace ALL current data with the file? Attachments and activities not in the file are removed.'))return;allAtts().forEach(dropFile);S=migrate({orgs:D.orgs,farmers:D.farmers,animals:D.animals,acts:D.acts})}else mergeIn(D);
    col=new Set();sel=null;focus=null;orgF='all';$('dg').close();persist();fit()};
  $('dg').showModal()};

// ---------- start ----------
try{const raw=localStorage.getItem('lt2')||localStorage.getItem('lt');if(!localStorage.getItem('lt2')&&raw)localStorage.setItem('lt2d','1');S=migrate(JSON.parse(raw));localStorage.setItem('lt2',JSON.stringify(S))}catch(e){S=migrate({})}
forceOff=localStorage.getItem('lt2o')=='1';fileId=localStorage.getItem('lt2f');
if('serviceWorker' in navigator&&/^https?:/.test(location.protocol))navigator.serviceWorker.register('sw.js').catch(()=>0);
showUser();netUI();render(true);
