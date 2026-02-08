import * as fs from 'fs';
import * as path from 'path';
import {
  readWalletsFileRaw,
  isEncryptedFormat,
  encryptData,
  decryptData,
  saveWalletsEncrypted,
} from '../../services/WalletGenerator';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showInfo,
} from '../../utils/display';
import {
  promptPassword,
  promptConfirm,
} from '../../utils/prompts';
import { getErrorMessage } from '../../../utils/errorUtils';

/**
 * Remove specific keys from the .env file.
 * Reads the file, strips matching lines (^KEY=...), writes back with mode 0o600.
 */
function removeEnvKeys(keys: string[]): { removed: string[]; error?: string } {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return { removed: [], error: '.env file not found' };
  }

  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split('\n');
    const removed: string[] = [];

    const filtered = lines.filter((line) => {
      for (const key of keys) {
        // Match KEY=... (with optional leading whitespace)
        if (line.match(new RegExp(`^\\s*${key}\\s*=`))) {
          removed.push(key);
          return false;
        }
      }
      return true;
    });

    if (removed.length > 0) {
      fs.writeFileSync(envPath, filtered.join('\n'), { mode: 0o600 });
    }

    return { removed };
  } catch (error: unknown) {
    return { removed: [], error: getErrorMessage(error) };
  }
}

/**
 * Prompt user to remove migrated secrets from .env, then do it automatically.
 */
async function promptRemoveMigratedEnvKeys(migratedWif: boolean, migratedAddr: boolean): Promise<void> {
  const keysToRemove: string[] = [];
  if (migratedWif && process.env.FUNDING_WIF) keysToRemove.push('FUNDING_WIF');
  if (migratedAddr && process.env.TOKEN_RECEIVE_ADDRESS) keysToRemove.push('TOKEN_RECEIVE_ADDRESS');

  if (keysToRemove.length === 0) return;

  console.log('');
  const keyList = keysToRemove.join(' and ');
  const remove = await promptConfirm(
    `Remove ${keyList} from .env? (now stored in encrypted wallets.json)`,
    true
  );

  if (remove) {
    const result = removeEnvKeys(keysToRemove);
    if (result.error) {
      showWarning(`Could not remove from .env: ${result.error}`);
      showWarning(`Please manually remove ${keyList} from your .env file`);
    } else if (result.removed.length > 0) {
      showSuccess(`Removed ${result.removed.join(', ')} from .env`);
    }
  } else {
    showWarning(`Remember to manually remove ${keyList} from your .env file`);
  }
}

/**
 * Migrate FUNDING_WIF from .env into wallets.json data object.
 * Returns true if migration happened, false otherwise.
 */
async function migrateFundingWIF(data: any): Promise<boolean> {
  const fundingWif = process.env.FUNDING_WIF;
  if (!fundingWif) return false;

  // Already migrated
  if (data.fundingWallet?.wif) {
    if (data.fundingWallet.wif === fundingWif) {
      showInfo('FUNDING_WIF already present in wallets.json (matches .env)');
      return false;
    }
    // Different WIF — warn but don't overwrite
    showWarning('wallets.json already has a different fundingWallet.wif — skipping migration');
    return false;
  }

  console.log('');
  showInfo('Detected FUNDING_WIF in your .env file.');
  const migrate = await promptConfirm('Migrate FUNDING_WIF from .env into encrypted wallets.json?', true);
  if (!migrate) return false;

  data.fundingWallet = { wif: fundingWif, label: 'funding' };
  return true;
}

/**
 * Migrate TOKEN_RECEIVE_ADDRESS from .env into wallets.json data object.
 * Returns true if migration happened, false otherwise.
 */
async function migrateTokenReceiveAddress(data: any): Promise<boolean> {
  const receiveAddress = process.env.TOKEN_RECEIVE_ADDRESS;
  if (!receiveAddress) return false;

  // Already migrated
  if (data.fundingWallet?.receiveAddress) {
    if (data.fundingWallet.receiveAddress === receiveAddress) {
      showInfo('TOKEN_RECEIVE_ADDRESS already present in wallets.json (matches .env)');
      return false;
    }
    // Different address — warn but don't overwrite
    showWarning('wallets.json already has a different fundingWallet.receiveAddress — skipping migration');
    return false;
  }

  console.log('');
  showInfo('Detected TOKEN_RECEIVE_ADDRESS in your .env file.');
  const migrate = await promptConfirm('Migrate TOKEN_RECEIVE_ADDRESS from .env into encrypted wallets.json?', true);
  if (!migrate) return false;

  if (!data.fundingWallet) {
    data.fundingWallet = {};
  }
  data.fundingWallet.receiveAddress = receiveAddress;
  return true;
}

/**
 * Encrypt the wallets.json file (migration command)
 */
export async function encryptWalletsFile(): Promise<void> {
  showSectionHeader('ENCRYPT WALLETS FILE');

  const rawContent = readWalletsFileRaw();

  // Handle case: no wallets.json but FUNDING_WIF in .env
  if (!rawContent) {
    const fundingWif = process.env.FUNDING_WIF;
    if (fundingWif) {
      showInfo('No wallets.json found, but FUNDING_WIF detected in .env');
      const migrate = await promptConfirm('Create encrypted wallets.json with your FUNDING_WIF?', true);
      if (!migrate) return;

      const password = await promptPassword('Enter encryption password (min 8 chars):');
      if (password.length < 8) {
        showError('Password must be at least 8 characters');
        return;
      }
      const confirmPwd = await promptPassword('Confirm password:');
      if (password !== confirmPwd) {
        showError('Passwords do not match');
        return;
      }

      const data: any = { fundingWallet: { wif: fundingWif, label: 'funding' } };
      const receiveAddress = process.env.TOKEN_RECEIVE_ADDRESS;
      if (receiveAddress) {
        data.fundingWallet.receiveAddress = receiveAddress;
      }
      saveWalletsEncrypted(data, password);

      // Verify
      const verifyRaw = readWalletsFileRaw();
      if (!verifyRaw) {
        showError('Failed to read back encrypted file');
        return;
      }
      try {
        const verifyDecrypted = decryptData(verifyRaw, password);
        const verifyData = JSON.parse(verifyDecrypted);
        if (!verifyData.fundingWallet?.wif) {
          throw new Error('Missing fundingWallet after decryption');
        }
      } catch {
        showError('Verification failed! Removing created file...');
        const walletsPath = path.join(process.cwd(), 'config/wallets.json');
        if (fs.existsSync(walletsPath)) fs.unlinkSync(walletsPath);
        return;
      }

      showSuccess('Wallets file created and encrypted!');
      await promptRemoveMigratedEnvKeys(true, !!receiveAddress);
      console.log('');
      console.log('Important:');
      console.log('  - Remember your password — there is no recovery without it');
      console.log('  - You will be prompted for the password at bot startup');
      console.log('');
      return;
    }

    showError('No wallets.json file found at config/wallets.json');
    return;
  }

  if (isEncryptedFormat(rawContent)) {
    showInfo('Wallets file is already encrypted.');
    console.log('');

    const reEncrypt = await promptConfirm('Re-encrypt with a new password?', false);
    if (!reEncrypt) {
      return;
    }

    // Decrypt first with current password
    const currentPassword = await promptPassword('Enter current password:');
    let decrypted: string;
    try {
      decrypted = decryptData(rawContent, currentPassword);
      // Verify it's valid JSON
      JSON.parse(decrypted);
    } catch {
      showError('Wrong password. Could not decrypt.');
      return;
    }

    // Check if FUNDING_WIF / TOKEN_RECEIVE_ADDRESS should be migrated into re-encrypted data
    const data = JSON.parse(decrypted);
    const migratedWif = await migrateFundingWIF(data);
    const migratedAddr = await migrateTokenReceiveAddress(data);
    const migrated = migratedWif || migratedAddr;

    // Get new password
    const newPassword = await promptPassword('Enter new encryption password (min 8 chars):');
    if (newPassword.length < 8) {
      showError('Password must be at least 8 characters');
      return;
    }

    const confirmPassword = await promptPassword('Confirm new password:');
    if (newPassword !== confirmPassword) {
      showError('Passwords do not match');
      return;
    }

    // Re-encrypt with new password
    saveWalletsEncrypted(data, newPassword);

    // Verify the new encryption works
    const verifyRaw = readWalletsFileRaw();
    if (!verifyRaw) {
      showError('Failed to read back encrypted file');
      return;
    }
    try {
      const verifyDecrypted = decryptData(verifyRaw, newPassword);
      JSON.parse(verifyDecrypted);
    } catch {
      showError('Verification failed! Restoring original file...');
      const dir = require('path').dirname(require('path').join(process.cwd(), 'config/wallets.json'));
      fs.writeFileSync(require('path').join(dir, '../config/wallets.json'), rawContent, { mode: 0o600 });
      return;
    }

    showSuccess('Wallets file re-encrypted with new password');
    if (migrated) {
      console.log('');
      if (migratedWif) showSuccess('FUNDING_WIF migrated into encrypted wallets.json');
      if (migratedAddr) showSuccess('TOKEN_RECEIVE_ADDRESS migrated into encrypted wallets.json');
      await promptRemoveMigratedEnvKeys(migratedWif, migratedAddr);
    }
    return;
  }

  // File is plaintext — encrypt it
  let data: any;
  try {
    data = JSON.parse(rawContent);
  } catch {
    showError('wallets.json contains invalid JSON');
    return;
  }

  const walletCount = data.groups
    ? Object.values(data.groups).reduce((sum: number, g: any) => sum + (g.wallets?.length || 0), 0)
    : data.wallets?.length || 0;

  console.log(`Found ${walletCount} wallet(s) in plaintext wallets.json`);
  console.log('');
  showWarning('This will encrypt the entire wallets.json file with a password.');
  showWarning('You will need this password every time you start the bot or use manage commands.');
  console.log('');

  // Migrate FUNDING_WIF and TOKEN_RECEIVE_ADDRESS from .env before encrypting
  const migratedWif = await migrateFundingWIF(data);
  const migratedAddr = await migrateTokenReceiveAddress(data);
  const migrated = migratedWif || migratedAddr;

  const proceed = await promptConfirm('Encrypt wallets file?', true);
  if (!proceed) {
    return;
  }

  const password = await promptPassword('Enter encryption password (min 8 chars):');
  if (password.length < 8) {
    showError('Password must be at least 8 characters');
    return;
  }

  const confirmPassword = await promptPassword('Confirm password:');
  if (password !== confirmPassword) {
    showError('Passwords do not match');
    return;
  }

  // Encrypt and save
  saveWalletsEncrypted(data, password);

  // Verify decryption works before declaring success
  const verifyRaw = readWalletsFileRaw();
  if (!verifyRaw) {
    showError('Failed to read back encrypted file');
    return;
  }

  try {
    const verifyDecrypted = decryptData(verifyRaw, password);
    const verifyData = JSON.parse(verifyDecrypted);

    // Basic sanity check
    const hasContent = verifyData.groups || verifyData.wallets || verifyData.fundingWallet;
    if (!hasContent) {
      throw new Error('Decrypted data missing expected fields');
    }
  } catch {
    showError('Verification failed! Restoring original plaintext file...');
    fs.writeFileSync(
      require('path').join(process.cwd(), 'config/wallets.json'),
      rawContent,
      { mode: 0o600 }
    );
    return;
  }

  showSuccess('Wallets file encrypted successfully!');
  if (migratedWif) {
    showSuccess('FUNDING_WIF migrated into encrypted wallets.json');
  }
  if (migratedAddr) {
    showSuccess('TOKEN_RECEIVE_ADDRESS migrated into encrypted wallets.json');
  }
  if (migrated) {
    await promptRemoveMigratedEnvKeys(migratedWif, migratedAddr);
  }
  console.log('');
  console.log('Important:');
  console.log('  - Remember your password — there is no recovery without it');
  console.log('  - You will be prompted for the password at bot startup');
  console.log('  - Manage commands will also prompt for the password');
  console.log('');
}
