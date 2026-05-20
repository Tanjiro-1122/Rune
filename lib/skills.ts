import { tool } from "ai";
import { z } from "zod";

/**
 * Rune Skill System
 * -----------------
 * Skills are self-contained capabilities that extend what Rune can do.
 * Each skill is a file in lib/skills/ that exports a SkillDefinition.
 * Skills are loaded at runtime from the RUNE_ENABLED_SKILLS env var.
 *
 * To add a skill: create lib/skills/<name>.ts and add the name to RUNE_ENABLED_SKILLS.
 * To disable a skill: remove from RUNE_ENABLED_SKILLS — zero code changes needed.
 *
 * RUNE_ENABLED_SKILLS = "weather,stock_price,google_calendar" (comma-separated)
 */

export interface SkillDefinition {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: ReturnType<typeof tool<any, any>>;
}

/** Built-in skill registry — always available regardless of env config */
const BUILTIN_SKILLS: Record<string, () => Promise<SkillDefinition>> = {
  weather: () => import("./skills/weather").then((m) => m.default),
  stock_price: () => import("./skills/stock_price").then((m) => m.default),
  google_calendar: () => import("./skills/google_calendar").then((m) => m.default),
  news: () => import("./skills/news").then((m) => m.default),
  translate: () => import("./skills/translate").then((m) => m.default),
};

/**
 * Load all enabled skills as a tools-compatible record.
 * Only loads skills listed in RUNE_ENABLED_SKILLS env var.
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
        console.warn(`[skills] Unknown skill: ${skillName} — skipping`);
        return;
      }
      try {
        const skill = await loader();
        loaded[skill.name] = skill.tool;
        console.log(`[skills] Loaded skill: ${skillName}`);
      } catch (e) {
        console.error(`[skills] Failed to load skill ${skillName}:`, e);
      }
    })
  );

  return loaded;
}

export { z };
