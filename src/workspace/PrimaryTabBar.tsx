import { useMemo } from 'react';
import { StyleSheet, Text, Pressable, View } from 'react-native';
import { MessageSquare, Newspaper, Settings, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { sizing, spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { PRIMARY_TABS, type PrimaryTabId } from './primary-nav';

export { PRIMARY_TABS, type PrimaryTabId };

export type PrimaryTabBarProps = {
  currentTab: PrimaryTabId;
  onSelectTab: (tab: PrimaryTabId) => void;
  disabled?: boolean;
};

const TAB_ICONS: Record<PrimaryTabId, LucideIcon> = {
  group: MessageSquare,
  news: Newspaper,
  settings: Settings,
};

export function PrimaryTabBar({ currentTab, onSelectTab, disabled = false }: PrimaryTabBarProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View
      style={styles.container}
      testID="primary-tab-bar"
      accessibilityRole="tablist"
      accessibilityLabel="一级导航"
    >
      {PRIMARY_TABS.map((tab) => {
        const selected = currentTab === tab.id;
        const Icon = TAB_ICONS[tab.id];
        const color = selected ? colors.accentText : colors.muted;

        return (
          <Pressable
            key={tab.id}
            testID={tab.testID}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onSelectTab(tab.id)}
            style={({ pressed }) => [
              styles.tab,
              pressed && styles.pressed,
            ]}
          >
            <Icon size={sizing.iconMedium} strokeWidth={spacing[2]} color={color} />
            <Text style={[styles.label, { color }, selected && styles.labelSelected]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (c: WorkspaceColors) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.line,
      backgroundColor: c.canvas,
      minHeight: sizing.touchTarget,
      paddingVertical: spacing[4],
    },
    tab: {
      flex: 1,
      minHeight: sizing.touchTarget,
      minWidth: 0,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[2],
    },
    label: {
      ...workspaceTheme.typography.caption,
      fontSize: 11,
      fontWeight: '400',
    },
    labelSelected: {
      fontWeight: '600',
    },
    pressed: {
      opacity: workspaceTheme.interaction.pressedOpacity,
    },
  });
