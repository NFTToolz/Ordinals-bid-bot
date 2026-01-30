import * as fs from 'fs';
import {
  loadWallets,
  saveWallets,
  importWalletsFromBackup,
  WalletsFile,
} from '../../services/WalletGenerator';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showTable,
} from '../../utils/display';
import {
  promptText,
  promptPassword,
  promptConfirm,
  promptSelect,
} from '../../utils/prompts';

export async function importWalletsCommand(): Promise<void> {
  showSectionHeader('IMPORT WALLETS');

  // Get import path
  const importPath = await promptText('Path to backup file:');

  if (!fs.existsSync(importPath)) {
    showError('File not found');
    return;
  }

  // Get decryption password
  const password = await promptPassword('Enter decryption password:');

  // Import
  console.log('');
  console.log('Decrypting backup...');

  const imported = importWalletsFromBackup(importPath, password);

  if (!imported) {
    showError('Failed to decrypt backup. Check your password.');
    return;
  }

  console.log('');
  showSuccess('Backup decrypted successfully!');
  console.log('');

  // Show what's in the backup
  console.log('Backup contains:');
  console.log(`  • ${imported.wallets.length} wallet(s)`);
  if (imported.mnemonic || imported.encryptedMnemonic) {
    console.log('  • Master mnemonic');
  }
  console.log('');

  // Show wallet list
  const headers = ['Label', 'Receive Address'];
  const rows = imported.wallets.map(w => [
    w.label,
    w.receiveAddress.slice(0, 12) + '...' + w.receiveAddress.slice(-8),
  ]);

  showTable(headers, rows);

  // Check for existing wallets
  const existing = loadWallets();

  if (existing && existing.wallets.length > 0) {
    console.log('');
    showWarning(`You have ${existing.wallets.length} existing wallet(s)`);
    console.log('');

    const action = await promptSelect<'merge' | 'replace' | 'cancel'>(
      'What would you like to do?',
      [
        { name: 'Merge with existing wallets', value: 'merge' },
        { name: 'Replace all existing wallets', value: 'replace' },
        { name: 'Cancel', value: 'cancel' },
      ]
    );

    if (action === 'cancel') {
      showWarning('Import cancelled');
      return;
    }

    if (action === 'merge') {
      // Merge wallets
      const mergedWallets = [...existing.wallets];

      imported.wallets.forEach(importedWallet => {
        const exists = mergedWallets.some(
          w => w.label === importedWallet.label || w.wif === importedWallet.wif
        );

        if (!exists) {
          mergedWallets.push(importedWallet);
        }
      });

      const merged: WalletsFile = {
        ...existing,
        wallets: mergedWallets,
        mnemonic: imported.mnemonic || existing.mnemonic,
        encryptedMnemonic: imported.encryptedMnemonic || existing.encryptedMnemonic,
      };

      saveWallets(merged);

      const newCount = mergedWallets.length - existing.wallets.length;
      showSuccess(`Import complete! Added ${newCount} new wallet(s).`);
      console.log(`Total wallets: ${mergedWallets.length}`);
    } else {
      // Replace
      const confirm = await promptConfirm(
        'This will delete all existing wallets. Are you sure?',
        false
      );

      if (!confirm) {
        showWarning('Import cancelled');
        return;
      }

      saveWallets(imported);
      showSuccess(`Import complete! Replaced with ${imported.wallets.length} wallet(s).`);
    }
  } else {
    // No existing wallets, just save
    saveWallets(imported);
    showSuccess(`Import complete! Added ${imported.wallets.length} wallet(s).`);
  }

  console.log('');
}
