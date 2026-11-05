import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useApi } from '../api/ApiProvider';
import { addSmsListener, checkSmsPermission, isSmsReceiverAvailable, requestSmsPermission } from '../../modules/sms-receiver';
import { SmsStore } from './sms-store';

/** 原生权限与监听留在连接层；页面只开关只读刷新，不改变数据归属或监听生命周期。 */
export function useSmsInformation() {
  const api = useApi(); const store = useMemo(() => new SmsStore(api), [api]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [hasSmsPermission, setHasSmsPermission] = useState<boolean | null>(null);
  const [permissionError, setPermissionError] = useState<string>();
  const checkPermission = useCallback(async () => {
    const granted = await (isSmsReceiverAvailable() ? checkSmsPermission() : Promise.resolve(false));
    setHasSmsPermission(granted); return granted;
  }, []);
  const requestPermission = useCallback(async () => {
    const granted = isSmsReceiverAvailable() && await requestSmsPermission();
    setHasSmsPermission(granted); setPermissionError(granted ? undefined : '未授予短信权限，无法自动监听新短信'); return granted;
  }, []);
  useEffect(() => {
    let mounted = true;
    store.setForeground(AppState.currentState === 'active');
    void (isSmsReceiverAvailable() ? checkSmsPermission() : Promise.resolve(false)).then((granted) => {
      if (mounted) setHasSmsPermission(granted);
    });
    const sub = AppState.addEventListener('change', (next) => {
      store.setForeground(next === 'active');
      if (next === 'active') void checkPermission();
    });
    return () => { mounted = false; sub.remove(); store.dispose(); };
  }, [store, checkPermission]);
  useEffect(() => {
    if (!state.settings?.enabled || !isSmsReceiverAvailable() || hasSmsPermission !== true) return;
    const sub = addSmsListener((event) => {
      if (!event.body?.trim()) return;
      void store.ingestSms(event.body, `来自: ${event.sender}`, `sms-${event.timestamp}-${event.sender}`, new Date(event.timestamp).toISOString());
    });
    return () => sub.remove();
  }, [store, state.settings?.enabled, hasSmsPermission]);
  return { ...state, error: state.error ?? permissionError,
    setDraftNotes: store.setDraftNotes, toggleEnabled: store.toggleEnabled, saveNotes: store.saveNotes,
    ingestSms: store.ingestSms, ingestBatch: store.ingestBatch, triggerRun: store.triggerRun, reload: store.reload, setVisible: store.setVisible,
    isSmsAvailable: isSmsReceiverAvailable(), hasSmsPermission, checkPermission, requestPermission,
  };
}
