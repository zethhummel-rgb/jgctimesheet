(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const definitions = [
    ['jobs-stat','Active Jobs',2,144], ['quotes','Quotes',2,144],
    ['work-orders','Work Orders',2,144], ['purchase-orders','Purchase Orders',2,144],
    ['estimate-desk','JGC Estimate Desk',4,144], ['calendar','Schedule Calendar',4,408],
    ['recent','Recent Work',4,408], ['active-jobs','Active Jobs',4,408],
    ['subcontractors','Subcontractor Activity',4,280], ['tasks','Tasks / Follow-Ups',4,280], ['announcements','Announcements',4,280]
  ];
  const widths = [2,4,6,8,12], heights = [144,280,456,640];
  const defaults = () => ({version:1, widgets:definitions.map(([id,,width,height]) => ({id,width,height,visible:true}))});
  let layout = defaults(), userId = '', edit = false, ready = false, saving = false, revision = 0, savedRevision = 0, timer, loadId = 0;
  const cards = new Map();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const url = (base, value) => base + encodeURIComponent(value || '');
  const date = value => value ? new Date(String(value).length===10 ? value+'T12:00:00' : value).toLocaleDateString('en-CA',{month:'short',day:'numeric'}) : '';
  const iconPaths={
    briefcase:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12a20 20 0 0 0 18 0M10 12h4v3h-4z"/>',
    file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 12h8M8 16h8"/>',
    wrench:'<path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L2 19a2.1 2.1 0 0 0 3 3l6.3-6.3a5 5 0 0 0 6.4-6.4l-3.5 3.5-3-3z"/>',
    cart:'<path d="M2 3h3l3 13h11l3-9H6M9 21h.01M18 21h.01"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
    calculator:'<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 5h8v4H8zM8 13h1M12 13h1M16 13h.01M8 17h1M12 17h1M16 17h.01"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2M8 18h2"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    users:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3"/>',
    check:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
    notice:'<path d="m3 10 14-5v14L3 14zM7 15l2 6M21 8v8"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 1v2M12 21v2M1 12h2M21 12h2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
    search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    plus:'<path d="M12 5v14M5 12h14"/>'
  };
  const icon=key=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[key]||iconPaths.briefcase}</svg>`;
  const widgetIcons={'jobs-stat':'briefcase',quotes:'file','work-orders':'wrench','purchase-orders':'cart','estimate-desk':'calculator',calendar:'calendar',recent:'clock','active-jobs':'briefcase',subcontractors:'users',tasks:'check',announcements:'notice'};
  function normalize(value) {
    const result=defaults(), supplied=Array.isArray(value?.widgets) ? value.widgets : [];
    const seen=new Set(), ordered=[];
    for (const raw of supplied) {
      const item=result.widgets.find(w=>w.id===raw?.id);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id); ordered.push({...item,width:widths.includes(raw.width)?raw.width:item.width,height:heights.includes(raw.height)?raw.height:item.height,visible:raw.visible!==false});
    }
    return {version:1,widgets:ordered.concat(result.widgets.filter(w=>!seen.has(w.id)))};
  }
  const key = () => 'jgcDashboardLayout:v1:'+userId;
  const status = text => $('dashboardLayoutStatus').textContent=text;
  function cache(pending) { try {localStorage.setItem(key(),JSON.stringify({layout,pending}));} catch (_) { /* Account storage remains authoritative. */ } }
  function apply() {
    for (const item of layout.widgets) {
      const card=cards.get(item.id); card.hidden=!item.visible;
      card.style.setProperty('--widget-width',item.width); card.style.setProperty('--widget-height',item.height+'px');
      card.dataset.wide=String(item.width>=8); card.dataset.compact=String(item.height===144);
      card.querySelector('[data-size="width"]').value=item.width;
      card.querySelector('[data-size="height"]').value=item.height;
      card.querySelector('.dashboard-edit-tools').hidden=!edit;
      card.querySelector('.dashboard-resize').hidden=!edit;
      $('dashboardGrid').append(card);
      const check=$('dashboardWidgetChoices').querySelector('[value="'+item.id+'"]');if(check)check.checked=item.visible;
    }
    $('dashboardEmpty').hidden=layout.widgets.some(w=>w.visible);
    $('dashboardEditHelp').hidden=!edit;
    $('dashboardEdit').textContent=edit?'Done editing':'Edit layout';
    $('dashboardEdit').setAttribute('aria-pressed',String(edit));
  }
  function changed() {
    if(!ready)return;
    revision++; cache(true); apply(); status('Saving your layout…');
    clearTimeout(timer);timer=setTimeout(save,400);
  }
  async function save() {
    if(!ready || saving || savedRevision===revision)return;
    saving=true;const current=revision, snapshot=JSON.parse(JSON.stringify(layout));
    try {
      const identity=await supabaseClient.auth.getUser();
      if(identity.error || identity.data?.user?.id!==userId)throw new Error('Your account changed. Reload before saving.');
      const result=await supabaseClient.from('portal_dashboard_layouts').upsert({user_id:userId,layout:snapshot,updated_at:new Date().toISOString()},{onConflict:'user_id'});
      if(result.error)throw result.error;
      savedRevision=current;
      if(current===revision){cache(false);status('Layout saved to your account.');$('dashboardRetrySave').hidden=true;}
    } catch (_) {
      status('Layout kept on this device. Account sync is pending.');$('dashboardRetrySave').hidden=false;
    } finally {
      saving=false;if(savedRevision===current && revision!==current)void save();
    }
  }
  function move(id,delta) {
    const visible=layout.widgets.filter(w=>w.visible),index=visible.findIndex(w=>w.id===id),other=visible[index+delta];
    if(!other)return;
    const from=layout.widgets.findIndex(w=>w.id===id),to=layout.widgets.indexOf(other);
    [layout.widgets[from],layout.widgets[to]]=[layout.widgets[to],layout.widgets[from]];changed();
    cards.get(id).querySelector('.dashboard-move').focus();
  }
  function setup() {
    const commandbar=document.createElement('div');commandbar.className='dashboard-commandbar';
    const search=document.querySelector('#summarySection .admin-global-search');search.before(commandbar);commandbar.append(search,document.querySelector('.dashboard-quick-actions'));
    const grid=document.createElement('div');grid.id='dashboardGrid';grid.className='dashboard-grid';$('summarySection').append(grid);
    for(const [id,title,width,height] of definitions){
      const card=document.createElement('section');card.className='dashboard-widget';card.dataset.widget=id;card.setAttribute('aria-label',title);
      card.innerHTML=`<header class="dashboard-widget-header"><h2><span class="dashboard-icon">${icon(widgetIcons[id])}</span><span>${title}</span></h2><button class="dashboard-widget-options" type="button" aria-label="Customize ${title}" title="Customize widget">⋮</button></header><div class="dashboard-edit-tools" hidden><button type="button" class="dashboard-move" aria-label="Move ${title}" title="Drag or use arrow keys">⠿ Move</button><button type="button" data-move="-1" aria-label="Move ${title} earlier">↑</button><button type="button" data-move="1" aria-label="Move ${title} later">↓</button><label>Width<select data-size="width" aria-label="${title} width">${widths.map((n,i)=>`<option value="${n}">${['Small','Third','Half','Wide','Full'][i]}</option>`).join('')}</select></label><label>Height<select data-size="height" aria-label="${title} height">${heights.map((n,i)=>`<option value="${n}">${['Compact','Short','Medium','Tall'][i]}</option>`).join('')}</select></label><button type="button" data-hide aria-label="Hide ${title}">Hide</button></div><div class="dashboard-widget-body"><p>Loading…</p></div><footer class="dashboard-widget-footer" hidden></footer><button type="button" class="dashboard-resize" hidden aria-label="Resize ${title}" title="Drag to resize; arrow keys adjust width and height">↘</button>`;
      cards.set(id,card);grid.append(card);
      card.querySelector('.dashboard-widget-options').onclick=()=>{if(!ready)return;edit=true;apply();card.querySelector('.dashboard-move').focus();};
      card.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>move(id,Number(b.dataset.move)));
      card.querySelector('[data-hide]').onclick=()=>{layout.widgets.find(w=>w.id===id).visible=false;changed();$('dashboardMenuToggle').focus();};
      card.querySelectorAll('[data-size]').forEach(s=>s.onchange=()=>{layout.widgets.find(w=>w.id===id)[s.dataset.size]=Number(s.value);changed();});
      card.querySelector('.dashboard-move').onkeydown=e=>{if(['ArrowUp','ArrowLeft','ArrowDown','ArrowRight'].includes(e.key)){e.preventDefault();move(id,['ArrowUp','ArrowLeft'].includes(e.key)?-1:1);}};
      card.querySelector('.dashboard-resize').onkeydown=e=>{
        if(!['ArrowUp','ArrowLeft','ArrowDown','ArrowRight'].includes(e.key))return;e.preventDefault();
        const item=layout.widgets.find(w=>w.id===id),horizontal=['ArrowLeft','ArrowRight'].includes(e.key),sizes=horizontal?widths:heights,field=horizontal?'width':'height';
        item[field]=sizes[Math.max(0,Math.min(sizes.length-1,sizes.indexOf(item[field])+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)))];changed();
      };
    }
    const calendar=cards.get('calendar').querySelector('.dashboard-widget-body');calendar.replaceChildren(document.querySelector('.admin-schedule-summary'));const tools=document.createElement('details');tools.className='dashboard-calendar-tools';tools.innerHTML='<summary>Calendar tools</summary><div></div>';
    tools.querySelector('div').append($('adminScheduleSyncAllButton'),$('adminSchedulePullGoogleButton'));
    calendar.querySelector('.admin-schedule-controls').append(tools);
    const calendarFooter=cards.get('calendar').querySelector('footer');calendarFooter.hidden=false;calendarFooter.innerHTML='<a href="schedule.html">Open full calendar →</a>';
    const sub=cards.get('subcontractors').querySelector('.dashboard-widget-body');sub.replaceChildren($('subcontractorActivityPanel'));$('subcontractorActivityPanel').open=false;const subRecent=document.createElement('div');subRecent.className='dashboard-sub-recent';sub.prepend(subRecent);$('subcontractorActivityPanel').querySelector('summary>span').textContent='View activity details';
    const empty=document.createElement('p');empty.id='dashboardEmpty';empty.className='dashboard-empty';empty.textContent='Your widgets are hidden. Open Widget Menu to restore them.';grid.append(empty);
    $('dashboardWidgetChoices').innerHTML=definitions.map(([id,title])=>`<label><input type="checkbox" value="${id}" checked>${title}${id==='jobs-stat'?' total':''}</label>`).join('');
    $('dashboardWidgetChoices').onchange=e=>{const item=layout.widgets.find(w=>w.id===e.target.value);if(item){item.visible=e.target.checked;changed();}};
    $('dashboardEdit').onclick=()=>{edit=!edit;apply();};
    $('dashboardMenuToggle').onclick=()=>{const open=$('dashboardMenu').hidden;$('dashboardMenu').hidden=!open;$('dashboardMenuToggle').setAttribute('aria-expanded',String(open));};
    $('dashboardReset').onclick=()=>{layout=defaults();changed();};
    $('dashboardRetrySave').onclick=()=>save();
    $('dashboardRefresh').onclick=()=>{void loadWidgets();void loadSubcontractorActivity();};
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!$('summarySection').hidden){e.preventDefault();e.stopImmediatePropagation();$('adminGlobalSearchInput').focus();}},true);
    let pointer=null;
    grid.addEventListener('pointerdown',e=>{
      const handle=e.target.closest('.dashboard-move,.dashboard-resize');if(!edit||!handle||e.button!==0)return;
      const card=handle.closest('[data-widget]'),item=layout.widgets.find(w=>w.id===card.dataset.widget);
      pointer={id:item.id,startX:e.clientX,startY:e.clientY,width:item.width,height:item.height,resize:handle.classList.contains('dashboard-resize'),target:null,handle};
      handle.setPointerCapture(e.pointerId);e.preventDefault();
    });
    grid.addEventListener('pointermove',e=>{
      if(!pointer)return;const card=cards.get(pointer.id);
      if(pointer.resize){
        const dx=e.clientX-pointer.startX,dy=e.clientY-pointer.startY,step=grid.clientWidth/12;
        const closest=(values,value)=>values.reduce((a,b)=>Math.abs(b-value)<Math.abs(a-value)?b:a);
        pointer.nextWidth=closest(widths,pointer.width+dx/step);pointer.nextHeight=closest(heights,pointer.height+dy);
        card.style.setProperty('--widget-width',pointer.nextWidth);card.style.setProperty('--widget-height',pointer.nextHeight+'px');
      }else{
        card.classList.add('is-dragging');
        cards.forEach(c=>c.classList.remove('is-drop-target'));
        const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-widget]');
        pointer.target=target&&target!==card?target.dataset.widget:null;if(pointer.target)target.classList.add('is-drop-target');
        if(e.clientY>innerHeight-70)window.scrollBy(0,18);else if(e.clientY<90)window.scrollBy(0,-18);
      }
    });
    function end(e){
      if(!pointer)return;const p=pointer;pointer=null;cards.forEach(c=>c.classList.remove('is-dragging','is-drop-target'));
      if(e.type==='pointercancel'){apply();return;}
      if(p.resize){const item=layout.widgets.find(w=>w.id===p.id);item.width=p.nextWidth||item.width;item.height=p.nextHeight||item.height;changed();}
      else if(p.target){const from=layout.widgets.findIndex(w=>w.id===p.id),to=layout.widgets.findIndex(w=>w.id===p.target);layout.widgets.splice(to,0,layout.widgets.splice(from,1)[0]);changed();}
      p.handle.focus();
    }
    grid.addEventListener('pointerup',end);grid.addEventListener('pointercancel',end);
    document.querySelectorAll('.dashboard-quick-actions a').forEach((a,i)=>a.insertAdjacentHTML('afterbegin',icon(['plus','file','calculator','briefcase'][i])));
    $('adminGlobalSearchButton').innerHTML=icon('search')+'<span>Search</span>';
    $('dashboardGreeting').insertAdjacentHTML('beforebegin','<span class="dashboard-greeting-icon">'+icon('sun')+'</span>');
    apply();
  }
  function fill(id,content,links=[]) {
    const card=cards.get(id);card.querySelector('.dashboard-widget-body').innerHTML=content;
    const footer=card.querySelector('.dashboard-widget-footer');footer.hidden=!links.length;
    footer.innerHTML=links.map(([text,href])=>`<a href="${esc(href)}">${esc(text)} →</a>`).join('');
  }
  function list(rows,empty) {
    return rows.length?'<ul class="dashboard-list">'+rows.slice(0,8).map(r=>`<li>${r.icon?`<span class="dashboard-row-icon">${icon(r.icon)}</span>`:''}<div><a href="${esc(r.href)}">${esc(r.title)}</a><small>${esc(r.detail)}</small></div>${r.badge?`<span class="dashboard-badge" data-tone="${r.badge==='Active'?'green':r.badge==='Draft'?'blue':'amber'}">${esc(r.badge)}</span>`:''}</li>`).join('')+'</ul>':`<p class="small">${esc(empty)}</p>`;
  }
  const metric=(count,label)=>`<div class="dashboard-metric"><strong>${esc(count)}</strong><span>${esc(label)}</span></div>`;
  async function rows(query){const result=await query;if(result.error)throw result.error;return result;}
  let workspacePromise;
  function workspace(){return workspacePromise ||= rows(supabaseClient.from('estimator_workspaces').select('payload').eq('id','main').maybeSingle()).then(r=>r.data?.payload||{});}
  async function loadWidgets(){
    if(!ready)return;const generation=++loadId;workspacePromise=null;$('dashboardRefresh').disabled=true;
    async function load(ids,action){try{await action(generation);}catch(_){if(generation===loadId)ids.forEach(id=>{const message='<p>Could not load this widget. Use Refresh to try again.</p>';if(id==='subcontractors')cards.get(id).querySelector('.dashboard-sub-recent').innerHTML=message;else fill(id,message);});}}
    await Promise.allSettled([
      load(['jobs-stat','active-jobs'],async()=>{
        let all=[];
        for(let offset=0;;offset+=500){const result=await rows(supabaseClient.from('jobs').select('id,job_number,job_name,customer,site_name,job_type,start_date').eq('active',true).order('job_number',{ascending:false}).order('id').range(offset,offset+499));all.push(...result.data);if(result.data.length<500)break;}
        if(generation!==loadId)return;
        const entries=all.map(j=>({title:j.job_number+' · '+(j.customer||'Client not entered'),detail:[j.job_name,j.site_name,j.job_type].filter(Boolean).join(' · '),badge:'Active',href:url('estimating/?view=jobs&job=',j.job_number)}));
        fill('jobs-stat',metric(all.length,'active jobs'),[['View all','estimating/?view=jobs']]);
        fill('active-jobs',list(entries,'No active jobs.'),[['View all','estimating/?view=jobs']]);
      }),
      load(['quotes','recent'],async()=>{
        const data=await workspace(),jobs=data.jobs||[],quotes=(data.quotes||[]).filter(q=>!q.jobId&&!jobs.some(j=>j.quoteId===q.id)).sort((a,b)=>String(b.updatedAt||b.quoteDate).localeCompare(String(a.updatedAt||a.quoteDate)));
        const entries=quotes.map(q=>({title:[q.number,(data.clients||[]).find(c=>c.id===q.clientId)?.name].filter(Boolean).join(' · '),detail:[q.project,q.status,date(q.updatedAt||q.quoteDate)].filter(Boolean).join(' · '),badge:q.status,href:url('estimating/?quote=',q.id)}));
        if(generation!==loadId)return;
        const links=[['View all','estimating/?view=quotes']];if(entries.length)links.push(['Open latest',entries[0].href]);
        fill('quotes',metric(quotes.length,'quotes')+list(entries,'No quotes yet.'),links);
        const activity=(data.activity||[]).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(a=>{const job=jobs.find(j=>j.quoteId===a.quoteId);return {title:a.title,detail:[a.detail,date(a.createdAt)].filter(Boolean).join(' · '),href:job?url('estimating/?view=jobs&job=',job.jobNumber):a.quoteId?url('estimating/?quote=',a.quoteId):'estimating/'};});
        const recentJobs=jobs.slice().sort((a,b)=>String(b.portalLastSyncedAt||b.acceptedAt||'').localeCompare(String(a.portalLastSyncedAt||a.acceptedAt||''))).map(j=>({title:[j.jobNumber,j.portalCustomer||(data.clients||[]).find(c=>c.id===j.clientId)?.name].filter(Boolean).join(' · '),detail:[j.portalJobName||j.project,j.status].filter(Boolean).join(' · '),href:url('estimating/?view=jobs&job=',j.jobNumber)}));
        fill('recent',`<div class="dashboard-recent-tabs"><button type="button" data-recent="quotes" aria-pressed="true">Quotes</button><button type="button" data-recent="jobs" aria-pressed="false">Jobs</button><button type="button" data-recent="activity" aria-pressed="false">Activity</button></div><div class="dashboard-recent-list">${list(entries,'No recent quotes.')}</div>`,links);
        cards.get('recent').querySelectorAll('[data-recent]').forEach(b=>b.onclick=()=>{cards.get('recent').querySelectorAll('[data-recent]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));cards.get('recent').querySelector('.dashboard-recent-list').innerHTML=list(b.dataset.recent==='quotes'?entries:b.dataset.recent==='jobs'?recentJobs:activity,'No recent activity.');const f=cards.get('recent').querySelector('.dashboard-widget-footer');const selected=b.dataset.recent==='quotes'?entries:b.dataset.recent==='jobs'?recentJobs:activity;f.innerHTML=`<a href="estimating/">View all →</a>${selected.length?`<a href="${esc(selected[0].href)}">Open latest →</a>`:''}`;});
      }),
      load(['work-orders'],async()=>{
        const result=await rows(supabaseClient.from('work_orders').select('id,wo_number,customer,job_name,status,updated_at',{count:'exact'}).neq('status','submitted').order('updated_at',{ascending:false}).limit(8));
        if(generation!==loadId)return;
        fill('work-orders',metric(result.count??result.data.length,'open work orders')+list(result.data.map(w=>({title:w.wo_number+' · '+(w.customer||w.job_name||''),detail:[w.job_name,w.status].filter(Boolean).join(' · '),href:url('work-orders.html?wo=',w.id)})),'No open work orders.'),[['View all','admin.html?tab=workOrders'],...(result.data.length?[['Open latest',url('work-orders.html?wo=',result.data[0].id)]]:[])]);
      }),
      load(['purchase-orders'],async()=>{
        const result=await rows(supabaseClient.from('digital_purchase_orders').select('id,po_number,supplier_name,job_number,workflow_status,updated_at',{count:'exact'}).not('workflow_status','in','(cancelled,closed)').order('updated_at',{ascending:false}).limit(8));
        if(generation!==loadId)return;
        const entries=result.data.map(p=>({title:'PO-'+p.po_number+' · '+(p.supplier_name||''),detail:[p.job_number,p.workflow_status].filter(Boolean).join(' · '),href:url('purchase-orders-admin.html?po=',p.id)}));
        const links=[['View all','purchase-orders-admin.html']];if(entries.length)links.push(['Open latest',entries[0].href]);
        fill('purchase-orders',metric(result.count??result.data.length,'open digital POs')+list(entries,'No open digital purchase orders.'),links);
      }),
      load(['subcontractors'],async()=>{
        const result=await rows(supabaseClient.from('subcontractor_portal_activity').select('id,company_name,contact_name,action,page,created_at').order('created_at',{ascending:false}).limit(6));
        if(generation!==loadId)return;
        cards.get('subcontractors').querySelector('.dashboard-sub-recent').innerHTML=list(result.data.map(a=>({title:a.company_name||a.contact_name||'Subcontractor',icon:'users',detail:[a.action,a.page,date(a.created_at)].filter(Boolean).join(' · '),href:'admin.html?tab=subcontractorsSuppliers'})),'No recent subcontractor activity.');
      }),
      load(['tasks'],async()=>{
        const result=await rows(supabaseClient.from('tasks').select('id,title,status,priority,due_date,job_number,assigned_to_name').not('status','in','(complete,archived)').order('due_date',{ascending:true,nullsFirst:false}).order('created_at',{ascending:false}).limit(8));
        if(generation!==loadId)return;
        fill('tasks',list(result.data.map(t=>({title:t.title,icon:'check',detail:[t.job_number,t.priority,t.due_date?'Due '+date(t.due_date):'No due date',t.assigned_to_name].filter(Boolean).join(' · '),href:'tasks.html'})),'No open tasks or follow-ups.'),[['View all','tasks.html']]);
      }),
      load(['announcements'],async()=>{
        const now=new Date().toISOString();
        const result=await rows(supabaseClient.from('announcements').select('id,title,body,created_at,expires_at').eq('is_active',true).or('expires_at.is.null,expires_at.gt.'+now).order('created_at',{ascending:false}).limit(8));
        if(generation!==loadId)return;
        fill('announcements',list(result.data.map(a=>({title:a.title,icon:'notice',detail:[String(a.body||'').slice(0,160),date(a.created_at)].filter(Boolean).join(' · '),href:'admin.html?tab=noticePolicy'})),'No current announcements.'),[['View all','admin.html?tab=noticePolicy']]);
      })
    ]);
    if(generation===loadId)$('dashboardRefresh').disabled=false;
  }
  setup();
  fill('estimate-desk','<p>Build quotes, review pricing and prepare customer proposals.</p>',[['Open Estimate Desk','estimating/']]);
  const name=String(worker.display||'').split(' ')[0],hour=new Date().getHours();
  $('dashboardGreeting').textContent='Good '+(hour<12?'morning':hour<17?'afternoon':'evening')+(name?', '+name:'');
  $('dashboardToday').textContent=new Date().toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  (async()=>{
    const identity=await supabaseClient.auth.getUser();if(identity.error||!identity.data?.user)throw new Error('Sign in to load your dashboard.');
    const access=await supabaseClient.rpc('is_admin');if(access.error||access.data!==true)throw new Error('Dashboard customization is available to approved admins.');
    userId=identity.data.user.id;
    let cached;try{cached=JSON.parse(localStorage.getItem(key())||'null');}catch(_){}
    if(cached?.layout)layout=normalize(cached.layout);
    let loadError=false;
    if(!cached?.pending){try{const result=await rows(supabaseClient.from('portal_dashboard_layouts').select('layout').eq('user_id',userId).maybeSingle());if(result.data?.layout)layout=normalize(result.data.layout);cache(false);}catch(_){loadError=true;}}
    ready=true;$('dashboardEdit').disabled=false;$('dashboardMenuToggle').disabled=false;apply();
    status(loadError?'Account layout unavailable. Showing your saved device layout or the JGC default.':'Your personal JGC layout.');
    if(cached?.pending){revision=1;void save();}
    void loadWidgets();
  })().catch(e=>status(e.message));
  window.addEventListener('storage',e=>{if(e.key==='jgc-job-list-revision'&&ready)void loadWidgets();});
  new MutationObserver(()=>{if(ready&&!$('summarySection').hidden)void loadWidgets();}).observe($('summarySection'),{attributes:true,attributeFilter:['hidden']});
  window.addEventListener('online',()=>{if(ready){void save();void loadWidgets();}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&ready&&!$('summarySection').hidden)void loadWidgets();});
  window.addEventListener('jgc-jobs-saved',()=>{if(ready)void loadWidgets();});
}());
