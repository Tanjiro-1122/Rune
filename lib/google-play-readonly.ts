import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { logError } from "@/lib/errors";

export interface GooglePlayReviewSummary {
  reviewId: string;
  authorName?: string | null;
  lastModified?: string | null;
  starRating?: number | null;
  text?: string | null;
}

export interface GooglePlaySubscriptionSummary {
  productId: string;
  basePlansCount?: number | null;
  listingsCount?: number | null;
  archived?: boolean | null;
}

export interface GooglePlayInAppProductSummary {
  sku: string;
  status?: string | null;
  purchaseType?: string | null;
  defaultPrice?: string | null;
}

export interface GooglePlayReadOnlySummary {
  packageName: string;
  reviews: GooglePlayReviewSummary[];
  subscriptions: GooglePlaySubscriptionSummary[];
  inAppProducts: GooglePlayInAppProductSummary[];
  blockedCapabilities: Array<{
    name: string;
    reason: string;
  }>;
}

export interface GooglePlayReadOnlyResult {
  ok: boolean;
  configured: boolean;
  readOnly: true;
  summary?: GooglePlayReadOnlySummary;
  error?: string;
}

type ServiceAccountConfig = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

function env(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function loadServiceAccount(): ServiceAccountConfig | null {
  const rawJson = env("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "JARVIS_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
  const credentialsPath = env("GOOGLE_APPLICATION_CREDENTIALS", "JARVIS_GOOGLE_APPLICATION_CREDENTIALS");
  const source = rawJson || (credentialsPath ? readFileSync(credentialsPath, "utf8") : "");
  if (!source) return null;
  const parsed = JSON.parse(source) as Partial<ServiceAccountConfig>;
  if (!parsed.client_email || !parsed.private_key) return null;
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
    token_uri: parsed.token_uri || "https://oauth2.googleapis.com/token",
  };
}

async function getAccessToken(serviceAccount: ServiceAccountConfig) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: serviceAccount.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 55 * 60,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const assertion = `${signingInput}.${base64Url(signer.sign(serviceAccount.private_key))}`;

  const response = await fetch(serviceAccount.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google OAuth token request failed (${response.status}): ${text.slice(0, 180)}`);
  }

  const payloadJson = await response.json() as { access_token?: string };
  if (!payloadJson.access_token) throw new Error("Google OAuth token response did not include an access token.");
  return payloadJson.access_token;
}

async function playGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google Play read-only request failed (${response.status}): ${text.slice(0, 180)}`);
  }

  return response.json() as Promise<T>;
}

type ReviewsPayload = { reviews?: Array<Record<string, unknown>> };
type SubscriptionsPayload = { subscriptions?: Array<Record<string, unknown>> };
type ProductsPayload = { inappproduct?: Array<Record<string, unknown>> };

function str(value: unknown) {
  return typeof value === "string" ? value : null;
}

function num(value: unknown) {
  return typeof value === "number" ? value : null;
}

function bool(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function summarizeReviews(payload: ReviewsPayload): GooglePlayReviewSummary[] {
  return (payload.reviews ?? []).slice(0, 10).map((review) => {
    const comments = Array.isArray(review.comments) ? review.comments as Array<Record<string, unknown>> : [];
    const userComment = comments.find((comment) => comment.userComment && typeof comment.userComment === "object")?.userComment as Record<string, unknown> | undefined;
    const modified = userComment?.lastModified && typeof userComment.lastModified === "object" ? userComment.lastModified as Record<string, unknown> : {};
    const seconds = str(modified.seconds);
    return {
      reviewId: str(review.reviewId) || "unknown-review",
      authorName: str(review.authorName),
      lastModified: seconds ? new Date(Number(seconds) * 1000).toISOString() : null,
      starRating: num(userComment?.starRating),
      text: str(userComment?.text),
    };
  });
}

function summarizeSubscriptions(payload: SubscriptionsPayload): GooglePlaySubscriptionSummary[] {
  return (payload.subscriptions ?? []).slice(0, 20).map((subscription) => ({
    productId: str(subscription.productId) || "unknown-subscription",
    basePlansCount: Array.isArray(subscription.basePlans) ? subscription.basePlans.length : null,
    listingsCount: Array.isArray(subscription.listings) ? subscription.listings.length : null,
    archived: bool(subscription.archived),
  }));
}

function summarizeProducts(payload: ProductsPayload): GooglePlayInAppProductSummary[] {
  return (payload.inappproduct ?? []).slice(0, 20).map((product) => {
    const defaultPrice = product.defaultPrice && typeof product.defaultPrice === "object" ? product.defaultPrice as Record<string, unknown> : {};
    return {
      sku: str(product.sku) || "unknown-product",
      status: str(product.status),
      purchaseType: str(product.purchaseType),
      defaultPrice: str(defaultPrice.priceMicros),
    };
  });
}

export async function getGooglePlayReadOnlySummary(packageNameOverride?: string | null): Promise<GooglePlayReadOnlyResult> {
  const packageName = packageNameOverride?.trim() || env("GOOGLE_PLAY_PACKAGE_NAME", "JARVIS_GOOGLE_PLAY_PACKAGE_NAME");
  let serviceAccount: ServiceAccountConfig | null = null;
  try {
    serviceAccount = loadServiceAccount();
  } catch (error) {
    logError("googlePlay.loadServiceAccount", error);
    return {
      ok: false,
      configured: false,
      readOnly: true,
      error: error instanceof Error ? error.message : "Google Play service account configuration could not be loaded.",
    };
  }

  const missing = [!serviceAccount ? "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS" : null, !packageName ? "GOOGLE_PLAY_PACKAGE_NAME" : null].filter(Boolean);
  if (missing.length > 0) {
    return {
      ok: false,
      configured: false,
      readOnly: true,
      error: `Google Play read-only configuration is missing: ${missing.join(", ")}.`,
    };
  }

  try {
    const accessToken = await getAccessToken(serviceAccount!);
    const encodedPackage = encodeURIComponent(packageName);
    const [reviewsPayload, subscriptionsPayload, productsPayload] = await Promise.allSettled([
      playGet<ReviewsPayload>(`/applications/${encodedPackage}/reviews?maxResults=10`, accessToken),
      playGet<SubscriptionsPayload>(`/applications/${encodedPackage}/subscriptions?pageSize=20`, accessToken),
      playGet<ProductsPayload>(`/applications/${encodedPackage}/inappproducts?maxResults=20`, accessToken),
    ]);

    const firstFailure = [reviewsPayload, subscriptionsPayload, productsPayload].find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
    if (firstFailure) throw firstFailure.reason;

    return {
      ok: true,
      configured: true,
      readOnly: true,
      summary: {
        packageName,
        reviews: summarizeReviews((reviewsPayload as PromiseFulfilledResult<ReviewsPayload>).value),
        subscriptions: summarizeSubscriptions((subscriptionsPayload as PromiseFulfilledResult<SubscriptionsPayload>).value),
        inAppProducts: summarizeProducts((productsPayload as PromiseFulfilledResult<ProductsPayload>).value),
        blockedCapabilities: [
          {
            name: "Release track visibility",
            reason: "Google Play release tracks are exposed through the edits.tracks API, which requires creating an edit session. Jarvis blocks that until Javier explicitly approves a separate edit-session reader design.",
          },
        ],
      },
    };
  } catch (error) {
    logError("googlePlay.readOnlySummary", error);
    return {
      ok: false,
      configured: true,
      readOnly: true,
      error: error instanceof Error ? error.message : "Google Play read-only lookup failed.",
    };
  }
}
