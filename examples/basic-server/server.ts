import { McpServer } from '@grpc-mcp/server';

// Create server instance
const server = new McpServer({
  name: 'example-server',
  version: '1.0.0',
  instructions: 'This is an example MCP server with a calculator tool.',
});

// Add a calculator tool
server.addTool({
  name: 'calculator',
  description: 'Performs basic math operations',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['add', 'subtract', 'multiply', 'divide'],
        description: 'The math operation to perform',
      },
      a: {
        type: 'number',
        description: 'First operand',
      },
      b: {
        type: 'number',
        description: 'Second operand',
      },
    },
    required: ['operation', 'a', 'b'],
  },
  handler: async ({ operation, a, b }) => {
    let result: number;

    switch (operation) {
      case 'add':
        result = (a as number) + (b as number);
        break;
      case 'subtract':
        result = (a as number) - (b as number);
        break;
      case 'multiply':
        result = (a as number) * (b as number);
        break;
      case 'divide':
        if (b === 0) {
          return {
            content: [{ type: 'text', text: 'Error: Division by zero' }],
            isError: true,
          };
        }
        result = (a as number) / (b as number);
        break;
      default:
        return {
          content: [{ type: 'text', text: `Unknown operation: ${operation}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: `Result: ${result}` }],
    };
  },
});

// Add a greeting tool
server.addTool({
  name: 'greet',
  description: 'Generates a greeting message',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the person to greet',
      },
    },
    required: ['name'],
  },
  handler: async ({ name }) => {
    return {
      content: [{ type: 'text', text: `Hello, ${name}! Welcome to gRPC MCP.` }],
    };
  },
});

// Add a sample resource
server.addResource({
  uri: 'file:///example/config.json',
  name: 'Example Config',
  description: 'An example configuration file',
  mimeType: 'application/json',
  handler: async () => {
    return {
      text: JSON.stringify(
        {
          version: '1.0.0',
          debug: true,
          maxConnections: 100,
        },
        null,
        2
      ),
    };
  },
});

// Add a sample prompt
server.addPrompt({
  name: 'code-review',
  description: 'Generate a code review prompt',
  arguments: [
    { name: 'language', description: 'Programming language', required: true },
    { name: 'focus', description: 'What to focus on', required: false },
  ],
  handler: async ({ language, focus }) => {
    const focusText = focus ? ` Focus especially on ${focus}.` : '';

    return {
      description: `Code review prompt for ${language}`,
      messages: [
        {
          role: 'system',
          content: `You are an expert ${language} code reviewer.${focusText}`,
        },
        {
          role: 'user',
          content: 'Please review the following code and provide feedback:',
        },
      ],
    };
  },
});

// Start the server
const PORT = parseInt(process.env.PORT ?? '50051', 10);

server.listen({ port: PORT }).then(() => {
  console.log(`gRPC MCP server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Available tools:');
  console.log('  - calculator: Performs basic math operations');
  console.log('  - greet: Generates a greeting message');
  console.log('');
  console.log('Available resources:');
  console.log('  - file:///example/config.json');
  console.log('');
  console.log('Available prompts:');
  console.log('  - code-review');
});
