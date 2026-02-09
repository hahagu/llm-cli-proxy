/**
 * Catch-all for unimplemented /v1/* endpoints.
 * Returns a proper OpenAI-compatible JSON 404 instead of crashing
 * through the Nuxt page router.
 */
export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname;
  setResponseStatus(event, 404);
  return {
    error: {
      message: `Unknown API endpoint: ${path}`,
      type: "invalid_request_error",
      code: "unknown_endpoint",
    },
  };
});
