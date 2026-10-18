/**
 * 截图还原的独立 UI：只消费内存 fixture，不获取 API、凭据或正式会话状态。
 * 侧栏位于聊天前景下面；头像面板挂到根层，不能复用向上弹出的通用 Sheet。
 */
import {
  ArrowUp, Check, LogOut, Menu, MessageCircle, Mic, PanelsTopLeft,
  Moon, Plus, Shapes, Square, SquareCheck, SquarePen, Sun, X, type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  AccessibilityInfo, Animated, BackHandler, Easing, Image, Keyboard,
  KeyboardAvoidingView, PanResponder, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View, useWindowDimensions, type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { previewTheme, spacing, sizing, type PreviewColors } from '../ui/tokens';
import { PreviewSessionPanel } from './PreviewSessionPanel';
import { PreviewThemeProvider, usePreviewTheme } from './PreviewTheme';
import {
  MAIN_PREVIEW_THREAD, createPreviewState, previewReducer,
  type PreviewPage, type PreviewThread,
} from './preview-state';

const { layout: l, radius: r, typography: t } = previewTheme;

function usePreviewStyles() {
  const { colors } = usePreviewTheme();
  return useMemo(() => createStyles(colors), [colors]);
}
const AVATAR = require('../../assets/preview/reference-avatar.png');
const CHARACTERS = require('../../assets/preview/reference-characters.jpg');
const NAV: { id: PreviewPage; label: string; icon: LucideIcon }[] = [
  { id: 'chat', label: '聊天', icon: MessageCircle },
  { id: 'activity', label: '任务', icon: PanelsTopLeft },
  { id: 'goals', label: '目标', icon: SquareCheck },
  { id: 'apps', label: '应用', icon: Shapes },
];

function RoundButton({ icon: Icon, label, onPress, testID }: {
  icon: LucideIcon; label: string; onPress: () => void; testID?: string;
}) {
  const { colors: c } = usePreviewTheme();
  const styles = usePreviewStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    testID={testID} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
    <Icon size={l.iconSize} strokeWidth={1.7} color={c.ink} />
  </Pressable>;
}

function TypingIndicator() {
  const styles = usePreviewStyles();
  return <View accessibilityLabel="正在生成示例回复" style={styles.typing}>
    {[0, 1, 2].map((dot) => <View key={dot} style={styles.typingDot} />)}
  </View>;
}

function ChatMessages({ thread, scrollRef, imageSize }: { thread: PreviewThread; scrollRef: React.RefObject<ScrollView | null>; imageSize: number }) {
  const styles = usePreviewStyles();
  return <ScrollView ref={scrollRef} style={styles.chatScroll} keyboardShouldPersistTaps="handled"
    showsVerticalScrollIndicator={false} contentContainerStyle={styles.messageList}>
    {thread.messages.length === 0 && <View style={styles.emptyChat}>
      <Text style={styles.emptyTitle}>开始一段新的对话</Text>
      <Text style={styles.mutedText}>本地 UI 预览，你的输入不会发送给服务端。</Text>
    </View>}
    {thread.messages.map((message) => <View key={message.id} style={styles.messageBlock}>
      {!!message.text && <View style={[styles.message, message.role === 'user' ? styles.userMessage : styles.assistantMessage]}>
        <Text selectable style={[styles.messageText, message.role === 'user' && styles.userMessageText]}>{message.text}</Text>
      </View>}
      {message.image && <Image source={CHARACTERS} accessibilityLabel="来自参考截图的示例角色插图"
        resizeMode="cover" style={[styles.messageImage, { width: imageSize, height: imageSize }]} />}
    </View>)}
    {thread.running && <TypingIndicator />}
  </ScrollView>;
}

function PlaceholderPage({ page, thread, onExit }: { page: PreviewPage; thread: PreviewThread; onExit: () => void }) {
  const { colors: c } = usePreviewTheme();
  const styles = usePreviewStyles();
  if (page === 'activity') return <ScrollView contentContainerStyle={styles.otherPage}>
    <Text style={styles.pageTitle}>任务</Text>
    <Text style={styles.mutedText}>当前会话的示例任务</Text>
    {thread.activities.map((activity) => <View key={activity.id} style={styles.exampleCard}>
      <Text style={styles.itemTitle}>{activity.title}</Text>
      <Text style={styles.mutedText}>{activity.detail}</Text>
      <Text style={styles.caption}>{activity.status === 'running' ? '进行中 · 假数据' : '已结束 · 假数据'}</Text>
    </View>)}
  </ScrollView>;
  if (page === 'goals') return <View style={styles.otherPage}>
    <Text style={styles.pageTitle}>目标</Text>
    <Text style={styles.mutedText}>本轮先验收聊天、会话侧栏与头像面板，不连接真实目标。</Text>
  </View>;
  return <View style={styles.otherPage}>
    <Text style={styles.pageTitle}>应用</Text>
    <View style={styles.exampleCard}>
      <Text style={styles.itemTitle}>截图 UI 预览</Text>
      <Text style={styles.mutedText}>假会话只保存在内存中；未读取或写入真实服务数据。</Text>
      <Text style={styles.caption}>头像与插图暂用你提供的截图裁剪，仅用于本轮视觉对照。</Text>
    </View>
    <Pressable accessibilityRole="button" onPress={onExit} style={styles.exitRow}>
      <LogOut size={l.iconSize} color={c.ink} />
      <Text style={styles.itemTitle}>退出 UI 预览</Text>
    </Pressable>
  </View>;
}

export function PreviewRoot({ onExit }: { onExit: () => void }) {
  return <PreviewThemeProvider><PreviewWorkspace onExit={onExit} /></PreviewThemeProvider>;
}

function PreviewWorkspace({ onExit }: { onExit: () => void }) {
  const { colors: c, mode, toggle } = usePreviewTheme();
  const styles = usePreviewStyles();
  const [state, dispatch] = useReducer(previewReducer, undefined, createPreviewState);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [notice, setNotice] = useState('');
  const [inputHeight, setInputHeight] = useState(l.composerHeight - l.composerPadding * 2);
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width, l.maxWidth);
  const drawerWidth = Math.min(contentWidth * l.drawerRatio, l.drawerMaxWidth);
  const [drawerProgress] = useState(() => new Animated.Value(0));
  const chatRef = useRef<ScrollView>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const completionTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const thread = state.threads.find((item) => item.id === state.currentThreadId)!;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (mounted) setReducedMotion(enabled); });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { mounted = false; listener.remove(); };
  }, []);
  useEffect(() => {
    if (state.drawerOpen) Keyboard.dismiss();
    const animation = Animated.timing(drawerProgress, {
      toValue: state.drawerOpen ? 1 : 0,
      duration: reducedMotion ? 0 : previewTheme.motion.drawerDuration,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [drawerProgress, reducedMotion, state.drawerOpen]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state.drawerOpen) { dispatch({ type: 'close-drawer' }); return true; }
      return false;
    });
    return () => listener.remove();
  }, [state.drawerOpen]);
  useEffect(() => {
    requestAnimationFrame(() => chatRef.current?.scrollToEnd({ animated: false }));
  }, [state.currentThreadId, thread.messages.length]);
  useEffect(() => {
    const timers = completionTimers.current;
    return () => {
      clearTimeout(noticeTimer.current);
      timers.forEach(clearTimeout);
    };
  }, []);

  const hint = (text: string) => {
    clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(''), previewTheme.motion.feedbackDuration);
  };
  const openDrawer = () => { Keyboard.dismiss(); dispatch({ type: 'open-drawer' }); };
  const selectThread = (id: string) => {
    dispatch({ type: 'select-thread', id });
    dispatch({ type: 'set-page', page: 'chat' });
    dispatch({ type: 'close-drawer' });
    setInputHeight(l.composerHeight - l.composerPadding * 2);
  };
  const createThread = () => {
    dispatch({ type: 'create-thread' });
    dispatch({ type: 'set-page', page: 'chat' });
    dispatch({ type: 'close-drawer' });
  };
  const send = () => {
    if (thread.running || !thread.draft.trim()) return;
    dispatch({ type: 'send' });
    const threadId = thread.id;
    clearTimeout(completionTimers.current.get(threadId));
    completionTimers.current.set(threadId, setTimeout(() => {
      completionTimers.current.delete(threadId);
      dispatch({ type: 'complete', threadId });
    }, previewTheme.motion.replyDuration));
    requestAnimationFrame(() => chatRef.current?.scrollToEnd({ animated: !reducedMotion }));
  };
  const stop = () => {
    clearTimeout(completionTimers.current.get(thread.id));
    completionTimers.current.delete(thread.id);
    dispatch({ type: 'stop' });
  };
  const pan = PanResponder.create({
    onMoveShouldSetPanResponder: (event, gesture) => {
      const horizontal = Math.abs(gesture.dx) > l.gestureThreshold && Math.abs(gesture.dx) > Math.abs(gesture.dy) * l.gestureAxisRatio;
      return horizontal && (state.drawerOpen ? gesture.dx < 0 : event.nativeEvent.pageX - gesture.dx < l.edgeGestureWidth && gesture.dx > 0);
    },
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dx < -l.gestureThreshold) dispatch({ type: 'close-drawer' });
      if (gesture.dx > l.gestureThreshold) openDrawer();
    },
  });

  return <View style={styles.root} testID="ui-preview">
    <StatusBar style={mode === 'light' ? 'dark' : 'light'} />
    <View style={[styles.viewport, { width: contentWidth }]} {...pan.panHandlers}>
      <SafeAreaView style={[styles.drawer, { width: drawerWidth }]} edges={['top', 'bottom', 'left']}
        pointerEvents={state.drawerOpen ? 'auto' : 'none'}
        aria-hidden={!state.drawerOpen}
        {...(Platform.OS === 'web' && !state.drawerOpen ? { inert: true } : {})}
        accessibilityElementsHidden={!state.drawerOpen} importantForAccessibility={state.drawerOpen ? 'yes' : 'no-hide-descendants'}>
        <View style={styles.drawerHeading}>
          <Text style={styles.drawerTitle}>Pi Muse</Text>
          <RoundButton icon={X} label="关闭会话侧栏" onPress={() => dispatch({ type: 'close-drawer' })} />
        </View>
        <Text style={styles.drawerSection}>会话</Text>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.drawerList}>
          {state.threads.map((item) => <Pressable key={item.id} accessibilityRole="button"
            accessibilityLabel={item.id === MAIN_PREVIEW_THREAD ? '主会话' : item.name}
            accessibilityState={{ selected: item.id === thread.id }} onPress={() => selectThread(item.id)}
            style={[styles.threadRow, item.id === thread.id && styles.threadSelected]}>
            <MessageCircle size={l.navigationIconSize} color={c.ink} fill={item.id === thread.id ? c.ink : 'none'} strokeWidth={1.7} />
            <View style={styles.threadText}>
              <Text numberOfLines={1} style={styles.itemTitle}>{item.id === MAIN_PREVIEW_THREAD ? '主会话' : item.name}</Text>
              <Text numberOfLines={1} style={styles.caption}>{item.status}</Text>
            </View>
            {item.id === thread.id && <Check size={sizing[18]} color={c.muted} />}
          </Pressable>)}
        </ScrollView>
        <View style={styles.drawerFooter}>
          <Pressable accessibilityRole="button" accessibilityLabel="退出 UI 预览" onPress={onExit} style={styles.drawerExit}>
            <LogOut size={l.iconSize} color={c.muted} />
            <Text style={styles.caption}>退出预览</Text>
          </Pressable>
          <RoundButton icon={SquarePen} label="新建会话" onPress={createThread} testID="preview-create-thread" />
        </View>
      </SafeAreaView>
      <Animated.View style={[styles.foreground, state.drawerOpen && styles.foregroundRounded,
        { transform: [{ translateX: drawerProgress.interpolate({ inputRange: [0, 1], outputRange: [0, drawerWidth] }) }] }]}
        accessibilityElementsHidden={state.drawerOpen} importantForAccessibility={state.drawerOpen ? 'no-hide-descendants' : 'auto'}>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']} aria-hidden={state.drawerOpen}
          {...(Platform.OS === 'web' && state.drawerOpen ? { inert: true } : {})}>
          <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'}>
            <View style={styles.previewLabel}><Text style={styles.previewLabelText}>UI 预览 · 假数据</Text></View>
            <View style={styles.chatBody} pointerEvents={state.drawerOpen ? 'none' : 'auto'}>
              {state.page === 'chat' ? <ChatMessages thread={thread} scrollRef={chatRef} imageSize={contentWidth * l.imageRatio - l.sidePadding} />
                : <PlaceholderPage page={state.page} thread={thread} onExit={onExit} />}
            </View>
            <View style={styles.floatingHeader} pointerEvents="box-none">
              <View style={styles.headerLeft}><RoundButton icon={Menu} label="打开会话侧栏" onPress={openDrawer} testID="preview-open-drawer" /></View>
              <Pressable accessibilityRole="button" accessibilityLabel="打开当前会话面板"
                accessibilityHint="全屏显示当前会话的动态、审批、工作区和历史" testID="preview-open-session"
                style={styles.identity} onPress={() => { Keyboard.dismiss(); dispatch({ type: 'open-session' }); }}>
                <Image source={AVATAR} style={styles.headerAvatar} accessibilityLabel="预览助手头像" />
                <View style={styles.identityLabel}>
                  <Text style={styles.identityName}>{thread.name}</Text>
                  <Text numberOfLines={1} style={styles.identityStatus}>🔬 {thread.status}</Text>
                </View>
              </Pressable>
              <View style={styles.headerRight}><RoundButton icon={mode === 'light' ? Moon : Sun}
                label={mode === 'light' ? '切换到暗色主题' : '切换到亮色主题'} onPress={toggle} testID="preview-theme-toggle" /></View>
            </View>
            {!!notice && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
            {state.page === 'chat' && <View style={styles.composer}>
              <Pressable accessibilityRole="button" accessibilityLabel="添加附件（预览）" onPress={() => hint('此轮只预览附件入口，不会访问照片或文件。')} style={styles.composerControl}>
                <Plus size={l.iconSize} color={c.ink} />
              </Pressable>
              <TextInput accessibilityLabel="预览消息输入框" placeholder="消息" placeholderTextColor={c.faint}
                value={thread.draft} onChangeText={(text) => dispatch({ type: 'set-draft', text })} multiline
                onContentSizeChange={(event) => setInputHeight(Math.max(l.composerHeight - l.composerPadding * 2, Math.min(l.composerMaxHeight, event.nativeEvent.contentSize.height)))}
                onKeyPress={Platform.OS === 'web' ? (event) => {
                  const key = event.nativeEvent as typeof event.nativeEvent & { shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
                  if (key.key === 'Enter' && !key.shiftKey && !key.isComposing && key.keyCode !== 229) { event.preventDefault(); send(); }
                } : undefined}
                style={[styles.input, { height: thread.draft ? inputHeight : l.composerHeight - l.composerPadding * 2 },
                  Platform.OS === 'web' && ({ outlineStyle: 'none' } as unknown as TextStyle)]} />
              {!thread.draft && <Pressable accessibilityRole="button" accessibilityLabel="语音输入（预览）" onPress={() => hint('此轮只预览语音入口，不会启用麦克风。')} style={styles.composerControl}>
                <Mic size={l.iconSize} color={c.faint} />
              </Pressable>}
              <Pressable accessibilityRole="button" accessibilityLabel={thread.running ? '停止示例回复' : '发送示例消息'}
                disabled={!thread.running && !thread.draft.trim()} style={[styles.sendButton, !thread.running && !thread.draft.trim() && styles.disabled]}
                onPress={() => thread.running ? stop() : send()}>
                {thread.running ? <Square size={sizing[16]} color={c.onAccent} fill={c.onAccent} /> : <ArrowUp size={l.iconSize} color={c.onAccent} />}
              </Pressable>
            </View>}
            <View accessibilityRole="tablist" accessibilityLabel="主要页面" style={styles.navigation}>
              {NAV.map(({ id, label, icon: Icon }) => <Pressable key={id} accessibilityRole="tab" accessibilityLabel={label}
                accessibilityState={{ selected: state.page === id }} aria-selected={state.page === id}
                onPress={() => dispatch({ type: 'set-page', page: id })} style={styles.navigationItem}>
                <Icon size={l.navigationIconSize} strokeWidth={1.8} color={state.page === id ? c.ink : c.faint}
                  fill={id === 'chat' && state.page === id ? c.ink : 'none'} />
              </Pressable>)}
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
        {state.drawerOpen && <Pressable accessibilityRole="button" accessibilityLabel="收起会话侧栏"
          onPress={() => dispatch({ type: 'close-drawer' })} style={styles.foregroundCover} />}
      </Animated.View>
    </View>
    {state.sessionOpen && <PreviewSessionPanel thread={thread} tab={state.sessionTab}
      onTab={(tab) => dispatch({ type: 'set-session-tab', tab })} onClose={() => dispatch({ type: 'close-session' })}
      onDecide={(id, decision) => dispatch({ type: 'decide', id, decision })} reducedMotion={reducedMotion} />}
  </View>;
}

const createStyles = (c: PreviewColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.canvas },
  viewport: { flex: 1, alignSelf: 'center', overflow: 'hidden', backgroundColor: c.canvas },
  screen: { flex: 1, backgroundColor: c.canvas },
  foreground: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.canvas, overflow: 'hidden' },
  foregroundRounded: { borderRadius: r.drawerForeground },
  foregroundCover: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.overlay },
  previewLabel: { alignItems: 'center', paddingTop: l.previewLabelTop },
  previewLabelText: { ...t.caption, fontSize: l.previewLabelSize, color: c.faint },
  chatBody: { flex: 1, minHeight: 0 },
  chatScroll: { flex: 1 },
  messageList: { paddingTop: l.chatContentTop, paddingHorizontal: l.sidePadding, paddingBottom: spacing[24], gap: l.messageGap },
  messageBlock: { gap: l.messageGap },
  message: { padding: l.messagePadding, borderRadius: r.message },
  assistantMessage: { backgroundColor: c.surface, borderTopLeftRadius: l.bubbleTail, alignSelf: 'flex-start', maxWidth: '100%' },
  userMessage: { backgroundColor: c.blue, alignSelf: 'flex-end', maxWidth: l.userMessageWidth },
  messageText: { ...t.message, color: c.ink },
  userMessageText: { color: c.onAccent },
  messageImage: { borderRadius: r.image },
  typing: { width: l.typingWidth, height: l.typingHeight, borderRadius: r.round, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[6], backgroundColor: c.surface, marginTop: spacing[8] },
  typingDot: { width: l.typingDotSize, height: l.typingDotSize, borderRadius: r.round, backgroundColor: c.muted },
  floatingHeader: { position: 'absolute', top: l.headerTop, left: l.sidePadding, right: l.sidePadding, height: l.headerHeight },
  headerLeft: { position: 'absolute', top: 0, left: 0 },
  headerRight: { position: 'absolute', top: 0, right: 0 },
  roundButton: { width: l.controlSize, height: l.controlSize, borderRadius: r.round, backgroundColor: c.control, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  identity: { alignSelf: 'center', alignItems: 'center', maxWidth: '56%' },
  headerAvatar: { width: l.headerAvatar, height: l.headerAvatar, borderRadius: r.round, backgroundColor: c.avatar },
  identityLabel: { paddingHorizontal: spacing[14], paddingVertical: spacing[6], marginTop: -spacing[10], zIndex: -1, borderRadius: r.message, backgroundColor: c.control, alignItems: 'center', maxWidth: '100%' },
  identityName: { ...t.name, color: c.ink },
  identityStatus: { ...t.status, color: c.muted },
  composer: { flexDirection: 'row', alignItems: 'center', minHeight: l.composerHeight, padding: l.composerPadding, marginHorizontal: l.sidePadding, marginBottom: l.composerBottom, borderRadius: r.round, backgroundColor: c.surface },
  composerControl: { width: l.smallControl, height: l.smallControl, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minWidth: 0, ...t.input, color: c.ink, paddingHorizontal: spacing[6], paddingVertical: spacing[8], textAlignVertical: 'center', maxHeight: l.composerMaxHeight, backgroundColor: c.surface, borderWidth: 0, overflow: 'hidden' },
  sendButton: { width: l.smallControl, height: l.smallControl, borderRadius: r.round, alignItems: 'center', justifyContent: 'center', backgroundColor: c.blue },
  disabled: { opacity: 0.4 },
  navigation: { flexDirection: 'row', height: l.navigationHeight, marginHorizontal: spacing[26], marginBottom: l.navigationBottom, alignItems: 'center' },
  navigationItem: { flex: 1, height: l.controlSize, alignItems: 'center', justifyContent: 'center' },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, paddingHorizontal: l.sidePadding, paddingTop: l.drawerTop, backgroundColor: c.canvas },
  drawerHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: l.drawerTop, marginBottom: l.drawerTitleBottom },
  drawerTitle: { ...t.drawerTitle, color: c.ink },
  drawerSection: { ...t.caption, color: c.faint, marginBottom: spacing[12], marginLeft: spacing[4] },
  drawerList: { gap: spacing[6] },
  threadRow: { minHeight: l.drawerRowHeight, flexDirection: 'row', alignItems: 'center', gap: spacing[14], paddingHorizontal: spacing[14], paddingVertical: spacing[8], borderRadius: r.listItem },
  threadSelected: { backgroundColor: c.surface },
  threadText: { flex: 1, gap: spacing[2] },
  drawerFooter: { height: l.drawerFooterHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  drawerExit: { flexDirection: 'row', gap: spacing[8], alignItems: 'center', minHeight: l.controlSize },
  otherPage: { paddingTop: l.headerHeight, paddingHorizontal: l.sidePadding, paddingBottom: spacing[24], gap: spacing[16] },
  pageTitle: { ...t.heroName, color: c.ink },
  itemTitle: { ...t.itemTitle, color: c.ink },
  mutedText: { ...t.detail, color: c.muted },
  caption: { ...t.caption, color: c.faint },
  exampleCard: { backgroundColor: c.surface, borderRadius: r.card, padding: spacing[20], gap: spacing[8] },
  exitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[12], minHeight: l.controlSize },
  emptyChat: { paddingVertical: spacing[40], gap: spacing[12] },
  emptyTitle: { ...t.heroName, color: c.ink },
  notice: { ...t.caption, color: c.muted, paddingHorizontal: l.sidePadding, paddingVertical: spacing[8] },
});
