import { type RouteObject } from 'react-router';
import { LoginPage } from '../features/auth/LoginPage';
import { NotFoundPage } from '../features/NotFoundPage';
import { OrgLayout } from '../features/orgs/OrgLayout';
import { RootRedirect } from '../features/orgs/RootRedirect';
import { SchedulePage } from '../features/schedule/SchedulePage';
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
          { path: 'schedule', element: <SchedulePage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
