import { createContext, useContext, type ReactNode } from 'react';
import { useSmsInformation } from './useSmsInformation';
const SmsContext = createContext<ReturnType<typeof useSmsInformation> | null>(null);
export function SmsProvider({ children }: { children: ReactNode }) {
  const state = useSmsInformation();
  return <SmsContext.Provider value={state}>{children}</SmsContext.Provider>;
}
export function useSmsInformationState() {
  const state = useContext(SmsContext);
  if (!state) throw new Error('SmsProvider is required');
  return state;
}
