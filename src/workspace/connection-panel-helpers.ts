/**
 * ConnectionPanel 的纯逻辑 helper：状态文案、http 探测、地址规范化包装。
 * 不耦合 React/React Native，可被 node:test 直接 import 做 source 守卫。
 */

import { normalizeServerAddress } from '../connection/server-address';
import type { ConnectionStatus } from '../connection/types';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

/** 把 ConnectionStatus 翻译为中文文案与视觉 tone，供面板直接渲染。 */
export function describeStatus(status: ConnectionStatus): {
  label: string;
  detail: string;
  tone: StatusTone;
} {
  switch (status) {
    case 'loading':
      return { label: '正在加载', detail: '正在读取本地连接配置', tone: 'neutral' };
    case 'unconfigured':
      return { label: '尚未配置', detail: '请填写服务器地址与访问密钥', tone: 'neutral' };
    case 'connecting':
      return { label: '正在连接', detail: '正在与服务端建立连接', tone: 'warning' };
    case 'online':
      return { label: '已连接', detail: '当前会话与服务器保持连接', tone: 'success' };
    case 'offline':
      return { label: '暂时不可用', detail: '无法访问当前服务器，可稍后重试', tone: 'danger' };
    case 'authentication-required':
      return { label: '需要认证', detail: '当前地址需要访问密钥', tone: 'warning' };
    case 'resetting':
      return { label: '正在清理', detail: '正在清理旧服务器的业务缓存', tone: 'warning' };
    case 'reset-error':
      return { label: '清理未完成', detail: '本地数据清理未完成，请重试清理后再连接', tone: 'danger' };
    case 'storage-error':
      return { label: '存储异常', detail: '无法读取本地连接配置，可点击重新加载', tone: 'danger' };
    default:
      return { label: '未知状态', detail: '', tone: 'neutral' };
  }
}

/** URL 输入是否使用 http 明文协议；用于提示但不阻止用户。 */
export function isPlainHttp(url: string): boolean {
  return url.trim().toLowerCase().startsWith('http://');
}

/** 不抛异常的地址规范化；用于展示与同址比较。 */
export function tryNormalize(
  input: string,
): { ok: true; value: string } | { ok: false; error: string } {
  try {
    return { ok: true, value: normalizeServerAddress(input) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
