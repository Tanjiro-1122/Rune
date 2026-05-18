"use client";

import { useEffect, useRef, useState } from "react";

export type BuilderCategory = {
  label: string;
  prompt: string;
  emoji: string;
};

const BUILDER_CATEGORIES: BuilderCategory[] = [
  { label: "App Health", prompt: "Run a full health snapshot across all my projects.", emoji: "🩺" },
  { label: "Repo Control", prompt: "Show me the latest Repo Control proposals and PR status.", emoji: "🔧" },
  { label: "Build Intel", prompt: "What's the latest build and deployment intelligence for my apps?", emoji: "🏗️" },
  { label: "Memory", prompt: "Show me everything you remember about my projects and decisions.", emoji: "🧠" },
  { label: "New App", prompt: "I want to build a new app. Walk me through the App Creator pipeline.", emoji: "✨" },
  { label: "Deploy Status", prompt: "Check deploy health and Vercel status for all active projects.", emoji: "🚀" },
  { label: "Analytics", prompt: "Pull cross-app intelligence — revenue, retention, and key metrics.", emoji: "📊" },
  { label: "Daily Brief", prompt: "Give me today's operator briefing — builds, health, and what needs attention.", emoji: "📋" },
];

interface BuilderHomeProps {
  onSubmit: (prompt: string) => void;
  isLoading?: boolean;
}

export function BuilderHome({ onSubmit, isLoading }: BuilderHomeProps) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    onSubmit(trimmed);
    setInput("");
  }

  function handleChip(prompt: string) {
    if (isLoading) return;
    onSubmit(prompt);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="builder-home">
      {/* Ambient background orbs */}
      <div className="builder-orb builder-orb--1" aria-hidden="true" />
      <div className="builder-orb builder-orb--2" aria-hidden="true" />
      <div className="builder-orb builder-orb--3" aria-hidden="true" />

      <div className="builder-content">
        {/* Wordmark */}
        <div className="builder-wordmark-wrap">
          <img
            src="/images/rune-wordmark.png"
            alt="Rune"
            className="builder-wordmark"
          />
          <span className="builder-wordmark-sub">private workspace</span>
        </div>

        {/* Hero prompt */}
        <h1 className="builder-headline">What will you build next?</h1>

        {/* Main input card */}
        <form
          className={`builder-input-card ${focused ? "builder-input-card--focused" : ""}`}
          onSubmit={handleSubmit}
          aria-label="Rune prompt input"
        >
          <textarea
            ref={textareaRef}
            className="builder-textarea"
            placeholder="Describe what you want to do or build…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={2}
            aria-label="Prompt input"
          />
          <div className="builder-input-bar">
            <div className="builder-input-bar-left">
              <span className="builder-hint">↵ send · ⇧↵ newline</span>
            </div>
            <div className="builder-input-bar-right">
              <button
                type="submit"
                className="builder-send-btn"
                disabled={!input.trim() || isLoading}
                aria-label="Send prompt"
              >
                {isLoading ? (
                  <span className="builder-send-spinner" />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Category chips */}
        <div className="builder-chips-section">
          <p className="builder-chips-label">Jump right in</p>
          <div className="builder-chips-grid">
            {BUILDER_CATEGORIES.map((cat) => (
              <button
                key={cat.label}
                type="button"
                className="builder-chip"
                onClick={() => handleChip(cat.prompt)}
                disabled={isLoading}
              >
                <span className="builder-chip-emoji">{cat.emoji}</span>
                <span className="builder-chip-label">{cat.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
