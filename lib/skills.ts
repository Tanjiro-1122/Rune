import { tool } from "ai";

/**
 * Rune Skill System
 * -----------------
 * Skills extend Rune with new capabilities.
 * Each skill exports a default object with { name, tool }.
 * Enable skills via RUNE_ENABLED_SKILLS env var (comma-separated).
 *
 * Available skills: weather, stock_price, news, translate, google_calendar
 */

const BUILTIN_SKILLS: Record<string, () => Promise<{ name: string; tool: ReturnType<typeof tool> }>> = {
  weather:          () => import("./skills/weather").then((m) => m.default),
  stock_price:      () => import("./skills/stock_price").then((m) => m.default),
  google_calendar:  () => import("./skills/google_calendar").then((m) => m.default),
  news:             () => import("./skills/news").then((m) => m.default),
  translate:        () => import("./skills/translate").then((m) => m.default),
};

/**
 * Load all enabled skills and return as a tools-compatible record.
 */
export async function loadEnabledSkills(): Promise<Record<string, ReturnType<typeof tool>>> {
  const enabled = (process.env.RUNE_ENABLED_SKILLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (enabled.length === 0) return {};

  const loaded: Record<string, ReturnType<typeof tool>> = {};

  await Promise.allSettled(
    enabled.map(async (skillName) => {
      const loader = BUILTIN_SKILLS[skillName];
      if (!loader) {
        console.warn(`[skills] Unknown skill: ${skillName}`);
        return;
      }
      try {
        const skill = await loader();
        loaded[skill.name] = skill.tool;
        console.log(`[skills] Loaded: ${skillName}`);
      } catch (e) {
        console.error(`[skills] Failed to load ${skillName}:`, e);
      }
    })
  );

  return loaded;
}
