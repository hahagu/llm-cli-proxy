import { storeTokensForUser, getClientId } from "~~/server/utils/claude-code-oauth";

const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const code = query.code as string | undefined;
  const state = query.state as string | undefined;

  if (!code || !state) {
    return sendRedirect(event, "/dashboard/providers?claude_code_auth=error&message=Missing+code+or+state");
  }

  // Read PKCE cookie
  const pkceCookie = getCookie(event, "claude_oauth_pkce");
  if (!pkceCookie) {
    return sendRedirect(event, "/dashboard/providers?claude_code_auth=error&message=Missing+PKCE+cookie");
  }

  let pkceData: { codeVerifier: string; state: string; userId: string };
  try {
    pkceData = JSON.parse(pkceCookie);
  } catch {
    return sendRedirect(event, "/dashboard/providers?claude_code_auth=error&message=Invalid+PKCE+cookie");
  }

  // Validate state (CSRF protection)
  if (pkceData.state !== state) {
    return sendRedirect(event, "/dashboard/providers?claude_code_auth=error&message=State+mismatch");
  }

  if (!pkceData.userId) {
    return sendRedirect(event, "/dashboard/providers?claude_code_auth=error&message=Missing+user+ID");
  }

  // Clear the PKCE cookie
  deleteCookie(event, "claude_oauth_pkce", { path: "/" });

  // Exchange code for tokens
  const redirectUri = getRequestURL(event).origin + "/callback";

  // Strip any # fragments from the code (Anthropic may append them)
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
        redirect_uri: redirectUri,
        client_id: getClientId(),
        code_verifier: pkceData.codeVerifier,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error("Token exchange failed:", resp.status, body);
      const detail = encodeURIComponent(`Token exchange failed (${resp.status}): ${body.slice(0, 200)}`);
      return sendRedirect(event, `/dashboard/providers?claude_code_auth=error&message=${detail}`);
    }

    const data = (await resp.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in?: number;
    };

    await storeTokensForUser(
      pkceData.userId,
      data.access_token,
      data.refresh_token,
      data.expires_in,
    );

    return sendRedirect(event, "/dashboard/providers?claude_code_auth=success");
  } catch (err) {
    console.error("OAuth callback error:", err);
    return sendRedirect(event, "/dashboard/providers?claude_code_auth=error&message=Internal+error");
  }
});
