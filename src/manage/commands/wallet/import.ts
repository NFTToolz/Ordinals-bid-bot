import * as fs from 'fs';
import {
  loadWallets,
  saveWallets,
  importWalletsFromBackup,
  WalletsFile,
  isGroupsFormat,
  getAllWalletsFromGroups,
} from '../../services/WalletGenerator';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showTable,
  showInfo,
} from '../../utils/display';
import {
  promptText,
  promptPassword,
  promptConfirm,
  promptSelect,
} from '../../utils/prompts';
import { ensureWalletPasswordIfNeeded } from '../../utils/walletPassword';

export async function importWalletsCommand(): Promise<void> {
  showSectionHeader('IMPORT WALLETS');

  // Ensure encryption password is available if wallets.json is encrypted
  if (!(await ensureWalletPasswordIfNeeded())) {
    return;
  }

  // Get import path
  const importPath = await promptText('Path to backup file (empty to cancel):');

  if (!importPath.trim()) {
    return;
  }

  if (!fs.existsSync(importPath)) {
    showError('File not found');
    return;
  }

  // Try plaintext JSON first, fall back to encrypted backup
  let imported: WalletsFile | null = null;

  try {
    const raw = fs.readFileSync(importPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.wallets || parsed.groups)) {
      imported = parsed;
      showInfo('Loaded plaintext backup.');
    }
  } catch {
    // Not valid JSON — try encrypted format
  }

  if (!imported) {
    const password = await promptPassword('Enter decryption password:');
    console.log('');
    console.log('Decrypting backup...');
    imported = importWalletsFromBackup(importPath, password);

    if (!imported) {
      showError('Failed to decrypt backup. Check your password.');
      return;
    }

    showSuccess('Backup decrypted successfully!');
  }
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

  // Get existing wallets from either format
  let existingWallets: Array<{ label: string; wif: string; receiveAddress: string }> = [];
  if (existing) {
    if (isGroupsFormat(existing)) {
      existingWallets = getAllWalletsFromGroups();
    } else if (existing.wallets?.length) {
      existingWallets = existing.wallets;
    }
  }

  if (existingWallets.length > 0) {
    console.log('');
    showWarning(`You have ${existingWallets.length} existing wallet(s)`);
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
      const mergedWallets = [...existingWallets];

      imported.wallets.forEach(importedWallet => {
        const exists = mergedWallets.some(
          w => w.label === importedWallet.label || w.wif === importedWallet.wif
        );

        if (!exists) {
          mergedWallets.push(importedWallet);
        }
      });

      const merged: WalletsFile = {
        wallets: mergedWallets,
        mnemonic: imported.mnemonic || existing?.mnemonic,
        encryptedMnemonic: imported.encryptedMnemonic || existing?.encryptedMnemonic,
      };

      saveWallets(merged);

      const newCount = mergedWallets.length - existingWallets.length;
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
