import { vi } from 'vitest';
import type { AxiosResponse, AxiosError } from 'axios';

/**
 * Create a mock successful Axios response
 */
export function createMockResponse<T>(data: T, status = 200): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: 'OK',
    headers: {},
    config: {
      headers: {} as any,
    },
  };
}

/**
 * Create a mock Axios error
 */
export function createMockError(
  status: number,
  data: any,
  message = 'Request failed'
): AxiosError {
  const error = new Error(message) as AxiosError;
  error.response = {
    data,
    status,
    statusText: status >= 400 ? 'Error' : 'OK',
    headers: {},
    config: { headers: {} as any },
  };
  error.isAxiosError = true;
  return error;
}

/**
 * Sample token response for testing
 */
export const sampleTokensResponse = {
  tokens: [
    {
      id: 'token123i0',
      collectionSymbol: 'test-collection',
      listed: true,
      listedPrice: 50000,
      owner: 'bc1qowner',
      meta: { name: 'Test Token #1', attributes: [] },
      inscriptionNumber: 12345,
      chain: 'btc',
    },
    {
      id: 'token456i0',
      collectionSymbol: 'test-collection',
      listed: true,
      listedPrice: 60000,
      owner: 'bc1qowner2',
      meta: { name: 'Test Token #2', attributes: [] },
      inscriptionNumber: 12346,
      chain: 'btc',
    },
    {
      id: 'token789i0',
      collectionSymbol: 'test-collection',
      listed: false, // Unlisted
      listedPrice: 0,
      owner: 'bc1qowner3',
      meta: { name: 'Test Token #3', attributes: [] },
      inscriptionNumber: 12347,
      chain: 'btc',
    },
  ],
};

/**
 * Sample offer response for testing
 */
export const sampleOfferResponse = {
  total: '2',
  offers: [
    {
      id: 'offer-1',
      tokenId: 'token123i0',
      price: 45000,
      buyerReceiveAddress: 'bc1pbuyer1',
      buyerPaymentAddress: 'bc1qbuyer1',
      expirationDate: Date.now() + 3600000,
      isValid: true,
      token: { collectionSymbol: 'test-collection' },
    },
    {
      id: 'offer-2',
      tokenId: 'token123i0',
      price: 42000,
      buyerReceiveAddress: 'bc1pbuyer2',
      buyerPaymentAddress: 'bc1qbuyer2',
      expirationDate: Date.now() + 3600000,
      isValid: true,
      token: { collectionSymbol: 'test-collection' },
    },
  ],
};

/**
 * Sample collection offer response
 */
export const sampleCollectionOfferResponse = {
  total: '1',
  offers: [
    {
      id: 'col-offer-1',
      collectionSymbol: 'test-collection',
      status: 'valid',
      quantity: 1,
      price: { amount: 40000, currency: 'BTC', decimals: 8 },
      maker: 'bc1qmaker',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      btcParams: {
        makerOrdinalReceiveAddress: 'bc1preceive',
        makerPaymentAddress: 'bc1qpayment',
        pendingDeposits: [],
      },
    },
  ],
};

/**
 * Sample collection details response
 */
export const sampleCollectionDetails = {
  totalVolume: '100.5',
  owners: '500',
  supply: '1000',
  floorPrice: '50000',
  totalListed: '150',
  pendingTransactions: '5',
  inscriptionNumberMin: '10000',
  inscriptionNumberMax: '11000',
  symbol: 'test-collection',
};

/**
 * Sample create offer response (unsigned PSBT)
 */
export const sampleCreateOfferResponse = {
  psbtBase64: 'cHNidP8B...', // Would be actual base64 PSBT
  toSignInputs: [0],
};

/**
 * Sample collection offer create response
 */
export const sampleCollectionOfferCreateResponse = {
  offers: [
    {
      psbtBase64: 'cHNidP8B...',
      transactionFeeSats: 1500,
      cancelPsbtBase64: 'cHNidP8C...',
      cancelTransactionFeeSats: 500,
    },
  ],
};

/**
 * Create a mock axios instance for testing
 */
export function createMockAxiosInstance() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    request: vi.fn(),
    defaults: {
      headers: {
        common: {},
      },
    },
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
  };
}
