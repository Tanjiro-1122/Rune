#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { request } from "node:https";

const APPROVAL = "APPROVE APP FORGE PREVIEW DEPLOY";
const WORK_ROOT = path.join(process.cwd(), ".rune-app-forge-previews");

function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function safeJsonEnv() {
  const raw = process.env.RUNE_APP_FORGE_PREVIEW_METADATA_BASE64 || "";
  if (!raw) throw new Error("Missing RUNE_APP_FORGE_PREVIEW_METADATA_BASE64.");
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "pipe", encoding: "utf8", shell: false, env: process.env });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").slice(0, 1600)}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function extractDeploymentUrl(output) {
  const matches = String(output || "").match(/https:\/\/[^\s]+\.vercel\.app/g) || [];
  return matches[matches.length - 1] || "";
}

function getJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Vercel API ${res.statusCode}: ${body.slice(0, 300)}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function verifyPreviewDeployment({ repoSlug, branch, deploymentUrl }) {
  const token = process.env.VERCEL_TOKEN || process.env.RUNE_VERCEL_TOKEN;
  if (!token) throw new Error("VERCEL_TOKEN is required to verify preview deployment target.");
  const params = new URLSearchParams({ limit: "20" });
  const payload = await getJson(`https://api.vercel.com/v6/deployments?${params.toString()}`, token);
  const host = deploymentUrl.replace(/^https?:\/\//, "");
  const deployments = Array.isArray(payload.deployments) ? payload.deployments : [];
  const match = deployments.find((deployment) => {
    const meta = deployment.meta || {};
    return deployment.url === host || (deployment.name === repoSlug && meta.githubCommitRef === branch);
  });
  if (!match) throw new Error("Unable to verify Vercel deployment target after preview deploy.");
  if (match.target !== "preview") {
    throw new Error(`Preview deploy safety violation: Vercel reported target=${match.target || "null"}.`);
  }
  return {
    uid: match.uid,
    url: match.url ? `https://${match.url}` : deploymentUrl,
    target: match.target,
    state: match.state,
  };
}

async function main() {
  const metadata = safeJsonEnv();
  const repo = arg("repo");
  const branch = arg("branch") || "initial-app-forge-scaffold";
  if (metadata.approval_text !== APPROVAL) throw new Error("Approval phrase mismatch.");
  if (metadata.previewOnly !== true || metadata.target !== "preview") throw new Error("Preview-only target required.");
  if (metadata.production !== false) throw new Error("production must be false.");
  if (metadata.publicLaunch !== false) throw new Error("publicLaunch must be false.");
  if (metadata.envMutation !== false) throw new Error("envMutation must be false.");
  if (metadata.schemaMutation !== false) throw new Error("schemaMutation must be false.");
  if (!/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/.test(repo)) throw new Error("Invalid repo.");
  if (!/^[-A-Za-z0-9_./]+$/.test(branch)) throw new Error("Invalid branch.");

  fs.mkdirSync(WORK_ROOT, { recursive: true });
  const repoSlug = repo.split("/").pop().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!repoSlug) throw new Error("Unable to derive safe preview project slug.");
  const dir = path.join(WORK_ROOT, repoSlug);
  fs.rmSync(dir, { recursive: true, force: true });
  const remote = process.env.GITHUB_TOKEN ? `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${repo}.git` : `https://github.com/${repo}.git`;
  run("git", ["clone", "--depth", "1", "--branch", branch, remote, dir], process.cwd());
  run("npm", ["install"], dir);
  run("npm", ["run", "build"], dir);
  run("npx", ["vercel", "build", "--yes"], dir);
  const deployResult = run("npx", ["vercel", "deploy", "--prebuilt", "--target=preview", "--yes"], dir);
  const deploymentUrl = extractDeploymentUrl(`${deployResult.stdout}\n${deployResult.stderr}`);
  if (!deploymentUrl) throw new Error("Unable to capture Vercel deployment URL for target verification.");
  const verified = await verifyPreviewDeployment({ repoSlug, branch, deploymentUrl });
  console.log(JSON.stringify({ ok: true, repo, branch, target: verified.target, url: verified.url, deploymentUid: verified.uid, state: verified.state, safety: "preview_verified_no_production_no_env_or_schema_mutation" }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
