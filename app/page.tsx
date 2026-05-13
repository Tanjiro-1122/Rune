import { Chat } from "@/components/chat";

export default function HomePage() {
  return (
    <main className="page">
      <section className="hero">
        <div className="badge">Super Agent</div>
        <h1>Jarvis</h1>
        <p>
          Your advanced AI assistant. Plan tasks, crunch numbers, analyze files,
          and get things done — step by step.
        </p>
      </section>

      <section className="chat-shell">
        <Chat />
      </section>
    </main>
  );
}
