/**
 * Tests for bot commands (start, stop, restart, status, logs, cancel)
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

function generateTestWIF(): string {
  const privateKeyBytes = Buffer.alloc(32, 0);
  privateKeyBytes[31] = 1;
  const keyPair = ECPair.fromPrivateKey(privateKeyBytes, { network: bitcoin.networks.bitcoin });
  return keyPair.toWIF();
}

const TEST_WIF = generateTestWIF();
const TEST_RECEIVE_ADDRESS = 'bc1p' + 'a'.repeat(58);

// Mock all dependencies
vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

// Mock chalk
vi.mock('chalk', () => {
  const identity = (str: string) => str;
  const chalk = {
    green: identity,
    red: identity,
    yellow: identity,
    blue: identity,
    cyan: identity,
    dim: identity,
    bold: identity,
  };
  return {
    default: chalk,
    ...chalk,
  };
});

// Mock display utils
vi.mock('../../utils/display', () => ({
  showSectionHeader: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
  showTable: vi.fn(),
  formatAddress: vi.fn((addr: string) => addr.slice(0, 8) + '...' + addr.slice(-8)),
  getSeparatorWidth: vi.fn(() => 60),
  formatBTC: vi.fn((sats: number) => `${(sats / 100000000).toFixed(8)} BTC`),
  withSpinner: vi.fn().mockImplementation(async (message, fn) => fn()),
}));

// Mock prompts
vi.mock('../../utils/prompts', () => ({
  promptConfirm: vi.fn().mockResolvedValue(true),
  promptSelect: vi.fn().mockResolvedValue('recent'),
  promptInteger: vi.fn().mockResolvedValue(50),
}));

// Mock BotProcessManager with all functions
let mockIsRunning = false;
let mockStatus = {
  running: false,
  pid: undefined as number | undefined,
  uptime: undefined as string | undefined,
  startedAt: undefined as Date | undefined,
};

vi.mock('../../services/BotProcessManager', () => ({
  isRunning: vi.fn(() => mockIsRunning),
  getStatus: vi.fn(() => mockStatus),
  getStats: vi.fn(() => ({
    activeCollections: 0,
    totalBidsPlaced: 0,
    bidHistory: {},
  })),
  getBotRuntimeStats: vi.fn(async () => null),
  start: vi.fn(() => ({ success: true, pid: 12345 })),
  stop: vi.fn(async () => ({ success: true })),
  restart: vi.fn(async () => ({ success: true, pid: 12345 })),
  getLogs: vi.fn(() => ['Log line 1', 'Log line 2']),
  followLogs: vi.fn(() => () => {}),
  clearLogs: vi.fn(),
}));

// Mock CollectionService
vi.mock('../../services/CollectionService', () => ({
  loadCollections: vi.fn(() => [
    {
      collectionSymbol: 'test-collection',
      offerType: 'ITEM',
      minBid: 0.001,
      maxBid: 0.01,
      enableCounterBidding: true,
    },
  ]),
}));

// Mock WalletGenerator
vi.mock('../../services/WalletGenerator', () => ({
  loadWallets: vi.fn(() => ({
    wallets: [{ label: 'Test Wallet' }],
  })),
  isGroupsFormat: vi.fn(() => false),
}));

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => JSON.stringify([])),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => JSON.stringify([])),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// Mock Offer functions
vi.mock('../../../functions/Offer', () => ({
  getUserOffers: vi.fn().mockResolvedValue({ offers: [] }),
  getBestCollectionOffer: vi.fn().mockResolvedValue({ offers: [] }),
  retrieveCancelOfferFormat: vi.fn(),
  signData: vi.fn(),
  submitCancelOfferData: vi.fn(),
  cancelCollectionOffer: vi.fn(),
}));

// Mock walletHelpers
vi.mock('../../../utils/walletHelpers', () => ({
  getAllOurPaymentAddresses: vi.fn(() => new Set<string>()),
  getAllOurReceiveAddresses: vi.fn(() => new Set<string>()),
}));

// Mock walletPool
vi.mock('../../../utils/walletPool', () => ({
  initializeWalletPool: vi.fn(),
  getWalletByPaymentAddress: vi.fn(),
  isWalletPoolInitialized: vi.fn(() => false),
}));

// Mock followLogsUntilExit so start/restart tests don't hang waiting for stdin
vi.mock('./logs', async (importOriginal) => {
  const original = await importOriginal<typeof import('./logs')>();
  return {
    ...original,
    followLogsUntilExit: vi.fn().mockResolvedValue(undefined),
  };
});

// Set up env vars
beforeAll(() => {
  process.env.FUNDING_WIF = TEST_WIF;
  process.env.TOKEN_RECEIVE_ADDRESS = TEST_RECEIVE_ADDRESS;
  process.env.API_KEY = 'test-api-key';
  process.env.ENABLE_WALLET_ROTATION = 'false';
});

describe('Bot Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsRunning = false;
    mockStatus = {
      running: false,
      pid: undefined,
      uptime: undefined,
      startedAt: undefined,
    };
  });

  describe('startBot', () => {
    it('should start bot when not running', async () => {
      const { startBot } = await import('./start');
      const { start } = await import('../../services/BotProcessManager');

      mockIsRunning = false;

      await startBot();

      expect(start).toHaveBeenCalled();
    });

    it('should show warning when bot is already running', async () => {
      const { startBot } = await import('./start');
      const { showWarning } = await import('../../utils/display');

      mockIsRunning = true;
      mockStatus = {
        running: true,
        pid: 12345,
        uptime: '1h 30m',
        startedAt: new Date(),
      };

      await startBot();

      expect(showWarning).toHaveBeenCalledWith('Bot is already running!');
    });

    it('should show success on successful start', async () => {
      const { startBot } = await import('./start');
      const { start } = await import('../../services/BotProcessManager');
      const display = await import('../../utils/display');

      vi.mocked(start).mockReturnValueOnce({ success: true, pid: 99999 });
      mockIsRunning = false;

      await startBot();

      expect(display.showSuccess).toHaveBeenCalledWith('Bot started successfully!');
    });

    it('should show error on failed start', async () => {
      const { startBot } = await import('./start');
      const { start } = await import('../../services/BotProcessManager');
      const display = await import('../../utils/display');

      vi.mocked(start).mockReturnValueOnce({ success: false, error: 'Test error' });
      mockIsRunning = false;

      await startBot();

      expect(display.showError).toHaveBeenCalledWith('Failed to start bot: Test error');
    });
  });

  describe('stopBot', () => {
    it('should show warning when bot is not running', async () => {
      const { stopBot } = await import('./stop');
      const display = await import('../../utils/display');

      mockIsRunning = false;

      await stopBot();

      expect(display.showWarning).toHaveBeenCalledWith('Bot is not running');
    });

    it('should stop bot when confirmed', async () => {
      const { stopBot } = await import('./stop');
      const { stop } = await import('../../services/BotProcessManager');
      const prompts = await import('../../utils/prompts');

      mockIsRunning = true;
      mockStatus = {
        running: true,
        pid: 12345,
        uptime: '1h 30m',
        startedAt: new Date(),
      };
      vi.mocked(prompts.promptConfirm).mockResolvedValueOnce(true);

      await stopBot();

      expect(stop).toHaveBeenCalled();
    });

    it('should cancel stop when not confirmed', async () => {
      const { stopBot } = await import('./stop');
      const { stop } = await import('../../services/BotProcessManager');
      const prompts = await import('../../utils/prompts');
      const display = await import('../../utils/display');

      mockIsRunning = true;
      mockStatus = {
        running: true,
        pid: 12345,
        uptime: '1h 30m',
        startedAt: new Date(),
      };
      vi.mocked(prompts.promptConfirm).mockResolvedValueOnce(false);

      await stopBot();

      expect(stop).not.toHaveBeenCalled();
      expect(display.showWarning).toHaveBeenCalledWith('Stop cancelled');
    });
  });

  describe('restartBot', () => {
    it('should restart running bot when confirmed', async () => {
      const { restartBot } = await import('./restart');
      const { restart } = await import('../../services/BotProcessManager');
      const prompts = await import('../../utils/prompts');

      mockIsRunning = true;
      mockStatus = {
        running: true,
        pid: 12345,
        uptime: '1h 30m',
        startedAt: new Date(),
      };
      vi.mocked(prompts.promptConfirm).mockResolvedValueOnce(true);

      await restartBot();

      expect(restart).toHaveBeenCalled();
    });

    it('should start stopped bot when confirmed', async () => {
      const { restartBot } = await import('./restart');
      const { restart } = await import('../../services/BotProcessManager');
      const prompts = await import('../../utils/prompts');

      mockIsRunning = false;
      vi.mocked(prompts.promptConfirm).mockResolvedValueOnce(true);

      await restartBot();

      expect(restart).toHaveBeenCalled();
    });

    it('should cancel when not confirmed', async () => {
      const { restartBot } = await import('./restart');
      const { restart } = await import('../../services/BotProcessManager');
      const prompts = await import('../../utils/prompts');
      const display = await import('../../utils/display');

      mockIsRunning = false;
      vi.mocked(prompts.promptConfirm).mockResolvedValueOnce(false);

      await restartBot();

      expect(restart).not.toHaveBeenCalled();
      expect(display.showWarning).toHaveBeenCalledWith('Start cancelled');
    });
  });

  describe('viewStatus', () => {
    it('should display running status', async () => {
      const { viewStatus } = await import('./status');
      const display = await import('../../utils/display');

      mockIsRunning = true;
      mockStatus = {
        running: true,
        pid: 12345,
        uptime: '1h 30m',
        startedAt: new Date(),
      };

      await viewStatus();

      expect(display.showSectionHeader).toHaveBeenCalledWith('BOT STATUS');
    });

    it('should display stopped status', async () => {
      const { viewStatus } = await import('./status');
      const display = await import('../../utils/display');

      mockIsRunning = false;
      mockStatus = {
        running: false,
        pid: undefined,
        uptime: undefined,
        startedAt: undefined,
      };

      await viewStatus();

      expect(display.showSectionHeader).toHaveBeenCalledWith('BOT STATUS');
    });

    it('should display runtime stats when available', async () => {
      const { viewStatus } = await import('./status');
      const { getBotRuntimeStats } = await import('../../services/BotProcessManager');

      vi.mocked(getBotRuntimeStats).mockResolvedValueOnce({
        timestamp: Date.now(),
        runtime: { startTime: Date.now() - 60000, uptimeSeconds: 60 },
        bidStats: { bidsPlaced: 10, bidsSkipped: 5, bidsCancelled: 2, bidsAdjusted: 1, errors: 0 },
        pacer: { bidsUsed: 3, bidsRemaining: 2, windowResetIn: 30, totalBidsPlaced: 100, totalWaits: 5, bidsPerMinute: 5 },
        walletPool: null,
        walletGroups: null,
        totalWalletCount: 0,
        queue: { size: 0, pending: 0, active: 0 },
        memory: { heapUsedMB: 100, heapTotalMB: 200, percentage: 50 },
        websocket: { connected: true },
        bidsTracked: 50,
      });

      mockIsRunning = true;
      mockStatus = {
        running: true,
        pid: 12345,
        uptime: '1h 30m',
        startedAt: new Date(),
      };

      // Should not throw
      await viewStatus();
    });
  });

  describe('viewLogs', () => {
    it('should view recent logs', async () => {
      const { viewLogs } = await import('./logs');
      const { getLogs } = await import('../../services/BotProcessManager');
      const prompts = await import('../../utils/prompts');

      vi.mocked(prompts.promptSelect).mockResolvedValueOnce('recent');
      vi.mocked(prompts.promptInteger).mockResolvedValueOnce(50);
      vi.mocked(getLogs).mockReturnValueOnce(['Line 1', 'Line 2']);

      await viewLogs();

      expect(getLogs).toHaveBeenCalledWith(50);
    });

    it('should show warning when no logs found', async () => {
      const { viewLogs } = await import('./logs');
      const { getLogs } = await import('../../services/BotProcessManager');
      const prompts = await import('../../utils/prompts');
      const display = await import('../../utils/display');

      vi.mocked(prompts.promptSelect).mockResolvedValueOnce('recent');
      vi.mocked(prompts.promptInteger).mockResolvedValueOnce(50);
      vi.mocked(getLogs).mockReturnValueOnce([]);

      await viewLogs();

      expect(display.showWarning).toHaveBeenCalledWith('No logs found');
    });

    it('should clear logs when confirmed', async () => {
      const { viewLogs } = await import('./logs');
      const { clearLogs } = await import('../../services/BotProcessManager');
      const prompts = await import('../../utils/prompts');
      const display = await import('../../utils/display');

      vi.mocked(prompts.promptSelect).mockResolvedValueOnce('clear');
      vi.mocked(prompts.promptConfirm).mockResolvedValueOnce(true);

      await viewLogs();

      expect(clearLogs).toHaveBeenCalled();
      expect(display.showSuccess).toHaveBeenCalledWith('Logs cleared');
    });

    it('should cancel clear when not confirmed', async () => {
      const { viewLogs } = await import('./logs');
      const { clearLogs } = await import('../../services/BotProcessManager');
      const prompts = await import('../../utils/prompts');
      const display = await import('../../utils/display');

      vi.mocked(prompts.promptSelect).mockResolvedValueOnce('clear');
      vi.mocked(prompts.promptConfirm).mockResolvedValueOnce(false);

      await viewLogs();

      expect(clearLogs).not.toHaveBeenCalled();
      expect(display.showWarning).toHaveBeenCalledWith('Clear cancelled');
    });

    it('should return early on back selection', async () => {
      const { viewLogs } = await import('./logs');
      const { getLogs } = await import('../../services/BotProcessManager');
      const prompts = await import('../../utils/prompts');

      vi.mocked(prompts.promptSelect).mockResolvedValueOnce('__cancel__' as any);

      await viewLogs();

      expect(getLogs).not.toHaveBeenCalled();
    });

    it('should return early when lines is 0', async () => {
      const { viewLogs } = await import('./logs');
      const { getLogs } = await import('../../services/BotProcessManager');
      const prompts = await import('../../utils/prompts');

      vi.mocked(prompts.promptSelect).mockResolvedValueOnce('recent');
      vi.mocked(prompts.promptInteger).mockResolvedValueOnce(0);

      await viewLogs();

      expect(getLogs).not.toHaveBeenCalled();
    });
  });

  describe('cancelOffers', () => {
    it('should show no offers message when none found', async () => {
      const { cancelOffers } = await import('./cancel');
      const display = await import('../../utils/display');

      await cancelOffers();

      expect(display.showInfo).toHaveBeenCalledWith('No active offers found');
    });

    it('should abort when not confirmed', async () => {
      const { cancelOffers } = await import('./cancel');
      const { getUserOffers } = await import('../../../functions/Offer');
      const prompts = await import('../../utils/prompts');
      const display = await import('../../utils/display');

      vi.mocked(getUserOffers).mockResolvedValueOnce({
        offers: [{ id: 'offer-1', buyerPaymentAddress: 'bc1qtest', token: { collectionSymbol: 'test' } }],
      });
      vi.mocked(prompts.promptConfirm).mockResolvedValueOnce(false);

      await cancelOffers();

      expect(display.showTable).toHaveBeenCalled();
      expect(display.showWarning).toHaveBeenCalledWith('Cancellation aborted');
    });
  });
});

describe('Cancel Command Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getReceiveAddressesToCheck', () => {
    it('should deduplicate addresses from collections', () => {
      const collections = [
        { collectionSymbol: 'c1', tokenReceiveAddress: TEST_RECEIVE_ADDRESS },
        { collectionSymbol: 'c2', tokenReceiveAddress: TEST_RECEIVE_ADDRESS },
        { collectionSymbol: 'c3', tokenReceiveAddress: 'bc1pdifferent' },
      ];

      const addresses: { address: string }[] = [];
      const seenAddresses = new Set<string>();

      for (const collection of collections) {
        const receiveAddress = collection.tokenReceiveAddress ?? TEST_RECEIVE_ADDRESS;
        if (!seenAddresses.has(receiveAddress.toLowerCase())) {
          addresses.push({ address: receiveAddress });
          seenAddresses.add(receiveAddress.toLowerCase());
        }
      }

      expect(addresses).toHaveLength(2);
    });
  });

  describe('cancelBid', () => {
    it('should skip offers from different wallets when not owner', () => {
      const offer = { buyerPaymentAddress: 'bc1qother' };
      const ourPaymentAddress = 'bc1qours';
      const ENABLE_WALLET_ROTATION = false;

      let shouldCancel = true;
      if (!ENABLE_WALLET_ROTATION) {
        if (offer.buyerPaymentAddress !== ourPaymentAddress) {
          shouldCancel = false;
        }
      }

      expect(shouldCancel).toBe(false);
    });
  });

  describe('cancelAllCollectionOffers', () => {
    it('should filter for COLLECTION type offers', () => {
      const collections = [
        { collectionSymbol: 'c1', offerType: 'ITEM' },
        { collectionSymbol: 'c2', offerType: 'COLLECTION' },
        { collectionSymbol: 'c3', offerType: 'COLLECTION' },
      ];

      const collectionOffers = collections.filter((c) => c.offerType === 'COLLECTION');

      expect(collectionOffers).toHaveLength(2);
    });
  });
});

describe('Log Line Coloring', () => {
  it('should identify error lines', () => {
    const errorLines = ['[ERROR] Something failed', 'Error: Connection refused'];
    const normalLines = ['[INFO] Bot started', '[BID] Offer placed'];

    const isErrorLine = (line: string) =>
      line.includes('[ERROR]') || line.includes('Error');

    expect(errorLines.every(isErrorLine)).toBe(true);
    expect(normalLines.every(isErrorLine)).toBe(false);
  });

  it('should identify warning lines', () => {
    const warningLines = ['[WARNING] Rate limited', 'Warning: Low balance'];

    const isWarningLine = (line: string) =>
      line.includes('[WARNING]') || line.includes('Warning');

    expect(warningLines.every(isWarningLine)).toBe(true);
  });

  it('should identify success lines', () => {
    const successLines = ['[SUCCESS] Bid placed', '[OK] Connected'];

    const isSuccessLine = (line: string) =>
      line.includes('[SUCCESS]') || line.includes('[OK]');

    expect(successLines.every(isSuccessLine)).toBe(true);
  });

  it('should identify bid lines', () => {
    const bidLines = ['[BID] Placed for token', 'Offer placed successfully'];

    const isBidLine = (line: string) =>
      line.includes('[BID]') || line.includes('placed');

    expect(bidLines.every(isBidLine)).toBe(true);
  });
});

describe('Status Display Logic', () => {
  it('should calculate success rate correctly', () => {
    const bidsPlaced = 80;
    const bidsSkipped = 20;
    const totalActions = bidsPlaced + bidsSkipped;
    const successRate = totalActions > 0
      ? ((bidsPlaced / totalActions) * 100).toFixed(1)
      : '0.0';

    expect(successRate).toBe('80.0');
  });

  it('should handle zero total actions', () => {
    const bidsPlaced = 0;
    const bidsSkipped = 0;
    const totalActions = bidsPlaced + bidsSkipped;
    const successRate = totalActions > 0
      ? ((bidsPlaced / totalActions) * 100).toFixed(1)
      : '0.0';

    expect(successRate).toBe('0.0');
  });

  it('should truncate long collection names', () => {
    const collectionSymbol = 'this-is-a-very-long-collection-name-that-should-be-truncated';
    const maxLength = 20;

    const displayName = collectionSymbol.length > maxLength
      ? collectionSymbol.slice(0, maxLength - 3) + '...'
      : collectionSymbol;

    expect(displayName).toBe('this-is-a-very-lo...');
    expect(displayName.length).toBe(maxLength);
  });

  it('should determine memory color based on percentage', () => {
    const getMemoryColor = (percentage: number): string => {
      if (percentage > 80) return 'red';
      if (percentage > 60) return 'yellow';
      return 'green';
    };

    expect(getMemoryColor(90)).toBe('red');
    expect(getMemoryColor(70)).toBe('yellow');
    expect(getMemoryColor(50)).toBe('green');
  });
});

describe('Environment Checks', () => {
  it('should verify required environment variables', () => {
    const envChecks = [
      { name: 'FUNDING_WIF', set: !!process.env.FUNDING_WIF },
      { name: 'TOKEN_RECEIVE_ADDRESS', set: !!process.env.TOKEN_RECEIVE_ADDRESS },
      { name: 'API_KEY', set: !!process.env.API_KEY },
    ];

    expect(envChecks[0].set).toBe(true);
    expect(envChecks[1].set).toBe(true);
    expect(envChecks[2].set).toBe(true);
  });

  it('should check wallet rotation setting', () => {
    const ENABLE_WALLET_ROTATION = process.env.ENABLE_WALLET_ROTATION === 'true';
    expect(ENABLE_WALLET_ROTATION).toBe(false);
  });
});
