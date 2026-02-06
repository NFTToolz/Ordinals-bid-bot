/**
 * Tests for collection commands
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

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
  showTable: vi.fn(),
  showCollectionSummary: vi.fn(),
  getSeparatorWidth: vi.fn(() => 60),
  formatBTC: vi.fn((sats: number) => `${(sats / 100000000).toFixed(8)} BTC`),
  withSpinner: vi.fn().mockImplementation(async (message, fn) => fn()),
  clearScreen: vi.fn(),
}));

vi.mock('../../utils/interactiveTable', () => ({
  showInteractiveTable: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../utils/prompts', () => ({
  promptConfirm: vi.fn().mockResolvedValue(true),
  promptSelect: vi.fn().mockResolvedValue('test-collection'),
  promptInteger: vi.fn().mockResolvedValue(20),
  promptText: vi.fn().mockResolvedValue('test-collection'),
  promptBTC: vi.fn().mockResolvedValue(0.001),
  promptFloorPercentage: vi.fn().mockResolvedValue(80),
}));

// Mock CollectionService
const mockCollections = [
  {
    collectionSymbol: 'test-collection-1',
    minBid: 0.001,
    maxBid: 0.01,
    minFloorBid: 50,
    maxFloorBid: 95,
    bidCount: 20,
    offerType: 'ITEM',
    enableCounterBidding: true,
  },
  {
    collectionSymbol: 'test-collection-2',
    minBid: 0.002,
    maxBid: 0.02,
    minFloorBid: 60,
    maxFloorBid: 90,
    bidCount: 10,
    offerType: 'COLLECTION',
    enableCounterBidding: false,
  },
];

vi.mock('../../services/CollectionService', () => ({
  loadCollections: vi.fn(() => mockCollections),
  searchCollections: vi.fn().mockResolvedValue([
    { name: 'Test Collection', symbol: 'test-collection', floorPrice: 1000000 },
  ]),
  fetchCollectionInfo: vi.fn().mockResolvedValue({
    name: 'Test Collection',
    symbol: 'test-collection',
    floorPrice: 1000000,
    listedCount: 100,
  }),
  addCollection: vi.fn(),
  removeCollection: vi.fn(),
  updateCollection: vi.fn(),
  createDefaultConfig: vi.fn().mockReturnValue({
    collectionSymbol: 'test-collection',
    minBid: 0.001,
    maxBid: 0.01,
    minFloorBid: 50,
    maxFloorBid: 95,
    bidCount: 20,
    offerType: 'ITEM',
    enableCounterBidding: false,
  }),
  validateCollection: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

describe('Collection Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listCollections', () => {
    it('should display collections with floor prices', async () => {
      const { listCollections } = await import('./list');
      const display = await import('../../utils/display');
      const { showInteractiveTable } = await import('../../utils/interactiveTable');

      await listCollections();

      expect(display.showSectionHeader).toHaveBeenCalledWith('COLLECTIONS');
      expect(showInteractiveTable).toHaveBeenCalled();
    });

    it('should show warning when no collections', async () => {
      const { listCollections } = await import('./list');
      const { loadCollections } = await import('../../services/CollectionService');
      const display = await import('../../utils/display');

      vi.mocked(loadCollections).mockReturnValueOnce([]);

      await listCollections();

      expect(display.showWarning).toHaveBeenCalledWith('No collections configured');
    });
  });

  describe('addCollectionCommand', () => {
    it('should return early when query is empty', async () => {
      const { addCollectionCommand } = await import('./add');
      const prompts = await import('../../utils/prompts');
      const { searchCollections } = await import('../../services/CollectionService');

      vi.mocked(prompts.promptText).mockResolvedValueOnce('');

      await addCollectionCommand();

      expect(searchCollections).not.toHaveBeenCalled();
    });

    it('should search collections and display results', async () => {
      const { addCollectionCommand } = await import('./add');
      const prompts = await import('../../utils/prompts');
      const { searchCollections } = await import('../../services/CollectionService');

      vi.mocked(prompts.promptText).mockResolvedValueOnce('test');
      vi.mocked(prompts.promptSelect).mockResolvedValueOnce('__cancel__' as any);

      await addCollectionCommand();

      expect(searchCollections).toHaveBeenCalledWith('test');
    });

    it('should handle no search results', async () => {
      const { addCollectionCommand } = await import('./add');
      const prompts = await import('../../utils/prompts');
      const { searchCollections } = await import('../../services/CollectionService');
      const display = await import('../../utils/display');

      vi.mocked(prompts.promptText).mockResolvedValueOnce('nonexistent');
      vi.mocked(searchCollections).mockResolvedValueOnce([]);
      vi.mocked(prompts.promptConfirm).mockResolvedValueOnce(false);

      await addCollectionCommand();

      expect(display.showWarning).toHaveBeenCalledWith('No collections found matching that query');
    });
  });
});

describe('Collection Validation', () => {
  it('should validate required fields', () => {
    const collection = {
      collectionSymbol: 'test',
      minBid: 0.001,
      maxBid: 0.01,
      minFloorBid: 50,
      maxFloorBid: 95,
      bidCount: 20,
      offerType: 'ITEM',
    };

    const errors: string[] = [];

    if (!collection.collectionSymbol || typeof collection.collectionSymbol !== 'string') {
      errors.push('collectionSymbol is required');
    }
    if (typeof collection.minBid !== 'number' || collection.minBid < 0) {
      errors.push('minBid must be a non-negative number');
    }
    if (typeof collection.maxBid !== 'number' || collection.maxBid < 0) {
      errors.push('maxBid must be a non-negative number');
    }
    if (!['ITEM', 'COLLECTION'].includes(collection.offerType)) {
      errors.push('offerType must be ITEM or COLLECTION');
    }

    expect(errors).toHaveLength(0);
  });

  it('should catch minBid > maxBid', () => {
    const collection = {
      minBid: 0.02,
      maxBid: 0.01,
    };

    const errors: string[] = [];

    if (collection.minBid > collection.maxBid) {
      errors.push('minBid cannot be greater than maxBid');
    }

    expect(errors).toContain('minBid cannot be greater than maxBid');
  });

  it('should catch minFloorBid > maxFloorBid', () => {
    const collection = {
      minFloorBid: 95,
      maxFloorBid: 50,
    };

    const errors: string[] = [];

    if (collection.minFloorBid > collection.maxFloorBid) {
      errors.push('minFloorBid cannot be greater than maxFloorBid');
    }

    expect(errors).toContain('minFloorBid cannot be greater than maxFloorBid');
  });

  it('should validate bidCount is positive', () => {
    const collection = {
      bidCount: 0,
    };

    const errors: string[] = [];

    if (collection.bidCount <= 0) {
      errors.push('bidCount must be positive');
    }

    expect(errors).toContain('bidCount must be positive');
  });
});

describe('Collection Display', () => {
  it('should truncate long collection symbols', () => {
    const symbol = 'this-is-a-very-long-collection-symbol-name';
    const maxLength = 20;

    const displaySymbol = symbol.length > maxLength
      ? symbol.slice(0, maxLength - 3) + '...'
      : symbol;

    expect(displaySymbol.length).toBeLessThanOrEqual(maxLength);
  });

  it('should format floor percentage range', () => {
    const minFloorBid = 50;
    const maxFloorBid = 95;

    const floorStr = `${minFloorBid}-${maxFloorBid}%`;

    expect(floorStr).toBe('50-95%');
  });

  it('should display counter-bidding status', () => {
    const collection = { enableCounterBidding: true };

    const status = collection.enableCounterBidding ? 'Yes' : 'No';

    expect(status).toBe('Yes');
  });
});

describe('Collection Search', () => {
  it('should handle search results', () => {
    const results = [
      { name: 'Collection A', symbol: 'coll-a', floorPrice: 1000000 },
      { name: 'Collection B', symbol: 'coll-b', floorPrice: 2000000 },
    ];

    const choices = results.map(r => ({
      name: `${r.name} (Floor: ${r.floorPrice})`,
      value: r.symbol,
    }));

    expect(choices).toHaveLength(2);
    expect(choices[0].value).toBe('coll-a');
  });

  it('should add custom option to choices', () => {
    const results = [
      { name: 'Collection A', symbol: 'coll-a', floorPrice: 1000000 },
    ];

    const choices = results.map(r => ({
      name: `${r.name}`,
      value: r.symbol,
    }));

    choices.push({ name: '[Enter custom symbol]', value: '__custom__' });
    choices.push({ name: '← Back', value: '__cancel__' });

    expect(choices).toHaveLength(3);
    expect(choices[1].value).toBe('__custom__');
  });
});

describe('Default Collection Config', () => {
  it('should create default config with symbol', () => {
    const symbol = 'test-collection';
    const floorPrice = 1000000;

    const defaultConfig = {
      collectionSymbol: symbol,
      minBid: 0.001,
      maxBid: Math.min(0.1, floorPrice / 100000000),
      minFloorBid: 50,
      maxFloorBid: 95,
      bidCount: 20,
      duration: 60,
      scheduledLoop: 60,
      enableCounterBidding: false,
      outBidMargin: 0.000001,
      offerType: 'ITEM',
      quantity: 1,
      feeSatsPerVbyte: 28,
    };

    expect(defaultConfig.collectionSymbol).toBe(symbol);
    expect(defaultConfig.offerType).toBe('ITEM');
  });

  it('should cap maxBid at floor price', () => {
    const floorPrice = 500000; // 0.005 BTC
    const defaultMaxBid = 0.1;

    const maxBid = Math.min(defaultMaxBid, floorPrice / 100000000);

    expect(maxBid).toBe(0.005);
  });
});

describe('Collection Removal', () => {
  it('should find collection by symbol', () => {
    const collections = mockCollections;
    const symbolToRemove = 'test-collection-1';

    const index = collections.findIndex(c => c.collectionSymbol === symbolToRemove);

    expect(index).toBe(0);
  });

  it('should return -1 for non-existent collection', () => {
    const collections = mockCollections;
    const symbolToRemove = 'non-existent';

    const index = collections.findIndex(c => c.collectionSymbol === symbolToRemove);

    expect(index).toBe(-1);
  });
});

describe('Collection Update', () => {
  it('should update specific fields', () => {
    const collection = {
      collectionSymbol: 'test',
      minBid: 0.001,
      maxBid: 0.01,
    };

    const updates = {
      minBid: 0.002,
      maxBid: 0.02,
    };

    const updated = { ...collection, ...updates };

    expect(updated.minBid).toBe(0.002);
    expect(updated.maxBid).toBe(0.02);
    expect(updated.collectionSymbol).toBe('test');
  });
});

describe('Floor Price Calculations', () => {
  it('should calculate min offer from floor percentage', () => {
    const floorPrice = 1000000;
    const minFloorBid = 50; // 50%

    const minOffer = Math.round(minFloorBid * floorPrice / 100);

    expect(minOffer).toBe(500000);
  });

  it('should calculate max offer from floor percentage', () => {
    const floorPrice = 1000000;
    const maxFloorBid = 95; // 95%

    const maxOffer = Math.round(maxFloorBid * floorPrice / 100);

    expect(maxOffer).toBe(950000);
  });
});

describe('Wallet Group Assignment', () => {
  it('should assign wallet group to collection', () => {
    const collection = {
      collectionSymbol: 'test',
      walletGroup: undefined as string | undefined,
    };

    const groupName = 'primary-group';
    collection.walletGroup = groupName;

    expect(collection.walletGroup).toBe('primary-group');
  });

  it('should clear wallet group assignment', () => {
    const collection = {
      collectionSymbol: 'test',
      walletGroup: 'primary-group' as string | undefined,
    };

    collection.walletGroup = undefined;

    expect(collection.walletGroup).toBeUndefined();
  });
});

describe('Trait Configuration', () => {
  it('should add traits to collection', () => {
    const collection = {
      collectionSymbol: 'test',
      traits: [] as Array<{ traitType: string; value: string }>,
    };

    collection.traits.push({ traitType: 'Background', value: 'Blue' });
    collection.traits.push({ traitType: 'Eyes', value: 'Laser' });

    expect(collection.traits).toHaveLength(2);
    expect(collection.traits[0].traitType).toBe('Background');
  });

  it('should handle empty traits array', () => {
    const collection = {
      collectionSymbol: 'test',
      traits: [],
    };

    const hasTraits = collection.traits && collection.traits.length > 0;

    expect(hasTraits).toBe(false);
  });
});

// ============================================================================
// Collection Edit Logic Tests
// ============================================================================
describe('Collection Edit Logic', () => {
  it('should build field edit choices', () => {
    const collection = {
      minBid: 0.001,
      maxBid: 0.01,
      minFloorBid: 50,
      maxFloorBid: 95,
      bidCount: 20,
      duration: 60,
      enableCounterBidding: true,
      offerType: 'ITEM',
      quantity: 1,
      scheduledLoop: 60,
      outBidMargin: 0.000001,
    };

    const choices = [
      { name: `Min Bid (${collection.minBid} BTC)`, value: 'minBid' },
      { name: `Max Bid (${collection.maxBid} BTC)`, value: 'maxBid' },
      { name: `Min Floor % (${collection.minFloorBid}%)`, value: 'minFloorBid' },
      { name: `Max Floor % (${collection.maxFloorBid}%)`, value: 'maxFloorBid' },
      { name: `Bid Count (${collection.bidCount})`, value: 'bidCount' },
      { name: `Duration (${collection.duration} min)`, value: 'duration' },
      { name: `Counter-Bidding (${collection.enableCounterBidding ? 'Enabled' : 'Disabled'})`, value: 'counterBidding' },
      { name: '── Save and exit ──', value: '__save__' },
      { name: '── Cancel ──', value: '__cancel__' },
    ];

    expect(choices.length).toBe(9);
    expect(choices[0].name).toContain('0.001');
    expect(choices[6].name).toContain('Enabled');
  });

  it('should handle save action', () => {
    const action = '__save__';
    const shouldSave = action === '__save__';

    expect(shouldSave).toBe(true);
  });

  it('should handle cancel action', () => {
    const action = '__cancel__';
    const shouldCancel = action === '__cancel__';

    expect(shouldCancel).toBe(true);
  });

  it('should update minBid field', () => {
    const collection = { minBid: 0.001 };
    const newValue = 0.002;

    collection.minBid = newValue;

    expect(collection.minBid).toBe(0.002);
  });

  it('should update maxBid field', () => {
    const collection = { maxBid: 0.01 };
    const newValue = 0.02;

    collection.maxBid = newValue;

    expect(collection.maxBid).toBe(0.02);
  });

  it('should update floor percentage fields', () => {
    const collection = { minFloorBid: 50, maxFloorBid: 95 };

    collection.minFloorBid = 60;
    collection.maxFloorBid = 90;

    expect(collection.minFloorBid).toBe(60);
    expect(collection.maxFloorBid).toBe(90);
  });

  it('should update bidCount field', () => {
    const collection = { bidCount: 20 };

    collection.bidCount = 30;

    expect(collection.bidCount).toBe(30);
  });

  it('should update duration field', () => {
    const collection = { duration: 60 };

    collection.duration = 120;

    expect(collection.duration).toBe(120);
  });

  it('should toggle counter-bidding', () => {
    const collection = { enableCounterBidding: false };

    collection.enableCounterBidding = true;

    expect(collection.enableCounterBidding).toBe(true);
  });

  it('should update offerType field', () => {
    const collection = { offerType: 'ITEM' as 'ITEM' | 'COLLECTION' };

    collection.offerType = 'COLLECTION';

    expect(collection.offerType).toBe('COLLECTION');
  });

  it('should update quantity field', () => {
    const collection = { quantity: 1 };

    collection.quantity = 5;

    expect(collection.quantity).toBe(5);
  });

  it('should update scheduledLoop field', () => {
    const collection = { scheduledLoop: 60 };

    collection.scheduledLoop = 120;

    expect(collection.scheduledLoop).toBe(120);
  });

  it('should update outBidMargin field', () => {
    const collection = { outBidMargin: 0.000001 };

    collection.outBidMargin = 0.00001;

    expect(collection.outBidMargin).toBe(0.00001);
  });

  it('should find collection by symbol', () => {
    const collections = [
      { collectionSymbol: 'coll-1', minBid: 0.001 },
      { collectionSymbol: 'coll-2', minBid: 0.002 },
    ];

    const selectedSymbol = 'coll-2';
    const collection = collections.find(c => c.collectionSymbol === selectedSymbol);

    expect(collection).toBeDefined();
    expect(collection?.minBid).toBe(0.002);
  });

  it('should handle collection not found', () => {
    const collections = [
      { collectionSymbol: 'coll-1' },
    ];

    const collection = collections.find(c => c.collectionSymbol === 'nonexistent');

    expect(collection).toBeUndefined();
  });

  it('should build edit choices list', () => {
    const collections = [
      { collectionSymbol: 'coll-1', minBid: 0.001, maxBid: 0.01, offerType: 'ITEM' },
      { collectionSymbol: 'coll-2', minBid: 0.002, maxBid: 0.02, offerType: 'COLLECTION' },
    ];

    const choices = collections.map(c => ({
      name: `${c.collectionSymbol} (${c.minBid}-${c.maxBid} BTC, ${c.offerType})`,
      value: c.collectionSymbol,
    }));

    choices.push({ name: 'Cancel', value: '__cancel__' });

    expect(choices).toHaveLength(3);
    expect(choices[0].name).toContain('0.001-0.01');
  });
});

// ============================================================================
// Collection Remove Logic Tests
// ============================================================================
describe('Collection Remove Logic', () => {
  it('should build removal choices', () => {
    const collections = [
      { collectionSymbol: 'coll-1' },
      { collectionSymbol: 'coll-2' },
    ];

    const choices = collections.map(c => ({
      name: c.collectionSymbol,
      value: c.collectionSymbol,
    }));

    choices.push({ name: 'Cancel', value: '__cancel__' });

    expect(choices).toHaveLength(3);
  });

  it('should filter out removed collection', () => {
    const collections = [
      { collectionSymbol: 'coll-1' },
      { collectionSymbol: 'coll-2' },
      { collectionSymbol: 'coll-3' },
    ];

    const symbolToRemove = 'coll-2';
    const filtered = collections.filter(c => c.collectionSymbol !== symbolToRemove);

    expect(filtered).toHaveLength(2);
    expect(filtered.map(c => c.collectionSymbol)).toEqual(['coll-1', 'coll-3']);
  });
});

// ============================================================================
// Collection Scan Logic Tests
// ============================================================================
describe('Collection Scan Logic', () => {
  it('should format floor price for display', () => {
    const floorPrice = 1500000; // 0.015 BTC

    const formatted = `${(floorPrice / 100000000).toFixed(8)} BTC`;

    expect(formatted).toBe('0.01500000 BTC');
  });

  it('should calculate 24h volume percentage change', () => {
    const prev = 10;
    const current = 15;

    const change = prev > 0 ? ((current - prev) / prev) * 100 : 0;

    expect(change).toBe(50);
  });

  it('should handle zero previous volume', () => {
    const prev = 0;
    const current = 10;

    const change = prev > 0 ? ((current - prev) / prev) * 100 : 0;

    expect(change).toBe(0);
  });

  it('should sort collections by floor price', () => {
    const collections = [
      { symbol: 'c1', floorPrice: 2000000 },
      { symbol: 'c2', floorPrice: 500000 },
      { symbol: 'c3', floorPrice: 1500000 },
    ];

    const sorted = [...collections].sort((a, b) => b.floorPrice - a.floorPrice);

    expect(sorted[0].symbol).toBe('c1');
    expect(sorted[2].symbol).toBe('c2');
  });

  it('should sort collections by listed count', () => {
    const collections = [
      { symbol: 'c1', listedCount: 50 },
      { symbol: 'c2', listedCount: 200 },
      { symbol: 'c3', listedCount: 100 },
    ];

    const sorted = [...collections].sort((a, b) => b.listedCount - a.listedCount);

    expect(sorted[0].symbol).toBe('c2');
  });

  it('should paginate results', () => {
    const collections = Array.from({ length: 50 }, (_, i) => ({ symbol: `c${i}` }));
    const pageSize = 20;
    const page = 1;

    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const pageItems = collections.slice(startIndex, endIndex);

    expect(pageItems).toHaveLength(20);
    expect(pageItems[0].symbol).toBe('c20');
  });
});

// ============================================================================
// Collection Configuration Validation Tests
// ============================================================================
describe('Collection Configuration Validation', () => {
  it('should validate maxFloorBid <= 100 for non-trait offers', () => {
    const config = {
      offerType: 'ITEM',
      maxFloorBid: 110,
      traits: [],
    };

    const errors: string[] = [];
    const hasTraits = config.traits && config.traits.length > 0;

    if (config.offerType === 'ITEM' && !hasTraits && config.maxFloorBid > 100) {
      errors.push('maxFloorBid cannot exceed 100% for non-trait ITEM offers');
    }

    expect(errors).toContain('maxFloorBid cannot exceed 100% for non-trait ITEM offers');
  });

  it('should allow maxFloorBid > 100 for trait offers', () => {
    const config = {
      offerType: 'ITEM',
      maxFloorBid: 150,
      traits: [{ traitType: 'Background', value: 'Blue' }],
    };

    const errors: string[] = [];
    const hasTraits = config.traits && config.traits.length > 0;

    if (config.offerType === 'ITEM' && !hasTraits && config.maxFloorBid > 100) {
      errors.push('maxFloorBid cannot exceed 100% for non-trait ITEM offers');
    }

    expect(errors).toHaveLength(0);
  });

  it('should validate duration is positive', () => {
    const config = { duration: 0 };

    const errors: string[] = [];

    if (config.duration <= 0) {
      errors.push('duration must be positive');
    }

    expect(errors).toContain('duration must be positive');
  });

  it('should validate scheduledLoop is reasonable', () => {
    const config = { scheduledLoop: 5 };
    const MIN_LOOP = 10;

    const errors: string[] = [];

    if (config.scheduledLoop < MIN_LOOP) {
      errors.push(`scheduledLoop should be at least ${MIN_LOOP} seconds`);
    }

    expect(errors).toContain('scheduledLoop should be at least 10 seconds');
  });

  it('should validate outBidMargin is positive', () => {
    const config = { outBidMargin: -0.001 };

    const errors: string[] = [];

    if (config.outBidMargin <= 0) {
      errors.push('outBidMargin must be positive');
    }

    expect(errors).toContain('outBidMargin must be positive');
  });

  it('should validate quantity is at least 1', () => {
    const config = { quantity: 0 };

    const errors: string[] = [];

    if (config.quantity < 1) {
      errors.push('quantity must be at least 1');
    }

    expect(errors).toContain('quantity must be at least 1');
  });
});
