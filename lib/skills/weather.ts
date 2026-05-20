import { tool } from "ai";
import { z } from "zod";
import type { SkillDefinition } from "../skills";

const weatherSkill: SkillDefinition = {
  name: "get_weather",
  description:
    "Get current weather conditions and forecast for any city or location. " +
    "Use when Javier asks about weather, temperature, rain, wind, or conditions anywhere.",
  tool: tool({
    description:
      "Get current weather for a location. Returns temperature, conditions, humidity, wind.",
    parameters: z.object({
      location: z.string().describe("City name or location, e.g. 'New York' or 'Miami, FL'"),
      units: z.enum(["imperial", "metric"]).optional().default("imperial").describe("fahrenheit=imperial, celsius=metric"),
    }),
    execute: async ({ location, units = "imperial" }) => {
      try {
        const apiKey = process.env.OPENWEATHER_API_KEY;
        if (!apiKey) {
          // Fallback: use wttr.in (no key needed)
          const res = await fetch(
            \`https://wttr.in/\${encodeURIComponent(location)}?format=j1\`,
            { headers: { Accept: "application/json" } }
          );
          if (!res.ok) return { error: \`Weather unavailable for \${location}\` };
          const data = await res.json() as {
            current_condition?: Array<{
              temp_F: string; temp_C: string; weatherDesc: Array<{ value: string }>;
              humidity: string; windspeedMiles: string; winddir16Point: string; FeelsLikeF: string;
            }>;
          };
          const c = data.current_condition?.[0];
          if (!c) return { error: "No weather data returned" };
          return {
            location,
            temperature: units === "imperial" ? \`\${c.temp_F}°F\` : \`\${c.temp_C}°C\`,
            feels_like: units === "imperial" ? \`\${c.FeelsLikeF}°F\` : \`\${c.FeelsLikeF}°F\`,
            conditions: c.weatherDesc[0]?.value ?? "Unknown",
            humidity: \`\${c.humidity}%\`,
            wind: \`\${c.windspeedMiles}mph \${c.winddir16Point}\`,
            source: "wttr.in",
          };
        }
        // OpenWeatherMap
        const unit = units === "imperial" ? "imperial" : "metric";
        const res = await fetch(
          \`https://api.openweathermap.org/data/2.5/weather?q=\${encodeURIComponent(location)}&units=\${unit}&appid=\${apiKey}\`
        );
        const data = await res.json() as {
          name?: string; main?: { temp: number; feels_like: number; humidity: number };
          weather?: Array<{ description: string }>; wind?: { speed: number };
          message?: string;
        };
        if (data.message) return { error: data.message };
        const symbol = units === "imperial" ? "°F" : "°C";
        const speedUnit = units === "imperial" ? "mph" : "m/s";
        return {
          location: data.name ?? location,
          temperature: \`\${Math.round(data.main?.temp ?? 0)}\${symbol}\`,
          feels_like: \`\${Math.round(data.main?.feels_like ?? 0)}\${symbol}\`,
          conditions: data.weather?.[0]?.description ?? "Unknown",
          humidity: \`\${data.main?.humidity ?? 0}%\`,
          wind: \`\${data.wind?.speed ?? 0} \${speedUnit}\`,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Weather lookup failed" };
      }
    },
  }),
};

export default weatherSkill;
