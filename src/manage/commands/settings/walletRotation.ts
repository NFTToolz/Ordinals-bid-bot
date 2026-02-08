import fs from 'fs';
import path from 'path';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showInfo,
} from '../../utils/display';
import { promptConfirm, promptSelect } from '../../utils/prompts';
import { loadWallets, isGroupsFormat, getAllWalletsFromGroups } from '../../services/WalletGenerator';

const ENV_PATH = path.resolve(process.cwd(), '.env');
const DEFAULT_WALLET_CONFIG_PATH = './config/wallets.json';

interface EnvConfig {
  ENABLE_WALLET_ROTATION: boolean;
  WALLET_CONFIG_PATH: string;
}

function readEnvFile(): string {
  try {
    return fs.readFileSync(ENV_PATH, 'utf-8');
  } catch {
    return '';
  }
}

function writeEnvFile(content: string): void {
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
}

function getEnvValue(content: string, key: string): string | undefined {
  const regex = new RegExp(`^${key}=(.*)$`, 'm');
  const match = content.match(regex);
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : undefined;
}

function setEnvValue(content: string, key: string, value: string): string {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  const newLine = `${key}=${value}`;

  if (regex.test(content)) {
    return content.replace(regex, newLine);
  } else {
    // Add to end of file
    const separator = content.endsWith('\n') ? '' : '\n';
    return content + separator + newLine + '\n';
  }
}

function getCurrentConfig(): EnvConfig {
  const content = readEnvFile();
  return {
    ENABLE_WALLET_ROTATION: getEnvValue(content, 'ENABLE_WALLET_ROTATION') === 'true',
    WALLET_CONFIG_PATH: getEnvValue(content, 'WALLET_CONFIG_PATH') || DEFAULT_WALLET_CONFIG_PATH,
  };
}

function getWalletCount(): number {
  const wallets = loadWallets();
  if (!wallets) return 0;
  if (isGroupsFormat(wallets)) {
    return getAllWalletsFromGroups().length;
  }
  return wallets.wallets?.length || 0;
}

export async function walletRotationSettings(): Promise<void> {
  showSectionHeader('WALLET ROTATION SETTINGS');

  const config = getCurrentConfig();
  const walletCount = getWalletCount();

  // Show current status
  console.log('Current Configuration:');
  console.log('');
  if (config.ENABLE_WALLET_ROTATION) {
    showSuccess(`Wallet Rotation: ENABLED`);
  } else {
    showWarning(`Wallet Rotation: DISABLED`);
  }
  console.log(`  Config Path: ${config.WALLET_CONFIG_PATH}`);
  console.log(`  Wallets Available: ${walletCount}`);
  console.log('');

  if (walletCount === 0 && !config.ENABLE_WALLET_ROTATION) {
    showInfo('No wallets configured. Use "Create new wallets" first.');
    console.log('');
    return;
  }

  // Show options
  const action = await promptSelect<'enable' | 'disable' | 'cancel'>(
    'What would you like to do?',
    [
      ...(config.ENABLE_WALLET_ROTATION
        ? [{ name: 'Disable wallet rotation (use single wallet)', value: 'disable' as const }]
        : [{ name: `Enable wallet rotation (${walletCount} wallets)`, value: 'enable' as const }]
      ),
      { name: 'Cancel', value: 'cancel' as const },
    ]
  );

  if (action === 'cancel') {
    return;
  }

  if (action === 'enable') {
    if (walletCount === 0) {
      showError('No wallets available. Create wallets first.');
      console.log('');
      return;
    }

    const confirm = await promptConfirm(
      `Enable wallet rotation with ${walletCount} wallet(s)?`,
      true
    );

    if (!confirm) {
      showWarning('Cancelled');
      return;
    }

    let content = readEnvFile();
    content = setEnvValue(content, 'ENABLE_WALLET_ROTATION', 'true');
    content = setEnvValue(content, 'WALLET_CONFIG_PATH', DEFAULT_WALLET_CONFIG_PATH);
    writeEnvFile(content);

    console.log('');
    showSuccess('Wallet rotation ENABLED');
    showInfo('Restart the bot for changes to take effect');
    console.log('');

  } else if (action === 'disable') {
    const confirm = await promptConfirm(
      'Disable wallet rotation? Bot will use main wallet from .env',
      true
    );

    if (!confirm) {
      showWarning('Cancelled');
      return;
    }

    let content = readEnvFile();
    content = setEnvValue(content, 'ENABLE_WALLET_ROTATION', 'false');
    writeEnvFile(content);

    console.log('');
    showSuccess('Wallet rotation DISABLED');
    showInfo('Bot will use funding wallet from wallets.json (or .env fallback)');
    showInfo('Restart the bot for changes to take effect');
    console.log('');
  }
}
