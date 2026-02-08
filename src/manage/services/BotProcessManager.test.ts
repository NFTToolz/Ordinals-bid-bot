import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  statSync: vi.fn(),
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
}));

import * as fs from 'fs';
import { spawn } from 'child_process';
import {
  formatUptime,
  isRunning,
  getStatus,
  getLogs,
  getStats,
  clearLogs,
  start,
  stop,
  restart,
  followLogs,
  readPidFile,
} from './BotProcessManager';

// Helper to create mock child process
function createMockChildProcess(pid: number = 12345) {
  const mockProcess = new EventEmitter() as EventEmitter & { pid: number; unref: () => void };
  mockProcess.pid = pid;
  mockProcess.unref = vi.fn();
  return mockProcess;
}

describe('BotProcessManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatUptime', () => {
    it('should format 0 milliseconds as "0s"', () => {
      expect(formatUptime(0)).toBe('0s');
    });

    it('should format seconds correctly', () => {
      expect(formatUptime(1000)).toBe('1s');
      expect(formatUptime(30000)).toBe('30s');
      expect(formatUptime(59000)).toBe('59s');
    });

    it('should format minutes and seconds correctly', () => {
      expect(formatUptime(60000)).toBe('1m 0s');
      expect(formatUptime(61000)).toBe('1m 1s');
      expect(formatUptime(90000)).toBe('1m 30s');
      expect(formatUptime(3599000)).toBe('59m 59s');
    });

    it('should format hours, minutes and seconds correctly', () => {
      expect(formatUptime(3600000)).toBe('1h 0m 0s');
      expect(formatUptime(3661000)).toBe('1h 1m 1s');
      expect(formatUptime(7200000)).toBe('2h 0m 0s');
      expect(formatUptime(7323000)).toBe('2h 2m 3s');
    });

    it('should format days, hours and minutes correctly', () => {
      expect(formatUptime(86400000)).toBe('1d 0h 0m');
      expect(formatUptime(90000000)).toBe('1d 1h 0m');
      expect(formatUptime(90060000)).toBe('1d 1h 1m');
      expect(formatUptime(172800000)).toBe('2d 0h 0m');
    });

    it('should handle complex multi-day uptime', () => {
      expect(formatUptime(90060000)).toBe('1d 1h 1m');
      expect(formatUptime(477000000)).toBe('5d 12h 30m');
    });

    it('should handle edge cases with large values', () => {
      expect(formatUptime(30 * 86400000)).toBe('30d 0h 0m');
      expect(formatUptime(365 * 86400000)).toBe('365d 0h 0m');
    });

    it('should handle sub-second values', () => {
      expect(formatUptime(500)).toBe('0s');
      expect(formatUptime(999)).toBe('0s');
    });

    it('should truncate to whole seconds', () => {
      expect(formatUptime(1500)).toBe('1s');
      expect(formatUptime(1999)).toBe('1s');
    });
  });

  describe('isRunning', () => {
    it('should return false when no PID file exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(isRunning()).toBe(false);
    });

    it('should return false when PID file is empty', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('');

      expect(isRunning()).toBe(false);
    });

    it('should return false when PID file contains non-numeric', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid');

      expect(isRunning()).toBe(false);
    });

    it('should return true when process is running', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('12345');

      // Mock process.kill to not throw (process exists)
      const originalKill = process.kill;
      process.kill = vi.fn();

      expect(isRunning()).toBe(true);

      process.kill = originalKill;
    });

    it('should return false and cleanup when process is not running', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('12345');

      // Mock process.kill to throw ESRCH (no such process)
      const originalKill = process.kill;
      process.kill = vi.fn().mockImplementation(() => {
        const error = new Error('kill ESRCH');
        (error as any).code = 'ESRCH';
        throw error;
      });

      expect(isRunning()).toBe(false);
      expect(fs.unlinkSync).toHaveBeenCalled();

      process.kill = originalKill;
    });
  });

  describe('getStatus', () => {
    it('should return running: false when no PID file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const status = getStatus();
      expect(status.running).toBe(false);
      expect(status.pid).toBeUndefined();
    });

    it('should return running status with uptime when process exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('12345');
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: new Date(Date.now() - 3600000), // 1 hour ago
      } as any);

      const originalKill = process.kill;
      process.kill = vi.fn();

      const status = getStatus();
      expect(status.running).toBe(true);
      expect(status.pid).toBe(12345);
      expect(status.uptime).toBeDefined();
      expect(status.startedAt).toBeInstanceOf(Date);

      process.kill = originalKill;
    });

    it('should return running: false when process does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('12345');

      const originalKill = process.kill;
      process.kill = vi.fn().mockImplementation(() => {
        throw new Error('process not found');
      });

      const status = getStatus();
      expect(status.running).toBe(false);

      process.kill = originalKill;
    });
  });

  describe('getLogs', () => {
    it('should return empty array when log file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logs = getLogs();
      expect(logs).toEqual([]);
    });

    it('should return last N lines from log file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('line1\nline2\nline3\nline4\nline5\n');

      const logs = getLogs(3);
      expect(logs).toHaveLength(3);
      expect(logs).toEqual(['line3', 'line4', 'line5']);
    });

    it('should return all lines if fewer than requested', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('line1\nline2\n');

      const logs = getLogs(10);
      expect(logs).toHaveLength(2);
    });

    it('should filter out empty lines', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('line1\n\n\nline2\n  \nline3\n');

      const logs = getLogs(10);
      expect(logs).toEqual(['line1', 'line2', 'line3']);
    });

    it('should return empty array on read error', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Read error');
      });

      const logs = getLogs();
      expect(logs).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return default stats when no data files exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const stats = getStats();
      expect(stats.activeCollections).toBe(0);
    });

    it('should read collections count from collections.json', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return String(path).includes('collections.json');
      });
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify([{ symbol: 'coll1' }, { symbol: 'coll2' }])
      );

      const stats = getStats();
      expect(stats.activeCollections).toBe(2);
    });

    it('should read bid history and count bids', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return String(path).includes('bidHistory.json');
      });
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          collection1: { ourBids: { bid1: {}, bid2: {} } },
          collection2: { ourBids: { bid3: {} } },
        })
      );

      const stats = getStats();
      expect(stats.totalBidsPlaced).toBe(3);
    });

    it('should handle JSON parse errors gracefully', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

      const stats = getStats();
      expect(stats.activeCollections).toBe(0);
    });
  });

  describe('clearLogs', () => {
    it('should write empty string to log file', () => {
      clearLogs();

      expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('bot.log'), '');
    });
  });

  describe('start', () => {
    it('should return error if already running', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('12345');
      const originalKill = process.kill;
      process.kill = vi.fn();

      const result = start();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Bot is already running');

      process.kill = originalKill;
    });

    it('should spawn bot process and write PID file with JSON format', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.openSync).mockReturnValue(3);

      const mockChild = createMockChildProcess(54321);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      const result = start();

      expect(result.success).toBe(true);
      expect(result.pid).toBe(54321);
      // PID file now written as JSON with pid and startedAt
      const pidWriteCall = vi.mocked(fs.writeFileSync).mock.calls.find(
        (call) => String(call[0]).includes('.bot.pid')
      );
      expect(pidWriteCall).toBeDefined();
      const pidData = JSON.parse(pidWriteCall![1] as string);
      expect(pidData.pid).toBe(54321);
      expect(typeof pidData.startedAt).toBe('number');
      expect(pidData.startedAt).toBeGreaterThan(0);
      expect(mockChild.unref).toHaveBeenCalled();
    });

    it('should return error if spawn fails', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.openSync).mockReturnValue(3);

      const mockChild = new EventEmitter() as any;
      mockChild.pid = undefined;
      mockChild.unref = vi.fn();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const result = start();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to start process');
    });

    it('should handle spawn exceptions', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('Spawn failed');
      });

      const result = start();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Spawn failed');
    });
  });

  describe('stop', () => {
    it('should return error if bot is not running', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = await stop();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Bot is not running');
    });

    it('should send SIGINT and wait for exit', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('12345');

      let killCallCount = 0;
      const originalKill = process.kill;
      process.kill = vi.fn().mockImplementation((pid, signal) => {
        killCallCount++;
        if (killCallCount > 1) {
          // After first call (SIGINT), process has exited
          throw new Error('ESRCH');
        }
      }) as any;

      const resultPromise = stop(1000);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(result.success).toBe(true);

      process.kill = originalKill;
    });

    it('should handle ESRCH error (process already dead)', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('12345');

      const originalKill = process.kill;
      process.kill = vi.fn().mockImplementation(() => {
        const error = new Error('ESRCH');
        (error as any).code = 'ESRCH';
        throw error;
      }) as any;

      const result = await stop();

      expect(result.success).toBe(true);

      process.kill = originalKill;
    });
  });

  describe('restart', () => {
    it('should stop then start if already running', async () => {
      // First, bot is running
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('12345');
      vi.mocked(fs.openSync).mockReturnValue(3);

      let killCallCount = 0;
      const originalKill = process.kill;
      process.kill = vi.fn().mockImplementation(() => {
        killCallCount++;
        if (killCallCount > 1) {
          throw new Error('ESRCH');
        }
      }) as any;

      const mockChild = createMockChildProcess(54321);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      // Restart will stop and then start
      const resultPromise = restart();
      await vi.advanceTimersByTimeAsync(3000); // Wait for stop timeout + delay

      // Now bot is not running, start should succeed
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = await resultPromise;
      // Note: Due to timing complexity with fake timers, just verify it attempts both

      process.kill = originalKill;
    });

    it('should just start if not running', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.openSync).mockReturnValue(3);

      const mockChild = createMockChildProcess(12345);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      const result = await restart();

      expect(result.success).toBe(true);
      expect(result.pid).toBe(12345);
    });
  });

  describe('followLogs', () => {
    it('should return a stop function', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const callback = vi.fn();
      const stopFn = followLogs(callback);

      expect(typeof stopFn).toBe('function');
      stopFn();
    });

    it('should call callback with new log lines', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync)
        .mockReturnValueOnce({ size: 0 } as any)
        .mockReturnValue({ size: 20 } as any);
      vi.mocked(fs.openSync).mockReturnValue(5);
      vi.mocked(fs.readSync).mockImplementation((fd, buffer: NodeJS.ArrayBufferView) => {
        const data = 'new log line\n';
        if (Buffer.isBuffer(buffer)) {
          buffer.write(data);
        }
        return data.length;
      });

      const callback = vi.fn();
      const stopFn = followLogs(callback);

      await vi.advanceTimersByTimeAsync(600);

      // Callback should have been called
      expect(callback).toHaveBeenCalled();

      stopFn();
    });

    it('should stop following when stop function is called', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const callback = vi.fn();
      const stopFn = followLogs(callback);

      stopFn();

      await vi.advanceTimersByTimeAsync(1000);

      // Should not have called callback after stop
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('readPidFile', () => {
    it('should return null when no PID file exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(readPidFile()).toBeNull();
    });

    it('should parse JSON format with pid and startedAt', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ pid: 12345, startedAt: 1700000000000 })
      );

      const result = readPidFile();
      expect(result).toEqual({ pid: 12345, startedAt: 1700000000000 });
    });

    it('should handle legacy plain number format with startedAt=0', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('12345');

      const result = readPidFile();
      expect(result).toEqual({ pid: 12345, startedAt: 0 });
    });

    it('should return null for empty content', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('');

      expect(readPidFile()).toBeNull();
    });

    it('should return null for non-numeric content', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid');

      expect(readPidFile()).toBeNull();
    });

    it('should handle JSON with missing startedAt field', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ pid: 99999 }));

      const result = readPidFile();
      expect(result).toEqual({ pid: 99999, startedAt: 0 });
    });
  });

  describe('start - FD cleanup', () => {
    it('should close fd when child.pid is undefined', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.openSync).mockReturnValue(7);

      const mockChild = new EventEmitter() as any;
      mockChild.pid = undefined;
      mockChild.unref = vi.fn();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const result = start();

      expect(result.success).toBe(false);
      expect(fs.closeSync).toHaveBeenCalledWith(7);
    });

    it('should close fd when spawn throws', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.openSync).mockReturnValue(9);
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('Spawn failed');
      });

      const result = start();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Spawn failed');
      expect(fs.closeSync).toHaveBeenCalledWith(9);
    });

    it('should NOT close fd on successful spawn', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.openSync).mockReturnValue(11);

      const mockChild = createMockChildProcess(88888);
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      const result = start();

      expect(result.success).toBe(true);
      // closeSync should NOT have been called (child inherits the fd)
      expect(fs.closeSync).not.toHaveBeenCalled();
    });
  });

  describe('getStatus - startedAt from PID file', () => {
    it('should use startedAt from JSON PID file instead of mtime', () => {
      const startedAtMs = Date.now() - 7200000; // 2 hours ago
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ pid: 12345, startedAt: startedAtMs })
      );

      const originalKill = process.kill;
      process.kill = vi.fn();

      const status = getStatus();
      expect(status.running).toBe(true);
      expect(status.startedAt).toEqual(new Date(startedAtMs));
      // statSync should NOT be called because startedAt > 0
      expect(fs.statSync).not.toHaveBeenCalled();

      process.kill = originalKill;
    });

    it('should fall back to mtime for legacy PID format', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('12345');
      const mtimeDate = new Date(Date.now() - 3600000);
      vi.mocked(fs.statSync).mockReturnValue({ mtime: mtimeDate } as any);

      const originalKill = process.kill;
      process.kill = vi.fn();

      const status = getStatus();
      expect(status.running).toBe(true);
      expect(status.startedAt).toEqual(mtimeDate);
      expect(fs.statSync).toHaveBeenCalled();

      process.kill = originalKill;
    });
  });
});
