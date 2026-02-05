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
