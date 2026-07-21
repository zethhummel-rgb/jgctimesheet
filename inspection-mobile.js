(function() {
    function text(value) {
        return String(value || "").trim();
    }

    function normalize(value) {
        return text(value).toLowerCase();
    }

    function makeButton(label, className, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "inspection-choice-button " + (className || "");
        button.textContent = label;
        button.addEventListener("click", onClick);
        return button;
    }

    function dispatchFieldChange(field) {
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function setRadio(input) {
        input.checked = true;
        dispatchFieldChange(input);
    }

    function getCellIndex(cell) {
        return Array.from(cell.parentElement.children).indexOf(cell);
    }

    function escapeCssIdentifier(value) {
        if (window.CSS && typeof window.CSS.escape === "function") {
            return window.CSS.escape(value);
        }

        return String(value || "").replace(/["\\]/g, "\\$&");
    }

    function getHeaderLabels(table) {
        const headers = Array.from(table.querySelectorAll("thead th, tr:first-child th"));
        return headers.map((header) => text(header.textContent));
    }

    function getQuestionNumber(label, fallback) {
        const match = text(label).match(/^(\d+)[.)\s-]*/);
        return match ? match[1] : String(fallback || "");
    }

    function stripQuestionNumber(label) {
        return text(label).replace(/^\d+[.)\s-]*/, "").trim();
    }

    function choiceClass(label) {
        const key = normalize(label).replace(/[^a-z0-9]+/g, "-");
        if (key === "p" || key === "pass" || key === "sat" || key === "satisfactory" || key === "okay") {
            return "choice-pass";
        }
        if (key === "f" || key === "fail" || key === "uns" || key === "unsatisfactory" || key === "defective") {
            return key === "defective" ? "choice-defective" : "choice-fail choice-uns";
        }
        if (key === "n-a" || key === "na") {
            return "choice-na";
        }
        return "";
    }

    function displayChoiceLabel(label) {
        const key = normalize(label).replace(/[^a-z0-9]+/g, "-");

        if (key === "sat" || key === "satisfactory" || key === "pass") {
            return "P";
        }

        if (key === "uns" || key === "unsatisfactory" || key === "fail" || key === "defective") {
            return "F";
        }

        if (key === "n-a" || key === "na") {
            return "NA";
        }

        if (key === "okay") {
            return "P";
        }

        return label;
    }

    function tileStateClass(label) {
        const key = normalize(label);
        if (["p", "pass", "sat", "satisfactory", "okay"].includes(key)) {
            return key === "okay" ? "is-okay" : "is-pass";
        }
        if (["f", "fail", "uns", "unsatisfactory", "defective"].includes(key)) {
            return key === "defective" ? "is-defective" : "is-fail";
        }
        if (["n-a", "na", "not-applicable", "not applicable"].includes(key)) {
            return "is-na";
        }
        return "";
    }

    function createTile(number, title, meta) {
        const tile = document.createElement("div");
        tile.className = "inspection-tile";

        const head = document.createElement("div");
        head.className = "inspection-tile-head";

        const badge = document.createElement("span");
        badge.className = "inspection-tile-number";
        badge.textContent = number || "";

        const titleWrap = document.createElement("div");
        const heading = document.createElement("div");
        heading.className = "inspection-tile-title";
        heading.textContent = title;
        titleWrap.appendChild(heading);

        if (meta) {
            const metaEl = document.createElement("div");
            metaEl.className = "inspection-tile-meta";
            metaEl.textContent = meta;
            titleWrap.appendChild(metaEl);
        }

        head.appendChild(badge);
        head.appendChild(titleWrap);
        tile.appendChild(head);
        return tile;
    }

    function syncSourceChoiceGroup(input) {
        const name = input.name;
        if (!name) {
            return;
        }

        document.querySelectorAll("input[type='radio'][name='" + escapeCssIdentifier(name) + "']").forEach((radio) => {
            const wrapper = radio.closest(".inspection-source-choice");
            if (wrapper) {
                wrapper.classList.toggle("is-selected", radio.checked);
                wrapper.setAttribute("aria-pressed", radio.checked ? "true" : "false");
            }
        });
    }

    function getSourceRadioLabel(input) {
        const cell = input.closest("td");
        const row = input.closest("tr");
        const table = input.closest("table");
        const headers = table ? getHeaderLabels(table) : [];
        const headerLabel = cell ? headers[getCellIndex(cell)] : "";
        return headerLabel || input.value || input.getAttribute("aria-label") || "Option";
    }

    function enhanceSourceRadioButtons() {
        document.querySelectorAll(".container table input[type='radio']").forEach((input) => {
            if (input.closest(".inspection-source-choice")) {
                return;
            }

            const label = getSourceRadioLabel(input);
            if (!input.value || input.value === "on") {
                input.value = label;
            }

            const wrapper = document.createElement("label");
            wrapper.className = "inspection-source-choice " + choiceClass(label);
            wrapper.setAttribute("aria-pressed", input.checked ? "true" : "false");

            const button = document.createElement("span");
            button.className = "inspection-source-choice-button";
            button.setAttribute("aria-hidden", "true");
            button.textContent = displayChoiceLabel(label);

            input.insertAdjacentElement("beforebegin", wrapper);
            wrapper.appendChild(input);
            wrapper.appendChild(button);
            input.addEventListener("change", () => {
                syncSourceChoiceGroup(input);
                updateInspectionProgress();
            });
            syncSourceChoiceGroup(input);
        });
    }

    function syncChoiceButtons(tile, buttons) {
        buttons.forEach(({ button, source, label }) => {
            let selected = false;
            if (source.type === "radio" || source.type === "checkbox") {
                selected = source.checked;
            } else {
                selected = text(source.value) === label;
            }

            button.classList.toggle("is-selected", selected);
            button.setAttribute("aria-pressed", selected ? "true" : "false");
        });

        const selected = buttons.find((item) => item.button.classList.contains("is-selected"));
        tile.classList.remove("is-pass", "is-okay", "is-fail", "is-defective", "is-na");
        if (selected) {
            const stateClass = tileStateClass(selected.label);
            if (stateClass) {
                tile.classList.add(stateClass);
            }
        }
    }

    function buildRadioChoiceGroup(tile, controls) {
        const grid = document.createElement("div");
        grid.className = "inspection-choice-grid";
        if (controls.length === 2) {
            grid.classList.add("two-choice");
        } else if (controls.length === 1) {
            grid.classList.add("one-choice");
        }

        const buttons = controls.map((control) => {
            if (!control.input.value || control.input.value === "on") {
                control.input.value = control.label;
            }

            const button = makeButton(displayChoiceLabel(control.label), choiceClass(control.label), () => {
                setRadio(control.input);
                syncChoiceButtons(tile, buttons);
                updateInspectionProgress();
            });
            grid.appendChild(button);
            control.input.addEventListener("change", () => {
                syncChoiceButtons(tile, buttons);
                updateInspectionProgress();
            });
            return { button, source: control.input, label: control.label };
        });

        syncChoiceButtons(tile, buttons);
        tile.appendChild(grid);
        return tile;
    }

    function buildStatusButtonGroup(tile, statusGroup) {
        const originalButtons = Array.from(statusGroup.querySelectorAll(".status-btn"));
        const hidden = statusGroup.querySelector("input[type='hidden']");
        if (!hidden || !originalButtons.length) {
            return null;
        }

        const grid = document.createElement("div");
        grid.className = "inspection-choice-grid";
        const buttons = originalButtons.map((sourceButton) => {
            const label = text(sourceButton.textContent);
            const value = sourceButton.getAttribute("onclick")?.match(/'([^']+)'/)?.[1] || label;
            const button = makeButton(displayChoiceLabel(value), choiceClass(value), () => {
                sourceButton.click();
                syncChoiceButtons(tile, buttons);
                updateInspectionProgress();
            });
            grid.appendChild(button);
            return { button, source: hidden, label: value };
        });

        syncChoiceButtons(tile, buttons);
        tile.appendChild(grid);
        return tile;
    }

    function buildCheckboxTile(table, row, index) {
        const cells = Array.from(row.children);
        const checkbox = row.querySelector("input[type='checkbox']");
        if (!checkbox || cells.length < 2) {
            return null;
        }

        const tile = createTile(String(index + 1), text(cells[0].textContent), "Safety precaution");
        const grid = document.createElement("div");
        grid.className = "inspection-choice-grid one-choice";
        const button = makeButton("Confirmed", "choice-pass", () => {
            checkbox.checked = !checkbox.checked;
            dispatchFieldChange(checkbox);
            syncChoiceButtons(tile, [{ button, source: checkbox, label: "Confirmed" }]);
        });
        checkbox.addEventListener("change", () => syncChoiceButtons(tile, [{ button, source: checkbox, label: "Confirmed" }]));
        grid.appendChild(button);
        tile.appendChild(grid);
        syncChoiceButtons(tile, [{ button, source: checkbox, label: "Confirmed" }]);
        return tile;
    }

    function buildSimpleChecklist(table) {
        const headers = getHeaderLabels(table);
        const rows = Array.from(table.querySelectorAll("tbody tr")).filter((row) => row.querySelector("input[type='radio'], input[type='checkbox']"));
        const list = document.createElement("div");
        list.className = "inspection-mobile-list";

        rows.forEach((row, index) => {
            if (row.querySelector("input[type='checkbox']") && !row.querySelector("input[type='radio']")) {
                const checkboxTile = buildCheckboxTile(table, row, index);
                if (checkboxTile) {
                    list.appendChild(checkboxTile);
                }
                return;
            }

            const cells = Array.from(row.children);
            const questionCellIndex = cells.length >= 5 && /^\d+$/.test(text(cells[0].textContent)) ? 1 : 0;
            const number = questionCellIndex === 1 ? text(cells[0].textContent) : getQuestionNumber(cells[questionCellIndex]?.textContent, index + 1);
            const title = stripQuestionNumber(cells[questionCellIndex]?.textContent);
            const controls = cells.slice(questionCellIndex + 1)
                .map((cell, controlIndex) => {
                    const input = cell.querySelector("input[type='radio']");
                    if (!input) {
                        return null;
                    }
                    const headerLabel = headers[questionCellIndex + 1 + controlIndex] || input.value || "Option";
                    return { input, label: headerLabel };
                })
                .filter(Boolean);

            if (!title || !controls.length) {
                return;
            }

            list.appendChild(buildRadioChoiceGroup(createTile(number, title), controls));
        });

        return list.children.length ? list : null;
    }

    function buildForkliftCards(table) {
        const rows = Array.from(table.querySelectorAll("tbody tr"));
        const headers = getHeaderLabels(table);
        const cards = [];

        rows.forEach((row) => {
            const cells = Array.from(row.children);
            [
                { start: 0, labels: headers.slice(1, 4) },
                { start: 4, labels: headers.slice(5, 8) }
            ].forEach((group) => {
                const questionCell = cells[group.start];
                if (!questionCell) {
                    return;
                }

                const titleText = text(questionCell.textContent);
                const controls = [1, 2, 3].map((offset, index) => {
                    const input = cells[group.start + offset]?.querySelector("input[type='radio']");
                    return input ? { input, label: group.labels[index] || input.value || "Option" } : null;
                }).filter(Boolean);

                if (titleText && controls.length) {
                    cards.push({
                        number: getQuestionNumber(titleText, cards.length + 1),
                        title: stripQuestionNumber(titleText),
                        controls
                    });
                }
            });
        });

        cards.sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
        const list = document.createElement("div");
        list.className = "inspection-mobile-list";
        cards.forEach((card) => list.appendChild(buildRadioChoiceGroup(createTile(card.number, card.title), card.controls)));
        return list.children.length ? list : null;
    }

    function buildTelehandlerCards(table) {
        const rows = Array.from(table.querySelectorAll("tbody tr"));
        const list = document.createElement("div");
        list.className = "inspection-mobile-list";

        rows.forEach((row, index) => {
            const cells = Array.from(row.children);
            const title = text(cells[0]?.textContent);
            if (!title) {
                return;
            }

            const tile = createTile(String(index + 1), title);
            const dayGrid = document.createElement("div");
            dayGrid.className = "inspection-day-grid";

            for (let i = 1; i < cells.length; i += 2) {
                const defective = cells[i]?.querySelector("input[type='radio']");
                const okay = cells[i + 1]?.querySelector("input[type='radio']");
                if (!defective || !okay) {
                    continue;
                }

                const day = text(defective.getAttribute("aria-label")).replace(/\s*Defective\s*$/i, "");
                const rowEl = document.createElement("div");
                rowEl.className = "inspection-day-row";
                const dayLabel = document.createElement("div");
                dayLabel.className = "inspection-day-label";
                dayLabel.textContent = day;
                const controls = document.createElement("div");
                controls.className = "inspection-choice-grid two-choice";
                const buttonSet = [
                    { input: defective, label: "Defective" },
                    { input: okay, label: "Okay" }
                ].map((control) => {
                    const button = makeButton(displayChoiceLabel(control.label), choiceClass(control.label), () => {
                        setRadio(control.input);
                        syncChoiceButtons(tile, buttonSet);
                        updateInspectionProgress();
                    });
                    controls.appendChild(button);
                    control.input.addEventListener("change", () => {
                        syncChoiceButtons(tile, buttonSet);
                        updateInspectionProgress();
                    });
                    return { button, source: control.input, label: control.label };
                });
                syncChoiceButtons(tile, buttonSet);
                rowEl.appendChild(dayLabel);
                rowEl.appendChild(controls);
                dayGrid.appendChild(rowEl);
            }

            if (dayGrid.children.length) {
                tile.appendChild(dayGrid);
                list.appendChild(tile);
            }
        });

        return list.children.length ? list : null;
    }

    function buildHarnessCards(table) {
        const rows = Array.from(table.querySelectorAll("tbody tr, table > tr"));
        const list = document.createElement("div");
        list.className = "inspection-mobile-list";

        rows.forEach((row, index) => {
            const statusGroup = row.querySelector(".status-group");
            if (!statusGroup) {
                return;
            }

            const cells = Array.from(row.children);
            const title = [text(cells[0]?.textContent), text(cells[1]?.textContent)].filter(Boolean).join(" - ");
            const tile = createTile(String(index + 1), title);
            const conditionInput = cells[2]?.querySelector("input[type='text']");
            if (conditionInput) {
                const cloneWrap = document.createElement("div");
                cloneWrap.className = "inspection-tile-meta";
                cloneWrap.textContent = "Current condition";
                tile.appendChild(cloneWrap);
                const proxy = document.createElement("input");
                proxy.type = "text";
                proxy.dataset.inspectionSkip = "true";
                proxy.value = conditionInput.value || "";
                proxy.placeholder = conditionInput.placeholder || "";
                proxy.addEventListener("input", () => {
                    conditionInput.value = proxy.value;
                    dispatchFieldChange(conditionInput);
                });
                conditionInput.addEventListener("input", () => {
                    if (proxy.value !== conditionInput.value) {
                        proxy.value = conditionInput.value;
                    }
                });
                tile.appendChild(proxy);
            }

            const built = buildStatusButtonGroup(tile, statusGroup);
            if (built) {
                list.appendChild(built);
            }
        });

        return list.children.length ? list : null;
    }

    function classifyTable(table) {
        const headerText = getHeaderLabels(table).join(" ").toLowerCase();
        if (table.querySelector(".status-group")) {
            return "harness";
        }
        if (headerText.includes("monday defective") || headerText.includes("sunday okay")) {
            return "telehandler";
        }
        if (headerText.includes("visual inspection") && headerText.includes("operational inspection")) {
            return "forklift";
        }
        if (table.querySelector("input[type='radio'], input[type='checkbox']")) {
            return "simple";
        }
        return "";
    }

    function enhanceTables() {
        const tables = Array.from(document.querySelectorAll(".container table"));
        tables.forEach((table) => {
            const mode = classifyTable(table);
            if (!mode) {
                return;
            }

            let list = null;
            if (mode === "harness") {
                list = buildHarnessCards(table);
            } else if (mode === "telehandler") {
                list = buildTelehandlerCards(table);
            } else if (mode === "forklift") {
                list = buildForkliftCards(table);
            } else {
                list = buildSimpleChecklist(table);
            }

            if (!list) {
                return;
            }

            const wrap = table.closest(".table-wrap") || table;
            wrap.classList.add("inspection-mobile-source");
            wrap.insertAdjacentElement("afterend", list);
        });
    }

    function getProgressGroups() {
        const radioGroups = new Map();
        document.querySelectorAll(".inspection-mobile-source input[type='radio'][name]").forEach((input) => {
            if (!radioGroups.has(input.name)) {
                radioGroups.set(input.name, []);
            }
            radioGroups.get(input.name).push(input);
        });

        const groups = Array.from(radioGroups.values()).map((inputs) => ({
            complete: () => inputs.some((input) => input.checked)
        }));

        document.querySelectorAll(".inspection-mobile-source .status-group input[type='hidden']").forEach((input) => {
            groups.push({ complete: () => Boolean(text(input.value)) });
        });

        return groups;
    }

    function ensureProgressCard() {
        const groups = getProgressGroups();
        if (!groups.length || document.querySelector(".inspection-progress-card")) {
            return;
        }

        const card = document.createElement("div");
        card.className = "inspection-progress-card";
        card.innerHTML = [
            '<div class="inspection-progress-top">',
            '<span>Inspection Progress</span>',
            '<span class="inspection-progress-count">0 of 0 completed</span>',
            '</div>',
            '<div class="inspection-progress-track"><div class="inspection-progress-fill"></div></div>'
        ].join("");

        const heading = document.querySelector(".container h2") || document.querySelector(".container .subtitle") || document.querySelector(".container h1");
        if (heading) {
            heading.insertAdjacentElement("afterend", card);
        }
    }

    window.updateInspectionProgress = function() {
        const card = document.querySelector(".inspection-progress-card");
        if (!card) {
            return;
        }

        const groups = getProgressGroups();
        const complete = groups.filter((group) => group.complete()).length;
        const total = groups.length;
        const percent = total ? Math.round((complete / total) * 100) : 0;
        const count = card.querySelector(".inspection-progress-count");
        const fill = card.querySelector(".inspection-progress-fill");

        if (count) {
            count.textContent = complete + " of " + total + " completed";
        }
        if (fill) {
            fill.style.width = percent + "%";
        }
    };

    function init() {
        document.body.classList.add("inspection-mobile-enhanced");
        enhanceSourceRadioButtons();
        enhanceTables();
        ensureProgressCard();
        document.querySelectorAll("input[type='radio'], input[type='checkbox'], .status-group input[type='hidden']").forEach((field) => {
            field.addEventListener("change", window.updateInspectionProgress);
            field.addEventListener("input", window.updateInspectionProgress);
        });
        window.updateInspectionProgress();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
