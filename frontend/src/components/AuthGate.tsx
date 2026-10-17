import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api, errorMessage } from "../api/client";

export type AuthStatus = { required: boolean; authenticated: boolean };
export const AUTH_KEY = ["auth", "status"];

export function useAuthStatus() {
  return useQuery({ queryKey: AUTH_KEY, queryFn: () => api.get<AuthStatus>("/auth/status"), staleTime: Infinity, retry: false });
}

function Login() {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () => api.post("/auth/login", { password }),
    onSuccess: () => qc.resetQueries(),
  });
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form className="card w-full max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); if (password) login.mutate(); }}>
        <h1 className="text-lg font-semibold">Career Intelligence</h1>
        <p className="text-sm text-slate-500">Enter the app password to continue.</p>
        <label className="block"><span className="label">Password</span>
          <input className="input" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {login.error && <p className="text-sm text-rose-600" role="alert">{errorMessage(login.error)}</p>}
        <button className="btn-primary w-full" type="submit" disabled={!password || login.isPending}>{login.isPending ? "Checking…" : "Log in"}</button>
        <p className="text-xs text-slate-400">Stays logged in for 30 days in this browser. The password is APP_PASSWORD in backend/.env.</p>
      </form>
    </main>
  );
}

/** Shows the login screen when APP_PASSWORD is set and this browser isn't logged in. */
export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const status = useAuthStatus();
  useEffect(() => {
    const again = () => qc.invalidateQueries({ queryKey: AUTH_KEY });
    window.addEventListener("auth-required", again);
    return () => window.removeEventListener("auth-required", again);
  }, [qc]);
  if (status.isLoading) return null;
  if (status.data?.required && !status.data.authenticated) return <Login />;
  return <>{children}</>;
}

/** "Log out", only when a password is in use. */
export function LogoutButton() {
  const qc = useQueryClient();
  const status = useAuthStatus();
  const out = useMutation({ mutationFn: () => api.post("/auth/logout"), onSuccess: () => { qc.clear(); qc.invalidateQueries({ queryKey: AUTH_KEY }); } });
  if (!status.data?.required) return null;
  return <button className="link text-xs" onClick={() => out.mutate()}>Log out</button>;
}
