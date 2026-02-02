import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import axios from 'axios';
import { UTXO, getUTXOs, getFeeRates, getAllUTXOs } from './BalanceService';

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

const MEMPOOL_API = 'https://mempool.space/api';

export interface TransactionRecipient {
  address: string;
  amount: number;
}

export interface TransactionResult {
  txid: string;
  hex: string;
  fee: number;
  size: number;
}

export interface TransactionPreview {
  inputs: Array<{ txid: string; vout: number; value: number }>;
  outputs: Array<{ address: string; amount: number }>;
  fee: number;
  feeRate: number;
  totalInput: number;
  totalOutput: number;
  change: number;
}

/**
 * Estimate transaction size for P2WPKH inputs and outputs
 */
export function estimateTransactionSize(inputCount: number, outputCount: number): number {
  // P2WPKH transaction size estimation
  // Header: 10 bytes (version + locktime)
  // Input: ~68 bytes each (P2WPKH)
  // Output: ~31 bytes each (P2WPKH)
  // Witness: ~27 bytes per input
  return 10 + (inputCount * 68) + (outputCount * 31) + (inputCount * 27);
}

/**
 * Select UTXOs for a transaction using a simple algorithm
 */
export function selectUTXOs(utxos: UTXO[], targetAmount: number, feeRate: number): { selected: UTXO[]; fee: number } | null {
  // Sort UTXOs by value (largest first)
  const sorted = [...utxos].sort((a, b) => b.value - a.value);

  const selected: UTXO[] = [];
  let totalSelected = 0;

  for (const utxo of sorted) {
    selected.push(utxo);
    totalSelected += utxo.value;

    // Estimate fee with current selection (assuming 2 outputs: recipient + change)
    const estimatedSize = estimateTransactionSize(selected.length, 2);
    const estimatedFee = Math.ceil(estimatedSize * feeRate);

    if (totalSelected >= targetAmount + estimatedFee) {
      return { selected, fee: estimatedFee };
    }
  }

  return null; // Insufficient funds
}

/**
 * Build a distribution transaction (one sender, multiple recipients)
 */
export async function buildDistributionTransaction(
  senderWIF: string,
  senderAddress: string,
  recipients: TransactionRecipient[],
  feeRate?: number,
  network: bitcoin.Network = bitcoin.networks.bitcoin
): Promise<TransactionPreview> {
  // Get fee rate if not provided
  if (!feeRate) {
    const rates = await getFeeRates();
    feeRate = rates.halfHourFee;
  }

  // Get UTXOs for sender
  const utxos = await getUTXOs(senderAddress);
  if (utxos.length === 0) {
    throw new Error('No UTXOs available');
  }

  // Calculate total amount to send
  const totalToSend = recipients.reduce((sum, r) => sum + r.amount, 0);

  // Select UTXOs
  const outputCount = recipients.length + 1; // recipients + change
  const selection = selectUTXOs(utxos, totalToSend, feeRate);

  if (!selection) {
    throw new Error('Insufficient funds');
  }

  const totalInput = selection.selected.reduce((sum, u) => sum + u.value, 0);
  const change = totalInput - totalToSend - selection.fee;

  if (change < 0) {
    throw new Error('Insufficient funds after fees');
  }

  return {
    inputs: selection.selected.map(u => ({ txid: u.txid, vout: u.vout, value: u.value })),
    outputs: [
      ...recipients.map(r => ({ address: r.address, amount: r.amount })),
      ...(change > 546 ? [{ address: senderAddress, amount: change }] : []), // Dust threshold
    ],
    fee: selection.fee + (change <= 546 ? change : 0), // Add dust to fee
    feeRate,
    totalInput,
    totalOutput: totalToSend + (change > 546 ? change : 0),
    change: change > 546 ? change : 0,
  };
}

/**
 * Build and sign a distribution transaction
 */
export async function signAndBroadcastDistribution(
  senderWIF: string,
  senderAddress: string,
  recipients: TransactionRecipient[],
  feeRate?: number,
  network: bitcoin.Network = bitcoin.networks.bitcoin
): Promise<TransactionResult> {
  const preview = await buildDistributionTransaction(senderWIF, senderAddress, recipients, feeRate, network);

  const keyPair = ECPair.fromWIF(senderWIF, network);
  const psbt = new bitcoin.Psbt({ network });

  // Add inputs
  for (const input of preview.inputs) {
    const txHex = await getTransactionHex(input.txid);
    psbt.addInput({
      hash: input.txid,
      index: input.vout,
      witnessUtxo: {
        script: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network }).output!,
        value: input.value,
      },
    });
  }

  // Add outputs
  for (const output of preview.outputs) {
    psbt.addOutput({
      address: output.address,
      value: output.amount,
    });
  }

  // Sign all inputs
  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();

  const tx = psbt.extractTransaction();
  const txHex = tx.toHex();
  const txid = tx.getId();

  // Broadcast
  await broadcastTransaction(txHex);

  return {
    txid,
    hex: txHex,
    fee: preview.fee,
    size: tx.virtualSize(),
  };
}

/**
 * Build a consolidation transaction (multiple senders, one recipient)
 */
export async function buildConsolidationTransaction(
  wallets: Array<{ wif: string; address: string }>,
  destinationAddress: string,
  feeRate?: number,
  network: bitcoin.Network = bitcoin.networks.bitcoin
): Promise<TransactionPreview> {
  // Get fee rate if not provided
  if (!feeRate) {
    const rates = await getFeeRates();
    feeRate = rates.halfHourFee;
  }

  // Get all UTXOs
  const allUtxosMap = await getAllUTXOs(wallets.map(w => w.address));

  const allInputs: Array<{
    utxo: UTXO;
    wif: string;
    address: string;
  }> = [];

  wallets.forEach(wallet => {
    const utxos = allUtxosMap.get(wallet.address) || [];
    utxos.forEach(utxo => {
      allInputs.push({
        utxo,
        wif: wallet.wif,
        address: wallet.address,
      });
    });
  });

  if (allInputs.length === 0) {
    throw new Error('No UTXOs available across all wallets');
  }

  // Calculate total
  const totalInput = allInputs.reduce((sum, i) => sum + i.utxo.value, 0);

  // Estimate fee
  const estimatedSize = estimateTransactionSize(allInputs.length, 1);
  const fee = Math.ceil(estimatedSize * feeRate);

  const totalOutput = totalInput - fee;

  if (totalOutput <= 546) {
    throw new Error('Insufficient funds after fees');
  }

  return {
    inputs: allInputs.map(i => ({ txid: i.utxo.txid, vout: i.utxo.vout, value: i.utxo.value })),
    outputs: [{ address: destinationAddress, amount: totalOutput }],
    fee,
    feeRate,
    totalInput,
    totalOutput,
    change: 0,
  };
}

/**
 * Build and sign a consolidation transaction
 */
export async function signAndBroadcastConsolidation(
  wallets: Array<{ wif: string; address: string }>,
  destinationAddress: string,
  feeRate?: number,
  network: bitcoin.Network = bitcoin.networks.bitcoin
): Promise<TransactionResult> {
  // Get fee rate if not provided
  if (!feeRate) {
    const rates = await getFeeRates();
    feeRate = rates.halfHourFee;
  }

  // Get all UTXOs
  const allUtxosMap = await getAllUTXOs(wallets.map(w => w.address));

  const allInputs: Array<{
    utxo: UTXO;
    keyPair: ReturnType<typeof ECPair.fromWIF>;
    address: string;
  }> = [];

  wallets.forEach(wallet => {
    const utxos = allUtxosMap.get(wallet.address) || [];
    const keyPair = ECPair.fromWIF(wallet.wif, network);
    utxos.forEach(utxo => {
      allInputs.push({
        utxo,
        keyPair,
        address: wallet.address,
      });
    });
  });

  if (allInputs.length === 0) {
    throw new Error('No UTXOs available across all wallets');
  }

  // Calculate total and fee
  const totalInput = allInputs.reduce((sum, i) => sum + i.utxo.value, 0);
  const estimatedSize = estimateTransactionSize(allInputs.length, 1);
  const fee = Math.ceil(estimatedSize * feeRate);
  const totalOutput = totalInput - fee;

  if (totalOutput <= 546) {
    throw new Error('Insufficient funds after fees');
  }

  const psbt = new bitcoin.Psbt({ network });

  // Add inputs
  for (const input of allInputs) {
    psbt.addInput({
      hash: input.utxo.txid,
      index: input.utxo.vout,
      witnessUtxo: {
        script: bitcoin.payments.p2wpkh({ pubkey: input.keyPair.publicKey, network }).output!,
        value: input.utxo.value,
      },
    });
  }

  // Add single output
  psbt.addOutput({
    address: destinationAddress,
    value: totalOutput,
  });

  // Sign each input with corresponding key
  allInputs.forEach((input, index) => {
    psbt.signInput(index, input.keyPair);
  });

  psbt.finalizeAllInputs();

  const tx = psbt.extractTransaction();
  const txHex = tx.toHex();
  const txid = tx.getId();

  // Broadcast
  await broadcastTransaction(txHex);

  return {
    txid,
    hex: txHex,
    fee,
    size: tx.virtualSize(),
  };
}

/**
 * Get raw transaction hex
 */
async function getTransactionHex(txid: string): Promise<string> {
  const response = await axios.get(`${MEMPOOL_API}/tx/${txid}/hex`);
  return response.data;
}

/**
 * Broadcast a signed transaction
 */
export async function broadcastTransaction(txHex: string): Promise<string> {
  try {
    const response = await axios.post(`${MEMPOOL_API}/tx`, txHex, {
      headers: { 'Content-Type': 'text/plain' },
    });
    return response.data;
  } catch (error: any) {
    const message = error.response?.data || error.message;
    throw new Error(`Broadcast failed: ${message}`);
  }
}
