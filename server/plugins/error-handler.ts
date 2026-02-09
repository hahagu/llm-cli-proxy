/**
 * Global Nitro error handler — catches unhandled errors that bypass route-level try/catch.
 * Remove after troubleshooting.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("error", (error, { event }) => {
    const path = event ? getRequestURL(event).pathname : "unknown";
    console.error(`[UNHANDLED ERROR] ${path}:`, error);
  });
});
