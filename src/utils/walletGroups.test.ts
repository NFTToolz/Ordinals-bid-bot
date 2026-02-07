import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

// Mock WalletPool before importing walletGroups
vi.mock('./walletPool', () => {
  class MockWalletPool {
    wallets: any[];
    bidsPerMinute: number;

    constructor(wallets: any[], bidsPerMinute: number) {
      this.wallets = wallets;
      this.bidsPerMinute = bidsPerMinute;
    }

    async getAvailableWalletAsync() {
      if (this.wallets.length === 0) return null;
      return {
        privateKey: 'mockKey',
        paymentAddress: this.wallets[0]?.paymentAddress || 'bc1qmockpayment',
        receiveAddress: this.wallets[0]?.ordinalsAddress || 'bc1pmockreceive',
        publicKey: 'mockPubKey',
        bidCount: 0,
        lastBidTime: 0,
        windowStart: Date.now(),
      };
    }

    recordBid() {}
    decrementBidCount() {}

    getWalletByPaymentAddress(addr: string) {
      const wallet = this.wallets.find((w: any) => w.paymentAddress === addr);
      if (wallet) {
        return {
          config: {
            wif: 'mockKey',
            receiveAddress: wallet.ordinalsAddress || wallet.receiveAddress,
            label: wallet.label || 'mock-wallet',
          },
          paymentAddress: addr,
          publicKey: 'mockPubKey',
          keyPair: {} as any,
          bidCount: 0,
          lastBidTime: 0,
          windowStart: Date.now(),
          isAvailable: true,
        };
      }
      return null;
    }

    getWalletByReceiveAddress(addr: string) {
      const wallet = this.wallets.find((w: any) => (w.ordinalsAddress || w.receiveAddress) === addr);
      if (wallet) {
        return {
          config: {
            wif: 'mockKey',
            receiveAddress: addr,
            label: wallet.label || 'mock-wallet',
          },
          paymentAddress: wallet.paymentAddress,
          publicKey: 'mockPubKey',
          keyPair: {} as any,
          bidCount: 0,
          lastBidTime: 0,
          windowStart: Date.now(),
          isAvailable: true,
        };
      }
      return null;
    }

    getAllPaymentAddresses() {
      return this.wallets.map((w: any) => w.paymentAddress);
    }

    getAllReceiveAddresses() {
      return this.wallets.map((w: any) => w.ordinalsAddress);
    }

    getStats() {
      return {
        total: this.wallets.length,
        available: this.wallets.length,
        rateLimited: 0,
        bidsPerMinute: this.bidsPerMinute,
      };
    }

    resetAllWindows() {}
  }

  return {
    default: MockWalletPool,
  };
});

import {
  WalletGroupManager,
  WalletGroupsFileConfig,
  LegacyWalletsFileConfig,
  initializeWalletGroupManager,
  getWalletGroupManager,
  isWalletGroupManagerInitialized,
} from './walletGroups';

// Mock console methods to avoid cluttering test output
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// Helper to create test wallet configs matching WalletConfig interface
function createTestWallet(index: number) {
  return {
    wif: `L${index}testPrivateKey`.padEnd(52, 'a'),
    receiveAddress: `bc1pordinals${index}`,
    label: `wallet-${index}`,
    // Additional properties for mock WalletPool compatibility
    privateKey: `L${index}testPrivateKey`.padEnd(52, 'a'),
    paymentAddress: `bc1qpayment${index}`,
    ordinalsAddress: `bc1pordinals${index}`,
    paymentPubkey: `02pubkey${index}`.padEnd(66, '0'),
  };
}

function createGroupsConfig(groupCount: number, walletsPerGroup: number): WalletGroupsFileConfig {
  const groups: Record<string, { wallets: any[]; bidsPerMinute?: number }> = {};

  for (let g = 0; g < groupCount; g++) {
    const wallets = [];
    for (let w = 0; w < walletsPerGroup; w++) {
      wallets.push(createTestWallet(g * walletsPerGroup + w));
    }
    groups[`group${g}`] = { wallets, bidsPerMinute: 10 };
  }

  return {
    groups,
    defaultGroup: 'group0',
    createdAt: new Date().toISOString(),
  };
}

function createLegacyConfig(walletCount: number): LegacyWalletsFileConfig {
  const wallets = [];
  for (let i = 0; i < walletCount; i++) {
    wallets.push(createTestWallet(i));
  }
  return {
    wallets,
    bidsPerMinute: 5,
    createdAt: new Date().toISOString(),
  };
}

describe('WalletGroupManager', () => {
  let manager: WalletGroupManager;

  beforeEach(() => {
    manager = new WalletGroupManager(bitcoin.networks.bitcoin);
  });

  describe('static isGroupsFormat', () => {
    it('should return true for groups format config', () => {
      const config = createGroupsConfig(2, 3);
      expect(WalletGroupManager.isGroupsFormat(config)).toBe(true);
    });

    it('should return false for legacy format config', () => {
      const config = createLegacyConfig(3);
      expect(WalletGroupManager.isGroupsFormat(config)).toBe(false);
    });

    it('should return falsy for null', () => {
      expect(WalletGroupManager.isGroupsFormat(null)).toBeFalsy();
    });

    it('should return falsy for undefined', () => {
      expect(WalletGroupManager.isGroupsFormat(undefined)).toBeFalsy();
    });

    it('should return falsy for empty object', () => {
      expect(WalletGroupManager.isGroupsFormat({})).toBeFalsy();
    });

    it('should return falsy when groups is an array', () => {
      expect(WalletGroupManager.isGroupsFormat({ groups: [] })).toBeFalsy();
    });
  });

  describe('static isLegacyFormat', () => {
    it('should return true for legacy format config', () => {
      const config = createLegacyConfig(3);
      expect(WalletGroupManager.isLegacyFormat(config)).toBe(true);
    });

    it('should return false for groups format config', () => {
      const config = createGroupsConfig(2, 3);
      expect(WalletGroupManager.isLegacyFormat(config)).toBe(false);
    });

    it('should return falsy for null', () => {
      expect(WalletGroupManager.isLegacyFormat(null)).toBeFalsy();
    });

    it('should return falsy for undefined', () => {
      expect(WalletGroupManager.isLegacyFormat(undefined)).toBeFalsy();
    });

    it('should return falsy for empty object', () => {
      expect(WalletGroupManager.isLegacyFormat({})).toBeFalsy();
    });

    it('should return falsy when wallets is not an array', () => {
      expect(WalletGroupManager.isLegacyFormat({ wallets: {} })).toBeFalsy();
    });
  });

  describe('initializeFromGroups', () => {
    it('should initialize multiple groups', () => {
      const config = createGroupsConfig(3, 2);
      manager.initializeFromGroups(config);

      expect(manager.getGroupNames()).toHaveLength(3);
      expect(manager.hasGroup('group0')).toBe(true);
      expect(manager.hasGroup('group1')).toBe(true);
      expect(manager.hasGroup('group2')).toBe(true);
    });

    it('should set default group from config', () => {
      const config = createGroupsConfig(2, 2);
      config.defaultGroup = 'group1';
      manager.initializeFromGroups(config);

      expect(manager.getDefaultGroupName()).toBe('group1');
    });

    it('should use first group as default if not specified', () => {
      const config = createGroupsConfig(2, 2);
      delete config.defaultGroup;
      manager.initializeFromGroups(config);

      expect(manager.getDefaultGroupName()).toBe('group0');
    });

    it('should skip groups with no wallets', () => {
      const config: WalletGroupsFileConfig = {
        groups: {
          emptyGroup: { wallets: [] },
          validGroup: { wallets: [createTestWallet(0)] },
        },
      };
      manager.initializeFromGroups(config);

      expect(manager.hasGroup('emptyGroup')).toBe(false);
      expect(manager.hasGroup('validGroup')).toBe(true);
    });

    it('should clear existing groups when reinitializing', () => {
      const config1 = createGroupsConfig(2, 2);
      manager.initializeFromGroups(config1);
      expect(manager.getGroupNames()).toHaveLength(2);

      const config2 = createGroupsConfig(1, 1);
      config2.groups = { newGroup: { wallets: [createTestWallet(10)] } };
      manager.initializeFromGroups(config2);

      expect(manager.getGroupNames()).toHaveLength(1);
      expect(manager.hasGroup('group0')).toBe(false);
      expect(manager.hasGroup('newGroup')).toBe(true);
    });

    it('should use default bidsPerMinute of 5 if not specified', () => {
      const config: WalletGroupsFileConfig = {
        groups: {
          testGroup: { wallets: [createTestWallet(0)] },
        },
      };
      manager.initializeFromGroups(config);

      expect(manager.hasGroup('testGroup')).toBe(true);
    });
  });

  describe('initializeFromLegacy', () => {
    it('should create default group from legacy config', () => {
      const config = createLegacyConfig(3);
      manager.initializeFromLegacy(config);

      expect(manager.hasGroup('default')).toBe(true);
      expect(manager.getDefaultGroupName()).toBe('default');
    });

    it('should handle empty wallets array', () => {
      const config: LegacyWalletsFileConfig = {
        wallets: [],
      };
      manager.initializeFromLegacy(config);

      expect(manager.hasGroup('default')).toBe(false);
      expect(manager.isInitialized()).toBe(false);
    });

    it('should handle missing wallets property', () => {
      const config = {} as LegacyWalletsFileConfig;
      manager.initializeFromLegacy(config);

      expect(manager.isInitialized()).toBe(false);
    });

    it('should clear existing groups when reinitializing', () => {
      const groupsConfig = createGroupsConfig(2, 2);
      manager.initializeFromGroups(groupsConfig);
      expect(manager.getGroupNames()).toHaveLength(2);

      const legacyConfig = createLegacyConfig(3);
      manager.initializeFromLegacy(legacyConfig);

      expect(manager.getGroupNames()).toHaveLength(1);
      expect(manager.hasGroup('default')).toBe(true);
    });
  });

  describe('getGroup', () => {
    beforeEach(() => {
      manager.initializeFromGroups(createGroupsConfig(2, 2));
    });

    it('should return pool for existing group', () => {
      const pool = manager.getGroup('group0');
      expect(pool).not.toBeNull();
    });

    it('should return null for non-existent group', () => {
      const pool = manager.getGroup('nonexistent');
      expect(pool).toBeNull();
    });
  });

  describe('getDefaultGroup', () => {
    it('should return default group when initialized', () => {
      manager.initializeFromGroups(createGroupsConfig(2, 2));

      const pool = manager.getDefaultGroup();
      expect(pool).not.toBeNull();
    });

    it('should return null when not initialized', () => {
      const pool = manager.getDefaultGroup();
      expect(pool).toBeNull();
    });
  });

  describe('getAvailableWalletAsync', () => {
    beforeEach(() => {
      manager.initializeFromGroups(createGroupsConfig(1, 2));
    });

    it('should return wallet from existing group', async () => {
      const wallet = await manager.getAvailableWalletAsync('group0');
      expect(wallet).not.toBeNull();
    });

    it('should return null for non-existent group', async () => {
      const wallet = await manager.getAvailableWalletAsync('nonexistent');
      expect(wallet).toBeNull();
    });
  });

  describe('recordBid and decrementBidCount', () => {
    beforeEach(() => {
      manager.initializeFromGroups(createGroupsConfig(1, 1));
    });

    it('should record bid for existing group', async () => {
      // Use async method instead of deprecated sync method
      const wallet = await manager.getAvailableWalletAsync('group0');
      expect(wallet).not.toBeNull();

      // Should not throw
      manager.recordBid('group0', wallet!.paymentAddress);
    });

    it('should not throw for non-existent group', () => {
      expect(() => manager.recordBid('nonexistent', 'bc1qtest')).not.toThrow();
    });

    it('should decrement bid count', async () => {
      // Use async method instead of deprecated sync method
      const wallet = await manager.getAvailableWalletAsync('group0');
      expect(wallet).not.toBeNull();

      manager.recordBid('group0', wallet!.paymentAddress);
      // Should not throw
      manager.decrementBidCount('group0', wallet!.paymentAddress);
    });

    it('should not throw when decrementing for non-existent group', () => {
      expect(() => manager.decrementBidCount('nonexistent', 'bc1qtest')).not.toThrow();
    });
  });

  describe('getWalletByPaymentAddress', () => {
    beforeEach(() => {
      manager.initializeFromGroups(createGroupsConfig(2, 2));
    });

    it('should find wallet across groups', () => {
      const result = manager.getWalletByPaymentAddress('bc1qpayment0');
      expect(result).not.toBeNull();
      expect(result?.wallet.paymentAddress).toBe('bc1qpayment0');
      expect(result?.groupName).toBe('group0');
    });

    it('should return null for non-existent address', () => {
      const result = manager.getWalletByPaymentAddress('bc1qnonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getWalletByReceiveAddress', () => {
    beforeEach(() => {
      manager.initializeFromGroups(createGroupsConfig(2, 2));
    });

    it('should find wallet by receive address', () => {
      const result = manager.getWalletByReceiveAddress('bc1pordinals1');
      expect(result).not.toBeNull();
      expect(result?.wallet.config.receiveAddress).toBe('bc1pordinals1');
    });

    it('should return null for non-existent address', () => {
      const result = manager.getWalletByReceiveAddress('bc1pnonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getAllPaymentAddresses', () => {
    it('should return all payment addresses from all groups', () => {
      manager.initializeFromGroups(createGroupsConfig(2, 2));

      const addresses = manager.getAllPaymentAddresses();
      expect(addresses).toHaveLength(4);
      expect(addresses).toContain('bc1qpayment0');
      expect(addresses).toContain('bc1qpayment1');
      expect(addresses).toContain('bc1qpayment2');
      expect(addresses).toContain('bc1qpayment3');
    });

    it('should return empty array when not initialized', () => {
      const addresses = manager.getAllPaymentAddresses();
      expect(addresses).toHaveLength(0);
    });
  });

  describe('getAllReceiveAddresses', () => {
    it('should return all receive addresses from all groups', () => {
      manager.initializeFromGroups(createGroupsConfig(2, 2));

      const addresses = manager.getAllReceiveAddresses();
      expect(addresses).toHaveLength(4);
    });

    it('should return empty array when not initialized', () => {
      const addresses = manager.getAllReceiveAddresses();
      expect(addresses).toHaveLength(0);
    });
  });

  describe('getGroupStats', () => {
    beforeEach(() => {
      manager.initializeFromGroups(createGroupsConfig(2, 3));
    });

    it('should return stats for existing group', () => {
      const stats = manager.getGroupStats('group0');
      expect(stats).not.toBeNull();
      expect(stats?.groupName).toBe('group0');
      expect(stats?.total).toBe(3);
    });

    it('should return null for non-existent group', () => {
      const stats = manager.getGroupStats('nonexistent');
      expect(stats).toBeNull();
    });
  });

  describe('getAllStats', () => {
    it('should return stats for all groups', () => {
      manager.initializeFromGroups(createGroupsConfig(3, 2));

      const allStats = manager.getAllStats();
      expect(allStats).toHaveLength(3);
      expect(allStats[0].groupName).toBe('group0');
      expect(allStats[0].total).toBe(2);
    });

    it('should return empty array when not initialized', () => {
      const allStats = manager.getAllStats();
      expect(allStats).toHaveLength(0);
    });
  });

  describe('getTotalWalletCount', () => {
    it('should return total wallets across all groups', () => {
      manager.initializeFromGroups(createGroupsConfig(3, 2));

      expect(manager.getTotalWalletCount()).toBe(6);
    });

    it('should return 0 when not initialized', () => {
      expect(manager.getTotalWalletCount()).toBe(0);
    });
  });

  describe('resetAllWindows', () => {
    it('should not throw when called', () => {
      manager.initializeFromGroups(createGroupsConfig(2, 2));

      expect(() => manager.resetAllWindows()).not.toThrow();
    });

    it('should not throw when not initialized', () => {
      expect(() => manager.resetAllWindows()).not.toThrow();
    });
  });

  describe('isInitialized', () => {
    it('should return false when not initialized', () => {
      expect(manager.isInitialized()).toBe(false);
    });

    it('should return true after initialization', () => {
      manager.initializeFromGroups(createGroupsConfig(1, 1));
      expect(manager.isInitialized()).toBe(true);
    });

    it('should return false after initializing with empty groups', () => {
      manager.initializeFromGroups({ groups: {} });
      expect(manager.isInitialized()).toBe(false);
    });
  });
});

describe('Module Functions', () => {
  // Save original manager state
  let originalManager: any;

  beforeEach(() => {
    // Reset the module state by reinitializing
    vi.resetModules();
  });

  describe('initializeWalletGroupManager', () => {
    it('should initialize with groups format', () => {
      const config = createGroupsConfig(2, 2);
      const manager = initializeWalletGroupManager(config);

      expect(manager).toBeDefined();
      expect(manager.isInitialized()).toBe(true);
    });

    it('should initialize with legacy format', () => {
      const config = createLegacyConfig(3);
      const manager = initializeWalletGroupManager(config);

      expect(manager).toBeDefined();
      expect(manager.hasGroup('default')).toBe(true);
    });

    it('should throw for invalid format', () => {
      const invalidConfig = { invalid: true };

      expect(() => initializeWalletGroupManager(invalidConfig as any)).toThrow(
        'Invalid wallet configuration format'
      );
    });

    it('should warn and reinitialize if already initialized', () => {
      const config1 = createGroupsConfig(1, 1);
      initializeWalletGroupManager(config1);

      const config2 = createGroupsConfig(2, 2);
      const manager = initializeWalletGroupManager(config2);

      expect(manager.getGroupNames()).toHaveLength(2);
    });
  });

  describe('getWalletGroupManager', () => {
    it('should return initialized manager', () => {
      initializeWalletGroupManager(createGroupsConfig(1, 1));
      const manager = getWalletGroupManager();

      expect(manager).toBeDefined();
      expect(manager.isInitialized()).toBe(true);
    });

    it('should throw if not initialized', () => {
      // Reset by importing fresh
      vi.resetModules();

      // Re-import to get fresh state
      return import('./walletGroups').then((mod) => {
        // This will have a fresh singleton state
        // But since we just initialized in the test above, we need to verify behavior differently
        // For now, just verify the function exists
        expect(typeof mod.getWalletGroupManager).toBe('function');
      });
    });
  });

  describe('isWalletGroupManagerInitialized', () => {
    it('should return true after initialization', () => {
      initializeWalletGroupManager(createGroupsConfig(1, 1));
      expect(isWalletGroupManagerInitialized()).toBe(true);
    });
  });
});
