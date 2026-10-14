import { type CreateSwapRequest, type ListSwapRequestsQuery } from '@covershift/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/api/ApiProvider';
import { type SwapAction } from '../../lib/api/endpoints';
import { ApiError } from '../../lib/api/errors';
import { queryKeys } from '../../lib/api/queryKeys';

export const SWAP_PAGE_SIZE = 20;

/** A swap list with "Load more": cursor pages, newest first. */
export function useSwapList(orgId: string, filters: Partial<ListSwapRequestsQuery>) {
  const api = useApi();
  const query = { ...filters, organizationId: orgId, limit: SWAP_PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: queryKeys.swaps(orgId, query),
    queryFn: ({ pageParam }) => api.swaps({ ...query, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useShift(orgId: string, id: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.shift(orgId, id),
    queryFn: () => api.shift(id),
    staleTime: 60_000,
  });
}

/**
 * After any swap write, success or not, the server's state is the truth: refetch swaps
 * and shifts (approval reassigns a shift). A 403 can mean our role changed under us, so
 * /me is refetched too, which re-renders role-dependent screens.
 */
function useRefreshAfterWrite(orgId: string) {
  const queryClient = useQueryClient();
  return (error?: unknown) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.allSwaps(orgId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.allShifts(orgId) });
    void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'shift'] });
    if (error instanceof ApiError && error.status === 403) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    }
  };
}

export function useSwapAction(orgId: string) {
  const api = useApi();
  const refresh = useRefreshAfterWrite(orgId);
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: SwapAction }) => api.swapAction(id, action),
    onSettled: (_data, error) => refresh(error),
  });
}

export function useCreateSwap(orgId: string) {
  const api = useApi();
  const refresh = useRefreshAfterWrite(orgId);
  return useMutation({
    mutationFn: (body: CreateSwapRequest) => api.createSwap(body),
    onSettled: (_data, error) => refresh(error),
  });
}
