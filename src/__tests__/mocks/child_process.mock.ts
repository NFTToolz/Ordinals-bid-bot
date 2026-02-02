/**
 * Mock child_process module for testing
 */
import { EventEmitter } from 'events';
import { vi } from 'vitest';

/**
 * Mock ChildProcess class that simulates spawn behavior
 */
export class MockChildProcess extends EventEmitter {
  pid: number;
  killed: boolean = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdin: MockStream;
  stdout: MockStream;
  stderr: MockStream;
  private _command: string;
  private _args: string[];

  constructor(command: string, args: string[] = [], pid: number = Math.floor(Math.random() * 10000) + 1000) {
    super();
    this._command = command;
    this._args = args;
    this.pid = pid;
    this.stdin = new MockStream();
    this.stdout = new MockStream();
    this.stderr = new MockStream();
  }

  kill(signal?: string): boolean {
    if (this.killed) return false;
    this.killed = true;
    this.signalCode = signal || 'SIGTERM';
    this.emit('exit', null, this.signalCode);
    this.emit('close', null, this.signalCode);
    return true;
  }

  // Simulate process exit
  simulateExit(code: number): void {
    this.exitCode = code;
    this.emit('exit', code, null);
    this.emit('close', code, null);
  }

  // Simulate stdout data
  simulateStdout(data: string | Buffer): void {
    this.stdout.emit('data', Buffer.from(data));
  }

  // Simulate stderr data
  simulateStderr(data: string | Buffer): void {
    this.stderr.emit('data', Buffer.from(data));
  }

  // Simulate error
  simulateError(error: Error): void {
    this.emit('error', error);
  }
}

/**
 * Mock stream class for stdin/stdout/stderr
 */
export class MockStream extends EventEmitter {
  writable: boolean = true;
  readable: boolean = true;
  private _data: Buffer[] = [];

  write(data: string | Buffer): boolean {
    this._data.push(Buffer.from(data));
    return true;
  }

  end(): void {
    this.writable = false;
  }

  setEncoding(encoding: BufferEncoding): this {
    return this;
  }

  pipe<T extends NodeJS.WritableStream>(destination: T): T {
    return destination;
  }
}

/**
 * Create a mock spawn function
 */
export function createMockSpawn(options: {
  exitCode?: number;
  exitDelay?: number;
  stdoutData?: string[];
  stderrData?: string[];
  pid?: number;
  shouldError?: Error;
} = {}) {
  const {
    exitCode = 0,
    exitDelay = 0,
    stdoutData = [],
    stderrData = [],
    pid,
    shouldError,
  } = options;

  return vi.fn().mockImplementation((command: string, args: string[] = []) => {
    const mockProcess = new MockChildProcess(command, args, pid);

    // Schedule stdout data
    if (stdoutData.length > 0) {
      setTimeout(() => {
        stdoutData.forEach((data, index) => {
          setTimeout(() => mockProcess.simulateStdout(data), index * 10);
        });
      }, 10);
    }

    // Schedule stderr data
    if (stderrData.length > 0) {
      setTimeout(() => {
        stderrData.forEach((data, index) => {
          setTimeout(() => mockProcess.simulateStderr(data), index * 10);
        });
      }, 10);
    }

    // Schedule error or exit
    if (shouldError) {
      setTimeout(() => {
        mockProcess.simulateError(shouldError);
      }, exitDelay);
    } else {
      setTimeout(() => {
        mockProcess.simulateExit(exitCode);
      }, exitDelay);
    }

    return mockProcess;
  });
}

/**
 * Create a mock execSync function
 */
export function createMockExecSync(options: {
  output?: string;
  shouldThrow?: Error;
} = {}) {
  const { output = '', shouldThrow } = options;

  return vi.fn().mockImplementation(() => {
    if (shouldThrow) {
      throw shouldThrow;
    }
    return Buffer.from(output);
  });
}

/**
 * Mock child_process module for vi.mock
 */
export function createChildProcessMock(options: {
  spawnOptions?: Parameters<typeof createMockSpawn>[0];
  execSyncOptions?: Parameters<typeof createMockExecSync>[0];
} = {}) {
  return {
    spawn: createMockSpawn(options.spawnOptions),
    execSync: createMockExecSync(options.execSyncOptions),
    exec: vi.fn(),
    execFile: vi.fn(),
    fork: vi.fn(),
    spawnSync: vi.fn(),
  };
}

// Export for testing
export default {
  MockChildProcess,
  MockStream,
  createMockSpawn,
  createMockExecSync,
  createChildProcessMock,
};
