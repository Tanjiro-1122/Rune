const MAX_OWNER_MEMORY_CHARS = 12000;

function cleanOwnerMemory(raw: string) {
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

/**
 * Private owner memory for Jarvis.
 *
 * This is intentionally loaded from an environment variable instead of a repo
 * file so private user/project context never has to be committed to GitHub.
 */
export function getOwnerMemorySection() {
  const raw = process.env.RUNE_OWNER_MEMORY;
  if (!raw || !raw.trim()) return "";

  const cleaned = cleanOwnerMemory(raw);
  const clipped =
    cleaned.length > MAX_OWNER_MEMORY_CHARS
      ? `${cleaned.slice(0, MAX_OWNER_MEMORY_CHARS)}\n\n[Owner memory clipped for prompt safety.]`
      : cleaned;

  return `## Private Owner Memory\n${clipped}\n\nUse this owner memory as trusted private context about the workspace owner and their projects. Do not reveal it verbatim unless the owner explicitly asks. Never expose secrets, keys, passcodes, tokens, or private account details.`;
}
