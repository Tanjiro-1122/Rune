/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Rune Skill System
 * -----------------
 * Dynamically loaded skill plugins for Rune.
 * Enable skills via RUNE_ENABLED_SKILLS env var (comma-separated).
 * Available: weather, stock_price, news, translate, google_calendar
 */

const BUILTIN_SKILLS: Record<string, () => Promise<{ name: string; tool: unknown }>> = {
  weather:         () => import("./skills/weather").then((m) => m.default),
  stock_price:     () => import("./skills/stock_price").then((m) => m.default),
  google_calendar: () => import("./skills/google_calendar").then((m) => m.default),
  news:            () => import("./skills/news").then((m) => m.default),
  translate:       () => import("./skills/translate").then((m) => m.default),
};

export async function loadEnabledSkills(): Promise<Record<string, any>> {
  const enabled = (process.env.RUNE_ENABLED_SKILLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (enabled.length === 0) return {};

  const loaded: Record<string, any> = {};

  await Promise.allSettled(
    enabled.map(async (skillName) => {
      const loader = BUILTIN_SKILLS[skillName];
      if (!loader) { console.warn(`[skills] Unknown skill: ${skillName}`); return; }
      try {
        const skill = await loader();
        loaded[(skill as any).name] = (skill as any).tool;
        console.log(`[skills] Loaded: ${skillName}`);
      } catch (e) {
        console.error(`[skills] Failed: ${skillName}`, e);
      }
    })
  );

  return loaded;
}
