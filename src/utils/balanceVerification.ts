import axios from 'axios';
import Logger from './logger';

const MEMPOOL_API = 'https://mempool.space/api';

export interface BalanceVerificationResult {
  verdict: 'stale_cache' | 'genuine_shortfall';
  onChainBalance: number;
  requiredSats: number;
  meReportedSats: number;
}

/**
 * Verify whether a Magic Eden "Insufficient funds" error is caused by a stale
 * balance cache or a genuine shortfall.
 *
 * Calls mempool.space directly (not rate-limited) to get the real on-chain balance.
 * On any mempool.space error, conservatively returns `genuine_shortfall` (no retry).
 */
export async function verifyBalanceForRetry(
  address: string,
  requiredSats: number,
  meReportedSats: number,
): Promise<BalanceVerificationResult> {
  try {
    const response = await axios.get(`${MEMPOOL_API}/address/${address}`, { timeout: 10_000 });
    const data = response.data;

    const confirmed = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
    const unconfirmed = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
    const onChainBalance = confirmed + unconfirmed;

    if (onChainBalance >= requiredSats) {
      Logger.warning(
        `[BALANCE] Stale ME cache detected for ${address}: ` +
        `on-chain ${onChainBalance} sats >= required ${requiredSats} sats, ` +
        `but ME reported only ${meReportedSats} sats`
      );
      return { verdict: 'stale_cache', onChainBalance, requiredSats, meReportedSats };
    }

    return { verdict: 'genuine_shortfall', onChainBalance, requiredSats, meReportedSats };
  } catch {
    Logger.warning(`[BALANCE] Could not verify balance via mempool.space for ${address}, assuming genuine shortfall`);
    return { verdict: 'genuine_shortfall', onChainBalance: 0, requiredSats, meReportedSats };
  }
}
