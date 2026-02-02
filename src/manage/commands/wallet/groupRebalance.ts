import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import {
  loadWalletGroups,
  getWalletGroupNames,
  WalletConfig,
  WalletGroupConfig,
} from '../../services/WalletGenerator';
import {
  getBalance,
  getFeeRates,
  getUTXOs,
  UTXO,
} from '../../services/BalanceService';
import { broadcastTransaction } from '../../services/TransactionBuilder';
import { getCollectionsByGroup, CollectionConfig } from '../../services/CollectionService';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showInfo,
  withSpinner,
  formatBTC,
} from '../../utils/display';
import {
  promptSelect,
  promptConfirm,
} from '../../utils/prompts';

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);
const network = bitcoin.networks.bitcoin;

interface WalletBalance {
  label: string;
  wif: string;
  receiveAddress: string;
  paymentAddress: string;
  balance: number;
}

interface Transfer {
  from: WalletBalance;
  to: WalletBalance;
  amount: number;
  fee: number;
}

interface RequirementBreakdown {
  groupName: string;
  collections: string[];
  maxBidSats: number;
  avgFeeSats: number;
  bufferSats: number;
  requiredPerWallet: number;
}

type RebalanceMode = 'smart' | 'equal' | 'cancel';

const MIN_TRANSFER_SATS = 10000; // 10,000 sats minimum to avoid dust
const SIMPLE_TX_SIZE = 110; // ~110 vbytes for P2WPKH withdrawal/transfer
const BUFFER_PERCENTAGE = 0.1; // 10% safety buffer

/**
 * Calculate required balance per wallet based on collection requirements
 */
function calculateRequiredBalance(
  groupName: string,
  groupConfig: WalletGroupConfig,
  fallbackFeeRate: number
): RequirementBreakdown | null {
  const collections = getCollectionsByGroup(groupName);

  if (collections.length === 0) {
    return null;
  }

  // Find highest maxBid in satoshis
  const maxBidSats = Math.max(...collections.map(c => Math.round(c.maxBid * 1e8)));

  // Calculate average expected fee (use collection's feeSatsPerVbyte or fallback to current rate)
  const avgFeeRate = collections.reduce(
    (sum, c) => sum + (c.feeSatsPerVbyte || fallbackFeeRate),
    0
  ) / collections.length;
  const avgFeeSats = Math.ceil(avgFeeRate * SIMPLE_TX_SIZE);

  // 10% buffer for safety
  const bufferSats = Math.ceil((maxBidSats + avgFeeSats) * BUFFER_PERCENTAGE);

  // Total required per wallet (enough for one active bid at a time)
  const requiredPerWallet = maxBidSats + avgFeeSats + bufferSats;

  return {
    groupName,
    collections: collections.map(c => c.collectionSymbol),
    maxBidSats,
    avgFeeSats,
    bufferSats,
    requiredPerWallet,
  };
}

/**
 * Display smart rebalance calculation breakdown
 */
function displayRequirementBreakdown(breakdown: RequirementBreakdown): void {
  console.log(`  Collections in this group: ${breakdown.collections.join(', ')}`);
  console.log('');
  console.log('  Calculation:');
  console.log(`    Max bid price:     ${formatBTC(breakdown.maxBidSats)} (${breakdown.maxBidSats.toLocaleString()} sats)`);
  console.log(`    Withdrawal fee:    ${formatBTC(breakdown.avgFeeSats)} (${breakdown.avgFeeSats.toLocaleString()} sats)`);
  console.log(`    Buffer (10%):      ${formatBTC(breakdown.bufferSats)} (${breakdown.bufferSats.toLocaleString()} sats)`);
  console.log('    ─────────────────────────────────────');
  console.log(`    Required/wallet:   ${formatBTC(breakdown.requiredPerWallet)} (${breakdown.requiredPerWallet.toLocaleString()} sats)`);
  console.log('');
}

/**
 * Estimate transaction fee for a simple 1-input, 1-output transaction
 */
function estimateSimpleTxFee(feeRate: number): number {
  // P2WPKH: ~110 vbytes for 1 input, 1 output
  const estimatedSize = 110;
  return Math.ceil(estimatedSize * feeRate);
}

/**
 * Build and sign a simple transfer transaction
 */
async function buildTransferTransaction(
  fromWif: string,
  fromAddress: string,
  toAddress: string,
  amount: number,
  feeRate: number
): Promise<{ txHex: string; fee: number }> {
  const keyPair = ECPair.fromWIF(fromWif, network);
  const utxos = await getUTXOs(fromAddress);

  if (utxos.length === 0) {
    throw new Error('No UTXOs available');
  }

  // Sort by value descending
  utxos.sort((a, b) => b.value - a.value);

  // Select UTXOs
  const selected: UTXO[] = [];
  let totalSelected = 0;
  const estimatedFee = estimateSimpleTxFee(feeRate) * 2; // Overestimate

  for (const utxo of utxos) {
    selected.push(utxo);
    totalSelected += utxo.value;
    if (totalSelected >= amount + estimatedFee) {
      break;
    }
  }

  if (totalSelected < amount + estimatedFee) {
    throw new Error('Insufficient funds');
  }

  // Calculate actual fee based on selected inputs
  const inputCount = selected.length;
  const outputCount = totalSelected - amount - estimatedFee > 546 ? 2 : 1; // Change output if > dust
  const txSize = 10 + (inputCount * 68) + (outputCount * 31) + (inputCount * 27);
  const fee = Math.ceil(txSize * feeRate);

  const change = totalSelected - amount - fee;

  const psbt = new bitcoin.Psbt({ network });

  // Add inputs
  for (const utxo of selected) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network }).output!,
        value: utxo.value,
      },
    });
  }

  // Add outputs
  psbt.addOutput({
    address: toAddress,
    value: amount,
  });

  if (change > 546) {
    psbt.addOutput({
      address: fromAddress,
      value: change,
    });
  }

  // Sign all inputs
  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();

  const tx = psbt.extractTransaction();

  return {
    txHex: tx.toHex(),
    fee,
  };
}

/**
 * Rebalance wallets within a group
 */
export async function rebalanceWalletGroup(): Promise<void> {
  showSectionHeader('REBALANCE WALLET GROUP');

  const groupNames = getWalletGroupNames();
  const groupsData = loadWalletGroups();

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
    'Select wallet group to rebalance:',
    groupChoices
  );

  if (selectedGroup === '__cancel__') {
    return;
  }

  const group = groupsData?.groups[selectedGroup];
  if (!group || group.wallets.length < 2) {
    showError('Group must have at least 2 wallets to rebalance.');
    return;
  }

  // Get fee rate early for calculations
  const feeRates = await getFeeRates();
  const feeRate = feeRates.halfHourFee;

  // Calculate smart requirement (may be null if no collections assigned)
  const requirement = calculateRequiredBalance(selectedGroup, group, feeRate);

  // Select rebalance mode
  const modeChoices: Array<{ name: string; value: RebalanceMode }> = [];

  if (requirement) {
    modeChoices.push({
      name: `Smart rebalance (based on collection requirements) - ${formatBTC(requirement.requiredPerWallet)}/wallet`,
      value: 'smart',
    });
  }

  modeChoices.push({
    name: 'Equal distribution (divide total evenly)',
    value: 'equal',
  });

  modeChoices.push({
    name: 'Cancel',
    value: 'cancel',
  });

  console.log('');
  const selectedMode = await promptSelect<RebalanceMode>(
    'Select rebalance method:',
    modeChoices
  );

  if (selectedMode === 'cancel') {
    showInfo('Rebalance cancelled.');
    return;
  }

  console.log('');
  console.log('Fetching wallet balances...');
  console.log('');

  // Get balances for all wallets in the group
  const walletBalances: WalletBalance[] = [];

  for (const wallet of group.wallets) {
    try {
      const keyPair = ECPair.fromWIF(wallet.wif, network);
      const paymentAddress = bitcoin.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network,
      }).address!;

      const balance = await getBalance(paymentAddress);

      walletBalances.push({
        label: wallet.label,
        wif: wallet.wif,
        receiveAddress: wallet.receiveAddress,
        paymentAddress,
        balance: balance.total,
      });

      console.log(`  ${wallet.label.padEnd(15)} ${formatBTC(balance.total)}`);
    } catch (error: any) {
      showError(`Failed to get balance for ${wallet.label}: ${error.message}`);
      return;
    }
  }

  // Calculate total and target balance
  const totalBalance = walletBalances.reduce((sum, w) => sum + w.balance, 0);
  let targetBalance: number;

  if (selectedMode === 'smart' && requirement) {
    targetBalance = requirement.requiredPerWallet;
  } else {
    targetBalance = Math.floor(totalBalance / walletBalances.length);
  }

  console.log('');
  console.log(`Total Balance: ${formatBTC(totalBalance)}`);
  console.log(`Target per wallet: ${formatBTC(targetBalance)}`);

  // Show smart calculation breakdown if using smart mode
  if (selectedMode === 'smart' && requirement) {
    console.log('');
    displayRequirementBreakdown(requirement);

    // Warn if total balance is insufficient
    const totalRequired = targetBalance * walletBalances.length;
    if (totalBalance < totalRequired) {
      console.log('');
      showWarning(`Insufficient total balance! Need ${formatBTC(totalRequired)} but only have ${formatBTC(totalBalance)}`);
      showInfo('Will distribute available funds as evenly as possible.');
      // Fall back to equal distribution
      targetBalance = Math.floor(totalBalance / walletBalances.length);
    }
  }

  console.log('');

  const estimatedFeePerTx = estimateSimpleTxFee(feeRate);

  console.log(`Estimated fee per transfer: ${formatBTC(estimatedFeePerTx)} (${feeRate} sat/vB)`);
  console.log('');

  // Calculate transfers needed
  // Split wallets into surplus (above target) and deficit (below target)
  const surplus = walletBalances
    .filter(w => w.balance > targetBalance + MIN_TRANSFER_SATS)
    .sort((a, b) => b.balance - a.balance); // Highest first

  const deficit = walletBalances
    .filter(w => w.balance < targetBalance - MIN_TRANSFER_SATS)
    .sort((a, b) => a.balance - b.balance); // Lowest first

  if (surplus.length === 0) {
    showInfo('Wallets are already balanced (no wallet has significant surplus).');
    return;
  }

  if (deficit.length === 0) {
    showInfo('Wallets are already balanced (no wallet has significant deficit).');
    return;
  }

  // Plan transfers
  const transfers: Transfer[] = [];
  let totalFees = 0;

  // Clone arrays to avoid mutation
  const surplusCopy = surplus.map(w => ({ ...w }));
  const deficitCopy = deficit.map(w => ({ ...w }));

  for (const deficitWallet of deficitCopy) {
    const needed = targetBalance - deficitWallet.balance;

    for (const surplusWallet of surplusCopy) {
      if (surplusWallet.balance <= targetBalance) continue;

      const available = surplusWallet.balance - targetBalance - estimatedFeePerTx;
      if (available < MIN_TRANSFER_SATS) continue;

      const transferAmount = Math.min(available, needed - (deficitWallet.balance - deficitWallet.balance));
      const actualTransfer = Math.min(
        transferAmount,
        targetBalance - deficitWallet.balance
      );

      if (actualTransfer < MIN_TRANSFER_SATS) continue;

      transfers.push({
        from: surplusWallet,
        to: deficitWallet,
        amount: actualTransfer,
        fee: estimatedFeePerTx,
      });

      surplusWallet.balance -= actualTransfer + estimatedFeePerTx;
      deficitWallet.balance += actualTransfer;
      totalFees += estimatedFeePerTx;

      if (deficitWallet.balance >= targetBalance - MIN_TRANSFER_SATS) break;
    }
  }

  if (transfers.length === 0) {
    showInfo('No transfers needed or possible (differences too small).');
    return;
  }

  // Display rebalance preview
  const modeLabel = selectedMode === 'smart' ? 'SMART REBALANCE' : 'EQUAL DISTRIBUTION';
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ${modeLabel} PREVIEW - Group: ${selectedGroup}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Show wallet status
  console.log('  Current Balances:');
  for (const w of walletBalances) {
    const status = w.balance >= targetBalance - MIN_TRANSFER_SATS ? '✓ sufficient' : `✗ needs +${formatBTC(targetBalance - w.balance)}`;
    console.log(`    ${w.label.padEnd(15)} ${formatBTC(w.balance).padEnd(18)} ${status}`);
  }
  console.log('');

  console.log('  Proposed Transfers:');
  console.log('');

  for (let i = 0; i < transfers.length; i++) {
    const t = transfers[i];
    console.log(`    ${i + 1}. ${t.from.label} → ${t.to.label}: ${formatBTC(t.amount)} (fee: ~${t.fee} sats)`);
  }

  console.log('');
  console.log(`  Total transfers: ${transfers.length}`);
  console.log(`  Total fees: ~${formatBTC(totalFees)}`);
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Confirm
  const confirm = await promptConfirm('Execute rebalance transfers?', false);

  if (!confirm) {
    showWarning('Rebalance cancelled.');
    return;
  }

  console.log('');
  console.log('Executing transfers...');
  console.log('');

  // Execute transfers one by one
  let successCount = 0;
  let failedCount = 0;

  for (let i = 0; i < transfers.length; i++) {
    const t = transfers[i];
    console.log(`[${i + 1}/${transfers.length}] ${t.from.label} → ${t.to.label}: ${formatBTC(t.amount)}...`);

    try {
      const { txHex, fee } = await buildTransferTransaction(
        t.from.wif,
        t.from.paymentAddress,
        t.to.paymentAddress,
        t.amount,
        feeRate
      );

      const txid = await broadcastTransaction(txHex);
      showSuccess(`  TX: ${txid}`);
      successCount++;

      // Wait a bit between transactions to avoid issues
      if (i < transfers.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error: any) {
      showError(`  Failed: ${error.message}`);
      failedCount++;

      // Ask if user wants to continue after failure
      if (i < transfers.length - 1) {
        const continueOnError = await promptConfirm('Continue with remaining transfers?', true);
        if (!continueOnError) {
          showWarning('Rebalance aborted.');
          break;
        }
      }
    }
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  REBALANCE COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  showInfo(`Successful: ${successCount} | Failed: ${failedCount}`);
  console.log('');

  if (successCount > 0) {
    console.log('Note: It may take a few minutes for balances to update after confirmation.');
  }
}

interface GroupRebalanceInfo {
  groupName: string;
  walletCount: number;
  collectionCount: number;
  requirement: RequirementBreakdown | null;
  walletBalances: WalletBalance[];
  totalBalance: number;
  targetBalance: number;
  transfers: Transfer[];
  totalFees: number;
}

/**
 * Rebalance all wallet groups using smart calculation
 */
export async function rebalanceAllWalletGroups(): Promise<void> {
  showSectionHeader('REBALANCE ALL WALLET GROUPS');

  const groupNames = getWalletGroupNames();
  const groupsData = loadWalletGroups();

  if (groupNames.length === 0) {
    showError('No wallet groups exist.');
    return;
  }

  // Get fee rate
  const feeRates = await getFeeRates();
  const feeRate = feeRates.halfHourFee;
  const estimatedFeePerTx = estimateSimpleTxFee(feeRate);

  console.log('');
  console.log('Analyzing all wallet groups...');
  console.log('');

  // Analyze each group
  const groupInfos: GroupRebalanceInfo[] = [];

  for (const groupName of groupNames) {
    const group = groupsData?.groups[groupName];
    if (!group) continue;

    const collections = getCollectionsByGroup(groupName);
    const requirement = calculateRequiredBalance(groupName, group, feeRate);

    // Skip groups with less than 2 wallets
    if (group.wallets.length < 2) {
      console.log(`  ${groupName}: Skipping (only ${group.wallets.length} wallet)`);
      continue;
    }

    // Fetch balances
    const walletBalances: WalletBalance[] = [];

    for (const wallet of group.wallets) {
      try {
        const keyPair = ECPair.fromWIF(wallet.wif, network);
        const paymentAddress = bitcoin.payments.p2wpkh({
          pubkey: keyPair.publicKey,
          network,
        }).address!;

        const balance = await getBalance(paymentAddress);

        walletBalances.push({
          label: wallet.label,
          wif: wallet.wif,
          receiveAddress: wallet.receiveAddress,
          paymentAddress,
          balance: balance.total,
        });
      } catch (error: any) {
        showError(`Failed to get balance for ${wallet.label} in ${groupName}: ${error.message}`);
        continue;
      }
    }

    const totalBalance = walletBalances.reduce((sum, w) => sum + w.balance, 0);

    // Determine target balance
    let targetBalance: number;
    if (requirement) {
      targetBalance = requirement.requiredPerWallet;
      // If insufficient funds, fall back to equal distribution
      const totalRequired = targetBalance * walletBalances.length;
      if (totalBalance < totalRequired) {
        targetBalance = Math.floor(totalBalance / walletBalances.length);
      }
    } else {
      targetBalance = Math.floor(totalBalance / walletBalances.length);
    }

    // Calculate transfers
    const surplus = walletBalances
      .filter(w => w.balance > targetBalance + MIN_TRANSFER_SATS)
      .sort((a, b) => b.balance - a.balance);

    const deficit = walletBalances
      .filter(w => w.balance < targetBalance - MIN_TRANSFER_SATS)
      .sort((a, b) => a.balance - b.balance);

    const transfers: Transfer[] = [];
    let totalFees = 0;

    if (surplus.length > 0 && deficit.length > 0) {
      const surplusCopy = surplus.map(w => ({ ...w }));
      const deficitCopy = deficit.map(w => ({ ...w }));

      for (const deficitWallet of deficitCopy) {
        for (const surplusWallet of surplusCopy) {
          if (surplusWallet.balance <= targetBalance) continue;

          const available = surplusWallet.balance - targetBalance - estimatedFeePerTx;
          if (available < MIN_TRANSFER_SATS) continue;

          const actualTransfer = Math.min(
            available,
            targetBalance - deficitWallet.balance
          );

          if (actualTransfer < MIN_TRANSFER_SATS) continue;

          transfers.push({
            from: surplusWallet,
            to: deficitWallet,
            amount: actualTransfer,
            fee: estimatedFeePerTx,
          });

          surplusWallet.balance -= actualTransfer + estimatedFeePerTx;
          deficitWallet.balance += actualTransfer;
          totalFees += estimatedFeePerTx;

          if (deficitWallet.balance >= targetBalance - MIN_TRANSFER_SATS) break;
        }
      }
    }

    groupInfos.push({
      groupName,
      walletCount: walletBalances.length,
      collectionCount: collections.length,
      requirement,
      walletBalances,
      totalBalance,
      targetBalance,
      transfers,
      totalFees,
    });

    console.log(`  ${groupName}: ${walletBalances.length} wallets, ${collections.length} collections, ${transfers.length} transfers needed`);
  }

  if (groupInfos.length === 0) {
    showError('No groups available to rebalance.');
    return;
  }

  // Display combined preview
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  REBALANCE ALL WALLET GROUPS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  let totalTransfersCount = 0;
  let totalFeesAll = 0;

  for (const info of groupInfos) {
    const mode = info.requirement ? 'Smart' : 'Equal';
    console.log(`  GROUP: ${info.groupName} (${info.walletCount} wallets, ${info.collectionCount} collections)`);
    console.log('  ────────────────────────────────────────────');
    console.log(`    Mode: ${mode} distribution`);
    console.log(`    Required per wallet: ${formatBTC(info.targetBalance)}`);

    if (info.transfers.length === 0) {
      console.log('    Transfers needed: 0 (already balanced)');
    } else {
      console.log(`    Transfers needed: ${info.transfers.length}`);
      for (const t of info.transfers) {
        console.log(`      • ${t.from.label} → ${t.to.label}: ${formatBTC(t.amount)}`);
      }
      totalTransfersCount += info.transfers.length;
      totalFeesAll += info.totalFees;
    }
    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`    Total groups: ${groupInfos.length}`);
  console.log(`    Total transfers: ${totalTransfersCount}`);
  console.log(`    Total fees: ~${formatBTC(totalFeesAll)}`);
  console.log('');

  if (totalTransfersCount === 0) {
    showInfo('All groups are already balanced. No transfers needed.');
    return;
  }

  // Confirm
  const confirm = await promptConfirm('Proceed with all transfers?', false);

  if (!confirm) {
    showWarning('Rebalance cancelled.');
    return;
  }

  console.log('');
  console.log('Executing transfers...');
  console.log('');

  // Execute transfers for each group
  let totalSuccessCount = 0;
  let totalFailedCount = 0;

  for (const info of groupInfos) {
    if (info.transfers.length === 0) continue;

    console.log(`\n[Group: ${info.groupName}]`);

    for (let i = 0; i < info.transfers.length; i++) {
      const t = info.transfers[i];
      console.log(`  [${i + 1}/${info.transfers.length}] ${t.from.label} → ${t.to.label}: ${formatBTC(t.amount)}...`);

      try {
        const { txHex } = await buildTransferTransaction(
          t.from.wif,
          t.from.paymentAddress,
          t.to.paymentAddress,
          t.amount,
          feeRate
        );

        const txid = await broadcastTransaction(txHex);
        showSuccess(`    TX: ${txid}`);
        totalSuccessCount++;

        // Wait between transactions
        if (i < info.transfers.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error: any) {
        showError(`    Failed: ${error.message}`);
        totalFailedCount++;
      }
    }
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  REBALANCE ALL COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  showInfo(`Successful: ${totalSuccessCount} | Failed: ${totalFailedCount}`);
  console.log('');

  if (totalSuccessCount > 0) {
    console.log('Note: It may take a few minutes for balances to update after confirmation.');
  }
}
