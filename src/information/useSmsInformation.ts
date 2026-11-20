import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useApi } from '../api/ApiProvider';
import {
  addSmsListener,
  checkSmsPermission,
  getInboxSmsInfo,
  isSmsReceiverAvailable,
  openSmsPermissionSettings,
  readAllInboxSms,
  requestSmsPermission,
  type InboxSmsMessage,
} from '../../modules/sms-receiver';
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
  const [inboxTotalCount, setInboxTotalCount] = useState<number | null>(null);
  const [permissionError, setPermissionError] = useState<string>();
  const autoImportedRef = useRef(false);
  const checkPermission = useCallback(async () => {
    if (!isSmsReceiverAvailable()) {
      setHasSmsPermission(false);
      setInboxTotalCount(null);
      return false;
    }
    const granted = await checkSmsPermission();
    setHasSmsPermission(granted);
    if (!granted) {
      setInboxTotalCount(null);
      return false;
    }
    setPermissionError(undefined);
    const info = await getInboxSmsInfo();
    setInboxTotalCount(info.permissionGranted ? info.totalCount : null);
    return granted;
  }, []);
  const requestPermission = useCallback(async () => {
    const granted = isSmsReceiverAvailable() && await requestSmsPermission();
    setHasSmsPermission(granted);
    if (granted) {
      setPermissionError(undefined);
      const info = await getInboxSmsInfo();
      setInboxTotalCount(info.permissionGranted ? info.totalCount : null);
    } else {
      setInboxTotalCount(null);
      setPermissionError('未授予短信读取权限，无法自动监听或读取历史短信；请前往系统设置开启“短信”权限（部分机型还需允许“通知类短信”）。');
    }
    return granted;
  }, []);
  const importAllInboxSms = useCallback(async () => {
    setPermissionError(undefined);
    if (!isSmsReceiverAvailable()) {
      return store.ingestBatch(buildFallbackHistoryBatch(), { background: true, forceInitial: true });
    }
    const granted = (await checkPermission()) || (await requestPermission());
    if (!granted) return;
    const info = await getInboxSmsInfo();
    setInboxTotalCount(info.totalCount);
    if (info.totalCount === 0) {
      setPermissionError('当前从本机收件箱读取到 0 条短信。若手机内确有历史短信，请前往系统设置确认开启“读取短信”，部分国产系统还需单独开启“通知类短信”权限。');
      return;
    }
    store.setImportProgress({ phase: 'reading', current: 0, total: info.totalCount });
    let inbox: InboxSmsMessage[];
    try {
      inbox = await readAllInboxSms((loaded, total) => {
        store.setImportProgress({ phase: 'reading', current: loaded, total: total || info.totalCount });
      }, 200);
    } catch (error) {
      store.setImportProgress(undefined);
      setPermissionError(`读取本机短信失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const mapped = inbox
      .filter((item) => item.body.trim())
      .map((item) => ({
        content: item.body,
        title: item.sender ? `来自: ${item.sender}` : undefined,
        externalId: `sms-inbox-${item.id}-${item.timestamp}`,
        receivedAt: Number.isFinite(item.timestamp) && item.timestamp > 0
          ? new Date(item.timestamp).toISOString()
          : undefined,
      }));
    if (mapped.length === 0) {
      store.setImportProgress(undefined);
      setPermissionError('已访问本机收件箱，但未读取到包含有效正文的短信，请核对系统短信与“通知类短信”权限。');
      return;
    }
    return store.ingestBatch(mapped, { background: true, forceInitial: true });
  }, [checkPermission, requestPermission, store]);
  const importSampleHistory = useCallback(async () => {
    setPermissionError(undefined);
    return store.ingestBatch(buildFallbackHistoryBatch(), { background: true, forceInitial: true });
  }, [store]);
  useEffect(() => {
    let mounted = true;
    store.setForeground(AppState.currentState === 'active');
    void (async () => {
      if (!isSmsReceiverAvailable()) {
        if (mounted) {
          setHasSmsPermission(false);
          setInboxTotalCount(null);
        }
        return;
      }
      const granted = await checkSmsPermission();
      if (!mounted) return;
      setHasSmsPermission(granted);
      if (granted) {
        const info = await getInboxSmsInfo();
        if (mounted) setInboxTotalCount(info.permissionGranted ? info.totalCount : null);
      }
    })();
    const sub = AppState.addEventListener('change', (next) => {
      store.setForeground(next === 'active');
      if (next === 'active') void checkPermission();
    });
    return () => { mounted = false; sub.remove(); store.dispose(); };
  }, [store, checkPermission]);
  useEffect(() => {
    const serverTotal = state.status?.counts.total ?? state.items.length;
    if (
      !autoImportedRef.current &&
      state.settings?.enabled &&
      !state.loading &&
      !state.ingesting &&
      serverTotal === 0 &&
      isSmsReceiverAvailable() &&
      hasSmsPermission === true &&
      (inboxTotalCount ?? 0) > 0
    ) {
      autoImportedRef.current = true;
      void importAllInboxSms();
    }
  }, [
    state.settings?.enabled,
    state.loading,
    state.ingesting,
    state.status?.counts.total,
    state.items.length,
    hasSmsPermission,
    inboxTotalCount,
    importAllInboxSms,
  ]);
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
    ingestSms: store.ingestSms, ingestBatch: store.ingestBatch,
    importInboxSms: importAllInboxSms, importAllInboxSms, importSampleHistory,
    triggerRun: store.triggerRun, retryFailed: store.retryFailed, reload: store.reload, setVisible: store.setVisible,
    isSmsAvailable: isSmsReceiverAvailable(), hasSmsPermission, inboxTotalCount,
    checkPermission, requestPermission, openPermissionSettings: openSmsPermissionSettings,
  };
}
