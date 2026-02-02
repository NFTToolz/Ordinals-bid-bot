import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateTotalBalance,
  AddressBalance,
  getBalance,
  getUTXOs,
  getAllBalances,
  getAllUTXOs,
  getFeeRates,
  getTransaction,
  getTransactionStatus,
  UTXO,
} from './BalanceService';

// Mock axios
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

import axios from 'axios';

describe('BalanceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('calculateTotalBalance', () => {
    it('should calculate total balance from single address', () => {
      const balances: AddressBalance[] = [
        {
          address: 'bc1qtest1',
          confirmed: 100000,
          unconfirmed: 50000,
          total: 150000,
          utxoCount: 2,
        },
      ];

      const result = calculateTotalBalance(balances);

      expect(result.confirmed).toBe(100000);
      expect(result.unconfirmed).toBe(50000);
      expect(result.total).toBe(150000);
    });

    it('should aggregate balances from multiple addresses', () => {
      const balances: AddressBalance[] = [
        {
          address: 'bc1qtest1',
          confirmed: 100000,
          unconfirmed: 50000,
          total: 150000,
          utxoCount: 2,
        },
        {
          address: 'bc1qtest2',
          confirmed: 200000,
          unconfirmed: 0,
          total: 200000,
          utxoCount: 1,
        },
      ];

      const result = calculateTotalBalance(balances);

      expect(result.confirmed).toBe(300000);
      expect(result.unconfirmed).toBe(50000);
      expect(result.total).toBe(350000);
    });

    it('should return zeros for empty array', () => {
      const result = calculateTotalBalance([]);

      expect(result.confirmed).toBe(0);
      expect(result.unconfirmed).toBe(0);
      expect(result.total).toBe(0);
    });

    it('should handle many addresses', () => {
      const balances: AddressBalance[] = [
        { address: 'bc1q1', confirmed: 10000, unconfirmed: 1000, total: 11000, utxoCount: 1 },
        { address: 'bc1q2', confirmed: 20000, unconfirmed: 2000, total: 22000, utxoCount: 2 },
        { address: 'bc1q3', confirmed: 30000, unconfirmed: 3000, total: 33000, utxoCount: 3 },
        { address: 'bc1q4', confirmed: 40000, unconfirmed: 4000, total: 44000, utxoCount: 4 },
        { address: 'bc1q5', confirmed: 50000, unconfirmed: 5000, total: 55000, utxoCount: 5 },
      ];

      const result = calculateTotalBalance(balances);

      expect(result.confirmed).toBe(150000);
      expect(result.unconfirmed).toBe(15000);
      expect(result.total).toBe(165000);
    });

    it('should handle zero balances', () => {
      const balances: AddressBalance[] = [
        { address: 'bc1q1', confirmed: 0, unconfirmed: 0, total: 0, utxoCount: 0 },
        { address: 'bc1q2', confirmed: 0, unconfirmed: 0, total: 0, utxoCount: 0 },
      ];

      const result = calculateTotalBalance(balances);

      expect(result.confirmed).toBe(0);
      expect(result.unconfirmed).toBe(0);
      expect(result.total).toBe(0);
    });

    it('should handle addresses with only unconfirmed balance', () => {
      const balances: AddressBalance[] = [
        { address: 'bc1q1', confirmed: 0, unconfirmed: 50000, total: 50000, utxoCount: 1 },
        { address: 'bc1q2', confirmed: 0, unconfirmed: 25000, total: 25000, utxoCount: 1 },
      ];

      const result = calculateTotalBalance(balances);

      expect(result.confirmed).toBe(0);
      expect(result.unconfirmed).toBe(75000);
      expect(result.total).toBe(75000);
    });

    it('should handle addresses with only confirmed balance', () => {
      const balances: AddressBalance[] = [
        { address: 'bc1q1', confirmed: 100000, unconfirmed: 0, total: 100000, utxoCount: 3 },
        { address: 'bc1q2', confirmed: 200000, unconfirmed: 0, total: 200000, utxoCount: 2 },
      ];

      const result = calculateTotalBalance(balances);

      expect(result.confirmed).toBe(300000);
      expect(result.unconfirmed).toBe(0);
      expect(result.total).toBe(300000);
    });

    it('should handle large balance values (whale wallets)', () => {
      const balances: AddressBalance[] = [
        {
          address: 'bc1qwhale1',
          confirmed: 10000000000, // 100 BTC
          unconfirmed: 500000000, // 5 BTC
          total: 10500000000,
          utxoCount: 100,
        },
        {
          address: 'bc1qwhale2',
          confirmed: 5000000000, // 50 BTC
          unconfirmed: 0,
          total: 5000000000,
          utxoCount: 50,
        },
      ];

      const result = calculateTotalBalance(balances);

      expect(result.confirmed).toBe(15000000000);
      expect(result.unconfirmed).toBe(500000000);
      expect(result.total).toBe(15500000000);
    });

    it('should handle mixed positive and negative unconfirmed (pending sends)', () => {
      // Unconfirmed can be negative when there are pending outgoing transactions
      const balances: AddressBalance[] = [
        { address: 'bc1q1', confirmed: 100000, unconfirmed: -20000, total: 80000, utxoCount: 2 },
        { address: 'bc1q2', confirmed: 50000, unconfirmed: 10000, total: 60000, utxoCount: 1 },
      ];

      const result = calculateTotalBalance(balances);

      expect(result.confirmed).toBe(150000);
      expect(result.unconfirmed).toBe(-10000);
      expect(result.total).toBe(140000);
    });
  });

  describe('getBalance', () => {
    it('should fetch and calculate balance from API response', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          chain_stats: {
            funded_txo_sum: 500000,
            spent_txo_sum: 100000,
            funded_txo_count: 10,
            spent_txo_count: 5,
          },
          mempool_stats: {
            funded_txo_sum: 50000,
            spent_txo_sum: 10000,
          },
        },
      });

      const result = await getBalance('bc1qtest123');

      expect(axios.get).toHaveBeenCalledWith('https://mempool.space/api/address/bc1qtest123');
      expect(result).toEqual({
        address: 'bc1qtest123',
        confirmed: 400000, // 500000 - 100000
        unconfirmed: 40000, // 50000 - 10000
        total: 440000,
        utxoCount: 5, // 10 - 5
      });
    });

    it('should return zero balance on API error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'));

      const result = await getBalance('bc1qtest123');

      expect(result).toEqual({
        address: 'bc1qtest123',
        confirmed: 0,
        unconfirmed: 0,
        total: 0,
        utxoCount: 0,
      });
    });

    it('should handle zero balance addresses', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          chain_stats: {
            funded_txo_sum: 0,
            spent_txo_sum: 0,
            funded_txo_count: 0,
            spent_txo_count: 0,
          },
          mempool_stats: {
            funded_txo_sum: 0,
            spent_txo_sum: 0,
          },
        },
      });

      const result = await getBalance('bc1qempty');

      expect(result.confirmed).toBe(0);
      expect(result.unconfirmed).toBe(0);
      expect(result.total).toBe(0);
      expect(result.utxoCount).toBe(0);
    });

    it('should handle addresses with only mempool activity', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          chain_stats: {
            funded_txo_sum: 0,
            spent_txo_sum: 0,
            funded_txo_count: 0,
            spent_txo_count: 0,
          },
          mempool_stats: {
            funded_txo_sum: 100000,
            spent_txo_sum: 0,
          },
        },
      });

      const result = await getBalance('bc1qnewaddress');

      expect(result.confirmed).toBe(0);
      expect(result.unconfirmed).toBe(100000);
      expect(result.total).toBe(100000);
    });
  });

  describe('getUTXOs', () => {
    it('should fetch UTXOs for an address', async () => {
      const mockUTXOs: UTXO[] = [
        { txid: 'abc123', vout: 0, value: 50000, status: { confirmed: true } },
        { txid: 'def456', vout: 1, value: 30000, status: { confirmed: true } },
      ];

      vi.mocked(axios.get).mockResolvedValueOnce({ data: mockUTXOs });

      const result = await getUTXOs('bc1qtest123');

      expect(axios.get).toHaveBeenCalledWith('https://mempool.space/api/address/bc1qtest123/utxo');
      expect(result).toEqual(mockUTXOs);
    });

    it('should return empty array on API error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'));

      const result = await getUTXOs('bc1qtest123');

      expect(result).toEqual([]);
    });

    it('should handle address with no UTXOs', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [] });

      const result = await getUTXOs('bc1qempty');

      expect(result).toEqual([]);
    });

    it('should handle UTXOs with unconfirmed status', async () => {
      const mockUTXOs: UTXO[] = [
        { txid: 'abc123', vout: 0, value: 50000, status: { confirmed: false } },
      ];

      vi.mocked(axios.get).mockResolvedValueOnce({ data: mockUTXOs });

      const result = await getUTXOs('bc1qtest');

      expect(result[0].status.confirmed).toBe(false);
    });

    it('should handle UTXOs with block info', async () => {
      const mockUTXOs: UTXO[] = [
        {
          txid: 'abc123',
          vout: 0,
          value: 50000,
          status: {
            confirmed: true,
            block_height: 800000,
            block_time: 1700000000,
          },
        },
      ];

      vi.mocked(axios.get).mockResolvedValueOnce({ data: mockUTXOs });

      const result = await getUTXOs('bc1qtest');

      expect(result[0].status.block_height).toBe(800000);
      expect(result[0].status.block_time).toBe(1700000000);
    });
  });

  describe('getAllBalances', () => {
    it('should fetch balances for multiple addresses', async () => {
      vi.mocked(axios.get)
        .mockResolvedValueOnce({
          data: {
            chain_stats: { funded_txo_sum: 100000, spent_txo_sum: 0, funded_txo_count: 1, spent_txo_count: 0 },
            mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          },
        })
        .mockResolvedValueOnce({
          data: {
            chain_stats: { funded_txo_sum: 200000, spent_txo_sum: 0, funded_txo_count: 2, spent_txo_count: 0 },
            mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          },
        });

      const addresses = ['bc1qaddr1', 'bc1qaddr2'];
      const results = await getAllBalances(addresses);

      expect(results).toHaveLength(2);
      expect(results[0].confirmed).toBe(100000);
      expect(results[1].confirmed).toBe(200000);
    });

    it('should call progress callback', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          chain_stats: { funded_txo_sum: 10000, spent_txo_sum: 0, funded_txo_count: 1, spent_txo_count: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        },
      });

      const progressCallback = vi.fn();
      const addresses = ['bc1q1', 'bc1q2', 'bc1q3'];

      const resultPromise = getAllBalances(addresses, progressCallback);

      // Advance timers to handle rate limiting delays
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(progressCallback).toHaveBeenCalled();
    });

    it('should handle empty addresses array', async () => {
      const results = await getAllBalances([]);
      expect(results).toEqual([]);
    });

    it('should batch addresses in groups of 5', async () => {
      // Create 7 addresses to test batching
      const addresses = Array.from({ length: 7 }, (_, i) => `bc1qaddr${i}`);

      vi.mocked(axios.get).mockResolvedValue({
        data: {
          chain_stats: { funded_txo_sum: 10000, spent_txo_sum: 0, funded_txo_count: 1, spent_txo_count: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        },
      });

      const resultPromise = getAllBalances(addresses);

      // Advance timers for rate limiting
      await vi.runAllTimersAsync();
      const results = await resultPromise;

      expect(results).toHaveLength(7);
      // 7 addresses means 2 batches (5 + 2), so 7 API calls
      expect(axios.get).toHaveBeenCalledTimes(7);
    });

    it('should handle mixed success and error responses', async () => {
      vi.mocked(axios.get)
        .mockResolvedValueOnce({
          data: {
            chain_stats: { funded_txo_sum: 100000, spent_txo_sum: 0, funded_txo_count: 1, spent_txo_count: 0 },
            mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          },
        })
        .mockRejectedValueOnce(new Error('API error'));

      const addresses = ['bc1qaddr1', 'bc1qaddr2'];
      const results = await getAllBalances(addresses);

      expect(results).toHaveLength(2);
      expect(results[0].confirmed).toBe(100000);
      expect(results[1].confirmed).toBe(0); // Error returns zero balance
    });
  });

  describe('getAllUTXOs', () => {
    it('should fetch UTXOs for multiple addresses', async () => {
      vi.mocked(axios.get)
        .mockResolvedValueOnce({
          data: [{ txid: 'tx1', vout: 0, value: 50000, status: { confirmed: true } }],
        })
        .mockResolvedValueOnce({
          data: [{ txid: 'tx2', vout: 0, value: 30000, status: { confirmed: true } }],
        });

      const addresses = ['bc1qaddr1', 'bc1qaddr2'];
      const results = await getAllUTXOs(addresses);

      expect(results.size).toBe(2);
      expect(results.get('bc1qaddr1')).toHaveLength(1);
      expect(results.get('bc1qaddr2')).toHaveLength(1);
    });

    it('should call progress callback', async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: [] });

      const progressCallback = vi.fn();
      const addresses = ['bc1q1', 'bc1q2', 'bc1q3'];

      const resultPromise = getAllUTXOs(addresses, progressCallback);

      await vi.runAllTimersAsync();
      await resultPromise;

      expect(progressCallback).toHaveBeenCalled();
    });

    it('should return empty map for empty addresses array', async () => {
      const results = await getAllUTXOs([]);
      expect(results.size).toBe(0);
    });

    it('should handle addresses with no UTXOs', async () => {
      vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      const addresses = ['bc1qempty1', 'bc1qempty2'];
      const results = await getAllUTXOs(addresses);

      expect(results.get('bc1qempty1')).toEqual([]);
      expect(results.get('bc1qempty2')).toEqual([]);
    });

    it('should handle API errors for individual addresses', async () => {
      vi.mocked(axios.get)
        .mockResolvedValueOnce({
          data: [{ txid: 'tx1', vout: 0, value: 50000, status: { confirmed: true } }],
        })
        .mockRejectedValueOnce(new Error('API error'));

      const addresses = ['bc1qaddr1', 'bc1qaddr2'];
      const results = await getAllUTXOs(addresses);

      expect(results.get('bc1qaddr1')).toHaveLength(1);
      expect(results.get('bc1qaddr2')).toEqual([]); // Error returns empty array
    });
  });

  describe('getFeeRates', () => {
    it('should fetch fee rates from API', async () => {
      const mockFeeRates = {
        fastestFee: 100,
        halfHourFee: 50,
        hourFee: 25,
        economyFee: 10,
        minimumFee: 5,
      };

      vi.mocked(axios.get).mockResolvedValueOnce({ data: mockFeeRates });

      const result = await getFeeRates();

      expect(axios.get).toHaveBeenCalledWith('https://mempool.space/api/v1/fees/recommended');
      expect(result).toEqual(mockFeeRates);
    });

    it('should return default fees on API error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'));

      const result = await getFeeRates();

      expect(result).toEqual({
        fastestFee: 50,
        halfHourFee: 25,
        hourFee: 15,
        economyFee: 10,
        minimumFee: 5,
      });
    });

    it('should handle timeout errors', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce({ code: 'ECONNABORTED' });

      const result = await getFeeRates();

      // Should return defaults
      expect(result.fastestFee).toBe(50);
    });
  });

  describe('getTransaction', () => {
    it('should fetch transaction details', async () => {
      const mockTx = {
        txid: 'abc123',
        version: 2,
        vin: [],
        vout: [],
        size: 250,
        weight: 1000,
        fee: 5000,
        status: { confirmed: true },
      };

      vi.mocked(axios.get).mockResolvedValueOnce({ data: mockTx });

      const result = await getTransaction('abc123');

      expect(axios.get).toHaveBeenCalledWith('https://mempool.space/api/tx/abc123');
      expect(result).toEqual(mockTx);
    });

    it('should return null on API error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Not found'));

      const result = await getTransaction('invalid_txid');

      expect(result).toBeNull();
    });

    it('should handle unconfirmed transaction', async () => {
      const mockTx = {
        txid: 'pending123',
        status: { confirmed: false },
      };

      vi.mocked(axios.get).mockResolvedValueOnce({ data: mockTx });

      const result = await getTransaction('pending123');

      expect(result.status.confirmed).toBe(false);
    });
  });

  describe('getTransactionStatus', () => {
    it('should fetch transaction status', async () => {
      const mockStatus = {
        confirmed: true,
        block_height: 800000,
        block_time: 1700000000,
      };

      vi.mocked(axios.get).mockResolvedValueOnce({ data: mockStatus });

      const result = await getTransactionStatus('abc123');

      expect(axios.get).toHaveBeenCalledWith('https://mempool.space/api/tx/abc123/status');
      expect(result).toEqual(mockStatus);
    });

    it('should return null on API error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Not found'));

      const result = await getTransactionStatus('invalid_txid');

      expect(result).toBeNull();
    });

    it('should handle unconfirmed status', async () => {
      const mockStatus = {
        confirmed: false,
      };

      vi.mocked(axios.get).mockResolvedValueOnce({ data: mockStatus });

      const result = await getTransactionStatus('pending123');

      expect(result).toEqual({ confirmed: false });
      expect(result?.block_height).toBeUndefined();
    });

    it('should handle confirmed status with block info', async () => {
      const mockStatus = {
        confirmed: true,
        block_height: 850000,
        block_time: 1705000000,
      };

      vi.mocked(axios.get).mockResolvedValueOnce({ data: mockStatus });

      const result = await getTransactionStatus('confirmed123');

      expect(result?.confirmed).toBe(true);
      expect(result?.block_height).toBe(850000);
      expect(result?.block_time).toBe(1705000000);
    });
  });
});
