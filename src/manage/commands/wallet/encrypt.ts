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

      const data = { fundingWallet: { wif: fundingWif, label: 'funding' } };
      saveWalletsEncrypted(data as any, password);

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

      showSuccess('Wallets file created and encrypted with FUNDING_WIF!');
      console.log('');
      console.log('Next steps:');
      console.log('  1. Remove FUNDING_WIF from your .env file');
      console.log('  2. Remember your password — there is no recovery without it');
      console.log('  3. You will be prompted for the password at bot startup');
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

    // Check if FUNDING_WIF should be migrated into re-encrypted data
    const data = JSON.parse(decrypted);
    const migrated = await migrateFundingWIF(data);

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
      showSuccess('FUNDING_WIF migrated into encrypted wallets.json');
      console.log('  → Remove FUNDING_WIF from your .env file');
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

  // Migrate FUNDING_WIF from .env before encrypting
  const migrated = await migrateFundingWIF(data);

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
  if (migrated) {
    showSuccess('FUNDING_WIF migrated into encrypted wallets.json');
  }
  console.log('');
  console.log('Important:');
  console.log('  - Remember your password — there is no recovery without it');
  console.log('  - You will be prompted for the password at bot startup');
  console.log('  - Manage commands will also prompt for the password');
  if (migrated) {
    console.log('  - Remove FUNDING_WIF from your .env file');
  }
  console.log('');
}
