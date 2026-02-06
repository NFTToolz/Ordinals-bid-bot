import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

function getBaseVersion(): string {
  try {
    const packagePath = path.join(__dirname, '../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    return packageJson.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

function getGitCommitCount(): number {
  try {
    const count = execSync('git rev-list --count HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return parseInt(count, 10) || 0;
  } catch {
    return 0;
  }
}

export const BASE_VERSION = getBaseVersion();
export const BUILD_NUMBER = getGitCommitCount();
export const VERSION_STRING = `${BASE_VERSION} (build ${BUILD_NUMBER})`;

// --- Update detection ---

export interface UpdateInfo {
  updateAvailable: boolean;
  localHash: string;
  remoteHash: string;
  commitsBehind: number; // 0 if up-to-date, -1 if unknown
}

let cachedUpdateInfo: UpdateInfo | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check for available updates by comparing local HEAD with remote origin/main.
 * Results are cached for 5 minutes.
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  const now = Date.now();
  if (cachedUpdateInfo && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedUpdateInfo;
  }

  const noUpdate: UpdateInfo = { updateAvailable: false, localHash: '', remoteHash: '', commitsBehind: 0 };

  try {
    const localHash = execSync('git rev-parse HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();

    const lsRemoteOutput = execSync('git ls-remote origin main', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 10000,
    }).trim();

    if (!lsRemoteOutput) {
      cachedUpdateInfo = { ...noUpdate, localHash };
      cacheTimestamp = now;
      return cachedUpdateInfo;
    }

    const remoteHash = lsRemoteOutput.split(/\s/)[0];

    if (localHash === remoteHash) {
      cachedUpdateInfo = { updateAvailable: false, localHash, remoteHash, commitsBehind: 0 };
      cacheTimestamp = now;
      return cachedUpdateInfo;
    }

    // Fetch to get accurate commit count
    try {
      execSync('git fetch origin main', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 15000,
      });
    } catch {
      // fetch failed - we still know an update exists
      cachedUpdateInfo = { updateAvailable: true, localHash, remoteHash, commitsBehind: -1 };
      cacheTimestamp = now;
      return cachedUpdateInfo;
    }

    let commitsBehind = -1;
    try {
      const countStr = execSync('git rev-list HEAD..origin/main --count', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      commitsBehind = parseInt(countStr, 10) || -1;
    } catch {
      // count failed
    }

    const updateAvailable = commitsBehind !== 0;
    cachedUpdateInfo = { updateAvailable, localHash, remoteHash, commitsBehind };
    cacheTimestamp = now;
    return cachedUpdateInfo;
  } catch {
    // Not a git repo, or git not installed, or offline
    cachedUpdateInfo = noUpdate;
    cacheTimestamp = now;
    return noUpdate;
  }
}

/**
 * Return cached update status synchronously (for display in header without blocking).
 * Returns null if no check has been performed yet.
 */
export function getUpdateStatus(): UpdateInfo | null {
  return cachedUpdateInfo;
}

/**
 * Clear the update cache so the next checkForUpdates() performs a fresh check.
 */
export function clearUpdateCache(): void {
  cachedUpdateInfo = null;
  cacheTimestamp = 0;
}

export function printVersionBanner(): void {
  const cyan = '\x1b[36m';
  const bright = '\x1b[1m';
  const reset = '\x1b[0m';
  const green = '\x1b[32m';

  console.log(`${bright}${cyan}╔══════════════════════════════════════════╗${reset}`);
  console.log(`${cyan}║${reset}  ${bright}ORDINALS BID BOT${reset}                       ${cyan}║${reset}`);
  console.log(`${cyan}║${reset}  Version: ${green}${VERSION_STRING.padEnd(27)}${reset}${cyan}║${reset}`);
  console.log(`${bright}${cyan}╚══════════════════════════════════════════╝${reset}`);
  console.log();
}
