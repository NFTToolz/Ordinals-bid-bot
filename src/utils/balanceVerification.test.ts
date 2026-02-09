import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { verifyBalanceForRetry } from './balanceVerification';

vi.mock('axios');
vi.mock('./logger', () => ({
  default: {
    warning: vi.fn(),
  },
}));

const mockedAxios = vi.mocked(axios);

const ADDRESS = 'bc1qtest123';

function makeMempoolResponse(confirmedFunded: number, confirmedSpent: number, mempoolFunded: number, mempoolSpent: number) {
  return {
    data: {
      chain_stats: {
        funded_txo_sum: confirmedFunded,
        spent_txo_sum: confirmedSpent,
      },
      mempool_stats: {
        funded_txo_sum: mempoolFunded,
        spent_txo_sum: mempoolSpent,
      },
    },
  };
}

describe('verifyBalanceForRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns stale_cache when on-chain balance >= required', async () => {
    // On-chain: 30000 confirmed, 0 spent, 0 mempool = 30000 total
    mockedAxios.get.mockResolvedValueOnce(makeMempoolResponse(30000, 0, 0, 0));

    const result = await verifyBalanceForRetry(ADDRESS, 28536, 19962);

    expect(result.verdict).toBe('stale_cache');
    expect(result.onChainBalance).toBe(30000);
    expect(result.requiredSats).toBe(28536);
    expect(result.meReportedSats).toBe(19962);
  });

  it('returns stale_cache when confirmed + unconfirmed >= required', async () => {
    // 20000 confirmed + 10000 unconfirmed = 30000 total
    mockedAxios.get.mockResolvedValueOnce(makeMempoolResponse(20000, 0, 10000, 0));

    const result = await verifyBalanceForRetry(ADDRESS, 28536, 19962);

    expect(result.verdict).toBe('stale_cache');
    expect(result.onChainBalance).toBe(30000);
  });

  it('returns genuine_shortfall when on-chain balance < required', async () => {
    // On-chain: 15000 total, required 28536
    mockedAxios.get.mockResolvedValueOnce(makeMempoolResponse(15000, 0, 0, 0));

    const result = await verifyBalanceForRetry(ADDRESS, 28536, 15000);

    expect(result.verdict).toBe('genuine_shortfall');
    expect(result.onChainBalance).toBe(15000);
    expect(result.requiredSats).toBe(28536);
  });

  it('returns genuine_shortfall when mempool.space is unreachable', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

    const result = await verifyBalanceForRetry(ADDRESS, 28536, 19962);

    expect(result.verdict).toBe('genuine_shortfall');
    expect(result.onChainBalance).toBe(0);
    expect(result.requiredSats).toBe(28536);
    expect(result.meReportedSats).toBe(19962);
  });

  it('calculates balance correctly with spent outputs', async () => {
    // 50000 funded, 20000 spent confirmed + 5000 funded, 2000 spent mempool = 33000
    mockedAxios.get.mockResolvedValueOnce(makeMempoolResponse(50000, 20000, 5000, 2000));

    const result = await verifyBalanceForRetry(ADDRESS, 30000, 19962);

    expect(result.verdict).toBe('stale_cache');
    expect(result.onChainBalance).toBe(33000);
  });

  it('returns stale_cache when balance exactly equals required', async () => {
    mockedAxios.get.mockResolvedValueOnce(makeMempoolResponse(28536, 0, 0, 0));

    const result = await verifyBalanceForRetry(ADDRESS, 28536, 19962);

    expect(result.verdict).toBe('stale_cache');
    expect(result.onChainBalance).toBe(28536);
  });
});
