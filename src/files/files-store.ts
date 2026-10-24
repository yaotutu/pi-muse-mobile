import { ApiError, isRequestCancelled } from '../api/errors';
import {
  MAX_WORKSPACE_TEXT_BYTES,
  assertWorkspaceTextForWrite,
  validateWorkspaceReadPath,
  validateWorkspaceSpaceId,
  validateWorkspaceWritePath,
} from './contracts';
import type {
  FilesClient,
  FilesEditor,
  FilesSavePreview,
  FilesSnapshot,
  FilesUncertainOperation,
  FilesWriteKind,
  WorkspaceFileDetail,
  WorkspaceFileSelector,
  WorkspaceFileScope,
  WorkspaceListEntry,
} from './types';

const initial = (): FilesSnapshot => ({
  scope: 'space',
  directoryPath: '.',
  entries: [],
  loaded: false,
  loading: false,
  stale: true,
  detailLoading: false,
  detailStale: true,
  missing: false,
  writing: false,
  uncertain: false,
  reviewed: false,
  verificationMissing: false,
});

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const uncertainWrite = (error: unknown): boolean =>
  isRequestCancelled(error) || !(error instanceof ApiError) ||
  error.status === 0 || error.status === 408 || error.status >= 500;

export const parentWorkspacePath = (path: string): string => {
  const validated = validateWorkspaceReadPath(path);
  if (validated === '.') return '.';
  if (!validated.includes('/')) return '.';
  const parent = validated.slice(0, validated.lastIndexOf('/'));
  return parent || '.';
};

export const childWorkspacePath = (directory: string, name: string): string => {
  validateWorkspaceReadPath(directory);
  if (name.includes('/') || name.length === 0) throw new ApiError(400, '文件名不能为空且不能包含路径分隔符');
  return directory === '.' ? name : `${directory}/${name}`;
};

const sortEntries = (entries: readonly WorkspaceListEntry[]): WorkspaceListEntry[] =>
  [...entries].sort((left, right) =>
    left.kind === right.kind
      ? (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
      : left.kind === 'directory' ? -1 : 1);

/**
 * 工作区文件连接内状态。没有专属 SSE/轮询；只在打开、前台恢复、成功写后与手动刷新读取。
 * 目录/详情请求按选择器和路径隔离，读取失败保留旧列表；写入结果未明必须只读核对后人工解锁。
 */
export type { FilesSnapshot };

export class FilesStore {
  private state = initial();
  private listeners = new Set<() => void>();
  private active = false;
  private visible = false;
  private disposed = false;
  private listGeneration = 0;
  private detailGeneration = 0;
  private writeGeneration = 0;
  private listController?: AbortController;
  private detailController?: AbortController;
  private writeController?: AbortController;
  private activeWriteOperation?: FilesUncertainOperation;
  private pendingSpaceId?: string;

  constructor(private readonly client: FilesClient) {}

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(patch: Partial<FilesSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private get selector(): { scope: WorkspaceFileScope; spaceId: string | null } | undefined {
    if (this.state.scope === 'space') {
      return this.state.selectedSpaceId
        ? { scope: 'space', spaceId: this.state.selectedSpaceId }
        : undefined;
    }
    return { scope: 'shared', spaceId: null };
  }

  private cancelList() {
    this.listGeneration++;
    this.listController?.abort();
    this.listController = undefined;
  }

  private cancelDetail() {
    this.detailGeneration++;
    this.detailController?.abort();
    this.detailController = undefined;
  }

  private hasUnreleasedWork(): boolean {
    return this.state.writing !== false || this.state.uncertain || this.state.editor !== undefined ||
      this.state.savePreview !== undefined || this.state.deleteTarget !== undefined;
  }

  private releasePendingSpace(): boolean {
    if (!this.pendingSpaceId || this.disposed || this.hasUnreleasedWork()) return false;
    const target = this.pendingSpaceId;
    this.pendingSpaceId = undefined;
    // selectSpace 负责实际切换；若状态恰又阻塞，它会重新记录待切换目标。
    this.selectSpace(target);
    return true;
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    const hadWrite = this.state.writing !== false;
    this.active = active;
    if (!active) {
      this.cancelList();
      this.cancelDetail();
      this.writeGeneration++;
      this.writeController?.abort();
      this.writeController = undefined;
      this.publish({
        loading: false,
        stale: true,
        detailLoading: false,
        detailStale: true,
        writing: false,
        ...(hadWrite
          ? {
              uncertain: true,
              reviewed: false,
              uncertainOperation: this.activeWriteOperation,
              savePreview: undefined,
              deleteTarget: undefined,
              error: '本地已停止等待文件操作，远端结果可能已生效；请回读核对后再解锁，不会自动重发。',
            }
          : {}),
      });
    } else if (this.visible) {
      if (!this.releasePendingSpace()) void this.refresh();
    }
  }

  open() {
    if (this.disposed) return;
    this.visible = true;
    if (!this.selector) {
      this.publish({ error: '请先选择当前空间后再打开文件。' });
      return;
    }
    void this.refresh();
  }

  close() {
    this.visible = false;
    this.cancelList();
    this.cancelDetail();
    // 页面关闭不撤销已发出的写入；草稿、列表与详情都留在当前连接内。
    this.publish({
      loading: false,
      stale: true,
      detailLoading: false,
      detailStale: true,
      savePreview: undefined,
      deleteTarget: undefined,
    });
  }

  clearNotice = () => {
    this.publish({ error: undefined, notice: undefined });
  };

  selectSpace = (spaceId: string): boolean => {
    if (this.disposed) return false;
    validateWorkspaceSpaceId(spaceId);
    if (this.state.scope === 'space' && this.state.selectedSpaceId === spaceId) {
      this.pendingSpaceId = undefined;
      this.publish({ pendingSpaceId: undefined });
      return true;
    }
    if (this.hasUnreleasedWork()) {
      this.pendingSpaceId = spaceId;
      this.publish({
        pendingSpaceId: spaceId,
        error: '当前文件草稿或未明操作未收口；请先取消、保存并核对，或解除锁定后再切换空间。',
      });
      return false;
    }
    this.cancelList();
    this.cancelDetail();
    this.publish({
      scope: 'space',
      selectedSpaceId: spaceId,
      pendingSpaceId: undefined,
      directoryPath: '.',
      entries: [],
      loaded: false,
      stale: true,
      selectedPath: undefined,
      detail: undefined,
      detailStale: true,
      missing: false,
      savePreview: undefined,
      deleteTarget: undefined,
      error: undefined,
      notice: undefined,
    });
    if (this.active && this.visible) void this.refresh();
    return true;
  };

  selectShared = (): boolean => {
    if (this.disposed) return false;
    if (this.state.scope === 'shared') {
      this.pendingSpaceId = undefined;
      this.publish({ pendingSpaceId: undefined });
      return true;
    }
    if (this.hasUnreleasedWork()) {
      this.pendingSpaceId = undefined;
      this.publish({
        pendingSpaceId: undefined,
        error: '当前文件草稿或未明操作未收口；请先取消、保存并核对，或解除锁定后再切换到共享区。',
      });
      return false;
    }
    this.cancelList();
    this.cancelDetail();
    this.publish({
      scope: 'shared',
      selectedSpaceId: undefined,
      pendingSpaceId: undefined,
      directoryPath: '.',
      entries: [],
      loaded: false,
      stale: true,
      selectedPath: undefined,
      detail: undefined,
      detailStale: true,
      missing: false,
      savePreview: undefined,
      deleteTarget: undefined,
      error: undefined,
      notice: undefined,
    });
    if (this.active && this.visible) void this.refresh();
    return true;
  };

  private resetDirectory(path: string) {
    this.cancelList();
    this.cancelDetail();
    this.publish({
      directoryPath: path,
      entries: [],
      loaded: false,
      stale: true,
      selectedPath: undefined,
      detail: undefined,
      detailStale: true,
      missing: false,
      error: undefined,
      notice: undefined,
    });
  }

  openDirectory = (path: string): boolean => {
    if (this.disposed || this.state.writing !== false || this.state.uncertain) return false;
    const directory = validateWorkspaceReadPath(path);
    if (directory === this.state.directoryPath) {
      void this.refreshDirectory();
      return true;
    }
    this.resetDirectory(directory);
    if (this.active && this.visible) void this.refreshDirectory();
    return true;
  };

  goUp = (): boolean => this.openDirectory(parentWorkspacePath(this.state.directoryPath));

  refresh = async (): Promise<boolean> => {
    const listRefresh = this.refreshDirectory();
    // 前台恢复/重开/手动刷新时同步回读当前文件；编辑与确认态保持用户输入优先。
    const detailRefresh = this.state.selectedPath && this.state.editor === undefined &&
      this.state.savePreview === undefined && this.state.deleteTarget === undefined &&
      this.state.writing === false && !this.state.uncertain
      ? this.refreshDetail()
      : Promise.resolve(true);
    const [listOk, detailOk] = await Promise.all([listRefresh, detailRefresh]);
    return listOk && detailOk;
  };

  refreshDirectory = async (): Promise<boolean> => {
    const selector = this.selector;
    if (!this.active || !this.visible || this.state.writing !== false || this.disposed || !selector) return false;
    this.cancelList();
    const generation = this.listGeneration;
    const controller = new AbortController();
    this.listController = controller;
    const target = { ...selector, path: this.state.directoryPath };
    this.publish({ loading: true, error: undefined });
    try {
      const result = await this.client.listWorkspaceFiles(target, controller.signal);
      if (generation !== this.listGeneration || controller.signal.aborted || this.disposed) return false;
      if (
        result.scope !== selector.scope || result.spaceId !== selector.spaceId || result.path !== target.path
      ) throw new ApiError(502, '服务器返回的文件列表归属不正确');
      this.publish({ entries: result.entries, loaded: true, stale: false });
      this.releasePendingSpace();
      return true;
    } catch (error) {
      if (generation !== this.listGeneration || controller.signal.aborted || this.disposed || isRequestCancelled(error)) return false;
      this.publish({ stale: true, error: errorMessage(error, '文件列表读取失败，请重试') });
      return false;
    } finally {
      if (generation === this.listGeneration) {
        this.listController = undefined;
        this.publish({ loading: false });
      }
    }
  };

  openFile = async (path: string): Promise<boolean> => {
    const selector = this.selector;
    if (!this.active || !this.visible || this.state.writing !== false || this.disposed || !selector) return false;
    const target = { ...selector, path: validateWorkspaceReadPath(path, { fileRequired: true }) };
    this.cancelDetail();
    const generation = this.detailGeneration;
    const controller = new AbortController();
    this.detailController = controller;
    this.publish({
      selectedPath: target.path,
      detailLoading: true,
      detailStale: true,
      missing: false,
      savePreview: undefined,
      deleteTarget: undefined,
      error: undefined,
      notice: undefined,
    });
    try {
      const detail = await this.client.readWorkspaceFile(target, controller.signal);
      if (generation !== this.detailGeneration || controller.signal.aborted || this.disposed) return false;
      if (detail.scope !== selector.scope || detail.spaceId !== selector.spaceId || detail.path !== target.path) {
        throw new ApiError(502, '服务器返回的文件详情归属不正确');
      }
      this.publish({ detail, detailStale: false });
      return true;
    } catch (error) {
      if (generation !== this.detailGeneration || this.disposed) return false;
      if (error instanceof ApiError && error.status === 404) {
        this.publish({ detail: undefined, detailStale: true, missing: true });
        return false;
      }
      if (controller.signal.aborted || isRequestCancelled(error)) return false;
      this.publish({ detailStale: true, error: errorMessage(error, '文件详情读取失败，请重试') });
      return false;
    } finally {
      if (generation === this.detailGeneration) {
        this.detailController = undefined;
        this.publish({ detailLoading: false });
      }
    }
  };

  refreshDetail = async (): Promise<boolean> =>
    this.state.selectedPath ? this.openFile(this.state.selectedPath) : false;

  private canReadState(): boolean {
    return this.active && this.visible && !this.disposed;
  }

  canWrite(): boolean {
    return this.canReadState() && this.state.loaded && !this.state.loading &&
      !this.state.stale && this.state.writing === false && !this.state.uncertain;
  }

  beginCreate = () => {
    if (!this.canWrite()) return;
    if (this.state.editor) return;
    const editor: FilesEditor = { mode: 'create', path: '', before: '', content: '' };
    this.publish({ editor, savePreview: undefined, deleteTarget: undefined, error: undefined, notice: undefined });
  };

  beginEdit = () => {
    if (!this.canWrite() || this.state.detail?.kind !== 'text' || this.state.detailStale) return;
    if (this.state.editor) return;
    const detail = this.state.detail;
    const editor: FilesEditor = {
      mode: 'update',
      path: detail.path,
      before: detail.content,
      content: detail.content,
    };
    this.publish({ editor, savePreview: undefined, deleteTarget: undefined, error: undefined, notice: undefined });
  };

  setDraftPath = (path: string) => {
    if (!this.state.editor || this.state.editor.mode !== 'create' || this.state.writing !== false || this.state.uncertain) return;
    if (path.includes('\0') || path.length > 2048) {
      this.publish({ error: '新建路径不能包含 NUL，且不能超过 2048 个字符。' });
      return;
    }
    this.publish({ editor: { ...this.state.editor, path }, savePreview: undefined, error: undefined, notice: undefined });
  };

  setDraftContent = (content: string) => {
    if (!this.state.editor || this.state.writing !== false || this.state.uncertain) return;
    try {
      assertWorkspaceTextForWrite(content);
    } catch {
      this.publish({ error: `文本内容不能超过 ${MAX_WORKSPACE_TEXT_BYTES} 个 UTF-8 字节，且必须是无 NUL 的有效 Unicode。` });
      return;
    }
    this.publish({ editor: { ...this.state.editor, content }, savePreview: undefined, error: undefined, notice: undefined });
  };

  cancelEditor = () => {
    if (this.state.writing !== false || this.state.uncertain) return;
    this.publish({ editor: undefined, savePreview: undefined, error: undefined });
    this.releasePendingSpace();
  };

  requestSave = (): boolean => {
    const editor = this.state.editor;
    if (!editor || !this.canWrite()) return false;
    let path: string;
    try {
      path = validateWorkspaceWritePath(editor.path);
    } catch {
      this.publish({ error: '新建/保存路径每段只能使用 ASCII 字母、数字、点、连字符或下划线。' });
      return false;
    }
    try {
      assertWorkspaceTextForWrite(editor.content);
    } catch {
      this.publish({ error: `文本内容不能超过 ${MAX_WORKSPACE_TEXT_BYTES} 个 UTF-8 字节，且必须是无 NUL 的有效 Unicode。` });
      return false;
    }
    const selector = this.selector;
    if (!selector) return false;
    const preview: FilesSavePreview = {
      mode: editor.mode,
      ...selector,
      path,
      before: editor.mode === 'create' ? '' : editor.before,
      after: editor.content,
    };
    this.publish({ editor: { ...editor, path }, savePreview: preview, deleteTarget: undefined, error: undefined, notice: undefined });
    return true;
  };

  cancelSavePreview = () => {
    if (this.state.writing !== false) return;
    this.publish({ savePreview: undefined });
  };

  confirmSave = async (): Promise<boolean> => {
    const preview = this.state.savePreview;
    const editor = this.state.editor;
    if (!preview || !editor || !this.canWrite()) return false;
    if (preview.path !== editor.path || preview.after !== editor.content) return false;
    const selector = this.selector;
    if (!selector || preview.scope !== selector.scope || preview.spaceId !== selector.spaceId) return false;
    return this.write(preview.mode, { ...selector, path: preview.path }, editor.content, (signal) =>
      preview.mode === 'create'
        ? this.client.createWorkspaceTextFile({ ...selector, path: preview.path }, editor.content, signal)
        : this.client.updateWorkspaceTextFile({ ...selector, path: preview.path }, editor.content, signal));
  };

  requestDelete = (path: string): boolean => {
    if (!this.canWrite()) return false;
    try {
      validateWorkspaceWritePath(path);
    } catch {
      this.publish({ error: '仅允许删除路径段由 ASCII 字母、数字、点、连字符或下划线组成的普通文件。' });
      return false;
    }
    const target = this.state.entries.find((entry) => entry.path === path && entry.kind === 'file');
    if (!target) {
      this.publish({ error: '要删除的文件不在当前目录中；请刷新后重试。' });
      return false;
    }
    this.publish({ deleteTarget: target, savePreview: undefined, error: undefined, notice: undefined });
    return true;
  };

  cancelDelete = () => {
    if (this.state.writing !== false) return;
    this.publish({ deleteTarget: undefined });
    this.releasePendingSpace();
  };

  confirmDelete = async (): Promise<boolean> => {
    const target = this.state.deleteTarget;
    const selector = this.selector;
    if (!target || !selector || !this.canWrite()) return false;
    return this.write('delete', { ...selector, path: target.path }, undefined, (signal) =>
      this.client.deleteWorkspaceFile({ ...selector, path: target.path }, signal));
  };

  verifyUncertainOperation = async (): Promise<boolean> => {
    const operation = this.state.uncertainOperation;
    const selector = this.selector;
    if (!operation || !selector || !this.state.uncertain || this.state.writing !== false || !this.canReadState()) return false;
    if (operation.scope !== selector.scope || operation.spaceId !== selector.spaceId) return false;
    const target = { ...selector, path: operation.path };
    try {
      if (operation.kind === 'delete') {
        try {
          const detail = await this.client.readWorkspaceFile(target);
          this.publish({ verificationDetail: detail, verificationMissing: false, reviewed: true, notice: '已回读：文件仍存在，请核对后决定是否解锁。' });
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            this.publish({ verificationDetail: undefined, verificationMissing: true, reviewed: true, notice: '已回读：目标文件不存在，删除可能已生效；请核对后解锁。' });
          } else throw error;
        }
        return true;
      }
      try {
        const detail = await this.client.readWorkspaceFile(target);
        this.publish({ verificationDetail: detail, verificationMissing: false, reviewed: true, notice: '已回读目标文件全文；请与提交内容逐字核对后解锁。' });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          this.publish({ verificationDetail: undefined, verificationMissing: true, reviewed: true, notice: '已回读：目标文件不存在；请核对这是否符合预期后解锁。' });
        } else throw error;
      }
      return true;
    } catch (error) {
      this.publish({ error: errorMessage(error, '回读核对失败，请稍后重试') });
      return false;
    }
  };

  /** 解锁永远是一次新的用户决定；本方法不判断远端内容是否与原请求一致。 */
  acknowledgeReviewed = () => {
    if (!this.canReadState() || !this.state.uncertain || !this.state.reviewed || this.state.writing !== false) return;
    this.activeWriteOperation = undefined;
    this.publish({
      uncertain: false,
      reviewed: false,
      uncertainOperation: undefined,
      verificationDetail: undefined,
      verificationMissing: false,
      savePreview: undefined,
      deleteTarget: undefined,
      error: undefined,
      notice: '已解除操作锁定。再次提交会发起新请求，请确认没有重复写入。',
    });
    this.releasePendingSpace();
  };

  private async write(
    kind: FilesWriteKind,
    target: { scope: WorkspaceFileScope; spaceId: string | null; path: string },
    content: string | undefined,
    action: (signal: AbortSignal) => Promise<(WorkspaceFileDetail & WorkspaceFileSelector) | { ok: true }>,
  ): Promise<boolean> {
    this.cancelList();
    this.cancelDetail();
    const generation = ++this.writeGeneration;
    const controller = new AbortController();
    this.writeController = controller;
    const activeOperation: FilesUncertainOperation = {
      kind,
      scope: target.scope,
      spaceId: target.spaceId,
      path: target.path,
      ...(content === undefined ? {} : { content }),
    };
    this.activeWriteOperation = activeOperation;
    this.publish({
      writing: kind,
      loading: false,
      detailLoading: false,
      savePreview: undefined,
      deleteTarget: undefined,
      error: undefined,
      notice: undefined,
    });
    let succeeded = false;
    try {
      const result = await action(controller.signal);
      if (generation !== this.writeGeneration || controller.signal.aborted || this.disposed) return false;
      if ('ok' in result) {
        succeeded = true;
        this.publish({
          entries: this.state.entries.filter((entry) => entry.path !== target.path),
          ...(this.state.selectedPath === target.path ? { selectedPath: undefined, detail: undefined, detailStale: true } : {}),
          ...(this.state.editor?.path === target.path ? { editor: undefined } : {}),
          deleteTarget: undefined,
          stale: true,
          notice: '文件已删除',
        });
      } else {
        const detail = result;
        if (detail.scope !== target.scope || detail.spaceId !== target.spaceId || detail.path !== target.path) {
          throw new ApiError(502, '服务器返回的文件写入结果归属不正确');
        }
        succeeded = true;
        const entry: WorkspaceListEntry = {
          name: detail.name,
          path: detail.path,
          kind: 'file',
          size: detail.size,
          updatedAt: detail.updatedAt,
        };
        const visible = detail.path === this.state.directoryPath ||
          parentWorkspacePath(detail.path) === this.state.directoryPath;
        const entries = visible
          ? sortEntries([...this.state.entries.filter((entry) => entry.path !== detail.path), entry])
          : this.state.entries;
        this.publish({
          entries,
          selectedPath: detail.path,
          detail,
          detailStale: false,
          missing: false,
          editor: undefined,
          savePreview: undefined,
          deleteTarget: undefined,
          stale: true,
          notice: detail.kind === 'text' ? '文本文件已保存' : '文件已保存',
        });
      }
    } catch (error) {
      if (generation !== this.writeGeneration || this.disposed) return false;
      const uncertain = uncertainWrite(error) ||
        (kind === 'update' && error instanceof ApiError && error.status === 409);
      const operation: FilesUncertainOperation | undefined = uncertain
        ? { kind, scope: target.scope, spaceId: target.spaceId, path: target.path, ...(content === undefined ? {} : { content }) }
        : undefined;
      this.publish({
        ...(uncertain ? { uncertain: true, reviewed: false, uncertainOperation: operation } : {}),
        stale: true,
        error: uncertain
          ? '文件操作结果未明；请先完整回读核对，再由用户明确解锁，不会自动重发。'
          : errorMessage(error, '文件操作失败'),
      });
    } finally {
      if (generation === this.writeGeneration) {
        this.activeWriteOperation = undefined;
        this.writeController = undefined;
        this.publish({ writing: false });
        this.releasePendingSpace();
        if (succeeded && this.visible) void this.refreshDirectory();
      }
    }
    return succeeded;
  }

  dispose() {
    this.setActive(false);
    this.disposed = true;
    this.visible = false;
    this.activeWriteOperation = undefined;
    this.state = initial();
    this.listeners.clear();
  }
}
