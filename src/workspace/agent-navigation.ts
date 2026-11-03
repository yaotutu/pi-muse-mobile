import type { FilesSnapshot } from '../files/types';

export type AgentSection = 'home' | 'files' | 'rules' | 'skills' | 'maintenance';

/** 根层与可见返回按钮共用相同次序；未明写入不能靠返回解除。 */
export function filesBackAction(state: FilesSnapshot) {
  if (state.writing !== false || state.uncertain) return 'locked';
  if (state.savePreview) return 'preview';
  if (state.deleteTarget) return 'delete';
  if (state.editor) return 'draft';
  if (state.selectedPath) return 'detail';
  if (state.directoryPath !== '.') return 'directory';
  return 'home';
}

export function hasFileWork(state: FilesSnapshot) {
  return !!state.editor || !!state.savePreview || !!state.deleteTarget || state.writing !== false || state.uncertain;
}
