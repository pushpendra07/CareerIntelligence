import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../../api/client";
import { AUTH_KEY } from "../../components/AuthGate";
import { Card, ErrorBox, Field, PageIntro, Spinner } from "../../components/ui";

interface LoginAccount { enabled: boolean; username: string | null; min_password: number }
const ACCOUNT_KEY = ["auth", "account"];

/** Settings -> Login: create the login, change the username or password, log out other devices. */
export function LoginSettings() {
  const account = useQuery({ queryKey: ACCOUNT_KEY, queryFn: () => api.get<LoginAccount>("/auth/account") });
  const a = account.data;
  return (
    <div className="space-y-4">
      <div><h1>Settings</h1><PageIntro>Who can open this app. Needed before you reach it from your phone or another network.</PageIntro></div>
      {account.error ? <ErrorBox error={account.error} /> : !a ? <Spinner /> : a.enabled
        ? <><ChangeLogin account={a} /><OtherDevices /></>
        : <CreateLogin min={a.min_password} />}
    </div>
  );
}

function useSaved() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ACCOUNT_KEY }); qc.invalidateQueries({ queryKey: AUTH_KEY }); };
}

function CreateLogin({ min }: { min: number }) {
  const saved = useSaved();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const create = useMutation({
    mutationFn: () => api.post("/auth/account", { username, password }),
    onSuccess: saved, meta: { success: "Login turned on" },
  });
  const ready = username.trim() && password.length >= min && repeat === password && !create.isPending;
  return (
    <Card title="Turn on login">
      <p className="mb-3 text-sm text-slate-600">Right now anyone who can reach this app can open it. Create a username and password; this browser stays logged in.</p>
      <form className="max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) create.mutate(); }}>
        <Field label="Username"><input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="Password" hint={`At least ${min} characters`} error={password.length > 0 && password.length < min ? `At least ${min} characters` : undefined}>
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Password again" error={repeat && repeat !== password ? "The two passwords differ" : undefined}>
          <input className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </Field>
        {create.error && <p className="text-sm text-rose-600" role="alert">{errorMessage(create.error)}</p>}
        <button className="btn-primary" type="submit" disabled={!ready}>{create.isPending ? "Saving…" : "Turn on login"}</button>
      </form>
    </Card>
  );
}

function ChangeLogin({ account }: { account: LoginAccount }) {
  const saved = useSaved();
  const [username, setUsername] = useState(account.username ?? "");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const min = account.min_password;
  const newName = username.trim() !== (account.username ?? "") ? username.trim() : null;
  const tooShort = password.length > 0 && password.length < min;
  const differ = repeat !== password;
  const change = useMutation({
    mutationFn: () => api.put("/auth/account", {
      current_password: current, ...(newName ? { username: newName } : {}), ...(password ? { new_password: password } : {}),
    }),
    onSuccess: () => { setCurrent(""); setPassword(""); setRepeat(""); saved(); },
    meta: { success: password ? "Password changed; other devices are logged out" : "Username changed" },
  });
  const ready = current && (newName || password) && username.trim() && !tooShort && !differ && !change.isPending;
  return (
    <Card title="Username and password">
      <p className="mb-3 text-sm text-slate-600">Logged in as <b>{account.username}</b>. A new password logs out every other browser and phone; this one stays logged in.</p>
      <form className="max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) change.mutate(); }}>
        <Field label="Username"><input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="New password" hint={`Leave empty to keep it. At least ${min} characters.`} error={tooShort ? `At least ${min} characters` : undefined}>
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {password && (
          <Field label="New password again" error={repeat && differ ? "The two passwords differ" : undefined}>
            <input className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </Field>
        )}
        <Field label="Current password" hint="Needed for any change">
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        {change.error && <p className="text-sm text-rose-600" role="alert">{errorMessage(change.error)}</p>}
        <button className="btn-primary" type="submit" disabled={!ready}>{change.isPending ? "Saving…" : "Save changes"}</button>
      </form>
      <p className="mt-3 text-xs text-slate-400">Forgot the password? Delete <code>backend/secrets/login.json</code> and restart; with <code>APP_PASSWORD</code> set in <code>backend/.env</code> the login becomes <b>admin</b> / that password, otherwise the app is open until you create a new login here.</p>
    </Card>
  );
}

function OtherDevices() {
  const saved = useSaved();
  const [sure, setSure] = useState(false);
  const out = useMutation({
    mutationFn: () => api.post("/auth/logout-others"),
    onSuccess: () => { setSure(false); saved(); }, meta: { success: "Other devices logged out" },
  });
  return (
    <Card title="Other devices">
      <p className="text-sm text-slate-600">Every browser stays logged in for 30 days. Lost a phone, or logged in somewhere you shouldn't have? Log every other device out.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!sure ? <button className="btn-secondary" onClick={() => setSure(true)}>Log out other devices</button> : <>
          <span className="text-sm">Log out every other browser and phone?</span>
          <button className="btn-primary" onClick={() => out.mutate()} disabled={out.isPending}>Yes, log them out</button>
          <button className="btn-secondary" onClick={() => setSure(false)}>Cancel</button>
        </>}
      </div>
      {out.error && <p className="mt-2 text-sm text-rose-600" role="alert">{errorMessage(out.error)}</p>}
    </Card>
  );
}
