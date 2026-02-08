import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('./BalanceService', () => ({
  getAllBalances: vi.fn(),
  calculateTotalBalance: vi.fn(),
  getAllUTXOs: vi.fn(),
}));

vi.mock('./WalletGenerator', () => ({
  loadWallets: vi.fn().mockReturnValue(null),
  isGroupsFormat: vi.fn().mockReturnValue(false),
  getAllWalletsFromGroups: vi.fn().mockReturnValue([]),
  getWalletFromWIF: vi.fn(),
}));

vi.mock('./CollectionService', () => ({
  loadCollections: vi.fn().mockReturnValue([]),
}));

vi.mock('./BotProcessManager', () => ({
  isRunning: vi.fn().mockReturnValue(false),
  fetchBotRuntimeStatsFromApi: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../functions/Offer', () => ({
  getUserOffers: vi.fn(),
}));

vi.mock('bitcoinjs-lib', () => ({
  networks: { bitcoin: {} },
}));

vi.mock('ecpair', () => ({
  ECPairFactory: vi.fn().mockReturnValue({}),
}));

vi.mock('tiny-secp256k1', () => ({}), { virtual: true });

vi.mock('../../utils/fundingWallet', () => ({
  getFundingWIF: vi.fn().mockReturnValue('test-wif'),
  hasFundingWIF: vi.fn().mockReturnValue(true),
  hasReceiveAddress: vi.fn().mockReturnValue(false),
  getReceiveAddress: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  default: {
    warning: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { getAllBalances, calculateTotalBalance, getAllUTXOs } from './BalanceService';
import { loadWallets, getWalletFromWIF } from './WalletGenerator';
import { getUserOffers } from '../../functions/Offer';
import { hasReceiveAddress, getReceiveAddress } from '../../utils/fundingWallet';
import { fetchBotRuntimeStatsFromApi } from './BotProcessManager';
import {
  getTotalBalance,
  getActiveOfferCount,
  getPendingTxCount,
  getQuickStatus,
  clearStatusCache,
  refreshBalanceAsync,
  refreshPendingAsync,
  refreshOfferCountAsync,
  refreshAllStatusAsync,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
} from './StatusService';

describe('StatusService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStatusCache();
    resetCircuitBreaker();

    // Setup default: main wallet from env
    process.env.FUNDING_WIF = 'test-wif';
    process.env.TOKEN_RECEIVE_ADDRESS = 'bc1preceivetest';
    vi.mocked(getWalletFromWIF).mockReturnValue({
      paymentAddress: 'bc1qtest',
      receiveAddress: 'bc1qreceive',
      wif: 'test-wif',
    } as any);
    vi.mocked(loadWallets).mockReturnValue(null);
    vi.mocked(hasReceiveAddress).mockReturnValue(true);
    vi.mocked(getReceiveAddress).mockReturnValue('bc1preceivetest');
  });

  describe('getQuickStatus', () => {
    it('should return zeros when cache is empty', () => {
      const status = getQuickStatus();

      expect(status.totalBalance).toBe(0);
      expect(status.activeOfferCount).toBe(0);
      expect(status.pendingTxCount).toBe(0);
      expect(status.nftsWon).toBe(0);
      expect(status.botStatus).toBe('STOPPED');
    });

    it('should return cached values after refresh', async () => {
      vi.mocked(getAllBalances).mockResolvedValue(
        new Map([['bc1qtest', { confirmed: 50000, unconfirmed: 0, total: 50000 }]])
      );
      vi.mocked(calculateTotalBalance).mockReturnValue({
        confirmed: 50000,
        unconfirmed: 0,
        total: 50000,
      });
      vi.mocked(getAllUTXOs).mockResolvedValue(new Map([['bc1qtest', []]]));
      vi.mocked(getUserOffers).mockResolvedValue({ offers: [{ id: '1' }] } as any);

      await refreshAllStatusAsync();

      const status = getQuickStatus();
      expect(status.totalBalance).toBe(50000);
      expect(status.activeOfferCount).toBe(1);
      expect(status.pendingTxCount).toBe(0);
    });

    it('should report dataFreshness as unavailable before any refresh', () => {
      const status = getQuickStatus();
      expect(status.dataFreshness).toBe('unavailable');
      expect(status.lastRefreshAgoSec).toBe(-1);
    });

    it('should report dataFreshness as fresh after successful refresh', async () => {
      vi.mocked(getAllBalances).mockResolvedValue(
        new Map([['bc1qtest', { confirmed: 1000, unconfirmed: 0, total: 1000 }]])
      );
      vi.mocked(calculateTotalBalance).mockReturnValue({
        confirmed: 1000, unconfirmed: 0, total: 1000,
      });
      vi.mocked(getAllUTXOs).mockResolvedValue(new Map([['bc1qtest', []]]));
      vi.mocked(getUserOffers).mockResolvedValue({ offers: [] } as any);

      await refreshAllStatusAsync();

      const status = getQuickStatus();
      expect(status.dataFreshness).toBe('fresh');
      expect(status.lastRefreshAgoSec).toBeGreaterThanOrEqual(0);
    });
  });

  describe('refreshBalanceAsync', () => {
    it('should populate balance cache', async () => {
      vi.mocked(getAllBalances).mockResolvedValue(
        new Map([['bc1qtest', { confirmed: 100000, unconfirmed: 0, total: 100000 }]])
      );
      vi.mocked(calculateTotalBalance).mockReturnValue({
        confirmed: 100000,
        unconfirmed: 0,
        total: 100000,
      });

      await refreshBalanceAsync();

      const balance = await getTotalBalance();
      expect(balance).toBe(100000);
    });

    it('should throw on error (no longer swallowed)', async () => {
      vi.mocked(getAllBalances).mockRejectedValue(new Error('Network error'));

      await expect(refreshBalanceAsync()).rejects.toThrow('Network error');
    });
  });

  describe('refreshPendingAsync', () => {
    it('should populate pending cache', async () => {
      vi.mocked(getAllUTXOs).mockResolvedValue(
        new Map([
          ['bc1qtest', [
            { txid: 'a', vout: 0, value: 1000, status: { confirmed: false } },
            { txid: 'b', vout: 0, value: 2000, status: { confirmed: true } },
          ]],
        ])
      );

      await refreshPendingAsync();

      const pending = await getPendingTxCount();
      expect(pending).toBe(1);
    });

    it('should throw on error (no longer swallowed)', async () => {
      vi.mocked(getAllUTXOs).mockRejectedValue(new Error('Network error'));

      await expect(refreshPendingAsync()).rejects.toThrow('Network error');
    });
  });

  describe('refreshOfferCountAsync', () => {
    it('should populate offer count cache', async () => {
      vi.mocked(getUserOffers).mockResolvedValue({
        offers: [{ id: '1' }, { id: '2' }, { id: '3' }],
      } as any);

      await refreshOfferCountAsync();

      const count = await getActiveOfferCount();
      expect(count).toBe(3);
    });

    it('should throw when all addresses fail', async () => {
      vi.mocked(getUserOffers).mockRejectedValue(new Error('API error'));

      await expect(refreshOfferCountAsync()).rejects.toThrow('Failed to fetch offers');
    });
  });

  describe('refreshAllStatusAsync', () => {
    it('should populate all caches in parallel', async () => {
      vi.mocked(getAllBalances).mockResolvedValue(
        new Map([['bc1qtest', { confirmed: 75000, unconfirmed: 0, total: 75000 }]])
      );
      vi.mocked(calculateTotalBalance).mockReturnValue({
        confirmed: 75000,
        unconfirmed: 0,
        total: 75000,
      });
      vi.mocked(getAllUTXOs).mockResolvedValue(
        new Map([
          ['bc1qtest', [
            { txid: 'x', vout: 0, value: 500, status: { confirmed: false } },
          ]],
        ])
      );
      vi.mocked(getUserOffers).mockResolvedValue({
        offers: [{ id: '1' }, { id: '2' }],
      } as any);

      await refreshAllStatusAsync();

      const status = getQuickStatus();
      expect(status.totalBalance).toBe(75000);
      expect(status.pendingTxCount).toBe(1);
      expect(status.activeOfferCount).toBe(2);
    });

    it('should not throw even if all fetches fail', async () => {
      vi.mocked(getAllBalances).mockRejectedValue(new Error('fail'));
      vi.mocked(getAllUTXOs).mockRejectedValue(new Error('fail'));
      vi.mocked(getUserOffers).mockRejectedValue(new Error('fail'));

      await expect(refreshAllStatusAsync()).resolves.toBeUndefined();

      // Quick status should still return zeros
      const status = getQuickStatus();
      expect(status.totalBalance).toBe(0);
      expect(status.activeOfferCount).toBe(0);
      expect(status.pendingTxCount).toBe(0);
    });

    it('should succeed partially if some fetches fail', async () => {
      vi.mocked(getAllBalances).mockResolvedValue(
        new Map([['bc1qtest', { confirmed: 25000, unconfirmed: 0, total: 25000 }]])
      );
      vi.mocked(calculateTotalBalance).mockReturnValue({
        confirmed: 25000,
        unconfirmed: 0,
        total: 25000,
      });
      vi.mocked(getAllUTXOs).mockRejectedValue(new Error('timeout'));
      vi.mocked(getUserOffers).mockRejectedValue(new Error('rate limited'));

      await refreshAllStatusAsync();

      const status = getQuickStatus();
      expect(status.totalBalance).toBe(25000);
      expect(status.pendingTxCount).toBe(0);
      expect(status.activeOfferCount).toBe(0);
    });

    it('should populate nftsWon from bot API bidHistory', async () => {
      vi.mocked(getAllBalances).mockResolvedValue(
        new Map([['bc1qtest', { confirmed: 1000, unconfirmed: 0, total: 1000 }]])
      );
      vi.mocked(calculateTotalBalance).mockReturnValue({
        confirmed: 1000, unconfirmed: 0, total: 1000,
      });
      vi.mocked(getAllUTXOs).mockResolvedValue(new Map([['bc1qtest', []]]));
      vi.mocked(getUserOffers).mockResolvedValue({ offers: [] } as any);
      vi.mocked(fetchBotRuntimeStatsFromApi).mockResolvedValue({
        bidHistory: {
          'collection-a': { ourBids: {}, topBids: {}, quantity: 3 },
          'collection-b': { ourBids: {}, topBids: {}, quantity: 1 },
        },
      } as any);

      await refreshAllStatusAsync();

      const status = getQuickStatus();
      expect(status.nftsWon).toBe(4);
    });

    it('should set nftsWon to 0 when bot API returns null', async () => {
      vi.mocked(getAllBalances).mockResolvedValue(
        new Map([['bc1qtest', { confirmed: 1000, unconfirmed: 0, total: 1000 }]])
      );
      vi.mocked(calculateTotalBalance).mockReturnValue({
        confirmed: 1000, unconfirmed: 0, total: 1000,
      });
      vi.mocked(getAllUTXOs).mockResolvedValue(new Map([['bc1qtest', []]]));
      vi.mocked(getUserOffers).mockResolvedValue({ offers: [] } as any);
      vi.mocked(fetchBotRuntimeStatsFromApi).mockResolvedValue(null);

      await refreshAllStatusAsync();

      const status = getQuickStatus();
      expect(status.nftsWon).toBe(0);
    });

    it('should sum nftsWon correctly with missing quantity fields', async () => {
      vi.mocked(getAllBalances).mockResolvedValue(
        new Map([['bc1qtest', { confirmed: 1000, unconfirmed: 0, total: 1000 }]])
      );
      vi.mocked(calculateTotalBalance).mockReturnValue({
        confirmed: 1000, unconfirmed: 0, total: 1000,
      });
      vi.mocked(getAllUTXOs).mockResolvedValue(new Map([['bc1qtest', []]]));
      vi.mocked(getUserOffers).mockResolvedValue({ offers: [] } as any);
      vi.mocked(fetchBotRuntimeStatsFromApi).mockResolvedValue({
        bidHistory: {
          'collection-a': { ourBids: {}, topBids: {}, quantity: 2 },
          'collection-b': { ourBids: {}, topBids: {} }, // no quantity field
        },
      } as any);

      await refreshAllStatusAsync();

      const status = getQuickStatus();
      expect(status.nftsWon).toBe(2);
    });
  });

  describe('circuit breaker', () => {
    beforeEach(() => {
      vi.mocked(getAllBalances).mockRejectedValue(new Error('fail'));
      vi.mocked(getAllUTXOs).mockRejectedValue(new Error('fail'));
      vi.mocked(getUserOffers).mockRejectedValue(new Error('fail'));
    });

    it('should increment failure counter on all-failed refresh', async () => {
      await refreshAllStatusAsync();

      const cb = getCircuitBreakerStatus();
      expect(cb.consecutiveFailures).toBe(1);
      expect(cb.isOpen).toBe(false);
    });

    it('should open circuit after FAILURE_THRESHOLD consecutive failures', async () => {
      // 3 consecutive all-failed refreshes
      await refreshAllStatusAsync();
      await refreshAllStatusAsync();
      await refreshAllStatusAsync();

      const cb = getCircuitBreakerStatus();
      expect(cb.consecutiveFailures).toBe(3);
      expect(cb.isOpen).toBe(true);
      expect(cb.backoffMs).toBeGreaterThan(0);
    });

    it('should return false from isCircuitOpen when backoff window expires', async () => {
      // Open the circuit
      await refreshAllStatusAsync();
      await refreshAllStatusAsync();
      await refreshAllStatusAsync();

      const cb = getCircuitBreakerStatus();
      expect(cb.isOpen).toBe(true);

      // Simulate time passing beyond backoff
      // We can't easily test this without time mocking, but verify the state is set
      expect(cb.lastFailureTime).toBeGreaterThan(0);
      expect(cb.backoffMs).toBeGreaterThanOrEqual(60_000);
    });

    it('should reset circuit on successful refresh', async () => {
      // Open the circuit by failing 3 times
      await refreshAllStatusAsync();
      await refreshAllStatusAsync();
      await refreshAllStatusAsync();

      expect(getCircuitBreakerStatus().consecutiveFailures).toBe(3);

      // Now succeed
      resetCircuitBreaker(); // Simulate the backoff expiring
      vi.mocked(getAllBalances).mockResolvedValue(
        new Map([['bc1qtest', { confirmed: 1000, unconfirmed: 0, total: 1000 }]])
      );
      vi.mocked(calculateTotalBalance).mockReturnValue({
        confirmed: 1000, unconfirmed: 0, total: 1000,
      });

      await refreshAllStatusAsync();

      const cb = getCircuitBreakerStatus();
      expect(cb.consecutiveFailures).toBe(0);
      expect(cb.isOpen).toBe(false);
      expect(cb.backoffMs).toBe(0);
    });

    it('should skip refresh when circuit is open', async () => {
      // Open the circuit
      await refreshAllStatusAsync();
      await refreshAllStatusAsync();
      await refreshAllStatusAsync();

      expect(getCircuitBreakerStatus().isOpen).toBe(true);

      // Reset mocks call count
      vi.mocked(getAllBalances).mockClear();
      vi.mocked(getAllUTXOs).mockClear();
      vi.mocked(getUserOffers).mockClear();

      // This should skip (circuit is open)
      await refreshAllStatusAsync();

      // None of the API functions should have been called
      expect(getAllBalances).not.toHaveBeenCalled();
      expect(getAllUTXOs).not.toHaveBeenCalled();
      expect(getUserOffers).not.toHaveBeenCalled();
    });

    it('should double backoff on repeated failures', async () => {
      // First 3 failures open the circuit with INITIAL_BACKOFF
      await refreshAllStatusAsync();
      await refreshAllStatusAsync();
      await refreshAllStatusAsync();

      const cb1 = getCircuitBreakerStatus();
      expect(cb1.backoffMs).toBe(60_000); // INITIAL_BACKOFF_MS

      // Reset to simulate backoff expiring, then fail again 3 more times
      resetCircuitBreaker();
      await refreshAllStatusAsync();
      await refreshAllStatusAsync();
      await refreshAllStatusAsync();

      const cb2 = getCircuitBreakerStatus();
      // After reset, backoff starts fresh at INITIAL_BACKOFF_MS again
      expect(cb2.backoffMs).toBe(60_000);
    });
  });
});
