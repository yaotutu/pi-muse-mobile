import { useEffect, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { spacing, workspaceTheme } from '../ui/tokens';
import type { RoutingSettingsStore } from './routing-settings-store';

const { typography: t, radius: r } = workspaceTheme;

/** 与私有指令分开编辑，只向路由公开职责，不扩大该智能体的工具或文件权限。 */
export function CapabilityPanel({ store, agentId }: { store: RoutingSettingsStore; agentId: string }) {
  const state = useSyncExternalStore(store.subscribe, () => store.capability(agentId), () => store.capability(agentId));
  const { colors: c } = useTheme();
  useEffect(() => { void store.reloadCapability(agentId, true); }, [store, agentId]);
  return <View style={{ gap: spacing[12] }}>
    <Text style={{ ...t.detail, color: c.muted }}>告诉组内路由“什么事应该交给我”。只公开能力描述，不读取私聊、记忆或专属规则。</Text>
    {state.draft && <FormInput accessibilityLabel="公开能力描述" multiline maxLength={1000} value={state.draft.capability} editable={!state.saving}
      onChangeText={(capability) => store.editCapability({ agentId, capability })} placeholder="擅长处理哪些任务，哪些事情不负责" />}
    <SettingsFeedback {...state} />
    <View style={{ flexDirection: 'row', gap: spacing[8] }}>
      <ActionButton label="保存公开能力" text="保存" tone="primary" disabled={!state.draft || state.loading || state.saving || state.needsReadback} onPress={() => void store.saveCapability(agentId)} />
      <ActionButton label="核对公开能力" text="刷新核对" disabled={state.saving || state.loading} onPress={() => void store.reloadCapability(agentId)} />
    </View>
  </View>;
}

export function GroupSettingsPanel({ store, members }: { store: RoutingSettingsStore; members: { id: string; name: string }[] }) {
  const state = useSyncExternalStore(store.subscribe, store.group, store.group);
  const { colors: c } = useTheme(); const draft = state.draft;
  useEffect(() => { void store.reloadGroup(true); }, [store]);
  const edit = (patch: Partial<NonNullable<typeof draft>>) => { if (draft) store.editGroup({ ...draft, ...patch }); };
  return <View style={{ gap: spacing[16] }}>
    <Text style={{ ...t.detail, color: c.muted }}>显式 @ 优先；明确且唯一匹配就直接转交；模糊或多匹配先询问；普通聊天由默认回复者处理。当前配置一个默认组，组名不改变「全部」入口名称。</Text>
    {draft && <>
      <FormInput accessibilityLabel="组名称" maxLength={80} value={draft.name} editable={!state.saving} onChangeText={(name) => edit({ name })} placeholder="组名称" />
      <FormInput accessibilityLabel="组用途" multiline maxLength={1000} value={draft.purpose} editable={!state.saving} onChangeText={(purpose) => edit({ purpose })} placeholder="这个组用于什么" />
      <Text style={{ ...t.itemTitle, color: c.ink }}>成员与默认回复者</Text>
      <Text style={{ ...t.caption, color: c.muted }}>移出仅停止新的组投递，不删除历史。默认回复者不能直接移出，请先更换默认。</Text>
      <View style={{ borderRadius: r.card, overflow: 'hidden', backgroundColor: c.surface }}>
        {members.map((member) => {
          const included = draft.memberIds.includes(member.id); const isDefault = draft.defaultAgentId === member.id;
          return <View key={member.id} style={{ paddingHorizontal: spacing[16], flexDirection: 'row', alignItems: 'center', gap: spacing[8] }}>
            <Pressable accessibilityRole="checkbox" accessibilityLabel={`组成员${member.name}`} accessibilityState={{ checked: included, disabled: state.saving || isDefault }} disabled={state.saving || isDefault}
              onPress={() => edit({ memberIds: included ? draft.memberIds.filter((id) => id !== member.id) : [...draft.memberIds, member.id] })}
              style={{ flex: 1, minHeight: 52, justifyContent: 'center' }}><Text style={{ ...t.detail, color: included ? c.ink : c.muted }}>{included ? '✓ ' : '＋ '}{member.name}</Text></Pressable>
            {included && <Pressable accessibilityRole="radio" accessibilityLabel={`默认回复者${member.name}`} accessibilityState={{ checked: isDefault, disabled: state.saving }} disabled={state.saving}
              onPress={() => edit({ defaultAgentId: member.id })} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ ...t.caption, color: isDefault ? c.accentText : c.muted }}>{isDefault ? '默认回复' : '设为默认'}</Text></Pressable>}
          </View>;
        })}
      </View>
      <Text style={{ ...t.itemTitle, color: c.ink }}>组内协作说明</Text>
      <FormInput accessibilityLabel="组内协作说明" multiline maxLength={4000} value={draft.instructions} editable={!state.saving} onChangeText={(instructions) => edit({ instructions })} placeholder="仅用于当前组，不替代成员自己的指令" />
    </>}
    <SettingsFeedback {...state} />
    <View style={{ flexDirection: 'row', gap: spacing[8] }}>
      <ActionButton label="保存组协作设置" text="保存" tone="primary" disabled={!draft?.name.trim() || state.loading || state.saving || state.needsReadback} onPress={() => void store.saveGroup()} />
      <ActionButton label="核对组协作设置" text="刷新核对" disabled={state.loading || state.saving} onPress={() => void store.reloadGroup()} />
    </View>
  </View>;
}
function SettingsFeedback({ loading, saving, error, notice }: { loading: boolean; saving: boolean; error?: string; notice?: string }) {
  const { colors: c } = useTheme();
  return <>{(loading || saving) && <Text style={{ ...t.caption, color: c.muted }}>{saving ? '正在保存…' : '正在读取…'}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ ...t.caption, color: c.danger }}>{error}</Text>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={{ ...t.caption, color: c.muted }}>{notice}</Text>}</>;
}
