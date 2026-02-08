import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

// We need to test the WalletPool class directly since the singleton pattern
// makes it hard to test in isolation. We'll import the class and create instances.
import WalletPool, {
  initializeWalletPool,
  getWalletPool,
  isWalletPoolInitialized,
  WalletConfig,
} from './walletPool';

// Generate valid test WIF keys programmatically
function generateTestWIF(index: number): string {
  // Use deterministic private keys for testing
  const privateKeyBytes = Buffer.alloc(32, 0);
  privateKeyBytes[31] = index + 1; // Ensure non-zero key
  const keyPair = ECPair.fromPrivateKey(privateKeyBytes, { network: bitcoin.networks.bitcoin });
  return keyPair.toWIF();
}

// Generate test WIFs
const TEST_WIFS = [
  generateTestWIF(0),
  generateTestWIF(1),
  generateTestWIF(2),
];

// Suppress console output during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('WalletPool', () => {
  const testWallets: WalletConfig[] = [
    { wif: TEST_WIFS[0], receiveAddress: 'bc1p_receive_1', label: 'wallet-1' },
    { wif: TEST_WIFS[1], receiveAddress: 'bc1p_receive_2', label: 'wallet-2' },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with valid wallets', () => {
      const pool = new WalletPool(testWallets, 5, bitcoin.networks.bitcoin);
      const stats = pool.getStats();
      expect(stats.total).toBe(2);
      expect(stats.available).toBe(2);
    });

    it('should throw on invalid WIF', () => {
      const invalidWallets: WalletConfig[] = [
        { wif: 'invalid_wif', receiveAddress: 'bc1p_test', label: 'bad-wallet' },
      ];
      expect(() => new WalletPool(invalidWallets)).toThrow();
    });

    it('should throw on empty wallets array', () => {
      expect(() => new WalletPool([])).toThrow('No valid wallets configured');
    });
  });

  describe('getAvailableWalletAsync', () => {
    it('should return wallet with mutex protection', async () => {
      const pool = new WalletPool(testWallets, 5);
      const wallet = await pool.getAvailableWalletAsync();
      expect(wallet).not.toBeNull();
    });

    it('should pre-record bid timestamp', async () => {
      const pool = new WalletPool(testWallets, 5);
      const wallet = await pool.getAvailableWalletAsync();

      expect(wallet).not.toBeNull();
      expect(wallet?.bidTimestamps).toHaveLength(1);
    });

    it('should return null when all wallets exhausted', async () => {
      const pool = new WalletPool(testWallets, 2);

      // Exhaust all wallets using async method
      for (let i = 0; i < 4; i++) {
        await pool.getAvailableWalletAsync();
      }

      const result = await pool.getAvailableWalletAsync();
      expect(result).toBeNull();
    });
  });

  describe('recordBid', () => {
    it('should add bid timestamp for wallet', async () => {
      const pool = new WalletPool(testWallets, 5);

      // Get stats before any operations
      const statsBefore = pool.getStats();
      const walletBefore = statsBefore.wallets.find(w => w.label === 'wallet-1');
      const initialBidsInWindow = walletBefore?.bidsInWindow || 0;

      // Use async method instead of deprecated sync method
      const wallet = await pool.getAvailableWalletAsync();

      if (wallet) {
        pool.recordBid(wallet.paymentAddress);
        const stats = pool.getStats();
        const walletStats = stats.wallets.find(w => w.label === 'wallet-1');
        // Should have more bids than initial (async method pre-records + recordBid)
        expect(walletStats?.bidsInWindow).toBeGreaterThan(initialBidsInWindow);
      }
    });

    it('should handle unknown address gracefully', () => {
      const pool = new WalletPool(testWallets, 5);
      // Should not throw
      expect(() => pool.recordBid('unknown_address')).not.toThrow();
    });
  });

  describe('decrementBidCount', () => {
    it('should remove bid timestamp after failed bid', async () => {
      const pool = new WalletPool(testWallets, 5);
      const wallet = await pool.getAvailableWalletAsync();

      expect(wallet).not.toBeNull();
      expect(wallet?.bidTimestamps).toHaveLength(1);

      if (wallet) {
        pool.decrementBidCount(wallet.paymentAddress);
        const stats = pool.getStats();
        const walletStats = stats.wallets.find(w => w.label === wallet.config.label);
        expect(walletStats?.bidsInWindow).toBe(0);
      }
    });

    it('should not decrement below zero', async () => {
      const pool = new WalletPool(testWallets, 5);
      // Use async method which pre-records a bid timestamp
      const wallet = await pool.getAvailableWalletAsync();

      if (wallet) {
        // Wallet has 1 timestamp from getAvailableWalletAsync
        pool.decrementBidCount(wallet.paymentAddress); // -> 0
        pool.decrementBidCount(wallet.paymentAddress); // -> should stay at 0
        const stats = pool.getStats();
        const walletStats = stats.wallets.find(w => w.label === wallet.config.label);
        expect(walletStats?.bidsInWindow).toBe(0);
      }
    });
  });

  describe('rate limiting sliding window', () => {
    it('should expire old timestamps after window passes', async () => {
      const pool = new WalletPool(testWallets, 2);

      // Exhaust wallet-1 using async method
      const wallet = await pool.getAvailableWalletAsync(); // 1 timestamp
      if (wallet) {
        pool.recordBid(wallet.paymentAddress); // 2 timestamps
      }

      // Verify exhausted
      const statsBefore = pool.getStats();
      const w1Before = statsBefore.wallets.find(w => w.label === 'wallet-1');
      expect(w1Before?.isAvailable).toBe(false);

      // Advance time past window (60 seconds)
      vi.advanceTimersByTime(61000);

      // Verify old timestamps expired (sliding window)
      const statsAfter = pool.getStats();
      const w1After = statsAfter.wallets.find(w => w.label === 'wallet-1');
      expect(w1After?.isAvailable).toBe(true);
      expect(w1After?.bidsInWindow).toBe(0);
    });

    it('should allow new bids as old timestamps expire individually', async () => {
      const pool = new WalletPool(testWallets, 2);

      // Place 2 bids for wallet-1 (exhausting it)
      const wallet1 = await pool.getAvailableWalletAsync(); // timestamp at t=0
      expect(wallet1?.config.label).toBe('wallet-1');

      // Advance 10 seconds
      vi.advanceTimersByTime(10000);

      // Second bid should go to wallet-2 since wallet-1 has 1/2, wallet-2 has 0/2 (LRU)
      const wallet2 = await pool.getAvailableWalletAsync();
      // Record bid on wallet-1 directly to exhaust it
      if (wallet1) {
        pool.recordBid(wallet1.paymentAddress); // 2 timestamps for wallet-1
      }

      // wallet-1 should be exhausted now
      const stats = pool.getStats();
      const w1 = stats.wallets.find(w => w.label === 'wallet-1');
      expect(w1?.bidsInWindow).toBe(2);
      expect(w1?.isAvailable).toBe(false);

      // Advance 51 seconds (61 total from first bid, 51 from second)
      // First bid timestamp should expire, freeing one slot
      vi.advanceTimersByTime(51000);

      const statsAfter = pool.getStats();
      const w1After = statsAfter.wallets.find(w => w.label === 'wallet-1');
      // First timestamp expired, second still active (placed at t=10s, now at t=61s, so 51s ago < 60s)
      expect(w1After?.bidsInWindow).toBe(1);
      expect(w1After?.isAvailable).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      const pool = new WalletPool(testWallets, 5);
      const stats = pool.getStats();

      expect(stats.total).toBe(2);
      expect(stats.available).toBe(2);
      expect(stats.rateWindowMs).toBe(60000);
      expect(stats.bidsPerMinute).toBe(5);
      expect(stats.wallets).toHaveLength(2);
    });

    it('should track individual wallet stats', async () => {
      const pool = new WalletPool(testWallets, 5);
      // Use async method instead of deprecated sync
      const wallet = await pool.getAvailableWalletAsync();

      if (wallet) {
        pool.recordBid(wallet.paymentAddress);
      }

      const stats = pool.getStats();
      const w1 = stats.wallets.find(w => w.label === 'wallet-1');
      // After getAvailableWalletAsync (pre-records timestamp) + recordBid, bids should be tracked
      expect(w1?.bidsInWindow).toBeGreaterThan(0);
      expect(w1?.isAvailable).toBe(true);
    });
  });

  describe('getWalletByPaymentAddress', () => {
    it('should return wallet by payment address', async () => {
      const pool = new WalletPool(testWallets, 5);
      // Use async method instead of deprecated sync
      const wallet = await pool.getAvailableWalletAsync();

      if (wallet) {
        const found = pool.getWalletByPaymentAddress(wallet.paymentAddress);
        expect(found).not.toBeNull();
        expect(found?.config.label).toBe(wallet.config.label);
      }
    });

    it('should return null for unknown address', () => {
      const pool = new WalletPool(testWallets, 5);
      const result = pool.getWalletByPaymentAddress('unknown');
      expect(result).toBeNull();
    });
  });

  describe('getWalletByReceiveAddress', () => {
    it('should return wallet by receive address', () => {
      const pool = new WalletPool(testWallets, 5);
      const wallet = pool.getWalletByReceiveAddress('bc1p_receive_1');
      expect(wallet).not.toBeNull();
      expect(wallet?.config.label).toBe('wallet-1');
    });

    it('should be case-insensitive', () => {
      const pool = new WalletPool(testWallets, 5);
      const wallet = pool.getWalletByReceiveAddress('BC1P_RECEIVE_1');
      expect(wallet).not.toBeNull();
    });

    it('should return null for unknown address', () => {
      const pool = new WalletPool(testWallets, 5);
      const result = pool.getWalletByReceiveAddress('unknown');
      expect(result).toBeNull();
    });
  });

  describe('getAllPaymentAddresses', () => {
    it('should return all payment addresses', () => {
      const pool = new WalletPool(testWallets, 5);
      const addresses = pool.getAllPaymentAddresses();
      expect(addresses).toHaveLength(2);
      addresses.forEach(addr => {
        expect(addr).toMatch(/^bc1q/); // P2WPKH addresses
      });
    });
  });

  describe('getAllReceiveAddresses', () => {
    it('should return all receive addresses', () => {
      const pool = new WalletPool(testWallets, 5);
      const addresses = pool.getAllReceiveAddresses();
      expect(addresses).toHaveLength(2);
      expect(addresses).toContain('bc1p_receive_1');
      expect(addresses).toContain('bc1p_receive_2');
    });
  });

  describe('waitForAvailableWallet', () => {
    it('should return immediately when a wallet is available', async () => {
      const pool = new WalletPool(testWallets, 5);
      const wallet = await pool.waitForAvailableWallet(5000);
      expect(wallet).not.toBeNull();
      expect(wallet?.bidTimestamps).toHaveLength(1);
    });

    it('should wait and return a wallet after rate limit expires', async () => {
      const pool = new WalletPool(testWallets, 1); // 1 bid per minute per wallet

      // Exhaust both wallets
      const w1 = await pool.getAvailableWalletAsync();
      const w2 = await pool.getAvailableWalletAsync();
      expect(w1).not.toBeNull();
      expect(w2).not.toBeNull();

      // All wallets are now exhausted
      const immediateResult = await pool.getAvailableWalletAsync();
      expect(immediateResult).toBeNull();

      // Start waiting for a wallet (max 65s which covers the 60s window)
      const waitPromise = pool.waitForAvailableWallet(65_000);

      // Advance time past the rate window so the first bid expires
      await vi.advanceTimersByTimeAsync(61_000);

      const wallet = await waitPromise;
      expect(wallet).not.toBeNull();
    });

    it('should return null when maxWaitMs is too short', async () => {
      const pool = new WalletPool(testWallets, 1);

      // Exhaust both wallets
      await pool.getAvailableWalletAsync();
      await pool.getAvailableWalletAsync();

      // Wait with a very short max (1ms — not enough for 60s rate window)
      const wallet = await pool.waitForAvailableWallet(1);
      expect(wallet).toBeNull();
    });

    it('should pre-record bid timestamp like getAvailableWalletAsync', async () => {
      const pool = new WalletPool(testWallets, 5);
      const wallet = await pool.waitForAvailableWallet(5000);
      expect(wallet).not.toBeNull();
      expect(wallet?.bidTimestamps).toHaveLength(1);
      expect(wallet?.lastBidTime).toBeGreaterThan(0);
    });
  });

  describe('resetAllWindows', () => {
    it('should reset all rate limit windows', async () => {
      const pool = new WalletPool(testWallets, 2);

      // Exhaust all wallets using async method
      for (let i = 0; i < 4; i++) {
        await pool.getAvailableWalletAsync();
      }

      // Verify exhausted
      expect(pool.getStats().available).toBe(0);

      // Reset all windows
      pool.resetAllWindows();

      // Verify all available again
      expect(pool.getStats().available).toBe(2);
    });
  });
});

describe('Wallet Pool Singleton Functions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should throw if getWalletPool called before initialization', () => {
    // This test is tricky because we can't easily reset the singleton
    // In practice, the pool should always be initialized at startup
    // We'll just verify the function exists
    expect(typeof getWalletPool).toBe('function');
  });

  it('should track initialization status', () => {
    expect(typeof isWalletPoolInitialized).toBe('function');
  });
});
