import { tool } from "ai";
import { z } from "zod";

const weatherSkill = {
  name: "get_weather",
  tool: tool({
    description:
      "Get current weather conditions for any city or location. " +
      "Use when Javier asks about weather, temperature, rain, or conditions anywhere.",
    parameters: z.object({
      location: z.string().describe("City name, e.g. 'New York' or 'Miami, FL'"),
      units: z.enum(["imperial", "metric"]).optional().default("imperial"),
    }),
    execute: async ({ location, units = "imperial" }) => {
      try {
        const res = await fetch(
          `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
          { headers: { Accept: "application/json" } }
        );
        if (!res.ok) return { error: `Weather unavailable for ${location}` };
        const data = await res.json() as {
          current_condition?: Array<{
            temp_F: string; temp_C: string;
            weatherDesc: Array<{ value: string }>;
            humidity: string; windspeedMiles: string;
            winddir16Point: string; FeelsLikeF: string;
          }>;
        };
        const c = data.current_condition?.[0];
        if (!c) return { error: "No weather data returned" };
        return {
          location,
          temperature: units === "imperial" ? `${c.temp_F}°F` : `${c.temp_C}°C`,
          feels_like: `${c.FeelsLikeF}°F`,
          conditions: c.weatherDesc[0]?.value ?? "Unknown",
          humidity: `${c.humidity}%`,
          wind: `${c.windspeedMiles}mph ${c.winddir16Point}`,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Weather lookup failed" };
      }
    },
  }),
};

export default weatherSkill;
