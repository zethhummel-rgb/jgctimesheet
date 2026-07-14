(function() {
  "use strict";

  let logoDataPromise = null;

  function text(value) {
    return String(value === null || value === undefined ? "" : value);
  }

  function formatPoNumber(value) {
    const number = text(value).replace(/^PO-/i, "");
    return number ? "PO-" + number : "PO-PENDING";
  }

  function formatDate(value) {
    const parts = text(value).split("-").map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
      return text(value);
    }
    return parts[1] + "/" + parts[2] + "/" + parts[0];
  }

  async function getLogoData() {
    if (logoDataPromise) {
      return logoDataPromise;
    }

    logoDataPromise = new Promise((resolve) => {
      const image = new Image();
      image.onload = function() {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } catch (error) {
          resolve("");
        }
      };
      image.onerror = function() { resolve(""); };
      image.src = "logo.webp";
    });

    return logoDataPromise;
  }

  function drawField(doc, label, value, x, y, width, height) {
    doc.setDrawColor(36, 83, 57);
    doc.setLineWidth(0.75);
    doc.rect(x, y, width, height);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(45, 68, 54);
    doc.text(label.toUpperCase(), x + 6, y + 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(20, 28, 23);
    const lines = doc.splitTextToSize(text(value), width - 12).slice(0, 2);
    doc.text(lines, x + 6, y + 24);
  }

  function drawTableHeader(doc, y, columns) {
    doc.setFillColor(18, 104, 59);
    doc.setDrawColor(36, 83, 57);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    columns.forEach((column) => {
      doc.rect(column.x, y, column.width, 22, "FD");
      const label = doc.splitTextToSize(column.label, column.width - 6);
      doc.text(label, column.x + 3, y + 9);
    });
    return y + 22;
  }

  function drawPageHeader(doc, data, logoData, continuation) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 36;

    if (logoData) {
      doc.addImage(logoData, "PNG", margin, 28, 205, 63, undefined, "FAST");
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(19);
      doc.setTextColor(18, 104, 59);
      doc.text("JOHN GORDON CONSTRUCTION INC.", margin, 52);
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(45, 57, 49);
    doc.text("830 Campbell Street, Unit #3, Cornwall, Ontario K6H 6L7", margin, 101);
    doc.text("Tel: 613-932-1293", margin, 112);

    doc.setFillColor(24, 105, 64);
    doc.rect(pageWidth - 255, 31, 219, 27, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text(continuation ? "PURCHASE ORDER - CONTINUED" : "PURCHASE ORDER", pageWidth - 245, 50);

    doc.setTextColor(20, 28, 23);
    doc.setFontSize(18);
    doc.text(formatPoNumber(data.po_number), pageWidth - 36, 82, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("Show this PO number on invoices, shipping papers, and packages.", pageWidth - 36, 99, { align: "right" });
  }

  function drawFooter(doc, data) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 36;
    const y = pageHeight - 55;

    doc.setDrawColor(36, 83, 57);
    doc.line(margin, y, pageWidth - margin, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(45, 57, 49);
    doc.text("Created by: " + text(data.creator_name), margin, y + 14);
    doc.text("Last edited by: " + text(data.last_edited_by_name || "Not edited"), margin, y + 26);
    doc.text("Submitted by: " + text(data.submitted_by_name || data.creator_name || "Pending"), pageWidth - margin, y + 14, { align: "right" });
    doc.text("Portal authorization record - no field signature required", pageWidth - margin, y + 26, { align: "right" });
  }

  async function createDocument(data) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error("The PDF library is not available.");
    }

    const jsPDF = window.jspdf.jsPDF;
    const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
    const logoData = await getLogoData();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 36;
    const contentWidth = pageWidth - margin * 2;
    const half = contentWidth / 2;

    drawPageHeader(doc, data, logoData, false);
    let y = 126;
    drawField(doc, "Date of Order", formatDate(data.order_date), margin, y, half, 44);
    drawField(doc, "Job #", data.job_number, margin + half, y, half, 44);
    y += 44;
    drawField(doc, "To", data.supplier_name, margin, y, half, 48);
    drawField(doc, "Job Name", data.job_name, margin + half, y, half, 48);
    y += 60;

    const columns = [
      { key: "quantity_ordered", label: "QTY. ORDERED", x: margin, width: 64 },
      { key: "quantity_received", label: "QTY. REC'D", x: margin + 64, width: 61 },
      { key: "details", label: "STOCK NUMBER / DESCRIPTION", x: margin + 125, width: 257 },
      { key: "unit_price", label: "UNIT PRICE", x: margin + 382, width: 72 },
      { key: "amount", label: "AMOUNT", x: margin + 454, width: contentWidth - 454 }
    ];

    y = drawTableHeader(doc, y, columns);
    const items = Array.isArray(data.items) && data.items.length ? data.items : [{ description: "" }];

    items.forEach((item, index) => {
      const details = [
        item.stock_number ? "Stock: " + item.stock_number : "",
        item.description || "",
        item.notes ? "Note: " + item.notes : ""
      ].filter(Boolean).join("\n");
      const detailLines = doc.splitTextToSize(details, columns[2].width - 8);
      const rowHeight = Math.max(28, detailLines.length * 10 + 10);

      if (y + rowHeight > pageHeight - 80) {
        drawFooter(doc, data);
        doc.addPage();
        drawPageHeader(doc, data, logoData, true);
        y = drawTableHeader(doc, 126, columns);
      }

      doc.setDrawColor(45, 82, 59);
      doc.setTextColor(20, 28, 23);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      columns.forEach((column) => doc.rect(column.x, y, column.width, rowHeight));
      doc.text(text(item.quantity_ordered), columns[0].x + 4, y + 16);
      doc.text(text(item.quantity_received), columns[1].x + 4, y + 16);
      doc.text(detailLines, columns[2].x + 4, y + 13);
      y += rowHeight;

      if (index === items.length - 1) {
        const blankRows = Math.max(0, 4 - items.length);
        for (let blank = 0; blank < blankRows; blank += 1) {
          if (y + 28 > pageHeight - 80) {
            break;
          }
          columns.forEach((column) => doc.rect(column.x, y, column.width, 28));
          y += 28;
        }
      }
    });

    if (data.notes) {
      const notes = doc.splitTextToSize("Order notes: " + data.notes, contentWidth - 12);
      const notesHeight = Math.max(30, notes.length * 10 + 12);
      if (y + notesHeight > pageHeight - 80) {
        drawFooter(doc, data);
        doc.addPage();
        drawPageHeader(doc, data, logoData, true);
        y = 126;
      }
      doc.setFillColor(238, 246, 239);
      doc.setDrawColor(36, 83, 57);
      doc.rect(margin, y + 10, contentWidth, notesHeight, "FD");
      doc.setFontSize(8.5);
      doc.setTextColor(20, 28, 23);
      doc.text(notes, margin + 6, y + 24);
    }

    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      drawFooter(doc, data);
      doc.setFontSize(7);
      doc.setTextColor(80, 90, 83);
      doc.text("Page " + page + " of " + pages, pageWidth / 2, pageHeight - 16, { align: "center" });
    }

    return doc;
  }

  async function createBlob(data) {
    const doc = await createDocument(data);
    return doc.output("blob");
  }

  async function view(data) {
    const blob = await createBlob(data);
    const url = URL.createObjectURL(blob);
    const popup = window.open(url, "_blank", "noopener");
    if (!popup) {
      URL.revokeObjectURL(url);
      throw new Error("Allow popups to view the PO PDF.");
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  window.JgcPurchaseOrderPdf = {
    createBlob,
    view,
    formatPoNumber
  };
})();
