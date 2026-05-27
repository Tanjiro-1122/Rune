"use client";

import { Suspense, useMemo, useRef, useState, FormEvent } from "react";
import { useSearchParams } from "next/navigation";

function getSafeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.startsWith("/login")) return "/";
  return value;
}

function getReasonMessage(reason: string | null): string {
  if (reason === "expired") return "Your Rune session expired. Sign in again to continue.";
  if (reason === "missing") return "Sign in to open Javier’s Command Center.";
  if (reason === "malformed" || reason === "invalid") return "Your session could not be verified. Sign in again.";
  if (reason === "missing-session-secret") return "Rune authentication needs server configuration before access can continue.";
  return "Sign in to continue.";
}

function LoginForm() {
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const nextPath = useMemo(() => getSafeNextPath(searchParams.get("next")), [searchParams]);
  const reasonMessage = useMemo(() => getReasonMessage(searchParams.get("reason")), [searchParams]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Read directly from DOM — works with controlled, uncontrolled, and synthetic events
    const password = inputRef.current?.value ?? "";
    if (!password) {
      setError("Password is required.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        // Mobile Safari/PWA contexts can race cookie persistence with client-side
        // router navigation. A real navigation gives WebKit a clean request cycle
        // with the freshly-set owner cookie attached.
        window.location.assign(nextPath);
      } else {
        const data = await res.json();
        setError(data.error || "Invalid password.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="rune-login-page rune-private-access-login" aria-label="Rune Private Access">
      <img
        src="/images/rune-private-access-login.png"
        alt="Rune Private Access"
        className="rune-private-access-art"
        draggable={false}
      />

      <form className="rune-private-access-form" onSubmit={handleSubmit} aria-label={reasonMessage}>
        <input
          ref={inputRef}
          type="password"
          placeholder="Password"
          className="rune-private-access-input"
          autoFocus
          autoComplete="current-password"
          aria-label="Password"
        />
        <button type="submit" className="rune-private-access-btn" disabled={loading}>
          {loading ? "ENTERING" : "ENTER"}
        </button>
        {error && <p className="rune-private-access-error">{error}</p>}
      </form>
    </main>
  );
}


export default function LoginPage() {
  return (
    <Suspense fallback={<main className="rune-login-page"><div className="rune-login-card"><p className="rune-login-subtitle">Loading Rune sign in…</p></div></main>}>
      <LoginForm />
    </Suspense>
  );
}
