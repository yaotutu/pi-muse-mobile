import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../api/ApiProvider';
import { isRequestCancelled } from '../api/errors';
import type {
  InformationItem,
  InformationPreferences,
  InformationSettings,
} from './types';

export function useInformation(spaceId: string) {
  const api = useApi();
  const [settings, setSettings] = useState<InformationSettings | null>(null);
  const [preferences, setPreferences] = useState<InformationPreferences | null>(null);
  const [draftNotes, setDraftNotes] = useState('');
  const [items, setItems] = useState<InformationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    abortRef.current = controller;

    void Promise.all([
      api.getInformationSettings(spaceId, controller.signal),
      api.getInformationPreferences(spaceId, controller.signal),
      api.listInformationItems(spaceId, { limit: 10 }, controller.signal).catch(() => ({ items: [] })),
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
    };
  }, [api, spaceId]);

  const reload = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    try {
      const [s, p, it] = await Promise.all([
        api.getInformationSettings(spaceId, controller.signal),
        api.getInformationPreferences(spaceId, controller.signal),
        api.listInformationItems(spaceId, { limit: 10 }, controller.signal).catch(() => ({ items: [] })),
      ]);
      if (controller.signal.aborted) return;
      setSettings(s);
      setPreferences(p);
      setDraftNotes(p.notes);
      setItems(it.items);
      setError(undefined);
    } catch (e) {
      if (!controller.signal.aborted && !isRequestCancelled(e)) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [api, spaceId]);

  const toggleEnabled = useCallback(async (enabled: boolean) => {
    if (!settings || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const updated = await api.saveInformationSettings(spaceId, {
        enabled,
        batchWindowSeconds: settings.batchWindowSeconds,
      });
      setSettings(updated);
      setNotice(enabled ? '已开启信息后台与短信处理' : '已关闭信息后台');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [api, spaceId, settings, saving]);

  const saveNotes = useCallback(async (notesToSave?: string) => {
    if (saving) return;
    const value = notesToSave ?? draftNotes;
    setSaving(true);
    setError(undefined);
    try {
      const updated = await api.saveInformationPreferences(spaceId, { notes: value });
      setPreferences(updated);
      setDraftNotes(updated.notes);
      setNotice('已保存信息处理偏好');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [api, spaceId, draftNotes, saving]);

  const ingestSms = useCallback(async (content: string, title?: string, externalId?: string) => {
    if (ingesting || !content.trim()) return;
    setIngesting(true);
    setError(undefined);
    try {
      const extId = externalId ?? `sms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await api.ingestInformationItems(spaceId, [{
        source: 'sms',
        externalId: extId,
        content: content.trim(),
        title: title?.trim() || undefined,
        receivedAt: new Date().toISOString(),
      }]);
      setItems((prev) => [...result, ...prev]);
      setNotice(`已上报 ${result.length} 条信息到待处理队列`);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIngesting(false);
    }
  }, [api, spaceId, ingesting]);

  const triggerRun = useCallback(async () => {
    if (triggering) return;
    setTriggering(true);
    setError(undefined);
    try {
      await api.triggerInformationRun(spaceId);
      setNotice('已触发信息后台分析');
      const it = await api.listInformationItems(spaceId, { limit: 10 }).catch(() => ({ items: [] }));
      setItems(it.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTriggering(false);
    }
  }, [api, spaceId, triggering]);

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
    toggleEnabled,
    saveNotes,
    ingestSms,
    triggerRun,
    reload,
  };
}
