import {
  MemberSchema,
  MeSchema,
  PositionSchema,
  type Shift,
  ShiftPageSchema,
} from '@covershift/shared';
import { http } from 'msw';
import { z } from 'zod';
import { me, member, position } from './fixtures';
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
      ok(z.array(MemberSchema), [member(), member({ userId: me().id, fullName: 'Sam Carter' })]),
    ),
    http.get(`${API}/shifts`, ({ request }) => {
      shiftRequests.push(new URL(request.url));
      return ok(ShiftPageSchema, { items: options.shifts ?? [], nextCursor: null });
    }),
  ];
  return { handlers, shiftRequests };
}
