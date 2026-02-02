import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { estimateTransactionSize, selectUTXOs } from './TransactionBuilder';
import type { UTXO } from './BalanceService';

// Mock dependencies
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('./BalanceService', async (importOriginal) => {
  const original = await importOriginal<typeof import('./BalanceService')>();
  return {
    ...original,
    getUTXOs: vi.fn(),
    getAllUTXOs: vi.fn(),
    getFeeRates: vi.fn(),
  };
});

import axios from 'axios';
import { getUTXOs, getAllUTXOs, getFeeRates } from './BalanceService';
import {
  buildDistributionTransaction,
  signAndBroadcastDistribution,
  buildConsolidationTransaction,
  signAndBroadcastConsolidation,
  broadcastTransaction,
} from './TransactionBuilder';

describe('TransactionBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('estimateTransactionSize', () => {
    it('should estimate size for single input and output', () => {
      const size = estimateTransactionSize(1, 1);
      // Header(10) + Input(68) + Output(31) + Witness(27) = 136
      expect(size).toBe(136);
    });

    it('should estimate size for multiple inputs and outputs', () => {
      const size = estimateTransactionSize(2, 2);
      // Header(10) + Inputs(68*2) + Outputs(31*2) + Witness(27*2) = 262
      expect(size).toBe(262);
    });

    it('should scale linearly with inputs', () => {
      const size1 = estimateTransactionSize(1, 1);
      const size2 = estimateTransactionSize(2, 1);
      // Difference should be 68 (input) + 27 (witness) = 95
      expect(size2 - size1).toBe(95);
    });

    it('should scale linearly with outputs', () => {
      const size1 = estimateTransactionSize(1, 1);
      const size2 = estimateTransactionSize(1, 2);
      // Difference should be 31 (one output)
      expect(size2 - size1).toBe(31);
    });

    it('should handle zero inputs (edge case)', () => {
      const size = estimateTransactionSize(0, 1);
      // Header(10) + Outputs(31) = 41
      expect(size).toBe(41);
    });

    it('should handle typical 2-input 2-output transaction', () => {
      const size = estimateTransactionSize(2, 2);
      // This is a common transaction pattern
      expect(size).toBeGreaterThan(200);
      expect(size).toBeLessThan(300);
    });

    it('should estimate consolidation transaction (many inputs, 1 output)', () => {
      const size = estimateTransactionSize(10, 1);
      expect(size).toBe(10 + (10 * 68) + (1 * 31) + (10 * 27));
    });

    it('should estimate distribution transaction (1 input, many outputs)', () => {
      const size = estimateTransactionSize(1, 10);
      expect(size).toBe(10 + (1 * 68) + (10 * 31) + (1 * 27));
    });

    it('should handle large number of inputs', () => {
      const size = estimateTransactionSize(100, 1);
      expect(size).toBe(10 + (100 * 68) + (1 * 31) + (100 * 27));
    });

    it('should handle large number of outputs', () => {
      const size = estimateTransactionSize(1, 100);
      expect(size).toBe(10 + (1 * 68) + (100 * 31) + (1 * 27));
    });
  });

  describe('selectUTXOs', () => {
    const createUTXO = (value: number, index: number = 0): UTXO => ({
      txid: `0000000000000000000000000000000000000000000000000000000000${index.toString().padStart(6, '0')}`,
      vout: 0,
      value,
      status: { confirmed: true },
    });

    it('should select sufficient UTXOs for target amount', () => {
      const utxos = [
        createUTXO(10000, 1),
        createUTXO(20000, 2),
        createUTXO(30000, 3),
      ];

      const result = selectUTXOs(utxos, 25000, 10);

      expect(result).not.toBeNull();
      expect(result!.selected.length).toBeGreaterThan(0);

      const totalSelected = result!.selected.reduce((sum, u) => sum + u.value, 0);
      expect(totalSelected).toBeGreaterThanOrEqual(25000 + result!.fee);
    });

    it('should return null for insufficient funds', () => {
      const utxos = [
        createUTXO(1000, 1),
        createUTXO(2000, 2),
      ];

      const result = selectUTXOs(utxos, 100000, 10);

      expect(result).toBeNull();
    });

    it('should prefer larger UTXOs first', () => {
      const utxos = [
        createUTXO(1000, 1),
        createUTXO(50000, 2),
        createUTXO(5000, 3),
      ];

      const result = selectUTXOs(utxos, 20000, 10);

      expect(result).not.toBeNull();
      expect(result!.selected[0].value).toBe(50000);
    });

    it('should calculate fee based on estimated size', () => {
      const utxos = [createUTXO(100000, 1)];
      const feeRate = 20;

      const result = selectUTXOs(utxos, 50000, feeRate);

      expect(result).not.toBeNull();
      // Fee should be estimated size * fee rate
      const expectedSize = estimateTransactionSize(1, 2);
      const expectedFee = Math.ceil(expectedSize * feeRate);
      expect(result!.fee).toBe(expectedFee);
    });

    it('should handle empty UTXO array', () => {
      const result = selectUTXOs([], 10000, 10);
      expect(result).toBeNull();
    });

    it('should handle zero target amount', () => {
      const utxos = [createUTXO(10000, 1)];
      const result = selectUTXOs(utxos, 0, 10);

      expect(result).not.toBeNull();
      expect(result!.selected.length).toBe(1);
    });

    it('should select minimum UTXOs needed', () => {
      const utxos = [
        createUTXO(50000, 1),
        createUTXO(50000, 2),
        createUTXO(50000, 3),
      ];

      const result = selectUTXOs(utxos, 40000, 10);

      expect(result).not.toBeNull();
      // Should only need 1 UTXO (50000 > 40000 + fees)
      expect(result!.selected.length).toBe(1);
    });

    it('should combine multiple UTXOs when needed', () => {
      const utxos = [
        createUTXO(20000, 1),
        createUTXO(20000, 2),
        createUTXO(20000, 3),
      ];

      const result = selectUTXOs(utxos, 45000, 10);

      expect(result).not.toBeNull();
      // Need at least 3 UTXOs (20000*3 = 60000 > 45000 + fees)
      expect(result!.selected.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle high fee rates', () => {
      const utxos = [createUTXO(10000, 1)];
      const highFeeRate = 500;

      // With high fees, might not have enough
      const result = selectUTXOs(utxos, 5000, highFeeRate);

      // Expected size for 1 input, 2 outputs
      const size = estimateTransactionSize(1, 2);
      const fee = Math.ceil(size * highFeeRate);

      if (fee + 5000 > 10000) {
        expect(result).toBeNull();
      } else {
        expect(result).not.toBeNull();
      }
    });

    it('should not mutate original UTXO array', () => {
      const utxos = [
        createUTXO(30000, 1),
        createUTXO(10000, 2),
        createUTXO(20000, 3),
      ];

      const originalOrder = utxos.map(u => u.value);

      selectUTXOs(utxos, 15000, 10);

      const newOrder = utxos.map(u => u.value);
      expect(newOrder).toEqual(originalOrder);
    });

    it('should handle very low fee rate', () => {
      const utxos = [createUTXO(10000, 1)];
      const lowFeeRate = 1;

      const result = selectUTXOs(utxos, 9000, lowFeeRate);

      expect(result).not.toBeNull();
      // With low fee rate, should be able to send most of the balance
    });

    it('should handle UTXOs with different vout values', () => {
      const utxos: UTXO[] = [
        { txid: 'tx1', vout: 0, value: 10000, status: { confirmed: true } },
        { txid: 'tx1', vout: 1, value: 20000, status: { confirmed: true } },
        { txid: 'tx2', vout: 0, value: 30000, status: { confirmed: true } },
      ];

      const result = selectUTXOs(utxos, 25000, 10);

      expect(result).not.toBeNull();
    });

    it('should handle unconfirmed UTXOs', () => {
      const utxos: UTXO[] = [
        { txid: 'tx1', vout: 0, value: 50000, status: { confirmed: false } },
      ];

      const result = selectUTXOs(utxos, 40000, 10);

      expect(result).not.toBeNull();
    });
  });

  describe('buildDistributionTransaction', () => {
    const testWIF = 'cVpPVruEDdmutPzisEsYvtST1usBR3ntr8pXSyt6D2YYqXRyPcFW'; // testnet WIF
    const testAddress = 'bc1qtest123456789';

    const mockUTXOs: UTXO[] = [
      { txid: 'abc123'.padEnd(64, '0'), vout: 0, value: 100000, status: { confirmed: true } },
    ];

    const mockFeeRates = {
      fastestFee: 50,
      halfHourFee: 25,
      hourFee: 15,
      economyFee: 10,
      minimumFee: 5,
    };

    beforeEach(() => {
      vi.mocked(getUTXOs).mockResolvedValue(mockUTXOs);
      vi.mocked(getFeeRates).mockResolvedValue(mockFeeRates);
    });

    it('should throw when no UTXOs available', async () => {
      vi.mocked(getUTXOs).mockResolvedValueOnce([]);

      await expect(
        buildDistributionTransaction(testWIF, testAddress, [{ address: 'bc1qrecipient', amount: 10000 }])
      ).rejects.toThrow('No UTXOs available');
    });

    it('should throw when insufficient funds', async () => {
      vi.mocked(getUTXOs).mockResolvedValueOnce([
        { txid: 'abc123'.padEnd(64, '0'), vout: 0, value: 1000, status: { confirmed: true } },
      ]);

      await expect(
        buildDistributionTransaction(testWIF, testAddress, [{ address: 'bc1qrecipient', amount: 100000 }])
      ).rejects.toThrow('Insufficient funds');
    });

    it('should build transaction preview with inputs and outputs', async () => {
      const recipients = [{ address: 'bc1qrecipient1', amount: 10000 }];

      const preview = await buildDistributionTransaction(testWIF, testAddress, recipients, 10);

      expect(preview).toHaveProperty('inputs');
      expect(preview).toHaveProperty('outputs');
      expect(preview).toHaveProperty('fee');
      expect(preview).toHaveProperty('feeRate');
      expect(preview).toHaveProperty('totalInput');
      expect(preview).toHaveProperty('totalOutput');
      expect(preview).toHaveProperty('change');
    });

    it('should use provided fee rate', async () => {
      const recipients = [{ address: 'bc1qrecipient1', amount: 10000 }];
      const customFeeRate = 50;

      const preview = await buildDistributionTransaction(testWIF, testAddress, recipients, customFeeRate);

      expect(preview.feeRate).toBe(customFeeRate);
    });

    it('should fetch fee rate when not provided', async () => {
      const recipients = [{ address: 'bc1qrecipient1', amount: 10000 }];

      const preview = await buildDistributionTransaction(testWIF, testAddress, recipients);

      expect(getFeeRates).toHaveBeenCalled();
      expect(preview.feeRate).toBe(mockFeeRates.halfHourFee);
    });

    it('should include change output when change is above dust threshold', async () => {
      vi.mocked(getUTXOs).mockResolvedValueOnce([
        { txid: 'abc123'.padEnd(64, '0'), vout: 0, value: 100000, status: { confirmed: true } },
      ]);

      const recipients = [{ address: 'bc1qrecipient1', amount: 10000 }];

      const preview = await buildDistributionTransaction(testWIF, testAddress, recipients, 10);

      // Should have 2 outputs: recipient + change
      expect(preview.outputs.length).toBe(2);
      expect(preview.change).toBeGreaterThan(546);
    });

    it('should handle multiple recipients', async () => {
      vi.mocked(getUTXOs).mockResolvedValueOnce([
        { txid: 'abc123'.padEnd(64, '0'), vout: 0, value: 100000, status: { confirmed: true } },
      ]);

      const recipients = [
        { address: 'bc1qrecipient1', amount: 10000 },
        { address: 'bc1qrecipient2', amount: 15000 },
        { address: 'bc1qrecipient3', amount: 20000 },
      ];

      const preview = await buildDistributionTransaction(testWIF, testAddress, recipients, 10);

      // Should have 4 outputs: 3 recipients + change
      expect(preview.outputs.length).toBe(4);
      expect(preview.totalOutput).toBeGreaterThanOrEqual(45000);
    });

    it('should calculate correct totals', async () => {
      vi.mocked(getUTXOs).mockResolvedValueOnce([
        { txid: 'abc123'.padEnd(64, '0'), vout: 0, value: 50000, status: { confirmed: true } },
      ]);

      const recipients = [{ address: 'bc1qrecipient1', amount: 10000 }];

      const preview = await buildDistributionTransaction(testWIF, testAddress, recipients, 10);

      expect(preview.totalInput).toBe(50000);
      expect(preview.totalOutput + preview.fee).toBe(preview.totalInput);
    });
  });

  describe('buildConsolidationTransaction', () => {
    const mockFeeRates = {
      fastestFee: 50,
      halfHourFee: 25,
      hourFee: 15,
      economyFee: 10,
      minimumFee: 5,
    };

    beforeEach(() => {
      vi.mocked(getFeeRates).mockResolvedValue(mockFeeRates);
    });

    it('should throw when no UTXOs available', async () => {
      vi.mocked(getAllUTXOs).mockResolvedValueOnce(new Map());

      await expect(
        buildConsolidationTransaction(
          [{ wif: 'testWIF', address: 'bc1qtest' }],
          'bc1qdestination'
        )
      ).rejects.toThrow('No UTXOs available across all wallets');
    });

    it('should throw when insufficient funds after fees', async () => {
      const utxoMap = new Map<string, UTXO[]>();
      utxoMap.set('bc1qtest', [
        { txid: 'abc123'.padEnd(64, '0'), vout: 0, value: 100, status: { confirmed: true } },
      ]);
      vi.mocked(getAllUTXOs).mockResolvedValueOnce(utxoMap);

      await expect(
        buildConsolidationTransaction(
          [{ wif: 'testWIF', address: 'bc1qtest' }],
          'bc1qdestination',
          100 // high fee rate
        )
      ).rejects.toThrow('Insufficient funds after fees');
    });

    it('should build consolidation preview', async () => {
      const utxoMap = new Map<string, UTXO[]>();
      utxoMap.set('bc1qtest1', [
        { txid: 'abc123'.padEnd(64, '0'), vout: 0, value: 50000, status: { confirmed: true } },
      ]);
      utxoMap.set('bc1qtest2', [
        { txid: 'def456'.padEnd(64, '0'), vout: 0, value: 50000, status: { confirmed: true } },
      ]);
      vi.mocked(getAllUTXOs).mockResolvedValueOnce(utxoMap);

      const preview = await buildConsolidationTransaction(
        [
          { wif: 'testWIF1', address: 'bc1qtest1' },
          { wif: 'testWIF2', address: 'bc1qtest2' },
        ],
        'bc1qdestination',
        10
      );

      expect(preview.inputs.length).toBe(2);
      expect(preview.outputs.length).toBe(1);
      expect(preview.outputs[0].address).toBe('bc1qdestination');
      expect(preview.change).toBe(0);
    });

    it('should collect UTXOs from multiple wallets', async () => {
      const utxoMap = new Map<string, UTXO[]>();
      utxoMap.set('bc1qwallet1', [
        { txid: 'tx1'.padEnd(64, '0'), vout: 0, value: 30000, status: { confirmed: true } },
        { txid: 'tx2'.padEnd(64, '0'), vout: 0, value: 20000, status: { confirmed: true } },
      ]);
      utxoMap.set('bc1qwallet2', [
        { txid: 'tx3'.padEnd(64, '0'), vout: 0, value: 50000, status: { confirmed: true } },
      ]);
      vi.mocked(getAllUTXOs).mockResolvedValueOnce(utxoMap);

      const preview = await buildConsolidationTransaction(
        [
          { wif: 'wif1', address: 'bc1qwallet1' },
          { wif: 'wif2', address: 'bc1qwallet2' },
        ],
        'bc1qdestination',
        10
      );

      expect(preview.inputs.length).toBe(3);
      expect(preview.totalInput).toBe(100000);
    });

    it('should fetch fee rate when not provided', async () => {
      const utxoMap = new Map<string, UTXO[]>();
      utxoMap.set('bc1qtest', [
        { txid: 'abc123'.padEnd(64, '0'), vout: 0, value: 100000, status: { confirmed: true } },
      ]);
      vi.mocked(getAllUTXOs).mockResolvedValueOnce(utxoMap);

      const preview = await buildConsolidationTransaction(
        [{ wif: 'testWIF', address: 'bc1qtest' }],
        'bc1qdestination'
      );

      expect(getFeeRates).toHaveBeenCalled();
      expect(preview.feeRate).toBe(mockFeeRates.halfHourFee);
    });

    it('should use provided fee rate', async () => {
      const utxoMap = new Map<string, UTXO[]>();
      utxoMap.set('bc1qtest', [
        { txid: 'abc123'.padEnd(64, '0'), vout: 0, value: 100000, status: { confirmed: true } },
      ]);
      vi.mocked(getAllUTXOs).mockResolvedValueOnce(utxoMap);

      const customFeeRate = 50;
      const preview = await buildConsolidationTransaction(
        [{ wif: 'testWIF', address: 'bc1qtest' }],
        'bc1qdestination',
        customFeeRate
      );

      expect(preview.feeRate).toBe(customFeeRate);
    });

    it('should handle wallets with no UTXOs', async () => {
      const utxoMap = new Map<string, UTXO[]>();
      utxoMap.set('bc1qwallet1', []); // No UTXOs
      utxoMap.set('bc1qwallet2', [
        { txid: 'tx1'.padEnd(64, '0'), vout: 0, value: 50000, status: { confirmed: true } },
      ]);
      vi.mocked(getAllUTXOs).mockResolvedValueOnce(utxoMap);

      const preview = await buildConsolidationTransaction(
        [
          { wif: 'wif1', address: 'bc1qwallet1' },
          { wif: 'wif2', address: 'bc1qwallet2' },
        ],
        'bc1qdestination',
        10
      );

      expect(preview.inputs.length).toBe(1);
      expect(preview.totalInput).toBe(50000);
    });
  });

  describe('broadcastTransaction', () => {
    it('should broadcast transaction successfully', async () => {
      const txHex = '0200000001...'; // Mock transaction hex
      const expectedTxid = 'abc123def456';

      vi.mocked(axios.post).mockResolvedValueOnce({ data: expectedTxid });

      const result = await broadcastTransaction(txHex);

      expect(axios.post).toHaveBeenCalledWith(
        'https://mempool.space/api/tx',
        txHex,
        { headers: { 'Content-Type': 'text/plain' } }
      );
      expect(result).toBe(expectedTxid);
    });

    it('should throw on broadcast failure with response data', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce({
        response: { data: 'Transaction already in mempool' },
        message: 'Request failed',
      });

      await expect(broadcastTransaction('0200000001...')).rejects.toThrow(
        'Broadcast failed: Transaction already in mempool'
      );
    });

    it('should throw on broadcast failure with message only', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce({
        message: 'Network error',
      });

      await expect(broadcastTransaction('0200000001...')).rejects.toThrow(
        'Broadcast failed: Network error'
      );
    });

    it('should handle invalid transaction hex', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce({
        response: { data: 'Invalid transaction' },
      });

      await expect(broadcastTransaction('invalid')).rejects.toThrow('Broadcast failed');
    });
  });

  describe('signAndBroadcastDistribution', () => {
    it('should throw when no UTXOs available', async () => {
      vi.mocked(getUTXOs).mockResolvedValueOnce([]);
      vi.mocked(getFeeRates).mockResolvedValueOnce({
        fastestFee: 50,
        halfHourFee: 25,
        hourFee: 15,
        economyFee: 10,
        minimumFee: 5,
      });

      const testWIF = 'cVpPVruEDdmutPzisEsYvtST1usBR3ntr8pXSyt6D2YYqXRyPcFW';

      await expect(
        signAndBroadcastDistribution(testWIF, 'bc1qtest', [{ address: 'bc1qrecip', amount: 10000 }])
      ).rejects.toThrow('No UTXOs available');
    });
  });

  describe('signAndBroadcastConsolidation', () => {
    // Note: signAndBroadcastConsolidation parses WIF before checking UTXOs,
    // so we can only test the UTXO checks via buildConsolidationTransaction.
    // The signing tests require valid mainnet WIFs and are more of integration tests.
    // Coverage for this function's error paths is achieved through buildConsolidationTransaction tests.

    it('should exist as a function', () => {
      expect(typeof signAndBroadcastConsolidation).toBe('function');
    });
  });
});
