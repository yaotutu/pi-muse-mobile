import { FeedbackNotice } from '../ui/Feedback';
import { Card } from '../ui/Surfaces';
import { ArrowLeft, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useDream } from '../dream/DreamProvider';
import { DREAM_PROMPT_LIMIT, MAIN_DREAM_SPACE, type DreamPending, type DreamTarget } from '../dream/types';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { ActionButton } from '../ui/ActionButton';
import { ChoiceChip } from '../ui/ChoiceChip';
import { FormInput } from '../ui/FormInput';

const targets: DreamTarget[] = ['user', 'soul', 'instructions', 'memory'];
const reasonText = {
  ambiguous: '归属不明确',
  global_from_session: '来自单一会话，但建议写入全局资料',
  no_purpose: '空间尚未设置用途',
} as const;
const statusText = { running: '整理中', completed: '已完成', failed: '失败', partial: '部分完成' } as const;
const { layout: l, radius: r, typography: t } = workspaceTheme;

function targetText(target: DreamTarget, spaceId: string) {
  return { user: 'USER · 全局用户资料', soul: 'SOUL · 全局人设', instructions: `${spaceId} · 空间规则`, memory: 'MEMORY · 全局长期记忆' }[target];
}

function targetShortText(target: DreamTarget) {
  return { user: 'USER', soul: 'SOUL', instructions: '规则', memory: '记忆' }[target];
}

function when(value?: string) {
  if (!value) return '暂无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * Dream 页面只投影连接内 store 的服务端事实。切空间确认、待决项归属选择是临时 UI 意图；
 * 整理执行、草稿、写入回读和 AppState 由 DreamProvider 负责，页面不另建请求或重试循环。
 */
export function DreamPanel({ currentSpaceId, onBack }: { currentSpaceId: string; onBack: () => void }) {
  const { store, snapshot } = useDream();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const initialChosen = useRef(false);
  const [nextSpaceId, setNextSpaceId] = useState<string>();
  const [showDefault, setShowDefault] = useState(false);
  const [chosenTargets, setChosenTargets] = useState<Record<string, DreamTarget>>({});
  const [decision, setDecision] = useState<{ id: string; action: 'apply' | 'dismiss' }>();

  useEffect(() => { store.open(); return () => store.close(); }, [store]);
  useEffect(() => {
    // 首次选择只依据本次成功回读的概览；重开页面时不能从过期缓存切走已有草稿。
    if (initialChosen.current || !snapshot.loaded || snapshot.loading || snapshot.stale || !snapshot.overview) return;
    if (snapshot.spaceDirty) { initialChosen.current = true; return; }
    const known = snapshot.overview.spaces;
    const wanted = known.find((space) => space.spaceId === currentSpaceId)?.spaceId
      ?? known.find((space) => space.spaceId === snapshot.selectedSpaceId)?.spaceId
      ?? known[0]?.spaceId;
    if (wanted && store.selectSpace(wanted)) initialChosen.current = true;
  }, [currentSpaceId, snapshot.loaded, snapshot.loading, snapshot.stale, snapshot.overview, snapshot.selectedSpaceId, snapshot.spaceDirty, store]);

  const canWrite = store.canWrite();
  const canRun = store.canRun();
  const current = snapshot.selectedSpace;
  const requestSpace = (spaceId: string) => {
    if (spaceId === snapshot.selectedSpaceId || snapshot.writing) return;
    Keyboard.dismiss();
    if (snapshot.spaceDirty) { setNextSpaceId(spaceId); return; }
    store.selectSpace(spaceId);
    setDecision(undefined);
  };
  const confirmSpace = () => {
    if (nextSpaceId && store.selectSpace(nextSpaceId)) { setNextSpaceId(undefined); setDecision(undefined); }
  };
  const resolve = (item: DreamPending) => {
    if (!decision || decision.id !== item.id) return;
    Keyboard.dismiss();
    const target = chosenTargets[item.id] ?? item.suggestedTarget;
    void store.resolvePending(item.id, decision.action, decision.action === 'apply' ? target : undefined);
    setDecision(undefined);
  };

  return <View style={styles.root} testID="dream-panel">
    <View style={styles.topRow}>
      <ActionButton label="返回应用设置" text="返回应用" onPress={onBack} icon={ArrowLeft} />
      <ActionButton label="刷新Dream概览" text="刷新" onPress={() => void store.refresh()} disabled={snapshot.loading || !!snapshot.writing} icon={RefreshCw} />
    </View>
    <Text accessibilityRole="header" style={styles.pageTitle}>Dream 记忆整理</Text>
    {snapshot.loading && <ActivityIndicator accessibilityLabel="正在读取Dream概览" color={colors.muted} />}
    {!!snapshot.error && <FeedbackNotice text={snapshot.error} tone="danger" />}
    {!!snapshot.notice && <FeedbackNotice text={snapshot.notice} tone="success" />}
    {snapshot.stale && snapshot.loaded && <Text style={styles.warning}>以下是上次读取的内容，当前状态待刷新核对；暂不能保存、整理或处理建议。请求中断不代表远端 Dream 已停止。</Text>}
    {!snapshot.loaded && !snapshot.loading && <Text style={styles.warning}>Dream 概览尚未读取成功。请刷新后查看真实状态与待决建议。</Text>}

    {!!snapshot.overview && <>
      <Card style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>全局概览</Text>
        <View style={styles.overviewRow}><Text style={styles.overviewLabel}>固定周期</Text><Text style={styles.body}>每 {snapshot.overview.intervalHours} 小时检查</Text></View>
        <Text style={snapshot.writing === 'run' || snapshot.overview.running ? styles.warning : styles.caption}>{snapshot.writing === 'run' ? '正在等待服务端整理结果；离开页面不会停止远端执行。' : snapshot.overview.running ? '上次读取时有 Dream 正在运行，可能属于其他空间。' : '上次读取时没有正在运行的 Dream。'}</Text>
        <Text style={styles.caption}>各空间单独决定是否参加周期整理；关闭后仍可手动整理。</Text>
      </Card>

      <Card style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>全局整理提示词</Text>
        <Text style={styles.caption}>适用于全部空间；留空并保存后使用内置默认提示词。</Text>
        <FormInput accessibilityLabel="编辑全局Dream提示词" multiline textAlignVertical="top" value={snapshot.globalDraft} onChangeText={store.setGlobalPrompt}
          editable={snapshot.loaded && !snapshot.writing} maxLength={DREAM_PROMPT_LIMIT} placeholder="留空则使用内置默认提示词" placeholderTextColor={colors.faint} style={styles.input} />
        <Text style={styles.count}>{snapshot.globalDraft.length} / {DREAM_PROMPT_LIMIT} 字符</Text>
        <View style={styles.formActions}>
          <ActionButton label="保存全局Dream提示词" text={snapshot.writing === 'global' ? '正在保存…' : '保存全局提示词'} tone="primary" wide onPress={() => { Keyboard.dismiss(); void store.saveGlobalPrompt(); }} disabled={!canWrite || !snapshot.globalDirty} />
          <ActionButton label="取消全局Dream提示词修改" text="取消修改" wide onPress={store.discardGlobal} disabled={!canWrite || !snapshot.globalDirty} />
        </View>
        <ActionButton label="清空全局Dream提示词草稿" text="清空草稿" onPress={() => store.setGlobalPrompt('')} disabled={!snapshot.loaded || !!snapshot.writing || !snapshot.globalDraft} />
        <Text style={styles.caption}>清空仅修改草稿；保存失败会保留草稿，请刷新核对后再决定是否保存。</Text>
        <ActionButton label={showDefault ? '收起内置默认Dream提示词' : '展开内置默认Dream提示词'} text={showDefault ? '收起内置默认提示词' : '查看内置默认提示词'} onPress={() => setShowDefault(!showDefault)} icon={showDefault ? ChevronUp : ChevronDown} />
        {showDefault && <Text selectable style={styles.fullText}>{snapshot.overview.defaultPrompt}</Text>}
      </Card>

      <Card style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>选择整理空间</Text>
        <Text style={styles.caption}>仅选择已有空间。切换时若有空间草稿会先确认；全局草稿保留。</Text>
        <View style={styles.spaceChoices}>{snapshot.overview.spaces.map((space) => <ChoiceChip key={space.spaceId}
          label={`选择Dream空间 ${space.spaceId === MAIN_DREAM_SPACE ? '主空间' : space.spaceId}`}
          text={space.spaceId === MAIN_DREAM_SPACE ? '主空间 · local-main' : space.spaceId}
          selected={space.spaceId === snapshot.selectedSpaceId} disabled={!!snapshot.writing}
          onPress={() => requestSpace(space.spaceId)} />)}</View>
        {!!nextSpaceId && <View style={styles.confirmBox}>
          <Text style={styles.warning}>切换到 {nextSpaceId === MAIN_DREAM_SPACE ? '主空间' : nextSpaceId} 会丢弃当前空间未保存的周期与补充提示词草稿。全局草稿不会丢失。</Text>
          <View style={styles.formActions}><ActionButton label="确认放弃当前空间草稿并切换" text="放弃空间草稿并切换" onPress={confirmSpace} disabled={!!snapshot.writing} tone="primary" wide /><ActionButton label="取消切换Dream空间" text="继续编辑" onPress={() => setNextSpaceId(undefined)} wide /></View>
        </View>}
      </Card>

      {current ? <>
        <Card style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>当前空间设置</Text>
          <Text selectable style={styles.spaceName}>{current.spaceId === MAIN_DREAM_SPACE ? '主空间 · local-main' : current.spaceId}</Text>
          <Text style={styles.caption}>{current.spaceId === MAIN_DREAM_SPACE ? '主空间默认开启周期整理。' : '非主空间默认关闭周期整理。'}读取当前值不会自动保存。</Text>
          <Choice label="切换当前空间周期整理" title="参加定期整理" detail="关闭后仍可使用手动立即整理。" selected={snapshot.spaceDraft.enabled} onPress={() => store.setSpaceDraft({ enabled: !snapshot.spaceDraft.enabled })} disabled={!snapshot.loaded || !!snapshot.writing} />
          <Choice label="切换当前空间继承全局提示词" title="继承全局提示词" detail="关闭后使用本空间补充提示词；原草稿会保留。" selected={snapshot.spaceDraft.inheritGlobalPrompt} onPress={() => store.setSpaceDraft({ inheritGlobalPrompt: !snapshot.spaceDraft.inheritGlobalPrompt })} disabled={!snapshot.loaded || !!snapshot.writing} />
          <Text style={styles.fieldLabel}>本空间用途 · 只读</Text>
          <Text selectable style={styles.fullText}>{current.purpose || '尚未设置用途'}</Text>
          <Text style={styles.fieldLabel}>本空间补充提示词</Text>
          <FormInput accessibilityLabel="编辑当前空间Dream补充提示词" multiline textAlignVertical="top" value={snapshot.spaceDraft.prompt} onChangeText={(prompt) => store.setSpaceDraft({ prompt })}
            editable={snapshot.loaded && !snapshot.writing} maxLength={DREAM_PROMPT_LIMIT} placeholder="仅作为当前空间的补充说明" placeholderTextColor={colors.faint} style={styles.input} />
          <Text style={styles.count}>{snapshot.spaceDraft.prompt.length} / {DREAM_PROMPT_LIMIT} 字符</Text>
          <View style={styles.formActions}><ActionButton label="保存当前空间Dream设置" text={snapshot.writing === 'space' ? '正在保存…' : '保存空间设置'} onPress={() => { Keyboard.dismiss(); void store.saveSpaceSettings(); }} disabled={!canWrite || !snapshot.spaceDirty} tone="primary" wide />
            <ActionButton label="取消当前空间Dream设置修改" text="取消修改" onPress={store.discardSpace} disabled={!canWrite || !snapshot.spaceDirty} wide /></View>
        </Card>

        <Card style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>最近整理</Text>
          {current.lastRun ? <>
            <Text style={current.lastRun.status === 'completed' ? styles.success : current.lastRun.status === 'running' ? styles.warning : styles.error}>状态：{statusText[current.lastRun.status]}</Text>
            <Text style={styles.body}>时间：{when(current.lastRun.at)}</Text>
            <Text style={styles.body}>处理消息：{current.lastRun.processed} 条</Text>
            <Text style={styles.body}>实际变更：{current.lastRun.changed.length ? current.lastRun.changed.map((target) => targetText(target, current.spaceId)).join('、') : '无'}</Text>
            {!!current.lastRun.error && <Text selectable style={styles.error}>服务端错误：{current.lastRun.error}</Text>}
          </> : <Text style={styles.caption}>服务端没有返回本空间的整理记录。</Text>}
          <ActionButton label="立即整理当前Dream空间" text={snapshot.writing === 'run' ? '正在等待真实整理结果…' : '立即整理当前空间'} onPress={() => { Keyboard.dismiss(); void store.runNow(); }} disabled={!canRun} tone="primary" />
          {!canRun && (snapshot.globalDirty || snapshot.spaceDirty) && <Text style={styles.warning}>请先分别保存或取消全局、空间的未保存修改，再立即整理。草稿不会用于本次模型执行。</Text>}
          {snapshot.writing === 'run' && <Text style={styles.warning}>请求正在等待真实模型完成。离开页面、退后台或请求超时，都不代表远端整理已停止；回来请先刷新核对，不要直接重跑。</Text>}
          <Text style={styles.caption}>HTTP 200 也可能返回失败或部分完成，以服务端最近整理状态为准；整理不提供停止操作。</Text>
        </Card>

        <Card style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>待决建议 · {snapshot.stale ? '待核对' : current.pending.length}</Text>
          <Text style={styles.caption}>完整正文与建议归属如下。应用前请确认目标；USER 与 SOUL 会影响所有空间，MEMORY 也属于全局长期记忆。</Text>
          {!current.pending.length && <Text style={styles.caption}>{snapshot.stale ? '当前待决建议数量未核对，请刷新。' : '当前空间没有待决建议。'}</Text>}
          {current.pending.map((item) => {
            const chosen = chosenTargets[item.id] ?? item.suggestedTarget;
            const confirming = decision?.id === item.id ? decision.action : undefined;
            return <View key={item.id} style={styles.pending}>
              <Text style={styles.fieldLabel}>建议正文 · 完整内容</Text>
              <Text selectable style={styles.fullText}>{item.text}</Text>
              <Text style={styles.caption}>原因：{reasonText[item.reason]} · 提出时间：{when(item.createdAt)}</Text>
              <Text style={styles.caption}>建议归属：{targetText(item.suggestedTarget, current.spaceId)}</Text>
              <Text style={styles.fieldLabel}>实际应用到</Text>
              <View style={styles.targetChoices}>{targets.map((target) => <ChoiceChip key={target}
                label={`选择建议归属 ${targetText(target, current.spaceId)}`} text={targetShortText(target)}
                selected={chosen === target} disabled={!canWrite}
                onPress={() => { setChosenTargets((previous) => ({ ...previous, [item.id]: target })); setDecision(undefined); }} />)}</View>
              <Text selectable style={styles.targetDescription}>当前目标：{targetText(chosen, current.spaceId)}</Text>
              {(chosen === 'user' || chosen === 'soul' || chosen === 'memory') && <Text style={styles.warning}>此目标为全局内容，应用后影响全部空间。</Text>}
              <View style={styles.actions}><ActionButton label={`准备应用Dream建议 ${item.id}`} text="应用到所选目标" onPress={() => setDecision({ id: item.id, action: 'apply' })} disabled={!canWrite} tone="primary" />
                <ActionButton label={`准备忽略Dream建议 ${item.id}`} text="忽略建议" onPress={() => setDecision({ id: item.id, action: 'dismiss' })} disabled={!canWrite} /></View>
              {!!confirming && <View style={styles.confirmBox}>
                <Text style={styles.body}>{confirming === 'apply' ? `确认把以上完整正文应用到 ${targetText(chosen, current.spaceId)}？` : '确认忽略以上完整建议？'}</Text>
                {confirming === 'apply' && (chosen === 'user' || chosen === 'soul' || chosen === 'memory') && <Text style={styles.warning}>此目标为全局内容，应用后影响全部空间。</Text>}
                <View style={styles.formActions}><ActionButton label={confirming === 'apply' ? `确认应用Dream建议 ${item.id}` : `确认忽略Dream建议 ${item.id}`} text={confirming === 'apply' ? '确认应用' : '确认忽略'} onPress={() => resolve(item)} disabled={!canWrite} tone="primary" wide />
                  <ActionButton label="取消处理Dream建议" text="取消" onPress={() => setDecision(undefined)} wide /></View>
              </View>}
            </View>;
          })}
        </Card>
      </> : <Text style={styles.warning}>当前选择的空间不在服务端概览中。请选择上方已有空间，或刷新核对。</Text>}
    </>}
  </View>;
}

function Choice({ label, title, detail, selected, onPress, disabled }: { label: string; title: string; detail: string; selected: boolean; onPress: () => void; disabled: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.switchRow, disabled && styles.disabled, pressed && styles.pressed]}>
    <View style={styles.flexText}><Text style={styles.body}>{title}</Text><Text style={styles.caption}>{detail}</Text></View>
    <View style={[styles.switchTrack, selected && styles.switchTrackOn]}><View style={[styles.switchThumb, selected && styles.switchThumbOn]} /></View>
  </Pressable>;
}

const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  root: { gap: spacing[16], paddingBottom: spacing[24], minWidth: 0 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing[8] },
  pageTitle: { ...t.section, color: c.ink },
  card: { padding: spacing[16], gap: spacing[12], minWidth: 0, borderRadius: r.card, backgroundColor: c.surface },
  title: { ...t.itemTitle, color: c.ink }, body: { ...t.detail, color: c.ink }, caption: { ...t.caption, color: c.faint },
  overviewRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing[8] }, overviewLabel: { ...t.caption, color: c.muted },
  fieldLabel: { ...t.status, color: c.ink }, spaceName: { ...t.itemTitle, color: c.ink },
  warning: { ...t.detail, color: c.warning }, error: { ...t.detail, color: c.danger }, success: { ...t.detail, color: c.success },
  input: { height: l.profileTextHeight },
  count: { ...t.caption, color: c.faint, alignSelf: 'flex-end' }, fullText: { ...t.detail, color: c.ink, backgroundColor: c.canvas, borderRadius: r.field, padding: spacing[16], minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] }, formActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8], marginTop: spacing[8] },

  spaceChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },
  targetChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },

  targetDescription: { ...t.status, color: c.muted },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[12], minHeight: l.controlSize }, flexText: { flex: 1, minWidth: 0, gap: spacing[2] },
  switchTrack: { width: l.switchWidth, height: l.switchHeight, borderRadius: r.round, justifyContent: 'center', padding: spacing[3], backgroundColor: c.control },
  switchTrackOn: { backgroundColor: c.blue }, switchThumb: { width: l.switchThumb, height: l.switchThumb, borderRadius: r.round, backgroundColor: c.canvas }, switchThumbOn: { alignSelf: 'flex-end' },
  pending: { gap: spacing[10], paddingTop: spacing[16], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  confirmBox: { gap: spacing[12], padding: spacing[14], borderRadius: r.field, backgroundColor: c.warningSoft },
  disabled: { opacity: workspaceTheme.interaction.disabledOpacity }, pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
});
