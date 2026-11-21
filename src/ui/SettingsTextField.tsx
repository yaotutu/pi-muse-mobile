import { ChevronRight, FileText, Pencil } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from './ActionButton';
import { FormInput } from './FormInput';
import { Sheet } from './Sheet';
import { spacing, workspaceTheme } from './tokens';

/** 阅读与编辑共用一个入口。编辑副本只有明确交回设置页才会覆盖草稿。 */
export function SettingsTextField({ label, value, onChangeText, maxLength, empty, placeholder, editable = true, saveDirect = false }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  maxLength: number;
  empty: string;
  placeholder?: string;
  editable?: boolean;
  saveDirect?: boolean;
}) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<'read' | 'edit'>();
  const [draft, setDraft] = useState('');
  const hasText = !!value.trim();
  const dirty = draft !== value;

  const openEditor = () => {
    setDraft(value);
    setMode('edit');
  };
  const close = () => {
    Keyboard.dismiss();
    setMode(undefined);
  };
  const cancel = () => {
    if (mode !== 'edit' || !dirty) {
      close();
      return;
    }
    Alert.alert('放弃本次编辑？', '设置页中的原有内容会保留。', [
      { text: '继续编辑', style: 'cancel' },
      { text: '放弃编辑', style: 'destructive', onPress: close },
    ]);
  };
  const footer = mode === 'edit' ? <View style={styles.footer}>
    <ActionButton label="取消编辑" text="取消" onPress={cancel} />
    <ActionButton label="完成编辑" text={saveDirect ? '保存' : '保留草稿'} tone="primary"
      disabled={!editable || !dirty || draft.length > maxLength}
      onPress={() => { onChangeText(draft); close(); }} />
  </View> : editable ? <View style={styles.footer}>
    <ActionButton label={`编辑${label}`} text="编辑" icon={Pencil} tone="primary" onPress={openEditor} />
  </View> : undefined;

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      accessibilityHint={hasText ? '打开全文' : editable ? '打开编辑' : empty}
      disabled={!hasText && !editable}
      onPress={() => hasText ? setMode('read') : openEditor()}
      style={({ pressed }) => [styles.summary, { backgroundColor: pressed ? colors.selected : colors.surface, borderColor: colors.line }]}>
      <View style={[styles.icon, { backgroundColor: colors.control }]}><FileText size={18} color={colors.blue} /></View>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
        <Text numberOfLines={2} style={[styles.body, { color: colors.muted }]}>{hasText ? value.trim() : empty}</Text>
      </View>
      <ChevronRight size={18} color={colors.muted} />
    </Pressable>
    {mode && <Sheet title={mode === 'edit' ? `编辑${label}` : label} onClose={cancel} footer={footer} wide>
      {mode === 'read'
        ? <Text selectable style={[styles.document, { color: colors.ink }]}>{value}</Text>
        : <View style={styles.editor}>
          <FormInput accessibilityLabel={label} multiline value={draft} onChangeText={setDraft}
            maxLength={maxLength} placeholder={placeholder} editable={editable} style={styles.input} />
          <View style={styles.metadata}>
            <Text style={[styles.body, { color: colors.muted }]}>{saveDirect ? '保存后生效' : '返回设置后保存生效'}</Text>
            <Text style={[styles.body, { color: colors.muted }]}>{draft.length.toLocaleString()} / {maxLength.toLocaleString()}</Text>
          </View>
        </View>}
    </Sheet>}
  </>;
}

const styles = StyleSheet.create({
  summary: { minHeight: 76, flexDirection: 'row', alignItems: 'center', padding: spacing[12], gap: spacing[12],
    borderWidth: StyleSheet.hairlineWidth, borderRadius: workspaceTheme.radius.card },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: spacing[8] },
  copy: { flex: 1, minWidth: 0, gap: spacing[4] },
  label: { ...workspaceTheme.typography.detail, fontWeight: '600' },
  body: { ...workspaceTheme.typography.caption },
  document: { ...workspaceTheme.typography.detail, lineHeight: 25 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing[8] },
  editor: { gap: spacing[8] },
  input: { minHeight: 112, maxHeight: 220 },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing[8] },
});
