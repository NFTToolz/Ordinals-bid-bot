/**
 * Thin state holder for the funding WIF (primary signing key).
 * No dependencies on WalletGenerator to avoid circular imports.
 *
 * When loaded from encrypted wallets.json, setFundingWIF() is called once.
 * All consumers use getFundingWIF() instead of process.env.FUNDING_WIF.
 * process.env.FUNDING_WIF is synced so lazy readers in manage commands need zero changes.
 */

let _fundingWIF: string | null = null;

/**
 * Set the funding WIF in memory and sync to process.env for backward compat.
 */
export function setFundingWIF(wif: string): void {
  _fundingWIF = wif;
  process.env.FUNDING_WIF = wif;
}

/**
 * Get the funding WIF. Checks in-memory state first, then process.env fallback.
 * Throws if neither is configured.
 */
export function getFundingWIF(): string {
  if (_fundingWIF) return _fundingWIF;
  const envWif = process.env.FUNDING_WIF;
  if (envWif) return envWif;
  throw new Error('Funding WIF not configured. Run: yarn manage → Encrypt wallets file');
}

/**
 * Check if a funding WIF is available from any source.
 */
export function hasFundingWIF(): boolean {
  return !!(_fundingWIF || process.env.FUNDING_WIF);
}

/**
 * Clear the in-memory funding WIF (for tests).
 */
export function clearFundingWIF(): void {
  _fundingWIF = null;
}
