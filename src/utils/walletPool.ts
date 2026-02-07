import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface, ECPairInterface } from 'ecpair';
import { Mutex } from 'async-mutex';

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

export interface WalletConfig {
  wif: string;
  receiveAddress: string;
  label: string;
}

export interface WalletState {
  config: WalletConfig;
  paymentAddress: string;      // Derived p2wpkh address
  publicKey: string;
  keyPair: ECPairInterface;
  lastBidTime: number;
  bidTimestamps: number[];     // Sliding window: actual bid times within RATE_WINDOW_MS
  isAvailable: boolean;
}

export interface WalletPoolStats {
  available: number;
  total: number;
  rateWindowMs: number;
  bidsPerMinute: number;
  wallets: Array<{
    label: string;
    paymentAddress: string;
    bidsInWindow: number;
    isAvailable: boolean;
    secondsUntilReset: number;
  }>;
}

/**
 * Wallet Pool Manager
 * Manages multiple funding wallets with per-wallet rate limiting
 * to maximize bid throughput by rotating between wallets
 */
class WalletPool {
  private wallets: Map<string, WalletState> = new Map();
  private walletList: WalletState[] = [];  // For round-robin access
  private currentIndex: number = 0;
  private readonly RATE_WINDOW_MS: number;
  private readonly BIDS_PER_MINUTE: number;
  private readonly network: bitcoin.Network;

  // Proper mutex for wallet selection to prevent race conditions (TOCTOU fix)
  private readonly selectionMutex = new Mutex();

  constructor(
    wallets: WalletConfig[],
    bidsPerMinute: number = 5,
    network: bitcoin.Network = bitcoin.networks.bitcoin
  ) {
    this.RATE_WINDOW_MS = 60000;  // 1 minute window
    this.BIDS_PER_MINUTE = bidsPerMinute;
    this.network = network;

    this.initializeWallets(wallets);
    console.log(`[WALLET POOL] Initialized with ${this.wallets.size} wallets, ${this.BIDS_PER_MINUTE} bids/min per wallet`);
  }

  /**
   * Initialize wallet states from configs
   */
  private initializeWallets(configs: WalletConfig[]): void {
    for (const config of configs) {
      try {
        const keyPair = ECPair.fromWIF(config.wif, this.network);
        const publicKey = keyPair.publicKey.toString('hex');
        const paymentAddress = bitcoin.payments.p2wpkh({
          pubkey: keyPair.publicKey,
          network: this.network,
        }).address as string;

        const state: WalletState = {
          config,
          paymentAddress,
          publicKey,
          keyPair,
          lastBidTime: 0,
          bidTimestamps: [],
          isAvailable: true,
        };

        this.wallets.set(paymentAddress, state);
        this.walletList.push(state);
        console.log(`[WALLET POOL] Added wallet "${config.label}" (${paymentAddress.slice(0, 10)}...)`);
      } catch (error: any) {
        console.error(`[WALLET POOL] Failed to initialize wallet "${config.label}": ${error.message}`);
        throw new Error(`Invalid WIF for wallet "${config.label}"`);
      }
    }

    if (this.wallets.size === 0) {
      throw new Error('[WALLET POOL] No valid wallets configured');
    }
  }

  /**
   * Check if a wallet is available (hasn't exceeded rate limit in sliding window)
   */
  private isWalletAvailable(wallet: WalletState): boolean {
    const now = Date.now();
    const windowStart = now - this.RATE_WINDOW_MS;

    // Remove expired timestamps outside the sliding window
    wallet.bidTimestamps = wallet.bidTimestamps.filter(t => t > windowStart);

    wallet.isAvailable = wallet.bidTimestamps.length < this.BIDS_PER_MINUTE;
    return wallet.isAvailable;
  }

  /**
   * Select the least recently used available wallet
   */
  private selectLeastRecentlyUsed(): WalletState | null {
    let selected: WalletState | null = null;
    let oldestBidTime = Infinity;

    for (const wallet of this.walletList) {
      if (this.isWalletAvailable(wallet)) {
        if (wallet.lastBidTime < oldestBidTime) {
          oldestBidTime = wallet.lastBidTime;
          selected = wallet;
        }
      }
    }

    return selected;
  }

  /**
   * Get an available wallet using least-recently-used strategy
   * Returns null if all wallets are rate-limited
   * Uses proper mutex (async-mutex) to prevent TOCTOU race conditions
   * when multiple callers request wallets simultaneously.
   *
   * Previous bug: Promise-based polling lock had race condition where multiple
   * callers could pass the while-check simultaneously after awaiting.
   *
   * Fix: Uses async-mutex which provides atomic acquire/release semantics.
   */
  async getAvailableWalletAsync(): Promise<WalletState | null> {
    const release = await this.selectionMutex.acquire();
    try {
      const wallet = this.selectLeastRecentlyUsed();

      if (!wallet) {
        // Calculate when next wallet will be available (earliest timestamp expiry)
        const now = Date.now();
        const windowStart = now - this.RATE_WINDOW_MS;
        let earliestReset = Infinity;
        for (const w of this.walletList) {
          const earliestInWindow = w.bidTimestamps.find(t => t > windowStart);
          if (earliestInWindow) {
            const resetTime = earliestInWindow + this.RATE_WINDOW_MS;
            if (resetTime < earliestReset) {
              earliestReset = resetTime;
            }
          }
        }
        const waitTime = earliestReset === Infinity ? 0 : Math.max(0, earliestReset - now);
        console.log(`[WALLET POOL] All wallets rate-limited. Next available in ${(waitTime / 1000).toFixed(1)}s`);
        return null;
      }

      // Pre-record timestamp to "reserve" this wallet slot
      // This prevents another caller from selecting the same wallet before recordBid() is called
      const now = Date.now();
      wallet.bidTimestamps.push(now);
      wallet.lastBidTime = now;
      wallet.isAvailable = wallet.bidTimestamps.length < this.BIDS_PER_MINUTE;

      return wallet;
    } finally {
      release();
    }
  }

  /**
   * Record that a bid was placed using this wallet
   */
  recordBid(paymentAddress: string): void {
    const wallet = this.wallets.get(paymentAddress);
    if (!wallet) {
      console.warn(`[WALLET POOL] Unknown wallet address: ${paymentAddress}`);
      return;
    }

    const now = Date.now();
    wallet.bidTimestamps.push(now);
    wallet.lastBidTime = now;
    wallet.isAvailable = this.isWalletAvailable(wallet);

    const windowStart = now - this.RATE_WINDOW_MS;
    const bidsInWindow = wallet.bidTimestamps.filter(t => t > windowStart).length;
    console.log(`[WALLET POOL] Recorded bid for "${wallet.config.label}" (${bidsInWindow}/${this.BIDS_PER_MINUTE} in window)`);
  }

  /**
   * Decrement bid count for a wallet when a bid attempt fails.
   * This reverses the pre-recorded timestamp done in getAvailableWalletAsync() to prevent
   * "lost" bid slots when bids fail after wallet reservation.
   */
  decrementBidCount(paymentAddress: string): void {
    const wallet = this.wallets.get(paymentAddress);
    if (!wallet) {
      console.warn(`[WALLET POOL] Unknown wallet address for decrement: ${paymentAddress}`);
      return;
    }

    if (wallet.bidTimestamps.length > 0) {
      wallet.bidTimestamps.pop();  // Remove the most recent (pre-recorded) timestamp
      wallet.isAvailable = this.isWalletAvailable(wallet);
      const now = Date.now();
      const windowStart = now - this.RATE_WINDOW_MS;
      const bidsInWindow = wallet.bidTimestamps.filter(t => t > windowStart).length;
      console.log(`[WALLET POOL] Decremented bid for "${wallet.config.label}" after failure (${bidsInWindow}/${this.BIDS_PER_MINUTE} in window)`);
    }
  }

  /**
   * Get wallet state by payment address (for cancellation lookup)
   */
  getWalletByPaymentAddress(address: string): WalletState | null {
    return this.wallets.get(address) || null;
  }

  /**
   * Get wallet state by receive address
   */
  getWalletByReceiveAddress(address: string): WalletState | null {
    for (const wallet of this.walletList) {
      if (wallet.config.receiveAddress.toLowerCase() === address.toLowerCase()) {
        return wallet;
      }
    }
    return null;
  }

  /**
   * Get pool statistics
   */
  getStats(): WalletPoolStats {
    const now = Date.now();
    const windowStart = now - this.RATE_WINDOW_MS;
    let available = 0;

    const walletStats = this.walletList.map(wallet => {
      const isAvail = this.isWalletAvailable(wallet);
      if (isAvail) available++;

      const bidsInWindow = wallet.bidTimestamps.filter(t => t > windowStart).length;
      // Time until the earliest bid in the window expires (frees a slot)
      const earliestInWindow = wallet.bidTimestamps.find(t => t > windowStart);
      const secondsUntilReset = earliestInWindow
        ? Math.max(0, (earliestInWindow + this.RATE_WINDOW_MS - now) / 1000)
        : 0;

      return {
        label: wallet.config.label,
        paymentAddress: wallet.paymentAddress,
        bidsInWindow,
        isAvailable: isAvail,
        secondsUntilReset: Math.round(secondsUntilReset),
      };
    });

    return {
      available,
      total: this.walletList.length,
      rateWindowMs: this.RATE_WINDOW_MS,
      bidsPerMinute: this.BIDS_PER_MINUTE,
      wallets: walletStats,
    };
  }

  /**
   * Get all wallet payment addresses
   */
  getAllPaymentAddresses(): string[] {
    return this.walletList.map(w => w.paymentAddress);
  }

  /**
   * Get all wallet receive addresses
   */
  getAllReceiveAddresses(): string[] {
    return this.walletList.map(w => w.config.receiveAddress);
  }

  /**
   * Reset all rate limit windows (useful for testing)
   */
  resetAllWindows(): void {
    for (const wallet of this.walletList) {
      wallet.bidTimestamps = [];
      wallet.isAvailable = true;
    }
    console.log('[WALLET POOL] All rate limit windows reset');
  }
}

// Export the WalletPool class for use by WalletGroupManager
export { WalletPool };

// Singleton instance (for backward compatibility with single-pool mode)
let poolInstance: WalletPool | null = null;

/**
 * Initialize the wallet pool (call once at startup)
 */
export function initializeWalletPool(
  wallets: WalletConfig[],
  bidsPerMinute: number = 5,
  network: bitcoin.Network = bitcoin.networks.bitcoin
): WalletPool {
  if (poolInstance) {
    console.warn('[WALLET POOL] Pool already initialized, reinitializing...');
  }

  if (!wallets || wallets.length === 0) {
    throw new Error('[WALLET POOL] No wallets provided for initialization');
  }

  poolInstance = new WalletPool(wallets, bidsPerMinute, network);
  return poolInstance;
}

/**
 * Get the singleton wallet pool instance
 */
export function getWalletPool(): WalletPool {
  if (!poolInstance) {
    throw new Error('[WALLET POOL] Wallet pool not initialized. Call initializeWalletPool() first.');
  }
  return poolInstance;
}

/**
 * Check if wallet pool is initialized
 */
export function isWalletPoolInitialized(): boolean {
  return poolInstance !== null;
}

/**
 * Quick access: Get an available wallet from the pool with mutex protection (async)
 * This version prevents race conditions when multiple callers request wallets simultaneously.
 * The returned wallet already has its bid count incremented, so no separate recordBid() call is needed.
 */
export async function getAvailableWalletAsync(): Promise<WalletState | null> {
  return getWalletPool().getAvailableWalletAsync();
}

/**
 * Quick access: Record a bid for a wallet
 */
export function recordBid(paymentAddress: string): void {
  getWalletPool().recordBid(paymentAddress);
}

/**
 * Quick access: Decrement bid count for a wallet after failed bid attempt
 * Call this when a bid fails after getAvailableWalletAsync() was used
 */
export function decrementBidCount(paymentAddress: string): void {
  getWalletPool().decrementBidCount(paymentAddress);
}

/**
 * Quick access: Get wallet by payment address
 */
export function getWalletByPaymentAddress(address: string): WalletState | null {
  return getWalletPool().getWalletByPaymentAddress(address);
}

/**
 * Quick access: Get wallet by receive address
 */
export function getWalletByReceiveAddress(address: string): WalletState | null {
  return getWalletPool().getWalletByReceiveAddress(address);
}

/**
 * Quick access: Get pool statistics
 */
export function getWalletPoolStats(): WalletPoolStats {
  return getWalletPool().getStats();
}

/**
 * Quick access: Reset all rate limit windows
 */
export function resetWalletPoolWindows(): void {
  getWalletPool().resetAllWindows();
}

export default WalletPool;
