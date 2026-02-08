import { config } from 'dotenv';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import { loadWallets, getWalletFromWIF, isGroupsFormat, getAllWalletsFromGroups } from '../../services/WalletGenerator';
import { getBalance, getFeeRates, AddressBalance } from '../../services/BalanceService';
import {
  buildDistributionTransaction,
  signAndBroadcastDistribution,
  TransactionRecipient,
} from '../../services/TransactionBuilder';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showTransactionPreview,
  formatBTC,
  withSpinner,
} from '../../utils/display';
import {
  promptBTC,
  promptSelect,
  promptConfirm,
  promptNumber,
} from '../../utils/prompts';
import { getWalletsWithBalances, WalletWithBalance } from './list';
import { ensureWalletPasswordIfNeeded } from '../../utils/walletPassword';

config();

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);
const network = bitcoin.networks.bitcoin;

export async function distributeFunds(): Promise<void> {
  showSectionHeader('DISTRIBUTE FUNDS');

  // Ensure encryption password is available if wallets.json is encrypted
  if (!(await ensureWalletPasswordIfNeeded())) {
    return;
  }

  // Get main wallet (source)
  const FUNDING_WIF = process.env.FUNDING_WIF;
  if (!FUNDING_WIF) {
    showError('FUNDING_WIF not set in .env');
    return;
  }

  const mainWallet = getWalletFromWIF(FUNDING_WIF, network);

  console.log('Source: Main Wallet (FUNDING_WIF)');
  console.log(`Address: ${mainWallet.paymentAddress}`);
  console.log('');

  // Get source balance
  const sourceBalance = await withSpinner(
    'Fetching source balance...',
    () => getBalance(mainWallet.paymentAddress)
  );

  console.log(`Balance: ${formatBTC(sourceBalance.total)}`);
  console.log('');

  if (sourceBalance.total === 0) {
    showError('No funds available to distribute');
    return;
  }

  // Get destination wallets
  const walletsData = loadWallets();
  let walletCount = 0;
  if (walletsData) {
    if (isGroupsFormat(walletsData)) {
      walletCount = getAllWalletsFromGroups().length;
    } else if (walletsData.wallets?.length) {
      walletCount = walletsData.wallets.length;
    }
  }
  if (walletCount === 0) {
    showError('No destination wallets found');
    console.log('');
    console.log('Use "Create new wallets" to generate bidding wallets first.');
    return;
  }

  // Get destination wallet balances
  const destWallets = await withSpinner(
    'Fetching destination balances...',
    () => getWalletsWithBalances()
  );

  // Filter to only show config wallets (not main wallet)
  const configWallets = destWallets.filter(w => w.label !== 'Main Wallet');

  console.log('');
  console.log('Destination Wallets:');
  configWallets.forEach(w => {
    console.log(`  • ${w.label}: ${formatBTC(w.balance.total)}`);
  });
  console.log('');

  // Distribution method
  const method = await promptSelect<'equal' | 'custom' | '__cancel__'>(
    'Distribution method:',
    [
      { name: 'Equal split', value: 'equal' },
      { name: 'Custom amounts per wallet', value: 'custom' },
      { name: '← Back', value: '__cancel__' },
    ]
  );

  if (method === '__cancel__') {
    return;
  }

  let recipients: TransactionRecipient[] = [];
  let totalAmount = 0;

  if (method === 'equal') {
    totalAmount = Math.floor(
      await promptBTC('Total amount to distribute (BTC):', sourceBalance.total / 1e8 * 0.9) * 1e8
    );

    if (totalAmount <= 0) {
      showError('Amount must be greater than 0');
      return;
    }

    if (totalAmount > sourceBalance.total) {
      showError(`Insufficient funds. Available: ${formatBTC(sourceBalance.total)}`);
      return;
    }

    // Get fee rate for estimation
    const feeRates = await getFeeRates();

    // Estimate fee first
    const estimatedFee = (10 + 68 + (configWallets.length + 1) * 31 + 27) * feeRates.halfHourFee;
    const amountAfterFee = totalAmount - estimatedFee;

    if (amountAfterFee <= 0) {
      showError('Amount too small to cover fees');
      return;
    }

    const amountPerWallet = Math.floor(amountAfterFee / configWallets.length);

    if (amountPerWallet <= 546) {
      showError('Amount per wallet would be below dust threshold (546 sats)');
      return;
    }

    recipients = configWallets.map(w => ({
      address: w.paymentAddress,
      amount: amountPerWallet,
    }));
  } else {
    // Custom amounts
    const DUST_THRESHOLD = 546; // Minimum output in satoshis
    const MIN_BTC = DUST_THRESHOLD / 1e8;

    console.log('');
    showWarning(`Minimum amount per wallet: ${MIN_BTC} BTC (${DUST_THRESHOLD} sats) - Bitcoin dust threshold`);
    console.log('');

    for (const wallet of configWallets) {
      const amount = await promptBTC(`Amount for ${wallet.label} (BTC):`, 0);
      if (amount > 0) {
        const sats = Math.floor(amount * 1e8);
        if (sats < DUST_THRESHOLD) {
          showWarning(`Skipping ${wallet.label}: ${sats} sats is below dust threshold (${DUST_THRESHOLD} sats)`);
          continue;
        }
        recipients.push({
          address: wallet.paymentAddress,
          amount: sats,
        });
        totalAmount += sats;
      }
    }

    if (recipients.length === 0) {
      showError('No valid recipients. All amounts were below dust threshold or zero.');
      console.log('');
      console.log(`Minimum amount per wallet: ${MIN_BTC} BTC (${DUST_THRESHOLD} satoshis)`);
      return;
    }

    if (totalAmount > sourceBalance.total) {
      showError(`Insufficient funds. Requested: ${formatBTC(totalAmount)}, Available: ${formatBTC(sourceBalance.total)}`);
      return;
    }
  }

  // Build transaction preview
  console.log('');
  console.log('Building transaction...');

  try {
    const preview = await buildDistributionTransaction(
      FUNDING_WIF,
      mainWallet.paymentAddress,
      recipients
    );

    // Show preview
    const recipientDetails = recipients.map((r, i) => ({
      label: configWallets.find(w => w.paymentAddress.toLowerCase() === r.address.toLowerCase())?.label || `Wallet ${i + 1}`,
      address: r.address,
      amount: r.amount,
    }));

    showTransactionPreview(
      mainWallet.paymentAddress,
      recipientDetails,
      preview.fee,
      preview.change
    );

    // Confirm
    const confirm = await promptConfirm('Confirm transaction?', false);

    if (!confirm) {
      showWarning('Transaction cancelled');
      return;
    }

    // Sign and broadcast
    console.log('');
    const result = await withSpinner(
      'Broadcasting transaction...',
      () => signAndBroadcastDistribution(FUNDING_WIF, mainWallet.paymentAddress, recipients)
    );

    console.log('');
    showSuccess(`Transaction sent!`);
    console.log(`  TXID: ${result.txid}`);
    console.log(`  Fee: ${formatBTC(result.fee)} (${result.size} vB)`);
    console.log('');
    console.log(`  View on mempool.space: https://mempool.space/tx/${result.txid}`);
    console.log('');

  } catch (error: any) {
    const errorMsg = error.message || '';

    // Parse common Bitcoin errors into user-friendly messages
    if (errorMsg.includes('dust')) {
      showError('Transaction failed: Output amount too small');
      console.log('');
      console.log('Bitcoin requires a minimum output of 546 satoshis (0.00000546 BTC).');
      console.log('Please use larger amounts per wallet.');
    } else if (errorMsg.includes('insufficient') || errorMsg.includes('Insufficient')) {
      showError('Transaction failed: Insufficient funds');
      console.log('');
      console.log('Not enough BTC to cover the transaction amount plus fees.');
    } else if (errorMsg.includes('mempool')) {
      showError('Transaction failed: Mempool error');
      console.log('');
      console.log('The transaction was rejected by the network. Try again later.');
    } else {
      showError(`Transaction failed: ${errorMsg}`);
    }
  }
}
