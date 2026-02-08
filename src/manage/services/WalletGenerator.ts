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

export interface FundingWalletConfig {
  wif: string;
  label?: string;
  receiveAddress?: string;
}

export interface WalletsFile {
  fundingWallet?: FundingWalletConfig;
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
  fundingWallet?: FundingWalletConfig;
  groups: Record<string, WalletGroupConfig>;
  defaultGroup?: string;
  mnemonic?: string;
  encryptedMnemonic?: string;
  createdAt?: string;
  lastModified?: string;
}

const WALLETS_FILE_PATH = path.join(process.cwd(), 'config/wallets.json');

/**
 * Module-level encryption session state.
 * When set, loadWallets/loadWalletGroups will decrypt transparently,
 * and saveWallets/saveWalletGroups will re-encrypt automatically.
 */
let sessionPassword: string | null = null;

/**
 * Set the session encryption password. All subsequent load/save operations
 * will decrypt/re-encrypt transparently using this password.
 */
export function setSessionPassword(password: string): void {
  sessionPassword = password;
}

/**
 * Clear the session password (e.g., on shutdown)
 */
export function clearSessionPassword(): void {
  sessionPassword = null;
}

/**
 * Get the current session password (for external use like bid.ts)
 */
export function getSessionPassword(): string | null {
  return sessionPassword;
}

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
 * Encrypt arbitrary data with password (AES-256-GCM + PBKDF2 100k iterations)
 */
export function encryptData(data: string, password: string): string {
  const algorithm = 'aes-256-gcm';
  const salt = crypto.randomBytes(32);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    encrypted,
  });
}

/** @deprecated Use encryptData instead */
export const encryptMnemonic = encryptData;

/**
 * Decrypt data with password (AES-256-GCM + PBKDF2 100k iterations)
 */
export function decryptData(encryptedData: string, password: string): string {
  const { salt, iv, authTag, encrypted } = JSON.parse(encryptedData);

  const algorithm = 'aes-256-gcm';
  const key = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256');

  const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/** @deprecated Use decryptData instead */
export const decryptMnemonic = decryptData;

/**
 * Check if file content is in encrypted format
 */
export function isEncryptedFormat(content: string): boolean {
  try {
    const parsed = JSON.parse(content);
    return !!(parsed.salt && parsed.iv && parsed.authTag && parsed.encrypted);
  } catch {
    return false;
  }
}

/**
 * Encrypt and save wallet data to wallets.json
 */
export function saveWalletsEncrypted(data: WalletsFile | WalletGroupsFile, password: string): void {
  const dir = path.dirname(WALLETS_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if ('wallets' in data && !('groups' in data)) {
    (data as WalletsFile).lastModified = new Date().toISOString();
    if (!(data as WalletsFile).createdAt) {
      (data as WalletsFile).createdAt = (data as WalletsFile).lastModified;
    }
  } else {
    (data as WalletGroupsFile).lastModified = new Date().toISOString();
    if (!(data as WalletGroupsFile).createdAt) {
      (data as WalletGroupsFile).createdAt = (data as WalletGroupsFile).lastModified;
    }
  }

  const plaintext = JSON.stringify(data, null, 2);
  const encrypted = encryptData(plaintext, password);
  fs.writeFileSync(WALLETS_FILE_PATH, encrypted, { mode: 0o600 });
}

/**
 * Load and decrypt wallets.json. Returns parsed object or null on failure.
 * If file is not encrypted, returns parsed JSON directly.
 */
export function loadWalletsDecrypted(password: string): WalletsFile | WalletGroupsFile | null {
  try {
    if (!fs.existsSync(WALLETS_FILE_PATH)) {
      return null;
    }
    const content = fs.readFileSync(WALLETS_FILE_PATH, 'utf-8');
    if (isEncryptedFormat(content)) {
      const decrypted = decryptData(content, password);
      return JSON.parse(decrypted);
    }
    // Not encrypted — return parsed directly
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Read raw wallets.json content (for encryption detection)
 */
export function readWalletsFileRaw(): string | null {
  try {
    if (!fs.existsSync(WALLETS_FILE_PATH)) {
      return null;
    }
    return fs.readFileSync(WALLETS_FILE_PATH, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Load the fundingWallet config from wallets.json (decrypting if needed).
 * Returns null if file doesn't exist, has no fundingWallet, or decryption fails.
 */
export function loadFundingWalletFromConfig(): FundingWalletConfig | null {
  try {
    if (!fs.existsSync(WALLETS_FILE_PATH)) {
      return null;
    }
    const content = fs.readFileSync(WALLETS_FILE_PATH, 'utf-8');
    let data: any;
    if (isEncryptedFormat(content)) {
      if (sessionPassword) {
        const decrypted = decryptData(content, sessionPassword);
        data = JSON.parse(decrypted);
      } else {
        return null;
      }
    } else {
      data = JSON.parse(content);
    }
    return data?.fundingWallet || null;
  } catch {
    return null;
  }
}

/**
 * Load wallets from config file.
 * If file is encrypted and sessionPassword is set, decrypts transparently.
 * Returns null if file is encrypted with no session password.
 */
export function loadWallets(): WalletsFile | null {
  try {
    if (!fs.existsSync(WALLETS_FILE_PATH)) {
      return null;
    }
    const content = fs.readFileSync(WALLETS_FILE_PATH, 'utf-8');
    if (isEncryptedFormat(content)) {
      if (sessionPassword) {
        const decrypted = decryptData(content, sessionPassword);
        return JSON.parse(decrypted);
      }
      return null;
    }
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Save wallets to config file.
 * If password is provided or sessionPassword is set, encrypts the entire file.
 */
export function saveWallets(data: WalletsFile, password?: string): void {
  const effectivePassword = password || sessionPassword;
  if (effectivePassword) {
    saveWalletsEncrypted(data, effectivePassword);
    return;
  }

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
      existing.encryptedMnemonic = encryptData(mnemonic, password);
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
 * Export wallets to backup file (plaintext JSON or encrypted)
 */
export function exportWallets(filePath: string, password?: string): boolean {
  const existing = loadWallets();
  if (!existing) return false;

  const content = password
    ? encryptData(JSON.stringify(existing), password)
    : JSON.stringify(existing, null, 2);
  fs.writeFileSync(filePath, content, { mode: 0o600 });
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
    const decrypted = decryptData(encrypted, password);
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
 * Load wallet groups from config file.
 * If file is encrypted and sessionPassword is set, decrypts transparently.
 * Returns null if file doesn't exist, encrypted without password, or legacy format.
 */
export function loadWalletGroups(): WalletGroupsFile | null {
  try {
    if (!fs.existsSync(WALLETS_FILE_PATH)) {
      return null;
    }
    const content = fs.readFileSync(WALLETS_FILE_PATH, 'utf-8');
    let data: any;

    if (isEncryptedFormat(content)) {
      if (sessionPassword) {
        const decrypted = decryptData(content, sessionPassword);
        data = JSON.parse(decrypted);
      } else {
        return null;
      }
    } else {
      data = JSON.parse(content);
    }

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
 * Save wallet groups to config file.
 * If password is provided or sessionPassword is set, encrypts the entire file.
 */
export function saveWalletGroups(data: WalletGroupsFile, password?: string): void {
  const effectivePassword = password || sessionPassword;
  if (effectivePassword) {
    saveWalletsEncrypted(data, effectivePassword);
    return;
  }

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
  wallet: WalletConfig,
  fundingWif?: string
): { success: boolean; error?: string } {
  const data = loadWalletGroups();
  if (!data) {
    return { success: false, error: 'No wallet groups configured. Create a group first.' };
  }

  if (!data.groups[groupName]) {
    return { success: false, error: `Group "${groupName}" not found` };
  }

  // Reject wallets that duplicate the main FUNDING_WIF
  if (fundingWif && wallet.wif === fundingWif) {
    return {
      success: false,
      error: `Wallet "${wallet.label}" has the same private key as FUNDING_WIF and cannot be added to a group`,
    };
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
