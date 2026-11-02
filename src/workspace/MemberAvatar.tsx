import { Newspaper, Inbox, Sparkles } from 'lucide-react-native';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MuseAvatar } from './primitives';
import { MAIN_SPACE } from '../spaces/space-state';

/** 只表达成员身份；不从消息正文猜作者，不为每个 Space 复制品牌头像。 */
export function MemberAvatar({ spaceId, size = 52 }: { spaceId: string; size?: number }) {
  const { colors } = useTheme();
  if (spaceId === MAIN_SPACE) return <MuseAvatar size={size} />;
  const Icon = spaceId === 'news-internal' ? Newspaper : spaceId === 'sms-internal' ? Inbox : Sparkles;
  return <View style={{ width: size, height: size, borderRadius: size * 0.36, alignItems: 'center', justifyContent: 'center', backgroundColor: spaceId === 'sms-internal' ? colors.successSoft : colors.blueSoft }}>
    <Icon size={size * 0.44} strokeWidth={1.6} color={spaceId === 'sms-internal' ? colors.success : colors.accentText} />
  </View>;
}
