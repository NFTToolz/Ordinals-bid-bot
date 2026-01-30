import * as fs from 'fs';
import * as path from 'path';
import { loadWallets, exportWallets } from '../../services/WalletGenerator';
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

  const walletsConfig = loadWallets();

  if (!walletsConfig || walletsConfig.wallets.length === 0) {
    showError('No wallets found to export');
    return;
  }

  console.log(`Found ${walletsConfig.wallets.length} wallet(s) to export.`);
  console.log('');

  // Get export path
  const defaultPath = path.join(process.cwd(), 'wallets-backup.enc');
  const exportPath = await promptText('Export file path:', defaultPath);

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
      console.log(`  • ${walletsConfig.wallets.length} wallet(s)`);
      if (walletsConfig.mnemonic || walletsConfig.encryptedMnemonic) {
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
