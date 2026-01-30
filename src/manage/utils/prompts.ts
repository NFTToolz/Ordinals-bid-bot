import inquirer = require('inquirer');

/**
 * Prompt for text input
 */
export async function promptText(message: string, defaultValue?: string): Promise<string> {
  const { value } = await inquirer.prompt([{
    type: 'input',
    name: 'value',
    message,
    default: defaultValue,
  }]);
  return value;
}

/**
 * Prompt for number input
 */
export async function promptNumber(message: string, defaultValue?: number): Promise<number> {
  const { value } = await inquirer.prompt([{
    type: 'input',
    name: 'value',
    message,
    default: defaultValue?.toString(),
    validate: (input: string) => {
      const num = parseFloat(input);
      if (isNaN(num)) return 'Please enter a valid number';
      return true;
    },
  }]);
  return parseFloat(value);
}

/**
 * Prompt for integer input
 */
export async function promptInteger(message: string, defaultValue?: number): Promise<number> {
  const { value } = await inquirer.prompt([{
    type: 'input',
    name: 'value',
    message,
    default: defaultValue?.toString(),
    validate: (input: string) => {
      const num = parseInt(input, 10);
      if (isNaN(num)) return 'Please enter a valid integer';
      return true;
    },
  }]);
  return parseInt(value, 10);
}

/**
 * Prompt for confirmation (yes/no)
 */
export async function promptConfirm(message: string, defaultValue: boolean = true): Promise<boolean> {
  const { value } = await inquirer.prompt([{
    type: 'confirm',
    name: 'value',
    message,
    default: defaultValue,
  }]);
  return value;
}

/**
 * Prompt for selection from a list
 */
export async function promptSelect<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T } | T>
): Promise<T> {
  const { value } = await inquirer.prompt([{
    type: 'list',
    name: 'value',
    message,
    choices,
  }]);
  return value;
}

/**
 * Prompt for multiple selection from a list
 */
export async function promptMultiSelect<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T; checked?: boolean } | T>
): Promise<T[]> {
  const { value } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'value',
    message,
    choices,
  }]);
  return value;
}

/**
 * Prompt for password/secret input (masked)
 */
export async function promptPassword(message: string): Promise<string> {
  const { value } = await inquirer.prompt([{
    type: 'password',
    name: 'value',
    message,
    mask: '*',
  }]);
  return value;
}

/**
 * Prompt to press Enter to continue
 */
export async function promptContinue(message: string = 'Press Enter to continue...'): Promise<void> {
  await inquirer.prompt([{
    type: 'input',
    name: 'continue',
    message,
  }]);
}

/**
 * Prompt for BTC amount
 */
export async function promptBTC(message: string, defaultValue?: number): Promise<number> {
  const { value } = await inquirer.prompt([{
    type: 'input',
    name: 'value',
    message,
    default: defaultValue?.toString(),
    validate: (input: string) => {
      const num = parseFloat(input);
      if (isNaN(num)) return 'Please enter a valid BTC amount';
      if (num < 0) return 'Amount must be positive';
      if (num > 21000000) return 'Amount exceeds maximum BTC supply';
      return true;
    },
  }]);
  return parseFloat(value);
}

/**
 * Prompt for percentage input
 */
export async function promptPercentage(message: string, defaultValue?: number): Promise<number> {
  const { value } = await inquirer.prompt([{
    type: 'input',
    name: 'value',
    message,
    default: defaultValue?.toString(),
    validate: (input: string) => {
      const num = parseFloat(input);
      if (isNaN(num)) return 'Please enter a valid percentage';
      if (num < 0 || num > 100) return 'Percentage must be between 0 and 100';
      return true;
    },
  }]);
  return parseFloat(value);
}

/**
 * Prompt for floor percentage (can be > 100 for trait bidding)
 */
export async function promptFloorPercentage(message: string, defaultValue?: number, allowAbove100: boolean = false): Promise<number> {
  const { value } = await inquirer.prompt([{
    type: 'input',
    name: 'value',
    message,
    default: defaultValue?.toString(),
    validate: (input: string) => {
      const num = parseFloat(input);
      if (isNaN(num)) return 'Please enter a valid percentage';
      if (num < 0) return 'Percentage must be positive';
      if (!allowAbove100 && num > 100) return 'Percentage must be 100 or less';
      return true;
    },
  }]);
  return parseFloat(value);
}

/**
 * Prompt with dangerous confirmation (type exact text to confirm)
 */
export async function promptDangerousConfirm(
  message: string,
  confirmText: string
): Promise<boolean> {
  const { value } = await inquirer.prompt([{
    type: 'input',
    name: 'value',
    message: `${message}\nType "${confirmText}" to confirm:`,
  }]);
  return value === confirmText;
}

/**
 * Prompt for wallet selection from list
 */
export async function promptWalletSelect(
  wallets: Array<{ label: string; address: string; balance?: number }>,
  message: string = 'Select a wallet:'
): Promise<string | null> {
  if (wallets.length === 0) {
    return null;
  }

  const choices = wallets.map(w => ({
    name: `${w.label} (${w.address.slice(0, 8)}...${w.address.slice(-6)})${w.balance !== undefined ? ` - ${(w.balance / 1e8).toFixed(8)} BTC` : ''}`,
    value: w.address,
  }));

  choices.push({ name: 'Cancel', value: '' });

  const { value } = await inquirer.prompt([{
    type: 'list',
    name: 'value',
    message,
    choices,
  }]);

  return value || null;
}

/**
 * Prompt for multiple wallet selection
 */
export async function promptMultiWalletSelect(
  wallets: Array<{ label: string; address: string; balance?: number }>,
  message: string = 'Select wallets:'
): Promise<string[]> {
  if (wallets.length === 0) {
    return [];
  }

  const choices = wallets.map(w => ({
    name: `${w.label} (${w.address.slice(0, 8)}...${w.address.slice(-6)})${w.balance !== undefined ? ` - ${(w.balance / 1e8).toFixed(8)} BTC` : ''}`,
    value: w.address,
  }));

  const { value } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'value',
    message,
    choices,
  }]);

  return value;
}
