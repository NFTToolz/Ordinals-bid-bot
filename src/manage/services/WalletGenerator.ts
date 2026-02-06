import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI } from 'ecpair';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const tinysecp = require('tiny-secp256k1');

// Initialize ECC library for bitcoinjs-lib (required for P2TR)
bitcoin.initEccLib(tinysecp);

const ECPair: ECPairAPI = ECPairFactory(tinysecp);
const bip32 = BIP32Factory(tinysecp);

export interface GeneratedWallet {
  label: string;
  wif: string;
  paymentAddress: string;    // bc1q... (P2WPKH - for payments)
  receiveAddress: string;    // bc1p... (P2TR - for ordinals)
  publicKey: string;
  derivationPath: string;
  index: number;
}

export interface WalletConfig {
  label: string;
  wif: string;
  receiveAddress: string;
}

export interface WalletsFile {
  mnemonic?: string;
  encryptedMnemonic?: string;
  wallets: WalletConfig[];
  bidsPerMinute?: number;
  createdAt?: string;
  lastModified?: string;
}

/**
 * Wallet group configuration
 */
export interface WalletGroupConfig {
  wallets: WalletConfig[];
  bidsPerMinute?: number;
}

/**
 * New wallet groups file format
 */
export interface WalletGroupsFile {
  groups: Record<string, WalletGroupConfig>;
  defaultGroup?: string;
  mnemonic?: string;
  encryptedMnemonic?: string;
  createdAt?: string;
  lastModified?: string;
}

const WALLETS_FILE_PATH = path.join(process.cwd(), 'config/wallets.json');

/**
 * Generate a new 12-word mnemonic
 */
export function generateMnemonic(): string {
  return bip39.generateMnemonic();
}

/**
 * Validate a mnemonic
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic);
}

/**
 * Derive wallets from mnemonic using BIP86 (P2TR) for receive address and BIP84 (P2WPKH) for payment
 */
export function deriveWallets(
  mnemonic: string,
  count: number,
  labelPrefix: string = 'wallet',
  startIndex: number = 0,
  network: bitcoin.Network = bitcoin.networks.bitcoin
): GeneratedWallet[] {
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic');
  }

  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed, network);

  const wallets: GeneratedWallet[] = [];

  for (let i = 0; i < count; i++) {
    const index = startIndex + i;

    // BIP84 path for P2WPKH (payment address): m/84'/0'/0'/0/index
    const paymentPath = `m/84'/0'/0'/0/${index}`;
    const paymentChild = root.derivePath(paymentPath);

    // BIP86 path for P2TR (receive address): m/86'/0'/0'/0/index
    const receivePath = `m/86'/0'/0'/0/${index}`;
    const receiveChild = root.derivePath(receivePath);

    // Generate payment address (P2WPKH - bc1q...)
    const paymentAddress = bitcoin.payments.p2wpkh({
      pubkey: paymentChild.publicKey,
      network,
    }).address!;

    // Generate receive address (P2TR - bc1p...)
    const receiveAddress = bitcoin.payments.p2tr({
      internalPubkey: receiveChild.publicKey.slice(1, 33), // x-only pubkey
      network,
    }).address!;

    // Get WIF from payment key (used for signing)
    const keyPair = ECPair.fromPrivateKey(paymentChild.privateKey!, { network });
    const wif = keyPair.toWIF();

    wallets.push({
      label: `${labelPrefix}-${index + 1}`,
      wif,
      paymentAddress,
      receiveAddress,
      publicKey: paymentChild.publicKey.toString('hex'),
      derivationPath: paymentPath,
      index,
    });
  }

  return wallets;
}

/**
 * Import a single wallet from WIF
 */
export function importFromWIF(
  wif: string,
  label: string,
  receiveAddress: string,
  network: bitcoin.Network = bitcoin.networks.bitcoin
): GeneratedWallet {
  const keyPair = ECPair.fromWIF(wif, network);

  const paymentAddress = bitcoin.payments.p2wpkh({
    pubkey: keyPair.publicKey,
    network,
  }).address!;

  return {
    label,
    wif,
    paymentAddress,
    receiveAddress,
    publicKey: keyPair.publicKey.toString('hex'),
    derivationPath: 'imported',
    index: -1,
  };
}

/**
 * Get wallet info from WIF (used for main wallet from .env)
 */
export function getWalletFromWIF(
  wif: string,
  network: bitcoin.Network = bitcoin.networks.bitcoin
): { paymentAddress: string; publicKey: string } {
  const keyPair = ECPair.fromWIF(wif, network);

  const paymentAddress = bitcoin.payments.p2wpkh({
    pubkey: keyPair.publicKey,
    network,
  }).address!;

  return {
    paymentAddress,
    publicKey: keyPair.publicKey.toString('hex'),
  };
}

/**
 * Encrypt mnemonic with password
 */
export function encryptMnemonic(mnemonic: string, password: string): string {
  const algorithm = 'aes-256-gcm';
  const salt = crypto.randomBytes(32);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(mnemonic, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    encrypted,
  });
}

/**
 * Decrypt mnemonic with password
 */
export function decryptMnemonic(encryptedData: string, password: string): string {
  const { salt, iv, authTag, encrypted } = JSON.parse(encryptedData);

  const algorithm = 'aes-256-gcm';
  const key = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256');

  const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Load wallets from config file
 */
export function loadWallets(): WalletsFile | null {
  try {
    if (!fs.existsSync(WALLETS_FILE_PATH)) {
      return null;
    }
    const content = fs.readFileSync(WALLETS_FILE_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Save wallets to config file
 */
export function saveWallets(data: WalletsFile): void {
  const dir = path.dirname(WALLETS_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  data.lastModified = new Date().toISOString();
  if (!data.createdAt) {
    data.createdAt = data.lastModified;
  }

  fs.writeFileSync(WALLETS_FILE_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/**
 * Add wallets to existing config
 */
export function addWalletsToConfig(
  newWallets: GeneratedWallet[],
  mnemonic?: string,
  encrypt: boolean = false,
  password?: string
): void {
  let existing = loadWallets() || {
    wallets: [],
    bidsPerMinute: 5,
  };

  // Add new wallets
  const walletConfigs: WalletConfig[] = newWallets.map(w => ({
    label: w.label,
    wif: w.wif,
    receiveAddress: w.receiveAddress,
  }));

  existing.wallets = [...existing.wallets, ...walletConfigs];

  // Store mnemonic if provided
  if (mnemonic) {
    if (encrypt && password) {
      existing.encryptedMnemonic = encryptMnemonic(mnemonic, password);
      delete existing.mnemonic;
    } else {
      existing.mnemonic = mnemonic;
      delete existing.encryptedMnemonic;
    }
  }

  saveWallets(existing);
}

/**
 * Remove wallet from config by label
 */
export function removeWalletFromConfig(label: string): boolean {
  const existing = loadWallets();
  if (!existing) return false;

  const initialCount = existing.wallets.length;
  existing.wallets = existing.wallets.filter(w => w.label !== label);

  if (existing.wallets.length === initialCount) {
    return false;
  }

  saveWallets(existing);
  return true;
}

/**
 * Get next wallet index from config
 */
export function getNextWalletIndex(): number {
  const existing = loadWallets();
  if (!existing || existing.wallets.length === 0) {
    return 0;
  }

  // Find the highest index in existing wallet labels
  let maxIndex = 0;
  existing.wallets.forEach(w => {
    const match = w.label.match(/-(\d+)$/);
    if (match) {
      const index = parseInt(match[1], 10);
      if (index > maxIndex) {
        maxIndex = index;
      }
    }
  });

  return maxIndex;
}

/**
 * Export wallets to encrypted backup file
 */
export function exportWallets(
  filePath: string,
  password: string
): boolean {
  const existing = loadWallets();
  if (!existing) return false;

  const encrypted = encryptMnemonic(JSON.stringify(existing), password);
  fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
  return true;
}

/**
 * Import wallets from encrypted backup file
 */
export function importWalletsFromBackup(
  filePath: string,
  password: string
): WalletsFile | null {
  try {
    const encrypted = fs.readFileSync(filePath, 'utf-8');
    const decrypted = decryptMnemonic(encrypted, password);
    return JSON.parse(decrypted);
  } catch (error) {
    return null;
  }
}

// ============================================================
// WALLET GROUPS MANAGEMENT
// ============================================================

/**
 * Check if the config file uses the new groups format
 */
export function isGroupsFormat(data: any): data is WalletGroupsFile {
  return data && typeof data.groups === 'object' && !Array.isArray(data.groups);
}

/**
 * Load wallet groups from config file
 * Returns null if file doesn't exist, or legacy format data if it's the old format
 */
export function loadWalletGroups(): WalletGroupsFile | null {
  try {
    if (!fs.existsSync(WALLETS_FILE_PATH)) {
      return null;
    }
    const content = fs.readFileSync(WALLETS_FILE_PATH, 'utf-8');
    const data = JSON.parse(content);

    // Check if it's already in groups format
    if (isGroupsFormat(data)) {
      return data;
    }

    // It's legacy format - return null to indicate migration needed
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Save wallet groups to config file
 */
export function saveWalletGroups(data: WalletGroupsFile): void {
  const dir = path.dirname(WALLETS_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  data.lastModified = new Date().toISOString();
  if (!data.createdAt) {
    data.createdAt = data.lastModified;
  }

  fs.writeFileSync(WALLETS_FILE_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/**
 * Migrate from legacy flat wallets format to new groups format
 * Creates a "default" group containing all existing wallets
 */
export function migrateToGroupsFormat(): WalletGroupsFile | null {
  const legacy = loadWallets();
  if (!legacy) {
    return null;
  }

  const groupsData: WalletGroupsFile = {
    groups: {
      default: {
        wallets: legacy.wallets,
        bidsPerMinute: legacy.bidsPerMinute || 5,
      },
    },
    defaultGroup: 'default',
    mnemonic: legacy.mnemonic,
    encryptedMnemonic: legacy.encryptedMnemonic,
    createdAt: legacy.createdAt,
    lastModified: new Date().toISOString(),
  };

  saveWalletGroups(groupsData);
  return groupsData;
}

/**
 * Create a new wallet group
 */
export function createWalletGroup(
  groupName: string,
  bidsPerMinute: number = 5
): boolean {
  let data = loadWalletGroups();

  // If no groups file exists, check for legacy and migrate
  if (!data) {
    const legacy = loadWallets();
    if (legacy && legacy.wallets.length > 0) {
      data = migrateToGroupsFormat();
    } else {
      // Start fresh
      data = {
        groups: {},
        createdAt: new Date().toISOString(),
      };
    }
  }

  if (!data) {
    data = {
      groups: {},
      createdAt: new Date().toISOString(),
    };
  }

  // Check if group already exists
  if (data.groups[groupName]) {
    return false;
  }

  data.groups[groupName] = {
    wallets: [],
    bidsPerMinute,
  };

  // If this is the first group, set it as default
  if (Object.keys(data.groups).length === 1) {
    data.defaultGroup = groupName;
  }

  saveWalletGroups(data);
  return true;
}

/**
 * Delete a wallet group (only if empty)
 */
export function deleteWalletGroup(groupName: string): { success: boolean; error?: string } {
  const data = loadWalletGroups();
  if (!data) {
    return { success: false, error: 'No wallet groups configured' };
  }

  if (!data.groups[groupName]) {
    return { success: false, error: `Group "${groupName}" not found` };
  }

  if (data.groups[groupName].wallets.length > 0) {
    return { success: false, error: `Group "${groupName}" is not empty. Remove all wallets first.` };
  }

  delete data.groups[groupName];

  // Update default group if deleted
  if (data.defaultGroup === groupName) {
    const remainingGroups = Object.keys(data.groups);
    data.defaultGroup = remainingGroups.length > 0 ? remainingGroups[0] : undefined;
  }

  saveWalletGroups(data);
  return { success: true };
}

/**
 * Add a wallet to a group
 * Returns false if wallet already exists in any group
 */
export function addWalletToGroup(
  groupName: string,
  wallet: WalletConfig
): { success: boolean; error?: string } {
  const data = loadWalletGroups();
  if (!data) {
    return { success: false, error: 'No wallet groups configured. Create a group first.' };
  }

  if (!data.groups[groupName]) {
    return { success: false, error: `Group "${groupName}" not found` };
  }

  // Check if wallet already exists in any group
  for (const [gName, group] of Object.entries(data.groups)) {
    const existing = group.wallets.find(
      w => w.wif === wallet.wif || w.receiveAddress.toLowerCase() === wallet.receiveAddress.toLowerCase()
    );
    if (existing) {
      return {
        success: false,
        error: `Wallet "${wallet.label}" already exists in group "${gName}"`,
      };
    }
  }

  data.groups[groupName].wallets.push(wallet);
  saveWalletGroups(data);
  return { success: true };
}

/**
 * Remove a wallet from a group by label
 */
export function removeWalletFromGroup(
  groupName: string,
  walletLabel: string
): { success: boolean; error?: string } {
  const data = loadWalletGroups();
  if (!data) {
    return { success: false, error: 'No wallet groups configured' };
  }

  if (!data.groups[groupName]) {
    return { success: false, error: `Group "${groupName}" not found` };
  }

  const initialCount = data.groups[groupName].wallets.length;
  data.groups[groupName].wallets = data.groups[groupName].wallets.filter(
    w => w.label !== walletLabel
  );

  if (data.groups[groupName].wallets.length === initialCount) {
    return { success: false, error: `Wallet "${walletLabel}" not found in group "${groupName}"` };
  }

  saveWalletGroups(data);
  return { success: true };
}

/**
 * Move a wallet from one group to another
 */
export function moveWalletToGroup(
  walletLabel: string,
  targetGroupName: string
): { success: boolean; error?: string } {
  const data = loadWalletGroups();
  if (!data) {
    return { success: false, error: 'No wallet groups configured' };
  }

  if (!data.groups[targetGroupName]) {
    return { success: false, error: `Target group "${targetGroupName}" not found` };
  }

  // Find wallet in any group
  let wallet: WalletConfig | null = null;
  let sourceGroup: string | null = null;

  for (const [gName, group] of Object.entries(data.groups)) {
    const found = group.wallets.find(w => w.label === walletLabel);
    if (found) {
      wallet = found;
      sourceGroup = gName;
      break;
    }
  }

  if (!wallet || !sourceGroup) {
    return { success: false, error: `Wallet "${walletLabel}" not found in any group` };
  }

  if (sourceGroup === targetGroupName) {
    return { success: false, error: `Wallet "${walletLabel}" is already in group "${targetGroupName}"` };
  }

  // Remove from source group
  data.groups[sourceGroup].wallets = data.groups[sourceGroup].wallets.filter(
    w => w.label !== walletLabel
  );

  // Add to target group
  data.groups[targetGroupName].wallets.push(wallet);

  saveWalletGroups(data);
  return { success: true };
}

/**
 * Get a specific wallet group
 */
export function getWalletGroup(groupName: string): WalletGroupConfig | null {
  const data = loadWalletGroups();
  if (!data || !data.groups[groupName]) {
    return null;
  }
  return data.groups[groupName];
}

/**
 * Get all wallet group names
 */
export function getWalletGroupNames(): string[] {
  const data = loadWalletGroups();
  if (!data) {
    return [];
  }
  return Object.keys(data.groups);
}

/**
 * Update bidsPerMinute for a group
 */
export function updateGroupBidsPerMinute(
  groupName: string,
  bidsPerMinute: number
): boolean {
  const data = loadWalletGroups();
  if (!data || !data.groups[groupName]) {
    return false;
  }

  data.groups[groupName].bidsPerMinute = bidsPerMinute;
  saveWalletGroups(data);
  return true;
}

/**
 * Set the default group
 */
export function setDefaultGroup(groupName: string): boolean {
  const data = loadWalletGroups();
  if (!data || !data.groups[groupName]) {
    return false;
  }

  data.defaultGroup = groupName;
  saveWalletGroups(data);
  return true;
}

/**
 * Find which group a wallet belongs to by label
 */
export function findWalletGroup(walletLabel: string): string | null {
  const data = loadWalletGroups();
  if (!data) return null;

  for (const [groupName, group] of Object.entries(data.groups)) {
    if (group.wallets.some(w => w.label === walletLabel)) {
      return groupName;
    }
  }
  return null;
}

/**
 * Get all wallets from all groups (flattened)
 */
export function getAllWalletsFromGroups(): Array<WalletConfig & { groupName: string }> {
  const data = loadWalletGroups();
  if (!data) return [];

  const allWallets: Array<WalletConfig & { groupName: string }> = [];
  for (const [groupName, group] of Object.entries(data.groups)) {
    for (const wallet of group.wallets) {
      allWallets.push({ ...wallet, groupName });
    }
  }
  return allWallets;
}

/**
 * Get wallets not assigned to any group (from legacy format)
 * Useful for migration scenarios
 */
export function getUnassignedWallets(): WalletConfig[] {
  const legacy = loadWallets();
  const groups = loadWalletGroups();

  if (!legacy || !legacy.wallets.length) {
    return [];
  }

  // If groups format exists, check which legacy wallets are not in any group
  if (groups) {
    const assignedWifs = new Set<string>();
    for (const group of Object.values(groups.groups)) {
      for (const wallet of group.wallets) {
        assignedWifs.add(wallet.wif);
      }
    }

    return legacy.wallets.filter(w => !assignedWifs.has(w.wif));
  }

  // No groups format - all legacy wallets are unassigned
  return legacy.wallets;
}
