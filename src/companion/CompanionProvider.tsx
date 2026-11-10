import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { CompanionClient } from '../api/companion-contracts';
import { builtinPenguin } from './builtin-packs';
import { getCompanionCache } from './companion-cache';
import { CompanionStore, type CompanionSnapshot } from './companion-store';
import { deviceCompanionPreferences } from './device-preferences';
import type { CompanionCache, CompanionKey } from './types';

const cache: CompanionCache = {
  read: async (...args) => (await getCompanionCache()).read(...args),
  prepare: async (...args) => (await getCompanionCache()).prepare(...args),
};
type CompanionValue = CompanionSnapshot & { select: (key: CompanionKey) => Promise<void>; refresh: () => Promise<void> };
const CompanionContext = createContext<CompanionValue | null>(null);

/** 连接根上的展示 Store；选图只更新 context，不以形象 key 重挂业务子树。 */
export function CompanionProvider({ children, serverScope, client, connected, connectionResolved }: {
  children: ReactNode; serverScope?: string; client?: CompanionClient; connected: boolean; connectionResolved: boolean;
}) {
  const [store] = useState(() => new CompanionStore(builtinPenguin, deviceCompanionPreferences, cache));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { store.connect(serverScope, client, connected, connectionResolved); void store.load(); }, [store, serverScope, client, connected, connectionResolved]);
  useEffect(() => () => store.dispose(), [store]);
  return <CompanionContext.Provider value={{ ...snapshot, select: (key) => store.select(key), refresh: () => store.refresh() }}>{children}</CompanionContext.Provider>;
}
export function useCompanion(): CompanionValue {
  const value = useContext(CompanionContext);
  if (!value) throw new Error('助手形象消费者必须位于 CompanionProvider 内');
  return value;
}
