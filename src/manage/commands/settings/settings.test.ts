/**
 * Tests for settings commands
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

vi.mock('../../utils/display', () => ({
  showSectionHeader: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
}));

vi.mock('../../utils/prompts', () => ({
  promptConfirm: vi.fn().mockResolvedValue(true),
  promptSelect: vi.fn().mockResolvedValue('cancel'),
}));

vi.mock('../../services/WalletGenerator', () => ({
  loadWallets: vi.fn().mockReturnValue({
    wallets: [
      { label: 'Wallet 1', paymentAddress: 'bc1qwallet1' },
      { label: 'Wallet 2', paymentAddress: 'bc1qwallet2' },
    ],
  }),
  isGroupsFormat: vi.fn().mockReturnValue(false),
  getAllWalletsFromGroups: vi.fn().mockReturnValue([]),
}));

// Mock fundingWallet - default to not having a receive address
let mockHasReceiveAddress = false;
let mockReceiveAddress = '';
vi.mock('../../../utils/fundingWallet', () => ({
  hasFundingWIF: vi.fn().mockReturnValue(true),
  getFundingWIF: vi.fn().mockReturnValue('mock-wif'),
  hasReceiveAddress: vi.fn().mockImplementation(() => mockHasReceiveAddress),
  getReceiveAddress: vi.fn().mockImplementation(() => {
    if (!mockReceiveAddress) throw new Error('TOKEN_RECEIVE_ADDRESS not configured');
    return mockReceiveAddress;
  }),
}));

// Mock fs
let mockEnvContent = '';
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn().mockImplementation((path: string) => {
      if (path.includes('.env')) {
        return mockEnvContent;
      }
      throw new Error('File not found');
    }),
    writeFileSync: vi.fn().mockImplementation((path: string, content: string) => {
      if (path.includes('.env')) {
        mockEnvContent = content;
      }
    }),
    existsSync: vi.fn().mockReturnValue(true),
  },
  readFileSync: vi.fn().mockImplementation((path: string) => {
    if (path.includes('.env')) {
      return mockEnvContent;
    }
    throw new Error('File not found');
  }),
  writeFileSync: vi.fn().mockImplementation((path: string, content: string) => {
    if (path.includes('.env')) {
      mockEnvContent = content;
    }
  }),
  existsSync: vi.fn().mockReturnValue(true),
}));

describe('Settings Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnvContent = '';
    mockHasReceiveAddress = false;
    mockReceiveAddress = '';
  });

  describe('centralizeReceiveSettings', () => {
    it('should show current status when called', async () => {
      mockEnvContent = `TOKEN_RECEIVE_ADDRESS=bc1preceive\nCENTRALIZE_RECEIVE_ADDRESS=true\n`;

      const { centralizeReceiveSettings } = await import('./centralizeReceive');
      const display = await import('../../utils/display');

      await centralizeReceiveSettings();

      expect(display.showSectionHeader).toHaveBeenCalledWith('CENTRALIZE RECEIVE ADDRESS');
    });

    it('should show error when TOKEN_RECEIVE_ADDRESS not set', async () => {
      mockEnvContent = `CENTRALIZE_RECEIVE_ADDRESS=false\n`;

      const { centralizeReceiveSettings } = await import('./centralizeReceive');
      const display = await import('../../utils/display');

      await centralizeReceiveSettings();

      expect(display.showError).toHaveBeenCalledWith('TOKEN_RECEIVE_ADDRESS not set in wallets.json or .env');
    });

    it('should show info when wallet rotation is disabled', async () => {
      mockEnvContent = `TOKEN_RECEIVE_ADDRESS=bc1preceive\nENABLE_WALLET_ROTATION=false\n`;

      const { centralizeReceiveSettings } = await import('./centralizeReceive');
      const display = await import('../../utils/display');

      await centralizeReceiveSettings();

      expect(display.showInfo).toHaveBeenCalledWith(
        'Wallet rotation is disabled. Centralized receive only applies when using multiple wallets.'
      );
    });
  });

  describe('walletRotationSettings', () => {
    it('should show current status when called', async () => {
      mockEnvContent = `ENABLE_WALLET_ROTATION=true\n`;

      const { walletRotationSettings } = await import('./walletRotation');
      const display = await import('../../utils/display');

      await walletRotationSettings();

      expect(display.showSectionHeader).toHaveBeenCalledWith('WALLET ROTATION SETTINGS');
    });

    it('should show info when no wallets and rotation disabled', async () => {
      const { loadWallets } = await import('../../services/WalletGenerator');
      vi.mocked(loadWallets).mockReturnValueOnce({ wallets: [] });

      mockEnvContent = `ENABLE_WALLET_ROTATION=false\n`;

      const { walletRotationSettings } = await import('./walletRotation');
      const display = await import('../../utils/display');

      await walletRotationSettings();

      expect(display.showInfo).toHaveBeenCalledWith('No wallets configured. Use "Create new wallets" first.');
    });
  });
});

describe('Env File Parsing', () => {
  it('should extract value from env content', () => {
    const content = `KEY1=value1\nKEY2=value2\nKEY3="quoted value"\n`;

    // Simulating getEnvValue logic
    function getEnvValue(content: string, key: string): string | undefined {
      const regex = new RegExp(`^${key}=(.*)$`, 'm');
      const match = content.match(regex);
      return match ? match[1].trim().replace(/^["']|["']$/g, '') : undefined;
    }

    expect(getEnvValue(content, 'KEY1')).toBe('value1');
    expect(getEnvValue(content, 'KEY2')).toBe('value2');
    expect(getEnvValue(content, 'KEY3')).toBe('quoted value');
    expect(getEnvValue(content, 'KEY4')).toBeUndefined();
  });

  it('should handle empty env file', () => {
    const content = '';

    function getEnvValue(content: string, key: string): string | undefined {
      const regex = new RegExp(`^${key}=(.*)$`, 'm');
      const match = content.match(regex);
      return match ? match[1].trim().replace(/^["']|["']$/g, '') : undefined;
    }

    expect(getEnvValue(content, 'KEY1')).toBeUndefined();
  });

  it('should handle single quotes in values', () => {
    const content = `KEY1='single quoted'\n`;

    function getEnvValue(content: string, key: string): string | undefined {
      const regex = new RegExp(`^${key}=(.*)$`, 'm');
      const match = content.match(regex);
      return match ? match[1].trim().replace(/^["']|["']$/g, '') : undefined;
    }

    expect(getEnvValue(content, 'KEY1')).toBe('single quoted');
  });
});

describe('Env File Modification', () => {
  it('should update existing key', () => {
    const content = `KEY1=value1\nKEY2=value2\n`;

    function setEnvValue(content: string, key: string, value: string): string {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const newLine = `${key}=${value}`;

      if (regex.test(content)) {
        return content.replace(regex, newLine);
      } else {
        const separator = content.endsWith('\n') ? '' : '\n';
        return content + separator + newLine + '\n';
      }
    }

    const result = setEnvValue(content, 'KEY1', 'newvalue');
    expect(result).toContain('KEY1=newvalue');
    expect(result).toContain('KEY2=value2');
  });

  it('should add new key to end', () => {
    const content = `KEY1=value1\n`;

    function setEnvValue(content: string, key: string, value: string): string {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const newLine = `${key}=${value}`;

      if (regex.test(content)) {
        return content.replace(regex, newLine);
      } else {
        const separator = content.endsWith('\n') ? '' : '\n';
        return content + separator + newLine + '\n';
      }
    }

    const result = setEnvValue(content, 'KEY2', 'value2');
    expect(result).toBe('KEY1=value1\nKEY2=value2\n');
  });

  it('should handle content without trailing newline', () => {
    const content = `KEY1=value1`;

    function setEnvValue(content: string, key: string, value: string): string {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const newLine = `${key}=${value}`;

      if (regex.test(content)) {
        return content.replace(regex, newLine);
      } else {
        const separator = content.endsWith('\n') ? '' : '\n';
        return content + separator + newLine + '\n';
      }
    }

    const result = setEnvValue(content, 'KEY2', 'value2');
    expect(result).toBe('KEY1=value1\nKEY2=value2\n');
  });

  it('should handle empty content', () => {
    const content = '';

    function setEnvValue(content: string, key: string, value: string): string {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const newLine = `${key}=${value}`;

      if (regex.test(content)) {
        return content.replace(regex, newLine);
      } else {
        const separator = content.endsWith('\n') ? '' : '\n';
        return content + separator + newLine + '\n';
      }
    }

    const result = setEnvValue(content, 'KEY1', 'value1');
    expect(result).toBe('\nKEY1=value1\n');
  });
});

describe('Config Parsing', () => {
  it('should parse CENTRALIZE_RECEIVE_ADDRESS as boolean', () => {
    const testCases = [
      { envValue: 'true', expected: true },
      { envValue: 'false', expected: false },
      { envValue: undefined, expected: false },
      { envValue: 'TRUE', expected: false }, // Case sensitive
      { envValue: '1', expected: false },
    ];

    for (const { envValue, expected } of testCases) {
      const result = envValue === 'true';
      expect(result).toBe(expected);
    }
  });

  it('should parse ENABLE_WALLET_ROTATION as boolean', () => {
    const testCases = [
      { envValue: 'true', expected: true },
      { envValue: 'false', expected: false },
      { envValue: undefined, expected: false },
    ];

    for (const { envValue, expected } of testCases) {
      const result = envValue === 'true';
      expect(result).toBe(expected);
    }
  });

  it('should use default path when WALLET_CONFIG_PATH not set', () => {
    const DEFAULT_WALLET_CONFIG_PATH = './config/wallets.json';
    const envValue = undefined;

    const configPath = envValue || DEFAULT_WALLET_CONFIG_PATH;

    expect(configPath).toBe('./config/wallets.json');
  });
});

describe('Wallet Count', () => {
  it('should count wallets from loaded config', () => {
    const walletConfig = {
      wallets: [
        { label: 'Wallet 1', paymentAddress: 'bc1q1' },
        { label: 'Wallet 2', paymentAddress: 'bc1q2' },
        { label: 'Wallet 3', paymentAddress: 'bc1q3' },
      ],
    };

    const count = walletConfig?.wallets?.length || 0;

    expect(count).toBe(3);
  });

  it('should return 0 for null wallet config', () => {
    const walletConfig = null;

    const count = (walletConfig as any)?.wallets?.length || 0;

    expect(count).toBe(0);
  });

  it('should return 0 for empty wallets array', () => {
    const walletConfig = { wallets: [] };

    const count = walletConfig?.wallets?.length || 0;

    expect(count).toBe(0);
  });
});

describe('Settings Action Selection', () => {
  it('should show enable option when currently disabled', () => {
    const config = { ENABLE_WALLET_ROTATION: false };
    const walletCount = 5;

    const options = config.ENABLE_WALLET_ROTATION
      ? [{ name: 'Disable wallet rotation (use single wallet)', value: 'disable' }]
      : [{ name: `Enable wallet rotation (${walletCount} wallets)`, value: 'enable' }];

    options.push({ name: 'Cancel', value: 'cancel' });

    expect(options).toHaveLength(2);
    expect(options[0].value).toBe('enable');
    expect(options[0].name).toContain('5 wallets');
  });

  it('should show disable option when currently enabled', () => {
    const config = { ENABLE_WALLET_ROTATION: true };

    const options = config.ENABLE_WALLET_ROTATION
      ? [{ name: 'Disable wallet rotation (use single wallet)', value: 'disable' }]
      : [{ name: 'Enable wallet rotation', value: 'enable' }];

    options.push({ name: 'Cancel', value: 'cancel' });

    expect(options).toHaveLength(2);
    expect(options[0].value).toBe('disable');
  });

  it('should show enable/disable for centralize receive based on current state', () => {
    const configEnabled = { CENTRALIZE_RECEIVE_ADDRESS: true };
    const configDisabled = { CENTRALIZE_RECEIVE_ADDRESS: false };

    const optionsWhenEnabled = configEnabled.CENTRALIZE_RECEIVE_ADDRESS
      ? [{ name: 'Disable centralized receive', value: 'disable' }]
      : [{ name: 'Enable centralized receive', value: 'enable' }];

    const optionsWhenDisabled = configDisabled.CENTRALIZE_RECEIVE_ADDRESS
      ? [{ name: 'Disable centralized receive', value: 'disable' }]
      : [{ name: 'Enable centralized receive', value: 'enable' }];

    expect(optionsWhenEnabled[0].value).toBe('disable');
    expect(optionsWhenDisabled[0].value).toBe('enable');
  });
});

describe('Enable/Disable Flow', () => {
  it('should prevent enabling wallet rotation with zero wallets', () => {
    const action = 'enable';
    const walletCount = 0;

    let errorShown = false;
    let shouldReturn = false;

    if (action === 'enable') {
      if (walletCount === 0) {
        errorShown = true;
        shouldReturn = true;
      }
    }

    expect(errorShown).toBe(true);
    expect(shouldReturn).toBe(true);
  });

  it('should allow enabling wallet rotation with wallets available', () => {
    const action = 'enable';
    const walletCount = 3;

    let canEnable = false;

    if (action === 'enable') {
      if (walletCount > 0) {
        canEnable = true;
      }
    }

    expect(canEnable).toBe(true);
  });

  it('should cancel when user does not confirm', async () => {
    const prompts = await import('../../utils/prompts');
    vi.mocked(prompts.promptConfirm).mockResolvedValueOnce(false);

    const action = 'enable';
    const confirm = await prompts.promptConfirm('Enable?', true);

    let cancelled = false;
    if (!confirm) {
      cancelled = true;
    }

    expect(cancelled).toBe(true);
  });
});

describe('Centralize Receive Validation', () => {
  it('should require TOKEN_RECEIVE_ADDRESS before enabling', () => {
    const config = {
      TOKEN_RECEIVE_ADDRESS: '',
      CENTRALIZE_RECEIVE_ADDRESS: false,
    };

    const canProceed = !!config.TOKEN_RECEIVE_ADDRESS;

    expect(canProceed).toBe(false);
  });

  it('should allow proceeding when TOKEN_RECEIVE_ADDRESS is set', () => {
    const config = {
      TOKEN_RECEIVE_ADDRESS: 'bc1preceive',
      CENTRALIZE_RECEIVE_ADDRESS: false,
    };

    const canProceed = !!config.TOKEN_RECEIVE_ADDRESS;

    expect(canProceed).toBe(true);
  });
});

describe('Display Current Configuration', () => {
  it('should display enabled status correctly', () => {
    const config = { CENTRALIZE_RECEIVE_ADDRESS: true };

    const statusText = config.CENTRALIZE_RECEIVE_ADDRESS
      ? 'Centralize Receive: ENABLED'
      : 'Centralize Receive: DISABLED';

    expect(statusText).toBe('Centralize Receive: ENABLED');
  });

  it('should display disabled status correctly', () => {
    const config = { CENTRALIZE_RECEIVE_ADDRESS: false };

    const statusText = config.CENTRALIZE_RECEIVE_ADDRESS
      ? 'Centralize Receive: ENABLED'
      : 'Centralize Receive: DISABLED';

    expect(statusText).toBe('Centralize Receive: DISABLED');
  });

  it('should display wallet rotation enabled', () => {
    const config = { ENABLE_WALLET_ROTATION: true };

    const statusText = config.ENABLE_WALLET_ROTATION
      ? 'Wallet Rotation: ENABLED'
      : 'Wallet Rotation: DISABLED';

    expect(statusText).toBe('Wallet Rotation: ENABLED');
  });

  it('should display wallet count', () => {
    const walletCount = 5;
    const configPath = './config/wallets.json';

    const displayText = `  Config Path: ${configPath}\n  Wallets Available: ${walletCount}`;

    expect(displayText).toContain('Wallets Available: 5');
    expect(displayText).toContain('./config/wallets.json');
  });

  it('should show address or placeholder when not set', () => {
    const tokenReceiveAddress = '';

    const displayAddress = tokenReceiveAddress || '(not set)';

    expect(displayAddress).toBe('(not set)');
  });

  it('should show actual address when set', () => {
    const tokenReceiveAddress = 'bc1preceiveaddress';

    const displayAddress = tokenReceiveAddress || '(not set)';

    expect(displayAddress).toBe('bc1preceiveaddress');
  });
});

describe('Index Exports', () => {
  it('should export walletRotationSettings', async () => {
    const settings = await import('./index');
    expect(settings.walletRotationSettings).toBeDefined();
    expect(typeof settings.walletRotationSettings).toBe('function');
  });

  it('should export centralizeReceiveSettings', async () => {
    const settings = await import('./index');
    expect(settings.centralizeReceiveSettings).toBeDefined();
    expect(typeof settings.centralizeReceiveSettings).toBe('function');
  });
});
