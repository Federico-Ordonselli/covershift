import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react';
import { type AuthState, type SessionStore } from './session';

const SessionContext = createContext<SessionStore | null>(null);

export function SessionProvider({ store, children }: { store: SessionStore; children: ReactNode }) {
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

export function useSessionStore(): SessionStore {
  const store = useContext(SessionContext);
  if (!store) throw new Error('useSessionStore outside <SessionProvider>');
  return store;
}

export function useAuthState(): AuthState {
  const store = useSessionStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
