import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { IconControl } from './IconControl';
import { spacing, workspaceTheme } from './tokens';

type HeaderProps = {
  title: string;
  backLabel: string;
  onBack: () => void;
  backTestID?: string;
  action?: ReactNode;
};

/** 子页只保留一个固定顶栏；左右等宽，长标题在窄屏换行，不挤占触控目标。安全区由工作区统一处理。 */
export function SubpageHeader({ title, backLabel, onBack, backTestID, action }: HeaderProps) {
  const { colors } = useTheme();
  return <View style={[styles.header, { backgroundColor: colors.floatingSurface, borderBottomColor: colors.line }]}>
    <IconControl transparent icon={ChevronLeft} label={backLabel} onPress={onBack} testID={backTestID} />
    <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>
    <View style={styles.action}>{action}</View>
  </View>;
}

/** 表单子页自行持有滚动区，刷新不随正文滚走；请求和草稿生命周期仍由各领域负责。 */
export function Subpage({ children, contentStyle, testID, ...header }: HeaderProps & {
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  testID: string;
}) {
  return <View style={styles.root} testID={testID}>
    <SubpageHeader {...header} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, contentStyle]}>
      {children}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[8], paddingTop: workspaceTheme.layout.headerTop,
    paddingBottom: spacing[8], paddingHorizontal: workspaceTheme.layout.sidePadding, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...workspaceTheme.typography.status, fontWeight: '600', textAlign: 'center', flex: 1, minWidth: 0 },
  action: { width: workspaceTheme.layout.controlSize, minHeight: workspaceTheme.layout.controlSize, justifyContent: 'center', alignItems: 'center' },
  content: { paddingTop: workspaceTheme.layout.pageTop, paddingHorizontal: workspaceTheme.layout.sidePadding, paddingBottom: spacing[24] },
});
