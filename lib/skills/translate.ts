import { tool } from "ai";
import { z } from "zod";

const translateSkill = {
  name: "translate",
  tool: tool({
    description:
      "Translate text between any languages. " +
      "Use when Javier needs to translate content for the app, marketing, or communication.",
    parameters: z.object({
      text: z.string().describe("Text to translate"),
      target_language: z.string().describe("Target language, e.g. Spanish, French, Portuguese"),
      source_language: z.string().optional().describe("Source language (auto-detected if omitted)"),
    }),
    execute: async ({ text, target_language, source_language }) => {
      try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return { error: "OPENAI_API_KEY not configured" };
        const prompt = source_language
          ? `Translate the following text from ${source_language} to ${target_language}. Return only the translated text.\n\n${text}`
          : `Translate the following text to ${target_language}. Return only the translated text.\n\n${text}`;
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 2000, temperature: 0.1 }),
        });
        const data = await res.json() as {
          choices?: Array<{ message: { content: string } }>;
          error?: { message: string };
        };
        if (data.error) return { error: data.error.message };
        return { original: text, translated: data.choices?.[0]?.message?.content?.trim(), target_language };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Translation failed" };
      }
    },
  }),
};

export default translateSkill;
