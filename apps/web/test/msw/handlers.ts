import {
  MemberSchema,
  MeSchema,
  PositionSchema,
  type Shift,
  ShiftPageSchema,
  ShiftSchema,
  type SwapRequest,
  SwapRequestPageSchema,
  SwapRequestSchema,
} from '@covershift/shared';
import { http, type HttpResponse } from 'msw';
import { z } from 'zod';
import { ids, me, member, position, shift } from './fixtures';
import { ok } from './respond';
import { API } from './server';

/** The reads every org page makes, with contract-checked fixtures. */
export function orgHandlers(
  options: { shifts?: Shift[]; meOverrides?: Parameters<typeof me>[0] } = {},
) {
  const shiftRequests: URL[] = [];
  const handlers = [
    http.get(`${API}/me`, () => ok(MeSchema, me(options.meOverrides))),
    http.get(`${API}/organizations/:id/positions`, () => ok(z.array(PositionSchema), [position()])),
    http.get(`${API}/organizations/:id/members`, () =>
      ok(z.array(MemberSchema), [
        member(),
        member({ userId: me().id, fullName: 'Sam Carter' }),
        member({ userId: ids.jo, fullName: 'Jo Lindqvist' }),
      ]),
    ),
    http.get(`${API}/shifts`, ({ request }) => {
      shiftRequests.push(new URL(request.url));
      return ok(ShiftPageSchema, { items: options.shifts ?? [], nextCursor: null });
    }),
  ];
  return { handlers, shiftRequests };
}

/**
 * Swap endpoints: the list answers with `swaps` (one page) and records each query; every
 * action and create goes through `onWrite`, which defaults to echoing a valid swap.
 */
export function swapHandlers(
  options: {
    swaps?: SwapRequest[];
    onWrite?: (info: {
      action: string;
      id?: string;
      body?: unknown;
    }) => HttpResponse<never> | Response;
  } = {},
) {
  const listRequests: URLSearchParams[] = [];
  const writes: Array<{ action: string; id?: string; body?: unknown }> = [];
  const respond = (info: { action: string; id?: string; body?: unknown }) => {
    writes.push(info);
    return (
      options.onWrite?.(info) ?? ok(SwapRequestSchema, (options.swaps ?? [])[0] ?? sampleSwap())
    );
  };
  const handlers = [
    http.get(`${API}/swap-requests`, ({ request }) => {
      listRequests.push(new URL(request.url).searchParams);
      return ok(SwapRequestPageSchema, { items: options.swaps ?? [], nextCursor: null });
    }),
    http.get(`${API}/shifts/:id`, ({ params }) =>
      ok(
        ShiftSchema,
        shift({
          id: String(params.id),
          startsAt: '2030-10-15T04:00:00Z',
          endsAt: '2030-10-15T12:00:00Z',
        }),
      ),
    ),
    http.post(`${API}/swap-requests`, async ({ request }) =>
      respond({ action: 'create', body: await request.json() }),
    ),
    http.post(`${API}/swap-requests/:id/:action`, ({ params }) =>
      respond({ action: String(params.action), id: String(params.id) }),
    ),
  ];
  return { handlers, listRequests, writes };
}

function sampleSwap(): SwapRequest {
  return SwapRequestSchema.parse({
    id: '99999999-9999-4999-8999-999999999999',
    organizationId: ids.org,
    shiftId: '66666666-6666-4666-8666-000000000001',
    requesterId: ids.me,
    targetUserId: null,
    status: 'pending',
    note: null,
    decidedById: null,
    decidedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  });
}
