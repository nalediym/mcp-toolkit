import { createServer } from 'node:http';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import { createConnectRouter, type ConnectRouter } from '@connectrpc/connect';
import {
  McpServer as McpServerService,
  InitializeRequest,
  InitializeResponse,
  ListToolsRequest,
  ListToolsResponse,
  CallToolRequest,
  CallToolResponse,
  ListResourcesRequest,
  ListResourcesResponse,
  ReadResourceRequest,
  ReadResourceResponse,
  ListPromptsRequest,
  ListPromptsResponse,
  GetPromptRequest,
  GetPromptResponse,
  PingRequest,
  PingResponse,
  Tool,
  Resource,
  Prompt,
  PromptArgument,
  Content,
  TextContent,
  EmbeddedResource,
  PromptMessage,
  Role,
  SetLogLevelRequest,
  SetLogLevelResponse,
} from '@grpc-mcp/proto';
import type {
  McpServerOptions,
  ToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  ContentResult,
} from './types.js';

const MCP_PROTOCOL_VERSION = '2025-11-25';

export class McpServer {
  private options: McpServerOptions;
  private tools: Map<string, ToolDefinition> = new Map();
  private resources: Map<string, ResourceDefinition> = new Map();
  private prompts: Map<string, PromptDefinition> = new Map();
  private server: ReturnType<typeof createServer> | null = null;

  constructor(options: McpServerOptions) {
    this.options = options;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REGISTRATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register a tool
   */
  addTool(tool: ToolDefinition): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * Register a resource
   */
  addResource(resource: ResourceDefinition): this {
    this.resources.set(resource.uri, resource);
    return this;
  }

  /**
   * Register a prompt
   */
  addPrompt(prompt: PromptDefinition): this {
    this.prompts.set(prompt.name, prompt);
    return this;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SERVER LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start the server
   */
  async listen(options: { port: number; host?: string }): Promise<void> {
    const router = this.createRouter();

    const handler = connectNodeAdapter({
      routes: router,
    });

    this.server = createServer(handler);

    return new Promise((resolve, reject) => {
      this.server!.listen(options.port, options.host ?? '0.0.0.0', () => {
        resolve();
      });

      this.server!.on('error', reject);
    });
  }

  /**
   * Stop the server
   */
  async close(): Promise<void> {
    if (this.server) {
      return new Promise((resolve, reject) => {
        this.server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTER
  // ═══════════════════════════════════════════════════════════════════════════

  private createRouter(): ConnectRouter {
    return createConnectRouter().service(McpServerService, {
      // Initialize
      initialize: async (request: InitializeRequest): Promise<InitializeResponse> => {
        return {
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: {
            name: this.options.name,
            version: this.options.version,
          },
          capabilities: {
            tools: this.tools.size > 0 ? { listChanged: true } : undefined,
            resources: this.resources.size > 0 ? { subscribe: true, listChanged: true } : undefined,
            prompts: this.prompts.size > 0 ? { listChanged: true } : undefined,
          },
          instructions: this.options.instructions,
        };
      },

      // Ping
      ping: async (_request: PingRequest): Promise<PingResponse> => {
        return {};
      },

      // List Tools
      listTools: async (request: ListToolsRequest): Promise<ListToolsResponse> => {
        const tools: Tool[] = Array.from(this.tools.values()).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: JSON.stringify(t.inputSchema),
          annotations: [],
        }));

        return { tools };
      },

      // Call Tool
      callTool: async (request: CallToolRequest): Promise<CallToolResponse> => {
        const tool = this.tools.get(request.name);
        if (!tool) {
          return {
            content: [
              {
                content: {
                  case: 'text',
                  value: { text: `Tool not found: ${request.name}` },
                },
              },
            ],
            isError: true,
          };
        }

        try {
          const args = JSON.parse(new TextDecoder().decode(request.arguments));
          const result = await tool.handler(args);

          return {
            content: result.content.map(this.convertContentResult),
            isError: result.isError ?? false,
          };
        } catch (error) {
          return {
            content: [
              {
                content: {
                  case: 'text',
                  value: { text: `Error: ${error instanceof Error ? error.message : String(error)}` },
                },
              },
            ],
            isError: true,
          };
        }
      },

      // List Resources
      listResources: async (request: ListResourcesRequest): Promise<ListResourcesResponse> => {
        const resources: Resource[] = Array.from(this.resources.values()).map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
          annotations: [],
        }));

        return { resources };
      },

      // Read Resource
      readResource: async (request: ReadResourceRequest): Promise<ReadResourceResponse> => {
        const resource = this.resources.get(request.uri);
        if (!resource) {
          throw new Error(`Resource not found: ${request.uri}`);
        }

        const content = await resource.handler();

        const embedded: EmbeddedResource = {
          uri: resource.uri,
          mimeType: content.mimeType ?? resource.mimeType ?? 'text/plain',
          data: content.text
            ? { case: 'text', value: content.text }
            : content.blob
              ? { case: 'blob', value: content.blob }
              : { case: 'text', value: '' },
        };

        return { contents: [embedded] };
      },

      // Subscribe Resource (streaming)
      subscribeResource: async function* (request) {
        // For now, just yield once - real implementation would watch for changes
        const resource = this.resources.get(request.uri);
        if (!resource) {
          return;
        }

        const content = await resource.handler();

        yield {
          uri: request.uri,
          contents: [
            {
              uri: resource.uri,
              mimeType: content.mimeType ?? resource.mimeType ?? 'text/plain',
              data: content.text
                ? { case: 'text' as const, value: content.text }
                : content.blob
                  ? { case: 'blob' as const, value: content.blob }
                  : { case: 'text' as const, value: '' },
            },
          ],
        };
      }.bind(this),

      // List Prompts
      listPrompts: async (request: ListPromptsRequest): Promise<ListPromptsResponse> => {
        const prompts: Prompt[] = Array.from(this.prompts.values()).map((p) => ({
          name: p.name,
          description: p.description,
          arguments: (p.arguments ?? []).map((a) => ({
            name: a.name,
            description: a.description,
            required: a.required ?? false,
          })),
        }));

        return { prompts };
      },

      // Get Prompt
      getPrompt: async (request: GetPromptRequest): Promise<GetPromptResponse> => {
        const prompt = this.prompts.get(request.name);
        if (!prompt) {
          throw new Error(`Prompt not found: ${request.name}`);
        }

        const args: Record<string, string> = {};
        for (const { key, value } of request.arguments) {
          args[key] = value;
        }

        const result = await prompt.handler(args);

        const messages: PromptMessage[] = result.messages.map((m) => ({
          role:
            m.role === 'user'
              ? Role.ROLE_USER
              : m.role === 'assistant'
                ? Role.ROLE_ASSISTANT
                : Role.ROLE_SYSTEM,
          content:
            typeof m.content === 'string'
              ? [{ content: { case: 'text' as const, value: { text: m.content } } }]
              : m.content.map(this.convertContentResult),
        }));

        return {
          description: result.description,
          messages,
        };
      },

      // Set Log Level
      setLogLevel: async (request: SetLogLevelRequest): Promise<SetLogLevelResponse> => {
        // TODO: Implement log level setting
        return {};
      },

      // Subscribe Logs (streaming)
      subscribeLogs: async function* (request) {
        // TODO: Implement log streaming
      },
    });
  }

  private convertContentResult(content: ContentResult): Content {
    switch (content.type) {
      case 'text':
        return {
          content: {
            case: 'text',
            value: { text: content.text ?? '' },
          },
        };
      case 'image':
        return {
          content: {
            case: 'image',
            value: {
              data: content.data ?? new Uint8Array(),
              mimeType: content.mimeType ?? 'image/png',
            },
          },
        };
      case 'resource':
        return {
          content: {
            case: 'resource',
            value: {
              uri: content.uri ?? '',
              mimeType: content.mimeType ?? 'text/plain',
              data: content.text
                ? { case: 'text', value: content.text }
                : { case: 'blob', value: content.data ?? new Uint8Array() },
            },
          },
        };
      default:
        return {
          content: {
            case: 'text',
            value: { text: '' },
          },
        };
    }
  }
}
