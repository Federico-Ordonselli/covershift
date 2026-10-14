import { type ListSwapRequestsQuery, type SwapRequest } from '@covershift/shared';
import { type ReactNode } from 'react';
import { ErrorAlert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Spinner } from '../../ui/Spinner';
import { useOrg } from '../orgs/orgContext';
import { useSwapList } from './hooks';
import { SwapCard } from './SwapCard';
import styles from './swaps.module.css';

/** A paginated list of swap requests; the caller decides which actions each one gets. */
export function SwapList(props: {
  filters: Partial<ListSwapRequestsQuery>;
  /** Client-side filter on top of the API filters (e.g. hide my own open offers). */
  include?: (swap: SwapRequest) => boolean;
  emptyText: string;
  actions?: (swap: SwapRequest) => ReactNode;
}) {
  const { org } = useOrg();
  const list = useSwapList(org.id, props.filters);

  if (list.isPending) return <Spinner label="Loading swap requests" />;
  if (list.isError) return <ErrorAlert error={list.error} onRetry={() => void list.refetch()} />;

  const swaps = list.data.pages.flatMap((p) => p.items).filter(props.include ?? (() => true));
  return (
    <>
      {swaps.length === 0 && !list.hasNextPage ? (
        <p className={styles.muted}>{props.emptyText}</p>
      ) : (
        <ul className={styles.list}>
          {swaps.map((swap) => (
            <SwapCard key={swap.id} swap={swap} actions={props.actions?.(swap)} />
          ))}
        </ul>
      )}
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </>
  );
}
