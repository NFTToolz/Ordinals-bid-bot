import {
  createWalletGroup,
  loadWalletGroups,
  loadWallets,
  migrateToGroupsFormat,
} from '../../services/WalletGenerator';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showInfo,
} from '../../utils/display';
import {
  promptText,
  promptInteger,
  promptConfirm,
} from '../../utils/prompts';

/**
 * Create a new wallet group
 */
export async function createWalletGroupCommand(): Promise<void> {
  showSectionHeader('CREATE WALLET GROUP');

  // Check if using legacy format and offer migration
  const groupsData = loadWalletGroups();
  const legacyData = loadWallets();

  if (!groupsData && legacyData && legacyData.wallets?.length > 0) {
    showWarning('Your wallet configuration is using the legacy flat format.');
    console.log('');
    console.log('Existing wallets:');
    legacyData.wallets.forEach(w => {
      console.log(`  • ${w.label}`);
    });
    console.log('');

    const migrate = await promptConfirm(
      'Would you like to migrate existing wallets to a "default" group first?',
      true
    );

    if (migrate) {
      const migrated = migrateToGroupsFormat();
      if (migrated) {
        showSuccess('Migrated existing wallets to "default" group');
        console.log('');
      } else {
        showError('Failed to migrate wallets');
        return;
      }
    }
  }

  // Prompt for group name
  const groupName = await promptText('Enter group name (empty to cancel):');

  if (!groupName || groupName.trim() === '') {
    return;
  }

  // Validate group name
  const validNameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!validNameRegex.test(groupName)) {
    showError('Group name can only contain letters, numbers, hyphens, and underscores');
    return;
  }

  // Check if group already exists
  const currentGroups = loadWalletGroups();
  if (currentGroups && currentGroups.groups[groupName]) {
    showError(`Group "${groupName}" already exists`);
    return;
  }

  // Prompt for bids per minute
  const bidsPerMinute = await promptInteger('Bids per minute per wallet:', 5);

  if (bidsPerMinute < 1 || bidsPerMinute > 60) {
    showError('Bids per minute must be between 1 and 60');
    return;
  }

  // Create the group
  const success = createWalletGroup(groupName, bidsPerMinute);

  if (success) {
    showSuccess(`Created wallet group "${groupName}"`);
    console.log('');
    console.log('Next steps:');
    console.log(`  1. Add wallets to this group: yarn manage → wallet:group:add`);
    console.log(`  2. Assign collections to this group: yarn manage → collection:assign-group`);
  } else {
    showError('Failed to create wallet group');
  }
}
