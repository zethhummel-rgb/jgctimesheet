const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, PDFName, PDFRawStream } = require('../../estimating-app/node_modules/pdf-lib');
const { zlibSync } = require('../../estimating-app/node_modules/fflate');

function letterheadJpeg() {
  return fs.readFileSync(path.join(__dirname, '../../estimating-app/public/jgc-letterhead-logo.jpg'));
}

async function flateJpegPdf() {
  const doc = await PDFDocument.create();
  const jpeg = letterheadJpeg();
  const image = await doc.embedJpg(jpeg);
  await image.embed();
  const dict = doc.context.lookup(image.ref).dict.clone();
  dict.set(PDFName.of('Filter'), doc.context.obj(['FlateDecode', 'DCTDecode']));
  dict.set(PDFName.of('DecodeParms'), doc.context.obj([null, null]));
  doc.context.assign(image.ref, PDFRawStream.of(dict, zlibSync(jpeg)));
  for (let sheet = 1; sheet <= 2; sheet++) {
    const page = doc.addPage([864, 576]);
    page.drawImage(image, { x: 50, y: 360, ...image.scaleToFit(500, 180) });
    page.drawText('Drawing sheet ' + sheet, { x: 50, y: 300 });
  }
  return Buffer.from(await doc.save());
}

module.exports = { flateJpegPdf, letterheadJpeg };
