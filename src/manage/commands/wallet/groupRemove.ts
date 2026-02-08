import {
  loadWalletGroups,
  removeWalletFromGroup,
  deleteWalletGroup,
  getWalletGroupNames,
} from '../../services/WalletGenerator';
import { getCollectionsByGroup } from '../../services/CollectionService';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showInfo,
} from '../../utils/display';
import {
  promptSelect,
  promptConfirm,
} from '../../utils/prompts';
import { ensureWalletPasswordIfNeeded } from '../../utils/walletPassword';

/**
 * Remove a wallet from a group
 */
export async function removeWalletFromGroupCommand(): Promise<void> {
  showSectionHeader('REMOVE WALLET FROM GROUP');

  // Ensure encryption password is available if wallets.json is encrypted
  if (!(await ensureWalletPasswordIfNeeded())) {
    return;
  }

  const groupsData = loadWalletGroups();
  const groupNames = getWalletGroupNames();

  if (groupNames.length === 0) {
    showError('No wallet groups exist.');
    return;
  }

  // Select group
  const groupChoices = groupNames.map(name => ({
    name: `${name} (${groupsData?.groups[name]?.wallets?.length || 0} wallets)`,
    value: name,
  }));
  groupChoices.push({ name: '← Back', value: '__cancel__' });

  const selectedGroup = await promptSelect<string>(
    'Select group:',
    groupChoices
  );

  if (selectedGroup === '__cancel__') {
    return;
  }

  const group = groupsData?.groups[selectedGroup];
  if (!group || group.wallets.length === 0) {
    showWarning(`Group "${selectedGroup}" has no wallets to remove.`);
    return;
  }

  // Select wallet to remove
  const walletChoices = group.wallets.map(w => ({
    name: `${w.label} (${w.receiveAddress.slice(0, 12)}...)`,
    value: w.label,
  }));

  walletChoices.push({ name: 'Cancel', value: '' });

  const selectedWallet = await promptSelect<string>(
    'Select wallet to remove:',
    walletChoices
  );

  if (!selectedWallet) {
    return;
  }

  // Confirm removal
  const confirm = await promptConfirm(
    `Are you sure you want to remove "${selectedWallet}" from "${selectedGroup}"?`,
    false
  );

  if (!confirm) {
    showWarning('Cancelled');
    return;
  }

  const result = removeWalletFromGroup(selectedGroup, selectedWallet);

  if (result.success) {
    showSuccess(`Removed "${selectedWallet}" from "${selectedGroup}"`);
  } else {
    showError(`Failed to remove wallet: ${result.error}`);
  }
}

/**
 * Delete an empty wallet group
 */
export async function deleteWalletGroupCommand(): Promise<void> {
  showSectionHeader('DELETE WALLET GROUP');

  // Ensure encryption password is available if wallets.json is encrypted
  if (!(await ensureWalletPasswordIfNeeded())) {
    return;
  }

  const groupsData = loadWalletGroups();
  const groupNames = getWalletGroupNames();

  if (groupNames.length === 0) {
    showError('No wallet groups exist.');
    return;
  }

  // Filter to only show empty groups
  const emptyGroups = groupNames.filter(name => {
    const group = groupsData?.groups[name];
    return !group || group.wallets.length === 0;
  });

  if (emptyGroups.length === 0) {
    showWarning('No empty groups to delete.');
    console.log('');
    console.log('You can only delete groups that have no wallets.');
    console.log('Remove all wallets from a group first using: yarn manage → wallet:group:remove');
    return;
  }

  // Select group to delete
  const selectedGroup = await promptSelect<string>(
    'Select empty group to delete:',
    [...emptyGroups.map(name => ({ name, value: name })), { name: 'Cancel', value: '' }]
  );

  if (!selectedGroup) {
    return;
  }

  // Check if any collections are assigned to this group
  const assignedCollections = getCollectionsByGroup(selectedGroup);
  if (assignedCollections.length > 0) {
    showError(`Cannot delete group "${selectedGroup}" - it has ${assignedCollections.length} collection(s) assigned:`);
    for (const coll of assignedCollections) {
      console.log(`  • ${coll.collectionSymbol}`);
    }
    console.log('');
    console.log('Reassign these collections first using: yarn manage → collection:assign-group');
    return;
  }

  // Confirm deletion
  const confirm = await promptConfirm(
    `Are you sure you want to delete group "${selectedGroup}"?`,
    false
  );

  if (!confirm) {
    showWarning('Cancelled');
    return;
  }

  const result = deleteWalletGroup(selectedGroup);

  if (result.success) {
    showSuccess(`Deleted group "${selectedGroup}"`);
  } else {
    showError(`Failed to delete group: ${result.error}`);
  }
}
