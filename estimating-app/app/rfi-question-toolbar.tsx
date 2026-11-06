import { useEffect, useRef, useState } from 'react';
import { format, questionToolbarState, rememberQuestionSelection } from './site-specific-entry';

const paths = {
  bold: 'M6 4h6a4 4 0 0 1 0 8H6z M6 12h7a4 4 0 0 1 0 8H6z',
  italic: 'M12 4h7 M5 20h7 M15.5 4l-7 16',
  underline: 'M6 3v7a6 6 0 0 0 12 0V3 M4 21h16',
  highlight: 'm5 14 9-10 5 5-9 10z M5 14l-2 6 7-1',
  bullets: 'M9 5h12 M9 12h12 M9 19h12 M3 5h1 M3 12h1 M3 19h1',
  numbered: 'M10 6h11 M10 17h11 M3 4l2-1v6 M3 9h4 M3 15c0-3 5-3 5 0 0 2-4 4-5 6h5',
  clear: 'm4 13 9-10 8 7-9 10H9z M8 9l8 7 M12 20h9',
  undo: 'M4 11h10a6 6 0 0 1 0 12 M4 11l5-5 M4 11l5 5',
  redo: 'M20 11H10a6 6 0 0 0 0 12 M20 11l-5-5 M20 11l-5 5'
};
type Icon = keyof typeof paths;

export function RfiQuestionToolbar() {
  const ref=useRef<HTMLDivElement>(null);
  const scope=()=>ref.current?.closest<HTMLElement>('.rfi-question')??null;
  const [state,setState]=useState(()=>questionToolbarState(null));
  useEffect(()=>{
    let frame=0;
    const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>setState(questionToolbarState(scope())));};
    document.addEventListener('ss-selection',update);
    return ()=>{cancelAnimationFrame(frame);document.removeEventListener('ss-selection',update);};
  },[]);
  function apply(command:string) {
    const root=scope();
    if(!root)return;
    format(command,root);
    setState(questionToolbarState(root));
  }
  function tool(icon:Icon,label:string,command:string,pressed?:boolean,disabled=false) {
    return <button type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled}
      onPointerDown={event=>{event.preventDefault();rememberQuestionSelection(scope());}} onClick={()=>apply(command)}>
      <svg viewBox="0 0 24 26" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={icon==='bold'?3:1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={paths[icon]}/>{icon==='highlight'&&<path d="M3 24h17" stroke="#e5b928" strokeWidth="3"/>}
      </svg>
    </button>;
  }
  const s=state.style;
  return <div ref={ref} className="rfi-font-tools" role="toolbar" aria-label="Question formatting">
    <div className="rfi-type-controls" role="group" aria-label="Typeface and size">
      <select aria-label="Font family" title="Font family" value={s.family} onPointerDown={()=>rememberQuestionSelection(scope())} onChange={e=>apply(e.target.value)}>
        <option value="sans">Arial</option><option value="serif">Times</option><option value="mono">Courier</option>
      </select>
      <select aria-label="Font size" title="Font size" value={s.points||11} onPointerDown={()=>rememberQuestionSelection(scope())} onChange={e=>apply('pt'+e.target.value)}>
        {[9,10,11,12,14,16,18,20,24].map(n=><option value={n} key={n}>{n} pt</option>)}
      </select>
    </div>
    <div className="rfi-tool-group" role="group" aria-label="Text style">
      {tool('bold','Bold','bold',s.bold)}{tool('italic','Italic','italic',s.italic)}{tool('underline','Underline','underline',s.underline)}
      {tool('highlight','Highlight',s.highlight?'highlight:':'hy',Boolean(s.highlight))}
    </div>
    <div className="rfi-tool-group" role="group" aria-label="Lists">
      {tool('bullets','Bulleted list','insertUnorderedList')}{tool('numbered','Numbered list','insertOrderedList')}
    </div>
    <div className="rfi-tool-group" role="group" aria-label="Editing">
      {tool('clear','Clear formatting','clear')}{tool('undo','Undo','undo',undefined,!state.undo)}{tool('redo','Redo','redo',undefined,!state.redo)}
    </div>
  </div>;
}
