(function () {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const day=value=>new Date(value+'T12:00:00').toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'});
  const hours=value=>Number(value).toLocaleString('en-CA',{maximumFractionDigits:2});
  let dialog,body,refreshButton,sequence=0,loading=false,showMetric;
  function mount() {
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.className='dashboard-tm-dialog';dialog.id='tmWorkOrdersDialog';
    dialog.setAttribute('aria-labelledby','tmWorkOrdersTitle');
    dialog.innerHTML='<header><h2 id="tmWorkOrdersTitle">T&M Work Orders</h2><button type="button" class="jgc-button jgc-button--secondary" data-close>Close</button></header><p>Checked every Monday at 7:00 a.m. Toronto time for the previous Sunday–Saturday. Completed work orders drop off this list.</p><div data-content aria-live="polite"></div><button type="button" class="jgc-button jgc-button--secondary" data-refresh>Refresh</button>';
    document.body.append(dialog);body=dialog.querySelector('[data-content]');refreshButton=dialog.querySelector('[data-refresh]');
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    refreshButton.onclick=()=>void load(showMetric);
    body.addEventListener('click',async event=>{
      const button=event.target.closest('button[data-tm-exception]');
      if(!button||loading)return;
      loading=true;refreshButton.disabled=true;
      body.querySelectorAll('button[data-tm-exception]').forEach(b=>b.disabled=true);
      body.querySelector('[data-write-error]')?.remove();
      try {
        const result=await supabaseClient.rpc('set_tm_work_order_not_required',{
          p_job_id:button.dataset.job,p_work_date:button.dataset.date,p_not_required:button.dataset.tmException==='dismiss'
        });
        if(result.error)throw result.error;
        await load(showMetric);
      } catch(_) {
        button.insertAdjacentHTML('afterend','<p data-write-error role="alert">Could not save this change. Please try again.</p>');
      } finally {
        loading=false;refreshButton.disabled=false;
        body.querySelectorAll('button[data-tm-exception]').forEach(b=>b.disabled=false);
      }
    });
    document.addEventListener('click',event=>{
      if(!event.target.closest('a[href="#tm-work-orders"]'))return;
      event.preventDefault();if(!dialog.open)dialog.showModal();void load(showMetric);
    });
  }
  async function load(render) {
    showMetric=render;mount();
    const current=++sequence;loading=true;refreshButton.disabled=true;
    try {
      const result=await supabaseClient.rpc('get_tm_work_order_reminders');
      if(result.error)throw result.error;
      const data=result.data;
      if(!data||!Array.isArray(data.items)||!/^\d{4}-\d{2}-\d{2}$/.test(data.week_start))throw new Error('Unavailable');
      if(current!==sequence)return;
      const items=data.items;
      render(items.length,items.length?'need attention':'All caught up');
      body.innerHTML='<p class="dashboard-tm-period"><strong>'+esc(day(data.week_start))+' – '+esc(day(data.week_end))+'</strong></p>'+
        (items.length?items.map(item=>{
          const started=Boolean(item.work_order_id);
          const href=started?'work-orders.html?wo='+encodeURIComponent(item.work_order_id):'work-orders.html?tmJob='+encodeURIComponent(item.job_id)+'&tmDate='+encodeURIComponent(item.work_date);
          return '<section class="dashboard-tm-item"><h3>'+esc(item.job_number)+' · '+esc(item.job_name)+'</h3><p><strong>'+esc(day(item.work_date))+' · '+hours(item.hours)+' hours</strong></p><p>'+esc(started?'WO started — needs completion':'No completed work order')+'</p><ul>'+item.workers.map(worker=>'<li>'+esc(worker.name)+' <strong>'+hours(worker.hours)+' h</strong></li>').join('')+'</ul><div class="jgc-actions"><a class="jgc-button'+(started?' jgc-button--secondary':'')+'" href="'+esc(href)+'">'+(started?'Open WO':'Create WO')+'</a><button type="button" class="jgc-button jgc-button--secondary" data-tm-exception="dismiss" data-job="'+esc(item.job_id)+'" data-date="'+esc(item.work_date)+'">No WO needed</button></div></section>';
        }).join(''):'<p class="jgc-empty-state">All caught up. No outstanding T&M work orders for this week.</p>')+
        ((data.dismissed||[]).length?'<details><summary>No WO needed ('+data.dismissed.length+')</summary><p>These exceptions apply only to the job and date shown.</p>'+data.dismissed.map(item=>'<section class="dashboard-tm-item"><h3>'+esc(item.job_number)+' · '+esc(item.job_name)+'</h3><p>'+esc(day(item.work_date))+' · '+hours(item.hours)+' hours</p><button type="button" class="jgc-button jgc-button--secondary" data-tm-exception="undo" data-job="'+esc(item.job_id)+'" data-date="'+esc(item.work_date)+'">Undo</button></section>').join('')+'</details>':'')+
        '<p class="small">Hours captured '+esc(new Date(data.generated_at).toLocaleString('en-CA',{timeZone:'America/Toronto'}))+' Toronto time. Work order status updates when this list refreshes.</p>';
    } catch(_) {
      if(current!==sequence)return;
      render(null,'Unavailable');
      body.innerHTML='<p class="jgc-notice" role="alert">Could not check T&M work orders. Use Refresh to try again.</p>';
    } finally {if(current===sequence){loading=false;refreshButton.disabled=false;}}
  }
  window.JgcTmWorkOrders={load};
  // Update an open dashboard at the Monday boundary and after a WO is finished in another tab.
  setInterval(()=>{if(showMetric&&!loading&&!document.hidden&&!document.getElementById('summarySection')?.hidden)void load(showMetric);},60000);
}());
