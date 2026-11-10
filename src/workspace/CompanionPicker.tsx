import { Check, Circle } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { builtinPacks } from '../companion/builtin-packs';
import { useCompanion } from '../companion/CompanionProvider';
import type { CompanionKey } from '../companion/types';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, themeTokens } from '../theme/tokens';
import { ActionButton } from '../ui/ActionButton';
import { Card } from '../ui/Surfaces';

/** 二级设置只消费领域快照，不在组件中另开下载或持有选择副本。 */
export function CompanionPicker() {
  const { colors } = useTheme(); const companion = useCompanion();
  const choice = (key: CompanionKey, name: string, description: string, builtin = false) => {
    const checked = companion.selectedKey === key; const busy = companion.downloadingKey === key;
    const images = builtin ? builtinPacks[0].images : companion.cachedImages[key];
    const Icon = checked ? Check : Circle;
    return <Pressable key={key} accessibilityRole="radio" accessibilityLabel={name} accessibilityHint={description}
      accessibilityState={{ checked, busy, disabled: !builtin && !companion.connected }} testID={`companion-choice-${key}`}
      disabled={!builtin && !companion.connected} onPress={() => void companion.select(key)}
      style={({ pressed }) => [styles.choice, { backgroundColor: pressed ? colors.selected : colors.surface }]}>
      {images ? <Image accessible={false} source={images.idle} style={styles.preview} />
        : <View accessible={false} style={[styles.preview, { backgroundColor: colors.control, alignItems: 'center', justifyContent: 'center' }]}><Circle size={24} color={colors.muted} /></View>}
      <View style={styles.copy}><Text style={[styles.name, { color: colors.ink }]}>{name}</Text>
        <Text style={[styles.description, { color: colors.muted }]}>{description}</Text>
        <Text accessibilityLiveRegion="polite" style={[styles.description, { color: colors.muted }]}>{busy ? '正在下载完整形象包…' : checked ? '已选择' : builtin || images ? '已可用' : '选择后下载八张状态图'}</Text>
      </View>
      <Icon accessible={false} size={24} color={checked ? colors.blue : colors.faint} />
    </Pressable>;
  };
  return <View style={styles.section} testID="companion-picker">
    <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>内置形象</Text>
    <Card style={styles.card}><View accessibilityRole="radiogroup" accessibilityLabel="内置形象">
      {builtinPacks.map((pack) => choice(pack.key, pack.name, pack.description, true))}
    </View></Card>
    <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>服务端形象包</Text>
    <Card style={styles.card}>
      {!companion.connected ? <Text style={[styles.note, { color: colors.muted }]}>请先连接服务器，再读取或切换服务端形象包。当前连接已缓存的形象可离线继续显示。</Text> : <>
        <View style={styles.refresh}><ActionButton label={companion.refreshing ? '正在刷新…' : '刷新列表'} disabled={companion.refreshing} onPress={() => void companion.refresh()} /></View>
        <View accessibilityRole="radiogroup" accessibilityLabel="服务端形象包">
          {companion.serverPacks.map((pack) => choice(`server:${pack.id}`, pack.name, pack.description))}
        </View>
        {!companion.refreshing && !companion.serverPacks.length && <Text style={[styles.note, { color: colors.muted }]}>暂无完整的服务端形象包。</Text>}
      </>}
      {companion.diagnostics.length > 0 && <View style={styles.warnings}>
        <Text style={{ color: colors.warning }}>部分形象包不可用，未列入可选项：</Text>
        {companion.diagnostics.map((diagnostic, index) => <Text key={`${diagnostic.id}-${index}`} style={{ color: colors.warning }}>{diagnostic.id}：{diagnostic.message}</Text>)}
      </View>}
    </Card>
    {companion.error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{companion.error}</Text>}
    {companion.notice && <Text accessibilityLiveRegion="polite" style={{ color: colors.warning }}>{companion.notice}</Text>}
    <Text style={[styles.description, { color: colors.muted }]}>选择仅影响本机助手形象，不会重置聊天或中断回复。服务端形象全部下载成功后才替换；不可用时安全回退到冰蓝企鹅。</Text>
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: spacing[12] }, heading: { ...themeTokens.typography.itemTitle, fontWeight: '600' },
  card: { padding: 0, overflow: 'hidden' },
  choice: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing[12], padding: spacing[12] },
  preview: { width: 48, height: 48, flexShrink: 0, resizeMode: 'contain' },
  copy: { flex: 1, minWidth: 0, gap: spacing[4] }, name: { ...themeTokens.typography.itemTitle },
  description: { ...themeTokens.typography.caption }, note: { padding: spacing[16], ...themeTokens.typography.caption },
  refresh: { padding: spacing[12] }, warnings: { padding: spacing[16], gap: spacing[8] },
});
