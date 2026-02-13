import {
  loadCollections,
  assignWalletGroup,
  getCollectionsWithoutGroup,
} from '../../services/CollectionService';
import {
  getWalletGroupNames,
  loadWalletGroups,
} from '../../services/WalletGenerator';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showInfo,
} from '../../utils/display';
import { notifyBotOfConfigChange } from '../../utils/reloadNotify';
import {
  promptSelect,
  promptMultiSelect,
  promptConfirm,
} from '../../utils/prompts';

/**
 * Assign a wallet group to a collection
 */
export async function assignCollectionGroup(): Promise<void> {
  showSectionHeader('ASSIGN COLLECTION TO WALLET GROUP');

  const groupNames = getWalletGroupNames();
  const groupsData = loadWalletGroups();

  if (groupNames.length === 0) {
    showError('No wallet groups exist.');
    console.log('');
    console.log('Create wallet groups first using:');
    console.log('  yarn manage → wallet:group:create');
    return;
  }

  const collections = loadCollections();

  if (collections.length === 0) {
    showError('No collections configured.');
    console.log('');
    console.log('Add collections first using:');
    console.log('  yarn manage → collection:add');
    return;
  }

  // Show unassigned collections warning
  const unassigned = getCollectionsWithoutGroup();
  if (unassigned.length > 0) {
    showWarning(`${unassigned.length} collection(s) have no wallet group assigned:`);
    for (const coll of unassigned) {
      console.log(`  • ${coll.collectionSymbol}`);
    }
    console.log('');
  }

  // Selection mode
  const mode = await promptSelect<string>(
    'What would you like to do?',
    [
      { name: 'Assign a single collection', value: 'single' },
      { name: 'Assign multiple collections to same group', value: 'bulk' },
      { name: 'Assign all unassigned collections to a group', value: 'all-unassigned' },
      { name: 'Cancel', value: 'cancel' },
    ]
  );

  if (mode === 'cancel') {
    return;
  }

  if (mode === 'single') {
    // Single collection assignment
    const collectionChoices = collections.map(c => ({
      name: `${c.collectionSymbol}${c.walletGroup ? ` → ${c.walletGroup}` : ' (unassigned)'}`,
      value: c.collectionSymbol,
    }));

    collectionChoices.push({ name: 'Cancel', value: '' });

    const selectedCollection = await promptSelect<string>(
      'Select collection:',
      collectionChoices
    );

    if (!selectedCollection) {
      return;
    }

    const currentGroup = collections.find(c => c.collectionSymbol === selectedCollection)?.walletGroup;
    if (currentGroup) {
      showInfo(`Currently assigned to: ${currentGroup}`);
    }

    // Select target group
    const groupChoices = groupNames.map(name => ({
      name: `${name} (${groupsData?.groups[name]?.wallets?.length || 0} wallets)`,
      value: name,
    }));

    groupChoices.push({ name: 'Cancel', value: '' });

    const targetGroup = await promptSelect<string>(
      'Select wallet group:',
      groupChoices
    );

    if (!targetGroup) {
      return;
    }

    const success = assignWalletGroup(selectedCollection, targetGroup);

    if (success) {
      showSuccess(`Assigned "${selectedCollection}" to wallet group "${targetGroup}"`);
      await notifyBotOfConfigChange();
    } else {
      showError('Failed to assign wallet group');
    }

  } else if (mode === 'bulk') {
    // Bulk assignment
    const collectionChoices = collections.map(c => ({
      name: `${c.collectionSymbol}${c.walletGroup ? ` (current: ${c.walletGroup})` : ''}`,
      value: c.collectionSymbol,
    }));

    const selectedCollections = await promptMultiSelect<string>(
      'Select collections:',
      collectionChoices
    );

    if (selectedCollections.length === 0) {
      showWarning('No collections selected');
      return;
    }

    // Select target group
    const groupChoices = groupNames.map(name => ({
      name: `${name} (${groupsData?.groups[name]?.wallets?.length || 0} wallets)`,
      value: name,
    }));

    const targetGroup = await promptSelect<string>(
      'Select wallet group for all selected collections:',
      groupChoices
    );

    // Confirm
    console.log('');
    console.log('Collections to assign:');
    for (const coll of selectedCollections) {
      console.log(`  • ${coll}`);
    }
    console.log(`Target group: ${targetGroup}`);
    console.log('');

    const confirm = await promptConfirm('Proceed with assignment?', true);

    if (!confirm) {
      showWarning('Cancelled');
      return;
    }

    let successCount = 0;
    for (const collSymbol of selectedCollections) {
      const success = assignWalletGroup(collSymbol, targetGroup);
      if (success) {
        showSuccess(`Assigned "${collSymbol}" → "${targetGroup}"`);
        successCount++;
      } else {
        showError(`Failed to assign "${collSymbol}"`);
      }
    }

    console.log('');
    showInfo(`Assigned ${successCount}/${selectedCollections.length} collections`);
    if (successCount > 0) {
      await notifyBotOfConfigChange();
    }

  } else if (mode === 'all-unassigned') {
    if (unassigned.length === 0) {
      showInfo('All collections already have wallet groups assigned.');
      return;
    }

    // Select target group
    const groupChoices = groupNames.map(name => ({
      name: `${name} (${groupsData?.groups[name]?.wallets?.length || 0} wallets)`,
      value: name,
    }));

    const targetGroup = await promptSelect<string>(
      'Select wallet group for all unassigned collections:',
      groupChoices
    );

    // Confirm
    console.log('');
    console.log('Collections to assign:');
    for (const coll of unassigned) {
      console.log(`  • ${coll.collectionSymbol}`);
    }
    console.log(`Target group: ${targetGroup}`);
    console.log('');

    const confirm = await promptConfirm('Proceed with assignment?', true);

    if (!confirm) {
      showWarning('Cancelled');
      return;
    }

    let successCount = 0;
    for (const coll of unassigned) {
      const success = assignWalletGroup(coll.collectionSymbol, targetGroup);
      if (success) {
        showSuccess(`Assigned "${coll.collectionSymbol}" → "${targetGroup}"`);
        successCount++;
      } else {
        showError(`Failed to assign "${coll.collectionSymbol}"`);
      }
    }

    console.log('');
    showInfo(`Assigned ${successCount}/${unassigned.length} collections`);
    if (successCount > 0) {
      await notifyBotOfConfigChange();
    }
  }
}
