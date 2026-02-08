import { spawn, ChildProcess, execSync } from 'child_process';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { getErrorMessage } from '../../utils/errorUtils';
import { getSessionPassword } from '../services/WalletGenerator';

const PID_FILE = path.join(process.cwd(), '.bot.pid');
const LOG_FILE = path.join(process.cwd(), 'bot.log');

export interface BotStatus {
  running: boolean;
  pid?: number;
  uptime?: string;
  startedAt?: Date;
}

export interface BidHistoryEntry {
  offerType?: 'ITEM' | 'COLLECTION';
  ourBids: Record<string, { price: number; expiration: number; paymentAddress?: string }>;
  topBids: Record<string, boolean>;
  bottomListings?: Array<{ id: string; price: number }>;
  quantity?: number;
  lastSeenActivity?: number | null;
  highestCollectionOffer?: { price: number; buyerPaymentAddress: string };
}

export interface BotStats {
  activeCollections: number;
  totalBidsPlaced?: number;
  bidHistory?: Record<string, BidHistoryEntry>;
}

// Runtime stats served by bot's HTTP API
export interface BotRuntimeStats {
  timestamp: number;
  runtime: {
    startTime: number;
    uptimeSeconds: number;
  };
  bidStats: {
    bidsPlaced: number;
    bidsSkipped: number;
    bidsCancelled: number;
    bidsAdjusted: number;
    errors: number;
  };
  pacer: {
    bidsUsed: number;
    bidsRemaining: number;
    windowResetIn: number;
    totalBidsPlaced: number;
    totalWaits: number;
    bidsPerMinute: number;
  };
  walletPool: {
    available: number;
    total: number;
    bidsPerMinute: number;
    wallets: Array<{
      label: string;
      bidsInWindow: number;
      isAvailable: boolean;
      secondsUntilReset: number;
    }>;
  } | null;
  queue: {
    size: number;
    pending: number;
    active: number;
  };
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    percentage: number;
  };
  walletGroups: {
    groupCount: number;
    totalWallets: number;
    groups: Array<{
      name: string;
      available: number;
      total: number;
      bidsPerMinute: number;
      wallets: Array<{
        label: string;
        bidsInWindow: number;
        isAvailable: boolean;
        secondsUntilReset: number;
      }>;
    }>;
  } | null;
  totalWalletCount: number;
  websocket: {
    connected: boolean;
  };
  bidsTracked: number;
  bidHistory?: Record<string, BidHistoryEntry>;
  collections?: Array<{
    collectionSymbol: string;
    minBid: number;
    maxBid: number;
    minFloorBid: number;
    maxFloorBid: number;
    bidCount: number;
    duration: number;
    scheduledLoop?: number;
    enableCounterBidding: boolean;
    outBidMargin: number;
    offerType: 'ITEM' | 'COLLECTION';
    quantity: number;
    walletGroup?: string;
  }>;
}

/**
 * Check if the bot is currently running
 */
export function isRunning(): boolean {
  const pid = readPid();
  if (!pid) return false;

  try {
    // Check if process exists
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Process doesn't exist, clean up stale PID file
    fs.unlinkSync(PID_FILE);
    return false;
  }
}

/**
 * Get bot status
 */
export function getStatus(): BotStatus {
  const pidData = readPidFile();

  if (!pidData) {
    return { running: false };
  }

  try {
    // Check if process exists
    process.kill(pidData.pid, 0);

    // Use actual startedAt from PID file if available, fall back to mtime
    let startedAt: Date;
    if (pidData.startedAt > 0) {
      startedAt = new Date(pidData.startedAt);
    } else {
      const stat = fs.statSync(PID_FILE);
      startedAt = stat.mtime;
    }
    const uptime = formatUptime(Date.now() - startedAt.getTime());

    return {
      running: true,
      pid: pidData.pid,
      uptime,
      startedAt,
    };
  } catch (error) {
    // Process doesn't exist
    return { running: false };
  }
}

/**
 * Start the bot
 */
export function start(): { success: boolean; pid?: number; error?: string } {
  if (isRunning()) {
    return { success: false, error: 'Bot is already running' };
  }

  let logFd: number | null = null;
  try {
    // Ensure log file exists
    fs.writeFileSync(LOG_FILE, '', { flag: 'a' });

    logFd = fs.openSync(LOG_FILE, 'a');

    // If the manage session has a wallet password, pipe it to the child
    const sessionPassword = getSessionPassword();

    // Start the bot process
    const child = spawn('npx', ['ts-node', 'src/bid.ts'], {
      cwd: process.cwd(),
      detached: true,
      stdio: [sessionPassword ? 'pipe' : 'ignore', logFd, logFd],
      env: { ...process.env },
    });

    // Pipe the session password so the bot doesn't prompt again
    if (sessionPassword && child.stdin) {
      child.stdin.write(sessionPassword + '\n');
      child.stdin.end();
    }

    if (!child.pid) {
      fs.closeSync(logFd);
      return { success: false, error: 'Failed to start process' };
    }

    // Child inherits the fd; do NOT close logFd on success path

    // Write PID file with actual start time
    fs.writeFileSync(PID_FILE, JSON.stringify({ pid: child.pid, startedAt: Date.now() }));

    // Unref so parent can exit
    child.unref();

    return { success: true, pid: child.pid };
  } catch (error: unknown) {
    if (logFd !== null) {
      try { fs.closeSync(logFd); } catch (_) { /* ignore close error */ }
    }
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Stop the bot gracefully
 */
export async function stop(timeoutMs: number = 10000): Promise<{ success: boolean; error?: string }> {
  const pid = readPid();

  if (!pid) {
    return { success: false, error: 'Bot is not running' };
  }

  try {
    // Send SIGINT for graceful shutdown
    process.kill(pid, 'SIGINT');

    // Wait for process to exit
    const stopped = await waitForExit(pid, timeoutMs);

    if (stopped) {
      cleanupPidFile();
      return { success: true };
    }

    // Force kill if graceful shutdown failed
    try {
      process.kill(pid, 'SIGKILL');
      await waitForExit(pid, 5000);
    } catch (e) {
      // Process may already be dead
    }

    cleanupPidFile();
    return { success: true };
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as {code: unknown}).code === 'ESRCH') {
      // Process already dead
      cleanupPidFile();
      return { success: true };
    }
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Restart the bot
 */
export async function restart(): Promise<{ success: boolean; pid?: number; error?: string }> {
  if (isRunning()) {
    const stopResult = await stop();
    if (!stopResult.success) {
      return { success: false, error: `Failed to stop: ${stopResult.error}` };
    }
    // Wait a bit before starting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return start();
}

/**
 * Get recent logs
 */
export function getLogs(lines: number = 50): string[] {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return [];
    }

    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const allLines = content.split('\n').filter(l => l.trim());

    return allLines.slice(-lines);
  } catch (error) {
    return [];
  }
}

/**
 * Follow logs (returns a function to stop following)
 */
export function followLogs(
  callback: (line: string) => void
): () => void {
  let lastSize = 0;
  let stopped = false;

  if (fs.existsSync(LOG_FILE)) {
    lastSize = fs.statSync(LOG_FILE).size;
  }

  const interval = setInterval(() => {
    if (stopped) {
      clearInterval(interval);
      return;
    }

    try {
      if (!fs.existsSync(LOG_FILE)) {
        return;
      }

      const stat = fs.statSync(LOG_FILE);
      if (stat.size > lastSize) {
        const fd = fs.openSync(LOG_FILE, 'r');
        const buffer = Buffer.alloc(stat.size - lastSize);
        fs.readSync(fd, buffer, 0, buffer.length, lastSize);
        fs.closeSync(fd);

        const newContent = buffer.toString('utf-8');
        const lines = newContent.split('\n').filter(l => l.trim());
        lines.forEach(line => callback(line));

        lastSize = stat.size;
      }
    } catch (error) {
      // Ignore errors
    }
  }, 500);

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

/**
 * Get bot statistics
 */
export function getStats(): BotStats {
  const stats: BotStats = {
    activeCollections: 0,
  };

  // Try to read bidHistory.json
  const bidHistoryPath = path.join(process.cwd(), 'data/bidHistory.json');
  if (fs.existsSync(bidHistoryPath)) {
    try {
      const content = fs.readFileSync(bidHistoryPath, 'utf-8');
      const bidHistory = JSON.parse(content);
      stats.bidHistory = bidHistory;
      stats.activeCollections = Object.keys(bidHistory).length;

      // Count total bids
      let totalBids = 0;
      for (const collection in bidHistory) {
        totalBids += Object.keys(bidHistory[collection].ourBids || {}).length;
      }
      stats.totalBidsPlaced = totalBids;
    } catch (error) {
      // Ignore errors
    }
  }

  // Count collections from config
  const collectionsPath = path.join(process.cwd(), 'config/collections.json');
  if (fs.existsSync(collectionsPath)) {
    try {
      const content = fs.readFileSync(collectionsPath, 'utf-8');
      const collections = JSON.parse(content);
      stats.activeCollections = collections.length;
    } catch (error) {
      // Ignore errors
    }
  }

  return stats;
}

/**
 * Get the bot's HTTP API URL from the PID file.
 * Returns null if the bot is not running or has no API port recorded.
 */
export function getBotApiUrl(): string | null {
  const pidData = readPidFile();
  if (!pidData || !pidData.apiPort || pidData.apiPort <= 0) return null;

  // Verify process is actually running
  try {
    process.kill(pidData.pid, 0);
  } catch {
    return null;
  }

  return `http://127.0.0.1:${pidData.apiPort}`;
}

/**
 * Fetch live runtime stats from the bot's HTTP API.
 * Returns null on any error (timeout, connection refused, etc).
 */
export function fetchBotRuntimeStatsFromApi(): Promise<BotRuntimeStats | null> {
  const baseUrl = getBotApiUrl();
  if (!baseUrl) return Promise.resolve(null);

  return new Promise((resolve) => {
    const url = new URL('/api/stats', baseUrl);

    const req = http.get(url, { timeout: 2000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume(); // Drain response
        resolve(null);
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as BotRuntimeStats);
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Get bot runtime stats from the live HTTP API.
 */
export async function getBotRuntimeStats(): Promise<BotRuntimeStats | null> {
  return fetchBotRuntimeStatsFromApi();
}

/**
 * Clear log file
 */
export function clearLogs(): void {
  fs.writeFileSync(LOG_FILE, '');
}

// Helper functions

export function readPidFile(): { pid: number; startedAt: number; apiPort?: number } | null {
  try {
    if (!fs.existsSync(PID_FILE)) {
      return null;
    }
    const content = fs.readFileSync(PID_FILE, 'utf-8').trim();

    // Try JSON format first
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.pid === 'number' && !isNaN(parsed.pid)) {
        return {
          pid: parsed.pid,
          startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
          apiPort: typeof parsed.apiPort === 'number' ? parsed.apiPort : undefined,
        };
      }
    } catch (_) {
      // Not JSON, try legacy plain number format
    }

    // Legacy format: plain PID number
    const pid = parseInt(content, 10);
    if (isNaN(pid)) return null;
    return { pid, startedAt: 0 };
  } catch (error) {
    return null;
  }
}

function readPid(): number | null {
  return readPidFile()?.pid ?? null;
}

function cleanupPidFile(): void {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch (error) {
    // Ignore errors
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      process.kill(pid, 0);
      // Process still running
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      // Process has exited
      return true;
    }
  }

  return false;
}

export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
