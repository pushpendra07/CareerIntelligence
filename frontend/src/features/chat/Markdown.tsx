import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * The small Markdown the assistant writes: paragraphs, "-"/"1." lists, **bold**, `code`,
 * [links](/jobs/12). Links inside the app open in place; others in a new tab. Never renders HTML.
 */
export function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l) || !l.trim())) {
          const ordered = /^\s*\d/.test(lines[0]);
          const items = lines.filter((l) => l.trim()).map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
          const List = ordered ? "ol" : "ul";
          return <List key={i} className={`space-y-0.5 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</List>;
        }
        if (/^#{1,4}\s/.test(lines[0])) {
          return <p key={i} className="font-semibold">{inline(lines[0].replace(/^#+\s/, ""))}{lines.slice(1).map((l, j) => <Fragment key={j}><br />{inline(l)}</Fragment>)}</p>;
        }
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>;
      })}
    </div>
  );
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<b key={m.index}>{m[1]}</b>);
    else if (m[2] !== undefined) out.push(<code key={m.index} className="rounded bg-slate-100 px-1 text-[0.9em]">{m[2]}</code>);
    else {
      const href = m[4];
      out.push(href.startsWith("/")
        ? <Link key={m.index} className="link" to={href}>{m[3]}</Link>
        : /^https?:\/\//.test(href)
          ? <a key={m.index} className="link" href={href} target="_blank" rel="noopener noreferrer">{m[3]}</a>
          : m[3]);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
