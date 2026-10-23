import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api, errorMessage } from "../api/client";

export type AuthStatus = { required: boolean; authenticated: boolean; username?: string | null };
export const AUTH_KEY = ["auth", "status"];

export function useAuthStatus() {
  // Fetched once; refetched only when an API call answers 401 (see AuthGate). Never on mount or
  // focus: the gate re-mounting the app must not trigger another check (that looped).
  return useQuery({ queryKey: AUTH_KEY, queryFn: () => api.get<AuthStatus>("/auth/status"), staleTime: Infinity,
    retry: false, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
}

function Login() {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () => api.post("/auth/login", { username, password }),
    onSuccess: () => qc.resetQueries(),
  });
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form className="card w-full max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); if (username && password) login.mutate(); }}>
        <h1 className="text-lg font-semibold">Career Intelligence</h1>
        <p className="text-sm text-slate-500">Log in to continue.</p>
        <label className="block"><span className="label">Username</span>
          <input className="input" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="block"><span className="label">Password</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {login.error && <p className="text-sm text-rose-600" role="alert">{errorMessage(login.error)}</p>}
        <button className="btn-primary w-full" type="submit" disabled={!username || !password || login.isPending}>{login.isPending ? "Checking…" : "Log in"}</button>
        <p className="text-xs text-slate-400">Stays logged in for 30 days in this browser. Forgot the password? On the computer running the app, delete backend/secrets/login.json and restart.</p>
      </form>
    </main>
  );
}

/** Shows the login screen when the app has a login (core/auth.py) and this browser isn't logged in. */
export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const status = useAuthStatus();
  useEffect(() => {
    const again = () => qc.invalidateQueries({ queryKey: AUTH_KEY });
    window.addEventListener("auth-required", again);
    return () => window.removeEventListener("auth-required", again);
  }, [qc]);
  // Only the very first check holds the page back; if the check fails (older API), show the app.
  if (status.isPending && status.fetchStatus === "fetching") return null;
  if (status.data?.required && !status.data.authenticated) return <Login />;
  return <>{children}</>;
}

/** "Log out", only when the app has a login. */
export function LogoutButton() {
  const qc = useQueryClient();
  const status = useAuthStatus();
  const out = useMutation({ mutationFn: () => api.post("/auth/logout"), onSuccess: () => { qc.clear(); qc.invalidateQueries({ queryKey: AUTH_KEY }); } });
  if (!status.data?.required) return null;
  return <button className="link text-xs" title={status.data.username ? `Logged in as ${status.data.username}` : undefined} onClick={() => out.mutate()}>Log out</button>;
}
