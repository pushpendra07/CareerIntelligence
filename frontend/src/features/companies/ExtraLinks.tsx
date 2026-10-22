import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../../api/client";
import { ErrorBox } from "../../components/ui";
import type { ExtraLink } from "../../types/api";
import { formatDateTime } from "../../utils/format";

const PORTALS: Record<string, string> = {
  naukri: "Naukri", linkedin: "LinkedIn", monster: "Monster", foundit: "Foundit", indeed: "Indeed",
  glassdoor: "Glassdoor", ambitionbox: "AmbitionBox", instahyre: "Instahyre", wellfound: "Wellfound", cutshort: "Cutshort",
};

export const portalLabel = (portal: string) => PORTALS[portal] ?? portal;

/** The company's pages on job portals, as small links. */
export function ExtraLinkList({ links }: { links?: ExtraLink[] }) {
  if (!links?.length) return <>—</>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {links.map((l) => (
        <a key={l.url} className="link" href={l.url} target="_blank" rel="noopener noreferrer"
          title={`${l.url}${l.added_at ? ` · added ${formatDateTime(l.added_at, true)}` : ""}${l.source ? ` · from ${l.source}` : ""}`}>
          {portalLabel(l.portal)} ↗
        </a>
      ))}
    </span>
  );
}

/** Extra links with an editor: one URL per line (Naukri, LinkedIn, Monster, Foundit…). */
export function ExtraLinks({ companyId, links }: { companyId: number; links?: ExtraLink[] }) {
  const qc = useQueryClient();
  const [text, setText] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (urls: string[]) => api.patch(`/companies/${companyId}`, { extra_links: urls }),
    onSuccess: () => { setText(null); qc.invalidateQueries(); },
    meta: { success: "Extra links saved" },
  });
  if (text === null) {
    return (
      <span className="flex flex-wrap items-center gap-3">
        <ExtraLinkList links={links} />
        <button type="button" className="text-xs text-slate-500 hover:text-indigo-700"
          onClick={() => setText((links ?? []).map((l) => l.url).join("\n"))}>Edit</button>
      </span>
    );
  }
  return (
    <div className="w-full space-y-2">
      <textarea className="input min-h-20 text-xs" aria-label="Extra links" value={text} onChange={(e) => setText(e.target.value)}
        placeholder={"One link per line, e.g.\nhttps://www.naukri.com/acme-overview-123\nhttps://www.linkedin.com/company/acme"} />
      {save.error && <ErrorBox error={new Error(errorMessage(save.error))} />}
      <div className="flex gap-2">
        <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={save.isPending}
          onClick={() => save.mutate(text.split(/\s+/).filter(Boolean))}>Save links</button>
        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setText(null)}>Cancel</button>
      </div>
    </div>
  );
}
