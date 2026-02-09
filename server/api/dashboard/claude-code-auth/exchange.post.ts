import { storeTokensForUser, getClientId } from "~~/server/utils/claude-code-oauth";
import { validateDashboardSession } from "~~/server/utils/dashboard-auth";

const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI = "http://localhost";

export default defineEventHandler(async (event) => {
  const session = await validateDashboardSession(event);
  if (!session) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const body = await readBody(event);
  const redirectUrl = body?.url as string | undefined;

  if (!redirectUrl) {
    setResponseStatus(event, 400);
    return { error: "Missing 'url' field" };
  }

  // Parse the pasted URL to extract code and state
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(redirectUrl);
  } catch {
    setResponseStatus(event, 400);
    return { error: "Invalid URL. Paste the full URL from your browser's address bar after authorizing." };
  }

  const code = parsedUrl.searchParams.get("code");
  const state = parsedUrl.searchParams.get("state");

  if (!code || !state) {
    setResponseStatus(event, 400);
    return { error: "URL is missing 'code' or 'state' parameters. Make sure you paste the full redirect URL." };
  }

  // Read PKCE cookie
  const pkceCookie = getCookie(event, "claude_oauth_pkce");
  if (!pkceCookie) {
    setResponseStatus(event, 400);
    return { error: "Authorization session expired. Please start the process again." };
  }

  let pkceData: { codeVerifier: string; state: string; userId: string };
  try {
    pkceData = JSON.parse(pkceCookie);
  } catch {
    setResponseStatus(event, 400);
    return { error: "Invalid authorization session. Please start the process again." };
  }

  // Validate state (CSRF protection)
  if (pkceData.state !== state) {
    setResponseStatus(event, 400);
    return { error: "State mismatch. Please start the authorization process again." };
  }

  if (pkceData.userId !== session.userId) {
    setResponseStatus(event, 400);
    return { error: "User mismatch. Please start the authorization process again." };
  }

  // Clear the PKCE cookie
  deleteCookie(event, "claude_oauth_pkce", { path: "/" });

  // Strip any # fragments from the code
  const cleanCode = code.split("#")[0];

  try {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: cleanCode,
        state,
        redirect_uri: REDIRECT_URI,
        client_id: getClientId(),
        code_verifier: pkceData.codeVerifier,
      }),
    });

    if (!resp.ok) {
      const respBody = await resp.text();
      console.error("Token exchange failed:", resp.status, respBody);
      return { error: `Token exchange failed (${resp.status}). The authorization code may have expired. Please try again.` };
    }

    const data = (await resp.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in?: number;
    };

    await storeTokensForUser(
      session.userId,
      data.access_token,
      data.refresh_token,
      data.expires_in,
    );

    return { success: true };
  } catch (err) {
    console.error("OAuth exchange error:", err);
    setResponseStatus(event, 500);
    return { error: "Internal error during token exchange." };
  }
});
