/**
 * MCP-based tool calling for the Claude Code adapter.
 *
 * Client-provided OpenAI tools are registered as native MCP tools via
 * `createSdkMcpServer()`. The model discovers them through the API (not
 * prompt-based) and calls them via standard `tool_use` blocks.
 *
 * Handlers return a "[DEFERRED]" placeholder — with maxTurns:1 the SDK
 * stops before the model sees the result, and we capture the tool_use
 * from the stream to forward back to the client.
 *
 * JSON Schema → Zod conversion preserves nested objects, arrays, enums,
 * and descriptions so the model sees the full parameter structure.
 */

import type { OpenAITool } from "../types";
import { z } from "zod";

/** MCP server name used for proxied client tools. */
export const MCP_SERVER_NAME = "proxy";

/** Build the SDK-prefixed MCP tool name: mcp__<server>__<tool> */
export function mcpToolName(toolName: string): string {
  return `mcp__${MCP_SERVER_NAME}__${toolName}`;
}

/** Strip MCP prefix from a tool name to recover the original OpenAI name. */
export function stripMcpPrefix(name: string): string {
  const prefix = `mcp__${MCP_SERVER_NAME}__`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/**
 * Recursively convert a JSON Schema property to a Zod type.
 * Handles nested objects, arrays with typed items, enums, and
 * all primitive types so the model sees the full parameter structure.
 */
function jsonSchemaPropertyToZod(
  prop: Record<string, unknown>,
): z.ZodTypeAny {
  const desc = prop.description as string | undefined;
  let zodType: z.ZodTypeAny;

  // Handle enum values (string enums)
  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    const values = prop.enum as [string, ...string[]];
    zodType = z.enum(values);
    return desc ? zodType.describe(desc) : zodType;
  }

  switch (prop.type) {
    case "string":
      zodType = z.string();
      break;
    case "number":
    case "integer":
      zodType = z.number();
      break;
    case "boolean":
      zodType = z.boolean();
      break;
    case "array": {
      const items = prop.items as Record<string, unknown> | undefined;
      const itemType = items ? jsonSchemaPropertyToZod(items) : z.any();
      zodType = z.array(itemType);
      break;
    }
    case "object": {
      const properties = prop.properties as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (properties) {
        const required = new Set((prop.required as string[]) ?? []);
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [name, propDef] of Object.entries(properties)) {
          const propZod = jsonSchemaPropertyToZod(propDef);
          shape[name] = required.has(name) ? propZod : propZod.optional();
        }
        zodType = z.object(shape);
      } else {
        zodType = z.record(z.any());
      }
      break;
    }
    default:
      zodType = z.any();
  }
  return desc ? zodType.describe(desc) : zodType;
}

/**
 * Convert an OpenAI function parameters JSON Schema to a Zod raw shape.
 * Preserves property names, basic types, descriptions, and required flags.
 */
function jsonSchemaToZodShape(
  schema: Record<string, unknown> | undefined,
): Record<string, z.ZodTypeAny> {
  if (!schema) return {};
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props) return {};
  const required = new Set((schema.required as string[]) ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, prop] of Object.entries(props)) {
    const zodProp = jsonSchemaPropertyToZod(prop);
    shape[name] = required.has(name) ? zodProp : zodProp.optional();
  }
  return shape;
}

/**
 * Create an SDK MCP server that exposes the client's OpenAI tools as native
 * MCP tools. Returns the server object to pass into `options.mcpServers`.
 */
export async function buildMcpServer(tools: OpenAITool[]) {
  const { createSdkMcpServer, tool: defineTool } = await import(
    "@anthropic-ai/claude-agent-sdk"
  );

  const mcpTools = tools.map((t) => {
    const rawParams = t.function.parameters as Record<string, unknown> | undefined;
    const shape = jsonSchemaToZodShape(rawParams);

    if (process.env.DEBUG_SDK) {
      console.log("[MCP:tool]", JSON.stringify({
        name: t.function.name,
        shapeKeys: Object.keys(shape),
      }));
    }

    return defineTool(
      t.function.name,
      t.function.description ?? "",
      shape,
      async () => ({ content: [{ type: "text" as const, text: "[DEFERRED]" }] }),
    );
  });

  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    tools: mcpTools,
  });
}
