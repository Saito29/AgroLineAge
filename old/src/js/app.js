const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let S={farmers:[],animals:[]},col=new Set(),focus=null,sel=null,hit=null,z=1,view='l',tok=null,tc=null,fileId=null,timer=null;
const by=id=>S.animals.find(a=>a.id==id),fm=id=>S.farmers.find(f=>f.id==id),kids=id=>S.animals.filter(a=>a.parent==id);
const desc=(id,s=new Set())=>{kids(id).forEach(k=>{s.add(k.id);desc(k.id,s)});return s};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,5);
const COL=['#2f6f5e','#3b6ea5','#a5633b','#8a4a8f','#a58c2f','#b33a5a'],fcol=id=>COL[Math.max(0,S.farmers.findIndex(f=>f.id==id))%COL.length];
const ico=s=>{s=(s||'').toLowerCase();return s.includes('pig')?'🐖':s.includes('cow')||s.includes('cattle')?'🐄':s.includes('goat')?'🐐':s.includes('sheep')?'🐑':s.includes('chick')?'🐔':'🐾'};
const setSt=(t,bad)=>{$('st').textContent=t;$('st').className=bad?'err':''};
// ---------- storage: local cache + Google Drive ----------
function commit(){localStorage.setItem('lt',JSON.stringify(S));render();clearTimeout(timer);if(tok){setSt('Unsaved changes…');timer=setTimeout(driveSave,1500)}else setSt('Saved in this browser only — sign in to sync to Drive')}
async function dr(url,o={}){const r=await fetch(url,{...o,headers:{Authorization:'Bearer '+tok,...o.headers}});
  if(r.status==401||r.status==403&&0){tok=null;$('gb').textContent='Sign in with Google';setSt('Google session expired — sign in again',1);throw 0}
  if(!r.ok){setSt('Drive error '+r.status,1);throw new Error(await r.text())}return r}
async function up(name,mime,body,id,convert){
  const meta=id?{}:{name,mimeType:convert||mime};if(!id&&CFG.FOLDER_ID)meta.parents=[CFG.FOLDER_ID];const b='b'+uid();
  const blob=new Blob([`--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`,body,`\r\n--${b}--`]);
  const r=await dr(`https://www.googleapis.com/upload/drive/v3/files${id?'/'+id:''}?uploadType=multipart&fields=id,webViewLink`,{method:id?'PATCH':'POST',headers:{'Content-Type':'multipart/related; boundary='+b},body:blob});return r.json()}
async function driveSave(){try{const r=await up('livestock-tree.json','application/json',JSON.stringify(S),fileId);fileId=r.id;setSt('Synced to Google Drive ✓ '+new Date().toLocaleTimeString())}catch(e){if(e)setSt('Sync failed — changes kept in browser; export to back up',1)}}
function signIn(){
  if(!CFG.CLIENT_ID)return alert('Set CLIENT_ID in config.js first (see README).');
  if(!window.google)return alert('Google script not loaded yet.');
  tc=tc||google.accounts.oauth2.initTokenClient({client_id:CFG.CLIENT_ID,scope:'https://www.googleapis.com/auth/drive.file',
    callback:r=>{if(r.access_token){tok=r.access_token;$('gb').textContent='Signed in ✓';driveLoad()}else setSt('Sign-in cancelled',1)}});
  tc.requestAccessToken()}
async function driveLoad(){try{setSt('Loading from Drive…');
  const q=encodeURIComponent(`name='livestock-tree.json' and trashed=false`+(CFG.FOLDER_ID?` and '${CFG.FOLDER_ID}' in parents`:''));
  const l=await(await dr('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id)')).json();
  if(l.files.length){fileId=l.files[0].id;S=await(await dr(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)).json();localStorage.setItem('lt',JSON.stringify(S));render();setSt('Loaded from Drive ✓')}
  else await driveSave()}catch(e){}}
// ---------- tree ----------
const tg=(id,n,c)=>n?`<button class="tg" onclick="event.stopPropagation();tog('${id}')">${c?'▸ '+n:'▾'}</button>`:'';
function anode(a){const ks=kids(a.id),c=col.has(a.id)&&ks.length,o=fm(a.owner);
  return `<li><div class="card ${sel==a.id?'sel':''} ${hit==a.id?'hit':''} ${c?'cn':''}" id="c-${a.id}" style="--g:${fcol(a.owner)}" onclick="pick('${a.id}')"><div class="av">${ico(a.species)}</div><b>${esc(a.tag)}</b><small>${esc(a.species)}${a.breed?' · '+esc(a.breed):''} ${a.sex=='F'?'♀':a.sex=='M'?'♂':''}</small><small>👤 ${esc(o?o.name:'No owner')}</small><small>${esc(a.born||'?')} · ${esc(a.status)}</small>${tg(a.id,ks.length,c)}</div>${ks.length&&!c?'<ul>'+ks.map(anode).join('')+'</ul>':''}</li>`}
function fnode(f){const all=S.animals.filter(a=>a.owner==f.id),tops=all.filter(a=>!(by(a.parent)&&by(a.parent).owner==f.id)),c=col.has(f.id)&&tops.length;
  return `<li><div class="card ${sel==f.id?'sel':''} ${c?'cn':''}" id="c-${f.id}" style="--g:${fcol(f.id)}" onclick="pick('${f.id}')"><div class="av">🧑‍🌾</div><b>${esc(f.name)}</b><small>${esc(f.farm||'')}</small><small>${all.length} animals</small>${tg(f.id,tops.length,c)}</div>${tops.length&&!c?'<ul>'+tops.map(anode).join('')+'</ul>':''}</li>`}
function render(){
  if(focus&&!by(focus))focus=null;let h;
  if(view=='o'&&!focus){const c=col.has('ORG');h=`<ul><li><div class="card" style="--g:var(--ac)"><div class="av">🏢</div><b>${esc(CFG.ORG_NAME)}</b><small>${S.farmers.length} farmers · ${S.animals.length} animals</small>${tg('ORG',S.farmers.length,c)}</div>${c?'':'<ul>'+S.farmers.map(fnode).join('')+'</ul>'}</li></ul>`}
  else{const r=focus?[by(focus)]:S.animals.filter(a=>!by(a.parent));h=r.length?'<ul>'+r.map(anode).join('')+'</ul>':'<p>No animals yet. '+(S.farmers.length?'':'Add a farmer first, then ')+'add an animal.</p>'}
  $('tr').innerHTML=h;$('tr').style.transform=`scale(${z})`;$('vw').value=view;
  $('dl').innerHTML=S.animals.map(a=>`<option value="${esc(a.tag)} [${a.id}]">`).join('');
  let b='Full view';if(focus){const ch=[];let p=by(focus);while(p){ch.unshift(p);p=by(p.parent)}
    b='<a onclick="focus=null;render()">Full tree</a>'+ch.map(x=>' › '+(x.id==focus?'<b>'+esc(x.tag)+'</b>':`<a onclick="focus='${x.id}';render()">${esc(x.tag)}</a>`)).join('')+' <button onclick="focus=null;render()">← Back to Full Tree</button>'}
  $('bc').innerHTML=b;side()}
function side(){const a=by(sel),f=fm(sel),s=$('side');
  if(a){const o=fm(a.owner),p=by(a.parent),ks=kids(a.id);
    s.innerHTML=`<h3 style="margin:0">${ico(a.species)} ${esc(a.tag)}</h3><div style="color:var(--mu)">${esc(a.species)} ${esc(a.breed)} · ${esc(a.status)} · born ${esc(a.born||'?')}</div><p>${esc(a.notes)}</p>
    <p><b>Owner:</b> ${o?esc(o.name)+'<br>'+esc(o.farm||'')+' '+esc(o.location||'')+'<br>'+esc(o.phone||''):'none'}</p>
    <p><b>Parent:</b> ${p?esc(p.tag)+' (owner: '+esc((fm(p.owner)||{}).name||'?')+')':'founder'}<br><b>Offspring:</b> ${ks.map(k=>esc(k.tag)).join(', ')||'none'}</p>
    <div class="row"><button class="p" onclick="editA(null,'${a.id}')">+ Offspring</button><button onclick="editA('${a.id}')">Edit</button><button onclick="view='l';focus='${a.id}';render()">View This Branch</button>
    ${ks.length?`<button onclick="bc2('${a.id}',1)">Collapse descendants</button><button onclick="bc2('${a.id}',0)">Expand descendants</button>`:''}<button class="d" onclick="delA('${a.id}')">Delete…</button></div>`}
  else if(f)s.innerHTML=`<h3 style="margin:0">🧑‍🌾 ${esc(f.name)}</h3><p>${esc(f.farm)}<br>${esc(f.location)}<br>${esc(f.phone)}</p><p>${S.animals.filter(x=>x.owner==f.id).length} animals</p><div class="row"><button class="p" onclick="editA(null,null,'${f.id}')">+ Animal</button><button onclick="editF('${f.id}')">Edit</button><button class="d" onclick="delF('${f.id}')">Delete…</button></div>`;
  else s.innerHTML='<p style="color:var(--mu)">Select an animal or farmer.</p>'}
function pick(id){sel=id;render()}function tog(id){col.has(id)?col.delete(id):col.add(id);render()}
function setAll(v){col=new Set(v?[...S.animals.filter(a=>kids(a.id).length).map(a=>a.id),...S.farmers.map(f=>f.id)]:[]);render()}
function bc2(id,v){[id,...desc(id)].forEach(x=>{if(kids(x).length)v?col.add(x):col.delete(x)});render()}
function zoom(d){z=Math.max(.3,Math.min(2,z+d));$('tr').style.transform=`scale(${z})`}
function fit(){z=1;$('tr').style.transform='scale(1)';z=Math.max(.3,Math.min(1,($('cv').clientWidth-40)/$('tr').scrollWidth));$('tr').style.transform=`scale(${z})`}
$('q').onchange=e=>{const v=e.target.value.trim().toLowerCase();if(!v)return;const m=v.match(/\[(.+)\]$/);
  const a=(m&&by(m[1]))||S.animals.find(x=>x.id.toLowerCase()==v||x.tag.toLowerCase()==v)||S.animals.find(x=>x.tag.toLowerCase().includes(v)||((fm(x.owner)||{}).name||'').toLowerCase().includes(v));
  if(!a)return alert('No match');if(focus&&focus!=a.id&&!desc(focus).has(a.id))focus=null;
  let p=by(a.parent);while(p){col.delete(p.id);p=by(p.parent)}col.delete(a.owner);col.delete('ORG');sel=hit=a.id;render();
  $('c-'+a.id)?.scrollIntoView({block:'center',inline:'center',behavior:'smooth'});setTimeout(()=>{hit=null;render()},2500)};
// ---------- forms ----------
function form(title,fs,v,ok){
  $('dg').innerHTML=`<h3 style="margin-top:0">${title}</h3>`+fs.map(([k,l,t,o])=>`<label>${l}</label>`+(t=='sel'?`<select id="e_${k}">${o.map(([x,y])=>`<option value="${esc(x)}" ${x==v[k]?'selected':''}>${esc(y)}</option>`).join('')}</select>`:t=='ta'?`<textarea id="e_${k}" rows="2">${esc(v[k])}</textarea>`:`<input id="e_${k}" type="${t||'text'}" value="${esc(v[k])}" ${k=='species'?'list="sp"':''}>`)).join('')+`<datalist id="sp"><option>Pig<option>Cow<option>Goat<option>Sheep<option>Chicken</datalist><div id="ee" class="err"></div><div class="row"><button class="p" id="sv">Save</button><button onclick="$('dg').close()">Cancel</button></div>`;
  $('sv').onclick=()=>{const o={};fs.forEach(([k])=>o[k]=$('e_'+k).value.trim());const e=ok(o);if(e)$('ee').textContent=e;else $('dg').close()};$('dg').showModal()}
function editF(id){const f=id?fm(id):{};form(id?'Edit farmer':'Add farmer',[['name','Farmer name *'],['farm','Farm name'],['phone','Phone'],['location','Location'],['notes','Notes','ta']],f,o=>{
  if(!o.name)return'Name is required.';if(id)Object.assign(f,o);else{o.id='F'+uid();S.farmers.push(o);sel=o.id}commit()})}
function editA(id,par,owner){if(!S.farmers.length)return alert('Add a farmer first.');const pa=by(par);
  const a=id?by(id):{parent:par||'',owner:owner||(pa?pa.owner:S.farmers[0].id),species:pa?pa.species:'',breed:pa?pa.breed:'',status:'Alive'};const bad=id?new Set([id,...desc(id)]):new Set();
  form(id?'Edit animal':'Add animal',[['tag','Tag / name *'],['species','Species *'],['breed','Breed'],['sex','Sex','sel',[['','—'],['F','Female'],['M','Male']]],['born','Date of birth','date'],['status','Status','sel',['Alive','Sold','Deceased'].map(x=>[x,x])],['owner','Owner (farmer) *','sel',S.farmers.map(f=>[f.id,f.name])],['parent','Parent (dam/sire)','sel',[['','— none (founder)']].concat(S.animals.filter(x=>!bad.has(x.id)).map(x=>[x.id,x.tag+' ('+x.species+')']))],['notes','Notes','ta']],a,o=>{
    if(!o.tag||!o.species||!o.owner)return'Tag, species and owner are required.';
    if(S.animals.some(x=>x.id!=id&&x.tag.toLowerCase()==o.tag.toLowerCase()))return'Tag already used.';
    if(o.parent&&bad.has(o.parent))return'Invalid parent (circular).';const p=by(o.parent);
    if(p&&p.born&&o.born&&o.born<p.born)return'Born before its parent.';
    if(id)Object.assign(a,o);else{o.id='A'+uid();S.animals.push(o);sel=o.id;col.delete(o.parent)}commit()})}
function delA(id){const a=by(id),n=desc(id).size,k=kids(id).length,pa=by(a.parent);
  $('dg').innerHTML=`<h3 style="margin-top:0">Delete ${esc(a.tag)}?</h3><p>${k?`It has <b>${k}</b> offspring (<b>${n}</b> descendants total).`:'No offspring.'}</p><div class="row">${k?`<button class="d" onclick="doDel('${id}',0)">Delete only this animal; offspring move up to ${pa?esc(pa.tag):'founders'}</button><button class="d" onclick="doDel('${id}',1)">Delete it AND all ${n} descendants</button>`:`<button class="d" onclick="doDel('${id}',0)">Delete</button>`}<button onclick="$('dg').close()">Cancel</button></div>`;$('dg').showModal()}
function doDel(id,all){const a=by(id);if(all){const s=desc(id);s.add(id);S.animals=S.animals.filter(x=>!s.has(x.id))}else{kids(id).forEach(k=>k.parent=a.parent);S.animals=S.animals.filter(x=>x.id!=id)}sel=null;$('dg').close();commit()}
function delF(id){const n=S.animals.filter(a=>a.owner==id).length;
  if(n)return alert(`This farmer owns ${n} animals. Reassign or delete them first.`);if(confirm('Delete this farmer?')){S.farmers=S.farmers.filter(f=>f.id!=id);sel=null;commit()}}
// ---------- export / import ----------
const AH=['id','tag','species','breed','sex','born','status','owner_id','owner_name','parent_id','notes'];
function xlsx(){const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(S.farmers.map(f=>({id:f.id,name:f.name,farm:f.farm||'',phone:f.phone||'',location:f.location||'',notes:f.notes||''}))),'Farmers');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(S.animals.map(a=>({id:a.id,tag:a.tag,species:a.species,breed:a.breed||'',sex:a.sex||'',born:a.born||'',status:a.status,owner_id:a.owner,owner_name:(fm(a.owner)||{}).name||'',parent_id:a.parent||'',notes:a.notes||''})),{header:AH}),'Animals');return wb}
function pptx(){const p=new PptxGenJS(),h=t=>({text:t,options:{bold:true}});let s=p.addSlide();
  s.addText(CFG.ORG_NAME+' — Livestock Lineage',{x:.5,y:2,w:9,fontSize:30,bold:true});s.addText(`${S.farmers.length} farmers · ${S.animals.length} animals`,{x:.5,y:3,w:9,fontSize:16});
  S.farmers.forEach(f=>{const as=S.animals.filter(a=>a.owner==f.id);for(let i=0;i<Math.max(as.length,1);i+=12){s=p.addSlide();
    s.addText(`${f.name} — ${f.farm||''}`,{x:.4,y:.3,w:9,fontSize:22,bold:true});s.addText(`${f.phone||''}  ${f.location||''}`,{x:.4,y:.8,w:9,fontSize:12});
    s.addTable([['Tag','Species','Born','Status','Parent (owner)'].map(h)].concat(as.slice(i,i+12).map(a=>{const p=by(a.parent);return[a.tag,a.species,a.born||'',a.status,p?p.tag+' ('+((fm(p.owner)||{}).name||'?')+')':'—'].map(t=>({text:String(t)}))})),{x:.4,y:1.2,w:9,fontSize:11})}});return p}
const MX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',MP='application/vnd.openxmlformats-officedocument.presentationml.presentation';
function exportDlg(){$('dg').innerHTML=`<h3 style="margin-top:0">Export</h3><div class="row"><button onclick="ex('xd')">Download .xlsx</button><button onclick="ex('pd')">Download .pptx</button></div>
  <p>Google Drive ${tok?'':'(sign in first)'}:</p><div class="row"><button ${tok?'':'disabled'} onclick="ex('xu')">Excel → Drive</button><button ${tok?'':'disabled'} onclick="ex('gs')">Google Sheet</button><button ${tok?'':'disabled'} onclick="ex('pu')">PowerPoint → Drive</button></div><div id="ee"></div><div class="row"><button onclick="$('dg').close()">Close</button></div>`;$('dg').showModal()}
async function ex(k){const e=$('ee');try{
  if(k=='xd')return XLSX.writeFile(xlsx(),'livestock-tree.xlsx');if(k=='pd')return pptx().writeFile({fileName:'livestock-tree.pptx'});
  e.textContent='Uploading…';let r;
  if(k=='pu')r=await up('livestock-tree.pptx',MP,await pptx().write({outputType:'arraybuffer'}));
  else r=await up(k=='gs'?'Livestock tree (Sheet)':'livestock-tree.xlsx',MX,XLSX.write(xlsx(),{type:'array',bookType:'xlsx'}),null,k=='gs'?'application/vnd.google-apps.spreadsheet':null);
  e.innerHTML=`Saved ✓ <a href="${r.webViewLink}" target="_blank">Open in Drive</a>`}catch(x){e.textContent='Export failed.'}}
$('f').onchange=async e=>{const fl=e.target.files[0];if(!fl)return;e.target.value='';
  const wb=XLSX.read(await fl.arrayBuffer()),rd=n=>XLSX.utils.sheet_to_json(wb.Sheets[n]||{},{defval:''}),A=rd('Animals').length?rd('Animals'):rd(wb.SheetNames[0]),F=rd('Farmers'),er=[];
  const fs=F.map(r=>({id:String(r.id),name:String(r.name),farm:r.farm,phone:r.phone,location:r.location,notes:r.notes}));
  const as=A.map(r=>({id:String(r.id),tag:String(r.tag),species:r.species,breed:r.breed,sex:r.sex,born:String(r.born),status:r.status||'Alive',owner:String(r.owner_id),parent:String(r.parent_id||''),notes:r.notes}));
  const ids=new Set(),fi=new Set(fs.map(f=>f.id));
  as.forEach((a,i)=>{if(!a.id)er.push(`Row ${i+2}: missing ID`);else if(ids.has(a.id))er.push(`Duplicate ID ${a.id}`);ids.add(a.id);if(!a.tag)er.push(`${a.id}: missing tag`);if(!fi.has(a.owner))er.push(`${a.id}: unknown owner ${a.owner}`)});
  as.forEach(a=>{if(a.parent&&!ids.has(a.parent))er.push(`${a.id}: parent ${a.parent} not found`)});
  const m=Object.fromEntries(as.map(a=>[a.id,a]));as.forEach(a=>{const s=new Set([a.id]);let p=m[a.parent];while(p){if(s.has(p.id)){er.push(`${a.id}: circular lineage`);break}s.add(p.id);p=m[p.parent]}});
  $('dg').innerHTML=`<h3 style="margin-top:0">Import preview</h3><p>${fs.length} farmers · ${as.length} animals · ${er.length} problems</p><div class="err" style="max-height:140px;overflow:auto">${er.slice(0,30).map(esc).join('<br>')}</div><p>Importing <b>replaces</b> current data.</p><div class="row">${er.length?'':'<button class="d" id="ok">Replace current data</button>'}<button onclick="$('dg').close()">Cancel</button></div>`;
  if(!er.length)$('ok').onclick=()=>{S={farmers:fs,animals:as};$('dg').close();commit()};$('dg').showModal()};
try{S=JSON.parse(localStorage.getItem('lt'))||S}catch(e){}render();setSt('Saved in this browser only — sign in to sync to Drive');
