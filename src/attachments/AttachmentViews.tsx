/**
 * 聊天附件的纯原生展示投影。选择、上传、历史映射和失败处理由调用方负责；
 * 此处不读取文件、不访问网络，也不把附件名解释成路径或链接。
 */
import { FileText, Image as ImageIcon, Plus, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image as RNImage, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { isCanonicalBase64 } from './validation';
import { useTheme } from '../theme/ThemeProvider';
import { sizing, spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';

const { layout: l, radius: r, typography: t, interaction } = workspaceTheme;
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** 仅供界面展示；上传请求与服务端历史分别在接入时映射到此结构。 */
export type AttachmentViewItem = {
  id: string;
  name: string;
  kind: 'image' | 'text';
  mimeType: string;
  size: number;
  image?: { mimeType: string; dataBase64: string };
};

function useStyles() {
  const { colors } = useTheme();
  return { colors, styles: useMemo(() => createStyles(colors), [colors]) };
}

function formatSize(size: number): string {
  const bytes = Number.isFinite(size) ? Math.max(0, size) : 0;
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function safeImageUri(item: AttachmentViewItem): string | undefined {
  if (item.kind !== 'image' || !item.image || !IMAGE_MIME.has(item.image.mimeType)) return undefined;
  const { dataBase64, mimeType } = item.image;
  // 只拼接已知 MIME 与纯 Base64；拒绝 data URI、远程地址、SVG、HTML 及任何额外 URI 参数。
  if (!isCanonicalBase64(dataBase64)) return undefined;
  return `data:${mimeType};base64,${dataBase64}`;
}

function AttachmentVisual({ item, uri, large = false }: { item: AttachmentViewItem; uri?: string; large?: boolean }) {
  const { colors, styles } = useStyles();
  if (uri) return <RNImage source={{ uri }} resizeMode="cover" style={large ? styles.messageThumbnail : styles.stripThumbnail} />;
  const Icon = item.kind === 'image' ? ImageIcon : FileText;
  return <View style={large ? styles.messageIcon : styles.stripIcon}>
    <Icon size={sizing.iconMedium} color={colors.muted} />
  </View>;
}

/** 放在输入框上方；禁用期间移除键不会回调调用方。 */
export function AttachmentStrip({ items, disabled = false, onRemove }: {
  items: AttachmentViewItem[];
  disabled?: boolean;
  onRemove?: (id: string) => void;
}) {
  const { colors, styles } = useStyles();
  const imageUris = useMemo(() => items.map(safeImageUri), [items]);
  if (!items.length) return null;
  return <View style={styles.list}>
    {items.map((item, index) => <View key={item.id} style={styles.stripRow}>
      <AttachmentVisual item={item} uri={imageUris[index]} />
      <View style={styles.info}>
        <Text numberOfLines={2} style={styles.name}>{item.name}</Text>
        <Text numberOfLines={1} style={styles.detail}>{formatSize(item.size)}</Text>
      </View>
      {onRemove && <Pressable
        accessibilityRole="button"
        accessibilityLabel={`移除附件 ${item.name}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => { if (!disabled) onRemove(item.id); }}
        style={({ pressed }) => [styles.removeButton, disabled && styles.disabled, pressed && styles.pressed]}
      >
        <X size={sizing.iconMedium} color={colors.muted} />
      </Pressable>}
    </View>)}
  </View>;
}

/** 已发送的用户附件：文本只列出文件信息，图片只预览经过白名单检查的本地数据。 */
export function MessageAttachments({ items }: { items: AttachmentViewItem[] }) {
  const { colors, styles } = useStyles();
  const [openId, setOpenId] = useState<string | null>(null);
  // 图片可达数 MiB；列表未变化时不因流式消息重渲染重复扫描 Base64。
  const imageUris = useMemo(() => items.map(safeImageUri), [items]);
  const selectedIndex = items.findIndex((item) => item.id === openId);
  const selected = items[selectedIndex];
  const selectedUri = imageUris[selectedIndex];
  if (!items.length) return null;

  return <>
    <View style={styles.list}>
      {items.map((item, index) => {
        const uri = imageUris[index];
        const content = <>
          <AttachmentVisual item={item} uri={uri} large />
          <View style={styles.info}>
            <Text numberOfLines={2} style={styles.name}>{item.name}</Text>
            <Text numberOfLines={2} style={styles.detail}>{formatSize(item.size)} · {item.mimeType}</Text>
          </View>
        </>;
        return uri
          ? <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`查看图片附件 ${item.name}`} onPress={() => setOpenId(item.id)} style={({ pressed }) => [styles.messageRow, pressed && styles.pressed]}>{content}</Pressable>
          : <View key={item.id} style={styles.messageRow}>{content}</View>;
      })}
    </View>
    <Modal visible={!!selectedUri} transparent animationType="fade" onRequestClose={() => setOpenId(null)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard} accessibilityViewIsModal>
          <View style={styles.modalHeader}>
            <Text numberOfLines={1} style={styles.modalTitle}>{selected?.name}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" onPress={() => setOpenId(null)} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <X size={sizing.iconMedium} color={colors.ink} />
            </Pressable>
          </View>
          {selectedUri && <RNImage accessibilityLabel={`图片附件 ${selected?.name}`} source={{ uri: selectedUri }} resizeMode="contain" style={styles.modalImage} />}
        </View>
      </View>
    </Modal>
  </>;
}

/** 选择器动作由调用方持有；selecting 为真时显示忙碌并停止接收重复点击。 */
export function AttachmentAction({ disabled = false, selecting = false, onPress }: {
  disabled?: boolean;
  selecting?: boolean;
  onPress: () => void;
}) {
  const { colors, styles } = useStyles();
  const inactive = disabled || selecting;
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel="添加图片或文本附件"
    accessibilityState={{ disabled: inactive, busy: selecting }}
    disabled={inactive}
    onPress={() => { if (!inactive) onPress(); }}
    style={({ pressed }) => [styles.actionButton, disabled && styles.disabled, pressed && styles.pressed]}
  >
    {selecting
      ? <ActivityIndicator size="small" color={colors.blue} />
      : <Plus size={l.iconSize} color={disabled ? colors.faint : colors.ink} />}
  </Pressable>;
}

const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  list: { width: '100%', minWidth: 0, gap: spacing[8] },
  stripRow: { flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: spacing[8], padding: spacing[8], borderRadius: r.field, backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
  messageRow: { flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: spacing[10], padding: spacing[8], borderRadius: r.field, backgroundColor: c.control },
  info: { flex: 1, minWidth: 0, gap: spacing[2] },
  name: { ...t.status, color: c.ink, fontWeight: '600' },
  detail: { ...t.caption, color: c.muted },
  stripThumbnail: { width: sizing[42], height: sizing[42], borderRadius: r.field, backgroundColor: c.control },
  stripIcon: { width: sizing[42], height: sizing[42], borderRadius: r.field, backgroundColor: c.control, alignItems: 'center', justifyContent: 'center' },
  messageThumbnail: { width: sizing[64], height: sizing[64], borderRadius: r.field, backgroundColor: c.canvas },
  messageIcon: { width: sizing[64], height: sizing[64], borderRadius: r.field, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  removeButton: { width: sizing.touchTarget, height: sizing.touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: r.round },
  actionButton: { width: l.smallControl, height: l.smallControl, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: interaction.disabledOpacity },
  pressed: { opacity: interaction.pressedOpacity },
  modalBackdrop: { flex: 1, padding: spacing[16], alignItems: 'center', justifyContent: 'center', backgroundColor: c.scrim },
  modalCard: { width: '100%', maxWidth: l.maxWidth, height: '80%', padding: spacing[16], gap: spacing[12], borderRadius: r.card, backgroundColor: c.surface },
  modalHeader: { flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: spacing[8] },
  modalTitle: { ...t.name, color: c.ink, flex: 1, minWidth: 0 },
  closeButton: { width: sizing.touchTarget, height: sizing.touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: r.round, backgroundColor: c.control },
  modalImage: { flex: 1, width: '100%', borderRadius: r.field, backgroundColor: c.canvas },
});
