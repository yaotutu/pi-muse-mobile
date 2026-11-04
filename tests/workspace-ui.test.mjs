import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('Muse 配色和形象保留在头像栏和浏览器入口，不恢复灵动岛或底部目标入口', () => {
  const screen = read('src/workspace/WorkspaceScreen.tsx');
  assert.match(screen, /<AgentAvatarStrip targets={targets}/);
  assert.doesNotMatch(screen, /DynamicIsland|settingsCapsule|capsuleLabel/);
  assert.equal(existsSync(new URL('src/workspace/DynamicIsland.tsx', root)), false);
  assert.equal(existsSync(new URL('src/ui/Subpage.tsx', root)), false);
  assert.match(screen, /<BrowserPanel store=\{browser\}/);
  assert.match(screen, /createBrowserStore\(api, snapshot\.serverUrl/);
  assert.doesNotMatch(screen, /const NAV:|workspace-tab-/);
});

test('唯一主题由根级持有，聊天与独立更新弹层共享而不重建业务 Provider', () => {
  const source = read('src/app/AppRoot.tsx');
  assert.ok(source.indexOf('<ThemeProvider>') < source.indexOf('<UpdateProvider'));
  assert.ok(source.indexOf('<UpdateProvider') < source.indexOf('<WorkspaceScreen'));
  assert.doesNotMatch(read('src/workspace/WorkspaceScreen.tsx'), /<ThemeProvider/);
  assert.doesNotMatch(read('src/theme/ThemeProvider.tsx'), /key=|ApiProvider|useConnection|setServer/);
  assert.equal(existsSync(new URL('src/ui/ThemeProvider.tsx', root)), false);
  assert.equal(existsSync(new URL('src/workspace/WorkspaceTheme.tsx', root)), false);
});

test('所有视觉消费者使用唯一语义主题，不恢复旧固定亮色调色板', () => {
  for (const directory of ['src/ui', 'src/workspace', 'src/update', 'src/theme']) {
    for (const file of readdirSync(new URL(directory + '/', root)).filter((file) => file.endsWith('.tsx'))) {
      const path = `${directory}/${file}`;
      const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      for (const statement of ast.statements.filter(ts.isImportDeclaration)) {
        if (!statement.moduleSpecifier.text.endsWith('/tokens')) continue;
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          assert.equal(bindings.elements.some((node) => node.name.text === 'colors'), false, path);
        }
      }
      assert.doesNotMatch(read(path), /#[0-9a-f]{3,8}\b/i, `${path} hardcoded color`);
    }
  }
});

test('主题定义、选择器、快捷键与状态栏集中管理，不再散落在业务页面', () => {
  const source = read('src/workspace/WorkspaceScreen.tsx');
  assert.match(source, /<ThemePicker\s*\/>/);
  assert.doesNotMatch(source, /setMode|selectTheme|晨光白|深夜黑|切换到暗色主题|切换到亮色主题/);
  const picker = read('src/theme/ThemePicker.tsx');
  assert.match(picker, /availableThemes\.map/);
  assert.match(picker, /themeId === theme\.id/);
  assert.match(picker, /accessibilityRole="radio"/);
  assert.match(read('src/theme/ThemeToggle.tsx'), /onPress=\{toggleAppearance\}/);
  for (const path of ['src/ui/Sheet.tsx', 'src/workspace/ConnectionPanel.tsx']) {
    assert.match(read(path), /<ThemeStatusBar\s*\/>/);
    assert.doesNotMatch(read(path), /from 'expo-status-bar'|mode === 'dark'/);
  }
  const screen = read('src/workspace/WorkspaceScreen.tsx');
  const panel = read('src/workspace/SessionPanel.tsx');
  assert.match(screen, /<ThemeStatusBar\s*\/>/);
  assert.match(screen, /<MuseAvatar size=/);
  assert.match(screen, /<StatusPill label=\{statusLabel\}/);
  assert.doesNotMatch(panel, /<MuseAvatar|<StatusPill|<Modal/);
  assert.match(screen, /accessibilityElementsHidden=\{sessionMounted\}/);
  assert.match(screen, /pointerEvents=\{sessionMounted \? 'none' : 'auto'\}/);
  assert.match(screen, /<AvatarBloomTransition/);
  assert.match(read('src/workspace/AvatarBloomTransition.tsx'), /useAnimatedStyle/);
  assert.doesNotMatch(read('src/ui/tokens.ts'), /#[0-9a-f]|workspacePalettes|colors:/i);
});

test('主题模块不依赖业务领域，独立偏好存储不接触连接地址或凭据', () => {
  for (const file of readdirSync(new URL('src/theme/', root)).filter((file) => /\.tsx?$/.test(file))) {
    const ast = ts.createSourceFile(file, read(`src/theme/${file}`), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const statement of ast.statements.filter(ts.isImportDeclaration)) {
      assert.doesNotMatch(statement.moduleSpecifier.text, /connection|runtime|agents|workspace|activities|approvals|memories|update|\/api\//, file);
    }
  }
  assert.match(read('src/theme/device-preferences.ts'), /pi-muse-mobile-theme-v1/);
  assert.doesNotMatch(read('src/theme/device-preferences.ts'), /deviceConnectionStore|serverUrl|token|accessKey/);
});

test('聊天空态只留短句，本地头像与真实流动画均有稳定入口', () => {
  const chat = read('src/workspace/ConversationView.tsx');
  assert.match(chat, /testID="conversation-empty"/);
  assert.match(chat, /有什么想聊的？/);
  assert.doesNotMatch(chat, /A LITTLE AGENT|想法，从这里开始|帮我梳理一个想法|一起拆解一个目标/);
  assert.match(chat, /conversation\.running && <TypingIndicator/);
  const primitives = read('src/workspace/primitives.tsx');
  assert.match(primitives, /require\('\.\.\/\.\.\/assets\/images\/muse-companion\.png'\)/);
  assert.ok(existsSync(new URL('assets/images/muse-companion.png', root)));
  assert.match(primitives, /if \(reduced\)/);
  assert.match(primitives, /return \(\) => animation\.stop\(\)/);
  assert.doesNotMatch(primitives, /https?:\/\//);
});

test('聊天顶部头像栏在正常布局，隐藏智能体不重复挂载其他页面', () => {
  assert.match(read('src/workspace/WorkspaceScreen.tsx'), /<AgentAvatarStrip targets={targets}/);
  assert.match(read('src/workspace/ConversationView.tsx'), /paddingTop: spacing\[12\]/);
  assert.match(read('src/workspace/ConversationHost.tsx'), /!chatVisible && <View style={styles.owner}>{otherPage}/);
  assert.match(read('src/workspace/SessionPanel.tsx'), /<ScrollView\s+key={tab}/);
});

test('头像栏承担切换，动态面板继续显示当前智能体的真实状态', () => {
  const screen = read('src/workspace/WorkspaceScreen.tsx');
  assert.match(screen, /onSettings={\(id\) => id === 'group' \? openGlobalSettings\(\) : openAgentSettings\(id\)}/);
  assert.match(screen, /<StatusPill label={statusLabel} testID="workspace-session-status"/);
  assert.match(screen, /sessionName && <Text numberOfLines={1}/);
  assert.doesNotMatch(screen, /chatHeader:|identityLabelSurface:/);
  assert.match(read('src/workspace/AgentPage.tsx'), /accessibilityLabel="查看成员动态与审批"/);
});

test('会话面板采样持续挂载的聊天层，关闭期间继续隔离底层交互', () => {
  const screen = read('src/workspace/WorkspaceScreen.tsx');
  const surface = read('src/ui/FrostedSurface.tsx');
  const panel = read('src/workspace/SessionPanel.tsx');
  assert.ok(screen.indexOf('<BlurTargetView ref={chatBlurTarget}') < screen.indexOf('<FrostedSurface blurTarget={chatBlurTarget}>'));
  const targetTag = screen.slice(screen.indexOf('<BlurTargetView ref={chatBlurTarget}'), screen.indexOf('>', screen.indexOf('<BlurTargetView ref={chatBlurTarget}')) + 1);
  assert.doesNotMatch(targetTag, /pointerEvents|aria-hidden|accessibilityElementsHidden|importantForAccessibility/);
  assert.match(screen, /<BlurTargetView ref=\{chatBlurTarget\} style=\{styles\.bodyStage\}>[\s\S]*?<View style=\{styles\.bodyStage\} testID="workspace-chat-accessibility-layer"[\s\S]*?pointerEvents=\{sessionMounted \? 'none' : 'auto'\}[\s\S]*?accessibilityElementsHidden=\{sessionMounted\} importantForAccessibility=\{sessionMounted \? 'no-hide-descendants' : 'auto'\}/);
  assert.match(surface, /<BlurView[\s\S]*blurTarget=\{blurTarget\}/);
  assert.match(surface, /dimezisBlurViewSdk31Plus/);
  assert.match(surface, /colors\.panelVeil/);
  assert.doesNotMatch(surface, /backgroundColor:\s*colors\.canvas/);
  assert.doesNotMatch(panel, /backgroundColor:\s*colors\.canvas|<Modal/);
  assert.match(screen, /if \(finished && !sessionOpen\) setSessionMounted\(false\)/);
  assert.match(screen, /setSessionOpen\(false\)/);
  assert.match(screen, /testID="workspace-session-status"/);
});

test('会话动态按 OpenMuse 极简时间线展示真实状态，去除冗余割裂按钮，关键警告与审批入口保持可见', () => {
  const execution = read('src/workspace/CurrentExecution.tsx');
  assert.doesNotMatch(execution, /IN THE MOMENT|<SectionHeading/);
  assert.match(execution, /!runtime\.synchronized && <View style=\{styles\.syncCard\}>/);
  assert.match(execution, /run\.status === 'failed' && styles\.danger/);
  assert.match(execution, /run\.pendingApprovalIds\.length/);
  assert.match(execution, /run\.activityId !== null/);
  assert.doesNotMatch(execution, /查看活动历史|状态说明/);
});

test('会话复用整组分段，新闻使用紧凑受控文字Tab', () => {
  const control = read('src/ui/SegmentedControl.tsx');
  const session = read('src/workspace/SessionPanel.tsx');
  const news = read('src/workspace/NewsPage.tsx');
  assert.match(session, /<SegmentedControl value=\{tab\} options=\{TABS\}/);
  assert.doesNotMatch(news, /<SegmentedControl/);
  assert.match(news, /\(\['recommended', 'all'\] as const\)\.map/);
  assert.match(news, /store\.setView\(view\)/);
  assert.match(news, /aria-selected=\{snapshot\.view === view\}/);
  for (const [id, label] of [['activity', '动态'], ['approvals', '审批'], ['history', '历史']]) {
    assert.match(session, new RegExp(`label: '${label}'.*testID: 'workspace-session-tab-${id}'`));
  }
  assert.match(session, /next === 'history'\) setHistoryActivityId\(undefined\)/);
  assert.match(control, /accessibilityState=\{\{ selected, disabled: locked, busy \}\}/);
  assert.match(control, /if \(locked \|\| !options.length\) return/);
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.match(control, new RegExp(key));
  assert.doesNotMatch(session, /onKeyDown|tabSelected|tabLabelSelected/);
});

test('共享分段仅用一块底板位移，初次和尺寸变化直定位，减少动画时静止', () => {
  const control = read('src/ui/SegmentedControl.tsx');
  const tokens = read('src/theme/tokens.ts');
  assert.match(control, /const translateX = useAnimatedValue\(0\)/);
  assert.match(control, /onLayout=\{\(event\) =>/);
  assert.match(control, /translateX\.setValue\(Math\.max\(0, selectedIndex\) \* nextItemWidth\)/);
  assert.match(control, /jumpAfterLayout\.current \|\| reducedMotion/);
  assert.match(control, /Animated\.timing\(translateX, \{/);
  assert.match(control, /useNativeDriver: true/);
  assert.match(control, /return \(\) => animation\.stop\(\)/);
  assert.match(control, /<Animated\.View pointerEvents="none" accessible=\{false\}/);
  assert.match(control, /importantForAccessibility="no-hide-descendants" aria-hidden/);
  assert.doesNotMatch(control, /selected: \{ backgroundColor: colors\.selected \}/);
  assert.match(tokens, /segmentDuration: 200/);
});

test('会话文字操作共用点击区与状态，重置由独立确认承载', () => {
  const button = read('src/ui/ActionButton.tsx');
  const execution = read('src/workspace/CurrentExecution.tsx');
  const screen = read('src/workspace/WorkspaceScreen.tsx');
  const dialog = read('src/workspace/ResetSessionDialog.tsx');
  for (const label of ['重新同步运行状态']) {
    assert.match(execution, new RegExp(`<ActionButton label="${label}"`));
  }
  assert.doesNotMatch(execution, /查看活动历史|状态说明|查看关联活动/);
  for (const label of ['确认重置会话', '取消重置会话']) assert.match(dialog, new RegExp(`<ActionButton label="${label}"`));
  assert.match(screen, /确认删除.*style: 'destructive'/);
  assert.match(button, /minHeight: themeTokens\.layout\.smallControl/);
  assert.match(button, /maxWidth: '100%'/);
  assert.match(button, /minWidth: 0, flexShrink: 1/);
  assert.match(button, /accessibilityState=\{\{ disabled: locked, busy, .*expanded/);
  assert.match(dialog, /!available \|\| session\.resetUncertain \|\| !sessions\.canWrite\(agentId\) \|\| sessions\.hasSettingsWrite\(agentId\)/);
  assert.match(read('src/workspace/AgentManagement.tsx'), /member.id !== MAIN_AGENT && !isBuiltinMember\(member.id\)/);
  assert.doesNotMatch(execution, /styles\.button|styles\.buttonText/);
  assert.doesNotMatch(screen, /styles\.secondaryButton/);
});

test('原生输入时压缩会话信息区且不挂载底栏，键盘事件监听随宿主卸载清理', () => {
  const source = read('src/workspace/WorkspaceScreen.tsx');
  assert.match(source, /compact={keyboardVisible}/);
  assert.doesNotMatch(source, /<Navigation/);
  assert.match(source, /return \(\) => \{ show\.remove\(\); hide\.remove\(\); \}/);
  const chat = read('src/workspace/ConversationView.tsx');
  assert.match(chat, /onLayout=\{followLatest\}/);
  assert.match(chat, /onContentSizeChange=\{\(\) => \{ scrollFollow\.current\.onContentSizeChange\(\); followLatest\(\); \}\}/);
  assert.match(chat, /if \(visible && scrollFollow\.current\.onLayout\(\)\) anchorFrame\.current\?\.schedule\(\)/);
  assert.match(chat, /if \(next\.anchor\) anchorFrame\.current\?\.schedule\(\)/);
  assert.match(chat, /onScrollBeginDrag=\{\(\) => \{ scrollFollow\.current\.onDrag\(\); anchorFrame\.current\?\.cancel\(\); \}\}/);
});

test('Android 单层 KAV 按键盘重叠收缩完整聊天区，composer 留在正常流内', () => {
  const screen = read('src/workspace/WorkspaceScreen.tsx');
  const chat = read('src/workspace/ConversationView.tsx');
  assert.equal((screen.match(/<KeyboardAvoidingView\b/g) ?? []).length, 1);
  assert.match(screen, /<KeyboardAvoidingView style=\{styles\.screen\} behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\} enabled=\{Platform\.OS !== 'web'\}/);
  assert.ok(screen.indexOf('<KeyboardAvoidingView') < screen.indexOf('<ConversationHost'));
  assert.ok(screen.indexOf('<ConversationHost') < screen.indexOf('</KeyboardAvoidingView>'));
  assert.match(chat, /chatBody: \{ flex: 1, minHeight: 0 \}/);
  assert.match(chat, /composer: \{/);
  assert.doesNotMatch(chat.slice(chat.indexOf('composer: {'), chat.indexOf('composerFocused: {')), /position: 'absolute'|bottom: 0/);
  assert.doesNotMatch(screen, /chatHeader:/);
});

test('工具结果缺席不是运行中证据，结束或停止后的空结果保持中性提示', () => {
  const card = read('src/workspace/ToolResultCard.tsx');
  assert.match(card, /尚无结果/);
  assert.doesNotMatch(card, /工具执行中| · 执行中/);
});

test('低频增删只在全局智能体管理，不保留中间成员页', () => {
  const screen = read('src/workspace/WorkspaceScreen.tsx');
  assert.doesNotMatch(screen, /MemberDirectory|inbox|drawerOpen|GroupInfo/);
  assert.equal(existsSync(new URL('src/group/GroupInfo.tsx', root)), false);
  assert.match(read('src/workspace/AgentManagement.tsx'), /label="添加智能体".*busy={creating}/);
  assert.match(screen, /<AgentManagement members={groupMembers}/);
});

test('放弃 failed 暂存须二次确认并回读权威历史，当前草稿保持独立', () => {
  const chat = read('src/workspace/ConversationView.tsx');
  assert.match(chat, /pending\?\.status === 'failed'/);
  assert.match(chat, /discardTarget === pending\.messageId/);
  assert.match(chat, /sessions\.discardFailedSubmission\(agentId, session\.epoch, pending\.messageId\)\) conversation\.reload\(\)/);
  assert.match(chat, /label="取消放弃未发送消息"/);
  assert.match(chat, /sessions\.restorePendingSubmissionToDraft\(agentId\)/);
});

test('启动直达群聊，点击和滑动共用同一个受保护切换入口', () => {
  const source = read('src/workspace/WorkspaceScreen.tsx');
  assert.match(source.split('function WorkspaceContent')[1], /useState<WorkspacePage>\('group'\)/);
  assert.match(source, /const selectAvatar = .*openGroup\(\) : select\(id\)/);
  assert.match(source, /const next = adjacentAvatar\(targets, selectedAvatar, direction\)/);
  assert.match(source, /const select = .*changeAgent/);
});

test('长按直接打开智能体设置，不再区分主页或保留发消息中间动作', () => {
  const source = read('src/workspace/WorkspaceScreen.tsx');
  const agent = read('src/workspace/AgentPage.tsx');
  assert.doesNotMatch(source, /agentView|openProfile|workspace-open-agent-settings/);
  assert.match(source, /<AgentPage agentId={focusedAgentId}/);
  assert.doesNotMatch(agent, /onChat|memberDescription/);
  assert.match(agent, /home: '智能体设置'/);
  assert.match(source, /backLabel="返回智能体设置"/);
});

test('新闻按主视图偏好进入，阅读保留头像栏与现场，切视图只在设置', () => {
  const source = read('src/workspace/WorkspaceScreen.tsx');
  const profile = read('src/workspace/AgentPage.tsx');
  const reader = read('src/workspace/NewsPage.tsx');
  assert.match(source, /setPage\(conversation \? 'chat' : homePage\(id\)\)/);
  assert.match(source, /page === 'chat' \|\| page === 'group' \|\| page === 'news'\) && <AgentAvatarStrip/);
  assert.match(source, /<NewsPage store={news} visible={page === 'news'}/);
  assert.match(source, /await views.save\(focusedAgentId, view\)/);
  assert.match(source, /setChatReturn\(agentHomePage\(focusedAgentId, view\)\)/);
  assert.match(profile, /agentId === 'news-internal'/);
  assert.match(profile, /testID="agent-main-view"/);
  assert.match(profile, /accessibilityRole="radio"/);
  assert.doesNotMatch(profile, /onReadNews/);
  assert.doesNotMatch(reader, /label="返回新闻设置"/);
  assert.match(reader, /visible && menu && menuArticle/);
});

test('智能体维护归智能体子页，全局设置来自群组信息，会话面板只处理当前执行', () => {
  const screen = read('src/workspace/WorkspaceScreen.tsx');
  const panel = read('src/workspace/SessionPanel.tsx');
  assert.match(screen, /const openGlobalSettings =/);
  assert.match(screen, /<AgentHeader title="全局设置"/);
  assert.match(screen, /page === 'agent'\) \{\s*otherPage = <AgentPage/);
  assert.match(screen, /const maintenance =/);
  const settings = screen.slice(screen.indexOf('function SettingsPage'), screen.indexOf('function DisconnectedWorkspace'));
  assert.doesNotMatch(settings, /onReset|RotateCcw|重置当前会话/);
  assert.doesNotMatch(panel, /onReset|onDelete|FilesScreen|工作区/);
  assert.match(panel, /<View style=\{styles\.column\}>\s*<View style=\{styles\.tablistWrap\}>/);
});

test('独立原生重置对话框固定目标，取消无提交，断线和未明结果锁定重提', () => {
  const screen = read('src/workspace/WorkspaceScreen.tsx');
  const dialog = read('src/workspace/ResetSessionDialog.tsx');
  assert.match(screen, /setResetTarget\(focusedAgentId\)/);
  assert.match(screen, /resetTarget && <ResetSessionDialog key=\{resetTarget\} agentId=\{resetTarget\} available=\{!!connection\?\.enabled\}/);
  assert.match(screen, /const reset = async \(id: string, clearSchedules: boolean\) => \{\s*if \(!connection\?\.enabled\)/);
  assert.match(screen, /sessions\.resetAgent\(id, clearSchedules\)/);
  assert.match(screen, /setResetTarget\(undefined\); setResetError\(undefined\); setSessionOpen\(false\)/);
  assert.match(dialog, /const \[clearSchedules, setClearSchedules\] = useState\(false\)/);
  assert.match(dialog, /<Modal visible transparent animationType=\{reducedMotion \? 'none' : 'fade'\} onRequestClose=\{cancel\}/);
  assert.match(dialog, /<Card style=\{styles\.dialog\} tone="warning" accessibilityViewIsModal>/);
  assert.match(dialog, /目标智能体：\{agentId === MAIN_AGENT \? '主智能体' : agentId\}/);
  assert.match(dialog, /const cancel = \(\) => \{ if \(!busy\) onCancel\(\); \}/);
  assert.match(dialog, /if \(disabled\) return;\s*setSubmitting\(true\);\s*try \{ await onConfirm\(agentId, clearSchedules\)/);
  assert.match(dialog, /const busy = submitting \|\| session\.resetting/);
  assert.match(dialog, /busy \|\| !available \|\| session\.resetUncertain \|\| !sessions\.canWrite\(agentId\) \|\| sessions\.hasSettingsWrite\(agentId\)/);
  assert.match(dialog, /accessibilityState=\{\{ checked: clearSchedules, disabled: busy \}\}/);
  assert.match(dialog, /session\.resetUncertain && <Text accessibilityRole="alert"/);
  assert.match(dialog, /!!error && <Text accessibilityRole="alert"/);
  assert.match(dialog, /<ActionButton label="取消重置会话"[^\n]*disabled=\{busy\} onPress=\{cancel\}/);
});
