import { vi } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Mock WebSocket class for testing
 */
export class MockWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  url: string;
  protocol: string = '';
  extensions: string = '';
  bufferedAmount: number = 0;
  binaryType: 'arraybuffer' | 'blob' = 'blob';

  // Callback handlers
  onopen: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;

  private sentMessages: any[] = [];
  private closeCode?: number;
  private closeReason?: string;

  constructor(url: string, protocols?: string | string[]) {
    super();
    this.url = url;
    if (protocols) {
      this.protocol = Array.isArray(protocols) ? protocols[0] : protocols;
    }
  }

  /**
   * Simulate connection opening
   */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    const event = { type: 'open' };
    if (this.onopen) this.onopen(event);
    this.emit('open', event);
  }

  /**
   * Simulate receiving a message
   */
  simulateMessage(data: any): void {
    const event = {
      type: 'message',
      data: typeof data === 'string' ? data : JSON.stringify(data),
    };
    if (this.onmessage) this.onmessage(event);
    this.emit('message', event);
  }

  /**
   * Simulate connection error
   */
  simulateError(error?: Error): void {
    const event = {
      type: 'error',
      error: error || new Error('WebSocket error'),
      message: error?.message || 'WebSocket error',
    };
    if (this.onerror) this.onerror(event);
    this.emit('error', event);
  }

  /**
   * Simulate connection closing
   */
  simulateClose(code: number = 1000, reason: string = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    const event = {
      type: 'close',
      code,
      reason,
      wasClean: code === 1000,
    };
    if (this.onclose) this.onclose(event);
    this.emit('close', event);
  }

  /**
   * Send a message (mock)
   */
  send(data: string | ArrayBuffer | Blob): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.sentMessages.push(data);
  }

  /**
   * Close the connection (mock)
   */
  close(code?: number, reason?: string): void {
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = MockWebSocket.CLOSING;
    // Simulate async close
    setTimeout(() => {
      this.simulateClose(code || 1000, reason || '');
    }, 0);
  }

  /**
   * Get all sent messages
   */
  getSentMessages(): any[] {
    return this.sentMessages;
  }

  /**
   * Get the last sent message
   */
  getLastSentMessage(): any {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  /**
   * Clear sent messages
   */
  clearSentMessages(): void {
    this.sentMessages = [];
  }

  /**
   * Add event listener (compatibility)
   */
  addEventListener(
    event: string,
    listener: (...args: any[]) => void
  ): void {
    this.on(event, listener);
  }

  /**
   * Remove event listener (compatibility)
   */
  removeEventListener(
    event: string,
    listener: (...args: any[]) => void
  ): void {
    this.off(event, listener);
  }
}

/**
 * Create a mock WebSocket factory
 */
export function createMockWebSocketFactory() {
  const instances: MockWebSocket[] = [];

  const factory = vi.fn().mockImplementation((url: string, protocols?: string | string[]) => {
    const ws = new MockWebSocket(url, protocols);
    instances.push(ws);
    return ws;
  });

  return {
    factory,
    getInstances: () => instances,
    getLastInstance: () => instances[instances.length - 1],
    clearInstances: () => {
      instances.length = 0;
    },
  };
}

/**
 * Mock WebSocket that auto-connects after a delay
 */
export function createAutoConnectWebSocket(connectDelayMs: number = 10) {
  return vi.fn().mockImplementation((url: string, protocols?: string | string[]) => {
    const ws = new MockWebSocket(url, protocols);
    setTimeout(() => {
      ws.simulateOpen();
    }, connectDelayMs);
    return ws;
  });
}

/**
 * Mock WebSocket that fails to connect
 */
export function createFailingWebSocket(errorMessage: string = 'Connection failed') {
  return vi.fn().mockImplementation((url: string, protocols?: string | string[]) => {
    const ws = new MockWebSocket(url, protocols);
    setTimeout(() => {
      ws.simulateError(new Error(errorMessage));
      ws.simulateClose(1006, errorMessage);
    }, 10);
    return ws;
  });
}

/**
 * Create a mock WebSocket that simulates Magic Eden websocket events
 */
export function createMagicEdenWebSocket() {
  const factory = createMockWebSocketFactory();

  return {
    ...factory,
    /**
     * Simulate a new offer event
     */
    simulateOfferEvent(collectionSymbol: string, tokenId: string, price: number) {
      const ws = factory.getLastInstance();
      if (ws) {
        ws.simulateMessage({
          type: 'offer',
          data: {
            collectionSymbol,
            tokenId,
            price,
            timestamp: Date.now(),
          },
        });
      }
    },
    /**
     * Simulate a listing event
     */
    simulateListingEvent(collectionSymbol: string, tokenId: string, price: number) {
      const ws = factory.getLastInstance();
      if (ws) {
        ws.simulateMessage({
          type: 'listing',
          data: {
            collectionSymbol,
            tokenId,
            price,
            timestamp: Date.now(),
          },
        });
      }
    },
    /**
     * Simulate a sale event
     */
    simulateSaleEvent(collectionSymbol: string, tokenId: string, price: number) {
      const ws = factory.getLastInstance();
      if (ws) {
        ws.simulateMessage({
          type: 'sale',
          data: {
            collectionSymbol,
            tokenId,
            price,
            timestamp: Date.now(),
          },
        });
      }
    },
    /**
     * Simulate a ping message
     */
    simulatePing() {
      const ws = factory.getLastInstance();
      if (ws) {
        ws.simulateMessage({ type: 'ping' });
      }
    },
    /**
     * Simulate subscription confirmation
     */
    simulateSubscribed(collectionSymbol: string) {
      const ws = factory.getLastInstance();
      if (ws) {
        ws.simulateMessage({
          type: 'subscribed',
          data: { collectionSymbol },
        });
      }
    },
  };
}

/**
 * Helper to setup WebSocket mock in global scope
 */
export function setupGlobalWebSocketMock(): {
  mockFactory: ReturnType<typeof createMockWebSocketFactory>;
  restore: () => void;
} {
  const mockFactory = createMockWebSocketFactory();
  const originalWebSocket = (global as any).WebSocket;

  (global as any).WebSocket = mockFactory.factory;

  return {
    mockFactory,
    restore: () => {
      (global as any).WebSocket = originalWebSocket;
    },
  };
}

export default MockWebSocket;
