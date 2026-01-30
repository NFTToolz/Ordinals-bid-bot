import axios from 'axios';

export interface UTXO {
  txid: string;
  vout: number;
  value: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
  };
}

export interface AddressBalance {
  address: string;
  confirmed: number;
  unconfirmed: number;
  total: number;
  utxoCount: number;
}

const MEMPOOL_API = 'https://mempool.space/api';

/**
 * Fetch balance for a single address
 */
export async function getBalance(address: string): Promise<AddressBalance> {
  try {
    const response = await axios.get(`${MEMPOOL_API}/address/${address}`);
    const data = response.data;

    const confirmed = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
    const unconfirmed = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
    const utxoCount = data.chain_stats.funded_txo_count - data.chain_stats.spent_txo_count;

    return {
      address,
      confirmed,
      unconfirmed,
      total: confirmed + unconfirmed,
      utxoCount,
    };
  } catch (error: any) {
    // Return zero balance on error
    return {
      address,
      confirmed: 0,
      unconfirmed: 0,
      total: 0,
      utxoCount: 0,
    };
  }
}

/**
 * Fetch UTXOs for an address
 */
export async function getUTXOs(address: string): Promise<UTXO[]> {
  try {
    const response = await axios.get(`${MEMPOOL_API}/address/${address}/utxo`);
    return response.data;
  } catch (error) {
    return [];
  }
}

/**
 * Fetch balances for multiple addresses (with rate limiting)
 */
export async function getAllBalances(
  addresses: string[],
  onProgress?: (current: number, total: number) => void
): Promise<AddressBalance[]> {
  const results: AddressBalance[] = [];
  const batchSize = 5; // Process 5 addresses at a time

  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(address => getBalance(address))
    );

    results.push(...batchResults);

    if (onProgress) {
      onProgress(Math.min(i + batchSize, addresses.length), addresses.length);
    }

    // Rate limit: wait 500ms between batches
    if (i + batchSize < addresses.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Fetch all UTXOs for multiple addresses
 */
export async function getAllUTXOs(
  addresses: string[],
  onProgress?: (current: number, total: number) => void
): Promise<Map<string, UTXO[]>> {
  const results = new Map<string, UTXO[]>();
  const batchSize = 5;

  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async address => ({
        address,
        utxos: await getUTXOs(address),
      }))
    );

    batchResults.forEach(({ address, utxos }) => {
      results.set(address, utxos);
    });

    if (onProgress) {
      onProgress(Math.min(i + batchSize, addresses.length), addresses.length);
    }

    // Rate limit
    if (i + batchSize < addresses.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Get recommended fee rates
 */
export async function getFeeRates(): Promise<{
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}> {
  try {
    const response = await axios.get(`${MEMPOOL_API}/v1/fees/recommended`);
    return response.data;
  } catch (error) {
    // Return default fees on error
    return {
      fastestFee: 50,
      halfHourFee: 25,
      hourFee: 15,
      economyFee: 10,
      minimumFee: 5,
    };
  }
}

/**
 * Calculate total balance across all addresses
 */
export function calculateTotalBalance(balances: AddressBalance[]): {
  confirmed: number;
  unconfirmed: number;
  total: number;
} {
  return balances.reduce(
    (acc, b) => ({
      confirmed: acc.confirmed + b.confirmed,
      unconfirmed: acc.unconfirmed + b.unconfirmed,
      total: acc.total + b.total,
    }),
    { confirmed: 0, unconfirmed: 0, total: 0 }
  );
}

/**
 * Get transaction details
 */
export async function getTransaction(txid: string): Promise<any> {
  try {
    const response = await axios.get(`${MEMPOOL_API}/tx/${txid}`);
    return response.data;
  } catch (error) {
    return null;
  }
}

/**
 * Get transaction status
 */
export async function getTransactionStatus(txid: string): Promise<{
  confirmed: boolean;
  block_height?: number;
  block_time?: number;
} | null> {
  try {
    const response = await axios.get(`${MEMPOOL_API}/tx/${txid}/status`);
    return response.data;
  } catch (error) {
    return null;
  }
}
