"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/me").then((response) => {
      if (response.ok) router.replace("/");
    });
  }, [router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Something went wrong");
        return;
      }
      router.replace("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="font-serif text-4xl tracking-tight text-ink">mag</span>
          <span className="font-serif text-4xl tracking-tight text-clay">
            Shorts
          </span>
          <p className="mt-2 text-sm text-ink-faint">
            Your calm corner of the news
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-paper-raised p-6 shadow-sm">
          <div className="mb-5 flex rounded-full border border-line p-0.5">
            {(["login", "register"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setError(null);
                }}
                className={`flex-1 rounded-full px-3 py-1.5 text-[13px] transition ${
                  mode === value
                    ? "bg-clay text-white"
                    : "text-ink-faint hover:text-ink"
                }`}
              >
                {value === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="text-[13px] font-medium text-ink-soft">
                Username
              </span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                className="mt-1.5 w-full rounded-xl border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay"
              />
            </label>
            <label className="block">
              <span className="text-[13px] font-medium text-ink-soft">
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                className="mt-1.5 w-full rounded-xl border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay"
              />
            </label>
            {error && <p className="text-[13px] text-red-700">{error}</p>}
            <button
              type="submit"
              disabled={busy || !username || !password}
              className="w-full rounded-xl bg-clay px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-95 disabled:opacity-60"
            >
              {mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
