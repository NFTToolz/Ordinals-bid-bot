import {
  loadWalletGroups,
  loadWallets,
} from '../../services/WalletGenerator';
import { getBalance } from '../../services/BalanceService';
import {
  showSectionHeader,
  showInfo,
  showWarning,
  formatBTC,
  withSpinner,
  getSeparatorWidth,
} from '../../utils/display';
import { getCollectionsByGroup } from '../../services/CollectionService';
import { TableColumn, TableData } from '../../utils/table';
import { showInteractiveTable } from '../../utils/interactiveTable';

/**
 * List all wallet groups with wallet counts and total BTC
 */
export async function listWalletGroups(): Promise<void> {
  showSectionHeader('WALLET GROUPS');

  const groupsData = loadWalletGroups();

  // Check if using legacy format
  if (!groupsData) {
    const legacy = loadWallets();
    if (legacy && legacy.wallets.length > 0) {
      showWarning('Wallet configuration is using legacy format (flat wallets array).');
      console.log('');
      console.log('To use wallet groups, run:');
      console.log('  yarn manage → wallet:group:create');
      console.log('');
      console.log('Current wallets:');
      legacy.wallets.forEach(w => {
        console.log(`  - ${w.label}`);
      });
      return;
    }

    showInfo('No wallet groups configured yet.');
    console.log('');
    console.log('To create your first wallet group, run:');
    console.log('  yarn manage → wallet:group:create');
    return;
  }

  const groupNames = Object.keys(groupsData.groups);
  if (groupNames.length === 0) {
    showInfo('No wallet groups configured.');
    console.log('');
    console.log('To create a wallet group, run:');
    console.log('  yarn manage → wallet:group:create');
    return;
  }

  // Collect all wallet addresses for balance lookup
  const allWalletAddresses: { groupName: string; label: string; address: string }[] = [];
  for (const [groupName, group] of Object.entries(groupsData.groups)) {
    for (const wallet of group.wallets) {
      // Derive payment address from WIF for balance lookup
      const bitcoin = require('bitcoinjs-lib');
      const { ECPairFactory } = require('ecpair');
      const tinysecp = require('tiny-secp256k1');
      const ECPair = ECPairFactory(tinysecp);

      try {
        const keyPair = ECPair.fromWIF(wallet.wif, bitcoin.networks.bitcoin);
        const paymentAddress = bitcoin.payments.p2wpkh({
          pubkey: keyPair.publicKey,
          network: bitcoin.networks.bitcoin,
        }).address;

        allWalletAddresses.push({
          groupName,
          label: wallet.label,
          address: paymentAddress,
        });
      } catch (error) {
        console.log(`  Warning: Could not derive address for ${wallet.label}`);
      }
    }
  }

  // Fetch balances
  const balances = new Map<string, number>();
  if (allWalletAddresses.length > 0) {
    await withSpinner('Fetching wallet balances...', async () => {
      for (const { address } of allWalletAddresses) {
        try {
          const balance = await getBalance(address);
          balances.set(address, balance.total);
        } catch (error) {
          balances.set(address, 0);
        }
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    });
  }

  console.log(`Default Group: ${groupsData.defaultGroup || 'not set'}`);
  console.log('');

  // Build table data for groups overview
  const groupColumns: TableColumn[] = [
    { key: 'name', label: 'Group Name', width: 20 },
    { key: 'wallets', label: 'Wallets', width: 10, align: 'right' },
    { key: 'bidsPerMin', label: 'Bids/min', width: 10, align: 'right' },
    { key: 'collections', label: 'Collections', width: 12, align: 'right' },
    { key: 'balance', label: 'Total Balance', width: 20, align: 'right' },
    { key: 'balanceSats', label: 'Sats', width: 14, align: 'right' },
    { key: 'isDefault', label: 'Default', width: 10 },
  ];

  const groupRows = Object.entries(groupsData.groups).map(([groupName, group]) => {
    const isDefault = groupName === groupsData.defaultGroup;
    const collections = getCollectionsByGroup(groupName);

    // Calculate total balance for this group
    let groupTotal = 0;
    for (const wallet of group.wallets) {
      const walletInfo = allWalletAddresses.find(
        w => w.groupName === groupName && w.label === wallet.label
      );
      if (walletInfo) {
        groupTotal += balances.get(walletInfo.address) || 0;
      }
    }

    return {
      name: groupName,
      wallets: group.wallets.length,
      bidsPerMin: group.bidsPerMinute || 5,
      collections: collections.length,
      balance: formatBTC(groupTotal),
      balanceSats: groupTotal,
      isDefault: isDefault ? 'Yes' : '',
    };
  });

  const groupTableData: TableData = { columns: groupColumns, rows: groupRows };

  // Show summary
  const totalWallets = allWalletAddresses.length;
  const totalBalance = Array.from(balances.values()).reduce((sum, b) => sum + b, 0);

  console.log('━'.repeat(getSeparatorWidth()));
  console.log(`  Total Groups:   ${groupNames.length}`);
  console.log(`  Total Wallets:  ${totalWallets}`);
  console.log(`  Total Balance:  ${formatBTC(totalBalance)}`);
  console.log('━'.repeat(getSeparatorWidth()));
  console.log('');

  // Show interactive table for groups
  await showInteractiveTable(groupTableData, {
    title: 'WALLET GROUPS OVERVIEW',
    pageSize: 10,
    allowSort: true,
    allowExport: true,
    exportBaseName: 'wallet-groups',
  });
}
