import {
  generateMnemonic,
  validateMnemonic,
  deriveWallets,
  addWalletsToConfig,
  getNextWalletIndex,
  loadWallets,
  isGroupsFormat,
  getAllWalletsFromGroups,
} from '../../services/WalletGenerator';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showImportantBox,
  showTable,
} from '../../utils/display';
import {
  promptInteger,
  promptSelect,
  promptText,
  promptPassword,
  promptConfirm,
  promptContinue,
} from '../../utils/prompts';
import * as bitcoin from 'bitcoinjs-lib';

const network = bitcoin.networks.bitcoin;

export async function createWallets(): Promise<void> {
  showSectionHeader('CREATE WALLETS');

  // Check existing wallets
  const existing = loadWallets();
  if (existing) {
    let existingCount = 0;
    if (isGroupsFormat(existing)) {
      existingCount = getAllWalletsFromGroups().length;
    } else if (existing.wallets?.length) {
      existingCount = existing.wallets.length;
    }
    if (existingCount > 0) {
      console.log(`You have ${existingCount} existing wallet(s).`);
      console.log('');
    }
  }

  // Get number of wallets
  const count = await promptInteger('How many wallets to create? (0 to cancel)', 5);

  if (count === 0) {
    return;
  }

  if (count < 1 || count > 100) {
    showError('Please enter a number between 1 and 100');
    return;
  }

  // Mnemonic source
  const mnemonicSource = await promptSelect<'generate' | 'existing' | '__cancel__'>(
    'Use existing mnemonic or generate new?',
    [
      { name: 'Generate new mnemonic', value: 'generate' },
      { name: 'Use existing mnemonic', value: 'existing' },
      { name: '← Back', value: '__cancel__' },
    ]
  );

  if (mnemonicSource === '__cancel__') {
    return;
  }

  let mnemonic: string;

  if (mnemonicSource === 'generate') {
    mnemonic = generateMnemonic();

    console.log('');
    showImportantBox([
      'YOUR MNEMONIC (will be saved to wallets.json)',
      '',
      ...mnemonic.split(' ').reduce((acc, word, i) => {
        const lineIndex = Math.floor(i / 4);
        if (!acc[lineIndex]) acc[lineIndex] = '';
        acc[lineIndex] += word.padEnd(12);
        return acc;
      }, [] as string[]),
      '',
      'This will be saved to config/wallets.json',
      'Keep a backup in a safe place!',
    ]);
    console.log('');
  } else {
    const inputMnemonic = await promptText('Enter your 12-word mnemonic:');

    if (!validateMnemonic(inputMnemonic)) {
      showError('Invalid mnemonic. Please check and try again.');
      return;
    }

    mnemonic = inputMnemonic;
  }

  // Label prefix
  const labelPrefix = await promptText('Enter a label prefix:', 'bidder');

  // Determine starting index
  const startIndex = getNextWalletIndex();

  // Generate wallets
  console.log('');
  console.log('Generating wallets...');

  const wallets = deriveWallets(mnemonic, count, labelPrefix, startIndex, network);

  // Display wallets
  console.log('');
  showSuccess(`Created ${count} wallets:`);
  console.log('');

  const headers = ['Label', 'Payment (bc1q...)', 'Receive (bc1p...)'];
  const rows = wallets.map(w => [
    w.label,
    w.paymentAddress.slice(0, 8) + '...' + w.paymentAddress.slice(-6),
    w.receiveAddress.slice(0, 8) + '...' + w.receiveAddress.slice(-6),
  ]);

  showTable(headers, rows);

  // Ask to save
  console.log('');
  const save = await promptConfirm('Save wallets to config?', true);

  if (save) {
    // Ask about encryption (only for new mnemonic)
    let encrypt = false;
    let password: string | undefined;

    if (mnemonicSource === 'generate') {
      encrypt = await promptConfirm('Encrypt mnemonic in config file?', false);

      if (encrypt) {
        password = await promptPassword('Enter encryption password:');
        const confirmPassword = await promptPassword('Confirm password:');

        if (password !== confirmPassword) {
          showError('Passwords do not match. Saving without encryption.');
          encrypt = false;
        }
      }
    }

    // Save to config (always includes mnemonic)
    addWalletsToConfig(wallets, mnemonic, encrypt, password);
    showSuccess('Wallets saved to config/wallets.json');
    showSuccess('Mnemonic saved to wallets.json' + (encrypt ? ' (encrypted)' : ''));

    console.log('');
    console.log('Next steps:');
    console.log('  1. Use "Distribute funds" to send BTC to your new wallets');
    console.log('  2. Enable ENABLE_WALLET_ROTATION=true in .env to use wallet rotation');
    console.log('');
  }
}
