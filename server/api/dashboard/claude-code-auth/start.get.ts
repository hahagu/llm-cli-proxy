import { randomBytes, createHash } from "node:crypto";
import { validateDashboardSession } from "~~/server/utils/dashboard-auth";
import { getClientId } from "~~/server/utils/claude-code-oauth";

export default defineEventHandler(async (event) => {
  const session = await validateDashboardSession(event);
  if (!session) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  // PKCE: generate code_verifier and code_challenge
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  const state = randomBytes(16).toString("hex");
  const clientId = getClientId();
  const port = 55000 + Math.floor(Math.random() * 10000);
  const redirectUri = `http://localhost:${port}/callback`;

  // Store PKCE data in httpOnly cookie (10 min TTL)
  setCookie(event, "claude_oauth_pkce", JSON.stringify({
    codeVerifier,
    state,
    userId: session.userId,
    redirectUri,
  }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
    sameSite: "lax",
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "org:create_api_key user:profile user:inference",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const url = `https://claude.ai/oauth/authorize?${params.toString()}`;

  return { url };
});
