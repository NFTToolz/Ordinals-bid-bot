#!/usr/bin/env node

import { config } from 'dotenv';
import inquirer = require('inquirer');

// Load environment variables
config();

// Display utilities
import {
  showHeader,
  showStatusBar,
  clearScreen,
} from './utils/display';
import { promptContinue } from './utils/prompts';

// Services
import { isRunning } from './services/BotProcessManager';
import { loadCollections } from './services/CollectionService';
import { loadWallets } from './services/WalletGenerator';

// Wallet commands
import {
  createWallets,
  listWallets,
  distributeFunds,
  consolidateFunds,
  viewOrdinals,
  exportWalletsCommand,
  importWalletsCommand,
} from './commands/wallet';

// Collection commands
import {
  listCollections,
  addCollectionCommand,
  editCollection,
  removeCollectionCommand,
  scanCollections,
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

  // Collection actions
  'collection:list': listCollections,
  'collection:add': addCollectionCommand,
  'collection:edit': editCollection,
  'collection:remove': removeCollectionCommand,
  'collection:scan': scanCollections,

  // Bot actions
  'bot:start': startBot,
  'bot:stop': stopBot,
  'bot:status': viewStatus,
  'bot:restart': restartBot,
  'bot:logs': viewLogs,
  'bot:cancel': cancelOffers,

  // Settings actions
  'settings:wallet-rotation': walletRotationSettings,
};

async function getStatusInfo(): Promise<{
  botStatus: 'RUNNING' | 'STOPPED';
  walletCount: number;
  collectionCount: number;
}> {
  const botStatus = isRunning() ? 'RUNNING' : 'STOPPED';
  const wallets = loadWallets();
  const walletCount = (wallets?.wallets.length || 0) + 1; // +1 for main wallet
  const collections = loadCollections();
  const collectionCount = collections.length;

  return { botStatus, walletCount, collectionCount };
}

async function showMainMenu(): Promise<string> {
  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: 'Select an option:',
    pageSize: 25,
    choices: [
      new inquirer.Separator('────────── WALLETS ──────────'),
      { name: 'Create new wallets', value: 'wallet:create' },
      { name: 'View wallet balances', value: 'wallet:list' },
      { name: 'View ordinals/NFTs', value: 'wallet:ordinals' },
      { name: 'Distribute funds', value: 'wallet:distribute' },
      { name: 'Consolidate funds', value: 'wallet:consolidate' },
      { name: 'Export/backup wallets', value: 'wallet:export' },
      { name: 'Import wallets', value: 'wallet:import' },

      new inquirer.Separator('────────── COLLECTIONS ──────────'),
      { name: 'List collections', value: 'collection:list' },
      { name: 'Add collection', value: 'collection:add' },
      { name: 'Edit collection', value: 'collection:edit' },
      { name: 'Remove collection', value: 'collection:remove' },
      { name: 'Scan for opportunities', value: 'collection:scan' },

      new inquirer.Separator('────────── BOT CONTROL ──────────'),
      { name: 'Start bot', value: 'bot:start' },
      { name: 'Stop bot', value: 'bot:stop' },
      { name: 'View status & stats', value: 'bot:status' },
      { name: 'Restart bot', value: 'bot:restart' },
      { name: 'View logs', value: 'bot:logs' },
      { name: 'Cancel all offers', value: 'bot:cancel' },

      new inquirer.Separator('────────── SETTINGS ──────────'),
      { name: 'Wallet rotation', value: 'settings:wallet-rotation' },

      new inquirer.Separator('──────────────────────────────────'),
      { name: 'Exit', value: 'exit' },
    ],
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

  while (true) {
    try {
      clearScreen();

      // Show header and status
      showHeader();
      const status = await getStatusInfo();
      showStatusBar(status.botStatus, status.walletCount, status.collectionCount);

      // Show menu and get selection
      const action = await showMainMenu();

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
