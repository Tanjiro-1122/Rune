"use client";

import { useRef, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push("/");
        router.refresh();
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
    <main className="rune-login-page">
      {/* Ambient ember glow blobs */}
      <div className="rune-login-glow rune-login-glow--1" aria-hidden="true" />
      <div className="rune-login-glow rune-login-glow--2" aria-hidden="true" />

      <div className="rune-login-card">
        {/* Wordmark */}
        <div className="rune-login-brand">
          <img
            src="/images/rune-wordmark.png"
            alt="Rune"
            className="rune-login-wordmark"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              const el = document.querySelector(".rune-login-brand-fallback") as HTMLElement;
              if (el) el.style.display = "block";
            }}
          />
          <span className="rune-login-brand-fallback" aria-hidden="true">Rune</span>
        </div>

        <p className="rune-login-subtitle">Sign in to continue</p>

        <form className="rune-login-form" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="password"
            placeholder="Password"
            className="rune-login-input"
            autoFocus
            autoComplete="current-password"
          />
          {error && <p className="rune-login-error">{error}</p>}
          <button type="submit" className="rune-login-btn" disabled={loading}>
            {loading ? "Checking…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
