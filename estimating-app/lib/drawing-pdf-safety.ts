import {PDFArray,PDFDict,PDFDocument,PDFName,PDFRawStream,PDFRef,type PDFObject} from 'pdf-lib';

const pageKeys=new Set(['Type','Parent','Resources','Contents','MediaBox','CropBox','BleedBox','TrimBox','ArtBox','Rotate','UserUnit','Group','Annots','StructParents','Tabs']);
const annotationKinds=new Set(['Text','FreeText','Line','Square','Circle','Polygon','PolyLine','Highlight','Underline','Squiggly','StrikeOut','Stamp','Caret','Ink']);
const annotationKeys=new Set(['Type','Subtype','Rect','Contents','NM','M','F','AP','AS','Border','C','CA','T','Subj','Name','Open','CreationDate','L','LE','IC','LL','LLE','Cap','IT','LLO','Vertices','QuadPoints','InkList','BS','BE','DA','Q','RD','CL']);
const actionKinds=new Set(['JavaScript','Launch','URI','GoTo','GoToR','GoToE','SubmitForm','ImportData','ResetForm','Hide','Named','Sound','Movie','Rendition','SetOCGState','Trans','GoTo3DView']);
const name=(value:PDFObject|undefined)=>value instanceof PDFName?value.decodeText():'';

/** Keep vector drawing content and inert review notes. Never forward source PDF actions,
 * interactive fields, attachments or multimedia into a JGC export. */
export function sanitizeDrawingPdf(pdf:PDFDocument):void {
 const context=pdf.context;
 const form=pdf.getForm();
 if(form.getFields().length)form.flatten({updateFieldAppearances:false});
 for(const page of pdf.getPages()){
  // Resolve inherited attributes before copyPages severs the source page tree.
  for(const key of ['Resources','MediaBox','CropBox','Rotate']){
   const inherited=page.node.getInheritableAttribute(PDFName.of(key));
   if(inherited)page.node.set(PDFName.of(key),inherited);
  }
  const annotations=page.node.Annots();
  if(annotations){
   const safe=context.obj([]) as PDFArray;
   for(const entry of annotations.asArray()){
    const source=context.lookup(entry);
    if(!(source instanceof PDFDict)||!annotationKinds.has(name(source.lookup(PDFName.of('Subtype')))))continue;
    const note=context.obj({}) as PDFDict;
    for(const [key,value] of source.entries())if(annotationKeys.has(key.decodeText()))note.set(key,value);
    safe.push(context.register(note));
   }
   page.node.set(PDFName.of('Annots'),safe);
  }
  for(const key of page.node.keys())if(!pageKeys.has(key.decodeText()))page.node.delete(key);
 }
 // An appearance/resource may itself contain a direct or indirect action dictionary.
 // Clear those by their PDF action type, rather than deleting glyphs named A/AA from fonts.
 const seen=new Set<PDFObject>(),pending:PDFObject[]=context.enumerateIndirectObjects().map(([,object])=>object),deadline=Date.now()+15000;
 while(pending.length){
  const object=pending.pop()!;
  if(seen.has(object))continue;
  seen.add(object);
  if(seen.size>100000||Date.now()>deadline)throw new Error('This drawing is too complex to export safely. Use a simplified PDF.');
  if(object instanceof PDFRef){const resolved=context.lookup(object);if(resolved)pending.push(resolved);}
  else if(object instanceof PDFRawStream)pending.push(object.dict);
  else if(object instanceof PDFArray)pending.push(...object.asArray());
  else if(object instanceof PDFDict){
   if(name(object.lookup(PDFName.of('Type')))==='Action'||actionKinds.has(name(object.lookup(PDFName.of('S'))))){
    for(const key of object.keys())object.delete(key);
   }else for(const [,value] of object.entries())pending.push(value);
  }
 }
}
