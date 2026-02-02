/**
 * Type-safe error message extraction utility.
 * Handles unknown error types safely without using `any` type assertions.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Unknown error';
}

/**
 * Extract error response data from axios-like errors.
 * Returns undefined if no response data is available.
 */
export function getErrorResponseData(error: unknown): unknown {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response: unknown }).response;
    if (response && typeof response === 'object' && 'data' in response) {
      return (response as { data: unknown }).data;
    }
  }
  return undefined;
}

/**
 * Extract HTTP status code from axios-like errors.
 * Returns undefined if no status is available.
 */
export function getErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response: unknown }).response;
    if (response && typeof response === 'object' && 'status' in response) {
      const status = (response as { status: unknown }).status;
      if (typeof status === 'number') {
        return status;
      }
    }
  }
  return undefined;
}
