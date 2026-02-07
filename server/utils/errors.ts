/**
 * Structured OpenAI-compatible error class.
 *
 * All error responses from the proxy follow the OpenAI format:
 *   { error: { message, type, code, param } }
 */
export class OpenAIError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorType: string,
    public readonly code: string,
    message: string,
    public readonly param?: string | null,
  ) {
    super(message);
    this.name = "OpenAIError";
  }

  toResponse() {
    return {
      error: {
        message: this.message,
        type: this.errorType,
        code: this.code,
        param: this.param ?? null,
      },
    };
  }
}

export function invalidRequest(message: string, param?: string): OpenAIError {
  return new OpenAIError(400, "invalid_request_error", "invalid_request", message, param);
}

export function unsupportedParam(param: string, provider: string): OpenAIError {
  return new OpenAIError(
    400,
    "invalid_request_error",
    "unsupported_parameter",
    `Parameter '${param}' is not supported for ${provider} models. Use a different provider instead.`,
    param,
  );
}

export function authenticationError(message: string): OpenAIError {
  return new OpenAIError(401, "invalid_request_error", "invalid_api_key", message);
}

export function rateLimitError(message: string): OpenAIError {
  return new OpenAIError(429, "rate_limit_error", "rate_limit_exceeded", message);
}

export function notFoundError(message: string): OpenAIError {
  return new OpenAIError(404, "invalid_request_error", "model_not_found", message);
}

export function providerError(message: string, statusCode = 502): OpenAIError {
  return new OpenAIError(statusCode, "server_error", "provider_error", message);
}

/** Map an upstream provider HTTP status to an appropriate OpenAIError. */
export function mapProviderHttpError(provider: string, status: number, body: string): OpenAIError {
  const msg = `${provider} API error ${status}: ${body}`;
  if (status === 401 || status === 403) return authenticationError(msg);
  if (status === 429) return rateLimitError(msg);
  if (status === 400) return invalidRequest(msg);
  if (status === 404) return notFoundError(msg);
  return providerError(msg, status >= 500 ? 502 : status);
}
