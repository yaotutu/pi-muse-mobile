import { createContext, useContext, type ReactNode } from 'react';
import type { DemoApiClient } from './DemoApiClient';

type DemoControls = { client: DemoApiClient; reset: (empty?: boolean) => void; exit: () => void; preview?: () => void };
const DemoContext = createContext<DemoControls | null>(null);

export function DemoProvider({ value, children }: { value: DemoControls; children: ReactNode }) {
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}
export function useDemo() { return useContext(DemoContext); }
