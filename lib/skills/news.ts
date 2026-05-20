import { tool } from "ai";
import { z } from "zod";

const newsSkill = {
  name: "get_news",
  tool: tool({
    description:
      "Get latest news headlines on any topic, company, or keyword. " +
      "Use when Javier wants current news or recent events on any subject.",
    parameters: z.object({
      query: z.string().describe("Topic or keyword to search news for"),
      max_results: z.number().min(1).max(10).optional().default(5),
    }),
    execute: async ({ query, max_results = 5 }) => {
      try {
        const apiKey = process.env.NEWS_API_KEY;
        if (!apiKey) return { error: "NEWS_API_KEY not configured. Add it to Vercel env vars." };
        const res = await fetch(
          `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&pageSize=${max_results}&sortBy=publishedAt&apiKey=${apiKey}`
        );
        const data = await res.json() as {
          articles?: Array<{
            title: string; description: string; url: string;
            publishedAt: string; source: { name: string };
          }>;
          message?: string;
        };
        if (data.message) return { error: data.message };
        return {
          query,
          articles: (data.articles ?? []).map((a) => ({
            title: a.title,
            summary: a.description,
            source: a.source.name,
            published: a.publishedAt,
            url: a.url,
          })),
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "News lookup failed" };
      }
    },
  }),
};

export default newsSkill;
