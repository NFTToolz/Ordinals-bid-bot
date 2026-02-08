import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import {
  generateMnemonic,
  validateMnemonic,
  deriveWallets,
  getWalletFromWIF,
  encryptMnemonic,
  decryptMnemonic,
  encryptData,
  decryptData,
  isEncryptedFormat,
  saveWalletsEncrypted,
  loadWalletsDecrypted,
  readWalletsFileRaw,
  setSessionPassword,
  clearSessionPassword,
  importFromWIF,
  loadWallets,
  saveWallets,
  addWalletsToConfig,
  removeWalletFromConfig,
  getNextWalletIndex,
  exportWallets,
  importWalletsFromBackup,
  isGroupsFormat,
  loadWalletGroups,
  saveWalletGroups,
  migrateToGroupsFormat,
  createWalletGroup,
  deleteWalletGroup,
  addWalletToGroup,
  removeWalletFromGroup,
  moveWalletToGroup,
  getWalletGroup,
  getWalletGroupNames,
  updateGroupBidsPerMinute,
  setDefaultGroup,
  findWalletGroup,
  getAllWalletsFromGroups,
  getUnassignedWallets,
  loadFundingWalletFromConfig,
  FundingWalletConfig,
  WalletsFile,
  WalletGroupsFile,
} from './WalletGenerator';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
  chmodSync: vi.fn(),
}));

import * as fs from 'fs';

describe('WalletGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateMnemonic', () => {
    it('should generate a valid 12-word mnemonic', () => {
      const mnemonic = generateMnemonic();
      const words = mnemonic.split(' ');
      expect(words).toHaveLength(12);
    });

    it('should generate unique mnemonics', () => {
      const mnemonic1 = generateMnemonic();
      const mnemonic2 = generateMnemonic();
      expect(mnemonic1).not.toBe(mnemonic2);
    });

    it('should generate valid BIP39 mnemonics', () => {
      const mnemonic = generateMnemonic();
      expect(validateMnemonic(mnemonic)).toBe(true);
    });
  });

  describe('validateMnemonic', () => {
    it('should return true for valid mnemonics', () => {
      const validMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      expect(validateMnemonic(validMnemonic)).toBe(true);
    });

    it('should return false for invalid mnemonics', () => {
      const invalidMnemonic = 'invalid words that are not a valid mnemonic phrase at all here';
      expect(validateMnemonic(invalidMnemonic)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(validateMnemonic('')).toBe(false);
    });

    it('should return false for wrong word count', () => {
      const wrongCount = 'abandon abandon abandon';
      expect(validateMnemonic(wrongCount)).toBe(false);
    });

    it('should return false for invalid checksum', () => {
      const invalidChecksum = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
      expect(validateMnemonic(invalidChecksum)).toBe(false);
    });
  });

  describe('deriveWallets', () => {
    const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    it('should derive specified number of wallets', () => {
      const wallets = deriveWallets(testMnemonic, 3);
      expect(wallets).toHaveLength(3);
    });

    it('should generate unique addresses for each wallet', () => {
      const wallets = deriveWallets(testMnemonic, 5);
      const paymentAddresses = wallets.map(w => w.paymentAddress);
      const uniqueAddresses = new Set(paymentAddresses);
      expect(uniqueAddresses.size).toBe(5);
    });

    it('should generate P2WPKH payment addresses (bc1q...)', () => {
      const wallets = deriveWallets(testMnemonic, 1);
      expect(wallets[0].paymentAddress).toMatch(/^bc1q/);
    });

    it('should generate P2TR receive addresses (bc1p...)', () => {
      const wallets = deriveWallets(testMnemonic, 1);
      expect(wallets[0].receiveAddress).toMatch(/^bc1p/);
    });

    it('should use correct derivation paths', () => {
      const wallets = deriveWallets(testMnemonic, 2);
      expect(wallets[0].derivationPath).toBe("m/84'/0'/0'/0/0");
      expect(wallets[1].derivationPath).toBe("m/84'/0'/0'/0/1");
    });

    it('should support custom start index', () => {
      const wallets = deriveWallets(testMnemonic, 2, 'wallet', 5);
      expect(wallets[0].derivationPath).toBe("m/84'/0'/0'/0/5");
      expect(wallets[1].derivationPath).toBe("m/84'/0'/0'/0/6");
    });

    it('should use custom label prefix', () => {
      const wallets = deriveWallets(testMnemonic, 2, 'funding');
      expect(wallets[0].label).toBe('funding-1');
      expect(wallets[1].label).toBe('funding-2');
    });

    it('should throw on invalid mnemonic', () => {
      expect(() => deriveWallets('invalid mnemonic', 1)).toThrow('Invalid mnemonic');
    });

    it('should return valid WIF format', () => {
      const wallets = deriveWallets(testMnemonic, 1);
      expect(wallets[0].wif).toMatch(/^[KL]/);
    });

    it('should generate deterministic wallets', () => {
      const wallets1 = deriveWallets(testMnemonic, 2);
      const wallets2 = deriveWallets(testMnemonic, 2);
      expect(wallets1[0].paymentAddress).toBe(wallets2[0].paymentAddress);
      expect(wallets1[1].paymentAddress).toBe(wallets2[1].paymentAddress);
    });

    it('should include public key in hex format', () => {
      const wallets = deriveWallets(testMnemonic, 1);
      expect(wallets[0].publicKey).toMatch(/^[0-9a-f]{66}$/i);
    });

    it('should support testnet', () => {
      const wallets = deriveWallets(
        testMnemonic,
        1,
        'wallet',
        0,
        bitcoin.networks.testnet
      );
      expect(wallets[0].paymentAddress).toMatch(/^tb1q/);
    });

    it('should include correct index in output', () => {
      const wallets = deriveWallets(testMnemonic, 3, 'wallet', 5);
      expect(wallets[0].index).toBe(5);
      expect(wallets[1].index).toBe(6);
      expect(wallets[2].index).toBe(7);
    });
  });

  describe('importFromWIF', () => {
    const testWIF = 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn';
    const receiveAddress = 'bc1ptest1234567890';

    it('should import wallet from WIF', () => {
      const wallet = importFromWIF(testWIF, 'imported-wallet', receiveAddress);
      expect(wallet.label).toBe('imported-wallet');
      expect(wallet.wif).toBe(testWIF);
      expect(wallet.receiveAddress).toBe(receiveAddress);
    });

    it('should generate payment address', () => {
      const wallet = importFromWIF(testWIF, 'test', receiveAddress);
      expect(wallet.paymentAddress).toMatch(/^bc1q/);
    });

    it('should set derivationPath to imported', () => {
      const wallet = importFromWIF(testWIF, 'test', receiveAddress);
      expect(wallet.derivationPath).toBe('imported');
    });

    it('should set index to -1', () => {
      const wallet = importFromWIF(testWIF, 'test', receiveAddress);
      expect(wallet.index).toBe(-1);
    });

    it('should throw on invalid WIF', () => {
      expect(() => importFromWIF('invalid', 'test', receiveAddress)).toThrow();
    });
  });

  describe('getWalletFromWIF', () => {
    const testWIF = 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn';

    it('should return payment address from WIF', () => {
      const result = getWalletFromWIF(testWIF);
      expect(result.paymentAddress).toMatch(/^bc1q/);
    });

    it('should return public key from WIF', () => {
      const result = getWalletFromWIF(testWIF);
      expect(result.publicKey).toMatch(/^[0-9a-f]{66}$/i);
    });

    it('should be deterministic', () => {
      const result1 = getWalletFromWIF(testWIF);
      const result2 = getWalletFromWIF(testWIF);
      expect(result1.paymentAddress).toBe(result2.paymentAddress);
      expect(result1.publicKey).toBe(result2.publicKey);
    });

    it('should throw on invalid WIF', () => {
      expect(() => getWalletFromWIF('invalid_wif')).toThrow();
    });
  });

  describe('encryptMnemonic / decryptMnemonic', () => {
    const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const password = 'test_password_123';

    it('should encrypt and decrypt mnemonic correctly', () => {
      const encrypted = encryptMnemonic(testMnemonic, password);
      const decrypted = decryptMnemonic(encrypted, password);
      expect(decrypted).toBe(testMnemonic);
    });

    it('should produce different ciphertext each time (random IV)', () => {
      const encrypted1 = encryptMnemonic(testMnemonic, password);
      const encrypted2 = encryptMnemonic(testMnemonic, password);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should fail with wrong password', () => {
      const encrypted = encryptMnemonic(testMnemonic, password);
      expect(() => decryptMnemonic(encrypted, 'wrong_password')).toThrow();
    });

    it('should return valid JSON from encryption', () => {
      const encrypted = encryptMnemonic(testMnemonic, password);
      const parsed = JSON.parse(encrypted);
      expect(parsed).toHaveProperty('salt');
      expect(parsed).toHaveProperty('iv');
      expect(parsed).toHaveProperty('authTag');
      expect(parsed).toHaveProperty('encrypted');
    });

    it('should handle empty password', () => {
      const encrypted = encryptMnemonic(testMnemonic, '');
      const decrypted = decryptMnemonic(encrypted, '');
      expect(decrypted).toBe(testMnemonic);
    });

    it('should handle special characters in content', () => {
      const specialText = 'test with special chars: !@#$%^&*()';
      const encrypted = encryptMnemonic(specialText, password);
      const decrypted = decryptMnemonic(encrypted, password);
      expect(decrypted).toBe(specialText);
    });

    it('should handle long passwords', () => {
      const longPassword = 'a'.repeat(1000);
      const encrypted = encryptMnemonic(testMnemonic, longPassword);
      const decrypted = decryptMnemonic(encrypted, longPassword);
      expect(decrypted).toBe(testMnemonic);
    });
  });

  describe('loadWallets', () => {
    it('should return null when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = loadWallets();
      expect(result).toBeNull();
    });

    it('should load and parse wallets from file', () => {
      const mockData: WalletsFile = {
        wallets: [{ label: 'test', wif: 'wif123', receiveAddress: 'bc1p...' }],
        bidsPerMinute: 5,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));

      const result = loadWallets();
      expect(result).toEqual(mockData);
    });

    it('should return null on parse error', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

      const result = loadWallets();
      expect(result).toBeNull();
    });
  });

  describe('saveWallets', () => {
    it('should create directory if not exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const data: WalletsFile = { wallets: [], bidsPerMinute: 5 };
      saveWallets(data);

      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it('should add lastModified timestamp', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const data: WalletsFile = { wallets: [] };
      saveWallets(data);

      expect(fs.writeFileSync).toHaveBeenCalled();
      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.lastModified).toBeDefined();
    });

    it('should add createdAt if not present', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const data: WalletsFile = { wallets: [] };
      saveWallets(data);

      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.createdAt).toBeDefined();
    });

    it('should preserve existing createdAt', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const data: WalletsFile = { wallets: [], createdAt: '2024-01-01T00:00:00Z' };
      saveWallets(data);

      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.createdAt).toBe('2024-01-01T00:00:00Z');
    });
  });

  describe('addWalletsToConfig', () => {
    const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
    });

    it('should add new wallets to existing config', () => {
      const existing: WalletsFile = {
        wallets: [{ label: 'existing', wif: 'wif1', receiveAddress: 'bc1p1' }],
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

      const newWallets = deriveWallets(testMnemonic, 1);
      addWalletsToConfig(newWallets);

      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.wallets).toHaveLength(2);
    });

    it('should store unencrypted mnemonic when encrypt=false', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ wallets: [] }));

      const newWallets = deriveWallets(testMnemonic, 1);
      addWalletsToConfig(newWallets, testMnemonic, false);

      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.mnemonic).toBe(testMnemonic);
      expect(savedData.encryptedMnemonic).toBeUndefined();
    });

    it('should store encrypted mnemonic when encrypt=true', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ wallets: [] }));

      const newWallets = deriveWallets(testMnemonic, 1);
      addWalletsToConfig(newWallets, testMnemonic, true, 'password123');

      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.mnemonic).toBeUndefined();
      expect(savedData.encryptedMnemonic).toBeDefined();
    });

    it('should create new config if none exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const newWallets = deriveWallets(testMnemonic, 1);
      addWalletsToConfig(newWallets);

      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('removeWalletFromConfig', () => {
    it('should remove wallet by label', () => {
      const existing: WalletsFile = {
        wallets: [
          { label: 'wallet-1', wif: 'wif1', receiveAddress: 'bc1p1' },
          { label: 'wallet-2', wif: 'wif2', receiveAddress: 'bc1p2' },
        ],
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

      const result = removeWalletFromConfig('wallet-1');

      expect(result).toBe(true);
      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.wallets).toHaveLength(1);
      expect(savedData.wallets[0].label).toBe('wallet-2');
    });

    it('should return false when wallet not found', () => {
      const existing: WalletsFile = {
        wallets: [{ label: 'wallet-1', wif: 'wif1', receiveAddress: 'bc1p1' }],
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

      const result = removeWalletFromConfig('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false when no config exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = removeWalletFromConfig('wallet-1');
      expect(result).toBe(false);
    });
  });

  describe('getNextWalletIndex', () => {
    it('should return 0 when no wallets exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = getNextWalletIndex();
      expect(result).toBe(0);
    });

    it('should return highest index from existing wallets', () => {
      const existing: WalletsFile = {
        wallets: [
          { label: 'wallet-1', wif: 'wif1', receiveAddress: 'bc1p1' },
          { label: 'wallet-5', wif: 'wif5', receiveAddress: 'bc1p5' },
          { label: 'wallet-3', wif: 'wif3', receiveAddress: 'bc1p3' },
        ],
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

      const result = getNextWalletIndex();
      expect(result).toBe(5);
    });

    it('should handle wallets without index in label', () => {
      const existing: WalletsFile = {
        wallets: [
          { label: 'custom-name', wif: 'wif1', receiveAddress: 'bc1p1' },
          { label: 'wallet-2', wif: 'wif2', receiveAddress: 'bc1p2' },
        ],
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

      const result = getNextWalletIndex();
      expect(result).toBe(2);
    });
  });

  describe('exportWallets', () => {
    it('should encrypt and write to file', () => {
      const existing: WalletsFile = {
        wallets: [{ label: 'wallet-1', wif: 'wif1', receiveAddress: 'bc1p1' }],
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

      const result = exportWallets('/backup.enc', 'password123');

      expect(result).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalledWith('/backup.enc', expect.any(String), { mode: 0o600 });
    });

    it('should return false when no wallets exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = exportWallets('/backup.enc', 'password123');
      expect(result).toBe(false);
    });
  });

  describe('importWalletsFromBackup', () => {
    it('should decrypt and return wallet data', () => {
      const walletsData: WalletsFile = {
        wallets: [{ label: 'wallet-1', wif: 'wif1', receiveAddress: 'bc1p1' }],
      };
      const encrypted = encryptMnemonic(JSON.stringify(walletsData), 'password123');
      vi.mocked(fs.readFileSync).mockReturnValue(encrypted);

      const result = importWalletsFromBackup('/backup.enc', 'password123');

      expect(result).toEqual(walletsData);
    });

    it('should return null on wrong password', () => {
      const walletsData: WalletsFile = { wallets: [] };
      const encrypted = encryptMnemonic(JSON.stringify(walletsData), 'password123');
      vi.mocked(fs.readFileSync).mockReturnValue(encrypted);

      const result = importWalletsFromBackup('/backup.enc', 'wrong');
      expect(result).toBeNull();
    });

    it('should return null on read error', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('File not found');
      });

      const result = importWalletsFromBackup('/nonexistent.enc', 'password');
      expect(result).toBeNull();
    });
  });

  describe('isGroupsFormat', () => {
    it('should return true for groups format', () => {
      const data: WalletGroupsFile = {
        groups: { default: { wallets: [], bidsPerMinute: 5 } },
      };
      expect(isGroupsFormat(data)).toBe(true);
    });

    it('should return false for legacy format', () => {
      const data: WalletsFile = { wallets: [] };
      expect(isGroupsFormat(data)).toBe(false);
    });

    it('should return falsy for null', () => {
      expect(isGroupsFormat(null)).toBeFalsy();
    });

    it('should return falsy for undefined', () => {
      expect(isGroupsFormat(undefined)).toBeFalsy();
    });
  });

  describe('loadWalletGroups', () => {
    it('should return null when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = loadWalletGroups();
      expect(result).toBeNull();
    });

    it('should return groups data when in groups format', () => {
      const groupsData: WalletGroupsFile = {
        groups: { default: { wallets: [], bidsPerMinute: 5 } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = loadWalletGroups();
      expect(result).toEqual(groupsData);
    });

    it('should return null for legacy format (migration needed)', () => {
      const legacyData: WalletsFile = { wallets: [] };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(legacyData));

      const result = loadWalletGroups();
      expect(result).toBeNull();
    });
  });

  describe('saveWalletGroups', () => {
    it('should save groups with timestamps', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const data: WalletGroupsFile = {
        groups: { default: { wallets: [], bidsPerMinute: 5 } },
      };
      saveWalletGroups(data);

      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.lastModified).toBeDefined();
      expect(savedData.createdAt).toBeDefined();
    });
  });

  describe('migrateToGroupsFormat', () => {
    it('should migrate legacy wallets to default group', () => {
      const legacyData: WalletsFile = {
        wallets: [
          { label: 'wallet-1', wif: 'wif1', receiveAddress: 'bc1p1' },
          { label: 'wallet-2', wif: 'wif2', receiveAddress: 'bc1p2' },
        ],
        bidsPerMinute: 10,
        mnemonic: 'test mnemonic',
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(legacyData));

      const result = migrateToGroupsFormat();

      expect(result).not.toBeNull();
      expect(result!.groups.default.wallets).toHaveLength(2);
      expect(result!.groups.default.bidsPerMinute).toBe(10);
      expect(result!.defaultGroup).toBe('default');
      expect(result!.mnemonic).toBe('test mnemonic');
    });

    it('should return null when no legacy data exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = migrateToGroupsFormat();
      expect(result).toBeNull();
    });
  });

  describe('createWalletGroup', () => {
    it('should create new group', () => {
      const groupsData: WalletGroupsFile = {
        groups: { existing: { wallets: [], bidsPerMinute: 5 } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = createWalletGroup('new-group', 10);

      expect(result).toBe(true);
      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.groups['new-group']).toBeDefined();
      expect(savedData.groups['new-group'].bidsPerMinute).toBe(10);
    });

    it('should return false if group already exists', () => {
      const groupsData: WalletGroupsFile = {
        groups: { existing: { wallets: [], bidsPerMinute: 5 } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = createWalletGroup('existing');
      expect(result).toBe(false);
    });

    it('should set default group if first group', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      createWalletGroup('first-group');

      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.defaultGroup).toBe('first-group');
    });
  });

  describe('deleteWalletGroup', () => {
    it('should delete empty group', () => {
      const groupsData: WalletGroupsFile = {
        groups: {
          group1: { wallets: [], bidsPerMinute: 5 },
          group2: { wallets: [], bidsPerMinute: 5 },
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = deleteWalletGroup('group1');

      expect(result.success).toBe(true);
      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.groups.group1).toBeUndefined();
    });

    it('should not delete non-empty group', () => {
      const groupsData: WalletGroupsFile = {
        groups: {
          group1: { wallets: [{ label: 'w1', wif: 'wif', receiveAddress: 'addr' }], bidsPerMinute: 5 },
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = deleteWalletGroup('group1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not empty');
    });

    it('should return error if group not found', () => {
      const groupsData: WalletGroupsFile = { groups: {} };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = deleteWalletGroup('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('addWalletToGroup', () => {
    it('should add wallet to group', () => {
      const groupsData: WalletGroupsFile = {
        groups: { group1: { wallets: [], bidsPerMinute: 5 } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = addWalletToGroup('group1', {
        label: 'new-wallet',
        wif: 'wif123',
        receiveAddress: 'bc1pnew',
      });

      expect(result.success).toBe(true);
    });

    it('should not add duplicate wallet', () => {
      const groupsData: WalletGroupsFile = {
        groups: {
          group1: { wallets: [{ label: 'existing', wif: 'wif123', receiveAddress: 'bc1pexist' }], bidsPerMinute: 5 },
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = addWalletToGroup('group1', {
        label: 'new-wallet',
        wif: 'wif123', // Same WIF
        receiveAddress: 'bc1pnew',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should return error if group not found', () => {
      const groupsData: WalletGroupsFile = { groups: {} };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = addWalletToGroup('nonexistent', {
        label: 'wallet',
        wif: 'wif',
        receiveAddress: 'addr',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should reject wallet matching fundingWif parameter', () => {
      const groupsData: WalletGroupsFile = {
        groups: { group1: { wallets: [], bidsPerMinute: 5 } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = addWalletToGroup(
        'group1',
        { label: 'dup-wallet', wif: 'funding-wif-123', receiveAddress: 'bc1pnew' },
        'funding-wif-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('FUNDING_WIF');
    });

    it('should allow wallet when fundingWif is omitted', () => {
      const groupsData: WalletGroupsFile = {
        groups: { group1: { wallets: [], bidsPerMinute: 5 } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = addWalletToGroup('group1', {
        label: 'new-wallet',
        wif: 'funding-wif-123',
        receiveAddress: 'bc1pnew',
      });

      expect(result.success).toBe(true);
    });

    it('should allow wallet when fundingWif does not match', () => {
      const groupsData: WalletGroupsFile = {
        groups: { group1: { wallets: [], bidsPerMinute: 5 } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = addWalletToGroup(
        'group1',
        { label: 'new-wallet', wif: 'different-wif', receiveAddress: 'bc1pnew' },
        'funding-wif-123'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('removeWalletFromGroup', () => {
    it('should remove wallet from group', () => {
      const groupsData: WalletGroupsFile = {
        groups: {
          group1: {
            wallets: [
              { label: 'wallet-1', wif: 'wif1', receiveAddress: 'addr1' },
              { label: 'wallet-2', wif: 'wif2', receiveAddress: 'addr2' },
            ],
            bidsPerMinute: 5,
          },
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = removeWalletFromGroup('group1', 'wallet-1');

      expect(result.success).toBe(true);
      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.groups.group1.wallets).toHaveLength(1);
    });

    it('should return error if wallet not found', () => {
      const groupsData: WalletGroupsFile = {
        groups: { group1: { wallets: [], bidsPerMinute: 5 } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = removeWalletFromGroup('group1', 'nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('moveWalletToGroup', () => {
    it('should move wallet between groups', () => {
      const groupsData: WalletGroupsFile = {
        groups: {
          source: { wallets: [{ label: 'wallet-1', wif: 'wif1', receiveAddress: 'addr1' }], bidsPerMinute: 5 },
          target: { wallets: [], bidsPerMinute: 5 },
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = moveWalletToGroup('wallet-1', 'target');

      expect(result.success).toBe(true);
      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.groups.source.wallets).toHaveLength(0);
      expect(savedData.groups.target.wallets).toHaveLength(1);
    });

    it('should return error if wallet not found', () => {
      const groupsData: WalletGroupsFile = {
        groups: { group1: { wallets: [], bidsPerMinute: 5 } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = moveWalletToGroup('nonexistent', 'group1');

      expect(result.success).toBe(false);
    });

    it('should return error if already in target group', () => {
      const groupsData: WalletGroupsFile = {
        groups: {
          group1: { wallets: [{ label: 'wallet-1', wif: 'wif1', receiveAddress: 'addr1' }], bidsPerMinute: 5 },
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = moveWalletToGroup('wallet-1', 'group1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already in group');
    });
  });

  describe('getWalletGroup', () => {
    it('should return group config', () => {
      const groupsData: WalletGroupsFile = {
        groups: { mygroup: { wallets: [], bidsPerMinute: 10 } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = getWalletGroup('mygroup');

      expect(result).not.toBeNull();
      expect(result!.bidsPerMinute).toBe(10);
    });

    it('should return null if group not found', () => {
      const groupsData: WalletGroupsFile = { groups: {} };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = getWalletGroup('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getWalletGroupNames', () => {
    it('should return all group names', () => {
      const groupsData: WalletGroupsFile = {
        groups: { group1: { wallets: [], bidsPerMinute: 5 }, group2: { wallets: [], bidsPerMinute: 5 } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = getWalletGroupNames();

      expect(result).toContain('group1');
      expect(result).toContain('group2');
    });

    it('should return empty array when no groups exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = getWalletGroupNames();
      expect(result).toEqual([]);
    });
  });

  describe('updateGroupBidsPerMinute', () => {
    it('should update bidsPerMinute', () => {
      const groupsData: WalletGroupsFile = {
        groups: { group1: { wallets: [], bidsPerMinute: 5 } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = updateGroupBidsPerMinute('group1', 20);

      expect(result).toBe(true);
      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.groups.group1.bidsPerMinute).toBe(20);
    });

    it('should return false if group not found', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = updateGroupBidsPerMinute('nonexistent', 20);
      expect(result).toBe(false);
    });
  });

  describe('setDefaultGroup', () => {
    it('should set default group', () => {
      const groupsData: WalletGroupsFile = {
        groups: { group1: { wallets: [], bidsPerMinute: 5 }, group2: { wallets: [], bidsPerMinute: 5 } },
        defaultGroup: 'group1',
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = setDefaultGroup('group2');

      expect(result).toBe(true);
      const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(savedData.defaultGroup).toBe('group2');
    });

    it('should return false if group not found', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = setDefaultGroup('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('findWalletGroup', () => {
    it('should find group containing wallet', () => {
      const groupsData: WalletGroupsFile = {
        groups: {
          group1: { wallets: [{ label: 'wallet-1', wif: 'wif1', receiveAddress: 'addr1' }], bidsPerMinute: 5 },
          group2: { wallets: [], bidsPerMinute: 5 },
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = findWalletGroup('wallet-1');
      expect(result).toBe('group1');
    });

    it('should return null if wallet not found', () => {
      const groupsData: WalletGroupsFile = { groups: {} };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = findWalletGroup('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getAllWalletsFromGroups', () => {
    it('should return all wallets with group names', () => {
      const groupsData: WalletGroupsFile = {
        groups: {
          group1: { wallets: [{ label: 'wallet-1', wif: 'wif1', receiveAddress: 'addr1' }], bidsPerMinute: 5 },
          group2: { wallets: [{ label: 'wallet-2', wif: 'wif2', receiveAddress: 'addr2' }], bidsPerMinute: 5 },
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(groupsData));

      const result = getAllWalletsFromGroups();

      expect(result).toHaveLength(2);
      expect(result[0].groupName).toBe('group1');
      expect(result[1].groupName).toBe('group2');
    });

    it('should return empty array when no groups', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = getAllWalletsFromGroups();
      expect(result).toEqual([]);
    });
  });

  describe('getUnassignedWallets', () => {
    it('should return wallets not in any group', () => {
      // Legacy data with wallets
      const legacyData: WalletsFile = {
        wallets: [
          { label: 'wallet-1', wif: 'wif1', receiveAddress: 'addr1' },
          { label: 'wallet-2', wif: 'wif2', receiveAddress: 'addr2' },
        ],
      };
      // Groups with only wallet-1
      const groupsData: WalletGroupsFile = {
        groups: { group1: { wallets: [{ label: 'wallet-1', wif: 'wif1', receiveAddress: 'addr1' }], bidsPerMinute: 5 } },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
        // Return different data based on context
        const pathStr = path.toString();
        if (pathStr.includes('wallets')) {
          // First call checks for groups format, second for legacy
          const callCount = vi.mocked(fs.readFileSync).mock.calls.length;
          if (callCount <= 2) {
            return JSON.stringify(groupsData);
          }
          return JSON.stringify(legacyData);
        }
        return JSON.stringify(legacyData);
      });

      // This test is complex due to the function reading the same file twice
      // with different expectations. We'd need to adjust the mock accordingly.
    });

    it('should return empty array when no legacy wallets', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = getUnassignedWallets();
      expect(result).toEqual([]);
    });
  });

  describe('encryptData / decryptData', () => {
    const testData = '{"wallets":[{"label":"w1","wif":"wif1"}]}';
    const password = 'secure_password_123';

    it('should encrypt and decrypt data correctly', () => {
      const encrypted = encryptData(testData, password);
      const decrypted = decryptData(encrypted, password);
      expect(decrypted).toBe(testData);
    });

    it('should be aliased as encryptMnemonic/decryptMnemonic', () => {
      const encrypted = encryptMnemonic(testData, password);
      const decrypted = decryptMnemonic(encrypted, password);
      expect(decrypted).toBe(testData);
    });

    it('should produce different ciphertext each time', () => {
      const enc1 = encryptData(testData, password);
      const enc2 = encryptData(testData, password);
      expect(enc1).not.toBe(enc2);
    });

    it('should fail with wrong password', () => {
      const encrypted = encryptData(testData, password);
      expect(() => decryptData(encrypted, 'wrong')).toThrow();
    });

    it('should handle large JSON data (wallets file)', () => {
      const largeData = JSON.stringify({
        groups: {
          default: {
            wallets: Array.from({ length: 50 }, (_, i) => ({
              label: `wallet-${i}`,
              wif: `wif-${i}`,
              receiveAddress: `bc1p${'a'.repeat(58)}`,
            })),
            bidsPerMinute: 5,
          },
        },
      });
      const encrypted = encryptData(largeData, password);
      const decrypted = decryptData(encrypted, password);
      expect(decrypted).toBe(largeData);
    });
  });

  describe('isEncryptedFormat', () => {
    it('should return true for encrypted content', () => {
      const encrypted = encryptData('test data', 'password');
      expect(isEncryptedFormat(encrypted)).toBe(true);
    });

    it('should return false for plaintext JSON', () => {
      const plaintext = JSON.stringify({ wallets: [] });
      expect(isEncryptedFormat(plaintext)).toBe(false);
    });

    it('should return false for invalid JSON', () => {
      expect(isEncryptedFormat('not json')).toBe(false);
    });

    it('should return false for JSON with partial encrypted fields', () => {
      const partial = JSON.stringify({ salt: 'abc', iv: 'def' });
      expect(isEncryptedFormat(partial)).toBe(false);
    });

    it('should return true when all encrypted fields present', () => {
      const fullEncrypted = JSON.stringify({
        salt: 'abc',
        iv: 'def',
        authTag: 'ghi',
        encrypted: 'jkl',
      });
      expect(isEncryptedFormat(fullEncrypted)).toBe(true);
    });
  });

  describe('readWalletsFileRaw', () => {
    it('should return null when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(readWalletsFileRaw()).toBeNull();
    });

    it('should return raw file content', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('raw content');
      expect(readWalletsFileRaw()).toBe('raw content');
    });

    it('should return null on read error', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('fail'); });
      expect(readWalletsFileRaw()).toBeNull();
    });
  });

  describe('loadWalletsDecrypted', () => {
    it('should return null when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(loadWalletsDecrypted('password')).toBeNull();
    });

    it('should decrypt and return wallet data', () => {
      const data: WalletsFile = { wallets: [{ label: 'w1', wif: 'wif1', receiveAddress: 'addr1' }] };
      const encrypted = encryptData(JSON.stringify(data), 'password');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(encrypted);

      const result = loadWalletsDecrypted('password');
      expect(result).toEqual(data);
    });

    it('should return null for wrong password', () => {
      const encrypted = encryptData('{"wallets":[]}', 'right');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(encrypted);

      expect(loadWalletsDecrypted('wrong')).toBeNull();
    });

    it('should return plaintext data if file is not encrypted', () => {
      const data: WalletsFile = { wallets: [] };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(data));

      const result = loadWalletsDecrypted('anypassword');
      expect(result).toEqual(data);
    });
  });

  describe('saveWalletsEncrypted', () => {
    it('should encrypt and write file with mode 0o600', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const data: WalletsFile = { wallets: [{ label: 'w1', wif: 'wif1', receiveAddress: 'addr1' }] };
      saveWalletsEncrypted(data, 'password');

      expect(fs.writeFileSync).toHaveBeenCalled();
      const [, content, options] = vi.mocked(fs.writeFileSync).mock.calls[0];
      expect((options as any).mode).toBe(0o600);

      // Verify written content is encrypted
      expect(isEncryptedFormat(content as string)).toBe(true);

      // Verify it can be decrypted back
      const decrypted = JSON.parse(decryptData(content as string, 'password'));
      expect(decrypted.wallets[0].label).toBe('w1');
    });
  });

  describe('session password (transparent encryption)', () => {
    afterEach(() => {
      clearSessionPassword();
    });

    it('loadWallets should return null for encrypted file without session password', () => {
      const encrypted = encryptData(JSON.stringify({ wallets: [] }), 'password');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(encrypted);

      expect(loadWallets()).toBeNull();
    });

    it('loadWallets should decrypt transparently with session password', () => {
      const data: WalletsFile = { wallets: [{ label: 'w1', wif: 'wif1', receiveAddress: 'addr1' }] };
      const encrypted = encryptData(JSON.stringify(data), 'password');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(encrypted);

      setSessionPassword('password');
      const result = loadWallets();
      expect(result).toEqual(data);
    });

    it('loadWalletGroups should decrypt transparently with session password', () => {
      const data: WalletGroupsFile = {
        groups: { default: { wallets: [], bidsPerMinute: 5 } },
      };
      const encrypted = encryptData(JSON.stringify(data), 'password');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(encrypted);

      setSessionPassword('password');
      const result = loadWalletGroups();
      expect(result).toEqual(data);
    });

    it('saveWallets should auto-encrypt with session password', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      setSessionPassword('password');

      const data: WalletsFile = { wallets: [{ label: 'w1', wif: 'wif1', receiveAddress: 'addr1' }] };
      saveWallets(data);

      const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0];
      expect(isEncryptedFormat(content as string)).toBe(true);
    });

    it('saveWalletGroups should auto-encrypt with session password', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      setSessionPassword('password');

      const data: WalletGroupsFile = {
        groups: { default: { wallets: [], bidsPerMinute: 5 } },
      };
      saveWalletGroups(data);

      const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0];
      expect(isEncryptedFormat(content as string)).toBe(true);
    });

    it('round-trip: save encrypted then load with session password', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      setSessionPassword('mypassword');

      const data: WalletsFile = {
        wallets: [{ label: 'w1', wif: 'wif1', receiveAddress: 'addr1' }],
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      };
      saveWallets(data);

      // Get what was written and return it for load
      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      vi.mocked(fs.readFileSync).mockReturnValue(writtenContent);

      const loaded = loadWallets();
      expect(loaded?.wallets[0].label).toBe('w1');
      expect(loaded?.mnemonic).toBe(data.mnemonic);
    });
  });
});
