"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
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
              // Fallback if image fails
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
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="rune-login-input"
            autoFocus
            required
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
