import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/api/ApiProvider';
import { queryKeys } from '../../lib/api/queryKeys';

const FIVE_MINUTES = 5 * 60_000;

export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.me, queryFn: api.me, staleTime: FIVE_MINUTES });
}

export function usePositions(orgId: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.positions(orgId),
    queryFn: () => api.positions(orgId),
    staleTime: FIVE_MINUTES,
  });
}

export function useMembers(orgId: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.members(orgId),
    queryFn: () => api.members(orgId),
    staleTime: FIVE_MINUTES,
  });
}
