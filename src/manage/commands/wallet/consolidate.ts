import { config } from 'dotenv';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import { loadWallets, getWalletFromWIF, isGroupsFormat, getAllWalletsFromGroups } from '../../services/WalletGenerator';
import { checkAddressesForInscriptions } from '../../services/OrdinalsService';
import {
  buildConsolidationTransaction,
  signAndBroadcastConsolidation,
} from '../../services/TransactionBuilder';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showTable,
  formatBTC,
  withSpinner,
  getSeparatorWidth,
} from '../../utils/display';
import {
  promptConfirm,
  promptDangerousConfirm,
  promptSelect,
} from '../../utils/prompts';
import { getWalletsWithBalances } from './list';
import { ensureWalletPasswordIfNeeded } from '../../utils/walletPassword';

config();

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);
const network = bitcoin.networks.bitcoin;

export async function consolidateFunds(): Promise<void> {
  showSectionHeader('CONSOLIDATE FUNDS');

  // Ensure encryption password is available if wallets.json is encrypted
  if (!(await ensureWalletPasswordIfNeeded())) {
    return;
  }

  // Get all wallets with balances
  const wallets = await withSpinner(
    'Fetching wallet balances...',
    () => getWalletsWithBalances()
  );

  if (wallets.length === 0) {
    showError('No wallets found');
    return;
  }

  // Show current balances
  console.log('');
  console.log('Current Wallet Balances:');
  console.log('');

  const headers = ['Label', 'Address', 'Balance'];
  const rows = wallets.map(w => [
    w.label,
    w.paymentAddress.slice(0, 8) + '...' + w.paymentAddress.slice(-6),
    formatBTC(w.balance.total),
  ]);

  showTable(headers, rows);

  // Filter wallets with balance (excluding main wallet as it's the destination)
  const walletsWithFunds = wallets.filter(
    w => w.balance.total > 0 && w.label !== 'Main Wallet'
  );

  if (walletsWithFunds.length === 0) {
    showError('No funds to consolidate (only main wallet has funds)');
    return;
  }

  // Select source wallets
  const consolidateAll = await promptConfirm(
    `Consolidate all ${walletsWithFunds.length} wallets with funds?`,
    true
  );

  let sourceWallets = walletsWithFunds;

  if (!consolidateAll) {
    showWarning('Consolidation cancelled');
    return;
  }

  // Destination selection
  const destChoice = await promptSelect<'main' | 'other' | '__cancel__'>(
    'Consolidate to:',
    [
      { name: 'Main Wallet (FUNDING_WIF)', value: 'main' },
      { name: 'Another address', value: 'other' },
      { name: '← Back', value: '__cancel__' },
    ]
  );

  if (destChoice === '__cancel__') {
    return;
  }

  let destinationAddress: string;

  if (destChoice === 'main') {
    const FUNDING_WIF = process.env.FUNDING_WIF;
    if (!FUNDING_WIF) {
      showError('FUNDING_WIF not set in .env');
      return;
    }
    const mainWallet = getWalletFromWIF(FUNDING_WIF, network);
    destinationAddress = mainWallet.paymentAddress;
  } else {
    const { address } = await require('inquirer').prompt([{
      type: 'input',
      name: 'address',
      message: 'Enter destination address:',
      validate: (input: string) => {
        try {
          bitcoin.address.toOutputScript(input, network);
          return true;
        } catch {
          return 'Invalid Bitcoin address';
        }
      },
    }]);
    destinationAddress = address;
  }

  // Check for inscriptions (ordinals safety check)
  console.log('');
  console.log('Checking for inscriptions (ordinals)...');

  const addresses = sourceWallets.map(w => (w.receiveAddress || w.paymentAddress).toLowerCase());
  const inscriptionCheck = await withSpinner(
    'Scanning for inscriptions...',
    () => checkAddressesForInscriptions(addresses)
  );

  const walletsWithInscriptions: string[] = [];
  sourceWallets.forEach(w => {
    const addr = (w.receiveAddress || w.paymentAddress).toLowerCase();
    if (inscriptionCheck.get(addr)) {
      walletsWithInscriptions.push(w.label);
    }
  });

  if (walletsWithInscriptions.length > 0) {
    console.log('');
    showWarning('The following wallets contain inscriptions (ordinals):');
    walletsWithInscriptions.forEach(label => {
      console.log(`  • ${label}`);
    });
    console.log('');
    showWarning('Consolidating these wallets may result in LOSS of inscriptions!');
    console.log('');

    const proceed = await promptConfirm(
      'Continue anyway? (inscriptions may be lost)',
      false
    );

    if (!proceed) {
      showWarning('Consolidation cancelled');
      return;
    }
  }

  // Calculate totals
  const totalToConsolidate = sourceWallets.reduce(
    (sum, w) => sum + w.balance.total,
    0
  );

  // Get wallet configs for signing
  const walletsConfig = loadWallets();
  if (!walletsConfig) {
    showError('Could not load wallet configuration');
    return;
  }

  // Get wallets from either format
  let configWallets: Array<{ label: string; wif: string; receiveAddress: string }> = [];
  if (isGroupsFormat(walletsConfig)) {
    configWallets = getAllWalletsFromGroups();
  } else if (walletsConfig.wallets?.length) {
    configWallets = walletsConfig.wallets;
  }

  const signingWallets: Array<{ wif: string; address: string }> = [];

  sourceWallets.forEach(w => {
    const walletConfig = configWallets.find(
      wc => {
        try {
          const info = getWalletFromWIF(wc.wif, network);
          return info.paymentAddress.toLowerCase() === w.paymentAddress.toLowerCase();
        } catch {
          return false;
        }
      }
    );

    if (walletConfig) {
      signingWallets.push({
        wif: walletConfig.wif,
        address: w.paymentAddress,
      });
    }
  });

  if (signingWallets.length === 0) {
    showError('Could not find signing keys for selected wallets');
    return;
  }

  // Build transaction preview
  console.log('');
  console.log('Building consolidation transaction...');

  try {
    const preview = await buildConsolidationTransaction(
      signingWallets,
      destinationAddress
    );

    console.log('');
    console.log('━'.repeat(getSeparatorWidth()));
    console.log('  CONSOLIDATION PREVIEW');
    console.log('━'.repeat(getSeparatorWidth()));
    console.log(`  Source wallets:    ${sourceWallets.length}`);
    console.log(`  Total inputs:      ${preview.inputs.length} UTXOs`);
    console.log(`  Input amount:      ${formatBTC(preview.totalInput)}`);
    console.log(`  Network fee:       ${formatBTC(preview.fee)}`);
    console.log(`  Output amount:     ${formatBTC(preview.totalOutput)}`);
    console.log('━'.repeat(getSeparatorWidth()));
    console.log(`  Destination:       ${destinationAddress.slice(0, 12)}...${destinationAddress.slice(-8)}`);
    console.log('━'.repeat(getSeparatorWidth()));
    console.log('');

    // Dangerous confirmation
    const confirm = await promptDangerousConfirm(
      'This will consolidate all funds to the destination address.',
      'CONSOLIDATE'
    );

    if (!confirm) {
      showWarning('Consolidation cancelled');
      return;
    }

    // Sign and broadcast
    console.log('');
    const result = await withSpinner(
      'Broadcasting transaction...',
      () => signAndBroadcastConsolidation(signingWallets, destinationAddress)
    );

    console.log('');
    showSuccess('Consolidation complete!');
    console.log(`  TXID: ${result.txid}`);
    console.log(`  Fee: ${formatBTC(result.fee)} (${result.size} vB)`);
    console.log('');
    console.log(`  View on mempool.space: https://mempool.space/tx/${result.txid}`);
    console.log('');

  } catch (error: any) {
    showError(`Consolidation failed: ${error.message}`);
  }
}
