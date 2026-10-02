import { REVIEW_STATUSES, type ReviewStamp } from '../lib/drawing-model';
const paths: Record<string,string> = {
  select:'M5 3l14 10-7 1-3 7z',hand:'M7 12V7a2 2 0 014 0v4-1-6a2 2 0 014 0v6-1-5a2 2 0 014 0v8c0 5-2 8-6 8h-1c-2 0-4-2-6-5l-2-3a2 2 0 013-2l2 2',
  pen:'M4 20l1-5L16 4l4 4L9 19zM13 7l4 4',line:'M4 19L20 5M4 16v4h4M16 4h4v4',rectangle:'M4 5h16v14H4z',highlight:'M7 15L16 4l5 4-9 11zM4 21h15',text:'M4 5h16M12 5v15M8 20h8',
  calibrate:'M3 8l13-5 5 13-13 5zM8 7l2 4M12 5l2 4M16 9l4-2M17 13l4-2',distance:'M3 12h18M3 8v8M21 8v8M6 9l-3 3 3 3M18 9l3 3-3 3',area:'M4 4h16v16H4zM4 4l16 16M4 12l8 8M12 4l8 8',perimeter:'M4 4h16v16H4zM1 1h5M1 1v5M23 23h-5M23 23v-5',
  stamp:'M7 14v-3l3-3V5a2 2 0 014 0v3l3 3v3M5 14h14v5H5zM3 22h18',callout:'M4 18l6-7M3 14v5h5M9 3h12v9H9z',comments:'M3 3h18v14H9l-6 4zM7 7h10M7 11h7',edit:'M4 20l1-5L16 4l4 4L9 19z',organize:'M3 3h7v8H3zM14 3h7v8h-7zM3 15h7v6H3zM14 15h7v6h-7z',navigate:'M3 3h7v18H3zM14 3h7v18h-7z',measure:'M3 7l4-4 14 14-4 4zM8 6l-2 2M12 10l-2 2M16 14l-2 2',
  pages:'M7 3h12v15H7zM4 6v15h12',undo:'M8 4L3 9l5 5M3 9h11a6 6 0 010 12',redo:'M16 4l5 5-5 5M21 9H10a6 6 0 000 12',download:'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',snap:'M5 3v9a7 7 0 0014 0V3h-4v9a3 3 0 01-6 0V3z',fullscreen:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',exit:'M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5',rotate:'M20 8V3l-4 4M20 8a9 9 0 10-1 10',fit:'M3 3h18v18H3zM7 12h10M7 9v6M17 9v6',combine:'M3 4h7v16H3zM14 4h7v16h-7zM10 12h4',
};
export function DrawingIcon({name}:{name:string}) {return <svg className="drawing-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]??paths.select}/></svg>;}
export function ReviewStampGraphic({stamp}:{stamp:ReviewStamp}) {
  return <svg className="drawing-stamp-graphic" viewBox="0 0 350 222" width="350" height="222" aria-hidden="true">
    <rect x=".75" y=".75" width="348.5" height="220.5" fill="white" stroke="#b31a1f" strokeWidth="1.5"/><path d="M1 1h348v57H1z" fill="#b31a1f"/>
    <g fill="white" fontFamily="Arial,sans-serif" fontWeight="700" textAnchor="middle"><text x="175" y="26" fontSize="16">JOHN GORDON CONSTRUCTION</text><text x="175" y="45" fontSize="12">SHOP DRAWING REVIEW</text></g>
    {REVIEW_STATUSES.map((status,i)=><g key={status} fill="#b31a1f" fontFamily="Arial,sans-serif"><rect x="18" y={72+i*25} width="14" height="14" fill="none" stroke="#b31a1f"/>{stamp.status===status&&<path d={`M20 ${80+i*25}l4 4 6-10`} fill="none" stroke="#b31a1f" strokeWidth="1.7"/>}<text x="44" y={85+i*25} fontSize="14">{status.toUpperCase()}</text></g>)}
    <path d="M0 169h350" stroke="#b31a1f"/>
    <g fill="#b31a1f" fontFamily="Arial,sans-serif"><text x="16" y="187" fontSize="10">REVIEWED BY:</text><text x="106" y="187" fontSize="11" textLength={stamp.reviewer.length>34?230:undefined} lengthAdjust="spacingAndGlyphs">{stamp.reviewer||'Not entered'}</text><text x="16" y="207" fontSize="10">DATE:</text><text x="61" y="207" fontSize="11">{stamp.date}</text></g>
  </svg>;
}
export function StampFields({value,onChange,prefix='Stamp',disabled=false}:{value:ReviewStamp;onChange:(next:ReviewStamp)=>void;prefix?:string;disabled?:boolean}) {
  return <fieldset className="drawing-stamp-fields" disabled={disabled}><legend>JGC shop drawing review</legend><label>Review status<select aria-label={`${prefix} review status`} value={value.status} onChange={e=>onChange({...value,status:e.target.value as ReviewStamp['status']})}>{REVIEW_STATUSES.map(status=><option key={status}>{status}</option>)}</select></label><label>Reviewed by<input aria-label={`${prefix} reviewer`} maxLength={120} value={value.reviewer} onChange={e=>onChange({...value,reviewer:e.target.value})}/></label><label>Review date<input aria-label={`${prefix} date`} type="date" value={value.date} onChange={e=>onChange({...value,date:e.target.value})}/></label><label>Stamp size<input aria-label={`${prefix} size`} type="range" min="100" max="600" value={value.width} onChange={e=>onChange({...value,width:Number(e.target.value)})}/></label><ReviewStampGraphic stamp={value}/></fieldset>;
}
