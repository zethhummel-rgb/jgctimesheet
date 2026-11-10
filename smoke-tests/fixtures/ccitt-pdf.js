const {PDFDocument,PDFName}=require('../../estimating-app/node_modules/pdf-lib');
// Generic three-page scanner fixture; contains no customer document data.
async function ccittPdf(){
 const doc=await PDFDocument.create(),context=doc.context;
 for(let n=1;n<=3;n++){
  const page=doc.addPage([612,792]),image=context.register(context.stream(Buffer.from("JqB4b/8mS/y4KX////////ygv//H///////////8oq//x////////////KEv/8f//////////j/H/gAgAg==",'base64'),{
   Type:PDFName.of('XObject'),Subtype:PDFName.of('Image'),Width:64,Height:64,
   ColorSpace:PDFName.of('DeviceGray'),BitsPerComponent:1,Filter:PDFName.of('CCITTFaxDecode'),
   DecodeParms:context.obj({K:-1,Columns:64,Rows:64})}));
  const name=page.node.newXObject('Scan',image);
  page.node.addContentStream(context.register(context.flateStream('q 480 0 0 620 50 80 cm '+name.toString()+' Do Q')));
 }
 return Buffer.from(await doc.save({useObjectStreams:false}));
}
module.exports={ccittPdf};
