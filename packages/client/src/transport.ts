import { createGrpcTransport as createConnectGrpcTransport } from '@connectrpc/connect-node';
import { createConnectTransport } from '@connectrpc/connect-node';
import type { Transport } from '@connectrpc/connect';
import type { TransportOptions } from './types.js';

/**
 * Create a gRPC transport (HTTP/2, binary protobuf)
 * Best for server-to-server communication
 */
export function createGrpcTransport(options: TransportOptions): Transport {
  return createConnectGrpcTransport({
    baseUrl: options.baseUrl,
    httpVersion: '2',
  });
}

/**
 * Create an HTTP transport (HTTP/1.1 or HTTP/2, works in more environments)
 * Best for browser or environments without HTTP/2 support
 */
export function createHttpTransport(options: TransportOptions): Transport {
  return createConnectTransport({
    baseUrl: options.baseUrl,
    httpVersion: options.http2 ? '2' : '1.1',
  });
}
