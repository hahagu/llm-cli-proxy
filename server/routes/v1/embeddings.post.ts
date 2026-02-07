export default defineEventHandler(async (event) => {
  setResponseStatus(event, 501);
  return {
    error: {
      message: "Embeddings endpoint is not yet implemented. Use the provider's native API for embeddings.",
      type: "invalid_request_error",
      code: "not_implemented",
    },
  };
});
