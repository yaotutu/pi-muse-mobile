import { useRef, useState } from 'react';
import { Keyboard, StyleSheet, Text, View, type TextInputInstance } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from './ActionButton';
import { FormInput } from './FormInput';
import { Sheet } from './Sheet';
import { Card } from './Surfaces';
import { spacing, workspaceTheme } from './tokens';

/** 设置页只展示摘要。编辑副本随弹层关闭丢弃，完成后才交回原设置草稿。 */
export function SettingsTextField({ label, value, onChangeText, maxLength, empty, placeholder, editable = true }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  maxLength: number;
  empty: string;
  placeholder?: string;
  editable?: boolean;
}) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<'read' | 'edit'>();
  const [draft, setDraft] = useState('');
  const input = useRef<TextInputInstance>(null);
  const hasText = !!value.trim();

  const openEditor = () => {
    setDraft(value);
    setMode('edit');
  };
  const close = () => {
    if (mode === 'edit') Keyboard.dismiss();
    setMode(undefined);
  };

  return <>
    <Card style={styles.summary}>
      <Text accessibilityRole="header" style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <Text numberOfLines={3} style={[styles.body, { color: colors.muted }]}>{hasText ? value.trim() : empty}</Text>
      <View style={styles.actions}>
        {hasText && <ActionButton label={`查看${label}全文`} text="查看全文" onPress={() => setMode('read')} />}
        {editable && <ActionButton label={`编辑${label}`} text="编辑" onPress={openEditor} />}
      </View>
    </Card>
    {mode && <Sheet title={mode === 'edit' ? `编辑${label}` : label} onClose={close} onShow={() => input.current?.focus()} wide>
      <View style={styles.editor}>
        {mode === 'read' ? <>
          <Text selectable style={[styles.body, { color: colors.ink }]}>{value}</Text>
          {editable && <ActionButton label={`编辑${label}`} text="编辑" onPress={openEditor} />}
        </> : <>
          <FormInput ref={input} accessibilityLabel={label} autoFocus multiline value={draft} onChangeText={setDraft}
            maxLength={maxLength} placeholder={placeholder} editable={editable} style={styles.input} />
          {draft.length >= maxLength && <Text style={[styles.body, { color: colors.muted }]}>最多 {maxLength.toLocaleString()} 字符</Text>}
          <View style={styles.actions}>
            <ActionButton label="取消编辑" text="取消" onPress={close} />
            <ActionButton label="完成编辑" text="完成" tone="primary"
              disabled={!editable || draft === value || draft.length > maxLength}
              onPress={() => { onChangeText(draft); close(); }} />
          </View>
        </>}
      </View>
    </Sheet>}
  </>;
}

const styles = StyleSheet.create({
  summary: { gap: spacing[8] },
  label: { ...workspaceTheme.typography.detail, fontWeight: '600' },
  body: { ...workspaceTheme.typography.detail },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },
  editor: { gap: spacing[12] },
  input: { minHeight: 180, maxHeight: 300 },
});
