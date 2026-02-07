/**
 * CORS middleware for /v1/ API routes.
 *
 * Named "cors.ts" to run before "proxy-auth.ts" alphabetically,
 * ensuring preflight OPTIONS requests are handled before auth checks.
 */
export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname;
  if (!path.startsWith("/v1/")) return;

  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS ?? "*";

  setHeader(event, "Access-Control-Allow-Origin", allowedOrigins);
  setHeader(event, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  setHeader(
    event,
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key",
  );
  setHeader(event, "Access-Control-Max-Age", "86400");

  if (getMethod(event) === "OPTIONS") {
    setResponseStatus(event, 204);
    return "";
  }
});
