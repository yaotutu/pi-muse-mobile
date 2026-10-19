import { ApiError } from '../../src/api/errors';
import type { ThreadSkill } from '../../src/api/types';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export const BUILT_IN_SKILLS: readonly { name: string; description: string; defaultEnabled: boolean }[] = [
  { name: 'cron', description: '创建定时任务', defaultEnabled: true },
  { name: 'monitor', description: '创建监控', defaultEnabled: true },
  { name: 'task', description: '创建后台任务', defaultEnabled: true },
  { name: 'goal', description: '创建目标', defaultEnabled: true },
  { name: 'memory', description: '记住偏好或上下文', defaultEnabled: true },
  { name: 'web', description: '网页搜索', defaultEnabled: true },
  { name: 'write', description: '保存文件', defaultEnabled: true },
];
export const INSTRUCTIONS_LIMIT = 20_000;
type Settings = { instructions: string; overrides: Record<string, boolean> };

/** 演示配置与聊天 revision 分开；只读默认值不创建会话。 */
export class ThreadSettings {
  private records = new Map<string, Settings>();
  private taskSnapshots = new Map<string, { name: string; enabled: boolean }[]>();

  private require(id: string): Settings {
    let record = this.records.get(id);
    if (!record) { record = { instructions: '', overrides: {} }; this.records.set(id, record); }
    return record;
  }
  getInstructions(id: string) { return { instructions: this.records.get(id)?.instructions ?? '' }; }
  saveInstructions(id: string, text: string) {
    if (typeof text !== 'string' || text.length > INSTRUCTIONS_LIMIT) throw new ApiError(400, `规则长度超过 ${INSTRUCTIONS_LIMIT} 字符上限或格式不正确`);
    this.require(id).instructions = text.trim();
    return this.getInstructions(id);
  }
  getSkills(id: string): { skills: ThreadSkill[] } {
    const snapshot = id.startsWith('task-') ? this.taskSnapshots.get(id.slice('task-'.length)) : undefined;
    const overrides = snapshot ? Object.fromEntries(snapshot.map((skill) => [skill.name, skill.enabled])) : this.records.get(id)?.overrides;
    return { skills: BUILT_IN_SKILLS.map((skill) => ({ ...skill, enabled: overrides?.[skill.name] ?? skill.defaultEnabled })) };
  }
  saveSkills(id: string, overrides: Record<string, boolean>) {
    const names = new Set(BUILT_IN_SKILLS.map((skill) => skill.name));
    for (const [name, enabled] of Object.entries(overrides)) {
      if (!names.has(name)) throw new ApiError(400, `未知技能：${name}`);
      if (typeof enabled !== 'boolean') throw new ApiError(400, `技能值必须为布尔：${name}`);
    }
    this.require(id).overrides = { ...overrides };
    return this.getSkills(id);
  }
  isSkillEnabled(id: string, name: string) { return this.getSkills(id).skills.find((skill) => skill.name === name)?.enabled ?? false; }
  snapshotSkills(id: string) { return this.getSkills(id).skills.map(({ name, enabled }) => ({ name, enabled })); }
  storeTaskSnapshot(id: string, snapshot: { name: string; enabled: boolean }[]) { this.taskSnapshots.set(id, copy(snapshot)); }
  clearTaskSnapshot(id: string) { this.taskSnapshots.delete(id); }
  clear(id: string) { this.records.delete(id); }
}
