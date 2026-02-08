import { execSync, spawn } from 'child_process';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showInfo,
  withSpinner,
} from '../../utils/display';
import { promptConfirm } from '../../utils/prompts';
import {
  VERSION_STRING,
  checkForUpdates,
  clearUpdateCache,
  UpdateInfo,
} from '../../../utils/version';
import { getErrorMessage } from '../../../utils/errorUtils';

export async function checkForUpdatesCommand(): Promise<void> {
  showSectionHeader('CHECK FOR UPDATES');

  // Show current version
  console.log(`  Current version: v${VERSION_STRING}`);

  try {
    const localHash = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    console.log(`  Local commit:    ${localHash}`);
  } catch {
    // ignore
  }

  console.log('');

  // Force fresh check
  clearUpdateCache();

  let info: UpdateInfo;
  try {
    info = await withSpinner('Checking for updates...', () => checkForUpdates());
  } catch {
    showError('Failed to check for updates. Are you connected to the internet?');
    return;
  }

  if (!info.updateAvailable) {
    showSuccess("You're up to date!");
    console.log('');
    return;
  }

  // Update available
  const countLabel = info.commitsBehind > 0
    ? `${info.commitsBehind} commit${info.commitsBehind === 1 ? '' : 's'} behind`
    : 'new version available';
  showWarning(`Update available! (${countLabel})`);
  console.log(`  Remote: ${info.remoteHash.slice(0, 7)}`);
  console.log(`  Local:  ${info.localHash.slice(0, 7)}`);
  console.log('');

  // Check for dirty working tree
  try {
    const status = execSync('git status --porcelain', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();

    if (status) {
      showWarning('You have uncommitted changes:');
      console.log('');
      const lines = status.split('\n').slice(0, 10);
      for (const line of lines) {
        console.log(`    ${line}`);
      }
      if (status.split('\n').length > 10) {
        console.log(`    ... and ${status.split('\n').length - 10} more`);
      }
      console.log('');
      showError('Please commit or stash your changes before updating.');
      return;
    }
  } catch {
    // Can't check status - proceed with caution
  }

  const confirm = await promptConfirm('Would you like to update now?', true);
  if (!confirm) {
    showInfo('Update cancelled.');
    return;
  }

  console.log('');

  // Pull changes
  try {
    await withSpinner('Pulling latest changes...', async () => {
      execSync('git pull origin main', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 30000,
      });
    });
    showSuccess('Code updated successfully.');
  } catch (error: unknown) {
    showError(`Failed to pull changes: ${getErrorMessage(error)}`);
    showInfo('You can update manually with: git pull origin main');
    return;
  }

  // Install dependencies
  try {
    await withSpinner('Installing dependencies...', async () => {
      execSync('yarn install', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 120000,
      });
    });
    showSuccess('Dependencies installed.');
  } catch (error: unknown) {
    showWarning(`Dependency install had issues: ${getErrorMessage(error)}`);
    showInfo('You may need to run "yarn install" manually.');
  }

  console.log('');
  showSuccess('Update complete! Restarting management console...');
  console.log('');

  // Restart by spawning a new process and exiting
  const child = spawn(process.argv[0], process.argv.slice(1), {
    stdio: 'inherit',
    detached: false,
    env: process.env,
  });

  child.on('error', () => {
    showWarning('Could not auto-restart. Please run "yarn manage" again.');
    process.exit(0);
  });

  // Unref so current process can exit while child runs
  child.unref();
  process.exit(0);
}
