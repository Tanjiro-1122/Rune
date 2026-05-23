#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function main() {
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
  const dir = path.join(WORK_ROOT, repo.replace("/", "__"));
  fs.rmSync(dir, { recursive: true, force: true });
  const remote = process.env.GITHUB_TOKEN ? `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${repo}.git` : `https://github.com/${repo}.git`;
  run("git", ["clone", "--depth", "1", "--branch", branch, remote, dir], process.cwd());
  run("npm", ["install"], dir);
  run("npm", ["run", "build"], dir);
  run("npx", ["vercel", "deploy", "--prebuilt", "--target=preview", "--yes"], dir);
  console.log(JSON.stringify({ ok: true, repo, branch, target: "preview", safety: "preview_deployed_no_production_no_env_or_schema_mutation" }, null, 2));
}

main();
