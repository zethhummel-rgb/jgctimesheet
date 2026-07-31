(function () {
    "use strict";

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function openSignatureDialog(options) {
        const settings = options || {};
        const originalOverflow = document.body.style.overflow;
        const backdrop = document.createElement("div");
        let drawing = false;
        let activePointerId = null;
        let strokes = [];
        let currentStroke = null;
        let submitting = false;

        backdrop.className = "safety-signature-backdrop";
        backdrop.innerHTML = `
            <section class="safety-signature-dialog" role="dialog" aria-modal="true" aria-labelledby="safetySignatureTitle">
                <header class="safety-signature-head">
                    <div>
                        <h2 id="safetySignatureTitle">Sign acknowledgement</h2>
                        <div class="small">${escapeHtml(settings.recordLabel || "Safety record")}</div>
                    </div>
                    <button type="button" class="secondary safety-signature-close" aria-label="Close signature window">X</button>
                </header>
                <div class="safety-signature-body">
                    <label for="safetySignaturePrintedName">Printed name</label>
                    <input id="safetySignaturePrintedName" type="text" autocomplete="name" value="${escapeHtml(settings.attendeeName || "")}" placeholder="Full name" />
                    <label>Signature</label>
                    <div class="safety-signature-pad-wrap">
                        <canvas class="safety-signature-pad" aria-label="Sign here with your finger or pointer"></canvas>
                    </div>
                    <p class="safety-signature-help">Sign inside the white box with your finger, mouse, or stylus.</p>
                    <p class="safety-signature-error" role="alert" hidden></p>
                </div>
                <footer class="safety-signature-actions">
                    <button type="button" class="secondary safety-signature-clear">Clear</button>
                    <button type="button" class="secondary safety-signature-cancel">Cancel</button>
                    <button type="button" class="primary-action safety-signature-submit">Confirm signature</button>
                </footer>
            </section>
        `;

        document.body.appendChild(backdrop);
        document.body.style.overflow = "hidden";

        const dialog = backdrop.querySelector(".safety-signature-dialog");
        const canvas = backdrop.querySelector(".safety-signature-pad");
        const context = canvas.getContext("2d");
        const printedName = backdrop.querySelector("#safetySignaturePrintedName");
        const errorBox = backdrop.querySelector(".safety-signature-error");
        const submitButton = backdrop.querySelector(".safety-signature-submit");

        function showError(message) {
            errorBox.textContent = message || "";
            errorBox.hidden = !message;
        }

        function resizeCanvas() {
            const rect = canvas.getBoundingClientRect();
            const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
            canvas.width = Math.max(1, Math.round(rect.width * ratio));
            canvas.height = Math.max(1, Math.round(rect.height * ratio));
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            redraw();
        }

        function drawStroke(stroke) {
            if (!stroke || stroke.length < 2) {
                return;
            }

            const rect = canvas.getBoundingClientRect();
            context.beginPath();
            context.lineWidth = 2.8;
            context.lineCap = "round";
            context.lineJoin = "round";
            context.strokeStyle = "#101010";
            context.moveTo(stroke[0][0] * rect.width, stroke[0][1] * rect.height);
            for (let index = 1; index < stroke.length; index += 1) {
                context.lineTo(stroke[index][0] * rect.width, stroke[index][1] * rect.height);
            }
            context.stroke();
        }

        function redraw() {
            const rect = canvas.getBoundingClientRect();
            context.clearRect(0, 0, rect.width, rect.height);
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, rect.width, rect.height);
            strokes.forEach(drawStroke);
        }

        function pointFromEvent(event) {
            const rect = canvas.getBoundingClientRect();
            return [
                Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
                Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
            ];
        }

        function startDrawing(event) {
            if (submitting) {
                return;
            }
            event.preventDefault();
            drawing = true;
            activePointerId = event.pointerId;
            currentStroke = [pointFromEvent(event)];
            strokes.push(currentStroke);
            canvas.setPointerCapture(event.pointerId);
            showError("");
        }

        function continueDrawing(event) {
            if (!drawing || event.pointerId !== activePointerId || !currentStroke) {
                return;
            }
            event.preventDefault();
            const nextPoint = pointFromEvent(event);
            const previousPoint = currentStroke[currentStroke.length - 1];
            if (Math.abs(nextPoint[0] - previousPoint[0]) + Math.abs(nextPoint[1] - previousPoint[1]) < 0.003) {
                return;
            }
            currentStroke.push(nextPoint);
            redraw();
        }

        function stopDrawing(event) {
            if (event.pointerId !== activePointerId) {
                return;
            }
            drawing = false;
            activePointerId = null;
            currentStroke = null;
        }

        function close(result) {
            window.removeEventListener("resize", resizeCanvas);
            document.removeEventListener("keydown", onKeyDown);
            document.body.style.overflow = originalOverflow;
            backdrop.remove();
            if (typeof settings.onClose === "function") {
                settings.onClose(result || null);
            }
        }

        function onKeyDown(event) {
            if (event.key === "Escape" && !submitting) {
                close(null);
            }
        }

        canvas.addEventListener("pointerdown", startDrawing);
        canvas.addEventListener("pointermove", continueDrawing);
        canvas.addEventListener("pointerup", stopDrawing);
        canvas.addEventListener("pointercancel", stopDrawing);
        backdrop.querySelector(".safety-signature-clear").addEventListener("click", () => {
            strokes = [];
            redraw();
            showError("");
        });
        backdrop.querySelector(".safety-signature-cancel").addEventListener("click", () => close(null));
        backdrop.querySelector(".safety-signature-close").addEventListener("click", () => close(null));
        backdrop.addEventListener("click", (event) => {
            if (event.target === backdrop && !submitting) {
                close(null);
            }
        });
        submitButton.addEventListener("click", async () => {
            const cleanName = printedName.value.trim();
            const usableStrokes = strokes.filter((stroke) => stroke.length >= 2);

            if (!cleanName) {
                showError("Enter the printed name of the person signing.");
                printedName.focus();
                return;
            }

            if (!usableStrokes.length) {
                showError("Add a signature inside the white box.");
                return;
            }

            submitting = true;
            submitButton.disabled = true;
            submitButton.textContent = "Saving...";
            showError("");

            try {
                const result = typeof settings.onSubmit === "function"
                    ? await settings.onSubmit({
                        printedName: cleanName,
                        strokes: usableStrokes,
                        width: Math.round(canvas.getBoundingClientRect().width),
                        height: Math.round(canvas.getBoundingClientRect().height)
                    })
                    : { ok: true };

                if (!result || result.ok === false) {
                    throw new Error(result && result.message ? result.message : "Signature could not be saved.");
                }

                close(result);
            } catch (error) {
                submitting = false;
                submitButton.disabled = false;
                submitButton.textContent = "Confirm signature";
                showError(error && error.message ? error.message : "Signature could not be saved.");
            }
        });

        window.addEventListener("resize", resizeCanvas);
        document.addEventListener("keydown", onKeyDown);
        requestAnimationFrame(() => {
            resizeCanvas();
            printedName.focus();
            printedName.select();
        });
        dialog.scrollTop = 0;
    }

    window.JGCSafetySignature = {
        open: openSignatureDialog
    };
})();
