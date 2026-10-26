import { Card } from '../ui/Surfaces';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image as RNImage, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, Download, File, Folder, Plus } from 'lucide-react-native';
import { MAX_WORKSPACE_TEXT_BYTES, utf8ByteLength } from '../files/contracts';
import { useFiles } from '../files/FilesProvider';
import { saveWorkspaceFileToDevice, type NativeDownloadResult } from '../files/native-download';
import type { WorkspaceFileDetail } from '../files/types';
import { useTheme } from '../theme/ThemeProvider';
import { sizing, spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { ActionButton } from '../ui/ActionButton';
import { ChoiceChip } from '../ui/ChoiceChip';
import { FormInput } from '../ui/FormInput';

const { layout: l, radius: r, typography: t } = workspaceTheme;
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function downloadMessage(result: NativeDownloadResult, originalName: string): string {
  if (result.status === 'cancelled') return '已取消选择目录，文件未保存。';
  if (result.status === 'unsupported' || result.status === 'error') return result.message;
  const renamed = result.fileName !== originalName ? `；原文件名含设备不支持的字符，已改为 ${result.fileName}` : '';
  return result.status === 'saved'
    ? `已保存到所选设备目录：${result.fileName}${renamed}`
    : `所选设备目录已有同名文件 ${result.fileName}，未覆盖${renamed}。`;
}

/**
 * 文件面板只消费连接内 FilesStore：关闭 Tab 只停止可见读取，不丢草稿。
 * 文件原文一律用原生 Text 展示；图片只接收服务端确认的四类本地 data URI，不执行 HTML/SVG。
 */
export function FilesPanel({ currentSpaceId }: { currentSpaceId: string }) {
  const { store, snapshot } = useFiles();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [download, setDownload] = useState<{ key: string; message: string }>();
  const [downloading, setDownloading] = useState<string>();

  useEffect(() => { store.open(); return () => store.close(); }, [store]);

  const locked = snapshot.writing !== false || snapshot.uncertain || !!snapshot.editor || !!snapshot.savePreview || !!snapshot.deleteTarget;
  // Provider 负责草稿解除后的空间同步；这里只展示 store 实际归属，阻止错位期的新操作。
  const scopeLabel = snapshot.scope === 'shared' ? '共享文件 · 全部空间' : `私有文件 · ${snapshot.selectedSpaceId ?? '未选择空间'}`;
  const wrongSpace = snapshot.scope === 'space' && snapshot.selectedSpaceId !== currentSpaceId;
  const canNavigate = !locked && !wrongSpace;
  // 切到另一空间后，旧草稿仍归旧范围；允许用户在明确显示归属的预览中完成原操作。
  // 无草稿的短暂错位期则禁止创建新操作，等待 selectSpace 同步。
  const canWrite = store.canWrite() && (!wrongSpace || locked);
  const detail = !snapshot.detailStale && snapshot.detail?.path === snapshot.selectedPath ? snapshot.detail : undefined;
  // 设备目录选择器会使应用退后台；详情可暂时 stale，回到前台也会换成新读取对象。
  // 下载反馈只按用户当前选择的范围与路径归属，不借详情对象或当前服务端版本判断。
  const selectedKey = snapshot.selectedPath
    ? `${snapshot.scope}:${snapshot.selectedSpaceId ?? ''}:${snapshot.selectedPath}` : undefined;
  const detailKey = detail ? selectedKey : undefined;
  const shownDownload = download && download.key === selectedKey ? download.message : undefined;
  const busyDownload = !!detailKey && downloading === detailKey;
  const verification = snapshot.verificationDetail;
  const verificationKey = snapshot.uncertainOperation
    ? `verification:${snapshot.uncertainOperation.scope}:${snapshot.uncertainOperation.spaceId ?? ''}:${snapshot.uncertainOperation.path}` : undefined;

  const saveToDevice = async (file: WorkspaceFileDetail, key: string, stillRelevant: () => boolean) => {
    if (downloading === key) return;
    setDownloading(key);
    setDownload(undefined);
    try {
      const result = await saveWorkspaceFileToDevice(file);
      // 系统目录选择器可能在切文件或切空间后才返回；旧结果不能写进新详情。
      if (stillRelevant()) setDownload({ key, message: downloadMessage(result, file.name) });
    } catch (error) {
      if (stillRelevant()) setDownload({ key, message: error instanceof Error ? error.message : '保存到设备失败' });
    } finally {
      setDownloading((current) => current === key ? undefined : current);
    }
  };

  return <View style={styles.root} testID="workspace-files-panel">
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.title}>工作区文件</Text>
    </View>
    <View style={styles.scopeChoices}>
      <ChoiceChip label="查看当前空间私有文件" text="当前空间" onPress={() => store.selectSpace(currentSpaceId)} selected={snapshot.scope === 'space' && !wrongSpace} disabled={locked} />
      <ChoiceChip label="查看全部空间共享文件" text="共享文件" onPress={store.selectShared} selected={snapshot.scope === 'shared'} disabled={locked} />
    </View>
    <Text selectable style={styles.scopeLabel}>当前范围：{scopeLabel}</Text>
    {snapshot.scope === 'shared' && <Text style={styles.warning}>共享文件会影响全部空间，请确认范围后再保存或删除。</Text>}
    {wrongSpace && <Text accessibilityRole="alert" style={styles.warning}>当前全局空间是 {currentSpaceId}；文件草稿仍属于 {snapshot.selectedSpaceId ?? '未选择空间'}。请先保存、取消或完成未明操作核对，文件范围才会切换。</Text>}
    {!!snapshot.error && <Text selectable accessibilityRole="alert" style={styles.error}>{snapshot.error}</Text>}
    {!!snapshot.notice && <Text accessibilityLiveRegion="polite" style={styles.success}>{snapshot.notice}</Text>}
    {snapshot.stale && snapshot.loaded && <Text style={styles.warning}>目录内容可能已变化；请手动刷新后核对。旧列表仍按上次读取结果显示。</Text>}

    {snapshot.uncertain && <Card style={styles.warningCard} tone="warning">
      <Text style={styles.cardTitle}>上次文件操作结果未明</Text>
      <Text selectable style={styles.body}>归属：{snapshot.uncertainOperation?.scope === 'shared' ? '共享文件 · 全部空间' : `私有文件 · ${snapshot.uncertainOperation?.spaceId ?? snapshot.selectedSpaceId ?? '未知空间'}`}</Text>
      <Text selectable style={styles.path}>路径：{snapshot.uncertainOperation?.path ?? '未记录'}</Text>
      <Text style={styles.body}>不会自动重发。请完整回读并逐字核对，再明确解除锁定；解除后再次提交会发起新请求。</Text>
      <View style={styles.actions}><ActionButton label="完整回读未明文件操作" text="回读核对" onPress={() => void store.verifyUncertainOperation()} disabled={snapshot.writing !== false} /></View>
      {snapshot.reviewed && <>
        {snapshot.verificationMissing ? <Text style={styles.warning}>回读结果：目标文件不存在。请与原操作预期核对。</Text>
          : verification ? <>
            <Text style={styles.caption}>回读文件：{formatSize(verification.size)} · {formatTime(verification.updatedAt)} · {verification.mimeType}</Text>
            <FileContent detail={verification} label="回读结果全文" styles={styles} />
            {verification.kind !== 'text' && verificationKey && <>
              <ActionButton label="下载未明操作回读文件到设备" text={downloading === verificationKey ? '正在保存到设备…' : '下载回读文件'} icon={Download} disabled={downloading === verificationKey}
                onPress={() => void saveToDevice(verification, verificationKey, () => {
                  const current = store.getSnapshot();
                  return current.uncertain && current.uncertainOperation !== undefined &&
                    `verification:${current.uncertainOperation.scope}:${current.uncertainOperation.spaceId ?? ''}:${current.uncertainOperation.path}` === verificationKey;
                })} />
              {download?.key === verificationKey && <Text selectable accessibilityLiveRegion="polite" style={styles.body}>{download.message}</Text>}
            </>}
          </>
            : <Text style={styles.warning}>回读未取得文件详情。</Text>}
        {snapshot.uncertainOperation?.content !== undefined && <TextBlock label="上次提交全文" value={snapshot.uncertainOperation.content} styles={styles} />}
        <ActionButton label="我已核对文件结果并解除锁定" text="我已核对，解除锁定" onPress={store.acknowledgeReviewed} disabled={snapshot.writing !== false} tone="primary" />
      </>}
    </Card>}

    {snapshot.savePreview ? <Card style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>确认保存 · {snapshot.savePreview.mode === 'create' ? '新建文本' : '修改文本'}</Text>
      <Text selectable style={styles.body}>范围：{snapshot.savePreview.scope === 'shared' ? '共享文件 · 全部空间' : `私有文件 · ${snapshot.savePreview.spaceId}`}</Text>
      <Text selectable style={styles.path}>路径：{snapshot.savePreview.path}</Text>
      <Text style={styles.caption}>以下是完整原文与完整待保存内容，请滚动到末尾核对。新建文件的原文为空。</Text>
      <TextBlock label="保存前 · 全文" value={snapshot.savePreview.before} styles={styles} />
      <TextBlock label="保存后 · 全文" value={snapshot.savePreview.after} styles={styles} />
      <View style={styles.actions}>
        <ActionButton label="确认保存工作区文件" text={snapshot.writing ? '正在保存…' : '确认保存'} onPress={() => void store.confirmSave()} disabled={!canWrite} tone="primary" />
        <ActionButton label="取消保存预览并保留文件草稿" text="返回草稿" onPress={store.cancelSavePreview} disabled={snapshot.writing !== false} />
      </View>
    </Card> : snapshot.editor ? <Card style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>{snapshot.editor.mode === 'create' ? '新建文本文件' : '编辑文本文件'}</Text>
      <Text selectable style={styles.body}>归属：{scopeLabel}</Text>
      {snapshot.editor.mode === 'create' ? <>
        <Text style={styles.fieldLabel}>相对当前范围根目录的完整路径</Text>
        <FormInput accessibilityLabel="新建文件相对路径" value={snapshot.editor.path} onChangeText={store.setDraftPath} editable={snapshot.writing === false && !snapshot.uncertain}
          autoCapitalize="none" autoCorrect={false} placeholder="例如 notes/today.txt" placeholderTextColor={colors.faint} style={styles.input} />
        <Text style={styles.caption}>路径每段仅可用 ASCII 字母、数字、点、连字符、下划线；可用 / 分隔已有目录。</Text>
      </> : <Text selectable style={styles.path}>路径：{snapshot.editor.path}</Text>}
      <Text style={styles.fieldLabel}>文本全文</Text>
      <FormInput variant="code" accessibilityLabel="编辑文件完整文本" multiline textAlignVertical="top" value={snapshot.editor.content} onChangeText={store.setDraftContent}
        editable={snapshot.writing === false && !snapshot.uncertain} autoCapitalize="none" autoCorrect={false} scrollEnabled
        placeholder="输入完整文本" placeholderTextColor={colors.faint} style={styles.editorInput} />
      <Text style={styles.caption}>当前 {utf8ByteLength(snapshot.editor.content).toLocaleString()} / {MAX_WORKSPACE_TEXT_BYTES.toLocaleString()} UTF-8 字节。编辑原文完整保留；超限内容不能保存，请全选替换或删减到上限内。</Text>
      <View style={styles.actions}>
        <ActionButton label="预览工作区文件保存前后全文" text="预览保存" onPress={() => { Keyboard.dismiss(); store.requestSave(); }} disabled={!canWrite || utf8ByteLength(snapshot.editor.content) > MAX_WORKSPACE_TEXT_BYTES} tone="primary" />
        <ActionButton label="取消编辑并丢弃文件草稿" text="取消编辑 · 丢弃草稿" onPress={() => { Keyboard.dismiss(); store.cancelEditor(); }} disabled={snapshot.writing !== false || snapshot.uncertain} />
      </View>
    </Card> : snapshot.deleteTarget ? <Card style={styles.warningCard} tone="danger">
      <Text accessibilityRole="header" style={styles.cardTitle}>确认删除普通文件？</Text>
      <Text selectable style={styles.body}>范围：{scopeLabel}</Text>
      <Text selectable style={styles.path}>路径：{snapshot.deleteTarget.path}</Text>
      <Text style={styles.warning}>文件删除后不可恢复；目录不能在这里删除。</Text>
      <View style={styles.actions}>
        <ActionButton label="确认删除工作区普通文件" text={snapshot.writing ? '正在删除…' : '确认删除文件'} onPress={() => void store.confirmDelete()} disabled={!canWrite} tone="danger" />
        <ActionButton label="取消删除工作区文件" text="取消" onPress={store.cancelDelete} disabled={snapshot.writing !== false} />
      </View>
    </Card> : <>
      <View style={styles.toolbar}>
        <ActionButton label="返回工作区上级目录" text="上级" icon={ChevronLeft} onPress={store.goUp} disabled={!canNavigate || snapshot.directoryPath === '.'} />
        <ActionButton label="新建工作区文本文件" text="新建文本" icon={Plus} onPress={() => { store.beginCreate(); if (snapshot.directoryPath !== '.') store.setDraftPath(`${snapshot.directoryPath}/`); }} disabled={!canWrite} />
      </View>
      <Text selectable style={styles.path}>目录：{snapshot.directoryPath}</Text>
      {snapshot.loading && <View style={styles.loading}><ActivityIndicator accessibilityLabel="正在读取工作区目录" color={colors.blue} /><Text style={styles.caption}>正在读取目录…</Text></View>}
      {!snapshot.loaded && !snapshot.loading && <Text style={styles.caption}>尚未读取目录。请刷新后重试。</Text>}
      {snapshot.loaded && !snapshot.stale && snapshot.entries.length === 0 && !snapshot.loading && <Text style={styles.caption}>当前目录没有文件或子目录。</Text>}
      {snapshot.entries.map((entry) => {
        const Icon = entry.kind === 'directory' ? Folder : File;
        return <Pressable key={entry.path} accessibilityRole="button" accessibilityLabel={`${entry.kind === 'directory' ? '打开目录' : '打开文件'} ${entry.path}`}
          accessibilityState={{ disabled: !canNavigate, selected: snapshot.selectedPath === entry.path }} disabled={!canNavigate}
          onPress={() => { if (entry.kind === 'directory') store.openDirectory(entry.path); else void store.openFile(entry.path); }}
          style={({ pressed }) => [styles.fileRow, pressed && styles.pressed, !canNavigate && styles.disabled]}>
          <Icon size={sizing.iconMedium} color={colors.blue} /><View style={styles.flexText}>
            <Text style={styles.fileName}>{entry.name}</Text>
            <Text style={styles.caption}>{entry.kind === 'directory' ? '目录' : formatSize(entry.size)} · {formatTime(entry.updatedAt)}</Text>
          </View>
        </Pressable>;
      })}
      {!!snapshot.selectedPath && <Card style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>文件详情</Text>
        <Text selectable style={styles.body}>范围：{scopeLabel}</Text>
        <Text selectable style={styles.path}>路径：{snapshot.selectedPath}</Text>
        {snapshot.detailLoading && <View style={styles.loading}><ActivityIndicator accessibilityLabel="正在完整读取文件" color={colors.blue} /><Text style={styles.caption}>正在完整读取文件…</Text></View>}
        {snapshot.missing && <Text style={styles.warning}>文件已不存在，请刷新目录核对。</Text>}
        {!!shownDownload && <Text selectable accessibilityLiveRegion="polite" style={styles.body}>设备保存结果（下载时读取的内容，不代表服务端当前版本）：{shownDownload}</Text>}
        {detail && <>
          <Text style={styles.caption}>{formatSize(detail.size)} · {formatTime(detail.updatedAt)} · {detail.mimeType}</Text>
          <FileContent detail={detail} label="文件完整内容" styles={styles} />
          <View style={styles.actions}>
            <ActionButton label={`下载工作区文件 ${detail.path}`} text={busyDownload ? '正在保存到设备…' : '下载到设备'} icon={Download} onPress={() => {
              if (!detailKey) return;
              void saveToDevice(detail, detailKey, () => {
                const current = store.getSnapshot();
                return current.selectedPath !== undefined &&
                  `${current.scope}:${current.selectedSpaceId ?? ''}:${current.selectedPath}` === detailKey;
              });
            }} disabled={busyDownload || !canNavigate} />
            {detail.kind === 'text' && <ActionButton label={`编辑工作区文本文件 ${detail.path}`} text="编辑文本" onPress={store.beginEdit} disabled={!canWrite} />}
            <ActionButton label={`准备删除工作区文件 ${detail.path}`} text="删除文件" onPress={() => store.requestDelete(detail.path)} disabled={!canWrite || !snapshot.entries.some((entry) => entry.kind === 'file' && entry.path === detail.path)} tone="danger" />
          </View>
        </>}
      </Card>}
    </>}
  </View>;
}

function TextBlock({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.textBlock}><Text style={styles.fieldLabel}>{label}</Text><Text selectable style={styles.fullText}>{value || '（空）'}</Text></View>;
}

function FileContent({ detail, label, styles }: { detail: WorkspaceFileDetail; label: string; styles: ReturnType<typeof createStyles> }) {
  if (detail.kind === 'text') return <TextBlock label={label} value={detail.content} styles={styles} />;
  if (detail.kind === 'image' && IMAGE_MIME.has(detail.mimeType)) {
    return <View style={styles.textBlock}><Text style={styles.fieldLabel}>{label} · 图片预览</Text>
      <RNImage accessibilityLabel={`本地图片预览 ${detail.path}`} source={{ uri: `data:${detail.mimeType};base64,${detail.dataBase64}` }} resizeMode="contain" style={styles.image} />
    </View>;
  }
  return <Text style={styles.caption}>{detail.kind === 'binary' ? '二进制文件不能在应用内预览，请下载到设备查看。' : '图片格式不在安全预览范围内，请下载到设备查看。'}</Text>;
}

const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  root: { gap: spacing.md, minWidth: 0, paddingBottom: spacing.section },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, minWidth: 0 }, flexText: { flex: 1, minWidth: 0 },
  title: { ...t.section, color: c.ink }, cardTitle: { ...t.itemTitle, color: c.ink, fontWeight: '600' },
  body: { ...t.detail, color: c.ink }, caption: { ...t.caption, color: c.faint },
  warning: { ...t.detail, color: c.warning }, error: { ...t.detail, color: c.danger }, success: { ...t.detail, color: c.success },
  scopeChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, scopeLabel: { ...t.status, color: c.ink },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

    disabled: { opacity: workspaceTheme.interaction.disabledOpacity }, pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fileRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, minWidth: 0, padding: spacing.md, borderRadius: r.field, backgroundColor: c.surface },
  fileName: { ...t.status, color: c.ink, flexShrink: 1 },
  card: { padding: spacing.lg, gap: spacing.md, minWidth: 0, backgroundColor: c.surface, borderRadius: r.card },
  warningCard: { padding: spacing.lg, gap: spacing.md, minWidth: 0, backgroundColor: c.warningSoft, borderRadius: r.card },
  path: { ...t.mono, color: c.ink, flexShrink: 1 }, fieldLabel: { ...t.status, color: c.ink },
  textBlock: { gap: spacing.sm, minWidth: 0 }, fullText: { ...t.mono, color: c.ink, backgroundColor: c.canvas, borderRadius: r.field, padding: spacing.md },
  input: { minHeight: l.inputMinHeight },
  editorInput: { minHeight: l.profileTextHeight },
  image: { width: '100%', height: l.emptyMinHeight, borderRadius: r.field, backgroundColor: c.canvas },
});
