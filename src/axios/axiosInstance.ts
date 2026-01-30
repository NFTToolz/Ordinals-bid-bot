import axios, { AxiosInstance } from "axios";
import axiosRetry, { IAxiosRetryConfig } from "axios-retry";
import limiter from "../bottleneck";

// Memory leak fix: Reduce timeout from 5 minutes to 90 seconds to prevent long-lived requests
const axiosInstance: AxiosInstance = axios.create({
  timeout: 90000, // 90 seconds (was 300000ms / 5 minutes)
});

const retryConfig: IAxiosRetryConfig = {
  retries: 3,
  retryDelay: (retryCount, error: any) => {
    limiter.schedule(() => Promise.resolve());

    // Use exponential delay for network errors only
    // Rate limits are handled by bid pacer, not axios retry
    return axiosRetry.exponentialDelay(retryCount);
  },
  retryCondition: async (error: any) => {
    // DON'T retry on rate limits - let bid pacer handle it
    if (error.response && error.response.status === 429) {
      return false;
    }

    // Check for rate limit message in 400 responses - don't retry, propagate to caller
    if (error.response && error.response.status === 400 && error.response.data) {
      const data = error.response.data as any;
      const errorMessage = typeof data === 'string' ? data : data.error || data.message;
      if (errorMessage && /rate limit exceeded/i.test(errorMessage)) {
        return false;  // Don't retry rate limits, propagate to caller
      }
    }

    // Non-retryable errors
    const errorText = error.response?.data?.error || '';
    if (/have reached the maximum number of offers you can make: 20/i.test(errorText)) {
      return false;
    }
    if (/Insufficient funds. Required/i.test(errorText)) {
      return false;
    }
    if (/This offer does not exists. It is either not valid anymore or canceled by the offerer./i.test(errorText)) {
      return false;
    }

    if (/You already have an offer for this token/i.test(errorText)) {
      return true;
    }

    // Only retry network errors
    return axiosRetry.isNetworkError(error);
  },
};

axiosRetry(axiosInstance, retryConfig);

export default axiosInstance;