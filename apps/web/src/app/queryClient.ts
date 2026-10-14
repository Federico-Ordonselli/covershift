import { QueryClient } from '@tanstack/react-query';
import { ApiError, ContractError } from '../lib/api/errors';

/** 4xx answers and contract drift are final; network failures and 5xx get two retries. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (error instanceof ContractError) return false;
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
