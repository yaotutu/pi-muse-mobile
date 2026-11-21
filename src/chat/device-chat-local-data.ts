import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { CHAT_LOCAL_MAX_BYTES, ChatLocalCorruptError, ChatLocalRepository, type ChatLocalStorage } from './chat-local-data';

let sequence = 0;
function nativeStorage(): ChatLocalStorage {
  const directory = () => new Directory(Paths.document, 'chat-local');
  const published = () => directory().exists ? directory().list().filter((entry): entry is File => entry instanceof File && /^history\.[0-9]+-[0-9]+\.json$/.test(entry.name))
    .sort((left, right) => right.name.localeCompare(left.name)) : [];
  return {
    async read() {
      const target = published()[0];
      if (!target) return null;
      if (target.size > CHAT_LOCAL_MAX_BYTES) throw new ChatLocalCorruptError('聊天本地文件超过限制');
      return target.text();
    },
    async write(text) {
      directory().create({ intermediates: true, idempotent: true });
      const temporary = new File(directory(), 'history.pending.json');
      const temporaryUri = temporary.uri;
      try {
        await temporary.write(text);
        // 发布到全新文件名，不先删除旧快照（iOS overwrite 会先 unlink，不具备原子替换语义）。
        const previous = Number(published()[0]?.name.split('.')[1]?.split('-')[0] ?? 0);
        const timestamp = Math.max(Date.now(), previous + 1);
        const target = new File(directory(), `history.${String(timestamp).padStart(16, '0')}-${String(++sequence).padStart(8, '0')}.json`);
        await temporary.move(target);
        for (const old of published()) if (old.uri !== target.uri) await old.delete();
      } finally { const leftover = new File(temporaryUri); if (leftover.exists) await leftover.delete(); }
    },
    async clear() { const target = directory(); if (target.exists) await target.delete(); },
  };
}
// Web 不把受保护历史写入 localStorage / IndexedDB，共享同一会话内的有界内存降级。
function webStorage(): ChatLocalStorage {
  let text: string | null = null;
  return { async read() { return text; }, async write(value) { text = value; }, async clear() { text = null; } };
}
export const deviceChatLocalRepository = new ChatLocalRepository(Platform.OS === 'web' ? webStorage() : nativeStorage());
