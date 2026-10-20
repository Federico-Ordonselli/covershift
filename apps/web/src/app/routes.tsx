import { type RouteObject } from 'react-router';
import { LoginPage } from '../features/auth/LoginPage';
import { NotFoundPage } from '../features/NotFoundPage';
import { WorkerProfilePage } from '../features/orgs/WorkerProfilePage';
import { OrgLayout } from '../features/orgs/OrgLayout';
import { RootRedirect } from '../features/orgs/RootRedirect';
import { InboxPage } from '../features/inbox/InboxPage';
import { SchedulePage } from '../features/schedule/SchedulePage';
import { SwapsPage } from '../features/swaps/SwapsPage';
import { RequireAuth } from '../lib/auth/RequireAuth';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <RootRedirect /> },
      {
        path: '/orgs/:orgId',
        element: <OrgLayout />,
        children: [
          { index: true, element: <SchedulePage /> },
          { path: 'profile', element: <WorkerProfilePage /> },
          { path: 'schedule', element: <SchedulePage /> },
          { path: 'swaps', element: <SwapsPage /> },
          { path: 'swaps/:tab', element: <SwapsPage /> },
          { path: 'inbox', element: <InboxPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
