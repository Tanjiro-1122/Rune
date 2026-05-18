export type ExternalServiceStatus = "configured" | "partial" | "missing" | "not_applicable";
export type ProjectPlatform = "ios" | "android" | "web";

export interface ExternalServiceCheck {
  key: "revenuecat" | "app_store_connect" | "google_play";
  label: string;
  status: ExternalServiceStatus;
  summary: string;
  readOnly: boolean;
  configuredKeys: string[];
  missingKeys: string[];
  notes: string[];
}

function hasEnv(name: string) {
  return Boolean(process.env[name]?.trim());
}

function configuredKeys(candidates: string[]) {
  return candidates.filter(hasEnv);
}

function missingKeys(candidates: string[]) {
  return candidates.filter((key) => !hasEnv(key));
}

function statusFrom(required: string[], optional: string[] = []): ExternalServiceStatus {
  const requiredConfigured = configuredKeys(required).length;
  if (requiredConfigured === required.length) return "configured";
  if (requiredConfigured > 0 || configuredKeys(optional).length > 0) return "partial";
  return "missing";
}

function serviceSummary(label: string, status: ExternalServiceStatus) {
  if (status === "configured") return `${label} read-only credentials appear configured.`;
  if (status === "partial") return `${label} has partial configuration; read-only inspection may be limited.`;
  if (status === "not_applicable") return `${label} is not applicable for this project's platform(s).`;
  return `${label} is not configured yet.`;
}

export interface ExternalServicesHealthOptions {
  /** Platforms this project runs on. If ["ios"] only, Google Play check is skipped. */
  platforms?: ProjectPlatform[];
}

export function getExternalServicesHealth(options: ExternalServicesHealthOptions = {}): ExternalServiceCheck[] {
  const platforms = options.platforms ?? [];
  const isIosOnly = platforms.length > 0 && platforms.every((p) => p === "ios");
  const hasAndroid = platforms.length === 0 || platforms.includes("android");

  const revenueCatRequired = [process.env.REVENUECAT_SECRET_KEY ? "REVENUECAT_SECRET_KEY" : process.env.JARVIS_REVENUECAT_API_KEY ? "JARVIS_REVENUECAT_API_KEY" : "REVENUECAT_API_KEY"];
  const revenueCatOptional = [
    "REVENUECAT_PROJECT_ID",
    "REVENUECAT_IOS_APP_ID",
    "REVENUECAT_ANDROID_APP_ID",
    "NEXT_PUBLIC_REVENUECAT_IOS_KEY",
    "NEXT_PUBLIC_REVENUECAT_ANDROID_KEY",
  ];

  const appStoreRequired = [
    process.env.JARVIS_APP_STORE_CONNECT_KEY_ID ? "JARVIS_APP_STORE_CONNECT_KEY_ID" : "APP_STORE_CONNECT_KEY_ID",
    process.env.JARVIS_APP_STORE_CONNECT_ISSUER_ID ? "JARVIS_APP_STORE_CONNECT_ISSUER_ID" : "APP_STORE_CONNECT_ISSUER_ID",
    process.env.JARVIS_APP_STORE_CONNECT_PRIVATE_KEY ? "JARVIS_APP_STORE_CONNECT_PRIVATE_KEY" : "APP_STORE_CONNECT_PRIVATE_KEY",
  ];
  const appStoreOptional = ["APP_STORE_CONNECT_VENDOR_NUMBER", "APP_STORE_CONNECT_APP_ID", "JARVIS_APP_STORE_CONNECT_APP_ID"];

  const revenueCatStatus = statusFrom(revenueCatRequired, revenueCatOptional);
  const appStoreStatus = statusFrom(appStoreRequired, appStoreOptional);

  // Google Play — skip entirely for iOS-only projects
  let googlePlayStatus: ExternalServiceStatus = "not_applicable";
  let googlePlayConfiguredKeys: string[] = [];
  let googlePlayMissingKeys: string[] = [];

  if (hasAndroid) {
    const googlePlayRequiredAlternatives = ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "JARVIS_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "GOOGLE_APPLICATION_CREDENTIALS", "JARVIS_GOOGLE_APPLICATION_CREDENTIALS"];
    const googlePlayPackageKeys = ["GOOGLE_PLAY_PACKAGE_NAME", "JARVIS_GOOGLE_PLAY_PACKAGE_NAME"];
    const gpConfigured = configuredKeys(googlePlayRequiredAlternatives);
    const gpPackageConfigured = configuredKeys(googlePlayPackageKeys);
    googlePlayStatus = gpConfigured.length && gpPackageConfigured.length ? "configured" : gpConfigured.length || gpPackageConfigured.length ? "partial" : "missing";
    googlePlayConfiguredKeys = [...gpConfigured, ...gpPackageConfigured];
    googlePlayMissingKeys = [
      ...(gpConfigured.length ? [] : ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS"]),
      ...(gpPackageConfigured.length ? [] : ["GOOGLE_PLAY_PACKAGE_NAME"]),
    ];
  }

  return [
    {
      key: "revenuecat",
      label: "RevenueCat",
      status: revenueCatStatus,
      summary: serviceSummary("RevenueCat", revenueCatStatus),
      readOnly: true,
      configuredKeys: configuredKeys([...revenueCatRequired, ...revenueCatOptional]),
      missingKeys: missingKeys(revenueCatRequired),
      notes: [
        "Use for subscription/customer/package visibility only until mutation tools are explicitly approved.",
        "Secret values are never returned by this health check.",
      ],
    },
    {
      key: "app_store_connect",
      label: "App Store Connect",
      status: appStoreStatus,
      summary: serviceSummary("App Store Connect", appStoreStatus),
      readOnly: true,
      configuredKeys: configuredKeys([...appStoreRequired, ...appStoreOptional]),
      missingKeys: missingKeys(appStoreRequired),
      notes: [
        "Use for build/review/version visibility only until release mutation tools are explicitly approved.",
        "Private key content is never returned by this health check.",
      ],
    },
    {
      key: "google_play",
      label: "Google Play",
      status: googlePlayStatus,
      summary: serviceSummary("Google Play", googlePlayStatus),
      readOnly: true,
      configuredKeys: googlePlayConfiguredKeys,
      missingKeys: googlePlayMissingKeys,
      notes: isIosOnly
        ? ["Project is iOS-only — Google Play check skipped by design."]
        : [
            "Use for reviews/products/subscription visibility only until mutation tools are explicitly approved.",
            "Release tracks require Google Play edit sessions and are blocked until explicitly approved.",
            "Service account JSON content/path values are never returned by this health check.",
          ],
    },
  ];
}

export function summarizeExternalServicesHealth(checks = getExternalServicesHealth()) {
  const configured = checks.filter((check) => check.status === "configured").length;
  const partial = checks.filter((check) => check.status === "partial").length;
  // not_applicable does not count as missing
  const missing = checks.filter((check) => check.status === "missing").length;
  return { configured, partial, missing, total: checks.length };
}
