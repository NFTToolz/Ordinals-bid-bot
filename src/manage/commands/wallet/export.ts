import * as fs from 'fs';
import * as path from 'path';
import { loadWallets, exportWallets, isGroupsFormat, getAllWalletsFromGroups } from '../../services/WalletGenerator';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
} from '../../utils/display';
import {
  promptText,
  promptPassword,
  promptConfirm,
} from '../../utils/prompts';

export async function exportWalletsCommand(): Promise<void> {
  showSectionHeader('EXPORT/BACKUP WALLETS');

  const walletsData = loadWallets();
  let walletCount = 0;
  if (walletsData) {
    if (isGroupsFormat(walletsData)) {
      walletCount = getAllWalletsFromGroups().length;
    } else if (walletsData.wallets?.length) {
      walletCount = walletsData.wallets.length;
    }
  }

  if (walletCount === 0) {
    showError('No wallets found to export');
    return;
  }

  console.log(`Found ${walletCount} wallet(s) to export.`);
  console.log('');

  // Get export path
  const defaultPath = path.join(process.cwd(), 'wallets-backup.enc');
  const exportPath = await promptText('Export file path (empty to cancel):', defaultPath);

  if (!exportPath.trim()) {
    return;
  }

  // Check if file exists
  if (fs.existsSync(exportPath)) {
    const overwrite = await promptConfirm('File exists. Overwrite?', false);
    if (!overwrite) {
      showWarning('Export cancelled');
      return;
    }
  }

  // Get encryption password
  const password = await promptPassword('Enter encryption password:');

  if (password.length < 8) {
    showError('Password must be at least 8 characters');
    return;
  }

  const confirmPassword = await promptPassword('Confirm password:');

  if (password !== confirmPassword) {
    showError('Passwords do not match');
    return;
  }

  // Export
  try {
    const success = exportWallets(exportPath, password);

    if (success) {
      showSuccess(`Wallets exported to: ${exportPath}`);
      console.log('');
      console.log('This file contains:');
      console.log(`  • ${walletCount} wallet(s)`);
      if (walletsData && (walletsData.mnemonic || walletsData.encryptedMnemonic)) {
        console.log('  • Master mnemonic (for wallet recovery)');
      }
      console.log('');
      console.log('Keep this backup file safe and remember your password!');
    } else {
      showError('Failed to export wallets');
    }
  } catch (error: any) {
    showError(`Export failed: ${error.message}`);
  }
}
