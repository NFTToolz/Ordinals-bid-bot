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

const ENV_PATH = path.resolve(process.cwd(), '.env');

interface EnvConfig {
  CENTRALIZE_RECEIVE_ADDRESS: boolean;
  TOKEN_RECEIVE_ADDRESS: string;
  ENABLE_WALLET_ROTATION: boolean;
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
    CENTRALIZE_RECEIVE_ADDRESS: getEnvValue(content, 'CENTRALIZE_RECEIVE_ADDRESS') === 'true',
    TOKEN_RECEIVE_ADDRESS: getEnvValue(content, 'TOKEN_RECEIVE_ADDRESS') || '',
    ENABLE_WALLET_ROTATION: getEnvValue(content, 'ENABLE_WALLET_ROTATION') === 'true',
  };
}

export async function centralizeReceiveSettings(): Promise<void> {
  showSectionHeader('CENTRALIZE RECEIVE ADDRESS');

  const config = getCurrentConfig();

  // Show current status
  console.log('Current Configuration:');
  console.log('');
  if (config.CENTRALIZE_RECEIVE_ADDRESS) {
    showSuccess(`Centralize Receive: ENABLED`);
  } else {
    showWarning(`Centralize Receive: DISABLED`);
  }
  console.log(`  Token Receive Address: ${config.TOKEN_RECEIVE_ADDRESS || '(not set)'}`);
  console.log(`  Wallet Rotation: ${config.ENABLE_WALLET_ROTATION ? 'Enabled' : 'Disabled'}`);
  console.log('');

  if (!config.TOKEN_RECEIVE_ADDRESS) {
    showError('TOKEN_RECEIVE_ADDRESS not set in .env');
    showInfo('Set TOKEN_RECEIVE_ADDRESS before enabling centralized receive.');
    console.log('');
    return;
  }

  if (!config.ENABLE_WALLET_ROTATION) {
    showInfo('Wallet rotation is disabled. Centralized receive only applies when using multiple wallets.');
    console.log('');
  }

  // Explain what this setting does
  console.log('About this setting:');
  console.log('  When ENABLED: All wallets send won NFTs to TOKEN_RECEIVE_ADDRESS');
  console.log('  When DISABLED: Each wallet receives NFTs to its own address');
  console.log('');

  // Show options
  const action = await promptSelect<'enable' | 'disable' | 'cancel'>(
    'What would you like to do?',
    [
      ...(config.CENTRALIZE_RECEIVE_ADDRESS
        ? [{ name: 'Disable centralized receive (use individual wallet addresses)', value: 'disable' as const }]
        : [{ name: 'Enable centralized receive (all NFTs to TOKEN_RECEIVE_ADDRESS)', value: 'enable' as const }]
      ),
      { name: 'Cancel', value: 'cancel' as const },
    ]
  );

  if (action === 'cancel') {
    return;
  }

  if (action === 'enable') {
    console.log('');
    showInfo(`All won NFTs will be sent to:`);
    console.log(`  ${config.TOKEN_RECEIVE_ADDRESS}`);
    console.log('');

    const confirm = await promptConfirm(
      'Enable centralized receive address?',
      true
    );

    if (!confirm) {
      showWarning('Cancelled');
      return;
    }

    let content = readEnvFile();
    content = setEnvValue(content, 'CENTRALIZE_RECEIVE_ADDRESS', 'true');
    writeEnvFile(content);

    console.log('');
    showSuccess('Centralized receive ENABLED');
    showInfo('Restart the bot for changes to take effect');
    console.log('');

  } else if (action === 'disable') {
    const confirm = await promptConfirm(
      'Disable centralized receive? Each wallet will use its own receive address.',
      true
    );

    if (!confirm) {
      showWarning('Cancelled');
      return;
    }

    let content = readEnvFile();
    content = setEnvValue(content, 'CENTRALIZE_RECEIVE_ADDRESS', 'false');
    writeEnvFile(content);

    console.log('');
    showSuccess('Centralized receive DISABLED');
    showInfo('Each wallet will receive NFTs to its own address');
    showInfo('Restart the bot for changes to take effect');
    console.log('');
  }
}
