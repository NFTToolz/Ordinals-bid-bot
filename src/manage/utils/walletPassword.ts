import {
  readWalletsFileRaw,
  isEncryptedFormat,
  loadWalletsDecrypted,
  setSessionPassword,
  clearSessionPassword,
  getSessionPassword,
} from '../services/WalletGenerator';
import { showError } from './display';
import { promptPassword } from './prompts';
import { setFundingWIF } from '../../utils/fundingWallet';

/**
 * Check if the wallets file is encrypted
 */
export function isWalletsFileEncrypted(): boolean {
  const raw = readWalletsFileRaw();
  if (!raw) return false;
  return isEncryptedFormat(raw);
}

/**
 * Ensure the session password is set if the wallets file is encrypted.
 * Prompts the user for the password if needed.
 * Also sets the funding WIF from decrypted data if present.
 * Returns true if ready (either not encrypted, or password obtained).
 * Returns false if user provided wrong password.
 */
export async function ensureWalletPasswordIfNeeded(): Promise<boolean> {
  if (!isWalletsFileEncrypted()) {
    return true;
  }

  // Already have a valid session password
  if (getSessionPassword()) {
    return true;
  }

  const password = await promptPassword('Enter wallets encryption password:');
  const data = loadWalletsDecrypted(password);

  if (!data) {
    showError('Wrong password or corrupted wallets file.');
    return false;
  }

  // Set the session password — all subsequent load/save calls will use it
  setSessionPassword(password);

  // Set funding WIF from decrypted wallet data if present
  const fundingWallet = (data as any).fundingWallet;
  if (fundingWallet?.wif) {
    setFundingWIF(fundingWallet.wif);
  }

  return true;
}

// Re-export for convenience
export { clearSessionPassword, getSessionPassword, setSessionPassword };
