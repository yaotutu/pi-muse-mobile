import { Card } from '../ui/Surfaces';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Globe } from 'lucide-react-native';
import { useMonitors } from '../monitors/MonitorProvider';
import {
  availableMonitorActions,
  monitorActionLabel,
  monitorConditionLabel,
  monitorStatusLabel,
  monitorStatusTone,
} from '../monitors/monitor-store';
import type { MonitorsQuery } from '../api/types';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { EmptyState, StatusPill } from './primitives';
import { ActionButton } from '../ui/ActionButton';
import { ChoiceChip } from '../ui/ChoiceChip';
import { FeedbackNotice } from '../ui/Feedback';

function useStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

function formatDate(iso?: string): string {
  if (!iso) return '尚未检查';
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

export function MonitorsPanel({ spaceId }: { spaceId: string }) {
  const { store, snapshot: state } = useMonitors();
  const styles = useStyles();
  const { colors } = useTheme();
  const [stopTarget, setStopTarget] = useState<{ id: string; title: string }>();

  useEffect(() => {
    store.open();
    return () => store.close();
  }, [store]);

  useEffect(() => {
    if (
      state.query.spaceId &&
      state.query.spaceId !== spaceId &&
      !state.uncertain &&
      !state.writing
    ) {
      store.setQuery({ ...state.query, spaceId });
    }
  }, [spaceId, store, state.query, state.uncertain, state.writing]);

  const disabled = !store.canWrite();
  const listDisabled = disabled || !!stopTarget || !!state.deleteTarget;
  const locked = state.writing || state.uncertain;
  const query = (patch: Partial<MonitorsQuery>) => {
    setStopTarget(undefined);
    store.setQuery({ ...state.query, ...patch });
  };

  return (
    <View style={styles.root} testID="monitors-panel">
      <View style={styles.toolbar}>
        <Text style={styles.caption}>{state.loaded ? `${state.monitors.length} 项监控` : '网页监控列表'}</Text>
        <ActionButton
          label="刷新"
          accessibilityLabel="刷新网页监控"
          disabled={state.loading || state.writing}
          onPress={() => { setStopTarget(undefined); void store.refresh(); }}
        />
      </View>
      <Text style={styles.caption}>在聊天中创建：提供网页链接、触发条件和检查间隔。</Text>

      {state.loading && (
        <ActivityIndicator color={colors.muted} accessibilityLabel="正在读取网页监控" />
      )}
      {state.stale && state.loaded && <FeedbackNotice text="显示上次读取的监控；刷新成功前不能操作。" tone="warning" />}
      <FeedbackNotice text={state.error} tone="danger" />
      <FeedbackNotice text={state.notice} tone="success" />

      {state.uncertain && (
        <Card style={[styles.card, styles.warning]} tone="warning">
          <Text style={styles.title}>提交结果待核对</Text>
          <Text style={styles.body}>操作可能已经生效。请刷新完整列表，核对目标监控的状态或是否仍存在，然后手动解除锁定；不会自动重试。</Text>
          <ActionButton
            label="已核对监控结果，解除锁定"
            disabled={!state.reviewed || state.loading || state.stale}
            onPress={store.acknowledgeReviewed}
          />
        </Card>
      )}

      {/* 筛选与排序由服务端执行；空结果必须按当前空间条件解释。 */}
      <View style={styles.filterRow}>
        <Text style={styles.groupLabel}>范围</Text>
        <ChoiceChip
          label="全部空间"
          accessibilityLabel="全部空间监控"
          selected={!state.query.spaceId}
          disabled={locked}
          onPress={() => query({ spaceId: undefined })}
        />
        <ChoiceChip
          label="当前空间"
          accessibilityLabel="当前空间监控"
          selected={state.query.spaceId === spaceId}
          disabled={locked}
          onPress={() => query({ spaceId })}
        />
      </View>

      <View style={styles.sortRow}>
        <Text style={styles.groupLabel}>排序</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator style={styles.sortScroll} contentContainerStyle={styles.sortOptions} accessibilityLabel="网页监控排序">
          {(
            [
              ['createdAt', '创建时间'],
              ['lastCheckedAt', '最近检查'],
              ['status', '状态'],
            ] as const
          ).map(([sort, label]) => (
            <ChoiceChip
              key={sort}
              label={label}
              accessibilityLabel={`按${label}排序`}
              selected={state.query.sort === sort}
              disabled={locked}
              onPress={() => query({ sort })}
            />
          ))}
        </ScrollView>
        <ActionButton
          label={state.query.order === 'asc' ? '升序' : '降序'}
          accessibilityLabel={`排序方向：${state.query.order === 'asc' ? '升序' : '降序'}`}
          disabled={locked}
          onPress={() => query({ order: state.query.order === 'asc' ? 'desc' : 'asc' })}
        />
      </View>

      {/* 空态 */}
      {state.loaded && !state.loading && !state.stale && !state.error && !state.monitors.length && (
        <EmptyState compact
          icon={Globe}
          title={state.query.spaceId ? '当前空间没有网页监控' : '还没有网页监控'}
          description={state.query.spaceId ? '可以切换到全部空间查看其他监控。' : '可以在聊天中创建第一项网页监控。'}
        />
      )}

      {/* 停止为不可恢复的终态，只在用户确认具体监控后发请求。 */}
      {stopTarget && (
        <Card style={styles.confirmCard} tone="danger" accessibilityViewIsModal>
          <Text style={styles.title}>停止“{stopTarget.title}”？</Text>
          <Text style={styles.body}>停止后不能恢复，此网页将不再检查。需要继续监控时须在聊天中重新创建。</Text>
          <View style={styles.row}>
            <ActionButton label="确认停止" tone="danger" accessibilityLabel={`确认停止 ${stopTarget.title}`} disabled={disabled} onPress={() => { const id = stopTarget.id; setStopTarget(undefined); void store.control(id, 'stop'); }} />
            <ActionButton label="保留监控" accessibilityLabel={`取消停止 ${stopTarget.title}`} onPress={() => setStopTarget(undefined)} />
          </View>
        </Card>
      )}

      {/* 删除确认对话框 */}
      {state.deleteTarget && (
        <Card style={styles.confirmCard} tone="danger" accessibilityViewIsModal>
          <Text style={styles.title}>删除“{state.deleteTarget.title}”？</Text>
          <Text style={styles.body}>将永久删除此监控，停止后续检查与通知。</Text>
          <Text selectable style={styles.caption}>
            监控 ID：{state.deleteTarget.id}
          </Text>
          <View style={styles.row}>
            <ActionButton
              label="确认删除"
              tone="danger"
              accessibilityLabel={`确认删除 ${state.deleteTarget.title}`}
              disabled={disabled}
              onPress={() => void store.confirmDelete()}
            />
            <ActionButton
              label="取消删除"
              accessibilityLabel={`取消删除 ${state.deleteTarget.title}`}
              disabled={state.writing}
              onPress={store.cancelDelete}
            />
          </View>
        </Card>
      )}

      {/* 监控项列表 */}
      {state.monitors.map((item) => {
        const actions = availableMonitorActions(item);
        return (
          <Card key={item.id} testID={`monitor-item-${item.id}`} style={styles.card}>
            <View style={styles.titleRow}>
              <Text selectable style={[styles.title, styles.titleFlex]}>{item.title}</Text>
              <StatusPill
                label={monitorStatusLabel(item.status)}
                tone={monitorStatusTone(item.status)}
              />
            </View>
            <Text selectable style={styles.url}>
              {item.url}
            </Text>

            <View style={styles.details}>
              <Text style={styles.body}>每 {item.intervalMinutes} 分钟 · 条件：{monitorConditionLabel(item.condition, item.value)}</Text>
              <Text style={styles.caption}>累计检查 {item.checks} 次 · 最近检查 {formatDate(item.lastCheckedAt)}</Text>
              <Text style={styles.caption}>最近通知：{item.lastNotifiedAt ? formatDate(item.lastNotifiedAt) : '尚无'}</Text>
              <Text selectable style={styles.caption}>来源空间：{item.originSpaceId ?? '服务端未记录'}</Text>
            </View>

            {item.error ? (
              <Text selectable accessibilityRole="alert" style={styles.error}>
                抓取错误：{item.error}
              </Text>
            ) : null}

            {item.status === 'stopped' && (
              <Text style={styles.caption}>
                已停止为终态，不可恢复。如需继续监控请重新在聊天中创建。
              </Text>
            )}

            <View style={styles.row}>
              {actions.map((act) => (
                <ActionButton
                  key={act}
                  label={monitorActionLabel(act)}
                  accessibilityLabel={`${monitorActionLabel(act)} ${item.title}`}
                  disabled={listDisabled}
                  onPress={() => act === 'stop' ? setStopTarget({ id: item.id, title: item.title }) : void store.control(item.id, act)}
                />
              ))}
              <ActionButton
                label="删除"
                accessibilityLabel={`删除 ${item.title}`}
                disabled={listDisabled}
                onPress={() => { setStopTarget(undefined); store.requestDelete(item.id); }}
              />
            </View>
          </Card>
        );
      })}
    </View>
  );
}

const createStyles = (colors: WorkspaceColors) =>
  StyleSheet.create({
    root: { gap: spacing[12], paddingBottom: spacing[24] },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[8] },
    toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[8] },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[8] },
    sortRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[8] },
    sortScroll: { flex: 1, minWidth: 0 }, sortOptions: { gap: spacing[8], paddingRight: spacing[8] },
    titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[8] }, titleFlex: { flex: 1, minWidth: 0 },
    title: { ...workspaceTheme.typography.itemTitle, color: colors.ink },
    body: { ...workspaceTheme.typography.detail, color: colors.muted },
    caption: { ...workspaceTheme.typography.caption, color: colors.faint },
    groupLabel: { ...workspaceTheme.typography.caption, color: colors.muted },
    url: { ...workspaceTheme.typography.detail, color: colors.accentText, flexShrink: 1 },
    details: { gap: spacing[4] },
    error: { ...workspaceTheme.typography.detail, color: colors.danger },

    warning: { padding: spacing[12], borderRadius: workspaceTheme.radius.field, backgroundColor: colors.warningSoft },

    confirmCard: { padding: spacing[20], borderRadius: workspaceTheme.radius.card, backgroundColor: colors.dangerSoft, gap: spacing[12] },
    card: {
      padding: spacing[16],
      borderRadius: workspaceTheme.radius.card,
      backgroundColor: colors.surface,
      gap: spacing[8],
    },

  });
