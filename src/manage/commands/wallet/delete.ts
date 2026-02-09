import {
  loadWallets,
  isGroupsFormat,
  removeWalletFromConfig,
  removeWalletFromGroup,
  findWalletGroup,
} from '../../services/WalletGenerator';
import { getWalletsWithBalances, WalletWithBalance } from './list';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  formatBTC,
} from '../../utils/display';
import { promptMultiSelect, promptConfirm } from '../../utils/prompts';
import { ensureWalletPasswordIfNeeded } from '../../utils/walletPassword';

/**
 * Delete wallets from config/wallets.json
 */
export async function deleteWalletsCommand(): Promise<void> {
  showSectionHeader('DELETE WALLETS');

  // Ensure encryption password is available if wallets.json is encrypted
  if (!(await ensureWalletPasswordIfNeeded())) {
    return;
  }

  // Fetch wallets with balances
  const allWallets = await getWalletsWithBalances();

  // Filter out Main Wallet (lives in .env, not config file)
  const configWallets = allWallets.filter(w => w.label !== 'Main Wallet');

  if (configWallets.length === 0) {
    showError('No config wallets found to delete.');
    return;
  }

  // Determine format for group info
  const walletsData = loadWallets();
  const groupsFormat = walletsData ? isGroupsFormat(walletsData) : false;

  // Build multi-select choices
  const choices = configWallets.map(w => {
    const balanceStr = formatBTC(w.balance.total);
    const groupInfo = groupsFormat ? (() => {
      const group = findWalletGroup(w.label);
      return group ? ` [${group}]` : '';
    })() : '';
    return {
      name: `${w.label} (${w.paymentAddress.slice(0, 8)}...)${groupInfo} - ${balanceStr}`,
      value: w.label,
    };
  });

  const selected = await promptMultiSelect<string>(
    'Select wallets to delete:',
    choices
  );

  if (selected.length === 0) {
    showWarning('Cancelled');
    return;
  }

  // Show summary and warn about non-zero balances
  console.log('');
  console.log(`Selected ${selected.length} wallet(s) for deletion:`);
  const selectedWallets = configWallets.filter(w => selected.includes(w.label));
  for (const w of selectedWallets) {
    const balanceStr = formatBTC(w.balance.total);
    const groupInfo = groupsFormat ? (() => {
      const group = findWalletGroup(w.label);
      return group ? ` [${group}]` : '';
    })() : '';
    console.log(`  • ${w.label}${groupInfo} - ${balanceStr}`);
  }
  console.log('');

  // Warn about non-zero balances
  const walletsWithBalance = selectedWallets.filter(w => w.balance.total > 0);
  if (walletsWithBalance.length > 0) {
    showWarning(`${walletsWithBalance.length} wallet(s) have non-zero balance! Funds will be lost if not consolidated first.`);
    console.log('');
  }

  // Confirm
  const confirmed = await promptConfirm(
    `Delete ${selected.length} wallet(s)? This cannot be undone.`,
    false
  );

  if (!confirmed) {
    showWarning('Cancelled');
    return;
  }

  // Delete each wallet
  for (const label of selected) {
    if (groupsFormat) {
      const group = findWalletGroup(label);
      if (group) {
        const result = removeWalletFromGroup(group, label);
        if (result.success) {
          showSuccess(`Deleted "${label}" from group "${group}"`);
        } else {
          showError(`Failed to delete "${label}": ${result.error}`);
        }
      } else {
        showError(`Could not find group for wallet "${label}"`);
      }
    } else {
      const success = removeWalletFromConfig(label);
      if (success) {
        showSuccess(`Deleted "${label}"`);
      } else {
        showError(`Failed to delete "${label}"`);
      }
    }
  }
}
