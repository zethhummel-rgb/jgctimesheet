import { DOCUMENT_LIMITS } from './document-budget';

const invalid = () => new Error('This PDF is too complex to process. Its JBIG2 scan uses unsupported image data.');

// T.88 sections 7.2, 7.4.1, 7.4.6 and 7.4.8.
// PDF embeds sequential segments. Accept one fixed-size page of standalone generic
// regions. Dictionary references and unknown-length or striped pages require a
// different allocation budget and cannot be passed through this check.
export function jbig2ImageBudget(bytes: Uint8Array, width: number, height: number) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stride = (pixels: number) => Math.ceil(pixels / 8);
  let offset = 0, count = 0, page = 0, previousNumber = -1, ended = false;
  let pixels = width * height, decodedBytes = stride(width) * height;

  while (offset < data.byteLength) {
    if (++count > 1024 || data.byteLength - offset < 11) throw invalid();
    const number = data.getUint32(offset);
    const flags = data.getUint8(offset + 4);
    const type = flags & 63;
    const pageBytes = flags & 64 ? 4 : 1;
    const headerSize = 10 + pageBytes;
    if (number <= previousNumber || data.getUint8(offset + 5) >> 5 || data.byteLength - offset < headerSize) throw invalid();
    previousNumber = number;
    const association = pageBytes === 4 ? data.getUint32(offset + 6) : data.getUint8(offset + 6);
    const length = data.getUint32(offset + 6 + pageBytes);
    const start = offset + headerSize;
    offset = start + length;
    if (offset > data.byteLength) throw invalid();

    if (type === 48) {
      if (count !== 1 || !association || length !== 19 ||
          data.getUint32(start) !== width || data.getUint32(start + 4) !== height ||
          data.getUint8(start + 16) & 128 || data.getUint16(start + 17) & 0x8000) throw invalid();
      page = association;
      continue;
    }
    if (!page) throw invalid();
    if (type === 51 && association === 0 && length === 0 && offset === data.byteLength) break;
    if (ended || association !== page) throw invalid();
    if (type === 49 && length === 0) {
      ended = true;
      continue;
    }
    if ((type !== 38 && type !== 39) || length < 19) throw invalid();

    const regionWidth = data.getUint32(start);
    const regionHeight = data.getUint32(start + 4);
    const x = data.getUint32(start + 8);
    const y = data.getUint32(start + 12);
    if (!regionWidth || !regionHeight || x + regionWidth > width || y + regionHeight > height ||
        data.getUint8(start + 16) > 4) throw invalid();

    const coding = data.getUint8(start + 17);
    const mmr = Boolean(coding & 1);
    const template = (coding >> 1) & 3;
    const adaptiveBytes = mmr ? 0 : template === 0 ? 8 : 2;
    if (coding > 15 || (mmr && coding !== 1) || length <= 18 + adaptiveBytes) throw invalid();
    for (let i = 0; i < adaptiveBytes; i += 2) {
      const dx = data.getInt8(start + 18 + i), dy = data.getInt8(start + 19 + i);
      if (dy > 0 || (dy === 0 && dx >= 0)) throw invalid();
    }

    pixels += regionWidth * regionHeight;
    decodedBytes += stride(regionWidth) * regionHeight;
    if (pixels > DOCUMENT_LIMITS.imagePixels * 2) throw invalid();
  }
  if (!page) throw invalid();
  return { pixels, decodedBytes };
}
