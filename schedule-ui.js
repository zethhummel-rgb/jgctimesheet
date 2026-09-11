/* Shared calendar presentation and quarter-hour controls. Saved times stay in HH:mm. */
(function () {
  const pickers = new Map();
  let activePicker = null;

  function formatTime(value, compact = false) {
    if (!value) return "";
    const [hour, minute] = String(value).slice(0, 5).split(":").map(Number);
    return (hour % 12 || 12) + (compact && !minute ? "" : ":" + String(minute).padStart(2, "0")) + " " + (hour < 12 ? "AM" : "PM");
  }

  function eventTitle(event, fallback = "Event") {
    const title = String(event.title || "").trim();
    const job = String(event.job_name || "").trim();
    const isWork = !event.event_type || event.event_type === "work";
    return isWork && title && job && title.toLowerCase() !== job.toLowerCase()
      ? title + " — " + job
      : title || job || event.location || fallback;
  }

  function closeTimePicker(restoreFocus = false) {
    if (!activePicker) return false;
    const picker = activePicker;
    picker.panel.hidden = true;
    picker.trigger.setAttribute("aria-expanded", "false");
    activePicker = null;
    if (restoreFocus) picker.trigger.focus({ preventScroll: true });
    return true;
  }

  function setTime(id, value) {
    const input = document.getElementById(id);
    if (!input) return;
    input.dataset.previousTime = input.value;
    input.value = String(value || "").slice(0, 5);
    const picker = pickers.get(id);
    if (picker) picker.trigger.textContent = formatTime(input.value) || "Choose time";
  }

  function linkTimeFields(startId, endId) {
    const start = document.getElementById(startId);
    if (!start || start.dataset.linkedEnd) return;
    start.dataset.linkedEnd = endId;
    start.addEventListener("change", () => {
      const toMinutes = (value) => {
        if (!value) return NaN;
        const [hour, minute] = value.split(":").map(Number);
        return hour * 60 + minute;
      };
      const oldStart = toMinutes(start.dataset.previousTime);
      const newStart = toMinutes(start.value);
      const oldEnd = toMinutes(document.getElementById(endId).value);
      const duration = Number.isFinite(oldEnd - oldStart) ? ((oldEnd - oldStart + 1440) % 1440 || 30) : 30;
      const newEnd = (newStart + duration) % 1440;
      setTime(endId, String(Math.floor(newEnd / 60)).padStart(2, "0") + ":" + String(newEnd % 60).padStart(2, "0"));
    });
  }

  function createTimePicker(id, label) {
    const input = document.getElementById(id);
    if (!input || pickers.has(id)) return;
    input.type = "hidden";
    const wrap = document.createElement("div");
    wrap.className = "schedule-time-picker";
    input.before(wrap);
    wrap.append(input);
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "schedule-time-trigger";
    trigger.id = id + "Button";
    trigger.setAttribute("aria-label", label);
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", id + "Picker");
    const panel = document.createElement("div");
    panel.id = id + "Picker";
    panel.className = "schedule-time-popover";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", label + " picker");
    wrap.append(trigger, panel);
    document.querySelector('label[for="' + id + '"]')?.setAttribute("for", trigger.id);
    const picker = { input, trigger, panel, wrap };
    pickers.set(id, picker);

    function render() {
      const [hour, minute] = (input.value || "07:00").split(":").map(Number);
      panel.replaceChildren();
      const heading = document.createElement("strong");
      heading.className = "schedule-time-heading";
      heading.textContent = formatTime(input.value || "07:00");
      panel.append(heading);
      const columns = document.createElement("div");
      columns.className = "schedule-time-columns";
      const values = [
        { name: "Hour", choices: Array.from({ length: 12 }, (_, i) => i + 1), selected: hour % 12 || 12 },
        // Keep an existing off-quarter time until the user deliberately changes it.
        { name: "Minute", choices: [...new Set([0, 15, 30, 45, minute])].sort((a, b) => a - b), selected: minute },
        { name: "Period", choices: ["AM", "PM"], selected: hour < 12 ? "AM" : "PM" }
      ];
      values.forEach(({ name, choices, selected }) => {
        const group = document.createElement("div");
        group.className = "schedule-time-group schedule-time-" + name.toLowerCase();
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", name);
        const caption = document.createElement("span");
        caption.textContent = name;
        group.append(caption);
        choices.forEach((choice) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = name === "Minute" ? String(choice).padStart(2, "0") : choice;
          button.setAttribute("aria-pressed", String(choice === selected));
          button.addEventListener("click", () => {
            let nextHour = hour;
            let nextMinute = minute;
            if (name === "Hour") nextHour = choice % 12 + (hour >= 12 ? 12 : 0);
            if (name === "Minute") nextMinute = choice;
            if (name === "Period") nextHour = hour % 12 + (choice === "PM" ? 12 : 0);
            setTime(id, String(nextHour).padStart(2, "0") + ":" + String(nextMinute).padStart(2, "0"));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            render();
            const nextGroup = panel.querySelector('[aria-label="' + name + '"]');
            nextGroup.querySelector('[aria-pressed="true"]').focus({ preventScroll: true });
          });
          group.append(button);
        });
        columns.append(group);
      });
      panel.append(columns);
      const done = document.createElement("button");
      done.type = "button";
      done.className = "schedule-time-done";
      done.textContent = "Done";
      done.addEventListener("click", () => closeTimePicker(true));
      panel.append(done);
    }

    trigger.addEventListener("click", () => {
      if (activePicker === picker) { closeTimePicker(); return; }
      closeTimePicker();
      activePicker = picker;
      render();
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      panel.classList.toggle("align-right", wrap.getBoundingClientRect().left + 280 > document.documentElement.clientWidth - 12);
      panel.querySelector('[aria-pressed="true"]').focus({ preventScroll: true });
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeTimePicker(true);
      }
    });
    input.addEventListener("change", () => { trigger.textContent = formatTime(input.value) || "Choose time"; });
    setTime(id, input.value);
  }

  document.addEventListener("pointerdown", (event) => {
    if (activePicker && !activePicker.wrap.contains(event.target)) closeTimePicker();
  });
  document.addEventListener("focusin", (event) => {
    if (activePicker && !activePicker.wrap.contains(event.target)) closeTimePicker();
  });
  window.JgcScheduleUI = { createTimePicker, setTime, linkTimeFields, closeTimePicker, formatTime, eventTitle };
})();
