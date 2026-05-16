export type ExternalServiceStatus = "configured" | "partial" | "missing";

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
  return `${label} is not configured yet.`;
}

export function getExternalServicesHealth(): ExternalServiceCheck[] {
  const revenueCatRequired = [process.env.JARVIS_REVENUECAT_API_KEY ? "JARVIS_REVENUECAT_API_KEY" : "REVENUECAT_API_KEY"];
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

  const googlePlayRequiredAlternatives = ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "GOOGLE_APPLICATION_CREDENTIALS"];
  const googlePlayConfigured = configuredKeys(googlePlayRequiredAlternatives);
  const googlePlayStatus: ExternalServiceStatus = googlePlayConfigured.length ? "configured" : "missing";

  const revenueCatStatus = statusFrom(revenueCatRequired, revenueCatOptional);
  const appStoreStatus = statusFrom(appStoreRequired, appStoreOptional);

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
      configuredKeys: googlePlayConfigured,
      missingKeys: googlePlayConfigured.length ? [] : googlePlayRequiredAlternatives,
      notes: [
        "Use for release/testing/review visibility only until mutation tools are explicitly approved.",
        "Service account JSON content/path values are never returned by this health check.",
      ],
    },
  ];
}

export function summarizeExternalServicesHealth(checks = getExternalServicesHealth()) {
  const configured = checks.filter((check) => check.status === "configured").length;
  const partial = checks.filter((check) => check.status === "partial").length;
  const missing = checks.filter((check) => check.status === "missing").length;
  return { configured, partial, missing, total: checks.length };
}
