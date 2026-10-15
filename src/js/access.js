/* Supabase email auth, approval gate, shared database loader and admin review. */
(() => {
  const el = id => document.getElementById(id);
  const note = (msg, error = false) => { el('auth-error').textContent = msg || ''; el('auth-error').className = error ? 'err' : 'mu'; el('auth-error').hidden = !msg; };
  const show = (id, on) => { el(id).hidden = !on; };
  let client = null, mode = 'login', currentProfile = null, authReady = false, statusChannel = null, sharedChannel = null;
  let dbBaseline = {organizations:new Map(),owners:new Map(),animals:new Map(),activities:new Map(),attachments:new Map()};
  let cloudQueue = Promise.resolve();
  let pendingLocalSaves=0, localSaveFailed=false, remoteRefreshPending=false, cloudSaving=false, remoteRefreshTimer=null;
  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fail = message => { document.body.classList.add('auth-blocked'); document.body.classList.remove('app-ready'); el('access-message').textContent = message; };

  function stopLiveChannels() {
    if (!client) return;
    if (sharedChannel) client.removeChannel(sharedChannel);
    if (statusChannel) client.removeChannel(statusChannel);
    sharedChannel=null; statusChannel=null;
  }
  function setSignedOut(message = '') {
    stopLiveChannels();
    currentProfile = null; authReady = false;
    document.body.classList.add('auth-blocked'); document.body.classList.remove('app-ready');
    el('auth-title').textContent = mode === 'signup' ? 'Request access' : mode === 'recovery' ? 'Choose a new password' : 'Welcome back';
    el('access-message').textContent = message || 'Sign in with your email, or create an account to request access.';
    show('auth-form', true); show('auth-actions', mode !== 'recovery'); show('auth-reset', mode === 'login');
    show('auth-password-hint', mode === 'signup'); show('approval-state', false); show('approval-actions', false);
    show('auth-name-wrap', mode === 'signup'); el('gb').hidden = true; el('gx').hidden = true;
    el('usr').textContent = ''; show('user-management', false); note('');
  }

  async function loadSharedRecords() {
    const [orgs, owners, animals, activities, attachments] = await Promise.all([
      client.from('organizations').select('*').is('archived_at', null).order('name'),
      client.from('owners').select('*').is('archived_at', null).order('name'),
      client.from('animals').select('*').is('archived_at', null).order('tag'),
      client.from('activities').select('*').is('archived_at', null).order('date', {ascending:false}),
      client.from('attachments').select('*').is('archived_at', null)
    ]);
    for (const result of [orgs, owners, animals, activities, attachments]) if (result.error) throw result.error;
    const attMap = new Map();
    for (const x of attachments.data) {
      const key = x.animal_id ? `A:${x.animal_id}` : `T:${x.activity_id}`;
      if (!attMap.has(key)) attMap.set(key, []);
      attMap.get(key).push({ id:x.id, name:x.original_name, type:x.content_type, size:x.size_bytes, path:x.object_path });
    }
    const state = {
      orgs: orgs.data.map(x=>({id:x.id,name:x.name,color:x.color,location:x.location,notes:x.notes})),
      farmers: owners.data.map(x=>({id:x.id,name:x.name,org:x.organization_id||'',farm:x.farm,phone:x.phone,location:x.location,notes:x.notes})),
      animals: animals.data.map(x=>({id:x.id,tag:x.tag,species:x.species,breed:x.breed,sex:x.sex,born:x.born||'',status:x.status,
        owner:x.owner_id,parent:x.parent_id||'',parentOwner:x.parent_owner_id||'',insured:x.insured,insurer:x.insurer,insOther:x.ins_other,
        policy:x.policy,covStart:x.coverage_start||'',covEnd:x.coverage_end||'',notes:x.notes,att:attMap.get(`A:${x.id}`)||[],_dbRevision:x.revision})),
      acts: activities.data.map(x=>({id:x.id,animal:x.animal_id,date:x.date,type:x.type,title:x.title,notes:x.notes,by:x.performed_by,
        cost:x.cost??'',next:x.next_due||'',att:attMap.get(`T:${x.id}`)||[]})), pos:{},upd:0
    };
    dbBaseline = {
      organizations:new Map(orgs.data.map(x=>[x.id,x])), owners:new Map(owners.data.map(x=>[x.id,x])),
      animals:new Map(animals.data.map(x=>[x.id,x])), activities:new Map(activities.data.map(x=>[x.id,x])),
      attachments:new Map(attachments.data.map(x=>[x.id,x]))
    };
    S = migrate(state);
    render(true);
    return !orgs.data.length && !owners.data.length && !animals.data.length && !activities.data.length;
  }

  const nullable = value => value === '' || value == null ? null : value;
  const cloudStatus = (message, bad=false) => { const status=el('st'); if(status){status.textContent=message;status.className=bad?'err':'';} };
  const hasOpenEditor = () => Boolean(el('dm')?.open || el('dg')?.open);
  function scheduleSharedRefresh() {
    clearTimeout(remoteRefreshTimer);
    remoteRefreshTimer=setTimeout(async()=>{
      if(!remoteRefreshPending||!authReady)return;
      if(pendingLocalSaves||cloudSaving||hasOpenEditor()) {
        cloudStatus('A shared update is waiting. Close open dialogs to sync.'); return;
      }
      if(localSaveFailed) {
        cloudStatus('A shared update is waiting. Resolve the cloud save error before syncing.',true); return;
      }
      remoteRefreshPending=false;
      try { await loadSharedRecords(); cloudStatus('Shared records updated live.'); }
      catch(error) { remoteRefreshPending=true; cloudStatus(`Live refresh failed: ${error.message||'check your connection'}`,true); }
    },250);
  }
  function subscribeSharedChanges() {
    if(sharedChannel)client.removeChannel(sharedChannel);
    let channel=client.channel('shared-records-live');
    for(const table of ['organizations','owners','animals','activities','attachments']) {
      channel=channel.on('postgres_changes',{event:'*',schema:'public',table},()=>{
        remoteRefreshPending=true;
        if(!pendingLocalSaves&&!cloudSaving&&!hasOpenEditor())scheduleSharedRefresh();
        else cloudStatus('A shared update is waiting. Close open dialogs to sync.');
      });
    }
    sharedChannel=channel.subscribe(status=>{
      if(status==='SUBSCRIBED')cloudStatus('Live updates connected.');
      else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')cloudStatus('Live updates unavailable. Refresh the page to reconnect.',true);
    });
  }
  for(const id of ['dm','dg'])el(id).addEventListener('close',()=>{
    if(remoteRefreshPending&&!pendingLocalSaves&&!cloudSaving&&!hasOpenEditor())scheduleSharedRefresh();
  });
  async function saveSharedRecords() {
    if(!authReady || !currentProfile) return;
    const {orgs,farmers,animals,acts}=S;
    const orgRows=orgs.map(x=>({id:x.id,name:x.name,color:x.color||'#8a8f8c',location:x.location||'',notes:x.notes||''}));
    const ownerRows=farmers.map(x=>({id:x.id,name:x.name,organization_id:x.org||null,farm:x.farm||'',phone:x.phone||'',location:x.location||'',notes:x.notes||''}));
    const activityRows=acts.map(x=>({id:x.id,animal_id:x.animal,date:x.date,type:x.type||'Other',title:x.title||'',notes:x.notes||'',performed_by:x.by||'',cost:x.cost===''?null:(x.cost??null),next_due:nullable(x.next)}));
    const animalRows=animals.map(x=>({id:x.id,tag:x.tag,species:x.species,breed:x.breed||'',sex:x.sex||'',born:nullable(x.born),status:x.status||'Alive',owner_id:x.owner,parent_id:x.parent||null,parent_owner_id:x.parentOwner||null,insured:x.insured||'No',insurer:x.insurer||'',ins_other:x.insOther||'',policy:x.policy||'',coverage_start:nullable(x.covStart),coverage_end:nullable(x.covEnd),notes:x.notes||''}));
    const write = async (table, rows) => {
      for(const row of rows) {
        const previous=dbBaseline[table].get(row.id);
        if(!previous) {
          const {data,error}=await client.from(table).insert(row).select('*').single(); if(error)throw error;
          dbBaseline[table].set(row.id,data); continue;
        }
        const changed=Object.keys(row).some(key=>row[key]!==previous[key]);
        if(!changed)continue;
        const {data,error}=await client.from(table).update(row).eq('id',row.id).eq('updated_at',previous.updated_at).select('*').maybeSingle();
        if(error)throw error;
        if(!data)throw new Error(`A ${table} record changed elsewhere. Reload the page before editing it.`);
        dbBaseline[table].set(row.id,data);
      }
    };
    try {
      cloudSaving=true;
      cloudStatus('Saving shared changes…');
      await write('organizations',orgRows);
      await write('owners',ownerRows);
      const animalDepth = row => { let depth=0,parent=row.parent_id,seen=new Set([row.id]); while(parent&&!seen.has(parent)){seen.add(parent);depth++;parent=animalRows.find(x=>x.id===parent)?.parent_id||null;} return depth; };
      animalRows.sort((a,b)=>animalDepth(a)-animalDepth(b));
      for(const row of animalRows) {
        const previous=dbBaseline.animals.get(row.id);
        let expectedRevision=previous?.revision;
        if(previous && previous.owner_id!==row.owner_id) {
          const {data,error}=await client.rpc('transfer_animal',{p_animal_id:row.id,p_expected_owner_id:previous.owner_id,p_new_owner_id:row.owner_id,p_transferred_at:new Date().toISOString().slice(0,10),p_reference:'',p_notes:'Owner changed in the AgroLineage app',p_request_id:crypto.randomUUID()});
          if(error)throw error;
          row.owner_id=data.owner_id;
          expectedRevision=data.revision;
          dbBaseline.animals.set(row.id,{...previous,...data});
        }
        if(previous) {
          if(!Object.keys(row).some(key=>row[key]!==dbBaseline.animals.get(row.id)[key]))continue;
          const {id,owner_id,...fields}=row;
          const {data,error}=await client.from('animals').update({...fields,owner_id}).eq('id',id).eq('revision',expectedRevision).select('revision').maybeSingle();
          if(error)throw error;
          if(!data)throw new Error(`Animal ${row.tag} changed elsewhere. Reload the page before editing it.`);
          dbBaseline.animals.set(id,{...dbBaseline.animals.get(id),...row,revision:data.revision});
        } else {
          const {error}=await client.from('animals').insert(row); if(error)throw error;
        }
      }
      await write('activities',activityRows);
      await syncAttachments();
      await archiveMissing('activities',acts.map(x=>x.id));
      await archiveMissing('animals',animals.map(x=>x.id));
      await archiveMissing('owners',farmers.map(x=>x.id));
      await archiveMissing('organizations',orgs.map(x=>x.id));
      await loadBaselineOnly();
      localStorage.removeItem('lt2d');
      cloudStatus('All changes saved to the shared Supabase project.');
    } catch(error) {
      cloudStatus(`Cloud save failed: ${error.message||'check your connection and reload before continuing'}`,true);
      throw error;
    } finally {
      cloudSaving=false;
      if(remoteRefreshPending&&!pendingLocalSaves)scheduleSharedRefresh();
    }
  }
  async function archiveMissing(table, ids) {
    const live=new Set(ids), removed=[...dbBaseline[table].keys()].filter(id=>!live.has(id));
    if(!removed.length)return;
    const {error}=await client.from(table).update({archived_at:new Date().toISOString()}).in('id',removed).is('archived_at',null);
    if(error)throw error;
  }
  async function syncAttachments() {
    for(const [kind,records] of [['animal',S.animals],['activity',S.acts]]) for(const record of records) {
      for(const meta of (record.att||[])) {
        if(meta.path && dbBaseline.attachments.has(meta.id))continue;
        if(meta.path)continue;
        const file=await fGet(meta.id); if(!file?.blob)throw new Error(`Attachment ${meta.name} is missing from this device.`);
        const localId=meta.id, id=crypto.randomUUID(), safeName=String(meta.name||'attachment').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100), path=`${currentProfile.id}/${id}-${safeName}`;
        const {error:uploadError}=await client.storage.from('animal-attachments').upload(path,file.blob,{contentType:meta.type||'application/octet-stream',upsert:false});
        if(uploadError)throw uploadError;
        const row={id,animal_id:kind==='animal'?record.id:null,activity_id:kind==='activity'?record.id:null,object_path:path,original_name:meta.name||safeName,content_type:meta.type||'application/octet-stream',size_bytes:meta.size||file.blob.size,uploaded_by:currentProfile.id};
        const {error:insertError}=await client.from('attachments').insert(row);
        if(insertError){await client.storage.from('animal-attachments').remove([path]);throw insertError;}
        Object.assign(meta,{id,path});
        await fDel(localId).catch(()=>{});
      }
    }
    const live=new Set([...S.animals,...S.acts].flatMap(x=>(x.att||[]).map(m=>m.id)));
    const removed=[...dbBaseline.attachments.values()].filter(x=>!live.has(x.id)&&!x.archived_at);
    for(const item of removed){
      const {error}=await client.from('attachments').update({archived_at:new Date().toISOString()}).eq('id',item.id);
      if(error)throw error;
      await client.storage.from('animal-attachments').remove([item.object_path]);
    }
  }
  async function loadBaselineOnly() {
    for(const table of ['organizations','owners','animals','activities','attachments']) {
      const {data,error}=await client.from(table).select('*'); if(error)throw error;
      dbBaseline[table]=new Map(data.map(x=>[x.id,x]));
    }
  }
  window.AGRO_PERSIST=()=>{
    pendingLocalSaves++;
    cloudQueue=cloudQueue.then(saveSharedRecords).then(()=>{localSaveFailed=false;}).catch(()=>{localSaveFailed=true;}).finally(()=>{
      pendingLocalSaves=Math.max(0,pendingLocalSaves-1);
      if(!pendingLocalSaves&&remoteRefreshPending)scheduleSharedRefresh();
    });
    return cloudQueue;
  };
  window.AGRO_OPEN_ATTACHMENT=async meta=>{
    if(!meta.path)return alert('This attachment is waiting to sync from this device.');
    const {data,error}=await client.storage.from('animal-attachments').download(meta.path);
    if(error)return alert(error.message);
    const url=URL.createObjectURL(data); window.open(url,'_blank'); setTimeout(()=>URL.revokeObjectURL(url),60000);
  };
  window.AGRO_DELETE_ATTACHMENT=meta=>{
    fDel(meta.id).catch(()=>{});
    if(meta.path)client.from('attachments').update({archived_at:new Date().toISOString()}).eq('id',meta.id).then(()=>client.storage.from('animal-attachments').remove([meta.path]));
  };

  async function checkAccess(session) {
    if (!session) return setSignedOut();
    authReady = false;
    document.body.classList.add('auth-blocked'); document.body.classList.remove('app-ready');
    el('access-message').textContent = 'Checking your application access…';
    show('auth-form', false); show('auth-actions', false); show('approval-state', false); show('approval-actions', false);
    try {
      const {data:profile,error} = await client.from('profiles').select('id,email,display_name,approval_status,app_role,created_at,status_reason').eq('id',session.user.id).single();
      if (error) throw error;
      currentProfile = profile;
      if (profile.approval_status !== 'approved') {
        stopLiveChannels();
        el('auth-title').textContent = profile.approval_status === 'pending' ? 'Request received' : 'Access unavailable';
        el('access-message').textContent = 'Your AgroLineage account is ' + profile.approval_status + '.';
        el('approval-state').innerHTML = `<p><b>Status:</b> ${escHtml(profile.approval_status)}</p><p>${profile.approval_status==='pending'?'Your account was created and is waiting for administrator approval.':profile.approval_status==='rejected'?'An administrator has declined this application.':'An administrator has suspended application access.'}</p>${profile.status_reason?`<p>Reason: ${escHtml(profile.status_reason)}</p>`:''}`;
        show('approval-state',true); show('approval-actions',true); return;
      }
      let localSnapshot=null;
      try { const raw=localStorage.getItem('lt2'); if(raw)localSnapshot=migrate(JSON.parse(raw)); } catch(_) {}
      const cloudEmpty=await loadSharedRecords();
      authReady = true;
      document.body.classList.remove('auth-blocked'); document.body.classList.add('app-ready');
      el('gb').hidden = true; el('gx').hidden = false;
      el('usr').textContent = profile.display_name || profile.email || '';
      show('user-management', profile.app_role === 'admin');
      el('access-message').textContent = '';
      if(cloudEmpty&&localSnapshot&&(localSnapshot.orgs.length||localSnapshot.farmers.length||localSnapshot.animals.length)&&confirm('This Supabase project has no livestock records. Import the data saved in this browser into the shared project?')) {
        S=localSnapshot;render(true);await saveSharedRecords();
      }
      subscribeSharedChanges();
      if (statusChannel) client.removeChannel(statusChannel);
      statusChannel = client.channel('profile-access-'+profile.id).on('postgres_changes',
        {event:'UPDATE',schema:'public',table:'profiles',filter:'id=eq.'+profile.id}, () => setTimeout(async()=>{const {data}=await client.auth.getSession();await checkAccess(data.session)},0)).subscribe();
    } catch (error) {
      el('access-message').textContent = 'Could not verify account access or load shared records.';
      note(error.message || 'Check your connection and Supabase configuration.', true);
      show('approval-actions',true); el('approval-refresh').textContent='Retry';
    }
  }

  function authShowLogin() { mode='login'; setSignedOut(); }
  window.authShowLogin = authShowLogin;
  window.authSignOut = async () => { if (client) await client.auth.signOut(); setSignedOut(); };

  el('auth-switch').onclick = () => {
    mode = mode === 'login' ? 'signup' : 'login';
    el('auth-name-wrap').hidden = mode !== 'signup';
    el('auth-submit').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    el('auth-switch').textContent = mode === 'signup' ? 'Back to sign in' : 'Create account'; note('');
    el('auth-title').textContent = mode === 'signup' ? 'Request access' : 'Welcome back';
    el('access-message').textContent = mode === 'signup' ? 'Create an account to request access to the shared farm workspace.' : 'Sign in to continue to your shared farm workspace.';
    show('auth-reset', mode === 'login'); show('auth-password-hint', mode === 'signup');
  };
  el('auth-password-toggle').onclick = () => {
    const input=el('auth-password'), visible=input.type==='password';
    input.type=visible?'text':'password';
    el('auth-password-toggle').textContent=visible?'Hide':'Show';
    el('auth-password-toggle').setAttribute('aria-label',visible?'Hide password':'Show password');
    el('auth-password-toggle').setAttribute('aria-pressed',String(visible));
  };
  el('auth-form').onsubmit = async event => {
    event.preventDefault(); if (!client) return;
    const email=el('auth-email').value.trim(), password=el('auth-password').value;
    el('auth-submit').disabled=true; note('');
    try {
      if (mode === 'signup') {
        const {data,error}=await client.auth.signUp({email,password,options:{data:{display_name:el('auth-name').value.trim()}}});
        if (error) throw error;
        if (data.session) await checkAccess(data.session);
        else { el('auth-title').textContent='Check your inbox'; el('access-message').textContent='If Supabase sent a confirmation email, confirm your address, then sign in. Administrator approval is still required.'; mode='login'; show('auth-name-wrap',false); el('auth-submit').textContent='Sign in'; el('auth-switch').textContent='Request access'; show('auth-reset',true); show('auth-password-hint',false); }
      } else {
        const {data,error}=await client.auth.signInWithPassword({email,password});
        if (error) throw error;
        await checkAccess(data.session);
      }
    } catch (error) { note(error.message || 'Authentication failed.',true); }
    finally { el('auth-submit').disabled=false; }
  };
  el('auth-reset').onclick = async () => {
    if (!client) return;
    const email=el('auth-email').value.trim(); if (!email) return note('Enter your email first.',true);
    const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.href});
    note(error ? error.message : 'If that account exists, a password reset email was sent.',!!error);
  };
  el('approval-refresh').onclick = async () => {
    const {data}=await client.auth.getSession(); await checkAccess(data.session);
  };
  el('auth-signout').onclick = window.authSignOut;

  window.openUserManagement = async () => {
    if (!authReady || currentProfile?.app_role !== 'admin') return;
    const dialog = $('dg');
    dialog.innerHTML = '<div class="admin-loading"><span class="admin-spinner"></span><p>Loading account requests…</p></div>';
    if (!dialog.open) dialog.showModal();
    try {
      const {data:users,error}=await client.from('profiles').select('id,email,display_name,approval_status,app_role,created_at,status_reason').order('created_at',{ascending:false});
      if(error) throw error;
      let filter='all';
      const dateLabel = value => { const date=new Date(value); return Number.isNaN(date.getTime())?'Date unavailable':date.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); };
      const render = () => {
        const pending=users.filter(u=>u.approval_status==='pending').length;
        const approved=users.filter(u=>u.approval_status==='approved').length;
        const limited=users.length-pending-approved;
        const shown=users.filter(u=>filter==='all'||(filter==='limited'?['rejected','suspended'].includes(u.approval_status):u.approval_status===filter));
        const cards=shown.map(u=>{
          const status=u.approval_status;
          const actions=status==='pending'
            ? `<button class="admin-action admin-approve" data-user="${escHtml(u.id)}" data-status="approved"><span aria-hidden="true">✓</span> Approve</button><button class="admin-action admin-reject" data-user="${escHtml(u.id)}" data-status="rejected">Decline</button>`
            : status==='approved'&&u.app_role!=='admin'
              ? `<button class="admin-action admin-suspend" data-user="${escHtml(u.id)}" data-status="suspended">Suspend access</button>`
              : ['suspended','rejected'].includes(status)
                ? `<button class="admin-action admin-approve" data-user="${escHtml(u.id)}" data-status="approved"><span aria-hidden="true">↻</span> Restore access</button>` : '';
          return `<article class="admin-user-card"><div class="admin-user-avatar" aria-hidden="true">${escHtml((u.display_name||u.email||'?').trim().charAt(0).toUpperCase())}</div><div class="admin-user-info"><div class="admin-user-heading"><h3>${escHtml(u.display_name||'Name not provided')}</h3><span class="admin-status-pill status-${escHtml(status)}">${escHtml(status)}</span>${u.app_role==='admin'?'<span class="admin-role-pill">Administrator</span>':''}</div><p class="admin-user-email">${escHtml(u.email)}</p><p class="admin-user-date">Requested ${dateLabel(u.created_at)}</p>${u.status_reason?`<p class="admin-user-reason">${escHtml(u.status_reason)}</p>`:''}</div><div class="admin-user-actions">${actions||'<span class="admin-no-action">No action needed</span>'}</div></article>`;
        }).join('');
        dialog.innerHTML=`<section class="admin-panel"><header class="admin-panel-header"><div><span class="admin-eyebrow">WORKSPACE ACCESS</span><h2>Account approvals</h2><p>Review who can access your shared farm records.</p></div><button class="admin-close" type="button" aria-label="Close user management">×</button></header><div class="admin-summary"><div class="admin-stat"><span class="admin-stat-label">Total accounts</span><b>${users.length}</b></div><div class="admin-stat admin-stat-pending"><span class="admin-stat-label">Waiting for review</span><b>${pending}</b></div><div class="admin-stat"><span class="admin-stat-label">Approved</span><b>${approved}</b></div><div class="admin-stat"><span class="admin-stat-label">Limited access</span><b>${limited}</b></div></div><div class="admin-list-heading"><div><h3>Farm community</h3><span>${shown.length} ${shown.length===1?'account':'accounts'}</span></div><button class="admin-audit-button" type="button">View approval history</button></div><nav class="admin-filters" aria-label="Filter accounts"><button type="button" data-filter="all" class="${filter==='all'?'is-active':''}">All <span>${users.length}</span></button><button type="button" data-filter="pending" class="${filter==='pending'?'is-active':''}">Pending <span>${pending}</span></button><button type="button" data-filter="approved" class="${filter==='approved'?'is-active':''}">Approved <span>${approved}</span></button><button type="button" data-filter="limited" class="${filter==='limited'?'is-active':''}">Limited <span>${limited}</span></button></nav><div class="admin-user-list">${cards||'<div class="admin-empty"><span aria-hidden="true">✓</span><h3>All clear</h3><p>No accounts match this filter.</p></div>'}</div><footer class="admin-panel-footer"><span>Only approved accounts can access shared farm records.</span></footer></section>`;
        dialog.querySelector('.admin-close').onclick=()=>dialog.close();
        dialog.querySelector('.admin-filters').querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.filter;render();});
        dialog.querySelector('.admin-audit-button').onclick=showAudit;
        dialog.querySelectorAll('[data-user]').forEach(button=>button.onclick=async()=>{
          const status=button.dataset.status, reason=status==='rejected'||status==='suspended'?prompt('Optional reason:')||'':'';
          if(!confirm(`${status==='approved'?'Approve / restore':status==='rejected'?'Decline':'Suspend'} this account?`))return;
          button.disabled=true;
          const {error}=await client.rpc('admin_set_user_status',{p_user_id:button.dataset.user,p_status:status,p_reason:reason});
          if(error){alert(error.message);button.disabled=false;}else await window.openUserManagement();
        });
      };
      const showAudit = async () => {
        const {data,error}=await client.from('audit_events').select('actor_id,record_id,action,details,created_at').eq('record_type','user').order('created_at',{ascending:false}).limit(100);
        if(error){alert(error.message);return;}
        const rows=data.map(item=>`<article class="admin-audit-row"><span class="admin-audit-mark" aria-hidden="true">↗</span><div><b>${escHtml(item.action.replaceAll('_',' '))}</b><p>${escHtml(item.details?.reason||'Account status updated')}</p><small>${escHtml(item.record_id)} · ${dateLabel(item.created_at)}</small></div></article>`).join('');
        dialog.innerHTML=`<section class="admin-panel"><header class="admin-panel-header"><div><span class="admin-eyebrow">ADMINISTRATOR LOG</span><h2>Approval history</h2><p>Recent access decisions for this workspace.</p></div><button class="admin-close" type="button" aria-label="Close user management">×</button></header><div class="admin-audit-list">${rows||'<div class="admin-empty"><h3>No history yet</h3><p>Approval actions will appear here.</p></div>'}</div><footer class="admin-panel-footer"><button class="admin-back-button" type="button">← Back to accounts</button><span>Latest 100 access decisions</span></footer></section>`;
        dialog.querySelector('.admin-close').onclick=()=>dialog.close();
        dialog.querySelector('.admin-back-button').onclick=render;
      };
      render();
    } catch(error) {
      dialog.innerHTML=`<section class="admin-panel admin-error-panel"><header class="admin-panel-header"><div><span class="admin-eyebrow">WORKSPACE ACCESS</span><h2>User management</h2></div><button class="admin-close" type="button" aria-label="Close user management">×</button></header><p class="err">${escHtml(error.message)}</p></section>`;
      dialog.querySelector('.admin-close').onclick=()=>dialog.close();
    }
  };

  if (!window.supabase?.createClient || !CFG.SUPABASE_URL || !CFG.SUPABASE_PUBLISHABLE_KEY) {
    fail('Supabase is not configured. Add the Project URL and publishable key in src/js/config.js.');
    show('auth-form',false); show('auth-actions',false); note('No secret/service-role key belongs in browser config.',true); return;
  }
  client=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_PUBLISHABLE_KEY);
  window.AGRO_SUPABASE=client;
  client.auth.onAuthStateChange((event,session)=>setTimeout(()=>{
    if(event==='PASSWORD_RECOVERY') { mode='recovery'; setSignedOut('Enter a new password for your account.'); el('auth-password').autocomplete='new-password'; el('auth-submit').textContent='Update password'; }
    if(mode==='recovery'&&event==='PASSWORD_RECOVERY') return;
    if(event==='INITIAL_SESSION'||event==='SIGNED_OUT'||event==='PASSWORD_RECOVERY')checkAccess(session);
  },0));
  el('auth-form').addEventListener('submit', async event=>{
    if(mode!=='recovery') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const {error}=await client.auth.updateUser({password:el('auth-password').value});
    if(error) note(error.message,true); else {mode='login'; const {data}=await client.auth.getSession(); await checkAccess(data.session);}
  },true);
})();
