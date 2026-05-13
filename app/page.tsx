import { Chat } from "@/components/chat";

export default function HomePage() {
  return (
    <main className="page">
      <header className="hero">
        <h1>Jarvis</h1>
        <span className="hero-divider" aria-hidden="true">·</span>
        <p>Your AI assistant</p>
      </header>

      <section className="chat-shell">
        <Chat />
      </section>
    </main>
  );
}
