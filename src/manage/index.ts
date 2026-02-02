#!/usr/bin/env node

import { config } from 'dotenv';
import inquirer = require('inquirer');

// Load environment variables
config();

// Display utilities
import {
  showHeader,
  showEnhancedStatusBar,
  showBreadcrumb,
  clearScreen,
  MenuLevel,
} from './utils/display';

import { promptContinue } from './utils/prompts';

// Services
import { getEnhancedStatus, getQuickStatus, refreshOfferCountAsync } from './services/StatusService';

// Wallet commands
import {
  createWallets,
  listWallets,
  distributeFunds,
  consolidateFunds,
  viewOrdinals,
  exportWalletsCommand,
  importWalletsCommand,
  listWalletGroups,
  createWalletGroupCommand,
  addWalletsToGroupCommand,
  removeWalletFromGroupCommand,
  deleteWalletGroupCommand,
  rebalanceWalletGroup,
  rebalanceAllWalletGroups,
} from './commands/wallet';

// Collection commands
import {
  listCollections,
  addCollectionCommand,
  editCollection,
  removeCollectionCommand,
  scanCollections,
  assignCollectionGroup,
} from './commands/collection';

// Bot commands
import {
  startBot,
  stopBot,
  viewStatus,
  restartBot,
  viewLogs,
  cancelOffers,
} from './commands/bot';

// Settings commands
import {
  walletRotationSettings,
  centralizeReceiveSettings,
} from './commands/settings';

type ActionHandler = () => Promise<void>;

const actions: Record<string, ActionHandler> = {
  // Wallet actions
  'wallet:create': createWallets,
  'wallet:list': listWallets,
  'wallet:ordinals': viewOrdinals,
  'wallet:distribute': distributeFunds,
  'wallet:consolidate': consolidateFunds,
  'wallet:export': exportWalletsCommand,
  'wallet:import': importWalletsCommand,

  // Wallet group actions
  'wallet:groups': listWalletGroups,
  'wallet:group:create': createWalletGroupCommand,
  'wallet:group:add': addWalletsToGroupCommand,
  'wallet:group:remove': removeWalletFromGroupCommand,
  'wallet:group:delete': deleteWalletGroupCommand,
  'wallet:group:rebalance': rebalanceWalletGroup,
  'wallet:group:rebalance-all': rebalanceAllWalletGroups,

  // Collection actions
  'collection:list': listCollections,
  'collection:add': addCollectionCommand,
  'collection:edit': editCollection,
  'collection:remove': removeCollectionCommand,
  'collection:scan': scanCollections,
  'collection:assign-group': assignCollectionGroup,

  // Bot actions
  'bot:start': startBot,
  'bot:stop': stopBot,
  'bot:status': viewStatus,
  'bot:restart': restartBot,
  'bot:logs': viewLogs,
  'bot:cancel': cancelOffers,

  // Settings actions
  'settings:wallet-rotation': walletRotationSettings,
  'settings:centralize-receive': centralizeReceiveSettings,
};

// Menu configuration for hierarchical navigation
interface MenuChoice {
  name: string;
  value: string;
}

interface MenuConfig {
  choices: MenuChoice[];
}

const MENU_CONFIG: Record<MenuLevel, MenuConfig> = {
  main: {
    choices: [
      { name: 'Wallets', value: 'submenu:wallets' },
      { name: 'Wallet Groups', value: 'submenu:wallet-groups' },
      { name: 'Collections', value: 'submenu:collections' },
      { name: 'Bot Control', value: 'submenu:bot' },
      { name: 'Settings', value: 'submenu:settings' },
      { name: 'Exit', value: 'exit' },
    ],
  },
  wallets: {
    choices: [
      { name: 'View wallet balances', value: 'wallet:list' },
      { name: 'Create new wallets', value: 'wallet:create' },
      { name: 'View ordinals/NFTs', value: 'wallet:ordinals' },
      { name: 'Distribute funds', value: 'wallet:distribute' },
      { name: 'Consolidate funds', value: 'wallet:consolidate' },
      { name: 'Export/backup wallets', value: 'wallet:export' },
      { name: 'Import wallets', value: 'wallet:import' },
      { name: '← Back', value: 'back' },
    ],
  },
  'wallet-groups': {
    choices: [
      { name: 'View wallet groups', value: 'wallet:groups' },
      { name: 'Create wallet group', value: 'wallet:group:create' },
      { name: 'Add wallets to group', value: 'wallet:group:add' },
      { name: 'Remove wallet from group', value: 'wallet:group:remove' },
      { name: 'Delete empty group', value: 'wallet:group:delete' },
      { name: 'Rebalance group', value: 'wallet:group:rebalance' },
      { name: 'Rebalance all groups', value: 'wallet:group:rebalance-all' },
      { name: '← Back', value: 'back' },
    ],
  },
  collections: {
    choices: [
      { name: 'List collections', value: 'collection:list' },
      { name: 'Add collection', value: 'collection:add' },
      { name: 'Edit collection', value: 'collection:edit' },
      { name: 'Remove collection', value: 'collection:remove' },
      { name: 'Assign to wallet group', value: 'collection:assign-group' },
      { name: 'Scan for opportunities', value: 'collection:scan' },
      { name: '← Back', value: 'back' },
    ],
  },
  bot: {
    choices: [
      { name: 'View status & stats', value: 'bot:status' },
      { name: 'Start bot', value: 'bot:start' },
      { name: 'Stop bot', value: 'bot:stop' },
      { name: 'Restart bot', value: 'bot:restart' },
      { name: 'View logs', value: 'bot:logs' },
      { name: 'Cancel all offers', value: 'bot:cancel' },
      { name: '← Back', value: 'back' },
    ],
  },
  settings: {
    choices: [
      { name: 'Wallet rotation', value: 'settings:wallet-rotation' },
      ...(process.env.ENABLE_WALLET_ROTATION === 'true'
        ? [{ name: 'Centralize receive address', value: 'settings:centralize-receive' }]
        : []),
      { name: '← Back', value: 'back' },
    ],
  },
};

interface MenuState {
  currentLevel: MenuLevel;
  breadcrumb: MenuLevel[];
}

function createInitialState(): MenuState {
  return {
    currentLevel: 'main',
    breadcrumb: ['main'],
  };
}

async function showMenu(level: MenuLevel): Promise<string> {
  const config = MENU_CONFIG[level];

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: 'Select an option:',
    pageSize: 15,
    choices: config.choices,
  }]);

  return action;
}

async function handleAction(action: string): Promise<void> {
  const handler = actions[action];

  if (handler) {
    try {
      await handler();
    } catch (error: any) {
      console.error('');
      console.error(`Error: ${error.message}`);
      console.error('');
    }
  }
}

async function main(): Promise<void> {
  console.log('');
  console.log('Starting Ordinals Bid Bot Management Console...');
  console.log('');

  const state = createInitialState();

  // Start background refresh of offer count
  refreshOfferCountAsync().catch(() => {});

  while (true) {
    try {
      clearScreen();

      // Show header and enhanced status
      showHeader();
      const status = getQuickStatus();
      showEnhancedStatusBar(status);

      // Show breadcrumb navigation
      showBreadcrumb(state.breadcrumb);

      // Show menu and get selection
      const action = await showMenu(state.currentLevel);

      // Handle submenu navigation
      if (action.startsWith('submenu:')) {
        const targetLevel = action.replace('submenu:', '') as MenuLevel;
        state.currentLevel = targetLevel;
        state.breadcrumb.push(targetLevel);
        continue;
      }

      // Handle back navigation
      if (action === 'back') {
        if (state.breadcrumb.length > 1) {
          state.breadcrumb.pop();
          state.currentLevel = state.breadcrumb[state.breadcrumb.length - 1];
        }
        continue;
      }

      // Handle exit
      if (action === 'exit') {
        console.log('');
        console.log('Goodbye!');
        console.log('');
        break;
      }

      // Clear screen before running action
      clearScreen();

      // Run selected action
      await handleAction(action);

      // Wait for user before returning to menu
      await promptContinue('Press Enter to return to menu...');

    } catch (error: any) {
      // Handle Ctrl+C gracefully
      if (error.message === 'User force closed the prompt with 0 null') {
        console.log('');
        console.log('Goodbye!');
        console.log('');
        break;
      }

      console.error('');
      console.error(`Unexpected error: ${error.message}`);
      console.error('');

      await promptContinue('Press Enter to continue...');
    }
  }

  process.exit(0);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
