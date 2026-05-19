"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";

interface VaultItem {
  id: string;
  service_name: string;
  username: string;
  password: string;
  url: string;
  category: string;
  notes: string;
  favorite: boolean;
  is_weak: boolean;
}

const CATEGORIES = ["All", "Google Import", "Other"];

function VaultCard({
  item,
  onCopy,
  onToggleFavorite,
  onDelete,
  onEdit,
}: {
  item: VaultItem;
  onCopy: (text: string, label: string) => void;
  onToggleFavorite: (id: string, val: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (item: VaultItem) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const domain = (() => {
    try { return new URL(item.url.startsWith("http") ? item.url : `https://${item.url}`).hostname.replace("www.", ""); }
    catch { return item.service_name || "—"; }
  })();

  return (
    <div className={`vault-card${item.favorite ? " vault-card--favorite" : ""}${item.is_weak ? " vault-card--weak" : ""}`}>
      <div className="vault-card-header">
        <div className="vault-card-icon">
          <img
            src={`https://www.google.com/s2/favicons?sz=32&domain=${domain}`}
            alt=""
            width={16}
            height={16}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>
        <div className="vault-card-title">
          <span className="vault-card-name">{item.service_name || domain}</span>
          {item.is_weak && <span className="vault-badge vault-badge--weak">weak</span>}
          {item.favorite && <span className="vault-badge vault-badge--fav">★</span>}
        </div>
        <div className="vault-card-actions">
          <button className="vault-icon-btn" title="Favorite" onClick={() => onToggleFavorite(item.id, !item.favorite)}>
            {item.favorite ? "★" : "☆"}
          </button>
          <button className="vault-icon-btn" title="Edit" onClick={() => onEdit(item)}>✎</button>
          <button className="vault-icon-btn vault-icon-btn--danger" title="Delete" onClick={() => onDelete(item.id)}>✕</button>
        </div>
      </div>
      <div className="vault-card-body">
        <div className="vault-field">
          <span className="vault-field-label">Username</span>
          <span className="vault-field-value">{item.username || "—"}</span>
          {item.username && (
            <button className="vault-copy-btn" onClick={() => onCopy(item.username, "Username")}>copy</button>
          )}
        </div>
        <div className="vault-field">
          <span className="vault-field-label">Password</span>
          <span className="vault-field-value vault-field-value--password">
            {showPassword ? item.password : "••••••••"}
          </span>
          <button className="vault-copy-btn" onClick={() => setShowPassword(v => !v)}>
            {showPassword ? "hide" : "show"}
          </button>
          <button className="vault-copy-btn" onClick={() => onCopy(item.password, "Password")}>copy</button>
        </div>
        {item.url && (
          <div className="vault-field">
            <span className="vault-field-label">URL</span>
            <a
              href={item.url.startsWith("http") ? item.url : `https://${item.url}`}
              target="_blank"
              rel="noopener noreferrer"
              className="vault-url-link"
            >
              {domain}
            </a>
          </div>
        )}
        {item.notes && (
          <div className="vault-field">
            <span className="vault-field-label">Notes</span>
            <span className="vault-field-value vault-field-value--notes">{item.notes}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function VaultEditModal({
  item,
  onSave,
  onClose,
}: {
  item: VaultItem | null;
  onSave: (data: Partial<VaultItem> & { id?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<VaultItem>>(item ?? {});
  const [busy, setBusy] = useState(false);

  useEffect(() => { setForm(item ?? {}); }, [item]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await onSave(form);
    setBusy(false);
  }

  if (!item && !form) return null;

  return (
    <div className="vault-modal-overlay" onClick={onClose}>
      <div className="vault-modal" onClick={e => e.stopPropagation()}>
        <div className="vault-modal-header">
          <h3>{form.id ? "Edit Entry" : "New Entry"}</h3>
          <button className="vault-modal-close" onClick={onClose}>✕</button>
        </div>
        <form className="vault-modal-form" onSubmit={submit}>
          {(["service_name", "username", "password", "url", "notes"] as const).map(field => (
            <div key={field} className="vault-modal-field">
              <label>{field.replace("_", " ")}</label>
              <input
                type={field === "password" ? "password" : "text"}
                value={(form[field] as string) ?? ""}
                onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                autoComplete={field === "password" ? "new-password" : "off"}
              />
            </div>
          ))}
          <div className="vault-modal-footer">
            <button type="button" onClick={onClose} className="vault-btn vault-btn--ghost">Cancel</button>
            <button type="submit" disabled={busy} className="vault-btn vault-btn--primary">
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function VaultPage() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [toast, setToast] = useState("");
  const [editItem, setEditItem] = useState<VaultItem | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (category !== "All") params.set("category", category);
      const res = await fetch(`/api/vault?${params}`);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `HTTP ${res.status}`); }
      const data = await res.json() as { items: VaultItem[] };
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [search, category]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Keyboard shortcut: Cmd+K / Ctrl+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function onCopy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => showToast(`${label} copied`));
  }

  async function onToggleFavorite(id: string, val: boolean) {
    await fetch("/api/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, favorite: val }),
    });
    setItems(prev => prev.map(i => i.id === id ? { ...i, favorite: val } : i));
    showToast(val ? "Added to favorites" : "Removed from favorites");
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this entry?")) return;
    await fetch("/api/vault", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setItems(prev => prev.filter(i => i.id !== id));
    showToast("Deleted");
  }

  async function onSave(data: Partial<VaultItem> & { id?: string }) {
    await fetch("/api/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setShowEditModal(false);
    setEditItem(null);
    fetchItems();
    showToast(data.id ? "Updated" : "Created");
  }

  function onEdit(item: VaultItem) {
    setEditItem(item);
    setShowEditModal(true);
  }

  function onNewEntry() {
    setEditItem({ id: "", service_name: "", username: "", password: "", url: "", category: "Other", notes: "", favorite: false, is_weak: false });
    setShowEditModal(true);
  }

  const weakCount = items.filter(i => i.is_weak).length;
  const favCount = items.filter(i => i.favorite).length;

  return (
    <div className="vault-page">
      {/* Header */}
      <div className="vault-header">
        <div className="vault-header-left">
          <span className="vault-logo">🔐</span>
          <h1 className="vault-title">Phrourio Safe</h1>
          <span className="vault-subtitle">encrypted · {items.length} entries</span>
        </div>
        <button className="vault-btn vault-btn--primary vault-new-btn" onClick={onNewEntry}>+ New</button>
      </div>

      {/* Stats bar */}
      {!loading && items.length > 0 && (
        <div className="vault-stats">
          {weakCount > 0 && <span className="vault-stat vault-stat--warn">⚠ {weakCount} weak passwords</span>}
          {favCount > 0 && <span className="vault-stat vault-stat--fav">★ {favCount} favorites</span>}
        </div>
      )}

      {/* Controls */}
      <div className="vault-controls">
        <div className="vault-search-wrap">
          <span className="vault-search-icon">⌕</span>
          <input
            ref={searchRef}
            className="vault-search"
            type="search"
            placeholder="Search sites, usernames… (⌘K)"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="vault-category-tabs">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`vault-cat-tab${category === cat ? " vault-cat-tab--active" : ""}`}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {error && <div className="vault-error">{error}</div>}
      {loading ? (
        <div className="vault-loading">
          <span className="vault-spinner" />
          <span>Loading vault…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="vault-empty">
          {search ? `No results for "${search}"` : "No entries yet."}
        </div>
      ) : (
        <div className="vault-grid">
          {items.map(item => (
            <VaultCard
              key={item.id}
              item={item}
              onCopy={onCopy}
              onToggleFavorite={onToggleFavorite}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}

      {/* Edit modal */}
      {showEditModal && (
        <VaultEditModal
          item={editItem}
          onSave={onSave}
          onClose={() => { setShowEditModal(false); setEditItem(null); }}
        />
      )}

      {/* Toast */}
      {toast && <div className="vault-toast">{toast}</div>}
    </div>
  );
}
