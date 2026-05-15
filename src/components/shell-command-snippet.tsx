export function splitLeadingShellToken(command: string): { head: string; tail: string } {
  const t = command.trim();
  if (!t) return { head: "", tail: "" };
  const m = /^(\S+)([\s\S]*)?$/.exec(t);
  return m ? { head: m[1], tail: m[2] ?? "" } : { head: "", tail: "" };
}

export function ShellCommandSnippet({ command }: { command: string }) {
  const { head, tail } = splitLeadingShellToken(command);
  return (
    <pre className="terminal-cmd-snippet">
      <code>
        <span className="terminal-cmd-snippet-invoke">{head}</span>
        <span className="terminal-cmd-snippet-tail">{tail}</span>
      </code>
    </pre>
  );
}
