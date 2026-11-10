// Match the installed pdfjs-dist 6.2.108 worker. An absolute URL also lets
// the worker import the JavaScript decoder if WebAssembly cannot load.
export const pdfDecoderOptions = { wasmUrl: new URL('./supplier-import/pdf-decoders/', document.baseURI).href };
