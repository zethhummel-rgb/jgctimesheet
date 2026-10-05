/* Review the same PDF bytes used by the Job Board export. Loaded only on JSA review. */
(function () {
  'use strict';
  let library, attempt = 0;
  window.JGCJsaPreview = { async render(parent, file, isCurrent) {
    parent.replaceChildren();
    if (String(file.mimeType || file.blob.type).startsWith('image/')) {
      const image = document.createElement('img'), url = URL.createObjectURL(file.blob);
      image.className = 'board-jsa-original'; image.alt = 'Original uploaded JSA'; image.src = url;
      try { await image.decode(); if (isCurrent()) parent.append(image); } finally { URL.revokeObjectURL(url); }
      return;
    }
    library ||= import('./vendor/pdfjs/pdf.min.mjs?v=1&attempt=' + attempt++).catch(error => { library = null; throw error; });
    const pdfjs = await library;
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs?v=1', document.baseURI).href;
    const task = pdfjs.getDocument({data: new Uint8Array(await file.blob.arrayBuffer()), standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', document.baseURI).href, isEvalSupported: false});
    try {
      const pdf = await task.promise;
      if (!isCurrent()) return;
      const toolbar = document.createElement('div'); toolbar.className = 'board-jsa-preview-tools';
      const label = document.createElement('span'); label.textContent = pdf.numPages + (pdf.numPages === 1 ? ' page' : ' pages');
      const scroller = document.createElement('div'); scroller.className = 'board-jsa-preview-scroll'; scroller.tabIndex = 0; scroller.setAttribute('aria-label', 'JSA PDF pages. Zoom to enlarge and scroll to read.');
      const pages = document.createElement('div'); pages.className = 'board-jsa-pdf-pages'; scroller.append(pages);
      let zoom = 100;
      function control(title, action) { const b = document.createElement('button'); b.type = 'button'; b.className = 'jgc-button jgc-button--secondary'; b.textContent = title; b.addEventListener('click', action); toolbar.append(b); return b; }
      toolbar.append(label);
      const minus = control('−', () => setZoom(zoom - 25)); minus.setAttribute('aria-label', 'Zoom out JSA');
      const amount = document.createElement('output'); amount.setAttribute('aria-live', 'polite'); toolbar.append(amount);
      const plus = control('+', () => setZoom(zoom + 25)); plus.setAttribute('aria-label', 'Zoom in JSA');
      control('Fit width', () => setZoom(100));
      function setZoom(value) { zoom = Math.max(100, Math.min(300, value)); pages.style.width = zoom + '%'; amount.textContent = zoom + '%'; minus.disabled = zoom === 100; plus.disabled = zoom === 300; }
      setZoom(100); parent.append(toolbar, scroller);
      for (let i = 1; i <= pdf.numPages; i++) {
        if (!isCurrent()) return;
        const page = await pdf.getPage(i), natural = page.getViewport({scale: 1});
        const viewport = page.getViewport({scale: Math.min(1600 / natural.width, Math.sqrt(4000000 / (natural.width * natural.height)))});
        const sheet = document.createElement('figure'); sheet.className = 'board-jsa-pdf-sheet';
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height); canvas.setAttribute('aria-hidden', 'true');
        await page.render({canvasContext: canvas.getContext('2d'), viewport, background: 'rgb(255,255,255)'}).promise;
        const content = await page.getTextContent();
        const transcript = document.createElement('div'); transcript.className = 'board-jsa-accessible-text'; transcript.textContent = content.items.map(item => item.str).join(' ');
        const caption = document.createElement('figcaption'); caption.textContent = 'Page ' + i + ' of ' + pdf.numPages;
        sheet.append(canvas, transcript, caption); if (isCurrent()) pages.append(sheet); page.cleanup();
      }
    } finally { await task.destroy(); }
  }};
})();
