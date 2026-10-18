/**
 * 预览数据仅存于内存，与业务 API、持久化和正式会话完全隔离。
 * 每次创建都返回新的嵌套数据；reducer 不得原地改写已有会话或跨会话审批。
 */

export type PreviewTab = 'activity' | 'approvals' | 'workspace' | 'history';
export type PreviewPage = 'chat' | 'activity' | 'goals' | 'apps';

export interface PreviewMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  image?: 'characters';
}

export interface PreviewActivity {
  id: string;
  title: string;
  detail: string;
  time: string;
  status: 'running' | 'done';
}

export interface PreviewApproval {
  id: string;
  title: string;
  detail: string;
  status: 'pending' | 'approved' | 'denied';
}

export interface PreviewHistory {
  id: string;
  title: string;
  detail: string;
  time: string;
}

export interface PreviewFile {
  id: string;
  name: string;
  detail: string;
}

/** 单个会话视图：草稿、消息流、活动、审批、历史、文件均归属于此会话。 */
export interface PreviewThread {
  id: string;
  name: string;
  status: string;
  messages: PreviewMessage[];
  activities: PreviewActivity[];
  approvals: PreviewApproval[];
  history: PreviewHistory[];
  files: PreviewFile[];
  draft: string;
  running: boolean;
}

export interface PreviewState {
  threads: PreviewThread[];
  currentThreadId: string;
  drawerOpen: boolean;
  sessionOpen: boolean;
  sessionTab: PreviewTab;
  page: PreviewPage;
  nextId: number;
}

export const MAIN_PREVIEW_THREAD = 'preview-main';

export type PreviewAction =
  | { type: 'open-drawer' }
  | { type: 'close-drawer' }
  | { type: 'select-thread'; id: string }
  | { type: 'create-thread' }
  | { type: 'open-session' }
  | { type: 'close-session' }
  | { type: 'set-session-tab'; tab: PreviewTab }
  | { type: 'set-page'; page: PreviewPage }
  | { type: 'set-draft'; text: string }
  | { type: 'send' }
  | { type: 'stop' }
  | { type: 'complete'; threadId: string }
  | { type: 'decide'; id: string; decision: 'approved' | 'denied' };

// 深拷贝 fixture：JSON 序列化足够，结构都是 plain data。
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function previewMainThread(): PreviewThread {
  return {
    id: MAIN_PREVIEW_THREAD,
    name: 'Pi Muse',
    status: '调研生态圈',
    running: true,
    draft: '',
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        text: '欢迎使用 Pi Muse 本地预览（示例数据，未连接服务端）。左侧按钮可切换/新建会话；点击中央头像可打开当前会话面板（动态/审批/工作区/历史 4 个 Tab）。',
        image: 'characters',
      },
      {
        id: 'm2',
        role: 'user',
        text: '调研一下 Pi 生态圈',
      },
    ],
    activities: [
      {
        id: 'a1',
        title: '调研 Pi 生态圈',
        detail: '深入调研 Pi 生态圈及其发展',
        time: '7:44pm',
        status: 'running',
      },
    ],
    approvals: [
      {
        id: 'ap1',
        title: '读取示例知识库',
        detail: '加载预置示例知识库用于截图演示',
        status: 'pending',
      },
      {
        id: 'ap2',
        title: '调用示例工具',
        detail: '允许 Pi Muse 在本地演示中调用示例工具',
        status: 'pending',
      },
    ],
    history: [
      {
        id: 'h1',
        title: '今日调研启动',
        detail: '会话开始调研 Pi 生态圈',
        time: '7:44pm',
      },
    ],
    files: [
      { id: 'f1', name: 'ecosystem.md', detail: 'Pi 生态圈概览（示例）' },
      { id: 'f2', name: 'roadmap.md', detail: 'Pi 生态圈路线图（示例）' },
    ],
  };
}

function previewSecondThread(): PreviewThread {
  return {
    id: 'preview-travel',
    name: '旅行计划',
    status: '示例数据',
    running: false,
    draft: '',
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        text: '这是本地预览的另一个示例会话（与主会话内容不同），可自由尝试 UI。',
      },
      {
        id: 'm2',
        role: 'user',
        text: '列一份周末出行清单',
      },
      {
        id: 'm3',
        role: 'assistant',
        text: '好的，这里给出一份示例清单（本地演示数据）：背包、水壶、移动电源、充电线、雨伞、身份证件。',
      },
    ],
    activities: [],
    approvals: [
      {
        id: 'ap1',
        title: '读取示例日历',
        detail: '授权读取示例日历数据',
        status: 'pending',
      },
    ],
    history: [
      {
        id: 'h1',
        title: '周末出行清单',
        detail: '示例会话创建于本地预览',
        time: '5:12pm',
      },
    ],
    files: [
      { id: 'f1', name: 'packing-list.md', detail: '周末出行清单（示例）' },
    ],
  };
}

/**
 * 创建初始预览状态：每次返回全新深拷贝，互不污染。
 * 起始 nextId 选 1000，防止与 fixture 内现有 ID 冲突。
 */
export function createPreviewState(): PreviewState {
  const threads: PreviewThread[] = [
    clone(previewMainThread()),
    clone(previewSecondThread()),
  ];
  return {
    threads,
    currentThreadId: MAIN_PREVIEW_THREAD,
    drawerOpen: false,
    sessionOpen: false,
    sessionTab: 'activity',
    page: 'chat',
    nextId: 1000,
  };
}

export function previewReducer(state: PreviewState, action: PreviewAction): PreviewState {
  switch (action.type) {
    case 'open-drawer':
      // 互斥：打开抽屉时强制收起 session，保证主屏层只有一项保持可见。
      return { ...state, drawerOpen: true, sessionOpen: false };

    case 'close-drawer':
      // 显式关闭抽屉，不影响 session；供 UI 直接收抽屉用。
      return { ...state, drawerOpen: false };

    case 'select-thread': {
      // 未知 ID no-op：不偷偷新建或重置。
      const exists = state.threads.some((t) => t.id === action.id);
      if (!exists) return state;
      // 同一线程再次选中：只收起 drawer，不重置 messages/draft。
      if (action.id === state.currentThreadId) {
        return { ...state, drawerOpen: false };
      }
      // 切换会话：收 drawer、收 session、回 chat，保证主屏可见。threads 数组不动。
      return {
        ...state,
        currentThreadId: action.id,
        drawerOpen: false,
        sessionOpen: false,
        page: 'chat',
      };
    }

    case 'create-thread': {
      const newId = `preview-${state.nextId}`;
      const fresh: PreviewThread = {
        id: newId,
        name: '新会话',
        status: '示例数据',
        running: false,
        draft: '',
        messages: [],
        activities: [],
        approvals: [],
        history: [],
        files: [],
      };
      // 新建会话：收 drawer、收 session、回 chat；新线程的 messages/draft 从空起步，不影响其它会话。
      return {
        ...state,
        threads: [...state.threads, clone(fresh)],
        currentThreadId: newId,
        drawerOpen: false,
        sessionOpen: false,
        page: 'chat',
        nextId: state.nextId + 1,
      };
    }

    case 'open-session':
      // 打开头像面板必须关闭左侧抽屉；其它字段保持不动。
      return { ...state, sessionOpen: true, drawerOpen: false };

    case 'close-session':
      return { ...state, sessionOpen: false };

    case 'set-session-tab':
      // 仅切换 Avatar 内部 Tab，不应触发会话切换或关掉面板。
      return { ...state, sessionTab: action.tab };

    case 'set-page':
      // 页面切换与头像面板互斥覆盖：切到其它 tab 时收起 session，保证主屏可见。
      return { ...state, page: action.page, sessionOpen: false };

    case 'set-draft':
      return {
        ...state,
        threads: state.threads.map((t) =>
          t.id === state.currentThreadId ? { ...t, draft: action.text } : t,
        ),
      };

    case 'send': {
      // 守卫：当前非 running 且 draft trim 非空；不满足任一条件直接 no-op。
      const current = state.threads.find((t) => t.id === state.currentThreadId);
      if (!current || current.running) return state;
      const text = current.draft.trim();
      if (text.length === 0) return state;
      const userMsg: PreviewMessage = {
        id: `msg-${state.nextId}`,
        role: 'user',
        text,
      };
      const newActivity: PreviewActivity = {
        id: `act-${state.nextId + 1}`,
        title: text,
        detail: `正在处理：${text}`,
        time: '刚刚',
        status: 'running',
      };
      const newHistory: PreviewHistory = {
        id: `hist-${state.nextId + 2}`,
        title: text,
        detail: '任务开始处理（示例）',
        time: '刚刚',
      };
      return {
        ...state,
        nextId: state.nextId + 3,
        threads: state.threads.map((t) =>
          t.id === state.currentThreadId
            ? {
                ...t,
                running: true,
                draft: '',
                messages: [...t.messages, userMsg],
                activities: [...t.activities, newActivity],
                history: [...t.history, newHistory],
              }
            : t,
        ),
      };
    }

    case 'stop': {
      // 仅作用于当前线程；存在 running 活动则标记 done 并补充说明。
      const current = state.threads.find((t) => t.id === state.currentThreadId);
      if (!current) return state;
      const hasRunningActivity = current.activities.some((a) => a.status === 'running');
      if (!current.running && !hasRunningActivity) return state;
      return {
        ...state,
        threads: state.threads.map((t) =>
          t.id === state.currentThreadId
            ? {
                ...t,
                running: false,
                activities: t.activities.map((a) =>
                  a.status === 'running'
                    ? { ...a, status: 'done', detail: `${a.detail}（已手动停止）` }
                    : a,
                ),
              }
            : t,
        ),
      };
    }

    case 'complete': {
      // 显式 threadId：仅对仍在 running 的线程追加示例回复 + 活动收尾，其它情况 no-op。
      const target = state.threads.find((t) => t.id === action.threadId);
      if (!target || !target.running) return state;
      const assistantReply: PreviewMessage = {
        id: `msg-${state.nextId}`,
        role: 'assistant',
        text: '（示例回复）这是 Pi Muse 本地预览的占位文本，可截图演示，未连接服务端。',
      };
      return {
        ...state,
        nextId: state.nextId + 1,
        threads: state.threads.map((t) =>
          t.id === action.threadId
            ? {
                ...t,
                running: false,
                messages: [...t.messages, assistantReply],
                activities: t.activities.map((a) =>
                  a.status === 'running' ? { ...a, status: 'done' } : a,
                ),
              }
            : t,
        ),
      };
    }

    case 'decide': {
      // 仅当前线程的对应 pending approval 会被改写；其它线程、其它 ID、已决策项都保持不变。
      const current = state.threads.find((t) => t.id === state.currentThreadId);
      if (!current) return state;
      const exists = current.approvals.some((a) => a.id === action.id && a.status === 'pending');
      if (!exists) return state;
      return {
        ...state,
        threads: state.threads.map((t) =>
          t.id === state.currentThreadId
            ? {
                ...t,
                approvals: t.approvals.map((a) =>
                  a.id === action.id && a.status === 'pending'
                    ? { ...a, status: action.decision }
                    : a,
                ),
              }
            : t,
        ),
      };
    }
  }
}
