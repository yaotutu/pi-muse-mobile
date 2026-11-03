import { Newspaper, Inbox, Sparkles } from 'lucide-react-native';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MuseAvatar } from './primitives';
import { MAIN_AGENT } from '../agents/agent-state';

/** 只表达成员身份；不从消息正文猜作者，不为每个 Agent 复制品牌头像。 */
export function MemberAvatar({ agentId, size = 52 }: { agentId: string; size?: number }) {
  const { colors } = useTheme();
  if (agentId === MAIN_AGENT) return <MuseAvatar size={size} />;
  const Icon = agentId === 'news-internal' ? Newspaper : agentId === 'sms-internal' ? Inbox : Sparkles;
  return <View style={{ width: size, height: size, borderRadius: size * 0.36, alignItems: 'center', justifyContent: 'center', backgroundColor: agentId === 'sms-internal' ? colors.successSoft : colors.blueSoft }}>
    <Icon size={size * 0.44} strokeWidth={1.6} color={agentId === 'sms-internal' ? colors.success : colors.accentText} />
  </View>;
}
