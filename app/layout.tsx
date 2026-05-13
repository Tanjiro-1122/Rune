import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Jarvis",
  description: "Jarvis AI workspace with project chats, indexed files, and persistent artifacts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
