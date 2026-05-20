import { tool } from "ai";
import { z } from "zod";
import type { SkillDefinition } from "../skills";

const translateSkill: SkillDefinition = {
  name: "translate",
  description:
    "Translate text between any languages. " +
    "Use when Javier needs to translate content for the app, marketing, or communication.",
  tool: tool({
    description: "Translate text to a target language.",
    parameters: z.object({
      text: z.string().describe("Text to translate"),
      target_language: z.string().describe("Target language, e.g. 'Spanish', 'French', 'Portuguese'"),
      source_language: z.string().optional().describe("Source language (auto-detected if omitted)"),
    }),
    execute: async ({ text, target_language, source_language }) => {
      try {
        // Use OpenAI for translation — always available since we have the key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return { error: "OPENAI_API_KEY not configured" };
        const prompt = source_language
          ? \`Translate the following text from \${source_language} to \${target_language}. Return only the translated text, nothing else.\n\n\${text}\`
          : \`Translate the following text to \${target_language}. Return only the translated text, nothing else.\n\n\${text}\`;
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 2000,
            temperature: 0.1,
          }),
        });
        const data = await res.json() as {
          choices?: Array<{ message: { content: string } }>;
          error?: { message: string };
        };
        if (data.error) return { error: data.error.message };
        const translated = data.choices?.[0]?.message?.content?.trim();
        return { original: text, translated, target_language, source_language: source_language ?? "auto-detected" };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Translation failed" };
      }
    },
  }),
};

export default translateSkill;
