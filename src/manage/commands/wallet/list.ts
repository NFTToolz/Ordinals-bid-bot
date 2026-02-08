import { config } from 'dotenv';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import { loadWallets, getWalletFromWIF, isGroupsFormat, getAllWalletsFromGroups } from '../../services/WalletGenerator';
import { getAllBalances, calculateTotalBalance, AddressBalance } from '../../services/BalanceService';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  formatBTC,
  withSpinner,
  getSeparatorWidth,
} from '../../utils/display';
import { TableColumn, TableData } from '../../utils/table';
import { showInteractiveTable } from '../../utils/interactiveTable';
import { ensureWalletPasswordIfNeeded } from '../../utils/walletPassword';

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

  // Ensure encryption password is available if wallets.json is encrypted
  if (!(await ensureWalletPasswordIfNeeded())) {
    return;
  }

  const allWallets: Array<{
    label: string;
    paymentAddress: string;
    receiveAddress?: string;
  }> = [];

  // Add main wallet from .env
  const FUNDING_WIF = process.env.FUNDING_WIF;
  const TOKEN_RECEIVE_ADDRESS = process.env.TOKEN_RECEIVE_ADDRESS;
  let mainWalletPaymentAddress: string | undefined;

  if (FUNDING_WIF) {
    try {
      const mainWallet = getWalletFromWIF(FUNDING_WIF, network);
      mainWalletPaymentAddress = mainWallet.paymentAddress;
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
  const walletsData = loadWallets();
  if (walletsData) {
    if (isGroupsFormat(walletsData)) {
      // Groups format - get all wallets from all groups
      const groupWallets = getAllWalletsFromGroups();
      groupWallets.forEach(w => {
        try {
          const walletInfo = getWalletFromWIF(w.wif, network);
          // Skip wallets that duplicate the main wallet
          if (mainWalletPaymentAddress && walletInfo.paymentAddress === mainWalletPaymentAddress) {
            return;
          }
          allWallets.push({
            label: w.label,
            paymentAddress: walletInfo.paymentAddress,
            receiveAddress: w.receiveAddress,
          });
        } catch (error) {
          showWarning(`Could not load wallet: ${w.label}`);
        }
      });
    } else if (walletsData.wallets?.length > 0) {
      // Legacy format
      walletsData.wallets.forEach(w => {
        try {
          const walletInfo = getWalletFromWIF(w.wif, network);
          // Skip wallets that duplicate the main wallet
          if (mainWalletPaymentAddress && walletInfo.paymentAddress === mainWalletPaymentAddress) {
            return;
          }
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

  // Build table data for interactive display
  const columns: TableColumn[] = [
    { key: 'label', label: 'Label', width: 30 },
    { key: 'address', label: 'Payment Address', width: 22 },
    { key: 'balance', label: 'Balance', width: 20, align: 'right' },
    { key: 'balanceSats', label: 'Sats', width: 14, align: 'right' },
    { key: 'utxos', label: 'UTXOs', width: 8, align: 'right' },
  ];

  const rows = allWallets.map(w => {
    const balance = balanceMap.get(w.paymentAddress);
    return {
      label: w.label.length > 28 ? w.label.slice(0, 25) + '...' : w.label,
      address: w.paymentAddress.slice(0, 8) + '...' + w.paymentAddress.slice(-6),
      fullAddress: w.paymentAddress,
      balance: balance ? formatBTC(balance.total) : '0.00000000 BTC',
      balanceSats: balance ? balance.total : 0,
      utxos: balance ? balance.utxoCount : 0,
    };
  });

  const tableData: TableData = { columns, rows };

  // Show summary first
  const totals = calculateTotalBalance(balances);
  console.log('');
  console.log('━'.repeat(getSeparatorWidth()));
  console.log(`  Total Confirmed:   ${formatBTC(totals.confirmed)}`);
  if (totals.unconfirmed !== 0) {
    console.log(`  Pending:           ${formatBTC(totals.unconfirmed)}`);
  }
  console.log(`  Total:             ${formatBTC(totals.total)}`);
  console.log('━'.repeat(getSeparatorWidth()));
  console.log('');

  // Show interactive table
  await showInteractiveTable(tableData, {
    title: 'WALLET BALANCES',
    pageSize: 15,
    allowSort: true,
    allowExport: true,
    exportBaseName: 'wallets',
  });
}

export async function getWalletsWithBalances(): Promise<WalletWithBalance[]> {
  const result: WalletWithBalance[] = [];

  // Main wallet
  const FUNDING_WIF = process.env.FUNDING_WIF;
  const TOKEN_RECEIVE_ADDRESS = process.env.TOKEN_RECEIVE_ADDRESS;
  let mainWalletPaymentAddress: string | undefined;

  if (FUNDING_WIF) {
    try {
      const mainWallet = getWalletFromWIF(FUNDING_WIF, network);
      mainWalletPaymentAddress = mainWallet.paymentAddress;
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
  const walletsData = loadWallets();
  if (walletsData) {
    const addresses: string[] = [];
    const walletData: Array<{ label: string; paymentAddress: string; receiveAddress: string }> = [];

    // Get wallets from either groups format or legacy format
    let configWallets: Array<{ label: string; wif: string; receiveAddress: string }> = [];
    if (isGroupsFormat(walletsData)) {
      configWallets = getAllWalletsFromGroups();
    } else if (walletsData.wallets?.length > 0) {
      configWallets = walletsData.wallets;
    }

    configWallets.forEach(w => {
      try {
        const walletInfo = getWalletFromWIF(w.wif, network);
        // Skip wallets that duplicate the main wallet
        if (mainWalletPaymentAddress && walletInfo.paymentAddress === mainWalletPaymentAddress) {
          return;
        }
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
      balances.forEach(b => balanceMap.set(b.address.toLowerCase(), b));

      walletData.forEach(w => {
        const balance = balanceMap.get(w.paymentAddress.toLowerCase());
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
