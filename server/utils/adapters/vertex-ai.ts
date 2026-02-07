import type {
  ProviderAdapter,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIModelEntry,
} from "./types";
import { generateId, nowUnix } from "./types";
import { getAccessToken } from "../google-auth";
import {
  buildGeminiRequest,
  translateGeminiResponse,
  createStreamTransformer,
  createLineDecoder,
  type GeminiResponse,
} from "./gemini";

const VERTEX_AI_REGION = process.env.VERTEX_AI_REGION || "asia-northeast1";

function vertexBase(region: string, projectId: string): string {
  return `https://${region}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${region}`;
}

export class VertexAiAdapter implements ProviderAdapter {
  readonly name = "vertex-ai";

  private async auth(serviceAccountJson: string) {
    const { token, projectId } = await getAccessToken(serviceAccountJson);
    return { token, projectId, region: VERTEX_AI_REGION };
  }

  async complete(
    request: OpenAIChatRequest,
    providerApiKey: string,
  ): Promise<OpenAIChatResponse> {
    const { token, projectId, region } = await this.auth(providerApiKey);
    const geminiReq = buildGeminiRequest(request);
    const url = `${vertexBase(region, projectId)}/publishers/google/models/${request.model}:generateContent`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(geminiReq),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Vertex AI error ${resp.status}: ${errorBody}`);
    }

    const data = (await resp.json()) as GeminiResponse;
    return translateGeminiResponse(data, request.model);
  }

  async stream(
    request: OpenAIChatRequest,
    providerApiKey: string,
  ): Promise<ReadableStream<string>> {
    const { token, projectId, region } = await this.auth(providerApiKey);
    const geminiReq = buildGeminiRequest(request);
    const url = `${vertexBase(region, projectId)}/publishers/google/models/${request.model}:streamGenerateContent?alt=sse`;
    const requestId = generateId();

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(geminiReq),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Vertex AI error ${resp.status}: ${errorBody}`);
    }

    if (!resp.body) {
      throw new Error("No response body from Vertex AI");
    }

    return resp.body
      .pipeThrough(createLineDecoder())
      .pipeThrough(createStreamTransformer(requestId, request.model));
  }

  async listModels(providerApiKey: string): Promise<OpenAIModelEntry[]> {
    const { token, region } = await this.auth(providerApiKey);
    const url = `https://${region}-aiplatform.googleapis.com/v1beta1/publishers/google/models`;

    const resp = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Vertex AI models list error ${resp.status}: ${body}`);
    }

    const data = (await resp.json()) as {
      models?: Array<{ name: string }>;
    };

    return (data.models ?? [])
      .map((m) => m.name.replace(/^publishers\/google\/models\//, ""))
      .filter((id) => id.includes("gemini"))
      .map((id) => ({
        id,
        object: "model" as const,
        created: nowUnix(),
        owned_by: "google-vertex-ai",
      }));
  }
}
