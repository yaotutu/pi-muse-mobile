import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { IconControl } from '../ui/IconControl';
import { spacing, workspaceTheme } from '../ui/tokens';

/** 空间及其子页共用固定顶栏；文件路径只作标题副文，不再挤占阅读正文。 */
export function SpaceHeader({ title, caption, backLabel, onBack, action }: {
  title: string; caption?: string; backLabel?: string; onBack: () => void; action?: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: workspaceTheme.layout.sidePadding, paddingVertical: spacing[12], gap: spacing[12] },
    heading: { flex: 1, minWidth: 0, alignItems: 'center' },
    title: { ...workspaceTheme.typography.heroName, color: colors.ink },
    caption: { ...workspaceTheme.typography.caption, color: colors.muted },
    side: { width: workspaceTheme.layout.controlSize },
  }), [colors]);
  return <View style={styles.header}>
    <IconControl icon={ArrowLeft} label={backLabel ?? '返回成员上一级'} onPress={onBack} />
    <View style={styles.heading}>
      <Text numberOfLines={1} accessibilityRole="header" style={styles.title}>{title}</Text>
      {!!caption && <Text numberOfLines={1} ellipsizeMode="middle" style={styles.caption}>{caption}</Text>}
    </View>
    <View style={styles.side}>{action}</View>
  </View>;
}
