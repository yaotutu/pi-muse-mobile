import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, useAnimatedValue } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { themeTokens } from '../theme/tokens';
import { useReducedMotion } from './use-reduced-motion';

type Segment<T extends string> = { value: T; label: string; icon: LucideIcon; testID: string };

/** 同层页面选择只接收受控值；业务状态与切页后的清理仍由调用方负责。 */
export function SegmentedControl<T extends string>({ value, options, onChange, label, disabled = false, busy = false }: {
  value: T;
  options: readonly Segment<T>[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const locked = disabled || busy;
  const [layoutWidth, setLayoutWidth] = useState(0);
  const translateX = useAnimatedValue(0);
  const jumpAfterLayout = useRef(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const inset = themeTokens.layout.sessionTabInset + StyleSheet.hairlineWidth;
  const itemWidth = options.length ? Math.max(0, (layoutWidth - inset * 2) / options.length) : 0;

  // 首次布局及宽度变化直接落到当前项；后续受控选择沿用同一个位移值，中途反向从当前位置继续。
  useEffect(() => {
    if (!itemWidth || selectedIndex < 0) return;
    const target = selectedIndex * itemWidth;
    if (jumpAfterLayout.current || reducedMotion) {
      jumpAfterLayout.current = false;
      translateX.setValue(target);
      return;
    }
    const animation = Animated.timing(translateX, {
      toValue: target,
      duration: themeTokens.motion.segmentDuration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [itemWidth, reducedMotion, selectedIndex, translateX]);

  const styles = useMemo(() => StyleSheet.create({
    group: { flexDirection: 'row', alignItems: 'stretch', padding: themeTokens.layout.sessionTabInset, minHeight: themeTokens.layout.sessionTabsHeight,
      borderRadius: themeTokens.radius.tab, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.floatingLine, backgroundColor: colors.floatingSurface },
    indicator: { position: 'absolute', left: inset, top: inset, bottom: inset, borderRadius: themeTokens.radius.round, backgroundColor: colors.selected },
    item: { flex: 1, minWidth: 0, minHeight: themeTokens.layout.smallControl, paddingVertical: themeTokens.layout.tabLabelGap,
      alignItems: 'center', justifyContent: 'center', borderRadius: themeTokens.radius.round, gap: themeTokens.layout.tabLabelGap },
    text: { ...themeTokens.typography.navigation, color: colors.faint, textAlign: 'center' },
    selectedText: { color: colors.ink },
    pressed: { opacity: themeTokens.interaction.pressedOpacity },
    disabled: { opacity: themeTokens.interaction.disabledOpacity },
  }), [colors, inset]);

  // RN View 没有 Web 键盘事件类型；仅 Web 注入，组内按顺序循环，锁定时完全不切换。
  const webKeyProps = Platform.OS === 'web' ? { onKeyDown: (event: { key?: string; preventDefault?: () => void }) => {
    if (locked || !options.length) return;
    const index = options.findIndex((option) => option.value === value);
    if (index < 0) return;
    const key = event.key;
    let next: number;
    if (key === 'ArrowLeft') next = (index - 1 + options.length) % options.length;
    else if (key === 'ArrowRight') next = (index + 1) % options.length;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = options.length - 1;
    else return;
    event.preventDefault?.();
    onChange(options[next].value);
  } } : {};

  return <View accessibilityRole="tablist" accessibilityLabel={label} {...(webKeyProps as object)} style={styles.group}
    onLayout={(event) => {
      const width = event.nativeEvent.layout.width;
      if (width === layoutWidth) return;
      const nextItemWidth = options.length ? Math.max(0, (width - inset * 2) / options.length) : 0;
      translateX.setValue(Math.max(0, selectedIndex) * nextItemWidth);
      jumpAfterLayout.current = true;
      setLayoutWidth(width);
    }}>
    {itemWidth > 0 && selectedIndex >= 0 && <Animated.View pointerEvents="none" accessible={false}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden
      style={[styles.indicator, { width: itemWidth, transform: [{ translateX }] }]} />}
    {options.map(({ value: optionValue, label: optionLabel, icon: Icon, testID }) => {
      const selected = value === optionValue;
      return <Pressable key={optionValue} accessibilityRole="tab" accessibilityLabel={optionLabel}
        accessibilityState={{ selected, disabled: locked, busy }} aria-selected={selected}
        disabled={locked} onPress={() => onChange(optionValue)} testID={testID}
        style={({ pressed }) => [styles.item, pressed && styles.pressed, locked && styles.disabled]}>
        <Icon size={themeTokens.layout.iconSize - themeTokens.layout.tabLabelGap} color={selected ? colors.ink : colors.faint} strokeWidth={selected ? 2 : 1.6} />
        <Text style={[styles.text, selected && styles.selectedText]}>{optionLabel}</Text>
      </Pressable>;
    })}
  </View>;
}
