import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { IconControl } from '../ui/IconControl';
import { spacing, workspaceTheme } from '../ui/tokens';

/** 会话及其子页共用固定顶栏；文件路径只作标题副文，不再挤占阅读正文。 */
export function PageHeader({ title, caption, backLabel, onBack, action, leading = false }: {
  title: string; caption?: string; backLabel?: string; onBack: () => void; action?: ReactNode; leading?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: workspaceTheme.layout.sidePadding, paddingVertical: spacing[12], gap: spacing[12] },
    heading: { flex: 1, minWidth: 0, alignItems: 'center' },
    title: { ...workspaceTheme.typography.heroName, maxWidth: '100%', textAlign: 'center', color: colors.ink },
    caption: { ...workspaceTheme.typography.caption, maxWidth: '100%', color: colors.muted },
    side: { width: workspaceTheme.layout.controlSize, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  }), [colors]);
  return <View style={[styles.header, leading && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }]}>
    <IconControl icon={ArrowLeft} label={backLabel ?? '返回上一级'} onPress={onBack} />
    <View style={[styles.heading, leading && { alignItems: 'flex-start' }]}>
      <Text numberOfLines={1} accessibilityRole="header" style={[styles.title, leading && { textAlign: 'left', ...workspaceTheme.typography.section }]}>{title}</Text>
      {!!caption && <Text numberOfLines={1} ellipsizeMode="middle" style={styles.caption}>{caption}</Text>}
    </View>
    {(!leading || action) && <View style={styles.side}>{action}</View>}
  </View>;
}
