import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../api/ApiProvider';
import { isRequestCancelled } from '../api/errors';
import {
  addSmsListener,
  checkSmsPermission,
  isSmsReceiverAvailable,
  requestSmsPermission,
} from '../../modules/sms-receiver';
import type {
  InformationItem,
  InformationPreferences,
  InformationSettings,
} from './types';

/** 每个连接只挂载一次；切空间与切页面不改变短信来源或中断监听。 */
export function useSmsInformation() {
  const api = useApi();
  const [settings, setSettings] = useState<InformationSettings | null>(null);
  const [preferences, setPreferences] = useState<InformationPreferences | null>(null);
  const [draftNotes, setDraftNotes] = useState('');
  const [items, setItems] = useState<InformationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [hasSmsPermission, setHasSmsPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [needsReadback, setNeedsReadback] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const checkPermission = useCallback(async () => {
    if (!isSmsReceiverAvailable()) {
      setHasSmsPermission(false);
      return false;
    }
    const granted = await checkSmsPermission();
    setHasSmsPermission(granted);
    return granted;
  }, []);

  const requestPermission = useCallback(async () => {
    if (!isSmsReceiverAvailable()) {
      setHasSmsPermission(false);
      return false;
    }
    const granted = await requestSmsPermission();
    setHasSmsPermission(granted);
    if (granted) {
      setNotice('已授予短信接收权限，自动监听已就绪');
      setError(undefined);
    } else {
      setError('未授予短信权限，无法自动监听新短信');
    }
    return granted;
  }, []);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    abortRef.current = controller;

    void Promise.all([
      api.getSmsSettings(controller.signal),
      api.getSmsPreferences(controller.signal),
      api.listSmsItems({ limit: 10 }, controller.signal),
    ])
      .then(([s, p, it]) => {
        if (!mounted || controller.signal.aborted) return;
        setSettings(s);
        setPreferences(p);
        setDraftNotes(p.notes);
        setItems(it.items);
        setError(undefined);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!mounted || controller.signal.aborted) return;
        if (!isRequestCancelled(e)) {
          setError(e instanceof Error ? e.message : String(e));
        }
        setLoading(false);
      });

    return () => {
      mounted = false;
      controller.abort();
      abortRef.current?.abort();
    };
  }, [api]);

  useEffect(() => {
    if (!isSmsReceiverAvailable()) {
      return;
    }
    let active = true;
    void checkSmsPermission().then((granted) => {
      if (active) {
        setHasSmsPermission(granted);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    try {
      const [s, p, it] = await Promise.all([
        api.getSmsSettings(controller.signal),
        api.getSmsPreferences(controller.signal),
        api.listSmsItems({ limit: 10 }, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setSettings(s);
      setPreferences(p);
      setDraftNotes(p.notes);
      setItems(it.items);
      setError(undefined);
      setNeedsReadback(false);
    } catch (e) {
      if (!controller.signal.aborted && !isRequestCancelled(e)) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [api]);

  const toggleEnabled = useCallback(async (enabled: boolean) => {
    if (!settings || saving || needsReadback) return;
    setSaving(true);
    setError(undefined);
    try {
      const updated = await api.saveSmsSettings({
        enabled,
        batchWindowSeconds: settings.batchWindowSeconds,
      });
      setSettings(updated);
      setNotice(enabled ? '已开启独立短信处理' : '已关闭短信处理');
    } catch (e) {
      setNeedsReadback(true);
      setError(`${e instanceof Error ? e.message : String(e)}。请刷新核对，不会自动重发。`);
    } finally {
      setSaving(false);
    }
  }, [api, settings, saving, needsReadback]);

  const saveNotes = useCallback(async (notesToSave?: string) => {
    if (saving || needsReadback) return;
    const value = notesToSave ?? draftNotes;
    setSaving(true);
    setError(undefined);
    try {
      const updated = await api.saveSmsPreferences({ notes: value });
      setPreferences(updated);
      setDraftNotes(updated.notes);
      setNotice('已保存短信功能偏好');
    } catch (e) {
      setNeedsReadback(true);
      setError(`${e instanceof Error ? e.message : String(e)}。请刷新核对，不会自动重发。`);
    } finally {
      setSaving(false);
    }
  }, [api, draftNotes, saving, needsReadback]);

  const ingestSms = useCallback(async (content: string, title?: string, externalId?: string, receivedAt?: string) => {
    if (!content.trim() || (!externalId && needsReadback)) return;
    setIngesting(true);
    setError(undefined);
    try {
      const extId = externalId ?? `sms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await api.ingestSmsItems([{
        source: 'sms',
        externalId: extId,
        content,
        title: title?.trim() || undefined,
        receivedAt: receivedAt ?? new Date().toISOString(),
      }]);
      setItems((prev) => [...result, ...prev]);
      setNotice(`已上报 ${result.length} 条信息到待处理队列`);
      return result;
    } catch (e) {
      setNeedsReadback(true);
      setError(`${e instanceof Error ? e.message : String(e)}。请刷新核对最近条目，不会自动重发。`);
    } finally {
      setIngesting(false);
    }
  }, [api, needsReadback]);

  const triggerRun = useCallback(async () => {
    if (triggering || needsReadback) return;
    setTriggering(true);
    setError(undefined);
    try {
      await api.triggerSmsRun();
      setNotice('已触发信息后台分析');
      const it = await api.listSmsItems({ limit: 10 });
      setItems(it.items);
    } catch (e) {
      setNeedsReadback(true);
      setError(`${e instanceof Error ? e.message : String(e)}。请刷新核对条目状态，不会自动重跑。`);
    } finally {
      setTriggering(false);
    }
  }, [api, triggering, needsReadback]);

  useEffect(() => {
    if (!settings?.enabled || !isSmsReceiverAvailable() || hasSmsPermission !== true) {
      return;
    }
    const sub = addSmsListener((event) => {
      if (!event.body?.trim()) return;
      const externalId = `sms-${event.timestamp}-${event.sender}`;
      void ingestSms(event.body, `来自: ${event.sender}`, externalId, new Date(event.timestamp).toISOString());
    });
    return () => {
      sub.remove();
    };
  }, [settings?.enabled, hasSmsPermission, ingestSms]);

  return {
    settings,
    preferences,
    draftNotes,
    setDraftNotes,
    items,
    loading,
    saving,
    ingesting,
    triggering,
    error,
    notice,
    needsReadback,
    toggleEnabled,
    saveNotes,
    ingestSms,
    triggerRun,
    isSmsAvailable: isSmsReceiverAvailable(),
    hasSmsPermission,
    checkPermission,
    requestPermission,
    reload,
  };
}
