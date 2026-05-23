import { getBuildIntelligenceSnapshot, type BuildIntelligenceSnapshot } from "@/lib/build-intelligence";
import { getRevenueCatSubscriberReadOnly, type RevenueCatReadOnlyResult } from "@/lib/revenuecat-readonly";
import { getAppStoreConnectReadOnlySummary, type AppStoreConnectReadOnlyResult } from "@/lib/app-store-connect-readonly";
import { getGooglePlayReadOnlySummary, type GooglePlayReadOnlyResult } from "@/lib/google-play-readonly";
import { getExternalServicesHealth, summarizeExternalServicesHealth, type ProjectPlatform } from "@/lib/external-services-health";
import { getProjectByKey } from "@/lib/project-registry";
import { logActionEvent } from "@/lib/action-events";
import { logError } from "@/lib/errors";
import { getKnownRemediationActions, type OperatorRemediationAction } from "@/lib/operator-remediation";

export type AppHealthStatus = "healthy" | "warning" | "blocked";

export interface AppHealthSnapshotOptions {
  projectKey?: string | null;
  repo?: string | null;
  revenueCatAppUserId?: string | null;
  appStoreAppId?: string | null;
  googlePlayPackageName?: string | null;
  skipActionLog?: boolean;
}

export interface AppHealthSnapshot {
  generatedAt: string;
  projectKey: string;
  readOnly: true;
  status: AppHealthStatus;
  score: number;
  summary: string;
  build: BuildIntelligenceSnapshot;
  revenueCat?: RevenueCatReadOnlyResult;
  appStoreConnect: AppStoreConnectReadOnlyResult;
  googlePlay: GooglePlayReadOnlyResult;
  findings: string[];
  blockers: string[];
  actionRecommendations: OperatorRemediationAction[];
  safeBoundaries: string[];
}

function settle<T>(result: PromiseSettledResult<T>, fallback: T, label: string): T {
  if (result.status === "fulfilled") return result.value;
  logError(`appHealth.${label}`, result.reason);
  return fallback;
}

function statusFromSignals(blockers: string[], warnings: string[]): AppHealthStatus {
  if (blockers.length > 0) return "blocked";
  if (warnings.length > 0) return "warning";
  return "healthy";
}

function scoreFrom(status: AppHealthStatus, warnings: string[]) {
  if (status === "blocked") return Math.max(25, 55 - warnings.length * 5);
  if (status === "warning") return Math.max(60, 88 - warnings.length * 4);
  return 96;
}

function addServiceSignal(findings: string[], blockers: string[], label: string, result: { ok: boolean; configured: boolean; error?: string }) {
  if (result.ok) {
    findings.push(`${label}: connected and readable.`);
    return;
  }
  if (!result.configured) {
    findings.push(`${label}: not configured yet.`);
    return;
  }
  blockers.push(`${label}: configured but lookup failed${result.error ? ` — ${result.error}` : "."}`);
}

export async function getAppHealthSnapshot(options: AppHealthSnapshotOptions = {}): Promise<AppHealthSnapshot> {
  const projectKey = options.projectKey || "unfiltr";

  // Resolve platform flags from project registry
  const registryProject = getProjectByKey(projectKey);
  const platforms: ProjectPlatform[] = (registryProject?.platforms ?? []) as ProjectPlatform[];
  const healthChecks = registryProject?.healthChecks ?? [];
  const shouldCheckAppStoreConnect = healthChecks.includes("app_store_connect") || Boolean(options.appStoreAppId);
  const shouldCheckGooglePlay = healthChecks.includes("google_play") || Boolean(options.googlePlayPackageName);
  const shouldCheckRevenueCat = healthChecks.includes("revenuecat") || Boolean(options.revenueCatAppUserId);

  const skippedAppStoreConnect: AppStoreConnectReadOnlyResult = {
    ok: true,
    configured: false,
    readOnly: true,
    error: undefined,
    summary: { appId: "", bundleId: "", name: "", sku: "", latestVersions: [], blockedCapabilities: [] },
  };
  const skippedGooglePlay: GooglePlayReadOnlyResult = {
    ok: true,
    configured: false,
    readOnly: true,
    error: undefined,
    summary: { packageName: "", appName: "", releaseTracks: [], blockedCapabilities: [] },
  };

  const [buildResult, revenueCatResult, appStoreResult, googlePlayResult] = await Promise.allSettled([
    getBuildIntelligenceSnapshot({ projectKey, repo: options.repo }),
    shouldCheckRevenueCat && options.revenueCatAppUserId ? getRevenueCatSubscriberReadOnly(options.revenueCatAppUserId) : Promise.resolve(undefined),
    shouldCheckAppStoreConnect ? getAppStoreConnectReadOnlySummary(options.appStoreAppId || registryProject?.integrations.appStoreConnect?.appId) : Promise.resolve(skippedAppStoreConnect),
    shouldCheckGooglePlay ? getGooglePlayReadOnlySummary(options.googlePlayPackageName || registryProject?.integrations.googlePlay?.packageName) : Promise.resolve(skippedGooglePlay),
  ]);

  const build = settle(
    buildResult,
    {
      generatedAt: new Date().toISOString(),
      github: { configured: false, repo: options.repo || "unknown", error: "Build intelligence failed." },
      vercel: { configured: false, error: "Vercel intelligence failed." },
      externalServices: { generatedAt: new Date().toISOString(), summary: { configured: 0, partial: 0, missing: 0, total: 0 }, services: [] },
    },
    "build"
  );

  const revenueCat = settle<RevenueCatReadOnlyResult | undefined>(revenueCatResult, undefined, "revenueCat");
  const appStoreConnect = settle<AppStoreConnectReadOnlyResult>(appStoreResult, { ok: false, configured: false, readOnly: true, error: "App Store Connect health check failed." }, "appStoreConnect");
  const googlePlay = settle<GooglePlayReadOnlyResult>(googlePlayResult, { ok: false, configured: false, readOnly: true, error: "Google Play health check failed." }, "googlePlay");

  const findings: string[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  if (build.github.error) blockers.push(`GitHub: ${build.github.error}`);
  else findings.push(`GitHub: ${build.github.repo} readable${build.github.latestCommit?.sha ? ` at ${build.github.latestCommit.sha.slice(0, 7)}` : ""}.`);

  if (build.vercel.error) warnings.push(`Vercel: ${build.vercel.error}`);
  else findings.push(`Vercel: latest deployment ${build.vercel.latestDeployment?.state || "visible"}.`);

  if (shouldCheckRevenueCat) {
    if (revenueCat) addServiceSignal(findings, blockers, "RevenueCat subscriber", revenueCat);
    else findings.push("RevenueCat subscriber: skipped because no app user ID was provided.");
  } else {
    findings.push("RevenueCat: not applicable for this project health profile.");
  }

  if (shouldCheckAppStoreConnect) {
    addServiceSignal(findings, blockers, "App Store Connect", appStoreConnect);
  } else {
    findings.push("App Store Connect: not applicable for this project health profile.");
  }

  if (shouldCheckGooglePlay) {
    addServiceSignal(findings, blockers, "Google Play", googlePlay);
  } else {
    findings.push("Google Play: not applicable for this project health profile.");
  }

  const externalPlatforms = shouldCheckGooglePlay ? platforms : platforms.filter((platform) => platform !== "android");
  // External services check — pass active platforms so skipped stores are not counted as missing
  const externalChecks = getExternalServicesHealth({ platforms: externalPlatforms });
  const externalSummary = summarizeExternalServicesHealth(externalChecks);
  const externalMissing = externalSummary.missing;
  const externalPartial = externalSummary.partial;
  if (externalMissing > 0) warnings.push(`${externalMissing} external service readiness check(s) are missing configuration.`);
  if (externalPartial > 0) warnings.push(`${externalPartial} external service readiness check(s) are partially configured.`);

  const googleBlocked = googlePlay.summary?.blockedCapabilities ?? [];
  for (const blocked of googleBlocked) findings.push(`Google Play ${blocked.name}: blocked by design — ${blocked.reason}`);

  const actionRecommendations = [
    ...(shouldCheckAppStoreConnect ? getKnownRemediationActions({ service: "App Store Connect", error: appStoreConnect.error }) : []),
    ...(shouldCheckGooglePlay ? getKnownRemediationActions({ service: "Google Play", error: googlePlay.error }) : []),
    ...(shouldCheckRevenueCat && revenueCat ? getKnownRemediationActions({ service: "RevenueCat subscriber", error: revenueCat.error }) : []),
  ];

  const status = statusFromSignals(blockers, warnings);
  const score = scoreFrom(status, warnings);
  const summary = status === "healthy"
    ? "Core app operations look healthy from the connected read-only systems."
    : status === "warning"
      ? "Core systems are reachable, but there are configuration or visibility warnings to clean up."
      : "One or more configured systems failed read-only inspection and need attention.";

  const snapshot: AppHealthSnapshot = {
    generatedAt: new Date().toISOString(),
    projectKey,
    readOnly: true,
    status,
    score,
    summary,
    build,
    revenueCat,
    appStoreConnect,
    googlePlay,
    findings,
    blockers: [...blockers, ...warnings],
    actionRecommendations,
    safeBoundaries: [
      "Read-only health snapshot only.",
      "No repo commits, PRs, merges, deploys, rollbacks, releases, publishing, entitlement grants, refunds, review replies, or product edits.",
      "Google Play release-track visibility remains blocked because it requires edit sessions.",
      "Secrets and private keys are never returned in the snapshot.",
    ],
  };

  if (!options.skipActionLog) {
    await logActionEvent({
      eventType: "app_health.snapshot",
      summary: `App health snapshot generated for ${projectKey}`,
      status: status === "blocked" ? "failed" : "executed",
      approvalStage: "findings",
      riskLevel: "low",
      projectKey,
      metadata: {
        readOnly: true,
        status,
        score,
        platforms,
        repo: build.github.repo,
        revenueCatChecked: Boolean(revenueCat),
        appStoreConnectOk: shouldCheckAppStoreConnect ? appStoreConnect.ok : null,
        googlePlayOk: shouldCheckGooglePlay ? googlePlay.ok : null,
        blockers: snapshot.blockers.slice(0, 8),
        actionRecommendations: actionRecommendations.map((action) => action.id).slice(0, 8),
      },
    });
  }

  return snapshot;
}
