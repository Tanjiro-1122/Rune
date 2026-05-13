"use client";

import { useChat } from "ai/react";
import { useRouter } from "next/navigation";

export function Chat() {
  const router = useRouter();
  const { messages, input, handleInputChange, handleSubmit, status } = useChat();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isLoading = status === "submitted" || status === "streaming";

  return (
    <div className="chat">
      <div className="chat-header">
        <span className="chat-header-title">Jarvis</span>
        <button className="logout-button" onClick={handleLogout}>
          Sign out
        </button>
      </div>
      <div className="messages">
        {messages.length === 0 ? (
          <div className="empty-state">
            <h2>Hello, I&apos;m Jarvis.</h2>
            <p>How can I help you today?</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`message ${message.role === "user" ? "user" : "assistant"}`}
            >
              <div className="message-role">
                {message.role === "user" ? "You" : "Jarvis"}
              </div>
              <div className="message-content">
                {message.parts.map((part, index) => {
                  if (part.type === "text") {
                    return <p key={`${message.id}-${index}`}>{part.text}</p>;
                  }

                  return null;
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <form
        className="input-form"
        onSubmit={(e) => {
          if (!input.trim() || isLoading) {
            e.preventDefault();
            return;
          }
          handleSubmit(e);
        }}
      >
        <input
          name="message"
          value={input}
          onChange={handleInputChange}
          placeholder="Ask Jarvis anything..."
          className="chat-input"
        />
        <button type="submit" className="send-button" disabled={isLoading}>
          {isLoading ? "Thinking..." : "Send"}
        </button>
      </form>
    </div>
  );
}
