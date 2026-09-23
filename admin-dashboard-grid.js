/* Independent widget coordinates. Heights and vertical positions are CSS pixels. */
(function (root) {
  'use strict';
  const gap=14, columns=12;
  const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
  function fit(item,placed){
    let next={...item};
    for(;;){const hits=placed.filter(other=>overlap(next,other));if(!hits.length)return next;next.y=Math.max(...hits.map(other=>other.y+other.height+gap));}
  }
  function pack(widgets){
    const placed=[];
    return widgets.map(item=>{
      if(!item.visible)return {...item,x:item.x||0,y:item.y||0};
      let next;
      if(Number.isFinite(item.x)&&Number.isFinite(item.y))next=fit({...item,x:Math.max(0,Math.min(columns-item.width,Math.round(item.x))),y:Math.max(0,Math.round(item.y))},placed);
      else {
        const candidates=[];
        for(let x=0;x<=columns-item.width;x++)candidates.push(fit({...item,x,y:0},placed));
        next=candidates.sort((a,b)=>a.y-b.y||a.x-b.x)[0];
      }
      placed.push(next);return next;
    });
  }
  function place(widgets,id,patch){
    const next=widgets.map(item=>item.id===id?{...item,...patch}: {...item});
    const pinned=next.find(item=>item.id===id);pinned.x=Math.max(0,Math.min(columns-pinned.width,Math.round(pinned.x)));pinned.y=Math.max(0,Math.round(pinned.y));
    const placed=pinned.visible?[pinned]:[];
    const others=next.filter(item=>item.id!==id&&item.visible).sort((a,b)=>a.y-b.y||a.x-b.x);
    for(const item of others){Object.assign(item,fit(item,placed));placed.push(item);}
    return next;
  }
  root.JgcDashboardGrid={gap,pack,place};
}(typeof window==='undefined'?globalThis:window));
