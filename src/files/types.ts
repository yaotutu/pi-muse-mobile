export type WorkspaceFileTarget = { path: string };

export type WorkspaceListEntry = {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size: number;
  updatedAt: string;
};

export type WorkspaceListResult = {
  path: string;
  entries: readonly WorkspaceListEntry[];
};

export type WorkspaceFileMetadata = {
  name: string;
  path: string;
  kind: 'text' | 'image' | 'binary';
  size: number;
  updatedAt: string;
  mimeType: string;
};

export type WorkspaceTextDetail = WorkspaceFileMetadata & {
  kind: 'text';
  content: string;
};

export type WorkspaceBinaryDetail = WorkspaceFileMetadata & {
  kind: 'image' | 'binary';
  dataBase64: string;
};

export type WorkspaceFileDetail = WorkspaceTextDetail | WorkspaceBinaryDetail;

export type WorkspaceDeleteResult = WorkspaceFileTarget & { ok: true };

/**
 * 手动文件管理只依赖这五个 HTTP 入口；所有方法都可被页面关闭或后台切换取消。
 * 写入没有幂等键，调用方必须先完成完整预览与人工确认，失败结果未明时不得重发。
 */
export interface FilesClient {
  listWorkspaceFiles(selector: { path?: string }, signal?: AbortSignal): Promise<WorkspaceListResult>;
  readWorkspaceFile(target: WorkspaceFileTarget, signal?: AbortSignal): Promise<WorkspaceFileDetail>;
  createWorkspaceTextFile(target: WorkspaceFileTarget, content: string, signal?: AbortSignal): Promise<WorkspaceTextDetail>;
  updateWorkspaceTextFile(target: WorkspaceFileTarget, content: string, signal?: AbortSignal): Promise<WorkspaceTextDetail>;
  deleteWorkspaceFile(target: WorkspaceFileTarget, signal?: AbortSignal): Promise<WorkspaceDeleteResult>;
}

export type FilesWriteKind = 'create' | 'update' | 'delete';

export type FilesEditor = {
  mode: 'create' | 'update';
  path: string;
  before: string;
  content: string;
};

export type FilesSavePreview = {
  mode: 'create' | 'update';
  path: string;
  before: string;
  after: string;
};

export type FilesUncertainOperation = {
  kind: FilesWriteKind;
  path: string;
  content?: string;
};

export type FilesSnapshot = {
  directoryPath: string;
  entries: readonly WorkspaceListEntry[];
  loaded: boolean;
  loading: boolean;
  stale: boolean;
  selectedPath?: string;
  detail?: WorkspaceFileDetail;
  detailLoading: boolean;
  detailStale: boolean;
  missing: boolean;
  editor?: FilesEditor;
  savePreview?: FilesSavePreview;
  deleteTarget?: WorkspaceListEntry;
  writing: FilesWriteKind | false;
  uncertain: boolean;
  reviewed: boolean;
  uncertainOperation?: FilesUncertainOperation;
  verificationDetail?: WorkspaceFileDetail;
  verificationMissing: boolean;
  error?: string;
  notice?: string;
};
