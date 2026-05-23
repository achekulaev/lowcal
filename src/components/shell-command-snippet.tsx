export type ShellCommandPart =
  | { kind: "invoke"; value: string }
  | { kind: "separator"; value: string }
  | { kind: "text"; value: string };

const SEPARATOR_CHARS = new Set([";", "|", "&"]);
const WHITESPACE_RE = /\s/;

/**
 * Walk `command` once and return an ordered list of parts:
 *   - `invoke`: the first non-whitespace token of a sub-command (the program
 *     being run). Rendered with the accent colour so the eye can scan a
 *     composite command and pick out every program being invoked.
 *   - `text`: everything else — leading whitespace, arguments, quoted
 *     strings, and the sequencing operators themselves.
 *
 * Sub-command boundaries are the standard shell sequencing operators
 * `&&`, `||`, `;`, `|`, and `&` when they appear outside single- or
 * double-quoted strings, so e.g. `echo "a; b" ; ls` only splits at the
 * final `;` and the inner `;` stays inside the quoted argument.
 *
 * We intentionally don't try to handle ANSI-C `$'…'` quoting, heredocs,
 * `$(…)` sub-shells, or `( … )` groups — they would also start a fresh
 * invocation in real shells, but the snippet is just a visual hint and
 * the common cases (`&&`, `;`, `|`) cover what users actually compose.
 */
export function parseShellCommandParts(command: string): ShellCommandPart[] {
  const t = command.trim();
  if (!t) return [];

  const parts: ShellCommandPart[] = [];
  const push = (kind: ShellCommandPart["kind"], value: string) => {
    if (!value) return;
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.value += value;
    else parts.push({ kind, value });
  };

  let i = 0;
  let expectInvoke = true;
  let inSingle = false;
  let inDouble = false;
  let escapeNext = false; // only meaningful inside double quotes

  while (i < t.length) {
    const ch = t[i];

    if (inSingle) {
      push("text", ch);
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      push("text", ch);
      if (escapeNext) escapeNext = false;
      else if (ch === "\\") escapeNext = true;
      else if (ch === '"') inDouble = false;
      i++;
      continue;
    }

    if (ch === "'") {
      push("text", ch);
      inSingle = true;
      i++;
      continue;
    }
    if (ch === '"') {
      push("text", ch);
      inDouble = true;
      i++;
      continue;
    }

    // Sequencing operators (outside quotes) — emit as `separator` so the
    // renderer can tint them distinctly, and arm `expectInvoke` so the
    // next non-whitespace token becomes the invoke.
    if (t.startsWith("&&", i)) {
      push("separator", "&&");
      expectInvoke = true;
      i += 2;
      continue;
    }
    if (t.startsWith("||", i)) {
      push("separator", "||");
      expectInvoke = true;
      i += 2;
      continue;
    }
    if (SEPARATOR_CHARS.has(ch)) {
      push("separator", ch);
      expectInvoke = true;
      i++;
      continue;
    }

    if (WHITESPACE_RE.test(ch)) {
      push("text", ch);
      i++;
      continue;
    }

    if (expectInvoke) {
      let j = i;
      while (j < t.length) {
        const c = t[j];
        if (WHITESPACE_RE.test(c)) break;
        if (c === "'" || c === '"') break;
        if (SEPARATOR_CHARS.has(c)) break;
        j++;
      }
      push("invoke", t.slice(i, j));
      i = j;
      expectInvoke = false;
      continue;
    }

    push("text", ch);
    i++;
  }

  return parts;
}

const PART_CLASS: Record<ShellCommandPart["kind"], string> = {
  invoke: "terminal-cmd-snippet-invoke",
  separator: "terminal-cmd-snippet-separator",
  text: "terminal-cmd-snippet-tail",
};

export function ShellCommandSnippet({ command }: { command: string }) {
  const parts = parseShellCommandParts(command);
  return (
    <pre className="terminal-cmd-snippet">
      <code>
        {parts.map((part, idx) => (
          <span key={idx} className={PART_CLASS[part.kind]}>
            {part.value}
          </span>
        ))}
      </code>
    </pre>
  );
}
