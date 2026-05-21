"use client";

import { useEffect, useRef, useState } from "react";

export type CommandCenterCategory = {
  label: string;
  prompt: string;
  emoji: string;
};

const COMMAND_CENTER_CATEGORIES: CommandCenterCategory[] = [
  { label: "Daily Brief", prompt: "Give me today's operator briefing — health, revenue, what needs attention.", emoji: "📋" },
  { label: "App Health", prompt: "Run a full health snapshot across Unfiltr, Sports Wager Helper, and Rune.", emoji: "🩺" },
  { label: "Analytics", prompt: "Pull cross-app intelligence — revenue, subscribers, retention, and key metrics for this week.", emoji: "📊" },
  { label: "Fix Something", prompt: "Audit what's currently broken or degraded across my apps and fix the most critical issue.", emoji: "🔧" },
  { label: "Deploy", prompt: "Check deploy health and Vercel status for all active projects. Is everything live and healthy?", emoji: "🚀" },
  { label: "Memory", prompt: "What do you remember? Show me the most important things you know about my projects and decisions.", emoji: "🧠" },
  { label: "Create", prompt: "I want to create or improve something. Help me shape it and then do the next concrete step.", emoji: "✨" },
  { label: "Web Search", prompt: "Search the web for something. What do you want me to look up?", emoji: "🔍" },
];

interface CommandCenterHomeProps {
  onSubmit: (prompt: string) => void;
  isLoading?: boolean;
}

export function BuilderHome({ onSubmit, isLoading }: CommandCenterHomeProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  // Auto-resize textarea on input
  function handleInput() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const value = textareaRef.current?.value.trim() ?? "";
    if (!value || isLoading) return;
    onSubmit(value);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
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

  // Force button state update on every keystroke since input is uncontrolled
  const [hasText, setHasText] = useState(false);
  function handleChange() {
    setHasText((textareaRef.current?.value.trim().length ?? 0) > 0);
    handleInput();
  }

  return (
    <div className="builder-home">
      {/* Ambient background orbs */}
      <div className="builder-orb builder-orb--1" aria-hidden="true" />
      <div className="builder-orb builder-orb--2" aria-hidden="true" />
      <div className="builder-orb builder-orb--3" aria-hidden="true" />

      <div className="builder-content">
        {/* Wordmark — inline SVG so no broken image */}
        <div className="builder-wordmark-wrap">
          <div className="builder-logo-lockup" aria-label="Rune">
            {/* Othala rune ember icon */}
            <svg className="builder-rune-icon" viewBox="0 0 40 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <defs>
                <linearGradient id="ember-grad" x1="20" y1="3" x2="20" y2="52" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#ff8c5a" />
                  <stop offset="40%" stopColor="#c0392b" />
                  <stop offset="100%" stopColor="#7b0d1e" />
                </linearGradient>
                <filter id="ember-glow" x="-40%" y="-20%" width="180%" height="140%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
              </defs>
              {/* Othala — diamond arch + two hanging legs */}
              <g filter="url(#ember-glow)" stroke="url(#ember-grad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none">
                <polyline points="20,3 36,18 20,33 4,18 20,3" />
                <line x1="4" y1="18" x2="9" y2="49" />
                <line x1="36" y1="18" x2="31" y2="49" />
                <line x1="9" y1="49" x2="3" y2="49" />
                <line x1="31" y1="49" x2="37" y2="49" />
              </g>
            </svg>
            <span className="builder-wordmark-text">Rune</span>
          </div>
          <span className="builder-wordmark-sub">Command Center</span>
        </div>

        {/* Hero prompt */}
        <h1 className="builder-headline">What needs your attention?</h1>

        {/* Main input card */}
        <form
          className={`builder-input-card ${focused ? "builder-input-card--focused" : ""}`}
          onSubmit={handleSubmit}
          onClick={() => textareaRef.current?.focus()}
          aria-label="Rune prompt input"
        >
          <textarea
            ref={textareaRef}
            className="builder-textarea"
            placeholder="Ask Rune to check, fix, build, remember, or run something…"
            onKeyDown={handleKeyDown}
            onChange={handleChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={2}
            tabIndex={0}
            autoComplete="off"
            aria-label="Prompt input"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="builder-input-bar">
            <div className="builder-input-bar-left">
              <span className="builder-hint">↵ send · ⇧↵ newline</span>
            </div>
            <div className="builder-input-bar-right">
              <button
                type="submit"
                className="builder-send-btn"
                disabled={!hasText || isLoading}
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
          <p className="builder-chips-label">Start here</p>
          <div className="builder-chips-grid">
            {COMMAND_CENTER_CATEGORIES.map((cat) => (
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
