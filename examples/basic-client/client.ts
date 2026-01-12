import { McpClient, createHttpTransport } from '@grpc-mcp/client';

async function main() {
  // Create client instance
  const client = new McpClient({
    clientInfo: {
      name: 'example-client',
      version: '1.0.0',
    },
  });

  // Connect to server
  const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:50051';
  console.log(`Connecting to ${SERVER_URL}...`);

  const transport = createHttpTransport({ baseUrl: SERVER_URL });
  const session = await client.connect(transport);

  console.log(`Connected to ${session.serverInfo.name} v${session.serverInfo.version}`);
  console.log(`Protocol version: ${session.protocolVersion}`);
  if (session.instructions) {
    console.log(`Instructions: ${session.instructions}`);
  }
  console.log('');

  // List tools
  console.log('=== Tools ===');
  const tools = await client.listTools();
  for (const tool of tools) {
    console.log(`  ${tool.name}: ${tool.description}`);
  }
  console.log('');

  // Call calculator tool
  console.log('=== Calling calculator tool ===');
  const calcResult = await client.callTool('calculator', {
    operation: 'multiply',
    a: 7,
    b: 6,
  });
  console.log(`  Result: ${calcResult.content[0]?.text}`);
  console.log('');

  // Call greet tool
  console.log('=== Calling greet tool ===');
  const greetResult = await client.callTool('greet', {
    name: 'World',
  });
  console.log(`  Result: ${greetResult.content[0]?.text}`);
  console.log('');

  // List resources
  console.log('=== Resources ===');
  const resources = await client.listResources();
  for (const resource of resources) {
    console.log(`  ${resource.uri}: ${resource.name}`);
  }
  console.log('');

  // Read a resource
  console.log('=== Reading config resource ===');
  const configContent = await client.readResource('file:///example/config.json');
  console.log(`  Content: ${configContent[0]?.text}`);
  console.log('');

  // List prompts
  console.log('=== Prompts ===');
  const prompts = await client.listPrompts();
  for (const prompt of prompts) {
    console.log(`  ${prompt.name}: ${prompt.description}`);
  }
  console.log('');

  // Get a prompt
  console.log('=== Getting code-review prompt ===');
  const promptResult = await client.getPrompt('code-review', {
    language: 'TypeScript',
    focus: 'performance',
  });
  console.log(`  Description: ${promptResult.description}`);
  console.log('  Messages:');
  for (const msg of promptResult.messages) {
    const content = msg.content[0];
    const text = content?.content.case === 'text' ? content.content.value.text : '';
    console.log(`    [${msg.role}]: ${text}`);
  }
  console.log('');

  // Ping
  console.log('=== Ping ===');
  await client.ping();
  console.log('  Pong!');
  console.log('');

  // Disconnect
  await client.disconnect();
  console.log('Disconnected.');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
