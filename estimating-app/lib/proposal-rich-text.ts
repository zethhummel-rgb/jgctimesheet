export type ProposalTextHighlight = "yellow" | "green";
export type ProposalTextSize = "small" | "normal" | "large";

export type ProposalTextStyle = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  highlight?: ProposalTextHighlight;
  size: ProposalTextSize;
};

export type ProposalTextRun = {
  text: string;
  style: ProposalTextStyle;
};

export type ProposalFormatCommand = "bold" | "italic" | "underline" | "highlight-yellow" | "highlight-green" | "small" | "large";

export const proposalFormatTokens: Record<ProposalFormatCommand, [string, string]> = {
  bold: ["[b]", "[/b]"],
  italic: ["[i]", "[/i]"],
  underline: ["[u]", "[/u]"],
  "highlight-yellow": ["[hy]", "[/hy]"],
  "highlight-green": ["[hg]", "[/hg]"],
  small: ["[sm]", "[/sm]"],
  large: ["[lg]", "[/lg]"],
};

export const defaultClosingProposalScopeLine = "Demobilize and leave site in a clean fashion";

const tokenPattern = /\[(\/)?(b|i|u|hy|hg|sm|lg)\]/gi;

function copyStyle(style: ProposalTextStyle): ProposalTextStyle {
  return { ...style };
}

export function proposalTextRuns(value?: string): ProposalTextRun[] {
  const source = String(value ?? "");
  const runs: ProposalTextRun[] = [];
  const stack: Array<{ token: string; previous: ProposalTextStyle }> = [];
  let style: ProposalTextStyle = { bold: false, italic: false, underline: false, size: "normal" };
  let cursor = 0;
  let match: RegExpExecArray | null;
  tokenPattern.lastIndex = 0;
  while ((match = tokenPattern.exec(source))) {
    if (match.index > cursor) runs.push({ text: source.slice(cursor, match.index), style: copyStyle(style) });
    const closing = Boolean(match[1]);
    const token = match[2].toLowerCase();
    if (!closing) {
      stack.push({ token, previous: copyStyle(style) });
      if (token === "b") style.bold = true;
      else if (token === "i") style.italic = true;
      else if (token === "u") style.underline = true;
      else if (token === "hy") style.highlight = "yellow";
      else if (token === "hg") style.highlight = "green";
      else if (token === "sm") style.size = "small";
      else if (token === "lg") style.size = "large";
    } else {
      const stackIndex = stack.map((entry) => entry.token).lastIndexOf(token);
      if (stackIndex >= 0) {
        style = copyStyle(stack[stackIndex].previous);
        stack.splice(stackIndex);
      }
    }
    cursor = tokenPattern.lastIndex;
  }
  if (cursor < source.length) runs.push({ text: source.slice(cursor), style: copyStyle(style) });
  return runs.length ? runs : [{ text: "", style }];
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function proposalTextHtml(value?: string) {
  return proposalTextRuns(value).map((run) => {
    let html = escapeHtml(run.text).replace(/\n/g, "<br>");
    if (run.style.bold) html = `<strong>${html}</strong>`;
    if (run.style.italic) html = `<em>${html}</em>`;
    if (run.style.underline) html = `<u>${html}</u>`;
    if (run.style.highlight) html = `<mark class="proposal-highlight-${run.style.highlight}">${html}</mark>`;
    if (run.style.size !== "normal") html = `<span class="proposal-font-${run.style.size}">${html}</span>`;
    return html;
  }).join("");
}

export function proposalTextPlain(value?: string) {
  return proposalTextRuns(value).map((run) => run.text).join("");
}

export function proposalTextLines(value?: string) {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => proposalTextPlain(line).trim().length > 0);
}

export function isDefaultClosingProposalScopeLine(value?: string) {
  const plain = proposalTextPlain(value).trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return plain === defaultClosingProposalScopeLine.toLocaleLowerCase()
    || plain === "demobilize and leave the site in a clean fashion";
}

export function normalizeProposalScopeClosingLine(value?: string, removed = false) {
  const lines = String(value ?? "").replace(/\r/g, "").split("\n");
  if (removed) return lines.join("\n");
  const otherLines = lines.filter((line) => !isDefaultClosingProposalScopeLine(line));
  const meaningfulLines = otherLines.filter((line) => proposalTextPlain(line).trim().length > 0);
  const editableLines = meaningfulLines.length ? meaningfulLines : [""];
  return [...editableLines, defaultClosingProposalScopeLine].join("\n");
}
