# OpenAI-Compatible API Proxy & Management Dashboard

## Context

This project extends the existing Nuxt 4 + Convex application with an OpenAI-compatible API proxy that routes requests to multiple LLM providers (Claude, Gemini, OpenRouter) with fallback chain support. A management dashboard lets authenticated users configure API keys, providers, fallback ordering, and system prompts. The result will be deployable via Docker Compose on Coolify.

**Existing stack**: Nuxt 4.2.1, ShadCN-Vue, Tailwind CSS 4, Convex (self-hosted), Better Auth with Google OAuth, Bun.

---

## Architecture

```
  CLI tools / OpenAI SDKs              Browser (Dashboard)
         |                                    |
  Authorization: Bearer sk-xxx        Better Auth session
         |                                    |
         v                                    v
  server/routes/v1/*                 app/pages/dashboard/*
  (Nitro proxy handlers)            (Vue SPA, ShadCN-Vue)
         |                                    |
         |  ConvexHttpClient                  |  convex-vue (reactive)
         v                                    v
  ┌─────────────────── Convex DB ───────────────────────┐
  │ apiKeys | providers | fallbackChains | systemPrompts │
  └─────────────────────────────────────────────────────┘
         |
         | Adapter layer (server/utils/adapters/*)
         v
  ┌──────────────────────────────────────┐
  │  Anthropic API  |  Gemini API  |  OpenRouter API  │
  └──────────────────────────────────────┘
```

**Key decisions:**
- Proxy runs as Nitro server routes at `server/routes/v1/` → maps to `/v1/*` paths (OpenAI-compatible URLs)
- **Dual API format**: Exposes both OpenAI-compatible (`/v1/chat/completions`) AND Anthropic-compatible (`/v1/messages`) endpoints so tools like claude-code can connect natively
- **Fallback logic**: Try the model specified in the request first (auto-routing to the matching provider), then fall back through the configured chain on failure
- Dashboard uses Convex directly from client for reads; server API routes (`/api/dashboard/*`) for operations requiring server secrets (encryption)
- API key auth (Bearer token) for proxy; Better Auth sessions for dashboard
- Provider API keys encrypted at rest with AES-256-GCM
- In-memory LRU cache (30s TTL) for API key lookups on hot path
- Single Docker container for Coolify deployment

---

## Phase 1: Convex Schema & Backend Functions

### New schema files

**`convex/schemas/apiKeys.ts`** — API keys table
- Fields: `userId`, `hashedKey` (SHA-256), `keyPrefix` (display), `name`, `isActive`, `lastUsedAt`, `createdAt`, `rateLimitPerMinute`
- Indexes: `by_hashedKey` (proxy lookup), `by_userId` (dashboard listing)

**`convex/schemas/providers.ts`** — LLM provider credentials
- Fields: `userId`, `type` (claude/gemini/openrouter), `encryptedApiKey`, `keyIv`, `isEnabled`, `displayLabel`, `createdAt`, `updatedAt`
- Indexes: `by_userId`, `by_userId_type`

**`convex/schemas/fallbackChains.ts`** — Fallback chain definitions
- Fields: `userId`, `apiKeyId` (optional per-key override), `name`, `steps` (array of `{providerType, model, systemPromptId?}`), `isDefault`, `createdAt`, `updatedAt`
- Indexes: `by_userId`, `by_apiKeyId`, `by_userId_default`

**`convex/schemas/systemPrompts.ts`** — Editable system prompts
- Fields: `userId`, `name`, `content`, `isDefault`, `associatedModels`, `createdAt`, `updatedAt`
- Indexes: `by_userId`, `by_userId_default`

**`convex/schemas/usageLogs.ts`** — Request logging (analytics-ready)
- Fields: `userId`, `apiKeyId`, `providerType`, `model`, `inputTokens`, `outputTokens`, `latencyMs`, `statusCode`, `errorMessage`, `fallbackStepIndex`, `createdAt`
- Indexes: `by_userId`, `by_apiKeyId`, `by_createdAt`

### Update `convex/schema.ts`
Import and register all new tables alongside existing `users`.

### Convex functions (per entity: `queries.ts` + `mutations.ts`)
- `convex/apiKeys/` — `listByUser`, `getByHash`, `create`, `deactivate`, `remove`, `updateLastUsed`
- `convex/providers/` — `listByUser`, `getByUserAndType`, `create`, `update`, `remove`
- `convex/fallbackChains/` — `listByUser`, `getForApiKey` (resolves per-key or default), `create`, `update`, `remove`
- `convex/systemPrompts/` — `listByUser`, `getDefault`, `create`, `update`, `remove`
- `convex/usageLogs/` — `insert`, `listByUser` (with pagination)

All mutations validate auth via `authComponent.getAuthUser(ctx)` and check `userId` ownership.

---

## Phase 2: Server Utilities

**`server/utils/convex.ts`** — Singleton `ConvexHttpClient` for server-side Convex access

**`server/utils/auth.ts`** — API key resolution
- `hashApiKey(raw)` → SHA-256 hex
- `resolveApiKey(bearerToken)` → looks up hashed key in Convex with 30s in-memory cache
- `extractBearerToken(header)` → parses `Authorization: Bearer ...`

**`server/utils/crypto.ts`** — Provider key encryption
- `encrypt(plaintext)` → `{encrypted, iv}` using AES-256-GCM with `ENCRYPTION_KEY` env var
- `decrypt(encrypted, iv)` → plaintext

**`server/utils/rate-limiter.ts`** — Sliding window per-key rate limiter (in-memory)

---

## Phase 3: Provider Adapters

### Adapter interface (`server/utils/adapters/types.ts`)

```typescript
interface ProviderAdapter {
  name: string;
  complete(req: OpenAIChatRequest, apiKey: string): Promise<OpenAIChatResponse>;
  stream(req: OpenAIChatRequest, apiKey: string): Promise<ReadableStream<string>>;
  listModels(apiKey: string): Promise<OpenAIModelEntry[]>;
}
```

Plus full OpenAI request/response type definitions (messages, content parts, tool calls, streaming chunks).

### Claude adapter (`server/utils/adapters/claude.ts`)
- OpenAI messages → Anthropic Messages API format
- System messages extracted to Anthropic's `system` parameter
- Image content: `image_url` → Anthropic `image` source (base64/URL)
- Tool calls: OpenAI tools → Anthropic tools format
- `max_tokens` default: 4096 (required by Anthropic)
- `stop` → `stop_sequences`
- Streaming: Anthropic SSE events (`message_start`, `content_block_delta`, `message_delta`) → OpenAI chunk format (`data: {...}\n\n`, `data: [DONE]\n\n`)
- Endpoint: `https://api.anthropic.com/v1/messages`

### Gemini adapter (`server/utils/adapters/gemini.ts`)
- OpenAI messages → Gemini `contents[]` with `role: "user"|"model"` and `parts`
- System messages → `systemInstruction`
- Image content → `inlineData` (base64) or `fileData` (URL)
- Tools → `functionDeclarations`
- `max_tokens` → `generationConfig.maxOutputTokens`
- Streaming: `streamGenerateContent?alt=sse` → OpenAI chunk format
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}`

### OpenRouter adapter (`server/utils/adapters/openrouter.ts`)
- Near-passthrough (OpenRouter accepts OpenAI format)
- Swaps auth header to OpenRouter key
- Adds `HTTP-Referer` and `X-Title` headers
- Streaming: pipe upstream SSE directly (minimal transformation)
- Endpoint: `https://openrouter.ai/api/v1/chat/completions`

### Registry (`server/utils/adapters/index.ts`)
- `getAdapter(providerType)` → returns adapter instance

---

## Phase 4: Proxy Server Routes

### Middleware: `server/middleware/proxy-auth.ts`
- Runs on `/v1/*` routes only
- Extracts bearer token, resolves API key, checks rate limit
- Attaches `event.context.apiKeyData` for downstream handlers
- Returns OpenAI-format errors (401, 429) on failure

### `server/routes/v1/chat/completions.post.ts` (Core endpoint)
1. Read request body (OpenAI format)
2. **Auto-route by requested model first**: Determine which provider the requested model belongs to (e.g., `claude-sonnet-4-20250514` → claude adapter, `gemini-2.0-flash` → gemini adapter). Try that provider first with the user's credentials.
3. If the primary attempt fails, resolve the fallback chain for the API key (per-key or user default) and iterate through remaining chain steps:
   - Get provider credentials (decrypt API key)
   - Get adapter for provider type
   - Use the chain step's model
   - If `stream: true` → return SSE `ReadableStream` with proper headers
   - If `stream: false` → return JSON response
   - On failure → log error, try next step
4. Optionally inject system prompt from config (if configured for this model)
5. If all steps fail → return 502 with OpenAI-format error
6. Fire-and-forget usage logging to Convex

### `server/routes/v1/messages.post.ts` (Anthropic-compatible endpoint)
This endpoint accepts the **Anthropic Messages API format** natively, enabling tools like claude-code to connect directly without OpenAI translation on the client side.
1. Read request body (Anthropic format: `model`, `messages`, `system`, `max_tokens`, etc.)
2. **Inbound translation**: Convert Anthropic request → internal OpenAI format using `server/utils/adapters/anthropic-inbound.ts`
3. Route through the same proxy core logic (model auto-routing → fallback chain)
4. **Outbound translation**: Convert OpenAI response → Anthropic response format
5. For streaming: translate OpenAI SSE chunks → Anthropic SSE event format (`message_start`, `content_block_delta`, `message_delta`, `message_stop`)

### `server/routes/v1/models.get.ts`
- Aggregate models from all enabled providers for the authenticated user

### `server/routes/v1/models/[model].get.ts`
- Return info for a specific model

### Stubs for broader compatibility
- `server/routes/v1/embeddings.post.ts` → forward to OpenRouter or return 501
- `server/routes/v1/completions.post.ts` → 501, direct to `/v1/chat/completions`

### Anthropic inbound translator (`server/utils/adapters/anthropic-inbound.ts`)
Bidirectional translation between Anthropic Messages API format and OpenAI format:
- `anthropicToOpenAI(req)` — Converts Anthropic request to OpenAI format (for inbound `/v1/messages` requests)
  - `system` field → system message in `messages` array
  - `content` blocks (text, image) → OpenAI content parts
  - `tool_use`/`tool_result` → OpenAI tool calls format
  - Anthropic `max_tokens` → OpenAI `max_tokens`
- `openAIToAnthropic(resp)` — Converts OpenAI response back to Anthropic format (for outbound)
  - OpenAI `choices[0].message` → Anthropic `content` blocks
  - OpenAI `usage` → Anthropic `usage`
  - OpenAI streaming chunks → Anthropic SSE events

---

## Phase 5: Dashboard API Routes

Server-side routes for operations requiring secrets (encryption/decryption).

**`server/api/dashboard/api-keys/generate.post.ts`**
- Generate `sk-` + 64 random hex chars
- Hash with SHA-256, store hash in Convex
- Return plaintext key to user **once only**

**`server/api/dashboard/providers/index.post.ts`** — Create provider (encrypt API key)
**`server/api/dashboard/providers/[id].put.ts`** — Update provider
**`server/api/dashboard/providers/[id].delete.ts`** — Delete provider

Dashboard auth: validate Better Auth session by forwarding cookies to Convex auth endpoint.

---

## Phase 6: Dashboard Frontend

### Layout: `app/layouts/dashboard.vue`
Sidebar navigation using existing ShadCN Sidebar components. Links: API Keys, Providers, Fallback Chains, System Prompts.

### Pages

| Page | Purpose | Key Components |
|------|---------|----------------|
| `app/pages/dashboard/index.vue` | Overview, quick stats | Cards, recent activity |
| `app/pages/dashboard/api-keys.vue` | List/create/revoke API keys | Table, Dialog (one-time key display), Badge (active/inactive) |
| `app/pages/dashboard/providers.vue` | Configure provider API keys | Card per provider, Form with password input, Switch (enable/disable) |
| `app/pages/dashboard/fallback-chains.vue` | Build fallback chains | Sortable list, Select (provider + model), per-key assignment |
| `app/pages/dashboard/system-prompts.vue` | CRUD system prompts | Textarea, model association Select, default toggle |

### Composables
- `app/composables/useDashboardAuth.ts` — Auth guard, redirects to `/login` if unauthenticated
- `app/composables/useApiKeys.ts` — Convex queries + server API for generation
- `app/composables/useProviders.ts` — Convex queries + server API for encryption
- `app/composables/useFallbackChains.ts` — Convex queries/mutations
- `app/composables/useSystemPrompts.ts` — Convex queries/mutations

---

## Phase 7: Docker & Deployment

### `Dockerfile`
```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM base AS runner
WORKDIR /app
COPY --from=build /app/.output ./.output
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]
```

### `docker-compose.yml`
```yaml
services:
  app:
    build: .
    ports:
      - "${PORT:-3000}:3000"
    environment:
      - CONVEX_SELF_HOSTED_URL=${CONVEX_SELF_HOSTED_URL}
      - VITE_CONVEX_SITE_URL=${VITE_CONVEX_SITE_URL}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - NODE_ENV=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/v1/models"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### `.dockerignore`
```
node_modules
.nuxt
.output
.git
*.md
```

### New environment variables
- `ENCRYPTION_KEY` — 64-char hex string (32 bytes) for AES-256-GCM provider key encryption

---

## Phase 8: Security

1. **API keys**: Only SHA-256 hashes stored; plaintext shown once at generation
2. **Provider keys**: AES-256-GCM encrypted at rest; `ENCRYPTION_KEY` in env only
3. **Auth separation**: Bearer tokens for proxy, session cookies for dashboard
4. **Rate limiting**: Configurable per API key, sliding window in-memory
5. **Input validation**: Zod schemas for all request bodies
6. **No secret logging**: Provider/user keys never logged
7. **CORS**: Proxy routes don't need CORS (server-to-server); dashboard is same-origin

---

## Phase 9: Verification

### curl tests
```bash
# Non-streaming
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"Hello"}]}'

# Streaming
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"Hello"}],"stream":true}'

# Models list
curl http://localhost:3000/v1/models -H "Authorization: Bearer sk-your-key"

# Auth failure (expect 401)
curl http://localhost:3000/v1/models
```

### OpenAI SDK compatibility
```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3000/v1", api_key="sk-your-key")
response = client.chat.completions.create(
    model="claude-sonnet-4-20250514",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True
)
for chunk in response:
    print(chunk.choices[0].delta.content, end="")
```

### Dashboard verification
- Login via Google OAuth → redirected to dashboard
- Generate API key → key displayed once in dialog
- Add provider (paste Anthropic key) → saved encrypted
- Create fallback chain → test with curl using generated key
- Edit system prompt → verify injected in next API call

---

## Implementation Order

| Step | Phase | Description |
|------|-------|-------------|
| 0 | Setup | Save this plan to `docs/plan.md` |
| 1 | Phase 1 | Convex schemas (all 5 new tables) |
| 2 | Phase 1 | Convex queries and mutations (all entities) |
| 3 | Phase 2 | Server utilities (convex client, auth, crypto, rate limiter) |
| 4 | Phase 3 | Adapter types and interface |
| 5 | Phase 3 | Claude adapter |
| 6 | Phase 3 | Gemini adapter |
| 7 | Phase 3 | OpenRouter adapter |
| 8 | Phase 3 | Anthropic inbound translator (for /v1/messages endpoint) |
| 9 | Phase 4 | Proxy middleware + chat completions endpoint |
| 10 | Phase 4 | Anthropic-compatible /v1/messages endpoint |
| 11 | Phase 4 | Models endpoint + stubs |
| 12 | Phase 5 | Dashboard API routes (key generation, provider CRUD) |
| 13 | Phase 6 | Dashboard layout + pages |
| 14 | Phase 7 | Docker configuration |
| 15 | Phase 8 | Security hardening (Zod validation, error sanitization) |
| 16 | Phase 9 | End-to-end testing |

---

## New File Tree

```
server/
  middleware/
    proxy-auth.ts
  routes/v1/
    chat/completions.post.ts
    messages.post.ts
    models.get.ts
    models/[model].get.ts
    embeddings.post.ts
    completions.post.ts
  api/dashboard/
    api-keys/generate.post.ts
    providers/index.post.ts
    providers/[id].put.ts
    providers/[id].delete.ts
  utils/
    convex.ts
    auth.ts
    crypto.ts
    rate-limiter.ts
    adapters/
      types.ts
      index.ts
      claude.ts
      gemini.ts
      openrouter.ts
      anthropic-inbound.ts

convex/
  schema.ts                    (MODIFIED)
  schemas/
    apiKeys.ts                 (NEW)
    providers.ts               (NEW)
    fallbackChains.ts          (NEW)
    systemPrompts.ts           (NEW)
    usageLogs.ts               (NEW)
  apiKeys/queries.ts           (NEW)
  apiKeys/mutations.ts         (NEW)
  providers/queries.ts         (NEW)
  providers/mutations.ts       (NEW)
  fallbackChains/queries.ts    (NEW)
  fallbackChains/mutations.ts  (NEW)
  systemPrompts/queries.ts     (NEW)
  systemPrompts/mutations.ts   (NEW)
  usageLogs/mutations.ts       (NEW)
  usageLogs/queries.ts         (NEW)

app/
  layouts/dashboard.vue        (NEW)
  pages/dashboard/
    index.vue                  (NEW)
    api-keys.vue               (NEW)
    providers.vue              (NEW)
    fallback-chains.vue        (NEW)
    system-prompts.vue         (NEW)
  composables/
    useDashboardAuth.ts        (NEW)
    useApiKeys.ts              (NEW)
    useProviders.ts            (NEW)
    useFallbackChains.ts       (NEW)
    useSystemPrompts.ts        (NEW)

Dockerfile                     (NEW)
docker-compose.yml             (NEW)
.dockerignore                  (NEW)
```
