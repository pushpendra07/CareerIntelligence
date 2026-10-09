import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Badge, Card, Chips, ErrorBox, Spinner } from "../../components/ui";
import { humanize } from "../../utils/format";

interface Prep {
  job: { id: number; title: string; company: string; match_score: number | null };
  interview: { id: number; round_number: number; round_type: string } | null;
  job_requirements: { responsibilities: string[]; required_skills: string[]; preferred_skills: string[]; qualifications: string[] };
  matched_skills: string[];
  partial_skills: string[];
  missing_skills: string[];
  likely_topics: string[];
  relevant_questions: { id: number; question: string; category: string; confidence: number | null; has_my_answer: boolean }[];
  cv_highlights: { summary: string | null; achievements: string[]; certifications: string[]; total_experience_years: number | null };
  projects_to_discuss: { name: string; platform: string | null; relevant_skills: string[]; highlights: string[] }[];
  technical_preparation: string[];
  behavioral_preparation: string[];
  questions_to_ask: string[];
}

interface Suggestion { question: string; category: string; technology: string | null; difficulty: string | null; expected_answer: string | null }

function List({ items }: { items: string[] }) {
  return items.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((t) => <li key={t}>{t}</li>)}</ul> : <p className="text-sm text-slate-400">—</p>;
}

export function PrepPage({ kind }: { kind: "job" | "interview" }) {
  const { id } = useParams();
  const qc = useQueryClient();
  const path = kind === "job" ? `/jobs/${id}/prep` : `/interviews/${id}/prep`;
  const prep = useQuery({ queryKey: ["prep", kind, id], queryFn: () => api.get<Prep>(path) });
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<{ enabled: boolean; reason?: string }>("/ai/status") });
  const suggest = useMutation({
    mutationFn: () => api.post<{ suggestions: Suggestion[] }>(`/ai/jobs/${prep.data!.job.id}/interview-questions`, { round_type: prep.data!.interview?.round_type ?? null }),
  });
  const save = useMutation({
    mutationFn: (s: Suggestion) => api.post("/questions", { ...s, job_id: prep.data!.job.id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prep"] }),
  });
  if (prep.isLoading) return <Spinner label="Building prep…" />;
  if (prep.error) return <ErrorBox error={prep.error} />;
  const p = prep.data!;
  return (
    <div className="space-y-4">
      <div>
        <h1>Interview prep{p.interview && ` — Round ${p.interview.round_number} ${humanize(p.interview.round_type)}`}</h1>
        <p className="text-sm text-slate-600"><Link className="link" to={`/jobs/${p.job.id}`}>{p.job.title}</Link> · {p.job.company} {p.job.match_score !== null && <Badge tone="indigo">{p.job.match_score}/100</Badge>}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Job requirements" className="lg:col-span-2">
          <div className="space-y-2">
            <div><div className="label">Required</div><Chips items={p.job_requirements.required_skills} tone="indigo" /></div>
            <div><div className="label">Preferred</div><Chips items={p.job_requirements.preferred_skills} /></div>
            <List items={p.job_requirements.responsibilities} />
          </div>
        </Card>
        <Card title="Your fit">
          <div className="space-y-2">
            <div><div className="label">Matched</div><Chips items={p.matched_skills} tone="green" /></div>
            <div><div className="label">Partial / related</div><Chips items={p.partial_skills} tone="amber" /></div>
            <div><div className="label">Missing</div><Chips items={p.missing_skills} tone="red" empty="None" /></div>
          </div>
        </Card>
        <Card title="Likely interview topics"><List items={p.likely_topics} /></Card>
        <Card title="Technical preparation"><List items={p.technical_preparation} /></Card>
        <Card title="Behavioral preparation"><List items={p.behavioral_preparation} /></Card>
        <Card title="Projects to discuss" className="lg:col-span-2">
          {p.projects_to_discuss.length ? p.projects_to_discuss.map((pr) => (
            <div key={pr.name} className="mb-3">
              <div className="font-medium">{pr.name} {pr.platform && <span className="text-sm text-slate-500">({pr.platform})</span>}</div>
              <Chips items={pr.relevant_skills} tone="indigo" />
              <List items={pr.highlights} />
            </div>
          )) : <p className="text-sm text-slate-500">Import a CV into your profile to get project suggestions.</p>}
        </Card>
        <Card title="CV highlights">
          {p.cv_highlights.total_experience_years !== null && <p className="text-sm">{p.cv_highlights.total_experience_years} years experience</p>}
          <Chips items={p.cv_highlights.certifications} tone="green" />
          <div className="mt-2"><List items={p.cv_highlights.achievements} /></div>
        </Card>
        <Card title="Questions from your bank" className="lg:col-span-2">
          {p.relevant_questions.length ? (
            <ul className="space-y-1 text-sm">{p.relevant_questions.map((q) => (
              <li key={q.id}>{q.question} <span className="text-xs text-slate-500">· {q.category}{q.confidence !== null && ` · confidence ${q.confidence}/5`}{!q.has_my_answer && " · no answer yet"}</span></li>
            ))}</ul>
          ) : <p className="text-sm text-slate-500">No matching questions yet. <Link className="link" to="/questions">Add some</Link>.</p>}
        </Card>
        <Card title="Questions to ask them"><List items={p.questions_to_ask} /></Card>
        <Card title="AI-suggested questions (optional)" className="lg:col-span-3"
          actions={ai.data?.enabled ? <button className="btn-secondary" disabled={suggest.isPending} onClick={() => suggest.mutate()}>{suggest.isPending ? "Generating…" : "Suggest questions"}</button> : undefined}>
          {!ai.data?.enabled && <p className="text-sm text-slate-500">AI is not configured ({ai.data?.reason ?? "AI_PROVIDER=none"}). Everything above works without it.</p>}
          {suggest.error && <ErrorBox error={new Error(errorMessage(suggest.error))} />}
          {suggest.data?.suggestions.map((s) => (
            <div key={s.question} className="flex items-start justify-between gap-3 border-t border-slate-100 py-2 text-sm">
              <div><div>{s.question}</div><div className="text-xs text-slate-500">{s.category}{s.difficulty && ` · ${humanize(s.difficulty)}`}{s.expected_answer && ` · ${s.expected_answer}`}</div></div>
              <button className="btn-secondary shrink-0" onClick={() => save.mutate(s)}>Save to bank</button>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
