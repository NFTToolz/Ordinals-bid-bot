import * as http from 'http';
import Logger from '../utils/logger';
import { BotRuntimeStats } from '../manage/services/BotProcessManager';

type StatsProvider = () => BotRuntimeStats;

let server: http.Server | null = null;
let statsProvider: StatsProvider | null = null;
let startTime: number = 0;

/**
 * Register a function that returns live BotRuntimeStats.
 * Called by the bot process after initializing all data sources.
 */
export function setStatsProvider(provider: StatsProvider): void {
  statsProvider = provider;
}

export interface StatsServerOptions {
  port?: number;
  host?: string;
}

/**
 * Start the stats HTTP server.
 * Bound to 127.0.0.1 by default (no external access).
 * Returns the port the server is listening on.
 */
export function startStatsServer(options: StatsServerOptions = {}): Promise<number> {
  const port = options.port || Number(process.env.BOT_API_PORT) || 3847;
  const host = options.host || '127.0.0.1';

  return new Promise((resolve, reject) => {
    if (server) {
      resolve(port);
      return;
    }

    startTime = Date.now();

    server = http.createServer((req, res) => {
      // Only allow GET
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      if (req.url === '/api/stats') {
        handleStats(res);
      } else if (req.url === '/api/health') {
        handleHealth(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        Logger.warning(`[STATS API] Port ${port} in use, stats API disabled`);
        server = null;
        // Don't reject — bot should still run without API
        resolve(0);
      } else {
        reject(err);
      }
    });

    server.listen(port, host, () => {
      Logger.info(`[STATS API] Listening on http://${host}:${port}`);
      resolve(port);
    });
  });
}

/**
 * Stop the stats HTTP server gracefully.
 */
export function stopStatsServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => {
      server = null;
      statsProvider = null;
      resolve();
    });
  });
}

/**
 * Check if the stats server is running.
 */
export function isStatsServerRunning(): boolean {
  return server !== null && server.listening;
}

function handleStats(res: http.ServerResponse): void {
  if (!statsProvider) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Stats not available yet' }));
    return;
  }

  try {
    const stats = statsProvider();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  }
}

function handleHealth(res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    pid: process.pid,
    uptime: Math.floor((Date.now() - startTime) / 1000),
  }));
}
