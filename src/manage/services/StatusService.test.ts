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

import { getAllBalances, calculateTotalBalance, getAllUTXOs } from './BalanceService';
import { loadWallets, getWalletFromWIF } from './WalletGenerator';
import { getUserOffers } from '../../functions/Offer';
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
} from './StatusService';

describe('StatusService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStatusCache();

    // Setup default: main wallet from env
    process.env.FUNDING_WIF = 'test-wif';
    vi.mocked(getWalletFromWIF).mockReturnValue({
      paymentAddress: 'bc1qtest',
      receiveAddress: 'bc1qreceive',
      wif: 'test-wif',
    } as any);
    vi.mocked(loadWallets).mockReturnValue(null);
  });

  describe('getQuickStatus', () => {
    it('should return zeros when cache is empty', () => {
      const status = getQuickStatus();

      expect(status.totalBalance).toBe(0);
      expect(status.activeOfferCount).toBe(0);
      expect(status.pendingTxCount).toBe(0);
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

    it('should not throw on error', async () => {
      vi.mocked(getAllBalances).mockRejectedValue(new Error('Network error'));

      await expect(refreshBalanceAsync()).resolves.toBeUndefined();
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

    it('should not throw on error', async () => {
      vi.mocked(getAllUTXOs).mockRejectedValue(new Error('Network error'));

      await expect(refreshPendingAsync()).resolves.toBeUndefined();
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

    it('should not throw on error', async () => {
      vi.mocked(getUserOffers).mockRejectedValue(new Error('API error'));

      await expect(refreshOfferCountAsync()).resolves.toBeUndefined();
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
  });
});
