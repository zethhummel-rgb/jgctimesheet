(function () {
    "use strict";

    const DAY_MS = 24 * 60 * 60 * 1000;

    function parseDate(value) {
        if (!value) {
            return null;
        }

        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
        }

        const text = String(value).trim();
        const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        const parsed = dateOnly
            ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
            : new Date(text);

        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function isOlderThanDays(value, days, now) {
        const date = parseDate(value);

        if (!date) {
            return false;
        }

        const cutoff = parseDate(now) || new Date();
        cutoff.setHours(0, 0, 0, 0);
        cutoff.setTime(cutoff.getTime() - Math.max(Number(days) || 0, 0) * DAY_MS);
        date.setHours(0, 0, 0, 0);
        return date < cutoff;
    }

    function groupByMonth(items, getDateValue) {
        const groups = new Map();

        (Array.isArray(items) ? items : []).forEach((item) => {
            const date = parseDate(typeof getDateValue === "function" ? getDateValue(item) : "");
            const key = date
                ? date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0")
                : "undated";

            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    label: date
                        ? date.toLocaleDateString("en-CA", { month: "long", year: "numeric" })
                        : "Undated",
                    sortTime: date ? new Date(date.getFullYear(), date.getMonth(), 1).getTime() : -1,
                    items: []
                });
            }

            groups.get(key).items.push(item);
        });

        return Array.from(groups.values()).sort((a, b) => b.sortTime - a.sortTime);
    }

    window.JgcAdminHousekeeping = Object.freeze({
        inspectionArchiveDays: 60,
        parseDate,
        isOlderThanDays,
        groupByMonth
    });
})();
