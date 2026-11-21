export async function deleteTestSession(api, sessionId) {
  const { scheduleRevision } = await api.getSessionSchedules(sessionId);
  return api.deleteSession(sessionId, { scheduleDisposition: 'delete', scheduleRevision });
}

/** 真实测试临时替换全局指令，只回滚自己写入且仍生效的内容。 */
export function temporaryAssistantInstructions(api) {
  let original;
  let applied;
  return {
    async set(instructions) {
      original ??= (await api.getAssistantInstructions()).instructions;
      applied = instructions;
      await api.saveAssistantInstructions(instructions);
    },
    async restore() {
      if (applied === undefined || applied === original) return;
      if ((await api.getAssistantInstructions()).instructions === applied) {
        await api.saveAssistantInstructions(original);
      }
    },
  };
}
