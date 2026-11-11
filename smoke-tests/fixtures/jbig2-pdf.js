const { PDFDocument, PDFName } = require('../../estimating-app/node_modules/pdf-lib');

// Wrap a synthetic Group 4 bitmap in one page information and one immediate
// generic region segment. This tests the same decoder without customer data.
function jbig2Image() {
  const fax = Buffer.from('JqB4b/8mS/y4KX////////ygv//H///////////8oq//x////////////KEv/8f//////////j/H/gAgAg==', 'base64');
  function segment(number, type, body) {
    const header = Buffer.alloc(11);
    header.writeUInt32BE(number);
    header[4] = type;
    header[6] = 1;
    header.writeUInt32BE(body.length, 7);
    return Buffer.concat([header, body]);
  }
  const page = Buffer.alloc(19);
  page.writeUInt32BE(64);
  page.writeUInt32BE(64, 4);
  const region = Buffer.alloc(18);
  region.writeUInt32BE(64);
  region.writeUInt32BE(64, 4);
  region[17] = 1; // MMR coding
  return Buffer.concat([segment(0, 48, page), segment(1, 38, Buffer.concat([region, fax]))]);
}

async function jbig2Pdf() {
  const pdf = await PDFDocument.create(), context = pdf.context;
  for (let i = 0; i < 3; i++) {
    const page = pdf.addPage([612, 792]);
    const image = context.register(context.stream(jbig2Image(), {
      Type: PDFName.of('XObject'), Subtype: PDFName.of('Image'), Width: 64, Height: 64,
      ColorSpace: PDFName.of('DeviceGray'), BitsPerComponent: 1, Filter: PDFName.of('JBIG2Decode'),
    }));
    const name = page.node.newXObject('Scan', image);
    page.node.addContentStream(context.register(context.flateStream('q 480 0 0 620 50 80 cm ' + name.toString() + ' Do Q')));
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
module.exports = { jbig2Image, jbig2Pdf };
