import { tool } from "ai";
import { z } from "zod";

const calendarSkill = {
  name: "get_calendar",
  tool: tool({
    description:
      "Read upcoming Google Calendar events. " +
      "Requires GOOGLE_CALENDAR_ACCESS_TOKEN env var. " +
      "Use when Javier asks about his schedule, meetings, or calendar.",
    parameters: z.object({
      days_ahead: z.number().min(1).max(30).optional().default(7),
      max_events: z.number().min(1).max(20).optional().default(10),
    }),
    execute: async ({ days_ahead = 7, max_events = 10 }) => {
      try {
        const token = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
        if (!token) return { error: "GOOGLE_CALENDAR_ACCESS_TOKEN not configured." };
        const now = new Date().toISOString();
        const end = new Date(Date.now() + days_ahead * 86400000).toISOString();
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(end)}&maxResults=${max_events}&singleEvents=true&orderBy=startTime`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json() as {
          items?: Array<{
            summary?: string;
            start?: { dateTime?: string; date?: string };
            end?: { dateTime?: string; date?: string };
            location?: string;
          }>;
          error?: { message: string };
        };
        if (data.error) return { error: data.error.message };
        return {
          events: (data.items ?? []).map((e) => ({
            title: e.summary ?? "Untitled",
            start: e.start?.dateTime ?? e.start?.date ?? "TBD",
            end: e.end?.dateTime ?? e.end?.date ?? "TBD",
            location: e.location ?? null,
          })),
          days_ahead,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Calendar lookup failed" };
      }
    },
  }),
};

export default calendarSkill;
