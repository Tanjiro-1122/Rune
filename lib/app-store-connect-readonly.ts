import { createSign } from "node:crypto";
import { logError } from "@/lib/errors";

export interface AppStoreConnectBuildSummary {
  id: string;
  version?: string | null;
  uploadedDate?: string | null;
  processingState?: string | null;
  expired?: boolean | null;
  minOsVersion?: string | null;
}

export interface AppStoreConnectVersionSummary {
  id: string;
  versionString?: string | null;
  platform?: string | null;
  appStoreState?: string | null;
  appVersionState?: string | null;
  createdDate?: string | null;
}

export interface AppStoreConnectReadOnlySummary {
  appId: string;
  app?: {
    id: string;
    name?: string | null;
    bundleId?: string | null;
    sku?: string | null;
    primaryLocale?: string | null;
  } | null;
  latestBuilds: AppStoreConnectBuildSummary[];
  latestVersions: AppStoreConnectVersionSummary[];
}

export interface AppStoreConnectReadOnlyResult {
  ok: boolean;
  configured: boolean;
  readOnly: true;
  summary?: AppStoreConnectReadOnlySummary;
  error?: string;
}

function env(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function getConfig(appIdOverride?: string | null) {
  return {
    keyId: env("APP_STORE_CONNECT_KEY_ID", "JARVIS_APP_STORE_CONNECT_KEY_ID"),
    issuerId: env("APP_STORE_CONNECT_ISSUER_ID", "JARVIS_APP_STORE_CONNECT_ISSUER_ID"),
    privateKey: env("APP_STORE_CONNECT_PRIVATE_KEY", "JARVIS_APP_STORE_CONNECT_PRIVATE_KEY").replace(/\\n/g, "\n"),
    appId: appIdOverride?.trim() || env("APP_STORE_CONNECT_APP_ID", "JARVIS_APP_STORE_CONNECT_APP_ID"),
  };
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function readDerLength(buffer: Buffer, offset: number) {
  const first = buffer[offset];
  if (first < 0x80) return { length: first, offset: offset + 1 };
  const bytes = first & 0x7f;
  let length = 0;
  for (let i = 0; i < bytes; i++) length = (length << 8) + buffer[offset + 1 + i];
  return { length, offset: offset + 1 + bytes };
}

function derToJose(signature: Buffer) {
  let offset = 0;
  if (signature[offset++] !== 0x30) throw new Error("Invalid ECDSA signature sequence.");
  const sequence = readDerLength(signature, offset);
  offset = sequence.offset;
  if (signature[offset++] !== 0x02) throw new Error("Invalid ECDSA signature integer r.");
  const rLength = readDerLength(signature, offset);
  offset = rLength.offset;
  let r = signature.subarray(offset, offset + rLength.length);
  offset += rLength.length;
  if (signature[offset++] !== 0x02) throw new Error("Invalid ECDSA signature integer s.");
  const sLength = readDerLength(signature, offset);
  offset = sLength.offset;
  let s = signature.subarray(offset, offset + sLength.length);

  if (r.length > 32) r = r.subarray(r.length - 32);
  if (s.length > 32) s = s.subarray(s.length - 32);
  if (r.length < 32) r = Buffer.concat([Buffer.alloc(32 - r.length), r]);
  if (s.length < 32) s = Buffer.concat([Buffer.alloc(32 - s.length), s]);
  return Buffer.concat([r, s]);
}

function createJwt(config: { keyId: string; issuerId: string; privateKey: string }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: config.keyId, typ: "JWT" };
  const payload = {
    iss: config.issuerId,
    iat: now,
    exp: now + 20 * 60,
    aud: "appstoreconnect-v1",
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = derToJose(signer.sign(config.privateKey));
  return `${signingInput}.${base64Url(signature)}`;
}

async function ascGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`App Store Connect read-only request failed (${response.status}): ${text.slice(0, 180)}`);
  }

  return response.json() as Promise<T>;
}

type JsonApiResource = { id: string; attributes?: Record<string, unknown> };
type JsonApiSingle = { data?: JsonApiResource };
type JsonApiList = { data?: JsonApiResource[] };

function str(value: unknown) {
  return typeof value === "string" ? value : null;
}

function bool(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export async function getAppStoreConnectReadOnlySummary(appIdOverride?: string | null): Promise<AppStoreConnectReadOnlyResult> {
  const config = getConfig(appIdOverride);
  const missing = [
    !config.keyId ? "APP_STORE_CONNECT_KEY_ID" : null,
    !config.issuerId ? "APP_STORE_CONNECT_ISSUER_ID" : null,
    !config.privateKey ? "APP_STORE_CONNECT_PRIVATE_KEY" : null,
    !config.appId ? "APP_STORE_CONNECT_APP_ID" : null,
  ].filter(Boolean);

  if (missing.length > 0) {
    return {
      ok: false,
      configured: false,
      readOnly: true,
      error: `App Store Connect read-only configuration is missing: ${missing.join(", ")}.`,
    };
  }

  try {
    const token = createJwt(config);
    const appId = config.appId;
    const [appPayload, buildsPayload, versionsPayload] = await Promise.all([
      ascGet<JsonApiSingle>(`/v1/apps/${encodeURIComponent(appId)}?fields[apps]=name,bundleId,sku,primaryLocale`, token),
      ascGet<JsonApiList>(`/v1/apps/${encodeURIComponent(appId)}/builds?fields[builds]=version,uploadedDate,processingState,expired,minOsVersion&limit=10&sort=-uploadedDate`, token),
      ascGet<JsonApiList>(`/v1/apps/${encodeURIComponent(appId)}/appStoreVersions?fields[appStoreVersions]=versionString,platform,appStoreState,appVersionState,createdDate&limit=10&sort=-createdDate`, token),
    ]);

    const appAttrs = appPayload.data?.attributes ?? {};
    const latestBuilds = (buildsPayload.data ?? []).map((build) => {
      const attrs = build.attributes ?? {};
      return {
        id: build.id,
        version: str(attrs.version),
        uploadedDate: str(attrs.uploadedDate),
        processingState: str(attrs.processingState),
        expired: bool(attrs.expired),
        minOsVersion: str(attrs.minOsVersion),
      };
    });

    const latestVersions = (versionsPayload.data ?? []).map((version) => {
      const attrs = version.attributes ?? {};
      return {
        id: version.id,
        versionString: str(attrs.versionString),
        platform: str(attrs.platform),
        appStoreState: str(attrs.appStoreState),
        appVersionState: str(attrs.appVersionState),
        createdDate: str(attrs.createdDate),
      };
    });

    return {
      ok: true,
      configured: true,
      readOnly: true,
      summary: {
        appId,
        app: appPayload.data
          ? {
              id: appPayload.data.id,
              name: str(appAttrs.name),
              bundleId: str(appAttrs.bundleId),
              sku: str(appAttrs.sku),
              primaryLocale: str(appAttrs.primaryLocale),
            }
          : null,
        latestBuilds,
        latestVersions,
      },
    };
  } catch (error) {
    logError("appStoreConnect.readOnlySummary", error);
    return {
      ok: false,
      configured: true,
      readOnly: true,
      error: error instanceof Error ? error.message : "App Store Connect read-only lookup failed.",
    };
  }
}
