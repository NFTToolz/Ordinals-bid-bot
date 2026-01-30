import { config } from 'dotenv';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import { loadWallets, getWalletFromWIF } from '../../services/WalletGenerator';
import { getAllBalances, calculateTotalBalance, AddressBalance } from '../../services/BalanceService';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showTable,
  formatBTC,
  withSpinner,
} from '../../utils/display';

config();

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);
const network = bitcoin.networks.bitcoin;

export interface WalletWithBalance {
  label: string;
  paymentAddress: string;
  receiveAddress: string;
  balance: AddressBalance;
}

export async function listWallets(): Promise<void> {
  showSectionHeader('WALLET BALANCES');

  const allWallets: Array<{
    label: string;
    paymentAddress: string;
    receiveAddress?: string;
  }> = [];

  // Add main wallet from .env
  const FUNDING_WIF = process.env.FUNDING_WIF;
  const TOKEN_RECEIVE_ADDRESS = process.env.TOKEN_RECEIVE_ADDRESS;

  if (FUNDING_WIF) {
    try {
      const mainWallet = getWalletFromWIF(FUNDING_WIF, network);
      allWallets.push({
        label: 'Main Wallet (FUNDING_WIF)',
        paymentAddress: mainWallet.paymentAddress,
        receiveAddress: TOKEN_RECEIVE_ADDRESS,
      });
    } catch (error) {
      showWarning('Could not load main wallet from FUNDING_WIF');
    }
  } else {
    showWarning('FUNDING_WIF not set in .env');
  }

  // Add wallets from config
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
        showWarning(`Could not load wallet: ${w.label}`);
      }
    });
  }

  if (allWallets.length === 0) {
    showError('No wallets found');
    console.log('');
    console.log('To add wallets:');
    console.log('  1. Set FUNDING_WIF in your .env file');
    console.log('  2. Use "Create new wallets" to generate bidding wallets');
    return;
  }

  // Fetch balances
  const addresses = allWallets.map(w => w.paymentAddress);

  console.log(`Fetching balances for ${addresses.length} wallet(s)...`);
  console.log('');

  const balances = await withSpinner(
    'Fetching balances...',
    () => getAllBalances(addresses)
  );

  // Create balance map
  const balanceMap = new Map<string, AddressBalance>();
  balances.forEach(b => balanceMap.set(b.address, b));

  // Display table
  const headers = ['Label', 'Payment Address', 'Balance', 'UTXOs'];
  const rows: string[][] = [];

  allWallets.forEach(w => {
    const balance = balanceMap.get(w.paymentAddress);
    rows.push([
      w.label.length > 25 ? w.label.slice(0, 22) + '...' : w.label,
      w.paymentAddress.slice(0, 8) + '...' + w.paymentAddress.slice(-6),
      balance ? formatBTC(balance.total) : '0.00000000 BTC',
      balance ? balance.utxoCount.toString() : '0',
    ]);
  });

  showTable(headers, rows, [28, 20, 18, 6]);

  // Summary
  const totals = calculateTotalBalance(balances);
  console.log('');
  console.log('━'.repeat(60));
  console.log(`  Total Confirmed:   ${formatBTC(totals.confirmed)}`);
  if (totals.unconfirmed !== 0) {
    console.log(`  Pending:           ${formatBTC(totals.unconfirmed)}`);
  }
  console.log(`  Total:             ${formatBTC(totals.total)}`);
  console.log('━'.repeat(60));
  console.log('');
}

export async function getWalletsWithBalances(): Promise<WalletWithBalance[]> {
  const result: WalletWithBalance[] = [];

  // Main wallet
  const FUNDING_WIF = process.env.FUNDING_WIF;
  const TOKEN_RECEIVE_ADDRESS = process.env.TOKEN_RECEIVE_ADDRESS;

  if (FUNDING_WIF) {
    try {
      const mainWallet = getWalletFromWIF(FUNDING_WIF, network);
      const [balance] = await getAllBalances([mainWallet.paymentAddress]);
      result.push({
        label: 'Main Wallet',
        paymentAddress: mainWallet.paymentAddress,
        receiveAddress: TOKEN_RECEIVE_ADDRESS || '',
        balance,
      });
    } catch (error) {
      // Skip
    }
  }

  // Config wallets
  const walletsConfig = loadWallets();
  if (walletsConfig && walletsConfig.wallets.length > 0) {
    const addresses: string[] = [];
    const walletData: Array<{ label: string; paymentAddress: string; receiveAddress: string }> = [];

    walletsConfig.wallets.forEach(w => {
      try {
        const walletInfo = getWalletFromWIF(w.wif, network);
        addresses.push(walletInfo.paymentAddress);
        walletData.push({
          label: w.label,
          paymentAddress: walletInfo.paymentAddress,
          receiveAddress: w.receiveAddress,
        });
      } catch (error) {
        // Skip
      }
    });

    if (addresses.length > 0) {
      const balances = await getAllBalances(addresses);
      const balanceMap = new Map<string, AddressBalance>();
      balances.forEach(b => balanceMap.set(b.address, b));

      walletData.forEach(w => {
        const balance = balanceMap.get(w.paymentAddress);
        if (balance) {
          result.push({
            label: w.label,
            paymentAddress: w.paymentAddress,
            receiveAddress: w.receiveAddress,
            balance,
          });
        }
      });
    }
  }

  return result;
}
