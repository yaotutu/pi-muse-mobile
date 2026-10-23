import { fileScope } from './file-scope';
import { parseToolRecord, toolResultContent, toolTextField, toolOutcome } from './tool-presentation';
import { safeMessageUrl } from './message-links';

export type ToolDisplay = {
  kind: 'search' | 'web' | 'weather' | 'time' | 'files' | 'memory' | 'schedule' | 'goal' | 'monitor' | 'subagent' | 'generic';
  title: string;
  status: 'pending' | 'finished' | 'failed';
  summary?: string;
  sources?: { title: string; url: string }[];
  scope?: string;
};

const toolMeta: Record<string, { kind: ToolDisplay['kind']; title: string }> = {
  search_web: { kind: 'search', title: '网页搜索' },
  web_fetch: { kind: 'web', title: '网页读取' },
  get_weather: { kind: 'weather', title: '天气查询' },
  currentTime: { kind: 'time', title: '当前时间' },
  read: { kind: 'files', title: '读取文件' },
  grep: { kind: 'files', title: '搜索文件' },
  find: { kind: 'files', title: '查找文件' },
  ls: { kind: 'files', title: '文件列表' },
  write: { kind: 'files', title: '写入文件' },
  edit: { kind: 'files', title: '编辑文件' },
  memory: { kind: 'memory', title: '记忆' },
  memory_search: { kind: 'memory', title: '记忆检索' },
  schedule: { kind: 'schedule', title: '提醒' },
  goal: { kind: 'goal', title: '目标' },
  monitor: { kind: 'monitor', title: '网页监控' },
  subagent: { kind: 'subagent', title: '子代理' },
  activity: { kind: 'generic', title: '工作登记' },
  instructions: { kind: 'generic', title: '会话指令' },
};

const projectedFailureTexts = new Set([
  '工具执行失败',
  'Access denied: path is outside the documents directory.',
  'Access denied: path is outside the documents directory or contains a symlink.',
]);

function searchSources(raw: string | undefined): { title: string; url: string }[] {
  const result = parseToolRecord(raw);
  if (!Array.isArray(result.results)) return [];
  return result.results.slice(0, 10).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const url = typeof record.url === 'string' ? safeMessageUrl(record.url) : undefined;
    if (!url) return [];
    const title = record.title === null ? url : typeof record.title === 'string' ? record.title : undefined;
    return title === undefined ? [] : [{ title, url }];
  });
}

function failed(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return projectedFailureTexts.has(raw) || toolOutcome(raw) === 'failed';
}

/** 只整理服务端已投影的可见内容；pending 表示尚无结果，不冒充运行状态。 */
export function describeTool(name: string, args?: string, result?: string): ToolDisplay {
  const meta = toolMeta[name] ?? { kind: 'generic' as const, title: '工具调用' };
  const scope = fileScope(toolTextField(parseToolRecord(args), 'path', 'file'));
  const { summary, failure, fallback } = toolResultContent(result);
  const display: ToolDisplay = {
    kind: meta.kind,
    title: meta.title,
    status: result === undefined ? 'pending' : failed(result) ? 'failed' : 'finished',
  };
  if (scope) display.scope = scope;
  if (name === 'search_web') {
    const sources = searchSources(result);
    if (sources.length) display.sources = sources;
    if (failure) display.summary = failure;
    return display;
  }
  const projectedSummary = failure || summary || fallback;
  if (projectedSummary) display.summary = projectedSummary;
  return display;
}
