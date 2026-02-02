import {
  loadWalletGroups,
  loadWallets,
  addWalletToGroup,
  getWalletGroupNames,
  getAllWalletsFromGroups,
  WalletConfig,
  deriveWallets,
} from '../../services/WalletGenerator';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showInfo,
} from '../../utils/display';
import {
  promptSelect,
  promptMultiSelect,
  promptText,
  promptConfirm,
} from '../../utils/prompts';

/**
 * Add wallets to a group
 */
export async function addWalletsToGroupCommand(): Promise<void> {
  showSectionHeader('ADD WALLETS TO GROUP');

  const groupsData = loadWalletGroups();
  const groupNames = getWalletGroupNames();

  if (groupNames.length === 0) {
    showError('No wallet groups exist. Create a group first.');
    console.log('');
    console.log('Run: yarn manage → wallet:group:create');
    return;
  }

  // Select target group
  const groupChoices = groupNames.map(name => ({
    name: `${name} (${groupsData?.groups[name]?.wallets?.length || 0} wallets)`,
    value: name,
  }));
  groupChoices.push({ name: '← Back', value: '__cancel__' });

  const targetGroup = await promptSelect<string>('Select target group:', groupChoices);

  if (targetGroup === '__cancel__') {
    return;
  }

  console.log('');

  // Get wallets that could be added
  const legacyWallets = loadWallets();
  const allGroupedWallets = getAllWalletsFromGroups();

  // Find unassigned wallets from legacy format
  const groupedWifs = new Set(allGroupedWallets.map(w => w.wif));
  const unassignedWallets = legacyWallets?.wallets?.filter(w => !groupedWifs.has(w.wif)) || [];

  // Source selection
  const sourceOptions: Array<{ name: string; value: string }> = [];

  if (unassignedWallets.length > 0) {
    sourceOptions.push({
      name: `Select from unassigned wallets (${unassignedWallets.length} available)`,
      value: 'unassigned',
    });
  }

  // Check for wallets in other groups that could be moved
  const otherGroupWallets = allGroupedWallets.filter(w => w.groupName !== targetGroup);
  if (otherGroupWallets.length > 0) {
    sourceOptions.push({
      name: `Move from another group (${otherGroupWallets.length} wallets in other groups)`,
      value: 'move',
    });
  }

  sourceOptions.push({
    name: 'Generate new wallets',
    value: 'generate',
  });

  sourceOptions.push({
    name: 'Import wallet manually (WIF)',
    value: 'import',
  });

  sourceOptions.push({
    name: 'Cancel',
    value: 'cancel',
  });

  const source = await promptSelect<string>('How would you like to add wallets?', sourceOptions);

  if (source === 'cancel') {
    return;
  }

  if (source === 'unassigned') {
    // Select from unassigned wallets
    const walletChoices = unassignedWallets.map(w => ({
      name: `${w.label} (${w.receiveAddress.slice(0, 12)}...)`,
      value: w.label,
    }));

    const selectedLabels = await promptMultiSelect<string>(
      'Select wallets to add:',
      walletChoices
    );

    if (selectedLabels.length === 0) {
      showWarning('No wallets selected');
      return;
    }

    let addedCount = 0;
    for (const label of selectedLabels) {
      const wallet = unassignedWallets.find(w => w.label === label);
      if (wallet) {
        const result = addWalletToGroup(targetGroup, wallet);
        if (result.success) {
          showSuccess(`Added "${label}" to group "${targetGroup}"`);
          addedCount++;
        } else {
          showError(`Failed to add "${label}": ${result.error}`);
        }
      }
    }

    console.log('');
    showInfo(`Added ${addedCount} wallet(s) to "${targetGroup}"`);

  } else if (source === 'move') {
    // Move from another group
    const walletChoices = otherGroupWallets.map(w => ({
      name: `${w.label} (from "${w.groupName}")`,
      value: w.label,
    }));

    const selectedLabels = await promptMultiSelect<string>(
      'Select wallets to move:',
      walletChoices
    );

    if (selectedLabels.length === 0) {
      showWarning('No wallets selected');
      return;
    }

    // Import moveWalletToGroup
    const { moveWalletToGroup } = require('../../services/WalletGenerator');

    let movedCount = 0;
    for (const label of selectedLabels) {
      const result = moveWalletToGroup(label, targetGroup);
      if (result.success) {
        const wallet = otherGroupWallets.find(w => w.label === label);
        showSuccess(`Moved "${label}" from "${wallet?.groupName}" to "${targetGroup}"`);
        movedCount++;
      } else {
        showError(`Failed to move "${label}": ${result.error}`);
      }
    }

    console.log('');
    showInfo(`Moved ${movedCount} wallet(s) to "${targetGroup}"`);

  } else if (source === 'generate') {
    // Check if we have a mnemonic
    if (!legacyWallets?.mnemonic && !groupsData?.mnemonic) {
      showError('No mnemonic found. Generate wallets using "Create new wallets" first.');
      return;
    }

    const mnemonic = legacyWallets?.mnemonic || groupsData?.mnemonic;

    const countStr = await promptText('How many wallets to generate?', '5');
    const count = parseInt(countStr, 10);

    if (isNaN(count) || count < 1 || count > 50) {
      showError('Please enter a number between 1 and 50');
      return;
    }

    // Find the next available index
    const allWallets = [...(legacyWallets?.wallets || []), ...allGroupedWallets];
    let maxIndex = 0;
    allWallets.forEach(w => {
      const match = w.label.match(/-(\d+)$/);
      if (match) {
        const idx = parseInt(match[1], 10);
        if (idx > maxIndex) maxIndex = idx;
      }
    });

    const labelPrefix = await promptText('Label prefix:', 'wallet');
    const startIndex = maxIndex; // deriveWallets uses 0-based, labels use 1-based

    console.log('');
    console.log(`Generating ${count} wallets starting from index ${startIndex}...`);

    const newWallets = deriveWallets(mnemonic!, count, labelPrefix, startIndex);

    let addedCount = 0;
    for (const wallet of newWallets) {
      const walletConfig: WalletConfig = {
        label: wallet.label,
        wif: wallet.wif,
        receiveAddress: wallet.receiveAddress,
      };

      const result = addWalletToGroup(targetGroup, walletConfig);
      if (result.success) {
        showSuccess(`Added "${wallet.label}" to group "${targetGroup}"`);
        addedCount++;
      } else {
        showError(`Failed to add "${wallet.label}": ${result.error}`);
      }
    }

    console.log('');
    showInfo(`Generated and added ${addedCount} wallet(s) to "${targetGroup}"`);

  } else if (source === 'import') {
    // Manual import
    const wif = await promptText('Enter wallet WIF (private key):');
    if (!wif) {
      showError('WIF cannot be empty');
      return;
    }

    const receiveAddress = await promptText('Enter ordinals receive address (bc1p...):');
    if (!receiveAddress || !receiveAddress.startsWith('bc1p')) {
      showError('Please enter a valid Taproot address (bc1p...)');
      return;
    }

    const label = await promptText('Enter wallet label:');
    if (!label) {
      showError('Label cannot be empty');
      return;
    }

    // Validate WIF
    try {
      const bitcoin = require('bitcoinjs-lib');
      const { ECPairFactory } = require('ecpair');
      const tinysecp = require('tiny-secp256k1');
      const ECPair = ECPairFactory(tinysecp);
      ECPair.fromWIF(wif, bitcoin.networks.bitcoin);
    } catch (error) {
      showError('Invalid WIF format');
      return;
    }

    const walletConfig: WalletConfig = {
      label,
      wif,
      receiveAddress,
    };

    const result = addWalletToGroup(targetGroup, walletConfig);
    if (result.success) {
      showSuccess(`Added "${label}" to group "${targetGroup}"`);
    } else {
      showError(`Failed to add wallet: ${result.error}`);
    }
  }
}
