import { createClient, type Transport, type Client } from '@connectrpc/connect';
import {
  McpServer,
  InitializeRequest,
  ListToolsRequest,
  CallToolRequest,
  ListResourcesRequest,
  ReadResourceRequest,
  ListPromptsRequest,
  GetPromptRequest,
  Tool,
  Resource,
  Prompt,
  PromptMessage,
  Content,
  TextContent,
} from '@grpc-mcp/proto';
import type {
  McpClientOptions,
  ConnectedSession,
  ConnectionState,
  ToolCallResult,
  ContentItem,
} from './types.js';

const MCP_PROTOCOL_VERSION = '2025-11-25';

export class McpClient {
  private client: Client<typeof McpServer> | null = null;
  private transport: Transport | null = null;
  private options: McpClientOptions;
  private session: ConnectedSession | null = null;
  private _state: ConnectionState = 'disconnected';

  constructor(options: McpClientOptions) {
    this.options = options;
  }

  /** Current connection state */
  get state(): ConnectionState {
    return this._state;
  }

  /** Session info (available after connect) */
  get serverInfo(): ConnectedSession | null {
    return this.session;
  }

  /**
   * Connect to an MCP server
   */
  async connect(transport: Transport): Promise<ConnectedSession> {
    if (this._state === 'connected') {
      throw new Error('Already connected');
    }

    this._state = 'connecting';
    this.transport = transport;

    try {
      this.client = createClient(McpServer, transport);

      const response = await this.client.initialize({
        protocolVersion: MCP_PROTOCOL_VERSION,
        clientInfo: this.options.clientInfo,
        capabilities: this.options.capabilities ?? {},
      });

      this.session = {
        serverInfo: response.serverInfo!,
        capabilities: response.capabilities!,
        protocolVersion: response.protocolVersion,
        instructions: response.instructions,
      };

      this._state = 'connected';
      return this.session;
    } catch (error) {
      this._state = 'error';
      throw error;
    }
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    this.client = null;
    this.transport = null;
    this.session = null;
    this._state = 'disconnected';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List available tools
   */
  async listTools(): Promise<Tool[]> {
    this.assertConnected();

    const tools: Tool[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.client!.listTools({
        cursor,
      });
      tools.push(...response.tools);
      cursor = response.nextCursor;
    } while (cursor);

    return tools;
  }

  /**
   * Call a tool by name
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    this.assertConnected();

    const response = await this.client!.callTool({
      name,
      arguments: new TextEncoder().encode(JSON.stringify(args)),
    });

    return {
      content: response.content.map(this.convertContent),
      isError: response.isError,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOURCES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List available resources
   */
  async listResources(): Promise<Resource[]> {
    this.assertConnected();

    const resources: Resource[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.client!.listResources({
        cursor,
      });
      resources.push(...response.resources);
      cursor = response.nextCursor;
    } while (cursor);

    return resources;
  }

  /**
   * Read a resource by URI
   */
  async readResource(uri: string): Promise<ContentItem[]> {
    this.assertConnected();

    const response = await this.client!.readResource({ uri });

    return response.contents.map((r) => ({
      type: 'resource' as const,
      uri: r.uri,
      mimeType: r.mimeType,
      text: r.data.case === 'text' ? r.data.value : undefined,
      data: r.data.case === 'blob' ? r.data.value : undefined,
    }));
  }

  /**
   * Subscribe to resource updates
   */
  async *subscribeResource(uri: string): AsyncGenerator<ContentItem[]> {
    this.assertConnected();

    const stream = this.client!.subscribeResource({ uri });

    for await (const update of stream) {
      yield update.contents.map((r) => ({
        type: 'resource' as const,
        uri: r.uri,
        mimeType: r.mimeType,
        text: r.data.case === 'text' ? r.data.value : undefined,
        data: r.data.case === 'blob' ? r.data.value : undefined,
      }));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROMPTS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List available prompts
   */
  async listPrompts(): Promise<Prompt[]> {
    this.assertConnected();

    const prompts: Prompt[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.client!.listPrompts({
        cursor,
      });
      prompts.push(...response.prompts);
      cursor = response.nextCursor;
    } while (cursor);

    return prompts;
  }

  /**
   * Get a prompt with arguments filled in
   */
  async getPrompt(
    name: string,
    args: Record<string, string> = {}
  ): Promise<{ description?: string; messages: PromptMessage[] }> {
    this.assertConnected();

    const response = await this.client!.getPrompt({
      name,
      arguments: Object.entries(args).map(([key, value]) => ({ key, value })),
    });

    return {
      description: response.description,
      messages: response.messages,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ping the server
   */
  async ping(): Promise<void> {
    this.assertConnected();
    await this.client!.ping({});
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════════════════════

  private assertConnected(): asserts this is { client: Client<typeof McpServer> } {
    if (this._state !== 'connected' || !this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
  }

  private convertContent(content: Content): ContentItem {
    switch (content.content.case) {
      case 'text':
        return {
          type: 'text',
          text: content.content.value.text,
        };
      case 'image':
        return {
          type: 'image',
          data: content.content.value.data,
          mimeType: content.content.value.mimeType,
        };
      case 'audio':
        return {
          type: 'audio',
          data: content.content.value.data,
          mimeType: content.content.value.mimeType,
        };
      case 'resource':
        return {
          type: 'resource',
          uri: content.content.value.uri,
          mimeType: content.content.value.mimeType,
          text: content.content.value.data.case === 'text'
            ? content.content.value.data.value
            : undefined,
          data: content.content.value.data.case === 'blob'
            ? content.content.value.data.value
            : undefined,
        };
      default:
        return { type: 'text', text: '' };
    }
  }
}
