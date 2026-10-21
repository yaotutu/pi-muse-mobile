import { Check, Circle } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { availableThemes } from './registry';
import { useTheme } from './ThemeProvider';
import { sizing, spacing, themeTokens } from './tokens';
import type { ThemeColors } from './types';

/** 主题目录直接驱动选项与色板预览，应用页不再维护颜色、名称或选择规则。 */
export function ThemePicker() {
  const { colors, themeId, selectTheme, loading, saving, error } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>外观</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="外观主题" style={styles.choices}>
      {availableThemes.map((theme) => {
        const checked = themeId === theme.id;
        const Icon = checked ? Check : Circle;
        return <Pressable key={theme.id} accessibilityRole="radio" accessibilityLabel={`选择${theme.name}主题`}
          accessibilityHint={theme.description} accessibilityState={{ checked }} testID={`theme-choice-${theme.id}`}
          onPress={() => selectTheme(theme.id)} style={({ pressed }) => [styles.choice, checked && styles.checked, pressed && styles.pressed]}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.preview, { backgroundColor: theme.colors.canvas, borderColor: theme.colors.line }]}>
            <View style={[styles.previewLine, { backgroundColor: theme.colors.surface }]} />
            <View style={[styles.previewBubble, { backgroundColor: theme.colors.blue }]} />
          </View>
          <View style={styles.copy}><Text style={styles.name}>{theme.name}</Text><Text style={styles.description}>{theme.description}</Text></View>
          <Icon size={sizing[20]} color={checked ? colors.accentText : colors.faint} />
        </Pressable>;
      })}
    </View>
    <Text accessibilityLiveRegion="polite" style={error ? styles.error : styles.note}>
      {error ?? (loading ? '正在恢复本机主题偏好…' : saving ? '正在保存主题偏好…' : '主题保存在本机；亮暗快捷键会返回上次选择的浅色主题。')}
    </Text>
  </View>;
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  section: { gap: spacing[10] },
  heading: { ...themeTokens.typography.caption, color: c.faint, marginTop: spacing[12], marginLeft: spacing[6] },
  choices: { gap: spacing[8] },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing[14], minHeight: sizing[76], padding: spacing[14], borderRadius: themeTokens.radius.card, backgroundColor: c.surface, borderWidth: sizing.borderWidth, borderColor: c.line },
  checked: { borderColor: c.accentText },
  pressed: { opacity: themeTokens.interaction.pressedOpacity },
  preview: { width: sizing[58], height: sizing[44], padding: spacing[8], borderWidth: sizing.borderWidth, borderRadius: themeTokens.radius.field, gap: spacing[4] },
  previewLine: { width: sizing[23], height: spacing[8], borderRadius: themeTokens.radius.round },
  previewBubble: { width: sizing[23], height: spacing[8], alignSelf: 'flex-end', borderRadius: themeTokens.radius.round },
  copy: { flex: 1, gap: spacing[2] },
  name: { ...themeTokens.typography.itemTitle, color: c.ink },
  description: { ...themeTokens.typography.caption, color: c.muted },
  note: { ...themeTokens.typography.caption, color: c.faint, marginHorizontal: spacing[6] },
  error: { ...themeTokens.typography.caption, color: c.danger, marginHorizontal: spacing[6] },
});
