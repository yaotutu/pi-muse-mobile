import { Platform } from 'react-native';
// 与 files/native-download、update/native-updates 一样静态引入：Metro 的动态 import 解析不到带 exports 的包。
import { Directory, File, Paths } from 'expo-file-system';
import { assertCompanionPng, COMPANION_STATES, isCompanionPackId, parseCompanionPack, type CompanionPackSummary, type CompanionState } from '../api/companion-contracts';
import type { CachedCompanion, CompanionCache, CompanionImages } from './types';

export const companionAbort = () => Object.assign(new Error('形象下载已取消'), { name: 'AbortError' });
const check = (signal: AbortSignal) => { if (signal.aborted) throw companionAbort(); };
/** 可注入的最小存储边界：ready 只能在全部状态写好后发布。 */
export interface CompanionCacheBackend {
  read(scope: string, id: string, version?: string): Promise<CachedCompanion | undefined>;
  stage(scope: string, pack: CompanionPackSummary): Promise<{
    write(state: CompanionState, bytes: Uint8Array): Promise<void>;
    commit(assertActive: () => void): Promise<CachedCompanion>;
    discard(): Promise<void>;
  }>;
  clear(): Promise<void>;
}
export class AtomicCompanionCache implements CompanionCache {
  private generation = 0;
  constructor(private readonly backend: CompanionCacheBackend) {}
  async read(scope: string, id: string, signal: AbortSignal) {
    const generation = this.generation; check(signal);
    const cached = await this.backend.read(scope, id); check(signal);
    if (generation !== this.generation) throw companionAbort();
    return cached;
  }
  async prepare(scope: string, pack: CompanionPackSummary, fetchAsset: (state: CompanionState) => Promise<Uint8Array>, signal: AbortSignal) {
    const generation = this.generation;
    const active = () => { check(signal); if (generation !== this.generation) throw companionAbort(); };
    active(); parseCompanionPack(pack);
    const existing = await this.backend.read(scope, pack.id, pack.version); active();
    if (existing) return existing;
    const temporary = await this.backend.stage(scope, pack);
    try {
      for (const state of COMPANION_STATES) {
        active(); const bytes = await fetchAsset(state); active(); assertCompanionPng(bytes);
        await temporary.write(state, bytes); active();
      }
      const cached = await temporary.commit(active); active(); return cached;
    } finally {
      // commit 后 discard 只清理本次临时目录，绝不删除仍在展示的旧版本。
      await temporary.discard();
    }
  }
  async clear() { this.generation++; await this.backend.clear(); }
}

// 可逆编码隔离不同服务地址；分段避免长地址突破文件系统单段长度，路径不包含凭据。
const hex = (value: string) => Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
const scopeParts = (scope: string) => hex(scope).match(/.{1,120}/g) ?? ['empty'];
const versionParts = (version: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(version) ? [version] : ['encoded.', ...(hex(version).match(/.{1,120}/g) ?? ['empty'])];
let temporaryId = 0;
export async function createNativeCompanionCacheBackend(): Promise<CompanionCacheBackend> {
  const root = () => new Directory(Paths.cache, 'companions');
  const packDirectory = (scope: string, id: string) => {
    if (!isCompanionPackId(id)) throw new Error('形象 ID 不正确');
    return new Directory(root(), ...scopeParts(scope), 'packs', id);
  };
  const readVersion = async (directory: InstanceType<typeof Directory>, expectedId: string, expectedVersion?: string) => {
    try {
      const ready = new File(directory, 'ready.json'); if (!ready.exists) return undefined;
      const summary = parseCompanionPack(JSON.parse(await ready.text()), expectedId);
      if (expectedVersion !== undefined && summary.version !== expectedVersion) return undefined;
      const images = {} as CompanionImages;
      for (const state of COMPANION_STATES) {
        const file = new File(directory, `${state}.png`); if (!file.exists || file.size > 786_432) return undefined;
        assertCompanionPng(await file.bytes()); images[state] = { uri: file.uri };
      }
      return { summary, images };
    } catch { return undefined; }
  };
  return {
    async read(scope, id, version) {
      const parent = packDirectory(scope, id); if (!parent.exists) return undefined;
      if (version !== undefined) return readVersion(new Directory(parent, ...versionParts(version)), id, version);
      const candidates: CachedCompanion[] = [];
      const collect = async (directory: InstanceType<typeof Directory>) => {
        for (const entry of directory.list()) {
          if (!(entry instanceof Directory) || entry.name.startsWith('pending.')) continue;
          const cached = await readVersion(entry, id); if (cached) candidates.push(cached);
          await collect(entry);
        }
      };
      await collect(parent);
      return candidates.sort((a, b) => Date.parse(b.summary.updatedAt) - Date.parse(a.summary.updatedAt))[0];
    },
    async stage(scope, pack) {
      const parent = packDirectory(scope, pack.id); parent.create({ intermediates: true, idempotent: true });
      const temporary = new Directory(parent, `pending.${Date.now()}-${++temporaryId}`); temporary.create();
      const temporaryUri = temporary.uri;
      return {
        async write(state, bytes) { await new File(temporary, `${state}.png`).write(bytes); },
        async commit(assertActive) {
          assertActive();
          // write 与 move 都是异步原生调用：不等待会让发布与清理互相踩踏，缓存目录永远不完整。
          await new File(temporary, 'ready.json').write(JSON.stringify(pack));
          const parts = versionParts(pack.version);
          const container = new Directory(parent, ...parts.slice(0, -1)); container.create({ intermediates: true, idempotent: true });
          const destination = new Directory(container, parts[parts.length - 1]);
          // 同一版本是不可变内容；恢复损坏缓存时才替换未就绪目录。
          const existing = destination.exists ? await readVersion(destination, pack.id, pack.version) : undefined;
          assertActive();
          if (existing) return existing;
          if (destination.exists) destination.delete();
          await temporary.move(destination);
          assertActive();
          const images = Object.fromEntries(COMPANION_STATES.map((state) => [state, { uri: new File(destination, `${state}.png`).uri }])) as CompanionImages;
          return { summary: pack, images };
        },
        async discard() { const leftover = new Directory(temporaryUri); if (leftover.exists) leftover.delete(); },
      };
    },
    async clear() { const directory = root(); if (directory.exists) directory.delete(); },
  };
}
export function createWebCompanionCacheBackend(): CompanionCacheBackend {
  const ready = new Map<string, CachedCompanion>(); const urls = new Set<string>();
  const key = (scope: string, id: string, version: string) => JSON.stringify([scope, id, version]);
  return {
    async read(scope, id, version) {
      if (version !== undefined) return ready.get(key(scope, id, version));
      return [...ready.entries()].filter(([entry]) => { const parts = JSON.parse(entry); return parts[0] === scope && parts[1] === id; })
        .map(([, cached]) => cached).sort((a, b) => Date.parse(b.summary.updatedAt) - Date.parse(a.summary.updatedAt))[0];
    },
    async stage(scope, pack) {
      const images = {} as CompanionImages; const staged: string[] = []; let committed = false;
      return {
        async write(state, bytes) {
          const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: 'image/png' }));
          staged.push(url); urls.add(url); images[state] = { uri: url };
        },
        async commit(assertActive) {
          assertActive();
          const cached = { summary: pack, images }; ready.set(key(scope, pack.id, pack.version), cached);
          committed = true; return cached;
        },
        async discard() { if (!committed) for (const url of staged) { URL.revokeObjectURL(url); urls.delete(url); } },
      };
    },
    async clear() { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); ready.clear(); },
  };
}
// Web 不加载原生文件模块；清理在同一实例排队，换服不遗留晚到的下载发布。
let cachePromise: Promise<AtomicCompanionCache> | undefined;
export function getCompanionCache(): Promise<AtomicCompanionCache> {
  return cachePromise ??= (Platform.OS === 'web' ? Promise.resolve(createWebCompanionCacheBackend()) : createNativeCompanionCacheBackend()).then((backend) => new AtomicCompanionCache(backend));
}
export async function clearCompanionCache(): Promise<void> { await (await getCompanionCache()).clear(); }
