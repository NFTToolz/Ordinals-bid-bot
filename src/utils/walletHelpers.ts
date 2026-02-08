/**
 * Shared wallet helper functions for checking wallet ownership across the codebase.
 * These functions check the primary wallet, wallet group manager, and legacy wallet pool
 * to determine if an address belongs to one of our wallets.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import { config } from 'dotenv';
import fs from 'fs';
import {
  isWalletPoolInitialized,
  getWalletPool,
} from './walletPool';
import {
  isWalletGroupManagerInitialized,
  getWalletGroupManager,
} from './walletGroups';
import { getFundingWIF, hasFundingWIF } from './fundingWallet';

config();

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

const TOKEN_RECEIVE_ADDRESS = process.env.TOKEN_RECEIVE_ADDRESS as string;
const ENABLE_WALLET_ROTATION = process.env.ENABLE_WALLET_ROTATION === 'true';
const WALLET_CONFIG_PATH = process.env.WALLET_CONFIG_PATH || './config/wallets.json';
const network = bitcoin.networks.bitcoin;

// Cache the primary payment address to avoid repeated derivation
let cachedPrimaryPaymentAddress: string | null = null;

/**
 * Get the primary payment address derived from FUNDING_WIF
 * Returns null if FUNDING_WIF is not configured or invalid
 */
function getPrimaryPaymentAddress(): string | null {
  if (cachedPrimaryPaymentAddress !== null) {
    return cachedPrimaryPaymentAddress;
  }

  if (!hasFundingWIF()) {
    return null;
  }

  try {
    const wif = getFundingWIF();
    const keyPair = ECPair.fromWIF(wif, network);
    cachedPrimaryPaymentAddress = bitcoin.payments.p2wpkh({
      pubkey: keyPair.publicKey,
      network: network,
    }).address as string;
    return cachedPrimaryPaymentAddress;
  } catch {
    return null;
  }
}

/**
 * Check if a payment address belongs to one of our wallets.
 * Checks:
 * 1. Primary wallet (derived from FUNDING_WIF)
 * 2. Wallet group manager (if ENABLE_WALLET_ROTATION is enabled)
 * 3. Legacy wallet pool (if enabled)
 *
 * @param address - The payment address to check
 * @returns true if the address belongs to one of our wallets
 */
export function isOurPaymentAddress(address: string): boolean {
  if (!address) return false;
  const normalizedAddress = address.toLowerCase();

  // Check primary wallet (derived from FUNDING_WIF)
  const primaryAddress = getPrimaryPaymentAddress();
  if (primaryAddress && normalizedAddress === primaryAddress.toLowerCase()) {
    return true;
  }

  // Check wallet group manager (if enabled)
  if (ENABLE_WALLET_ROTATION && isWalletGroupManagerInitialized()) {
    const manager = getWalletGroupManager();
    const allAddresses = manager.getAllPaymentAddresses();
    if (allAddresses.some(addr => addr.toLowerCase() === normalizedAddress)) {
      return true;
    }
  }

  // Check legacy wallet pool (if enabled)
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    const pool = getWalletPool();
    const allAddresses = pool.getAllPaymentAddresses();
    if (allAddresses.some(addr => addr.toLowerCase() === normalizedAddress)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a receive address belongs to one of our wallets.
 * Checks:
 * 1. Primary receive address from TOKEN_RECEIVE_ADDRESS
 * 2. Wallet group manager (if ENABLE_WALLET_ROTATION is enabled)
 * 3. Legacy wallet pool (if enabled)
 *
 * @param address - The receive address to check
 * @returns true if the address belongs to one of our wallets
 */
export function isOurReceiveAddress(address: string): boolean {
  if (!address) return false;
  const normalizedAddress = address.toLowerCase();

  // Check primary receive address from env
  if (TOKEN_RECEIVE_ADDRESS && normalizedAddress === TOKEN_RECEIVE_ADDRESS.toLowerCase()) {
    return true;
  }

  // Check wallet group manager (if enabled)
  if (ENABLE_WALLET_ROTATION && isWalletGroupManagerInitialized()) {
    const manager = getWalletGroupManager();
    const allAddresses = manager.getAllReceiveAddresses();
    if (allAddresses.some(addr => addr.toLowerCase() === normalizedAddress)) {
      return true;
    }
  }

  // Check legacy wallet pool (if enabled)
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    const pool = getWalletPool();
    const allAddresses = pool.getAllReceiveAddresses();
    if (allAddresses.some(addr => addr.toLowerCase() === normalizedAddress)) {
      return true;
    }
  }

  return false;
}

/**
 * Get a Set of all our payment addresses (lowercase) for efficient batch lookups.
 * Includes:
 * 1. Primary wallet (derived from FUNDING_WIF)
 * 2. All wallets from wallet group manager (if enabled)
 * 3. All wallets from legacy wallet pool (if enabled)
 *
 * @returns Set of lowercase payment addresses
 */
export function getAllOurPaymentAddresses(): Set<string> {
  const addresses = new Set<string>();

  // Add primary wallet
  const primaryAddress = getPrimaryPaymentAddress();
  if (primaryAddress) {
    addresses.add(primaryAddress.toLowerCase());
  }

  // Add wallet group manager addresses
  if (ENABLE_WALLET_ROTATION && isWalletGroupManagerInitialized()) {
    const manager = getWalletGroupManager();
    for (const addr of manager.getAllPaymentAddresses()) {
      addresses.add(addr.toLowerCase());
    }
  }

  // Add legacy wallet pool addresses
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    const pool = getWalletPool();
    for (const addr of pool.getAllPaymentAddresses()) {
      addresses.add(addr.toLowerCase());
    }
  }

  return addresses;
}

/**
 * Get a Set of all our receive addresses (lowercase) for efficient batch lookups.
 * Includes:
 * 1. Primary receive address from TOKEN_RECEIVE_ADDRESS
 * 2. All wallets from wallet group manager (if enabled)
 * 3. All wallets from legacy wallet pool (if enabled)
 *
 * @returns Set of lowercase receive addresses
 */
export function getAllOurReceiveAddresses(): Set<string> {
  const addresses = new Set<string>();

  // Add primary receive address
  if (TOKEN_RECEIVE_ADDRESS) {
    addresses.add(TOKEN_RECEIVE_ADDRESS.toLowerCase());
  }

  // Add wallet group manager addresses
  if (ENABLE_WALLET_ROTATION && isWalletGroupManagerInitialized()) {
    const manager = getWalletGroupManager();
    for (const addr of manager.getAllReceiveAddresses()) {
      addresses.add(addr.toLowerCase());
    }
  }

  // Add legacy wallet pool addresses
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    const pool = getWalletPool();
    for (const addr of pool.getAllReceiveAddresses()) {
      addresses.add(addr.toLowerCase());
    }
  }

  return addresses;
}

/**
 * Get all payment addresses with their associated wallet info for cancellation.
 * This returns all addresses along with their private keys for signing cancellations.
 * Reads directly from wallet config file to get all wallet credentials.
 *
 * @returns Array of wallet info with payment address, receive address, and private key
 */
export function getAllWalletCredentialsForCancellation(): Array<{
  paymentAddress: string;
  receiveAddress: string;
  privateKey: string;
  publicKey: string;
  label?: string;
}> {
  const wallets: Array<{
    paymentAddress: string;
    receiveAddress: string;
    privateKey: string;
    publicKey: string;
    label?: string;
  }> = [];
  const seenPaymentAddresses = new Set<string>();

  // Add primary wallet
  if (hasFundingWIF() && TOKEN_RECEIVE_ADDRESS) {
    try {
      const fundingWif = getFundingWIF();
      const keyPair = ECPair.fromWIF(fundingWif, network);
      const paymentAddress = bitcoin.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network: network,
      }).address as string;

      if (!seenPaymentAddresses.has(paymentAddress.toLowerCase())) {
        wallets.push({
          paymentAddress,
          receiveAddress: TOKEN_RECEIVE_ADDRESS,
          privateKey: fundingWif,
          publicKey: keyPair.publicKey.toString('hex'),
          label: 'primary',
        });
        seenPaymentAddresses.add(paymentAddress.toLowerCase());
      }
    } catch {
      // Invalid primary WIF, skip
    }
  }

  // Add wallets from config file if wallet rotation is enabled
  if (ENABLE_WALLET_ROTATION && fs.existsSync(WALLET_CONFIG_PATH)) {
    try {
      const walletConfig = JSON.parse(fs.readFileSync(WALLET_CONFIG_PATH, 'utf-8'));

      // Handle groups format
      if (walletConfig.groups && typeof walletConfig.groups === 'object') {
        for (const groupName of Object.keys(walletConfig.groups)) {
          const group = walletConfig.groups[groupName];
          for (const wallet of group.wallets || []) {
            try {
              const keyPair = ECPair.fromWIF(wallet.wif, network);
              const paymentAddress = bitcoin.payments.p2wpkh({
                pubkey: keyPair.publicKey,
                network: network,
              }).address as string;

              if (!seenPaymentAddresses.has(paymentAddress.toLowerCase())) {
                wallets.push({
                  paymentAddress,
                  receiveAddress: wallet.receiveAddress,
                  privateKey: wallet.wif,
                  publicKey: keyPair.publicKey.toString('hex'),
                  label: wallet.label,
                });
                seenPaymentAddresses.add(paymentAddress.toLowerCase());
              }
            } catch {
              // Invalid wallet WIF, skip
            }
          }
        }
      } else if (walletConfig.wallets && Array.isArray(walletConfig.wallets)) {
        // Legacy flat format
        for (const wallet of walletConfig.wallets) {
          try {
            const keyPair = ECPair.fromWIF(wallet.wif, network);
            const paymentAddress = bitcoin.payments.p2wpkh({
              pubkey: keyPair.publicKey,
              network: network,
            }).address as string;

            if (!seenPaymentAddresses.has(paymentAddress.toLowerCase())) {
              wallets.push({
                paymentAddress,
                receiveAddress: wallet.receiveAddress,
                privateKey: wallet.wif,
                publicKey: keyPair.publicKey.toString('hex'),
                label: wallet.label,
              });
              seenPaymentAddresses.add(paymentAddress.toLowerCase());
            }
          } catch {
            // Invalid wallet WIF, skip
          }
        }
      }
    } catch {
      // Failed to read wallet config, continue with primary wallet only
    }
  }

  return wallets;
}

// Module-level cache — built once on first call, reused for lifetime of process.
// Wallets don't change at runtime, so this is safe and avoids repeated disk I/O + EC key derivation.
let credentialsByAddress: Map<string, { privateKey: string; publicKey: string; receiveAddress: string }> | null = null;

/**
 * Look up wallet credentials by payment address for cross-wallet cancellation.
 * Uses a module-level Map cache built lazily from getAllWalletCredentialsForCancellation()
 * to avoid repeated disk I/O and EC key derivation on every call.
 *
 * @param paymentAddress - The payment address to look up
 * @returns Wallet credentials (privateKey, publicKey, receiveAddress) or undefined if not found
 */
export function getWalletCredentialsByPaymentAddress(
  paymentAddress: string
): { privateKey: string; publicKey: string; receiveAddress: string } | undefined {
  if (!paymentAddress) return undefined;

  // Build cache on first call
  if (!credentialsByAddress) {
    credentialsByAddress = new Map();
    for (const cred of getAllWalletCredentialsForCancellation()) {
      credentialsByAddress.set(cred.paymentAddress.toLowerCase(), {
        privateKey: cred.privateKey,
        publicKey: cred.publicKey,
        receiveAddress: cred.receiveAddress,
      });
    }
  }

  return credentialsByAddress.get(paymentAddress.toLowerCase());
}

/**
 * Clear the wallet credentials cache. Intended for testing only —
 * in production, wallets don't change at runtime.
 */
export function clearWalletCredentialsCache(): void {
  credentialsByAddress = null;
}
