(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  // Approved desktop layout; explicit positions also define Reset to default.
  const definitions = [
    ['jobs-stat','Active Jobs',3,63,0,0], ['quotes','Quotes',3,61,3,0],
    ['work-orders','Work Orders',3,62,6,0], ['purchase-orders','Purchase Orders',3,62,9,0],
    ['vacation','Vacation Requests',4,62,0,77], ['equipment-expiry','Vehicle / Equipment Expiries',4,62,4,77], ['missing-timesheets','Missing Timesheets',4,62,8,77],
    ['calendar','Schedule Calendar',7,636,0,154],
    ['recent','Recent Work',5,299,7,156], ['active-jobs','Active Jobs',5,311,7,476],
    ['subcontractors','Subcontractor Activity',4,280,0,804], ['tasks','Tasks / Follow-Ups',4,280,4,804], ['announcements','Announcements',4,280,8,804]
  ];
  const widths = [2,3,4,5,6,7,8,9,10,11,12], heights = [44,144,280,313,408,456,640];
  const geometry=window.JgcDashboardGrid, statIds=["jobs-stat","quotes","work-orders","purchase-orders","vacation","equipment-expiry","missing-timesheets"];
  let selected="recent"; const toolbars=new Map();
  const minimumHeight=id=>statIds.includes(id)?44:id==='calendar'?280:144;
  const defaults = () => ({version:2, widgets:geometry.pack(definitions.map(([id,,width,height,x,y]) => ({id,width,height,x,y,visible:true})))});
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
    plus:'<path d="M12 5v14M5 12h14"/>',
    plane:'<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    truck:'<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    clipboard:'<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h4"/>'
  };
  const icon=key=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[key]||iconPaths.briefcase}</svg>`;
  const widgetIcons={'jobs-stat':'briefcase',quotes:'file','work-orders':'wrench','purchase-orders':'cart','estimate-desk':'calculator',calendar:'calendar',recent:'clock','active-jobs':'briefcase',subcontractors:'users',tasks:'check',announcements:'notice',vacation:'plane','equipment-expiry':'truck','missing-timesheets':'clipboard'};
  function normalize(value) {
    const result=defaults(), supplied=Array.isArray(value?.widgets) ? value.widgets : [];
    const seen=new Set(), ordered=[];
    for (const raw of supplied) {
      const item=result.widgets.find(w=>w.id===raw?.id);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id); ordered.push({...item,width:widths.includes(raw.width)?raw.width:item.width,height:Number.isInteger(raw.height)&&raw.height>=minimumHeight(item.id)&&raw.height<=960?raw.height:item.height,visible:raw.visible!==false,x:value.version===2&&Number.isInteger(raw.x)&&raw.x>=0&&raw.x<=12?raw.x:undefined,y:value.version===2&&Number.isInteger(raw.y)&&raw.y>=0&&raw.y<=20000?raw.y:undefined});
    }
    return {version:2,widgets:geometry.pack(ordered.concat(result.widgets.filter(w=>!seen.has(w.id)).map(w=>({...w,x:undefined,y:undefined}))))};
  }
  const key = () => 'jgcDashboardLayout:v1:'+userId;
  const status = text => $('dashboardLayoutStatus').textContent=text;
  function cache(pending) { try {localStorage.setItem(key(),JSON.stringify({layout,pending}));} catch (_) { /* Account storage remains authoritative. */ } }
  function renderPositions(widgets) {
    for(const item of widgets){const card=cards.get(item.id);card.style.setProperty('--widget-x',item.x+1);card.style.setProperty('--widget-y',item.y+1);card.style.setProperty('--widget-width',item.width);card.style.setProperty('--widget-height',item.height+'px');card.style.setProperty('--widget-rows',item.height);}
  }
  function selectWidget(id){selected=id;edit=true;apply();}
  function adjust(id,patch){layout.widgets=geometry.place(layout.widgets,id,patch);changed();}
  function apply() {
    renderPositions(layout.widgets);
    $('dashboardGrid').classList.toggle('is-editing',edit);
    $('dashboardLayoutControls').hidden=!edit;
    $('dashboardSelectedTitle').textContent=definitions.find(d=>d[0]===selected)?.[1]||'Select a widget';
    for (const item of layout.widgets) {
      const card=cards.get(item.id); card.hidden=!item.visible;
      card.style.setProperty('--widget-width',item.width); card.style.setProperty('--widget-height',item.height+'px');
      card.dataset.wide=String(item.width>=8); card.dataset.compact=String(item.height<=144);card.dataset.slim=String(item.height<100);card.classList.toggle('is-selected',edit&&selected===item.id);
      const tools=toolbars.get(item.id); tools.querySelector('[data-size="width"]').value=item.width;
      const heightSelect=tools.querySelector('[data-size="height"]');
      heightSelect.querySelectorAll('[data-custom]').forEach(o=>o.remove());
      if(![...heightSelect.options].some(o=>Number(o.value)===item.height)){const o=new Option(item.height+' px',item.height);o.dataset.custom='true';heightSelect.add(o);}
      heightSelect.value=item.height;tools.hidden=!edit||selected!==item.id;
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
    layout.widgets=geometry.pack(layout.widgets);revision++; cache(true); apply(); status('Saving your layout…');
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
    const item=layout.widgets.find(w=>w.id===id);
    if(innerWidth<=650){const visible=layout.widgets.filter(w=>w.visible),other=visible[visible.indexOf(item)+delta];if(other){const a=layout.widgets.indexOf(item),b=layout.widgets.indexOf(other);[layout.widgets[a],layout.widgets[b]]=[layout.widgets[b],layout.widgets[a]];changed();}}
    else adjust(id,{y:Math.max(0,item.y+delta*80)});
    toolbars.get(id).querySelector('.dashboard-move').focus();
  }
  function stackCalendar(){
    const calendar=layout.widgets.find(w=>w.id==='calendar'),recent=layout.widgets.find(w=>w.id==='recent'),jobs=layout.widgets.find(w=>w.id==='active-jobs');
    const y=calendar.y,height=Math.max(456,calendar.height),top=Math.floor((height-geometry.gap)/2);
    const group=[{...calendar,x:0,y,width:6,height,visible:true},{...recent,x:6,y,width:6,height:top,visible:true},{...jobs,x:6,y:y+top+geometry.gap,width:6,height:height-top-geometry.gap,visible:true}];
    const packed=geometry.pack([...group,...layout.widgets.filter(w=>!group.some(g=>g.id===w.id))]);
    layout.widgets=layout.widgets.map(w=>packed.find(p=>p.id===w.id));
    selected='recent';changed();
  }
  function setup() {
    const commandbar=document.createElement('div');commandbar.className='dashboard-commandbar';
    const search=document.querySelector('#summarySection .admin-global-search');search.before(commandbar);commandbar.append(search,document.querySelector('.dashboard-quick-actions'));
    const panel=document.createElement('div');panel.id='dashboardLayoutControls';panel.className='dashboard-layout-controls';panel.hidden=true;
    panel.innerHTML='<div class="dashboard-layout-presets"><strong id="dashboardSelectedTitle">Recent Work</strong><button type="button" id="dashboardDoneEditing">Done editing</button><button type="button" id="dashboardStackCalendar">Calendar + stacked Recent Work / Active Jobs</button><button type="button" id="dashboardSlimTotals">Make all totals slim</button></div><p class="small">Drag a card by its heading. Drop in the outlined position. Drag its bottom-right corner to resize. Escape cancels a drag.</p>';
    $('summarySection').append(panel);
    const grid=document.createElement('div');grid.id='dashboardGrid';grid.className='dashboard-grid';$('summarySection').append(grid);
    for(const [id,title,width,height] of definitions){
      const card=document.createElement('section');card.className='dashboard-widget';card.dataset.widget=id;card.setAttribute('aria-label',title);
      card.innerHTML=`<header class="dashboard-widget-header"><h2><span class="dashboard-icon">${icon(widgetIcons[id])}</span><span>${title}</span></h2><button class="dashboard-widget-options" type="button" aria-label="Customize ${title}" title="Customize widget">⋮</button></header><div class="dashboard-edit-tools" hidden><button type="button" class="dashboard-move" aria-label="Move ${title}" title="Focus here and use arrow keys to move">⠿ Move with keys</button><button type="button" data-move="-1" aria-label="Move ${title} earlier">↑</button><button type="button" data-move="1" aria-label="Move ${title} later">↓</button><label>Width<select data-size="width" aria-label="${title} width">${widths.map((n,i)=>`<option value="${n}">${({2:'Small',4:'Third',6:'Half',8:'Wide',12:'Full'})[n]||n+' columns'}</option>`).join('')}</select></label><label>Height<select data-size="height" aria-label="${title} height">${heights.filter(n=>n>=minimumHeight(id)).map(n=>`<option value="${n}">${({44:'Slim',144:'Compact',280:'Short',313:'Half of tall',408:'Standard',456:'Medium',640:'Tall'})[n]}</option>`).join('')}</select></label><button type="button" data-half aria-label="Halve ${title} height">Half height</button><button type="button" data-hide aria-label="Hide ${title}">Hide</button></div><div class="dashboard-widget-body"><p>Loading…</p></div><footer class="dashboard-widget-footer" hidden></footer><button type="button" class="dashboard-resize" hidden aria-label="Resize ${title}" title="Drag to resize; arrow keys adjust width and height">↘</button>`;
      cards.set(id,card);grid.append(card);const tools=card.querySelector('.dashboard-edit-tools');tools.dataset.widgetControls=id;toolbars.set(id,tools);panel.append(tools);
      card.querySelector('.dashboard-widget-options').onclick=()=>{if(!ready)return;selectWidget(id);toolbars.get(id).querySelector('.dashboard-move').focus();};
      tools.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>move(id,Number(b.dataset.move)));
      tools.querySelector('[data-hide]').onclick=()=>{layout.widgets.find(w=>w.id===id).visible=false;changed();$('jgcAppearanceSettingsButton').focus();};
      tools.querySelectorAll('[data-size]').forEach(s=>s.onchange=()=>adjust(id,{[s.dataset.size]:Number(s.value)}));
      tools.querySelector('[data-half]').onclick=()=>adjust(id,{height:Math.max(minimumHeight(id),Math.floor((layout.widgets.find(w=>w.id===id).height-geometry.gap)/2))});
      tools.querySelector('.dashboard-move').onkeydown=e=>{if(['ArrowUp','ArrowLeft','ArrowDown','ArrowRight'].includes(e.key)){e.preventDefault();const item=layout.widgets.find(w=>w.id===id);adjust(id,['ArrowLeft','ArrowRight'].includes(e.key)?{x:item.x+(e.key==='ArrowLeft'?-1:1)}:{y:Math.max(0,item.y+(e.key==='ArrowUp'?-80:80))});}};
      card.querySelector('.dashboard-resize').onkeydown=e=>{
        if(!['ArrowUp','ArrowLeft','ArrowDown','ArrowRight'].includes(e.key))return;e.preventDefault();
        const item=layout.widgets.find(w=>w.id===id),horizontal=['ArrowLeft','ArrowRight'].includes(e.key),sizes=horizontal?widths:heights,field=horizontal?'width':'height';
        adjust(id,horizontal?{width:Math.max(2,Math.min(12,item.width+(e.key==='ArrowLeft'?-2:2)))}:{height:Math.max(minimumHeight(id),Math.min(960,item.height+(e.key==='ArrowUp'?-40:40)))});
      };
    }
    const calendar=cards.get('calendar').querySelector('.dashboard-widget-body');calendar.replaceChildren(document.querySelector('.admin-schedule-summary'));const tools=document.createElement('details');tools.className='dashboard-calendar-tools';tools.innerHTML='<summary>Calendar tools</summary><div></div>';
    tools.querySelector('div').append($('adminScheduleSyncAllButton'),$('adminSchedulePullGoogleButton'));
    calendar.querySelector('.admin-schedule-controls').append(tools);
    const calendarFooter=cards.get('calendar').querySelector('footer');calendarFooter.hidden=false;calendarFooter.innerHTML='<a href="schedule.html">Open full calendar →</a>';
    const sub=cards.get('subcontractors').querySelector('.dashboard-widget-body');sub.replaceChildren($('subcontractorActivityPanel'));$('subcontractorActivityPanel').open=false;const subRecent=document.createElement('div');subRecent.className='dashboard-sub-recent';sub.prepend(subRecent);$('subcontractorActivityPanel').querySelector('summary>span').textContent='View activity details';
    const empty=document.createElement('p');empty.id='dashboardEmpty';empty.className='dashboard-empty';empty.textContent='Your widgets are hidden. Open the gear settings, then Widget Menu, to restore them.';grid.append(empty);
    $('dashboardWidgetChoices').innerHTML=definitions.map(([id,title])=>`<label><input type="checkbox" value="${id}" checked>${title}${id==='jobs-stat'?' total':''}</label>`).join('');
    $('dashboardWidgetChoices').onchange=e=>{const item=layout.widgets.find(w=>w.id===e.target.value);if(item){item.visible=e.target.checked;changed();}};
    $('dashboardEdit').onclick=()=>{edit=!edit;apply();window.JGCAppearanceSettings?.close();(edit?$('dashboardDoneEditing'):$('jgcAppearanceSettingsButton')).focus();};
    $('dashboardDoneEditing').onclick=()=>{edit=false;apply();$('jgcAppearanceSettingsButton').focus();};
    $('dashboardMenuToggle').onclick=()=>{const open=$('dashboardMenu').hidden;$('dashboardMenu').hidden=!open;$('dashboardMenuToggle').setAttribute('aria-expanded',String(open));};
    $('dashboardReset').onclick=()=>{layout=defaults();changed();};
    $('dashboardStackCalendar').onclick=stackCalendar;
    $('dashboardSlimTotals').onclick=()=>{layout.widgets=layout.widgets.map(w=>({...w,height:statIds.includes(w.id)?44:w.height}));changed();};
    $('dashboardRetrySave').onclick=()=>save();
    $('dashboardRefresh').onclick=()=>{void loadWidgets();void loadSubcontractorActivity();};
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!$('summarySection').hidden){e.preventDefault();e.stopImmediatePropagation();$('adminGlobalSearchInput').focus();}},true);
    let pointer=null;
    const surface=$('summarySection');
    const preview=document.createElement('div');preview.className='dashboard-drop-preview';preview.hidden=true;preview.setAttribute('aria-hidden','true');grid.append(preview);
    surface.addEventListener('pointerdown',e=>{
      const handle=e.target.closest('.dashboard-resize,.dashboard-widget-header');
      if(!ready||!edit||!handle||e.button!==0||e.target.closest('.dashboard-widget-options,a')||innerWidth<=650)return;
      const id=handle.closest('[data-widget]')?.dataset.widget||handle.closest('[data-widget-controls]')?.dataset.widgetControls;
      const item=layout.widgets.find(w=>w.id===id);selected=id;
      // Keep the captured element attached during a gesture; apply() reparents cards only after release.
      const rect=grid.getBoundingClientRect();
      pointer={id,startX:e.clientX,startY:e.clientY,scrollY:window.scrollY,item:{...item},original:structuredClone(layout.widgets),resize:handle.classList.contains('dashboard-resize'),handle,pointerId:e.pointerId,step:(rect.width+14)/12};
      handle.setPointerCapture(e.pointerId);e.preventDefault();
    });
    surface.addEventListener('pointermove',e=>{
      if(!pointer)return;const p=pointer,dx=e.clientX-p.startX,dy=e.clientY-p.startY+window.scrollY-p.scrollY;
      if(!p.moved&&Math.abs(dx)+Math.abs(dy)<4)return;p.moved=true;
      const patch=p.resize?{width:Math.max(2,Math.min(12,Math.round(p.item.width+dx/p.step))),height:Math.max(minimumHeight(p.id),Math.min(960,Math.round(p.item.height+dy)))}:{x:Math.round(p.item.x+dx/p.step),y:Math.max(0,Math.round((p.item.y+dy)/8)*8)};
      p.next=geometry.place(p.original,p.id,patch);renderPositions(p.next);
      const target=p.next.find(w=>w.id===p.id);preview.hidden=false;preview.style.gridColumn=(target.x+1)+' / span '+target.width;preview.style.gridRow=(target.y+1)+' / span '+target.height;
      cards.get(p.id).classList.add('is-dragging');
      if(e.clientY>innerHeight-60)window.scrollBy(0,16);else if(e.clientY<70)window.scrollBy(0,-16);
    });
    function end(e){
      if(!pointer)return;const p=pointer;pointer=null;preview.hidden=true;cards.get(p.id).classList.remove('is-dragging');
      if(p.handle.hasPointerCapture(p.pointerId))p.handle.releasePointerCapture(p.pointerId);
      if(e.type==='pointerup'&&p.next){layout.widgets=p.next;changed();}else apply();
    }
    surface.addEventListener('pointerup',end);surface.addEventListener('pointercancel',end);surface.addEventListener('lostpointercapture',end);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&pointer){e.preventDefault();end(e);}});
    window.addEventListener('resize',()=>{if(pointer)end({type:'cancel'});});
    document.querySelectorAll('.dashboard-quick-actions a').forEach((a,i)=>a.insertAdjacentHTML('afterbegin',icon(['calculator','plus','file','briefcase'][i])));
    $('adminGlobalSearchButton').innerHTML=icon('search')+'<span>Search</span>';
    $('dashboardGreeting').insertAdjacentHTML('beforebegin','<span class="dashboard-greeting-icon">'+icon('sun')+'</span>');
    apply();
  }
  function fill(id,content,links=[]) {
    const card=cards.get(id);card.querySelector('.dashboard-widget-body').innerHTML=content;
    if(statIds.includes(id)&&links.length)card.querySelector('h2>span:last-child').innerHTML=`<a href="${esc(links[0][1])}">${esc(definitions.find(d=>d[0]===id)[1])}</a>`;
    const footer=card.querySelector('.dashboard-widget-footer');footer.hidden=!links.length;
    footer.innerHTML=links.map(([text,href])=>`<a href="${esc(href)}">${esc(text)} →</a>`).join('');
  }
  function list(rows,empty) {
    return rows.length?'<ul class="dashboard-list">'+rows.slice(0,8).map(r=>`<li>${r.icon?`<span class="dashboard-row-icon">${icon(r.icon)}</span>`:''}<div><a href="${esc(r.href)}">${esc(r.title)}</a><small>${esc(r.detail)}</small></div>${r.badge?`<span class="dashboard-badge" data-tone="${r.badge==='Active'?'green':r.badge==='Draft'?'blue':'amber'}">${esc(r.badge)}</span>`:''}</li>`).join('')+'</ul>':`<p class="small">${esc(empty)}</p>`;
  }
  const metric=(count,label,href,alert)=>{const inner=`<strong>${esc(count)}</strong><span>${esc(label)}</span>${alert?`<span class="dashboard-metric-alert">${esc(alert)}</span>`:''}`;return href?`<a class="dashboard-metric" href="${esc(href)}" aria-label="${esc(count+' '+label+(alert?', '+alert:''))}">${inner}</a>`:`<div class="dashboard-metric">${inner}</div>`;};
  // Calendar-day helpers shared with Accounting: Toronto dates, bi-weekly pay periods anchored on 2026-08-20.
  const PAY_DATE_ANCHOR='2026-08-20', WEEKDAYS=['Monday','Tuesday','Wednesday','Thursday','Friday'];
  const utcDay=value=>{const [y,m,d]=String(value).slice(0,10).split('-').map(Number);return new Date(Date.UTC(y,m-1,d,12));};
  const addDays=(value,days)=>{const d=utcDay(value);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
  const daysBetween=(from,to)=>Math.round((utcDay(to)-utcDay(from))/86400000);
  const torontoToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  function lastCompletedPayPeriod(){
    // A period's second week ends 5 days before pay day; it is complete once that Saturday has passed.
    const today=torontoToday(),payDate=addDays(PAY_DATE_ANCHOR,Math.floor(daysBetween(PAY_DATE_ANCHOR,addDays(today,4))/14)*14);
    return {payDate,weekStarts:[addDays(payDate,-18),addDays(payDate,-11)],end:addDays(payDate,-5)};
  }
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
        fill('jobs-stat',metric(all.length,'active jobs','estimating/?view=jobs'),[['View all','estimating/?view=jobs']]);
        fill('active-jobs',list(entries,'No active jobs.'),[['View all','estimating/?view=jobs']]);
      }),
      load(['quotes','recent'],async()=>{
        const data=await workspace(),jobs=data.jobs||[],quotes=(data.quotes||[]).filter(q=>!q.jobId&&!jobs.some(j=>j.quoteId===q.id)).sort((a,b)=>String(b.updatedAt||b.quoteDate).localeCompare(String(a.updatedAt||a.quoteDate)));
        const entries=quotes.map(q=>({title:[q.number,(data.clients||[]).find(c=>c.id===q.clientId)?.name].filter(Boolean).join(' · '),detail:[q.project,q.status,date(q.updatedAt||q.quoteDate)].filter(Boolean).join(' · '),badge:q.status,href:url('estimating/?quote=',q.id)}));
        if(generation!==loadId)return;
        const links=[['View all','estimating/?view=quotes']];if(entries.length)links.push(['Open latest',entries[0].href]);
        fill('quotes',metric(quotes.length,'quotes','estimating/?view=quotes')+list(entries,'No quotes yet.'),links);
        const activity=(data.activity||[]).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(a=>{const job=jobs.find(j=>j.quoteId===a.quoteId);return {title:a.title,detail:[a.detail,date(a.createdAt)].filter(Boolean).join(' · '),href:job?url('estimating/?view=jobs&job=',job.jobNumber):a.quoteId?url('estimating/?quote=',a.quoteId):'estimating/'};});
        const recentJobs=jobs.slice().sort((a,b)=>String(b.portalLastSyncedAt||b.acceptedAt||'').localeCompare(String(a.portalLastSyncedAt||a.acceptedAt||''))).map(j=>({title:[j.jobNumber,j.portalCustomer||(data.clients||[]).find(c=>c.id===j.clientId)?.name].filter(Boolean).join(' · '),detail:[j.portalJobName||j.project,j.status].filter(Boolean).join(' · '),href:url('estimating/?view=jobs&job=',j.jobNumber)}));
        fill('recent',`<div class="dashboard-recent-tabs"><button type="button" data-recent="quotes" aria-pressed="true">Quotes</button><button type="button" data-recent="jobs" aria-pressed="false">Jobs</button><button type="button" data-recent="activity" aria-pressed="false">Activity</button></div><div class="dashboard-recent-list">${list(entries,'No recent quotes.')}</div>`,links);
        cards.get('recent').querySelectorAll('[data-recent]').forEach(b=>b.onclick=()=>{cards.get('recent').querySelectorAll('[data-recent]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));cards.get('recent').querySelector('.dashboard-recent-list').innerHTML=list(b.dataset.recent==='quotes'?entries:b.dataset.recent==='jobs'?recentJobs:activity,'No recent activity.');const f=cards.get('recent').querySelector('.dashboard-widget-footer');const selected=b.dataset.recent==='quotes'?entries:b.dataset.recent==='jobs'?recentJobs:activity;f.innerHTML=`<a href="estimating/">View all →</a>${selected.length?`<a href="${esc(selected[0].href)}">Open latest →</a>`:''}`;});
      }),
      load(['work-orders'],async()=>{
        const result=await rows(supabaseClient.from('work_orders').select('id,wo_number,customer,job_name,status,updated_at',{count:'exact'}).neq('status','submitted').order('updated_at',{ascending:false}).limit(8));
        if(generation!==loadId)return;
        fill('work-orders',metric(result.count??result.data.length,'open work orders','admin.html?tab=workOrders')+list(result.data.map(w=>({title:w.wo_number+' · '+(w.customer||w.job_name||''),detail:[w.job_name,w.status].filter(Boolean).join(' · '),href:url('work-orders.html?wo=',w.id)})),'No open work orders.'),[['View all','admin.html?tab=workOrders'],...(result.data.length?[['Open latest',url('work-orders.html?wo=',result.data[0].id)]]:[])]);
      }),
      load(['purchase-orders'],async()=>{
        const result=await rows(supabaseClient.from('digital_purchase_orders').select('id,po_number,supplier_name,job_number,workflow_status,updated_at',{count:'exact'}).not('workflow_status','in','(cancelled,closed)').order('updated_at',{ascending:false}).limit(8));
        if(generation!==loadId)return;
        const entries=result.data.map(p=>({title:'PO-'+p.po_number+' · '+(p.supplier_name||''),detail:[p.job_number,p.workflow_status].filter(Boolean).join(' · '),href:url('purchase-orders-admin.html?po=',p.id)}));
        const links=[['View all','purchase-orders-admin.html']];if(entries.length)links.push(['Open latest',entries[0].href]);
        fill('purchase-orders',metric(result.count??result.data.length,'open digital POs','purchase-orders-admin.html')+list(entries,'No open digital purchase orders.'),links);
      }),
      load(['vacation'],async()=>{
        // Same rule as the Vacation tab: a missing status counts as pending.
        const result=await rows(supabaseClient.from('vacation_requests').select('id,worker_display_name,worker_name,start_date,end_date,request_type,status,created_at').or('status.is.null,status.ilike.pending').order('start_date',{ascending:true}));
        if(generation!==loadId)return;
        const href='admin.html?tab=vacation';
        fill('vacation',metric(result.data.length,'awaiting approval',href)+list(result.data.map(r=>({title:r.worker_display_name||r.worker_name||'Employee',icon:'plane',detail:[r.start_date&&r.end_date&&r.end_date!==r.start_date?date(r.start_date)+' – '+date(r.end_date):date(r.start_date),String(r.request_type||'').replace(/_/g,' ')].filter(Boolean).join(' · '),href})),'No vacation requests awaiting approval.'),[['Review requests',href]]);
      }),
      load(['equipment-expiry'],async()=>{
        // Mirrors the Equipment tab's 30-day expiry notices; already-expired items are flagged separately.
        const today=torontoToday(),href='admin.html?tab=equipment';
        const result=await rows(supabaseClient.from('equipment_vehicles').select('id,name,unit_number,identification_number,yearly_inspection_expiry').eq('is_active',true).not('yearly_inspection_expiry','is',null).lte('yearly_inspection_expiry',addDays(today,30)).order('yearly_inspection_expiry',{ascending:true}));
        if(generation!==loadId)return;
        const items=result.data.map(e=>({...e,days:daysBetween(today,e.yearly_inspection_expiry)}));
        const expiring=items.filter(e=>e.days>=0),expired=items.filter(e=>e.days<0);
        const entries=expiring.concat(expired).map(e=>({title:[e.name,e.unit_number||e.identification_number].filter(Boolean).join(' · '),icon:'truck',detail:e.days<0?'Expired '+date(e.yearly_inspection_expiry):'Expires '+date(e.yearly_inspection_expiry)+' · '+(e.days===0?'today':e.days+' day'+(e.days===1?'':'s')),badge:e.days<0?'Expired':'',href}));
        fill('equipment-expiry',metric(expiring.length,'expiring in 30 days',href,expired.length?expired.length+' expired':'')+list(entries,'Nothing expires in the next 30 days.'),[['Open Equipment',href]]);
      }),
      load(['missing-timesheets'],async()=>{
        // Same rule Accounting uses to block Final & Lock, applied to the last completed pay period only.
        const period=lastCompletedPayPeriod(),href='accounting-admin.html?payDate='+period.payDate;
        const [profiles,workers,access,submissions,live]=await Promise.all([
          rows(supabaseClient.from('profiles').select('id,display_name,hire_date').order('display_name')),
          rows(supabaseClient.from('work_order_labour_workers').select('id,profile_id,approved')),
          rows(supabaseClient.from('employee_feature_access').select('worker_id,feature_key,enabled').eq('feature_key','accounting')),
          rows(supabaseClient.from('accounting_timesheet_submissions').select('profile_id,week_start').in('week_start',period.weekStarts)),
          rows(supabaseClient.from('timesheet_entries').select('profile_id,week_start,day_of_week').in('week_start',period.weekStarts))
        ]);
        if(generation!==loadId)return;
        const enabled=new Set(access.data.filter(a=>a.enabled!==false).map(a=>a.worker_id));
        const included=new Set(workers.data.filter(w=>w.profile_id&&w.approved!==false&&enabled.has(w.id)).map(w=>w.profile_id));
        const submitted=new Set(submissions.data.map(s=>s.profile_id+'|'+String(s.week_start).slice(0,10)));
        const dayIndex=['Sunday',...WEEKDAYS,'Saturday'];
        const missing=[];
        for(const profile of profiles.data.filter(p=>included.has(p.id)))for(const weekStart of period.weekStarts){
          const hire=String(profile.hire_date||'').slice(0,10);
          const required=WEEKDAYS.filter((_,i)=>!hire||addDays(weekStart,i+1)>=hire);
          const entered=live.data.some(e=>e.profile_id===profile.id&&String(e.week_start).slice(0,10)===weekStart&&(!hire||addDays(weekStart,dayIndex.indexOf(e.day_of_week))>=hire));
          if((required.length||entered)&&!submitted.has(profile.id+'|'+weekStart))missing.push({profile,weekStart});
        }
        fill('missing-timesheets',metric(missing.length,'missing, pay period ending '+date(period.end),href)+list(missing.map(m=>({title:m.profile.display_name||'Employee',icon:'clipboard',detail:'Week of '+date(m.weekStart),href})),'All timesheets for the pay period ending '+date(period.end)+' are submitted.'),[['Open Accounting',href]]);
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
  function mountDashboardSettings() {
    const body=document.querySelector('#jgcAppearanceSettingsPanel .jgc-appearance-settings__body');
    if(!body)return;
    body.append($('dashboardSettings'));
    const sync=()=>{
      const summaryVisible=!$('summarySection').hidden;
      $('dashboardSettings').hidden=!summaryVisible;
      $('jgcAppearanceSettingsTitle').textContent=summaryVisible?'Appearance & layout':'Appearance';
    };
    sync();
    new MutationObserver(sync).observe($('summarySection'),{attributes:true,attributeFilter:['hidden']});
  }
  setup();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountDashboardSettings,{once:true});else mountDashboardSettings();
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
