import { extractBearerToken, resolveApiKey } from "../utils/auth";
import { checkRateLimit } from "../utils/rate-limiter";

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;
  if (!path.startsWith("/v1/")) return;

  // Support both Authorization: Bearer and x-api-key headers
  const authHeader = getHeader(event, "authorization");
  const xApiKey = getHeader(event, "x-api-key");
  const token = extractBearerToken(authHeader) ?? xApiKey ?? null;

  if (!token) {
    setResponseStatus(event, 401);
    return {
      error: {
        message:
          "Missing API key. Include 'Authorization: Bearer sk-xxx' or 'x-api-key: sk-xxx' header.",
        type: "invalid_request_error",
        code: "missing_api_key",
      },
    };
  }

  const keyData = await resolveApiKey(token);
  if (!keyData || !keyData.isActive) {
    setResponseStatus(event, 401);
    return {
      error: {
        message: "Invalid or deactivated API key.",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    };
  }

  if (!checkRateLimit(keyData.id, keyData.rateLimitPerMinute)) {
    setResponseStatus(event, 429);
    setHeader(event, "Retry-After", "60");
    return {
      error: {
        message: "Rate limit exceeded. Try again later.",
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
      },
    };
  }

  event.context.apiKeyData = keyData;
});
