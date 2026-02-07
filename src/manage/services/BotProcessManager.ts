import { spawn, ChildProcess, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const PID_FILE = path.join(process.cwd(), '.bot.pid');
const LOG_FILE = path.join(process.cwd(), 'bot.log');

export interface BotStatus {
  running: boolean;
  pid?: number;
  uptime?: string;
  startedAt?: Date;
}

export interface BotStats {
  activeCollections: number;
  totalBidsPlaced?: number;
  bidHistory?: any;
}

// Runtime stats written by bot to botStats.json
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
  websocket: {
    connected: boolean;
  };
  bidsTracked: number;
}

const BOT_STATS_FILE = path.join(process.cwd(), 'data/botStats.json');

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
  const pid = readPid();

  if (!pid) {
    return { running: false };
  }

  try {
    // Check if process exists
    process.kill(pid, 0);

    // Get process start time if possible
    const stat = fs.statSync(PID_FILE);
    const startedAt = stat.mtime;
    const uptime = formatUptime(Date.now() - startedAt.getTime());

    return {
      running: true,
      pid,
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

  try {
    // Ensure log file exists
    fs.writeFileSync(LOG_FILE, '', { flag: 'a' });

    const logStream = fs.openSync(LOG_FILE, 'a');

    // Start the bot process
    const child = spawn('npx', ['ts-node', 'src/bid.ts'], {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', logStream, logStream],
      env: { ...process.env },
    });

    if (!child.pid) {
      return { success: false, error: 'Failed to start process' };
    }

    // Write PID file
    fs.writeFileSync(PID_FILE, child.pid.toString());

    // Unref so parent can exit
    child.unref();

    return { success: true, pid: child.pid };
  } catch (error: any) {
    return { success: false, error: error.message };
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
  } catch (error: any) {
    if (error.code === 'ESRCH') {
      // Process already dead
      cleanupPidFile();
      return { success: true };
    }
    return { success: false, error: error.message };
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
 * Get bot runtime stats from botStats.json
 * Returns null if file doesn't exist or is stale (>2 minutes old)
 */
export function getBotRuntimeStats(): BotRuntimeStats | null {
  try {
    if (!fs.existsSync(BOT_STATS_FILE)) {
      return null;
    }

    const content = fs.readFileSync(BOT_STATS_FILE, 'utf-8');
    const stats: BotRuntimeStats = JSON.parse(content);

    // Check if stats are stale (>2 minutes old)
    const ageMs = Date.now() - stats.timestamp;
    if (ageMs > 2 * 60 * 1000) {
      return null;  // Stats are too old, bot might not be running
    }

    return stats;
  } catch (error) {
    return null;
  }
}

/**
 * Clear log file
 */
export function clearLogs(): void {
  fs.writeFileSync(LOG_FILE, '');
}

// Helper functions

function readPid(): number | null {
  try {
    if (!fs.existsSync(PID_FILE)) {
      return null;
    }
    const content = fs.readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch (error) {
    return null;
  }
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
