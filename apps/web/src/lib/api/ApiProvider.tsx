import { createContext, type ReactNode, useContext } from 'react';
import { type Endpoints } from './endpoints';

const ApiContext = createContext<Endpoints | null>(null);

export function ApiProvider({
  endpoints,
  children,
}: {
  endpoints: Endpoints;
  children: ReactNode;
}) {
  return <ApiContext.Provider value={endpoints}>{children}</ApiContext.Provider>;
}

export function useApi(): Endpoints {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi outside <ApiProvider>');
  return api;
}
