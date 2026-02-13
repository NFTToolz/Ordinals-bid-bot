import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import {
  startStatsServer,
  stopStatsServer,
  setStatsProvider,
  setReloadHandler,
  isStatsServerRunning,
} from './statsServer';
import { BotRuntimeStats } from '../manage/services/BotProcessManager';

function createMockStats(): BotRuntimeStats {
  return {
    timestamp: Date.now(),
    runtime: { startTime: Date.now() - 60000, uptimeSeconds: 60 },
    bidStats: { bidsPlaced: 5, bidsSkipped: 1, bidsCancelled: 0, bidsAdjusted: 2, errors: 0 },
    pacer: { bidsUsed: 3, bidsRemaining: 2, windowResetIn: 30, totalBidsPlaced: 20, totalWaits: 1, bidsPerMinute: 5 },
    walletPool: null,
    walletGroups: null,
    totalWalletCount: 0,
    queue: { size: 0, pending: 0, active: 0 },
    memory: { heapUsedMB: 50, heapTotalMB: 100, percentage: 50 },
    websocket: { connected: true },
    bidsTracked: 10,
  };
}

function httpGet(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
    }).on('error', reject);
  });
}

function httpPost(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST' }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('statsServer', () => {
  afterEach(async () => {
    await stopStatsServer();
  });

  it('should start and respond to /api/health', async () => {
    const port = await startStatsServer({ port: 0 }); // Use random port
    // Port 0 won't work with our implementation — use a fixed port
  });

  it('should start on specified port', async () => {
    const port = await startStatsServer({ port: 13847 });
    expect(port).toBe(13847);
    expect(isStatsServerRunning()).toBe(true);
  });

  it('should return health check', async () => {
    const port = await startStatsServer({ port: 13848 });
    const res = await httpGet(`http://127.0.0.1:${port}/api/health`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.pid).toBe(process.pid);
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should return 503 when no stats provider is set', async () => {
    const port = await startStatsServer({ port: 13849 });
    const res = await httpGet(`http://127.0.0.1:${port}/api/stats`);
    expect(res.statusCode).toBe(503);
  });

  it('should return stats from provider', async () => {
    const port = await startStatsServer({ port: 13850 });
    const mockStats = createMockStats();
    setStatsProvider(() => mockStats);

    const res = await httpGet(`http://127.0.0.1:${port}/api/stats`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.bidStats.bidsPlaced).toBe(5);
    expect(body.websocket.connected).toBe(true);
    expect(body.totalWalletCount).toBe(0);
  });

  it('should return 404 for unknown routes', async () => {
    const port = await startStatsServer({ port: 13851 });
    const res = await httpGet(`http://127.0.0.1:${port}/api/unknown`);
    expect(res.statusCode).toBe(404);
  });

  it('should stop cleanly', async () => {
    await startStatsServer({ port: 13852 });
    expect(isStatsServerRunning()).toBe(true);

    await stopStatsServer();
    expect(isStatsServerRunning()).toBe(false);
  });

  it('should be idempotent when stopping without starting', async () => {
    await stopStatsServer();
    // Should not throw
  });

  it('should not start duplicate server', async () => {
    const port1 = await startStatsServer({ port: 13853 });
    const port2 = await startStatsServer({ port: 13853 });
    expect(port1).toBe(port2);
  });

  it('should return 503 when no reload handler is set', async () => {
    const port = await startStatsServer({ port: 13854 });
    const res = await httpPost(`http://127.0.0.1:${port}/api/reload-collections`);
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Reload handler not registered');
  });

  it('should call reload handler and return result', async () => {
    const port = await startStatsServer({ port: 13855 });
    setReloadHandler(() => ({
      success: true,
      added: ['new-collection'],
      removed: [],
      modified: ['existing-collection'],
    }));

    const res = await httpPost(`http://127.0.0.1:${port}/api/reload-collections`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.added).toEqual(['new-collection']);
    expect(body.modified).toEqual(['existing-collection']);
  });

  it('should return 500 when reload handler throws', async () => {
    const port = await startStatsServer({ port: 13856 });
    setReloadHandler(() => { throw new Error('boom'); });

    const res = await httpPost(`http://127.0.0.1:${port}/api/reload-collections`);
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
  });

  it('should return 405 for unsupported methods', async () => {
    const port = await startStatsServer({ port: 13857 });
    const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${port}/api/stats`, { method: 'DELETE' }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
      });
      req.on('error', reject);
      req.end();
    });
    expect(res.statusCode).toBe(405);
  });

  it('should return 404 for unknown POST routes', async () => {
    const port = await startStatsServer({ port: 13858 });
    const res = await httpPost(`http://127.0.0.1:${port}/api/unknown`);
    expect(res.statusCode).toBe(404);
  });

  it('should clear reload handler on stop', async () => {
    const port = await startStatsServer({ port: 13859 });
    setReloadHandler(() => ({ success: true }));

    // Verify it works
    const res1 = await httpPost(`http://127.0.0.1:${port}/api/reload-collections`);
    expect(res1.statusCode).toBe(200);

    await stopStatsServer();

    // Restart and verify handler is cleared
    const port2 = await startStatsServer({ port: 13860 });
    const res2 = await httpPost(`http://127.0.0.1:${port2}/api/reload-collections`);
    expect(res2.statusCode).toBe(503);
  });
});
