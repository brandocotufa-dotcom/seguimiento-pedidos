'use strict';
(() => {
  const statuses = ['Pendiente','En investigación','En prueba','Para compartir','Finalizado'];
  const cfg = window.APP_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const formatDate = v => v ? new Date(`${v}T12:00:00`).toLocaleDateString('es-AR') : 'Sin definir';
  const slug = s => String(s || '').toLowerCase().replaceAll(' ','-');
  let client, session, items = [], current = null, urls = [], channel, accessChannel, activeSessionToken = null;
  const ownerEmail = String(cfg.ownerEmail || '').toLowerCase();
  let passwordSetupMode = ['invite','recovery'].includes(new URLSearchParams(location.hash.slice(1)).get('type'));

  function toast(msg) { $('toast').textContent=msg; $('toast').classList.add('show'); setTimeout(()=>$('toast').classList.remove('show'),2600); }
  function showError(el,msg) { el.textContent=msg; el.style.display='block'; }
  function clearError(el) { el.textContent=''; el.style.display='none'; }
  function close(id) { $(id).classList.remove('show'); if(id==='detailOverlay'){current=null;revokeUrls();} }
  function revokeUrls() { urls.forEach(URL.revokeObjectURL); urls=[]; }
  function setBusy(button,busy,label) { button.disabled=busy; if(label)button.textContent=busy?'Conectando…':label; }

  function normalizeDeliverables(value, requestDate='', dueDate='') {
    let source=value;
    if(typeof source==='string'){try{source=JSON.parse(source);}catch{source=[];}}
    const normalized=Array.isArray(source)?source.map(d=>({id:String(d.id||crypto.randomUUID()),endDate:d.endDate||d.end_date||'',detail:d.detail||''})):[];
    if(normalized.length)return normalized;
    return dueDate?[{id:crypto.randomUUID(),endDate:dueDate}]:[];
  }
  function deliverableRow(d={}) {
    return `<div class="deliverable-row" data-deliverable-row data-deliverable-id="${esc(d.id||crypto.randomUUID())}"><div class="field full"><label>Fecha del hito</label><div class="date-with-add"><input data-deliverable-end type="date" value="${esc(d.endDate||'')}"><button class="date-add" type="button" data-add-deliverable title="Agregar otro hito" aria-label="Agregar otro hito">＋</button><button class="date-remove" type="button" data-remove-deliverable title="Quitar este hito" aria-label="Quitar este hito">×</button></div></div><details class="optional-detail milestone-detail" ${d.detail?'open':''}><summary><span>Agregar detalle del hito (opcional)</span><span class="detail-toggle" aria-hidden="true"></span></summary><textarea data-deliverable-detail placeholder="Qué se espera completar para este hito?">${esc(d.detail||'')}</textarea></details></div>`;
  }
  function bindDeliverableEditor(id, deliverables=[]) {
    const target=$(id);
    target.innerHTML=(deliverables.length?deliverables:[{}]).map(deliverableRow).join('');
    target.onclick=event=>{
      if(event.target.closest('[data-add-deliverable]')){event.target.closest('[data-deliverable-row]').insertAdjacentHTML('afterend',deliverableRow());return;}
      if(event.target.closest('[data-remove-deliverable]')){const row=event.target.closest('[data-deliverable-row]');if(target.querySelectorAll('[data-deliverable-row]').length===1){row.querySelectorAll('input').forEach(input=>input.value='');return;}row.remove();}
    };
  }
  function readDeliverables(id) {
    return [...$(id).querySelectorAll('[data-deliverable-row]')].map(row=>({id:row.dataset.deliverableId||crypto.randomUUID(),endDate:row.querySelector('[data-deliverable-end]').value||'',detail:row.querySelector('[data-deliverable-detail]').value.trim()})).filter(d=>d.endDate);
  }
  function deliverableError(deliverables) {
    if(!deliverables.length)return 'Agregá al menos un hito.';
    if(deliverables.some(d=>!d.endDate))return 'Completá la fecha de cada hito.';
    return '';
  }
  function latestEndDate(deliverables) {return deliverables.map(d=>d.endDate).filter(Boolean).sort().at(-1)||null;}
  function nameKey(value) {return String(value||'').split('@')[0].normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');}
  const collaboratorNames=['Fabrizio Berto','Estefania Nasrala','Alejandra Corredor'];
  function collaboratorValue(value) {
    const key=nameKey(value);
    if(key.includes('fabriz')||key==='fberto')return 'Fabrizio Berto';
    if(key.includes('estef')||key==='enasrala')return 'Estefania Nasrala';
    if(key.includes('alej')||key==='acorredor')return 'Alejandra Corredor';
    return '';
  }
  function collaboratorOptions(value='') {const selected=collaboratorValue(value);return `<option value="" ${selected?'':'selected'} disabled>Elegí un colaborador</option>${collaboratorNames.map(name=>`<option value="${esc(name)}" ${selected===name?'selected':''}>${esc(name)}</option>`).join('')}`;}
  function displayName(value,fallback='') {
    const raw=String(value||'').trim();
    const key=nameKey(raw);
    const aliases={alejandra:'Alejandra Corredor',acorredor:'Alejandra Corredor',alejandracorredor:'Alejandra Corredor',fberto:'Fabrizio Berto',fabrizio:'Fabrizio Berto',fabrizioberto:'Fabrizio Berto',enasrala:'Estefania Nasrala',estefania:'Estefania Nasrala',estefanianasrala:'Estefania Nasrala'};
    if(aliases[key])return aliases[key];
    if(raw.includes('@')&&nameKey(fallback)==='usuario')return 'Alejandra Corredor';
    return raw.includes('@')?(fallback||raw):(raw||fallback||'Equipo');
  }

  async function loadBoard() {
    const {data:requests,error:rErr}=await client.from('requests').select('*').order('created_at',{ascending:false});
    if(rErr)throw rErr;
    const ids=(requests||[]).map(r=>r.id);
    let updates=[];
    if(ids.length){const {data,error}=await client.from('request_updates').select('*').in('request_id',ids).order('created_at',{ascending:true});if(error)throw error;updates=data||[];}
    items=(requests||[]).map(r=>({id:r.id,title:r.title,type:'Compromiso',status:r.status||'Pendiente',owner:r.owner||'Equipo de Soporte',leadName:r.lead_name||'',deliverables:normalizeDeliverables(r.deliverables,r.request_date||'',r.due_date||''),requestDate:r.request_date||'',dueDate:r.due_date||'',description:r.description||'',next:r.next_step||'',created:r.created_at,updates:updates.filter(u=>u.request_id===r.id).map(u=>({id:u.id,text:u.text,next:u.next_step||'',by:displayName(u.by_email||u.by_name||'Equipo',u.by_name||'Equipo'),date:u.created_at}))}));
    if(current)current=items.find(i=>i.id===current.id)||null;
    render();
  }
  function render() {
    const q=$('search').value.toLowerCase();
    const shown=items.filter(x=>(x.title+' '+x.owner+' '+x.leadName+' '+x.description+' '+x.deliverables.map(d=>d.detail).join(' ')).toLowerCase().includes(q));
    $('cards').innerHTML=shown.length?shown.map(x=>{const last=x.updates.at(-1);const nextDue=[...x.deliverables].filter(d=>d.endDate).sort((a,b)=>a.endDate.localeCompare(b.endDate))[0];return `<article class="card" data-id="${esc(x.id)}"><div class="cardtop"><h3>${esc(x.title)}</h3><span class="badge ${slug(x.status)}">${esc(x.status)}</span></div><p class="summary">${esc(last?last.text:x.description||'Todavía no se agregó un resumen.')}</p><div class="cardpeople">${x.leadName?`Colaborador líder: <strong>${esc(x.leadName)}</strong>`:'Responsabilidad compartida por todo el equipo'}</div><div class="cardmeta"><span>${x.deliverables.length} hito${x.deliverables.length===1?'':'s'}${nextDue?` · próximo hito: <strong>${formatDate(nextDue.endDate)}</strong>`:''}</span><span>${x.updates.length} avance${x.updates.length===1?'':'s'}</span></div></article>`}).join(''):'<div class="empty">No encontramos compromisos con ese texto.</div>';
    $('openCount').textContent=items.filter(x=>x.status!=='Finalizado').length;
    $('workCount').textContent=items.filter(x=>['En investigación','En prueba','Para compartir'].includes(x.status)).length;
    $('doneCount').textContent=items.filter(x=>x.status==='Finalizado').length;
    $('countLabel').textContent=`${shown.length} compromiso${shown.length===1?'':'s'}`;
  }
  async function renderEvidence(id) {
    const target=$('evidenceList');
    try {
      const {data:files,error}=await client.from('request_attachments').select('*').eq('request_id',id).order('created_at',{ascending:false});
      if(error)throw error;
      if(!current||current.id!==id)return;
      if(!files.length){target.innerHTML='<div class="detailstate">Todavía no hay archivos adjuntos.</div>';return;}
      const cards=[];
      for(const f of files){const {data,error:urlError}=await client.storage.from('pedido-adjuntos').createSignedUrl(f.storage_path,3600);if(urlError)throw urlError;const url=data.signedUrl;const media=f.mime_type?.startsWith('image/')?`<img src="${url}" alt="${esc(f.name)}">`:f.mime_type?.startsWith('video/')?`<video src="${url}" controls></video>`:'<div class="detailstate">Archivo adjunto</div>';cards.push(`<div class="evidence-card">${media}<a href="${url}" target="_blank" rel="noopener" download="${esc(f.name)}">${esc(f.name)}</a><small>${new Date(f.created_at).toLocaleDateString('es-AR')} · <button class="linkbutton" data-file-delete="${esc(f.id)}" type="button">Quitar</button></small></div>`);}
      target.innerHTML=cards.join('');
      target.querySelectorAll('[data-file-delete]').forEach(b=>b.onclick=async()=>{try{await removeFile(b.dataset.fileDelete,id);await renderEvidence(id);toast('Adjunto quitado');}catch(e){toast(`No se pudo quitar: ${e.message}`);}});
    } catch(e) { target.innerHTML=`<div class="detailstate">No se pudieron cargar los adjuntos: ${esc(e.message)}</div>`; }
  }
  async function removeFile(fileId,requestId) {
    const {data:file,error}=await client.from('request_attachments').select('storage_path').eq('id',fileId).single();if(error)throw error;
    const {error:storageError}=await client.storage.from('pedido-adjuntos').remove([file.storage_path]);if(storageError)throw storageError;
    const {error:rowError}=await client.from('request_attachments').delete().eq('id',fileId);if(rowError)throw rowError;
    revokeUrls();await renderEvidence(requestId);
  }
  async function show(id) {
    revokeUrls();current=items.find(x=>x.id===id);if(!current)return;const x=current;
    $('detailType').textContent='COMPROMISO · '+(x.owner||'Equipo de Soporte');$('detailTitle').textContent=x.title;
    $('detailBody').innerHTML=`<div class="detailstatus"><span class="detailstate">Estado</span><select id="stateSelect">${statuses.map(s=>`<option ${s===x.status?'selected':''}>${s}</option>`).join('')}</select><span class="detailstate">Compromiso compartido con todo el equipo</span></div><div class="eyebrow">EDITAR COMPROMISO</div><div class="formgrid"><div class="field full"><label for="editTitle">Nombre del compromiso</label><input id="editTitle" maxlength="110" value="${esc(x.title)}"></div><div class="field"><label for="editRequestDate">Fecha de inicio</label><input id="editRequestDate" type="date" value="${esc(x.requestDate||'')}"></div><div class="field"><label for="editLeadName">Colaborador que toma la batuta</label><select id="editLeadName">${collaboratorOptions(x.leadName)}</select></div><details class="optional-detail" ${x.description?'open':''}><summary><span>Agregar detalle del compromiso (opcional)</span><span class="detail-toggle" aria-hidden="true"></span></summary><textarea id="editDescription" placeholder="Que detalle conviene compartir con el equipo?">${esc(x.description)}</textarea></details><div class="field full"><label>Hitos del compromiso</label><div id="editDeliverables" class="deliverable-editor"></div><small class="helper">Cada hito tiene su fecha y un detalle opcional que se despliega con +.</small></div></div><div style="margin-top:13px"><button class="btn primary" id="saveDetails" style="width:100%;padding:11px;font-size:14px">Guardar cambios</button></div>${x.next?`<div class="nextstep"><div class="detailitem">Próximo paso<strong>${esc(x.next)}</strong></div></div>`:''}<div class="advancebox"><h3>¿Qué avance hubo?</h3><textarea id="advanceText" placeholder="Escribí una novedad breve…"></textarea><input id="advanceNext" placeholder="Próximo paso (opcional)"><button class="btn primary" id="saveAdvance">Registrar avance</button></div><div class="evidence"><h3>Capturas y videos</h3><div class="filepick"><input id="evidenceInput" type="file" accept="image/*,video/*" multiple><span class="detailstate">Adjuntos compartidos con el equipo.</span></div><div class="evidence-list" id="evidenceList">Cargando adjuntos…</div></div><div class="history"><h3>Avances anteriores</h3>${x.updates.length?[...x.updates].reverse().map(u=>`<div class="history-entry"><div class="date">${new Date(u.date).toLocaleDateString('es-AR')} · ${esc(u.by||x.owner)}</div><div class="entrytext">${esc(u.text)}</div><button class="edit-comment" type="button" data-edit-comment="${esc(u.id)}">Editar comentario</button>${u.next?`<div class="entrytext"><strong>Próximo paso:</strong> ${esc(u.next)}</div>`:''}</div>`).join(''):'<div class="detailstate">Todavía no hay avances.</div>'}</div><div class="modalactions"><span class="detailstate">Los cambios se comparten con el equipo.</span><button id="deleteBtn" class="btn small">Eliminar compromiso</button></div>`;
    bindDeliverableEditor('editDeliverables',x.deliverables);
    $('detailOverlay').classList.add('show');await renderEvidence(id);
    $('detailBody').querySelectorAll('[data-edit-comment]').forEach(b=>b.onclick=async()=>{const u=x.updates.find(a=>a.id===b.dataset.editComment);if(!u)return;const edited=prompt('Editar comentario:',u.text);if(edited===null)return;if(!edited.trim()){toast('El comentario no puede quedar vacío');return;}const {error}=await client.from('request_updates').update({text:edited.trim()}).eq('id',u.id);if(error){toast(`No se guardó: ${error.message}`);return;}await loadBoard();await show(id);toast('Comentario actualizado');});
    $('stateSelect').onchange=async e=>{const {error}=await client.from('requests').update({status:e.target.value}).eq('id',id);if(error){toast(`No se guardó: ${error.message}`);return;}await loadBoard();await show(id);toast('Estado actualizado');};
    $('saveDetails').onclick=async()=>{const title=$('editTitle').value.trim();if(!title){toast('El nombre no puede quedar vacío');return;}const deliverables=readDeliverables('editDeliverables');const issue=deliverableError(deliverables);if(issue){toast(issue);return;}const requestDate=$('editRequestDate').value;if(!requestDate){toast('Completa la fecha de inicio');return;}const patch={title,request_date:requestDate,description:$('editDescription').value.trim(),lead_name:$('editLeadName').value||null,deliverables,due_date:latestEndDate(deliverables)};const {error}=await client.from('requests').update(patch).eq('id',id);if(error){toast(`No se guardó: ${error.message}`);return;}await loadBoard();await show(id);toast('Compromiso actualizado');};
    $('saveAdvance').onclick=async()=>{const text=$('advanceText').value.trim();if(!text){toast('Escribí el avance antes de guardarlo');return;}const next=$('advanceNext').value.trim();const {error}=await client.from('request_updates').insert({request_id:id,text,next_step:next||null,by_name:displayName(session.user.email,session.user.user_metadata?.full_name||session.user.email),by_email:session.user.email});if(error){toast(`No se guardó: ${error.message}`);return;}const patch={};if(next)patch.next_step=next;if(x.status==='Pendiente')patch.status='En investigación';if(Object.keys(patch).length){const {error:e2}=await client.from('requests').update(patch).eq('id',id);if(e2){toast(`El avance quedó guardado, pero no se actualizó el compromiso: ${e2.message}`);return;}}await loadBoard();await show(id);toast('Avance registrado para todo el equipo');};
    $('evidenceInput').onchange=async e=>{const files=[...e.target.files];if(!files.length)return;for(const file of files){if(!(file.type.startsWith('image/')||file.type.startsWith('video/')))continue;const fileId=crypto.randomUUID();const path=`${id}/${fileId}-${file.name.replace(/[^\w.\- ]/g,'_')}`;const {error:upError}=await client.storage.from('pedido-adjuntos').upload(path,file,{contentType:file.type,upsert:false});if(upError){toast(`No se pudo subir ${file.name}: ${upError.message}`);continue;}const {error:metaError}=await client.from('request_attachments').insert({id:fileId,request_id:id,name:file.name,mime_type:file.type,storage_path:path,uploaded_by:session.user.id});if(metaError){await client.storage.from('pedido-adjuntos').remove([path]);toast(`No se guardó el adjunto: ${metaError.message}`);continue;}}revokeUrls();await renderEvidence(id);e.target.value='';toast('Adjuntos compartidos con el equipo');};
    $('deleteBtn').onclick=async()=>{if(!confirm('¿Querés eliminar este compromiso y sus avances para todo el equipo?'))return;const {data:files}=await client.from('request_attachments').select('storage_path').eq('request_id',id);if(files?.length)await client.storage.from('pedido-adjuntos').remove(files.map(f=>f.storage_path));const {error}=await client.from('requests').delete().eq('id',id);if(error){toast(`No se pudo eliminar: ${error.message}`);return;}close('detailOverlay');await loadBoard();toast('Compromiso eliminado para todo el equipo');};
  }
  async function exportBackup() {
    const {data:requests,error}=await client.from('requests').select('*').order('created_at');if(error)throw error;const ids=requests.map(r=>r.id);let updates=[];let attachments=[];
    if(ids.length){const [u,a]=await Promise.all([client.from('request_updates').select('*').in('request_id',ids).order('created_at'),client.from('request_attachments').select('*').in('request_id',ids)]);if(u.error)throw u.error;if(a.error)throw a.error;updates=u.data;attachments=a.data;}
    const itemsOut=requests.map(r=>({...r,requestDate:r.request_date,dueDate:r.due_date,leadName:r.lead_name||'',deliverables:normalizeDeliverables(r.deliverables,r.request_date||'',r.due_date||''),next:r.next_step,updates:updates.filter(u=>u.request_id===r.id).map(u=>({id:u.id,text:u.text,next:u.next_step,by:displayName(u.by_email||u.by_name||'Equipo',u.by_name||'Equipo'),date:u.created_at})),attachments:attachments.filter(a=>a.request_id===r.id).map(a=>({name:a.name,mime_type:a.mime_type,storage_path:a.storage_path}))}));
    const blob=new Blob([JSON.stringify({format:'gauss-shared-board-v1',exportedAt:new Date().toISOString(),items:itemsOut},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`respaldo-compromisos-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);toast('Respaldo descargado (registros y referencias a adjuntos)');
  }
  async function importBackup(file) {
    const parsed=JSON.parse(await file.text());if(!Array.isArray(parsed.items))throw new Error('El archivo no contiene una lista de compromisos válida.');
    const rows=parsed.items.map(x=>{const deliverables=normalizeDeliverables(x.deliverables,x.request_date||x.requestDate||'',x.due_date||x.dueDate||'');return{id:String(x.id||crypto.randomUUID()),title:String(x.title||'Compromiso importado'),type:'Compromiso',status:statuses.includes(x.status)?x.status:'Pendiente',owner:x.owner||'Equipo de Soporte',lead_name:x.lead_name||x.leadName||null,deliverables,request_date:x.request_date||x.requestDate||null,due_date:latestEndDate(deliverables)||x.due_date||x.dueDate||null,description:x.description||'',next_step:x.next_step||x.next||null,created_by:session.user.id};});
    const {error}=await client.from('requests').upsert(rows);if(error)throw error;
    const updates=[];for(const x of parsed.items){for(let i=0;i<(x.updates||[]).length;i++){const u=x.updates[i];updates.push({id:String(u.id||`${x.id}-${u.date||'sinfecha'}-${i}`),request_id:String(x.id),text:u.text||'',next_step:u.next||null,by_name:displayName(u.by_email||u.by||session.user.email,u.by||session.user.email),by_email:session.user.email,created_by:session.user.id,created_at:u.date||new Date().toISOString()});}}
    if(updates.length){const {error:updateError}=await client.from('request_updates').upsert(updates);if(updateError)throw updateError;}
    await loadBoard();toast('Respaldo importado. Los archivos adjuntos requieren subirse nuevamente.');
  }
  function setLoggedIn(user) {const name=displayName(user.email,user.user_metadata?.full_name||'Usuario');$('authGate').hidden=true;$('appShell').hidden=false;$('userEmail').textContent=name;$('userAvatar').textContent=name.split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase();}
  function setLoggedOut() {$('appShell').hidden=true;$('authGate').hidden=false;}
  function showPasswordSetup(message='Creá una contraseña personal para ingresar al tablero.') {$('authTitle').textContent='Crear contraseña';$('authDescription').textContent=message;$('loginForm').hidden=true;$('resetPasswordBtn').hidden=true;$('authHint').hidden=true;$('passwordSetupForm').hidden=false;clearError($('passwordError'));}
  function showLogin() {$('authTitle').textContent='Ingresar al tablero';$('authDescription').textContent='Usá el correo y tu contraseña personal.';$('loginForm').hidden=false;$('resetPasswordBtn').hidden=false;$('authHint').hidden=false;$('passwordSetupForm').hidden=true;}
  function addAccessNotice(row) {
    const box=$('accessNotice');box.hidden=false;
    const line=document.createElement('div');line.className='access-notice-row';
    const message=document.createElement('span');message.textContent=`${displayName(row.email)} creó su contraseña y ya puede ingresar.`;
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='btn small';dismiss.textContent='Entendido';
    dismiss.onclick=async()=>{const {error}=await client.from('account_setup_events').update({read_at:new Date().toISOString()}).eq('user_id',row.user_id);if(error){toast(`No se pudo cerrar el aviso: ${error.message}`);return;}line.remove();if(!box.children.length)box.hidden=true;};
    line.append(message,dismiss);box.append(line);
  }
  async function loadAccessNotices() {
    if((session?.user?.email||'').toLowerCase()!==ownerEmail)return;
    const {data,error}=await client.from('account_setup_events').select('user_id,email,created_at').is('read_at',null).order('created_at',{ascending:false});
    if(error){toast(`No se pudieron revisar los avisos: ${error.message}`);return;}
    $('accessNotice').replaceChildren();(data||[]).forEach(addAccessNotice);$('accessNotice').hidden=!(data||[]).length;
  }
  async function startBoard(user) {
    setLoggedIn(user);
    try {
      await loadBoard();
      if(channel)await client.removeChannel(channel);
      channel=client.channel('gauss-board-live').on('postgres_changes',{event:'*',schema:'public',table:'requests'},()=>loadBoard()).on('postgres_changes',{event:'*',schema:'public',table:'request_updates'},()=>loadBoard()).subscribe();
      if((user.email||'').toLowerCase()===ownerEmail){
        await loadAccessNotices();
        if(accessChannel)await client.removeChannel(accessChannel);
        accessChannel=client.channel('gauss-account-setup-live').on('postgres_changes',{event:'INSERT',schema:'public',table:'account_setup_events'},payload=>{if(payload.new.email?.toLowerCase()!==ownerEmail)addAccessNotice(payload.new);}).subscribe();
      }
    } catch(e) { toast(`No se pudo cargar el tablero: ${e.message}`); }
  }
  async function start() {
    if(!cfg.supabaseUrl||cfg.supabaseUrl.includes('PEGAR_')||!cfg.supabasePublishableKey||cfg.supabasePublishableKey.includes('PEGAR_')){showError($('loginError'),'Falta conectar el proyecto de datos. El administrador debe completar config.js y ejecutar la configuración de Supabase.');$('loginForm').querySelector('button').disabled=true;return;}
    client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
    $('loginForm').onsubmit=async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');setBusy(b,true);clearError($('loginError'));const {error}=await client.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});setBusy(b,false,'Ingresar');if(error)showError($('loginError'),'No se pudo ingresar. Revisá el correo y la contraseña, o usá “Crear o recuperar mi contraseña”.');};
    $('resetPasswordBtn').onclick=async()=>{const email=$('loginEmail').value.trim();if(!email){showError($('loginError'),'Escribí tu correo para enviarte un enlace para crear o recuperar tu contraseña.');$('loginEmail').focus();return;}clearError($('loginError'));const b=$('resetPasswordBtn');b.disabled=true;const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});b.disabled=false;if(error)showError($('loginError'),`No se pudo enviar el enlace: ${error.message}`);else toast('Te enviamos un enlace al correo ingresado. Revisá también el spam.');};
    $('passwordSetupForm').onsubmit=async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');const password=$('newPassword').value;clearError($('passwordError'));if(password.length<8){showError($('passwordError'),'Usá una contraseña de al menos 8 caracteres.');return;}if(password!==$('confirmPassword').value){showError($('passwordError'),'Las contraseñas no coinciden.');return;}setBusy(b,true,'Guardar contraseña');const {error}=await client.auth.updateUser({password});setBusy(b,false,'Guardar contraseña');if(error){showError($('passwordError'),`No se pudo guardar: ${error.message}`);return;}if((session?.user?.email||'').toLowerCase()!==ownerEmail){const {error:noticeError}=await client.from('account_setup_events').insert({user_id:session.user.id,email:session.user.email});if(noticeError&&noticeError.code!=='23505')toast('La contraseña se guardó, pero no se pudo registrar el aviso al administrador.');}passwordSetupMode=false;activeSessionToken=session.access_token;history.replaceState(null,'',location.pathname+location.search);$('passwordSetupForm').reset();showLogin();await startBoard(session.user);toast('Contraseña guardada. Ya ingresaste al tablero.');};
    $('signOutBtn').onclick=async()=>{await client.auth.signOut();};
    $('backupBtn').onclick=async()=>{try{await exportBackup();}catch(e){toast(`No se pudo exportar: ${e.message}`);}};
    $('importBtn').onclick=()=>$('importFile').click();
    $('importFile').onchange=async e=>{if(!e.target.files?.[0])return;try{await importBackup(e.target.files[0]);}catch(err){toast(`No se pudo importar: ${err.message}`);}e.target.value='';};
    $('loginEmail').value=new URLSearchParams(location.hash.slice(1)).get('email')||'';
    client.auth.onAuthStateChange(async(event,newSession)=>{session=newSession;if(!session){activeSessionToken=null;setLoggedOut();return;}if(passwordSetupMode||event==='PASSWORD_RECOVERY'){passwordSetupMode=true;activeSessionToken=session.access_token;setLoggedOut();showPasswordSetup();return;}if(activeSessionToken===session.access_token)return;activeSessionToken=session.access_token;showLogin();await startBoard(session.user);});
    const {data:{session:existing}}=await client.auth.getSession();if(existing){session=existing;if(passwordSetupMode){activeSessionToken=existing.access_token;setLoggedOut();showPasswordSetup();}else{showLogin();if(activeSessionToken!==existing.access_token){activeSessionToken=existing.access_token;await startBoard(existing.user);}}}else{showLogin();}
    $('newBtn').onclick=()=>{$('requestForm').reset();$('requestDate').value=new Date().toISOString().slice(0,10);$('newDescriptionDetails').open=false;bindDeliverableEditor('newDeliverables',[]);$('formOverlay').classList.add('show');};
    document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>close(b.dataset.close));document.querySelectorAll('.overlay').forEach(o=>o.onclick=e=>{if(e.target===o)close(o.id);});
    $('cards').onclick=e=>{const c=e.target.closest('[data-id]');if(c)show(c.dataset.id);};$('search').oninput=render;
    $('requestForm').onsubmit=async e=>{e.preventDefault();const title=$('title').value.trim();if(!title){toast('El nombre no puede quedar vacío');return;}const deliverables=readDeliverables('newDeliverables');const issue=deliverableError(deliverables);if(issue){toast(issue);return;}const row={id:crypto.randomUUID(),title,type:'Compromiso',status:'Pendiente',owner:'Equipo de Soporte',lead_name:$('leadName').value||null,deliverables,request_date:$('requestDate').value,due_date:latestEndDate(deliverables),description:$('description').value.trim(),next_step:null,created_by:session.user.id};const {error}=await client.from('requests').insert(row);if(error){toast(`No se pudo guardar: ${error.message}`);return;}await loadBoard();$('requestForm').reset();$('newDescriptionDetails').open=false;bindDeliverableEditor('newDeliverables',[]);close('formOverlay');toast('Compromiso compartido con el equipo');};
    document.onkeydown=e=>{if(e.key==='Escape'){close('formOverlay');close('detailOverlay');}};
  }
  start();
})();

