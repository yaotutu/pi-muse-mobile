/**
 * A01 对话测试专用注册模块：仅本测试进程把 react-native 解析为最小替身，
 * 供模拟 React 支架驱动真实 useConversation Hook（AppState 依赖）。
 * 不影响其他测试共享的 register-source.mjs，不代表真实原生运行。
 */

import '../register-source.mjs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react-native') {
      const stub = `
export const AppState = {
  currentState: 'active',
  addEventListener: () => ({ remove: () => {} }),
};
`;
      return { url: 'data:text/javascript,' + encodeURIComponent(stub), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
