import { config } from 'dotenv';
import { loadWallets, getWalletFromWIF, isGroupsFormat, getAllWalletsFromGroups } from '../../services/WalletGenerator';
import {
  getInscriptionsForAddresses,
  formatInscription,
  InscriptionsByAddress,
  getTokensForAddressesFromMagicEden,
  formatMagicEdenToken,
  MagicEdenToken,
  FormattedMagicEdenToken,
} from '../../services/OrdinalsService';
import {
  showSectionHeader,
  showSuccess,
  showWarning,
  showError,
  showInfo,
  showTable,
  withSpinner,
  getSeparatorWidth,
} from '../../utils/display';
import { promptSelect, promptMultiWalletSelect } from '../../utils/prompts';
import { ensureWalletPasswordIfNeeded } from '../../utils/walletPassword';
import * as bitcoin from 'bitcoinjs-lib';
import chalk = require('chalk');

config();

const network = bitcoin.networks.bitcoin;

interface WalletTokenResult {
  address: string;
  label: string;
  tokens: FormattedMagicEdenToken[];
  total: number;
}

export async function viewOrdinals(): Promise<void> {
  showSectionHeader('VIEW ORDINALS/NFTs');

  // Ensure encryption password is available if wallets.json is encrypted
  if (!(await ensureWalletPasswordIfNeeded())) {
    return;
  }

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
  const walletsData = loadWallets();
  if (walletsData) {
    let configWallets: Array<{ label: string; wif: string; receiveAddress: string }> = [];
    if (isGroupsFormat(walletsData)) {
      configWallets = getAllWalletsFromGroups();
    } else if (walletsData.wallets?.length > 0) {
      configWallets = walletsData.wallets;
    }
    configWallets.forEach(w => {
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
  const scope = await promptSelect<'all' | 'select' | '__cancel__'>(
    'Which wallets to scan?',
    [
      { name: `All wallets (${allWallets.length})`, value: 'all' },
      { name: 'Select specific wallets', value: 'select' },
      { name: '← Back', value: '__cancel__' },
    ]
  );

  if (scope === '__cancel__') {
    return;
  }

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

    selectedWallets = allWallets.filter(w =>
      selected.some(s => s.toLowerCase() === w.receiveAddress.toLowerCase())
    );
  }

  // Scan for tokens/inscriptions
  console.log('');
  console.log(`Scanning ${selectedWallets.length} wallet(s) for NFTs...`);
  console.log('');

  const addresses = selectedWallets.map(w => w.receiveAddress);
  const API_KEY = process.env.API_KEY;

  let walletResults: WalletTokenResult[] = [];
  let usedMagicEden = false;

  // Try Magic Eden API first if API_KEY is configured
  if (API_KEY) {
    try {
      const meResults = await withSpinner(
        'Fetching NFTs from Magic Eden API...',
        () => getTokensForAddressesFromMagicEden(addresses)
      );

      walletResults = meResults.map(result => {
        const wallet = selectedWallets.find(w => w.receiveAddress.toLowerCase() === result.address.toLowerCase());
        return {
          address: result.address,
          label: wallet?.label || 'Unknown',
          tokens: result.tokens.map(t => formatMagicEdenToken(t)),
          total: result.total,
        };
      });
      usedMagicEden = true;
    } catch (error: any) {
      showWarning(`Magic Eden API failed: ${error.message}`);
      showInfo('Falling back to Hiro API...');
      console.log('');
    }
  }

  // Fallback to Hiro API
  if (!usedMagicEden) {
    const hiroResults = await withSpinner(
      'Fetching inscriptions from Hiro API...',
      () => getInscriptionsForAddresses(addresses)
    );

    // Display Hiro results in old format
    displayHiroResults(hiroResults, selectedWallets);
    return;
  }

  // Display Magic Eden results
  let totalNFTs = 0;
  const allTokens: Array<{ wallet: string; token: FormattedMagicEdenToken }> = [];

  walletResults.forEach(result => {
    if (result.total > 0) {
      console.log('');
      console.log(`━━━ ${result.label} (${result.total} NFT${result.total === 1 ? '' : 's'}) ━━━`);
      console.log(`    ${result.address}`);
      console.log('');

      const headers = ['Collection', 'Name', 'Type', 'Rarity', 'Value', 'Listed', 'Last Sale'];
      const rows = result.tokens.slice(0, 20).map(token => {
        allTokens.push({ wallet: result.label, token });
        return [
          token.collection,
          token.name,
          token.type,
          token.rarity,
          token.value,
          token.listedPrice,
          token.lastSalePrice,
        ];
      });

      showTable(headers, rows, [14, 14, 8, 8, 12, 10, 10]);

      if (result.total > 20) {
        console.log(`  ... and ${result.total - 20} more NFTs`);
        // Add remaining tokens to allTokens for detail view
        result.tokens.slice(20).forEach(token => {
          allTokens.push({ wallet: result.label, token });
        });
      }

      totalNFTs += result.total;
    }
  });

  // Summary
  console.log('');
  console.log('━'.repeat(getSeparatorWidth()));
  console.log(`  Total NFTs found: ${totalNFTs}`);
  console.log('━'.repeat(getSeparatorWidth()));
  console.log('');

  if (totalNFTs === 0) {
    console.log('No NFTs found in the scanned wallets.');
    console.log('');
    return;
  }

  // Offer detail view
  await promptForDetailView(allTokens);
}

/**
 * Display Hiro API results (fallback format)
 */
function displayHiroResults(
  results: InscriptionsByAddress[],
  selectedWallets: Array<{ label: string; receiveAddress: string }>
): void {
  let totalInscriptions = 0;

  results.forEach(result => {
    const wallet = selectedWallets.find(w => w.receiveAddress.toLowerCase() === result.address.toLowerCase());
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
  console.log('━'.repeat(getSeparatorWidth()));
  console.log(`  Total inscriptions found: ${totalInscriptions}`);
  console.log('━'.repeat(getSeparatorWidth()));
  console.log('');

  if (totalInscriptions === 0) {
    console.log('No inscriptions found in the scanned wallets.');
    console.log('');
  }
}

/**
 * Prompt user to view NFT details
 */
async function promptForDetailView(
  allTokens: Array<{ wallet: string; token: FormattedMagicEdenToken }>
): Promise<void> {
  while (true) {
    const viewDetails = await promptSelect<'select' | 'exit'>(
      'View NFT details?',
      [
        { name: 'Select an NFT to view details', value: 'select' },
        { name: 'Exit', value: 'exit' },
      ]
    );

    if (viewDetails === 'exit') {
      break;
    }

    // Build selection list
    const choices = allTokens.map((item, index) => ({
      name: `${item.token.collection} - ${item.token.name} (${item.wallet})`,
      value: index.toString(),
    }));
    choices.push({ name: 'Cancel', value: '-1' });

    const selected = await promptSelect<string>(
      'Select NFT:',
      choices
    );

    const selectedIndex = parseInt(selected, 10);
    if (selectedIndex < 0 || selectedIndex >= allTokens.length) {
      continue;
    }

    // Show detail view
    const item = allTokens[selectedIndex];
    displayNFTDetail(item.token, item.wallet);
  }
}

/**
 * Display detailed NFT information
 */
function displayNFTDetail(token: FormattedMagicEdenToken, wallet: string): void {
  const fullToken = token.fullToken;

  console.log('');
  console.log(chalk.bold('━━━ NFT Details ━━━'));
  console.log('');
  console.log(`  ${chalk.dim('Name:')}       ${fullToken.displayName || fullToken.meta?.name || 'Unknown'}`);
  console.log(`  ${chalk.dim('Collection:')} ${fullToken.collection?.name || fullToken.collectionSymbol || '-'}`);
  console.log(`  ${chalk.dim('ID:')}         ${fullToken.id}`);
  console.log(`  ${chalk.dim('Type:')}       ${fullToken.contentType || 'unknown'}`);
  console.log(`  ${chalk.dim('Rarity:')}     ${fullToken.satRarity || 'common'}`);
  console.log(`  ${chalk.dim('Value:')}      ${(fullToken.outputValue / 100000000).toFixed(8)} BTC`);
  console.log(`  ${chalk.dim('Listed:')}     ${fullToken.listed ? chalk.green('Yes') + ` (${(fullToken.listedPrice! / 100000000).toFixed(5)} BTC)` : chalk.dim('No')}`);

  if (fullToken.lastSalePrice) {
    console.log(`  ${chalk.dim('Last Sale:')} ${(fullToken.lastSalePrice / 100000000).toFixed(5)} BTC`);
  }

  console.log(`  ${chalk.dim('Wallet:')}     ${wallet}`);

  // Display traits if available
  const traits = fullToken.meta?.attributes;
  if (traits && traits.length > 0) {
    console.log('');
    console.log(chalk.bold('  Traits:'));
    traits.forEach(trait => {
      console.log(`    ${chalk.dim('•')} ${trait.trait_type}: ${trait.value}`);
    });
  }

  console.log('');
  console.log('━'.repeat(getSeparatorWidth()));
  console.log('');
}
