import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import WalletPool, { WalletConfig, WalletState, WalletPoolStats } from './walletPool';

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

/**
 * Configuration for a wallet group
 */
export interface WalletGroupConfig {
  wallets: WalletConfig[];
  bidsPerMinute?: number;
}

/**
 * Full wallet groups configuration file structure
 */
export interface WalletGroupsFileConfig {
  groups: Record<string, WalletGroupConfig>;
  defaultGroup?: string;
  createdAt?: string;
  lastModified?: string;
}

/**
 * Legacy flat wallets.json format (for backward compatibility)
 */
export interface LegacyWalletsFileConfig {
  wallets: WalletConfig[];
  bidsPerMinute?: number;
  mnemonic?: string;
  encryptedMnemonic?: string;
  createdAt?: string;
  lastModified?: string;
}

/**
 * Stats for a single wallet group
 */
export interface WalletGroupStats extends WalletPoolStats {
  groupName: string;
}

/**
 * Wallet Group Manager
 * Manages multiple named wallet pools, allowing different collections
 * to use different sets of wallets with separate rate limiting.
 */
export class WalletGroupManager {
  private groups: Map<string, WalletPool> = new Map();
  private defaultGroupName: string | null = null;
  private readonly network: bitcoin.Network;

  constructor(network: bitcoin.Network = bitcoin.networks.bitcoin) {
    this.network = network;
  }

  /**
   * Initialize from new groups format
   */
  initializeFromGroups(config: WalletGroupsFileConfig): void {
    this.groups.clear();

    for (const [groupName, groupConfig] of Object.entries(config.groups)) {
      if (!groupConfig.wallets || groupConfig.wallets.length === 0) {
        console.warn(`[WALLET GROUPS] Group "${groupName}" has no wallets, skipping`);
        continue;
      }

      const pool = new WalletPool(
        groupConfig.wallets,
        groupConfig.bidsPerMinute || 5,
        this.network
      );
      this.groups.set(groupName, pool);
      console.log(`[WALLET GROUPS] Initialized group "${groupName}" with ${groupConfig.wallets.length} wallets`);
    }

    if (config.defaultGroup && this.groups.has(config.defaultGroup)) {
      this.defaultGroupName = config.defaultGroup;
    } else if (this.groups.size > 0) {
      // Use first group as default if none specified
      this.defaultGroupName = this.groups.keys().next().value || null;
    }

    console.log(`[WALLET GROUPS] Initialized ${this.groups.size} group(s), default: ${this.defaultGroupName || 'none'}`);
  }

  /**
   * Initialize from legacy flat wallets array format
   * Creates a single "default" group containing all wallets
   */
  initializeFromLegacy(config: LegacyWalletsFileConfig): void {
    this.groups.clear();

    if (!config.wallets || config.wallets.length === 0) {
      console.warn('[WALLET GROUPS] Legacy config has no wallets');
      return;
    }

    const pool = new WalletPool(
      config.wallets,
      config.bidsPerMinute || 5,
      this.network
    );
    this.groups.set('default', pool);
    this.defaultGroupName = 'default';

    console.log(`[WALLET GROUPS] Initialized legacy format as "default" group with ${config.wallets.length} wallets`);
  }

  /**
   * Check if config is in new groups format
   */
  static isGroupsFormat(config: any): config is WalletGroupsFileConfig {
    return config && typeof config.groups === 'object' && !Array.isArray(config.groups);
  }

  /**
   * Check if config is in legacy flat format
   */
  static isLegacyFormat(config: any): config is LegacyWalletsFileConfig {
    return config && Array.isArray(config.wallets);
  }

  /**
   * Get a wallet pool by group name
   */
  getGroup(groupName: string): WalletPool | null {
    return this.groups.get(groupName) || null;
  }

  /**
   * Get the default wallet pool
   */
  getDefaultGroup(): WalletPool | null {
    if (!this.defaultGroupName) return null;
    return this.groups.get(this.defaultGroupName) || null;
  }

  /**
   * Get default group name
   */
  getDefaultGroupName(): string | null {
    return this.defaultGroupName;
  }

  /**
   * Get all group names
   */
  getGroupNames(): string[] {
    return Array.from(this.groups.keys());
  }

  /**
   * Check if a group exists
   */
  hasGroup(groupName: string): boolean {
    return this.groups.has(groupName);
  }

  /**
   * @deprecated Use getAvailableWalletAsync() instead.
   * Synchronous wallet selection has been removed due to race condition vulnerabilities.
   */
  getAvailableWallet(groupName: string): WalletState | null {
    throw new Error('[WALLET GROUPS] Sync getAvailableWallet() is deprecated. Use getAvailableWalletAsync() instead.');
  }

  /**
   * Get an available wallet from a specific group (async version with mutex)
   * Uses proper mutex to prevent TOCTOU race conditions.
   */
  async getAvailableWalletAsync(groupName: string): Promise<WalletState | null> {
    const pool = this.groups.get(groupName);
    if (!pool) {
      console.warn(`[WALLET GROUPS] Group "${groupName}" not found`);
      return null;
    }
    return pool.getAvailableWalletAsync();
  }

  /**
   * Record a bid for a wallet in a specific group
   */
  recordBid(groupName: string, paymentAddress: string): void {
    const pool = this.groups.get(groupName);
    if (pool) {
      pool.recordBid(paymentAddress);
    }
  }

  /**
   * Decrement bid count for a wallet after failed attempt
   */
  decrementBidCount(groupName: string, paymentAddress: string): void {
    const pool = this.groups.get(groupName);
    if (pool) {
      pool.decrementBidCount(paymentAddress);
    }
  }

  /**
   * Get wallet by payment address, searching all groups
   */
  getWalletByPaymentAddress(address: string): { wallet: WalletState; groupName: string } | null {
    const entries = Array.from(this.groups.entries());
    for (let i = 0; i < entries.length; i++) {
      const [groupName, pool] = entries[i];
      const wallet = pool.getWalletByPaymentAddress(address);
      if (wallet) {
        return { wallet, groupName };
      }
    }
    return null;
  }

  /**
   * Get wallet by receive address, searching all groups
   */
  getWalletByReceiveAddress(address: string): { wallet: WalletState; groupName: string } | null {
    const entries = Array.from(this.groups.entries());
    for (let i = 0; i < entries.length; i++) {
      const [groupName, pool] = entries[i];
      const wallet = pool.getWalletByReceiveAddress(address);
      if (wallet) {
        return { wallet, groupName };
      }
    }
    return null;
  }

  /**
   * Get all payment addresses across all groups
   */
  getAllPaymentAddresses(): string[] {
    const addresses: string[] = [];
    const pools = Array.from(this.groups.values());
    for (let i = 0; i < pools.length; i++) {
      addresses.push(...pools[i].getAllPaymentAddresses());
    }
    return addresses;
  }

  /**
   * Get all receive addresses across all groups
   */
  getAllReceiveAddresses(): string[] {
    const addresses: string[] = [];
    const pools = Array.from(this.groups.values());
    for (let i = 0; i < pools.length; i++) {
      addresses.push(...pools[i].getAllReceiveAddresses());
    }
    return addresses;
  }

  /**
   * Get stats for a specific group
   */
  getGroupStats(groupName: string): WalletGroupStats | null {
    const pool = this.groups.get(groupName);
    if (!pool) return null;

    const stats = pool.getStats();
    return {
      ...stats,
      groupName,
    };
  }

  /**
   * Get stats for all groups
   */
  getAllStats(): WalletGroupStats[] {
    const allStats: WalletGroupStats[] = [];
    const entries = Array.from(this.groups.entries());
    for (let i = 0; i < entries.length; i++) {
      const [groupName, pool] = entries[i];
      allStats.push({
        ...pool.getStats(),
        groupName,
      });
    }
    return allStats;
  }

  /**
   * Get total wallet count across all groups
   */
  getTotalWalletCount(): number {
    let count = 0;
    const pools = Array.from(this.groups.values());
    for (let i = 0; i < pools.length; i++) {
      count += pools[i].getStats().total;
    }
    return count;
  }

  /**
   * Reset all rate limit windows across all groups
   */
  resetAllWindows(): void {
    const pools = Array.from(this.groups.values());
    for (let i = 0; i < pools.length; i++) {
      pools[i].resetAllWindows();
    }
  }

  /**
   * Check if manager has any groups initialized
   */
  isInitialized(): boolean {
    return this.groups.size > 0;
  }
}

// Singleton instance
let managerInstance: WalletGroupManager | null = null;

/**
 * Initialize the wallet group manager
 */
export function initializeWalletGroupManager(
  config: WalletGroupsFileConfig | LegacyWalletsFileConfig,
  network: bitcoin.Network = bitcoin.networks.bitcoin
): WalletGroupManager {
  if (managerInstance) {
    console.warn('[WALLET GROUPS] Manager already initialized, reinitializing...');
  }

  managerInstance = new WalletGroupManager(network);

  if (WalletGroupManager.isGroupsFormat(config)) {
    managerInstance.initializeFromGroups(config);
  } else if (WalletGroupManager.isLegacyFormat(config)) {
    managerInstance.initializeFromLegacy(config);
  } else {
    throw new Error('[WALLET GROUPS] Invalid wallet configuration format');
  }

  return managerInstance;
}

/**
 * Get the singleton wallet group manager instance
 */
export function getWalletGroupManager(): WalletGroupManager {
  if (!managerInstance) {
    throw new Error('[WALLET GROUPS] Wallet group manager not initialized. Call initializeWalletGroupManager() first.');
  }
  return managerInstance;
}

/**
 * Check if wallet group manager is initialized
 */
export function isWalletGroupManagerInitialized(): boolean {
  return managerInstance !== null && managerInstance.isInitialized();
}

export default WalletGroupManager;
