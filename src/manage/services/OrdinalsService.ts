import axios from 'axios';

const HIRO_API = 'https://api.hiro.so/ordinals/v1';

export interface Inscription {
  id: string;
  number: number;
  address: string;
  genesis_address: string;
  genesis_block_height: number;
  genesis_block_hash: string;
  genesis_tx_id: string;
  genesis_fee: string;
  genesis_timestamp: number;
  tx_id: string;
  location: string;
  output: string;
  value: string;
  offset: string;
  sat_ordinal: string;
  sat_rarity: string;
  sat_coinbase_height: number;
  mime_type: string;
  content_type: string;
  content_length: number;
  timestamp: number;
  curse_type: string | null;
  recursive: boolean;
  recursion_refs: string[] | null;
}

export interface InscriptionsByAddress {
  address: string;
  inscriptions: Inscription[];
  total: number;
}

/**
 * Fetch inscriptions for a single address
 */
export async function getInscriptions(
  address: string,
  limit: number = 60,
  offset: number = 0
): Promise<{ results: Inscription[]; total: number }> {
  try {
    const response = await axios.get(`${HIRO_API}/inscriptions`, {
      params: {
        address,
        limit,
        offset,
      },
    });

    return {
      results: response.data.results,
      total: response.data.total,
    };
  } catch (error) {
    return { results: [], total: 0 };
  }
}

/**
 * Fetch all inscriptions for an address (handles pagination)
 */
export async function getAllInscriptions(address: string): Promise<Inscription[]> {
  const allInscriptions: Inscription[] = [];
  let offset = 0;
  const limit = 60;

  while (true) {
    const { results, total } = await getInscriptions(address, limit, offset);
    allInscriptions.push(...results);

    if (allInscriptions.length >= total || results.length === 0) {
      break;
    }

    offset += limit;

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return allInscriptions;
}

/**
 * Fetch inscriptions for multiple addresses
 */
export async function getInscriptionsForAddresses(
  addresses: string[],
  onProgress?: (current: number, total: number) => void
): Promise<InscriptionsByAddress[]> {
  const results: InscriptionsByAddress[] = [];

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    const inscriptions = await getAllInscriptions(address);

    results.push({
      address,
      inscriptions,
      total: inscriptions.length,
    });

    if (onProgress) {
      onProgress(i + 1, addresses.length);
    }

    // Rate limiting between addresses
    if (i < addresses.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  return results;
}

/**
 * Get inscription by ID
 */
export async function getInscriptionById(inscriptionId: string): Promise<Inscription | null> {
  try {
    const response = await axios.get(`${HIRO_API}/inscriptions/${inscriptionId}`);
    return response.data;
  } catch (error) {
    return null;
  }
}

/**
 * Get inscription content
 */
export async function getInscriptionContent(inscriptionId: string): Promise<Buffer | null> {
  try {
    const response = await axios.get(`${HIRO_API}/inscriptions/${inscriptionId}/content`, {
      responseType: 'arraybuffer',
    });
    return Buffer.from(response.data);
  } catch (error) {
    return null;
  }
}

/**
 * Format inscription for display
 */
export function formatInscription(inscription: Inscription): {
  id: string;
  number: string;
  type: string;
  rarity: string;
  value: string;
} {
  // Clean up content type - extract just the main type
  let type = inscription.content_type;
  // Remove charset and other params (e.g., "html;charset=utf-8" → "html")
  type = type.split(';')[0];
  // Get subtype from MIME (e.g., "text/html" → "html", "model/gltf+json" → "gltf")
  const parts = type.split('/');
  if (parts.length > 1) {
    type = parts[1].split('+')[0]; // Handle "gltf+json" → "gltf"
  }
  // Map common types to shorter names
  if (type === 'plain') type = 'text';

  return {
    id: inscription.id.slice(0, 8) + '...' + inscription.id.slice(-8),
    number: `#${inscription.number}`,
    type,
    rarity: inscription.sat_rarity,
    value: (parseInt(inscription.value) / 100000000).toFixed(8) + ' BTC',
  };
}

/**
 * Check if an address has any inscriptions (for safety checks before consolidation)
 */
export async function hasInscriptions(address: string): Promise<boolean> {
  const { total } = await getInscriptions(address, 1, 0);
  return total > 0;
}

/**
 * Check multiple addresses for inscriptions
 */
export async function checkAddressesForInscriptions(
  addresses: string[],
  onProgress?: (current: number, total: number) => void
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    const has = await hasInscriptions(address);
    results.set(address, has);

    if (onProgress) {
      onProgress(i + 1, addresses.length);
    }

    // Rate limiting
    if (i < addresses.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}
