import { config } from 'dotenv';
import { loadWallets, getWalletFromWIF } from '../../services/WalletGenerator';
import {
  getInscriptionsForAddresses,
  formatInscription,
  InscriptionsByAddress,
} from '../../services/OrdinalsService';
import {
  showSectionHeader,
  showSuccess,
  showWarning,
  showError,
  showTable,
  withSpinner,
} from '../../utils/display';
import { promptSelect, promptMultiWalletSelect } from '../../utils/prompts';
import * as bitcoin from 'bitcoinjs-lib';

config();

const network = bitcoin.networks.bitcoin;

export async function viewOrdinals(): Promise<void> {
  showSectionHeader('VIEW ORDINALS/NFTs');

  // Collect all wallet addresses
  const allWallets: Array<{
    label: string;
    paymentAddress: string;
    receiveAddress: string;
  }> = [];

  // Main wallet
  const FUNDING_WIF = process.env.FUNDING_WIF;
  const TOKEN_RECEIVE_ADDRESS = process.env.TOKEN_RECEIVE_ADDRESS;

  if (FUNDING_WIF && TOKEN_RECEIVE_ADDRESS) {
    try {
      const mainWallet = getWalletFromWIF(FUNDING_WIF, network);
      allWallets.push({
        label: 'Main Wallet',
        paymentAddress: mainWallet.paymentAddress,
        receiveAddress: TOKEN_RECEIVE_ADDRESS,
      });
    } catch (error) {
      // Skip
    }
  }

  // Config wallets
  const walletsConfig = loadWallets();
  if (walletsConfig && walletsConfig.wallets.length > 0) {
    walletsConfig.wallets.forEach(w => {
      try {
        const walletInfo = getWalletFromWIF(w.wif, network);
        allWallets.push({
          label: w.label,
          paymentAddress: walletInfo.paymentAddress,
          receiveAddress: w.receiveAddress,
        });
      } catch (error) {
        // Skip
      }
    });
  }

  if (allWallets.length === 0) {
    showError('No wallets found');
    return;
  }

  // Select scope
  const scope = await promptSelect<'all' | 'select'>(
    'Which wallets to scan?',
    [
      { name: `All wallets (${allWallets.length})`, value: 'all' },
      { name: 'Select specific wallets', value: 'select' },
    ]
  );

  let selectedWallets = allWallets;

  if (scope === 'select') {
    const selected = await promptMultiWalletSelect(
      allWallets.map(w => ({
        label: w.label,
        address: w.receiveAddress,
      })),
      'Select wallets to scan:'
    );

    if (selected.length === 0) {
      showWarning('No wallets selected');
      return;
    }

    selectedWallets = allWallets.filter(w => selected.includes(w.receiveAddress));
  }

  // Scan for inscriptions
  console.log('');
  console.log(`Scanning ${selectedWallets.length} wallet(s) for inscriptions...`);
  console.log('');

  const addresses = selectedWallets.map(w => w.receiveAddress);

  const results = await withSpinner(
    'Fetching inscriptions from Hiro API...',
    () => getInscriptionsForAddresses(addresses)
  );

  // Display results
  let totalInscriptions = 0;

  results.forEach((result, i) => {
    const wallet = selectedWallets.find(w => w.receiveAddress === result.address);
    const label = wallet?.label || 'Unknown';

    if (result.total > 0) {
      console.log('');
      console.log(`━━━ ${label} (${result.total} inscription${result.total === 1 ? '' : 's'}) ━━━`);
      console.log(`    ${result.address}`);
      console.log('');

      const headers = ['ID', 'Number', 'Type', 'Rarity', 'Value'];
      const rows = result.inscriptions.slice(0, 20).map(ins => {
        const formatted = formatInscription(ins);
        return [
          formatted.id,
          formatted.number,
          formatted.type,
          formatted.rarity,
          formatted.value,
        ];
      });

      showTable(headers, rows, [20, 12, 12, 10, 16]);

      if (result.total > 20) {
        console.log(`  ... and ${result.total - 20} more inscriptions`);
      }

      totalInscriptions += result.total;
    }
  });

  // Summary
  console.log('');
  console.log('━'.repeat(50));
  console.log(`  Total inscriptions found: ${totalInscriptions}`);
  console.log('━'.repeat(50));
  console.log('');

  if (totalInscriptions === 0) {
    console.log('No inscriptions found in the scanned wallets.');
    console.log('');
  }
}
