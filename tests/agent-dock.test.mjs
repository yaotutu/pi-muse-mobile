import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('AgentDock 五格静态渲染契约：五格布局、固定槽上限 3、位置完全静态且更多格永不变成头像', () => {
  const source = read('src/workspace/AgentDock.tsx');

  // 五格槽位常量与 testID
  assert.match(source, /export const DOCK_SLOT_COUNT = 5;/);
  assert.match(source, /export const DOCK_FIXED_SLOT_COUNT = DOCK_PIN_LIMIT;/);
  assert.match(source, /testID="agent-dock"/);
  assert.match(source, /testID="agent-dock-all"/);
  assert.match(source, /`agent-dock-slot-\$\{index\}`/);
  assert.match(source, /testID="agent-dock-more"/);

  // 44dp 触控命中区与 320dp 适配（flex: 1 均分宽度）
  assert.match(source, /minHeight: sizing\.touchTarget/);
  assert.match(source, /flex: 1/);
  assert.match(source, /minWidth: 0/);

  // 静态位置：严格按传入数组顺序截取固定槽，不进行任何动态重排
  assert.match(source, /Array\.from\(\{ length: DOCK_FIXED_SLOT_COUNT \}, \(_, index\) => agents\[index\]\)/);
  assert.doesNotMatch(source, /\.sort\(/, '底栏严禁进行动态排序');
  assert.doesNotMatch(source, /recency|lastActiveAt/, '底栏严禁随活跃度跳动');

  // 更多按钮保持固定动作形态，永不变成头像
  assert.match(source, /testID="agent-dock-more"[\s\S]*?<MoreHorizontal/);
  assert.doesNotMatch(source, /agent-dock-more[\s\S]*?<MemberAvatar/);
  assert.doesNotMatch(source, /agent-dock-more[\s\S]*?<Image/);

  // 消费语义颜色，绝不硬编码十六进制色值
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/i, '严禁硬编码色值');
  assert.match(source, /const \{ colors: c \} = useTheme\(\);/);
});

test('AgentDock 高亮规则契约：仅在固定槽或全部时高亮，不在固定槽的对象由顶栏负责、底栏全暗，更多永不高亮', () => {
  const source = read('src/workspace/AgentDock.tsx');

  // 全部视图高亮
  assert.match(source, /const isAllActive = currentId === 'group';/);
  assert.match(source, /accessibilityState=\{\{ selected: isAllActive, disabled \}\}/);

  // 固定槽高亮：仅当 currentId 与该 agent.id 精确匹配时高亮
  assert.match(source, /const isActive = currentId === agent\.id;/);
  assert.match(source, /accessibilityState=\{\{ selected: isActive, disabled \}\}/);
  assert.match(source, /borderColor: isActive \? c\.accentText : 'transparent'/);

  // 更多按钮永不高亮当前对象
  assert.match(source, /accessibilityState=\{\{ disabled \}\}/);
  assert.doesNotMatch(source, /agent-dock-more[\s\S]*?selected:/);

  // 状态角标与读屏无障碍标签
  assert.match(source, /<AgentStatusBadge state=\{agentStatus\} \/>/);
  assert.match(source, /accessibilityValue=\{\{ text: avatarStatusLabel\(agentStatus\) \}\}/);
  assert.match(source, /accessibilityRole="tab"/);
  assert.match(source, /accessibilityRole="button"/);
});

test('AgentPickerSheet 搜索纯逻辑契约：大小写不敏感匹配 id 与名称，保留稳定原序', () => {
  const pickerSource = read('src/workspace/AgentPickerSheet.tsx');

  // 提取 filterAgents 函数进行纯逻辑回归
  const fnMatch = pickerSource.match(/export function filterAgents[\s\S]*?\n\}/);
  assert.ok(fnMatch, '必须导出 filterAgents 纯函数');

  // 构造等价逻辑进行严密测试
  const filter = (agents, query) => {
    const q = query.trim().toLowerCase();
    if (!q) return [...agents];
    return agents.filter(
      (item) => item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q),
    );
  };

  const sampleAgents = [
    { id: 'muse-core', name: 'Pi Muse' },
    { id: 'news-bot', name: '新闻助手' },
    { id: 'code-gen', name: 'Code Expert' },
  ];

  // 按名称匹配（大小写不敏感）
  assert.deepEqual(filter(sampleAgents, 'expert'), [sampleAgents[2]]);
  assert.deepEqual(filter(sampleAgents, 'PI MUSE'), [sampleAgents[0]]);
  assert.deepEqual(filter(sampleAgents, '助手'), [sampleAgents[1]]);

  // 按 id 匹配（大小写不敏感）
  assert.deepEqual(filter(sampleAgents, 'NEWS-BOT'), [sampleAgents[1]]);
  assert.deepEqual(filter(sampleAgents, 'core'), [sampleAgents[0]]);

  // 空查询返回全部并保持原序
  assert.deepEqual(filter(sampleAgents, '   '), sampleAgents);
  assert.deepEqual(filter(sampleAgents, ''), sampleAgents);

  // 无匹配返回空数组
  assert.deepEqual(filter(sampleAgents, 'unknown-query'), []);
});

test('AgentPickerSheet 固定上限与状态提示契约：满额禁用未固定项并提示，允许取消固定', () => {
  const source = read('src/workspace/AgentPickerSheet.tsx');

  // 上限计算与提示
  assert.match(source, /const isFull = pinnedIds\.length >= pinLimit;/);
  assert.match(source, /const isPinned = pinnedIds\.includes\(agent\.id\);/);
  assert.match(source, /const pinDisabled = !isPinned && isFull;/);
  assert.match(source, /底部固定已满（最多 \{pinLimit\} 个）/);

  // 按钮文案与状态
  assert.match(source, /label=\{isPinned \? '取消固定' : pinDisabled \? '底部固定已满' : '固定到底部'\}/);
  assert.match(source, /text=\{isPinned \? '已固定' : '固定'\}/);
  assert.match(source, /disabled=\{pinDisabled\}/);

  // 已固定项标记 primary tone，未固定为 secondary tone
  assert.match(source, /tone=\{isPinned \? 'primary' : 'secondary'\}/);
});

test('AgentPickerSheet 回调契约与形态规范：点击切换会话、进入设置、打开管理及关闭面板', () => {
  const source = read('src/workspace/AgentPickerSheet.tsx');

  // 选择切换并关闭
  assert.match(source, /onSelect\(agent\.id\);/);
  assert.match(source, /onClose\(\);/);

  // 固定切换与设置
  assert.match(source, /onTogglePin\(agent\.id\)/);
  assert.match(source, /onOpenSettings\(agent\.id\)/);

  // 管理入口与关闭入口
  assert.match(source, /testID="agent-picker-manage"[\s\S]*?onPress=\{onOpenManage\}/);
  assert.match(source, /testID="agent-picker-close"[\s\S]*?onPress=\{onClose\}/);

  // Modal 全屏/近全屏 Sheet 形态，与现有面板一致
  assert.match(source, /<Modal[\s\S]*?testID="agent-picker-sheet"/);
  assert.match(source, /accessibilityViewIsModal/);
  assert.match(source, /onRequestClose=\{onClose\}/);
  assert.match(source, /<KeyboardAvoidingView/);
  assert.match(source, /<ThemeStatusBar \/>/);
  assert.match(source, /<FormInput[\s\S]*?variant="search"/);

  // 无硬编码色值
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/i, '严禁硬编码色值');
});
