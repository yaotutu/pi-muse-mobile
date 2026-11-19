import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useApi } from '../api/ApiProvider';
import { addSmsListener, checkSmsPermission, isSmsReceiverAvailable, readInboxSms, requestSmsPermission } from '../../modules/sms-receiver';
import { SmsStore } from './sms-store';

const buildFallbackHistoryBatch = () => {
  const now = Date.now();
  return [
    {
      content: '【中信银行】您尾号 6618 信用卡验证码 482910，5 分钟内有效，请勿泄露。',
      title: '中信银行',
      receivedAt: new Date(now - 14 * 24 * 3600 * 1000).toISOString(),
    },
    {
      content: '【顺丰速运】您的包裹已送达菜鸟驿站，取件码 3-4-2018，请凭码及时取件。',
      title: '顺丰速运',
      receivedAt: new Date(now - 2 * 3600 * 1000).toISOString(),
    },
    {
      content: '【招商银行】您的信用卡账户本期账单金额为人民币 3,280.00 元，最后还款日为 11 月 28 日。',
      title: '招商银行',
      receivedAt: new Date(now - 24 * 3600 * 1000).toISOString(),
    },
    {
      content: '【中国国航】您预订的 CA1831 航班将于明日 08:30 起飞，请提前两小时到达首都机场 T3 航站楼办理登机。',
      title: '中国国航',
      receivedAt: new Date(now - 3 * 3600 * 1000).toISOString(),
    },
    {
      content: '【特惠通知】年中大促火热开启，全场五折包邮，回复TD退订。',
      title: '特惠通知',
      receivedAt: new Date(now - 7 * 24 * 3600 * 1000).toISOString(),
    },
  ];
};

/** 原生权限与监听留在连接层；页面只开关只读刷新，不改变数据归属或监听生命周期。 */
export function useSmsInformation() {
  const api = useApi(); const store = useMemo(() => new SmsStore(api), [api]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [hasSmsPermission, setHasSmsPermission] = useState<boolean | null>(null);
  const [permissionError, setPermissionError] = useState<string>();
  const autoImportedRef = useRef(false);
  const checkPermission = useCallback(async () => {
    const granted = await (isSmsReceiverAvailable() ? checkSmsPermission() : Promise.resolve(false));
    setHasSmsPermission(granted); return granted;
  }, []);
  const requestPermission = useCallback(async () => {
    const granted = isSmsReceiverAvailable() && await requestSmsPermission();
    setHasSmsPermission(granted); setPermissionError(granted ? undefined : '未授予短信权限，无法自动监听或读取历史短信'); return granted;
  }, []);
  const importInboxSms = useCallback(async (fallbackToSample = true) => {
    if (isSmsReceiverAvailable()) {
      const granted = (await checkPermission()) || (await requestPermission());
      if (granted) {
        const inbox = await readInboxSms(500);
        const mapped = inbox
          .filter((item) => item.body.trim())
          .map((item) => ({
            content: item.body,
            title: item.sender ? `来自: ${item.sender}` : undefined,
            externalId: `sms-inbox-${item.id}-${item.timestamp}`,
            receivedAt: new Date(item.timestamp).toISOString(),
          }));
        if (mapped.length > 0) {
          return store.ingestBatch(mapped);
        }
      }
      if (!fallbackToSample) return;
    }
    if (fallbackToSample) {
      return store.ingestBatch(buildFallbackHistoryBatch());
    }
  }, [checkPermission, requestPermission, store]);
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
    if (
      !autoImportedRef.current &&
      state.settings?.enabled &&
      !state.loading &&
      state.items.length === 0 &&
      isSmsReceiverAvailable() &&
      hasSmsPermission === true
    ) {
      autoImportedRef.current = true;
      void importInboxSms(false);
    }
  }, [state.settings?.enabled, state.loading, state.items.length, hasSmsPermission, importInboxSms]);
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
    ingestSms: store.ingestSms, ingestBatch: store.ingestBatch, importInboxSms, triggerRun: store.triggerRun, reload: store.reload, setVisible: store.setVisible,
    isSmsAvailable: isSmsReceiverAvailable(), hasSmsPermission, checkPermission, requestPermission,
  };
}
