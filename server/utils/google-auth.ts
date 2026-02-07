import { createSign } from "node:crypto";

interface ServiceAccountKey {
  type: "service_account";
  project_id: string;
  private_key: string;
  client_email: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const TOKEN_CACHE = new Map<string, CachedToken>();
const TOKEN_MARGIN_MS = 5 * 60 * 1000; // refresh 5 min before expiry

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function createJwtAssertion(email: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );

  const unsigned = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(privateKey, "base64url");

  return `${unsigned}.${signature}`;
}

export function parseServiceAccountKey(raw: string): ServiceAccountKey {
  const parsed = JSON.parse(raw);
  if (parsed.type !== "service_account") {
    throw new Error("Credential is not a service account key");
  }
  return parsed as ServiceAccountKey;
}

export function isServiceAccountKey(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    return parsed.type === "service_account";
  } catch {
    return false;
  }
}

export async function getAccessToken(
  serviceAccountJson: string,
): Promise<{ token: string; projectId: string }> {
  const sa = parseServiceAccountKey(serviceAccountJson);

  const cached = TOKEN_CACHE.get(sa.client_email);
  if (cached && cached.expiresAt > Date.now() + TOKEN_MARGIN_MS) {
    return { token: cached.token, projectId: sa.project_id };
  }

  const jwt = createJwtAssertion(sa.client_email, sa.private_key);
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Google token exchange failed ${resp.status}: ${body}`);
  }

  const data = (await resp.json()) as {
    access_token: string;
    expires_in: number;
  };

  TOKEN_CACHE.set(sa.client_email, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });

  return { token: data.access_token, projectId: sa.project_id };
}
