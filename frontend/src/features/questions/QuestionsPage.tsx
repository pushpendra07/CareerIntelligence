import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../../api/client";
import { Badge, Card, Empty, ErrorBox, Field, Pagination, Spinner, PAGE_SIZE, PageIntro } from "../../components/ui";
import type { Page, Question } from "../../types/api";
import { formatDate, humanize } from "../../utils/format";
import { ROUNDS } from "../interviews/InterviewsPage";

export const CATEGORIES = ["PHP", "Magento 2", "Adobe Commerce", "MySQL", "GraphQL", "REST", "System Design", "Coding",
  "AWS", "Docker", "Redis", "RabbitMQ", "React", "Python", "FastAPI", "Behavioral", "Leadership", "Other"];
const EMPTY = { question: "", category: "Magento 2", technology: "", difficulty: "", round_type: "", expected_answer: "", my_answer: "" };

function QuestionRow({ q }: { q: Question }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState(q.my_answer ?? "");
  const practice = useMutation({
    mutationFn: (confidence: number) => api.post(`/questions/${q.id}/practice`, { confidence, my_answer: answer || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["questions"] }),
  });
  return (
    <li className="py-2">
      <button className="w-full text-left" onClick={() => setOpen((o) => !o)}>
        <div className="font-medium">{q.question}</div>
        <div className="mt-0.5 flex flex-wrap gap-1 text-xs">
          <Badge tone="indigo">{q.category}</Badge>{q.technology && <Badge>{q.technology}</Badge>}{q.difficulty && <Badge>{humanize(q.difficulty)}</Badge>}
          {q.confidence !== null && <Badge tone={q.confidence >= 4 ? "green" : q.confidence >= 3 ? "amber" : "red"}>confidence {q.confidence}/5</Badge>}
          <span className="text-slate-400">practiced {q.times_practiced}× · last {formatDate(q.last_practiced_at)}</span>
        </div>
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded bg-slate-50 p-3">
          {q.expected_answer && <div><div className="label">Expected answer</div><p className="whitespace-pre-wrap text-sm">{q.expected_answer}</p></div>}
          <Field label="My answer"><textarea className="input" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} /></Field>
          <div className="flex items-center gap-1 text-sm">How confident now?
            {[1, 2, 3, 4, 5].map((n) => <button key={n} className="btn-secondary px-2" onClick={() => practice.mutate(n)}>{n}</button>)}
          </div>
        </div>
      )}
    </li>
  );
}

export function QuestionsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ q: "", category: "", max_confidence: "", sort: "-updated_at" });
  const list = useQuery({ queryKey: ["questions", filters, page], queryFn: () => api.get<Page<Question>>("/questions", { ...filters, page, size: PAGE_SIZE }) });
  const [form, setForm] = useState(EMPTY);
  const create = useMutation({
    mutationFn: () => api.post("/questions", Object.fromEntries(Object.entries(form).filter(([, v]) => v))),
    onSuccess: () => { setForm(EMPTY); qc.invalidateQueries({ queryKey: ["questions"] }); },
  });
  return (
    <div className="space-y-4">
      <div><h1>Interview question bank</h1><PageIntro>Questions you've been asked (or expect), with your best answers. They're suggested again when you prepare for similar jobs.</PageIntro></div>
      <Card title="Add question">
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="sm:col-span-4"><Field label="Question *"><textarea className="input" rows={2} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} /></Field></div>
          <Field label="Category"><select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Technology"><input className="input" value={form.technology} onChange={(e) => setForm({ ...form, technology: e.target.value })} /></Field>
          <Field label="Difficulty"><select className="input" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}><option value="">—</option><option>EASY</option><option>MEDIUM</option><option>HARD</option></select></Field>
          <Field label="Round"><select className="input" value={form.round_type} onChange={(e) => setForm({ ...form, round_type: e.target.value })}><option value="">—</option>{ROUNDS.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</select></Field>
          <div className="sm:col-span-2"><Field label="Expected answer"><textarea className="input" rows={2} value={form.expected_answer} onChange={(e) => setForm({ ...form, expected_answer: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Field label="My answer"><textarea className="input" rows={2} value={form.my_answer} onChange={(e) => setForm({ ...form, my_answer: e.target.value })} /></Field></div>
        </div>
        {create.error && <div className="mt-2"><ErrorBox error={new Error(errorMessage(create.error))} /></div>}
        <button className="btn-primary mt-3" disabled={form.question.trim().length < 3 || create.isPending} onClick={() => create.mutate()}>Add</button>
      </Card>
      <Card>
        <div className="mb-3 grid gap-2 sm:grid-cols-4">
          <input className="input" placeholder="Search" aria-label="Search questions" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          <select className="input" aria-label="Category filter" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}><option value="">Any category</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <select className="input" aria-label="Confidence filter" value={filters.max_confidence} onChange={(e) => setFilters({ ...filters, max_confidence: e.target.value })}><option value="">Any confidence</option><option value="2">Weak (≤ 2)</option><option value="3">≤ 3</option></select>
          <select className="input" aria-label="Sort questions" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}><option value="-updated_at">Recently updated</option><option value="last_practiced">Least recently practiced</option><option value="confidence">Lowest confidence</option></select>
        </div>
        {list.isLoading && <Spinner />}
        {list.data && (!list.data.items.length ? <Empty>No questions yet.</Empty> : <ul className="divide-y divide-slate-100">{list.data.items.map((q) => <QuestionRow key={q.id} q={q} />)}</ul>)}
        {list.data && <Pagination page={page} size={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
