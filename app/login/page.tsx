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
    <main className="page">
      <header className="hero">
        <h1>Jarvis</h1>
        <span className="hero-divider" aria-hidden="true">·</span>
        <p>Sign in to continue</p>
      </header>

      <section className="chat-shell">
        <form className="login-form" onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="chat-input"
            autoFocus
            required
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="send-button" disabled={loading}>
            {loading ? "Checking…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
