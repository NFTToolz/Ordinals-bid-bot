import { vi } from 'vitest';

/**
 * In-memory file system state for testing
 */
interface FileSystemState {
  files: Map<string, string>;
  directories: Set<string>;
}

/**
 * Create a mock file system for testing
 */
export function createMockFileSystem() {
  const state: FileSystemState = {
    files: new Map(),
    directories: new Set(['/tmp', '/config', '/data']),
  };

  const mockFs = {
    /**
     * Read file synchronously
     */
    readFileSync: vi.fn().mockImplementation((path: string, encoding?: string) => {
      const content = state.files.get(path);
      if (content === undefined) {
        const error: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, open '${path}'`);
        error.code = 'ENOENT';
        error.errno = -2;
        error.syscall = 'open';
        error.path = path;
        throw error;
      }
      return encoding ? content : Buffer.from(content);
    }),

    /**
     * Write file synchronously
     */
    writeFileSync: vi.fn().mockImplementation((path: string, data: string | Buffer) => {
      const content = typeof data === 'string' ? data : data.toString();
      state.files.set(path, content);
    }),

    /**
     * Check if path exists
     */
    existsSync: vi.fn().mockImplementation((path: string) => {
      return state.files.has(path) || state.directories.has(path);
    }),

    /**
     * Delete file synchronously
     */
    unlinkSync: vi.fn().mockImplementation((path: string) => {
      if (!state.files.has(path)) {
        const error: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, unlink '${path}'`);
        error.code = 'ENOENT';
        error.errno = -2;
        error.syscall = 'unlink';
        error.path = path;
        throw error;
      }
      state.files.delete(path);
    }),

    /**
     * Get file stats
     */
    statSync: vi.fn().mockImplementation((path: string) => {
      if (!state.files.has(path) && !state.directories.has(path)) {
        const error: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, stat '${path}'`);
        error.code = 'ENOENT';
        error.errno = -2;
        error.syscall = 'stat';
        error.path = path;
        throw error;
      }

      const isDirectory = state.directories.has(path);
      const content = state.files.get(path) || '';

      return {
        isFile: () => !isDirectory,
        isDirectory: () => isDirectory,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        dev: 16777220,
        mode: isDirectory ? 16877 : 33188,
        nlink: 1,
        uid: 501,
        gid: 20,
        rdev: 0,
        blksize: 4096,
        ino: 12345,
        size: content.length,
        blocks: Math.ceil(content.length / 512),
        atimeMs: Date.now(),
        mtimeMs: Date.now(),
        ctimeMs: Date.now(),
        birthtimeMs: Date.now(),
        atime: new Date(),
        mtime: new Date(),
        ctime: new Date(),
        birthtime: new Date(),
      };
    }),

    /**
     * Create directory
     */
    mkdirSync: vi.fn().mockImplementation((path: string, options?: { recursive?: boolean }) => {
      state.directories.add(path);
    }),

    /**
     * Read directory
     */
    readdirSync: vi.fn().mockImplementation((path: string) => {
      if (!state.directories.has(path)) {
        const error: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, scandir '${path}'`);
        error.code = 'ENOENT';
        error.errno = -2;
        error.syscall = 'scandir';
        error.path = path;
        throw error;
      }

      const entries: string[] = [];
      const normalizedPath = path.endsWith('/') ? path : path + '/';

      for (const file of state.files.keys()) {
        if (file.startsWith(normalizedPath)) {
          const relativePath = file.slice(normalizedPath.length);
          const firstPart = relativePath.split('/')[0];
          if (firstPart && !entries.includes(firstPart)) {
            entries.push(firstPart);
          }
        }
      }

      for (const dir of state.directories) {
        if (dir.startsWith(normalizedPath) && dir !== path) {
          const relativePath = dir.slice(normalizedPath.length);
          const firstPart = relativePath.split('/')[0];
          if (firstPart && !entries.includes(firstPart)) {
            entries.push(firstPart);
          }
        }
      }

      return entries;
    }),

    /**
     * Copy file
     */
    copyFileSync: vi.fn().mockImplementation((src: string, dest: string) => {
      const content = state.files.get(src);
      if (content === undefined) {
        const error: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, copyfile '${src}'`);
        error.code = 'ENOENT';
        throw error;
      }
      state.files.set(dest, content);
    }),

    /**
     * Rename file
     */
    renameSync: vi.fn().mockImplementation((oldPath: string, newPath: string) => {
      const content = state.files.get(oldPath);
      if (content === undefined) {
        const error: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, rename '${oldPath}'`);
        error.code = 'ENOENT';
        throw error;
      }
      state.files.delete(oldPath);
      state.files.set(newPath, content);
    }),

    /**
     * Append to file
     */
    appendFileSync: vi.fn().mockImplementation((path: string, data: string | Buffer) => {
      const existing = state.files.get(path) || '';
      const content = typeof data === 'string' ? data : data.toString();
      state.files.set(path, existing + content);
    }),

    /**
     * Read file async
     */
    readFile: vi.fn().mockImplementation((path: string, options: any, callback?: any) => {
      const cb = typeof options === 'function' ? options : callback;
      const encoding = typeof options === 'string' ? options : options?.encoding;

      try {
        const content = mockFs.readFileSync(path, encoding);
        cb(null, content);
      } catch (error) {
        cb(error);
      }
    }),

    /**
     * Write file async
     */
    writeFile: vi.fn().mockImplementation((path: string, data: any, options: any, callback?: any) => {
      const cb = typeof options === 'function' ? options : callback;

      try {
        mockFs.writeFileSync(path, data);
        cb(null);
      } catch (error) {
        cb(error);
      }
    }),

    /**
     * Check access
     */
    accessSync: vi.fn().mockImplementation((path: string) => {
      if (!state.files.has(path) && !state.directories.has(path)) {
        const error: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, access '${path}'`);
        error.code = 'ENOENT';
        throw error;
      }
    }),

    /**
     * Create read stream (basic mock)
     */
    createReadStream: vi.fn().mockImplementation((path: string) => {
      const content = state.files.get(path);
      if (content === undefined) {
        const error: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, open '${path}'`);
        error.code = 'ENOENT';
        throw error;
      }

      const { Readable } = require('stream');
      return Readable.from([content]);
    }),

    /**
     * Create write stream (basic mock)
     */
    createWriteStream: vi.fn().mockImplementation((path: string) => {
      const { Writable } = require('stream');
      let data = '';

      const stream = new Writable({
        write(chunk: Buffer, encoding: string, callback: () => void) {
          data += chunk.toString();
          callback();
        },
        final(callback: () => void) {
          state.files.set(path, data);
          callback();
        },
      });

      return stream;
    }),

    // Constants
    constants: {
      F_OK: 0,
      R_OK: 4,
      W_OK: 2,
      X_OK: 1,
    },
  };

  return {
    mockFs,
    state,

    /**
     * Set file content
     */
    setFile(path: string, content: string): void {
      state.files.set(path, content);
    },

    /**
     * Set JSON file content
     */
    setJsonFile(path: string, data: any): void {
      state.files.set(path, JSON.stringify(data, null, 2));
    },

    /**
     * Get file content
     */
    getFile(path: string): string | undefined {
      return state.files.get(path);
    },

    /**
     * Check if file exists
     */
    hasFile(path: string): boolean {
      return state.files.has(path);
    },

    /**
     * Add directory
     */
    addDirectory(path: string): void {
      state.directories.add(path);
    },

    /**
     * Clear all files and reset directories
     */
    reset(): void {
      state.files.clear();
      state.directories.clear();
      state.directories.add('/tmp');
      state.directories.add('/config');
      state.directories.add('/data');
    },

    /**
     * Clear all mock call history
     */
    clearMocks(): void {
      Object.values(mockFs).forEach((value) => {
        if (typeof value === 'function' && 'mockClear' in value) {
          value.mockClear();
        }
      });
    },
  };
}

/**
 * Sample wallet config for testing
 */
export const sampleWalletConfig = {
  wallets: [
    {
      label: 'Wallet 1',
      wif: 'L1test1234567890abcdefghijklmnopqrstuvwxyz',
      paymentAddress: 'bc1qpayment1',
      receiveAddress: 'bc1preceive1',
      publicKey: '02abc123',
    },
    {
      label: 'Wallet 2',
      wif: 'L2test1234567890abcdefghijklmnopqrstuvwxyz',
      paymentAddress: 'bc1qpayment2',
      receiveAddress: 'bc1preceive2',
      publicKey: '02def456',
    },
  ],
  bidsPerMinute: 5,
  mnemonic: 'test mnemonic words here',
  createdAt: '2024-01-01T00:00:00Z',
  lastModified: '2024-01-01T00:00:00Z',
};

/**
 * Sample collection config for testing
 */
export const sampleCollectionConfig = [
  {
    collectionSymbol: 'test-collection-1',
    minBid: 0.001,
    maxBid: 0.01,
    minFloorBid: 50,
    maxFloorBid: 95,
    bidCount: 20,
    duration: 60,
    scheduledLoop: 60,
    enableCounterBidding: true,
    outBidMargin: 0.000001,
    offerType: 'ITEM',
    quantity: 1,
    feeSatsPerVbyte: 28,
    traits: [],
  },
  {
    collectionSymbol: 'test-collection-2',
    minBid: 0.002,
    maxBid: 0.02,
    minFloorBid: 60,
    maxFloorBid: 90,
    bidCount: 10,
    duration: 30,
    scheduledLoop: 120,
    enableCounterBidding: false,
    offerType: 'COLLECTION',
    quantity: 5,
  },
];

/**
 * Sample PID file content
 */
export const samplePidFile = {
  pid: 12345,
  startedAt: '2024-01-01T00:00:00Z',
  command: 'node',
  args: ['dist/bid.js'],
};

export default createMockFileSystem;
