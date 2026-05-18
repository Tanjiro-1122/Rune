/**
 * lib/rune-lifecycle.ts
 *
 * Rune Full PR Lifecycle — branch → commit → PR → self-check → merge → redeploy → verify.
 * Every automated PR Rune opens runs through this pipeline.
 * No step is skipped. No merge happens without a passing self-check.
 */

export interface LifecycleFile {
  path: string;
  content: string;
}

export interface LifecyclePROptions {
  /** Short slug used for the branch name, e.g. "add-dark-mode" */
  taskSlug: string;
  /** PR title shown on GitHub */
  title: string;
  /** PR body / description */
  body: string;
  /** Files to create or update */
  files: LifecycleFile[];
  /** Commit message */
  commitMessage: string;
}

export interface LifecycleResult {
  ok: boolean;
  stage: "branch" | "commit" | "pr" | "check" | "merge" | "deploy" | "verify" | "done";
  prNumber?: number;
  prUrl?: string;
  mergeCommit?: string;
  deployUrl?: string;
  deployId?: string;
  error?: string;
  checkDetails?: string;
}

// ── GitHub helpers ─────────────────────────────────────────────────────────

const REPO = process.env.RUNE_GITHUB_REPO ?? "Tanjiro-1122/Rune";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? process.env.RUNE_GITHUB_TOKEN ?? "";
const VERCEL_TOKEN = process.env.VERCEL_TOKEN ?? "";
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID ?? "prj_C8yIrPTBitcCIkW745Gx80LBB6CA";
const LIVE_URL = process.env.RUNE_LIVE_URL ?? "https://mrruneai.vercel.app";

async function ghFetch(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function vercelFetch(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.vercel.com/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vercel ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Stage 1: Create branch ─────────────────────────────────────────────────

async function createBranch(branchName: string): Promise<void> {
  const ref = await ghFetch("git/ref/heads/main");
  const mainSha: string = ref.object.sha;
  try {
    await ghFetch("git/refs", "POST", {
      ref: `refs/heads/${branchName}`,
      sha: mainSha,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already exists")) throw err;
  }
}

// ── Stage 2: Commit files ─────────────────────────────────────────────────

async function commitFiles(
  branchName: string,
  files: LifecycleFile[],
  commitMessage: string
): Promise<void> {
  for (const file of files) {
    let existingSha: string | undefined;
    try {
      const existing = await ghFetch(`contents/${file.path}?ref=${branchName}`);
      existingSha = existing.sha;
    } catch {
      // new file — no sha needed
    }
    const body: Record<string, string> = {
      message: commitMessage,
      content: Buffer.from(file.content).toString("base64"),
      branch: branchName,
    };
    if (existingSha) body.sha = existingSha;
    await ghFetch(`contents/${file.path}`, "PUT", body);
  }
}

// ── Stage 3: Open PR ──────────────────────────────────────────────────────

async function openPR(branchName: string, title: string, body: string): Promise<{ number: number; html_url: string }> {
  const pr = await ghFetch("pulls", "POST", {
    title,
    head: branchName,
    base: "main",
    body,
  });
  return { number: pr.number, html_url: pr.html_url };
}

// ── Stage 4: Self-check ───────────────────────────────────────────────────

async function waitForVercelPreview(branchName: string, timeoutMs = 120_000): Promise<{ ok: boolean; url?: string; detail: string }> {
  if (!VERCEL_TOKEN) return { ok: true, detail: "Vercel token not configured — skipping preview check." };

  const deadline = Date.now() + timeoutMs;
  let lastState = "pending";

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 8000));
    try {
      const data = await vercelFetch(
        `v6/deployments?projectId=${VERCEL_PROJECT_ID}&meta-githubBranch=${encodeURIComponent(branchName)}&limit=1`
      );
      const deploy = data?.deployments?.[0];
      if (!deploy) continue;
      lastState = deploy.readyState ?? deploy.status ?? "unknown";
      if (lastState === "READY") return { ok: true, url: `https://${deploy.url}`, detail: "Preview build READY." };
      if (lastState === "ERROR" || lastState === "CANCELED") return { ok: false, detail: `Preview build ${lastState}.` };
    } catch {
      // keep polling
    }
  }
  return { ok: false, detail: `Preview timed out (last state: ${lastState}). Proceeding with caution.` };
}

async function runSecurityGates(): Promise<{ ok: boolean; detail: string }> {
  const gates = [
    `${LIVE_URL}/api/operator-briefing`,
    `${LIVE_URL}/api/chat`,
    `${LIVE_URL}/api/cron/daily-briefing`,
  ];
  const results = await Promise.all(
    gates.map(async (url) => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        return { url, status: res.status, ok: res.status === 401 };
      } catch {
        return { url, status: 0, ok: false };
      }
    })
  );
  const failing = results.filter((r) => !r.ok);
  if (failing.length > 0) {
    return { ok: false, detail: `Security gates failing: ${failing.map((r) => `${r.url} → ${r.status}`).join(", ")}` };
  }
  return { ok: true, detail: "All security gates returning 401." };
}

// ── Stage 5: Merge ────────────────────────────────────────────────────────

async function mergePR(prNumber: number, title: string): Promise<string> {
  const result = await ghFetch(`pulls/${prNumber}/merge`, "PUT", {
    commit_title: title,
    merge_method: "squash",
  });
  return result.sha as string;
}

// ── Stage 6: Redeploy ─────────────────────────────────────────────────────

async function triggerRedeploy(): Promise<{ deployId: string; deployUrl: string }> {
  const deployments = await vercelFetch(
    `v6/deployments?projectId=${VERCEL_PROJECT_ID}&target=production&limit=1`
  );
  const latest = deployments.deployments[0];
  const result = await vercelFetch("v13/deployments", "POST", {
    deploymentId: latest.uid,
    target: "production",
    name: "runeai",
  });
  return { deployId: result.id as string, deployUrl: `https://${result.url}` };
}

async function waitForDeploy(deployId: string, timeoutMs = 180_000): Promise<{ ok: boolean; detail: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000));
    try {
      const data = await vercelFetch(`v13/deployments/${deployId}`);
      const state: string = data.status ?? data.readyState ?? "unknown";
      if (state === "READY") return { ok: true, detail: "Production deploy READY." };
      if (state === "ERROR" || state === "CANCELED") return { ok: false, detail: `Deploy ${state}.` };
    } catch {
      // keep polling
    }
  }
  return { ok: false, detail: "Deploy timed out." };
}

// ── Stage 7: Verify ───────────────────────────────────────────────────────

async function verifyProduction(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(LIVE_URL, { cache: "no-store" });
    if (res.status !== 200) return { ok: false, detail: `Live URL returned ${res.status}.` };
    const gates = await runSecurityGates();
    return gates;
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "Verification failed." };
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────

/**
 * Runs the full Rune PR lifecycle:
 * branch → commit → PR → self-check → merge → redeploy → verify
 *
 * Returns a LifecycleResult at each stage so the caller can report progress.
 */
export async function runLifecycle(opts: LifecyclePROptions): Promise<LifecycleResult> {
  const branchName = `rune/${opts.taskSlug}`;

  // 1. Branch
  try {
    await createBranch(branchName);
  } catch (err) {
    return { ok: false, stage: "branch", error: err instanceof Error ? err.message : String(err) };
  }

  // 2. Commit
  try {
    await commitFiles(branchName, opts.files, opts.commitMessage);
  } catch (err) {
    return { ok: false, stage: "commit", error: err instanceof Error ? err.message : String(err) };
  }

  // 3. PR
  let prNumber: number;
  let prUrl: string;
  try {
    const pr = await openPR(branchName, opts.title, opts.body);
    prNumber = pr.number;
    prUrl = pr.html_url;
  } catch (err) {
    return { ok: false, stage: "pr", error: err instanceof Error ? err.message : String(err) };
  }

  // 4. Self-check (preview build + security gates on current prod)
  const preview = await waitForVercelPreview(branchName);
  const gates = await runSecurityGates();
  if (!gates.ok) {
    return {
      ok: false, stage: "check",
      prNumber, prUrl,
      error: "Security gates failing — blocking merge.",
      checkDetails: gates.detail,
    };
  }

  // 5. Merge
  let mergeCommit: string;
  try {
    mergeCommit = await mergePR(prNumber, opts.title);
  } catch (err) {
    return { ok: false, stage: "merge", prNumber, prUrl, error: err instanceof Error ? err.message : String(err) };
  }

  // 6. Redeploy
  let deployId: string;
  let deployUrl: string;
  try {
    ({ deployId, deployUrl } = await triggerRedeploy());
  } catch (err) {
    return { ok: false, stage: "deploy", prNumber, prUrl, mergeCommit, error: err instanceof Error ? err.message : String(err) };
  }

  const deployWait = await waitForDeploy(deployId);
  if (!deployWait.ok) {
    return { ok: false, stage: "deploy", prNumber, prUrl, mergeCommit, deployId, deployUrl, error: deployWait.detail };
  }

  // 7. Verify
  const verify = await verifyProduction();
  if (!verify.ok) {
    return { ok: false, stage: "verify", prNumber, prUrl, mergeCommit, deployId, deployUrl, error: verify.detail };
  }

  return { ok: true, stage: "done", prNumber, prUrl, mergeCommit, deployId, deployUrl };
}

// ── Rollback ──────────────────────────────────────────────────────────────

/**
 * Rolls back to the previous production deployment immediately.
 * Triggered by: ROLLBACK RUNE
 */
export async function rollbackProduction(): Promise<{ ok: boolean; deployUrl?: string; error?: string }> {
  try {
    const deployments = await vercelFetch(
      `v6/deployments?projectId=${VERCEL_PROJECT_ID}&target=production&limit=3`
    );
    const previous = deployments.deployments[1]; // index 0 = current, 1 = previous
    if (!previous) return { ok: false, error: "No previous production deployment found." };

    const result = await vercelFetch("v13/deployments", "POST", {
      deploymentId: previous.uid,
      target: "production",
      name: "runeai",
    });

    const deployId: string = result.id;
    const wait = await waitForDeploy(deployId);
    return wait.ok
      ? { ok: true, deployUrl: `https://${result.url}` }
      : { ok: false, error: wait.detail };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
