const liveUrl = (process.env.RUNE_LIVE_URL || "https://mrruneai.vercel.app").replace(/\/$/, "");
const endpoint = `${liveUrl}/api/commands/inbound`;

async function readJsonResponse(url, init) {
  const started = Date.now();
  const res = await fetch(url, { redirect: "manual", ...init });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, ms: Date.now() - started, text, json };
}

const getProbe = await readJsonResponse(endpoint, { method: "GET" });
if (getProbe.status !== 401) {
  throw new Error(`Expected locked inbound GET to return 401, received ${getProbe.status}: ${getProbe.text.slice(0, 300)}`);
}
if (!getProbe.json?.blocked || getProbe.json?.route !== "/api/commands/inbound") {
  throw new Error(`Locked inbound GET did not return the blocked route contract: ${getProbe.text.slice(0, 500)}`);
}

const postProbe = await readJsonResponse(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text: "self-test: prove inbound command stays locked", source: "production-proof" }),
});
if (postProbe.status !== 403) {
  throw new Error(`Expected locked inbound POST to return 403, received ${postProbe.status}: ${postProbe.text.slice(0, 300)}`);
}
if (!postProbe.json?.blocked || !String(postProbe.json?.message || "").includes("locked")) {
  throw new Error(`Locked inbound POST did not return the blocked execution contract: ${postProbe.text.slice(0, 500)}`);
}
if (!Array.isArray(postProbe.json?.nextRequiredProof) || !postProbe.json.nextRequiredProof.includes("provider signature verification")) {
  throw new Error("Locked inbound POST must report provider signature verification as required proof.");
}

console.log("Owned command inbound production proof passed.");
console.log(JSON.stringify({
  endpoint,
  get: { status: getProbe.status, ms: getProbe.ms, blocked: getProbe.json.blocked, configuredProviders: getProbe.json.configuredProviders || [] },
  post: { status: postProbe.status, ms: postProbe.ms, blocked: postProbe.json.blocked, nextRequiredProof: postProbe.json.nextRequiredProof },
}, null, 2));
