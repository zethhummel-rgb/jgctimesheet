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
                    ${settings.company?'<p class="safety-signature-company">'+escapeHtml(settings.company)+'</p>':''}
                    ${settings.requireReadConfirmation?'<label class="safety-signature-confirm"><input type="checkbox" id="safetySignatureRead"> I confirm I have read and understood this JSA.</label>':''}
                    <p class="safety-signature-instruction" id="safetySignatureInstruction">Sign with your finger in the white box below</p>
                    <div class="safety-signature-pad-wrap">
                        <canvas class="safety-signature-pad" aria-label="Sign here with your finger or pointer" aria-describedby="safetySignatureInstruction"></canvas>
                        <span class="safety-signature-placeholder" aria-hidden="true">Sign here</span>
                    </div>
                    <p class="safety-signature-help">Use your finger, mouse or stylus. Tap Clear to start again.</p>
                    <p class="safety-signature-error" role="alert" hidden></p>
                </div>
                <footer class="safety-signature-actions">
                    <p class="safety-signature-needed" aria-live="polite">Sign in the white box above to continue.</p>
                    <button type="button" class="secondary safety-signature-clear">Clear</button>
                    <button type="button" class="secondary safety-signature-cancel">Cancel</button>
                    <button type="button" class="primary-action safety-signature-submit" disabled>Confirm signature</button>
                </footer>
            </section>
        `;

        document.body.appendChild(backdrop);
        document.body.style.overflow = "hidden";

        const dialog = backdrop.querySelector(".safety-signature-dialog");
        const canvas = backdrop.querySelector(".safety-signature-pad");
        const context = canvas.getContext("2d");
        const printedName = backdrop.querySelector("#safetySignaturePrintedName");
        if (settings.readOnlyName) printedName.readOnly = true;
        const errorBox = backdrop.querySelector(".safety-signature-error");
        const submitButton = backdrop.querySelector(".safety-signature-submit");

        const placeholder = backdrop.querySelector(".safety-signature-placeholder");
        const needed = backdrop.querySelector(".safety-signature-needed");

        function showError(message) {
            errorBox.textContent = message || "";
            errorBox.hidden = !message;
        }

        // A real signature, not a tap or a dot: enough drawn line in total.
        const MINIMUM_INK_PX = 40;
        function hasSignature() {
            const rect = canvas.getBoundingClientRect();
            let ink = 0;
            strokes.forEach((stroke) => {
                for (let index = 1; index < stroke.length; index += 1) {
                    ink += Math.hypot((stroke[index][0] - stroke[index - 1][0]) * rect.width, (stroke[index][1] - stroke[index - 1][1]) * rect.height);
                }
            });
            return ink >= MINIMUM_INK_PX;
        }

        // Confirm stays off until the person has actually signed, so the signature can't be skipped.
        function updateSignatureState() {
            const signed = hasSignature();
            placeholder.hidden = strokes.length > 0;
            needed.hidden = signed;
            if (!submitting) submitButton.disabled = !signed;
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
            updateSignatureState();
        }

        function stopDrawing(event) {
            if (event.pointerId !== activePointerId) {
                return;
            }
            drawing = false;
            activePointerId = null;
            currentStroke = null;
            updateSignatureState();
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
            updateSignatureState();
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
            const readConfirmation=backdrop.querySelector('#safetySignatureRead');
            if(readConfirmation && !readConfirmation.checked){showError('Please confirm you have read the JSA.');readConfirmation.focus();return;}
            const usableStrokes = strokes.filter((stroke) => stroke.length >= 2);

            if (!cleanName) {
                showError("Enter the printed name of the person signing.");
                printedName.focus();
                return;
            }

            if (!usableStrokes.length || !hasSignature()) {
                showError("Sign with your finger in the white box first.");
                updateSignatureState();
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
                        confirmedRead: !!readConfirmation?.checked,
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
                submitButton.textContent = "Confirm signature";
                updateSignatureState();
                showError(error && error.message ? error.message : "Signature could not be saved.");
            }
        });

        window.addEventListener("resize", resizeCanvas);
        document.addEventListener("keydown", onKeyDown);
        requestAnimationFrame(() => {
            resizeCanvas();
            updateSignatureState();
            // A name that is already filled in needs no keyboard; opening it would cover the signature box on a phone.
            if (!printedName.value.trim() && !printedName.readOnly) {
                printedName.focus();
                printedName.select();
            }
        });
        dialog.scrollTop = 0;
    }

    window.JGCSafetySignature = {
        open: openSignatureDialog
    };
})();
