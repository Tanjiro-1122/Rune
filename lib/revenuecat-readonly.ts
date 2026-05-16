import { logError } from "@/lib/errors";

export interface RevenueCatSubscriberSummary {
  appUserId: string;
  originalAppUserId?: string | null;
  firstSeen?: string | null;
  lastSeen?: string | null;
  managementUrl?: string | null;
  entitlements: Array<{
    id: string;
    productIdentifier?: string | null;
    expiresDate?: string | null;
    purchaseDate?: string | null;
    store?: string | null;
    isActive: boolean;
  }>;
  subscriptions: Array<{
    productIdentifier: string;
    store?: string | null;
    periodType?: string | null;
    purchaseDate?: string | null;
    expiresDate?: string | null;
    isSandbox?: boolean | null;
    isActive: boolean;
  }>;
}

export interface RevenueCatReadOnlyResult {
  ok: boolean;
  configured: boolean;
  readOnly: true;
  subscriber?: RevenueCatSubscriberSummary;
  error?: string;
}

function getRevenueCatApiKey() {
  return process.env.REVENUECAT_API_KEY?.trim() || process.env.JARVIS_REVENUECAT_API_KEY?.trim() || "";
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isActive(expiresDate: string | null | undefined) {
  if (!expiresDate) return true;
  const expiresAt = Date.parse(expiresDate);
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt > Date.now();
}

function summarizeSubscriber(appUserId: string, payload: unknown): RevenueCatSubscriberSummary {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const subscriber = root.subscriber && typeof root.subscriber === "object"
    ? root.subscriber as Record<string, unknown>
    : root;

  const entitlementsRaw = subscriber.entitlements && typeof subscriber.entitlements === "object"
    ? subscriber.entitlements as Record<string, Record<string, unknown>>
    : {};
  const subscriptionsRaw = subscriber.subscriptions && typeof subscriber.subscriptions === "object"
    ? subscriber.subscriptions as Record<string, Record<string, unknown>>
    : {};

  const entitlements = Object.entries(entitlementsRaw).map(([id, value]) => {
    const expiresDate = asString(value.expires_date);
    return {
      id,
      productIdentifier: asString(value.product_identifier),
      expiresDate,
      purchaseDate: asString(value.purchase_date),
      store: asString(value.store),
      isActive: isActive(expiresDate),
    };
  });

  const subscriptions = Object.entries(subscriptionsRaw).map(([productIdentifier, value]) => {
    const expiresDate = asString(value.expires_date);
    return {
      productIdentifier,
      store: asString(value.store),
      periodType: asString(value.period_type),
      purchaseDate: asString(value.purchase_date),
      expiresDate,
      isSandbox: typeof value.is_sandbox === "boolean" ? value.is_sandbox : null,
      isActive: isActive(expiresDate),
    };
  });

  return {
    appUserId,
    originalAppUserId: asString(subscriber.original_app_user_id),
    firstSeen: asString(subscriber.first_seen),
    lastSeen: asString(subscriber.last_seen),
    managementUrl: asString(subscriber.management_url),
    entitlements,
    subscriptions,
  };
}

export async function getRevenueCatSubscriberReadOnly(appUserId: string): Promise<RevenueCatReadOnlyResult> {
  const apiKey = getRevenueCatApiKey();
  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      readOnly: true,
      error: "RevenueCat API key is not configured.",
    };
  }

  const cleanedAppUserId = appUserId.trim();
  if (!cleanedAppUserId || cleanedAppUserId.length > 180) {
    return {
      ok: false,
      configured: true,
      readOnly: true,
      error: "A valid RevenueCat app user ID is required.",
    };
  }

  try {
    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(cleanedAppUserId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        configured: true,
        readOnly: true,
        error: `RevenueCat read-only lookup failed (${response.status}): ${text.slice(0, 180)}`,
      };
    }

    const payload = await response.json();
    return {
      ok: true,
      configured: true,
      readOnly: true,
      subscriber: summarizeSubscriber(cleanedAppUserId, payload),
    };
  } catch (error) {
    logError("revenueCat.readOnlySubscriber", error);
    return {
      ok: false,
      configured: true,
      readOnly: true,
      error: error instanceof Error ? error.message : "RevenueCat read-only lookup failed.",
    };
  }
}
