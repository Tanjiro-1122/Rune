import { tool } from "ai";
import { z } from "zod";
import type { SkillDefinition } from "../skills";

const newsSkill: SkillDefinition = {
  name: "get_news",
  description:
    "Get latest news headlines on any topic, company, or keyword. " +
    "Use when Javier wants to know what is happening in the news, " +
    "latest updates on a company, or recent events on any topic.",
  tool: tool({
    description: "Get latest news headlines for a topic or keyword.",
    parameters: z.object({
      query: z.string().describe("Topic, company name, or keyword to search news for"),
      max_results: z.number().min(1).max(10).optional().default(5),
    }),
    execute: async ({ query, max_results = 5 }) => {
      try {
        // Use NewsAPI if configured, else gnews.io free tier
        const newsApiKey = process.env.NEWS_API_KEY;
        if (newsApiKey) {
          const res = await fetch(
            \`https://newsapi.org/v2/everything?q=\${encodeURIComponent(query)}&pageSize=\${max_results}&sortBy=publishedAt&apiKey=\${newsApiKey}\`
          );
          const data = await res.json() as {
            articles?: Array<{ title: string; description: string; url: string; publishedAt: string; source: { name: string } }>;
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
        }
        // Fallback: GNews free (no key)
        const res = await fetch(
          \`https://gnews.io/api/v4/search?q=\${encodeURIComponent(query)}&max=\${max_results}&lang=en&token=\${process.env.GNEWS_API_KEY ?? ""}\`
        );
        if (!res.ok) return { error: "News service unavailable — configure NEWS_API_KEY or GNEWS_API_KEY" };
        const data = await res.json() as {
          articles?: Array<{ title: string; description: string; url: string; publishedAt: string; source: { name: string } }>;
          errors?: string[];
        };
        if (data.errors?.length) return { error: data.errors[0] };
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
