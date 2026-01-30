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

const WALLETS_FILE_PATH = path.join(process.cwd(), 'src/config/wallets.json');

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

  fs.writeFileSync(WALLETS_FILE_PATH, JSON.stringify(data, null, 2));
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
  fs.writeFileSync(filePath, encrypted);
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
