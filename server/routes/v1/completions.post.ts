export default defineEventHandler(async (event) => {
  setResponseStatus(event, 501);
  return {
    error: {
      message: "Legacy completions endpoint is not supported. Use /v1/chat/completions instead.",
      type: "invalid_request_error",
      code: "not_implemented",
    },
  };
});
