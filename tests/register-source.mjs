import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import ts from 'typescript';

// 同时转译本项目 src 与测试 helper；其余严格项目范围。Expo fetch 保留为可注入的网络边界。
const sourceRoots = [
  new URL('../src/', import.meta.url).href,
  new URL('../modules/', import.meta.url).href,
  new URL('./helpers/', import.meta.url).href,
];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react-native') {
      const stub = `
export const AppState = {
  currentState: 'active',
  addEventListener: () => ({ remove: () => {} }),
};
export const Platform = {
  OS: 'android',
  select: (obj) => obj.android ?? obj.default,
};
export const PermissionsAndroid = {
  PERMISSIONS: { RECEIVE_SMS: 'android.permission.RECEIVE_SMS' },
  RESULTS: { GRANTED: 'granted', DENIED: 'denied', NEVER_ASK_AGAIN: 'never_ask_again' },
  check: async () => false,
  request: async () => 'denied',
};
`;
      return { url: 'data:text/javascript,' + encodeURIComponent(stub), shortCircuit: true };
    }
    if (specifier === 'expo-modules-core') {
      return {
        url: `data:text/javascript,${encodeURIComponent('export const requireNativeModule = () => null;')}`,
        shortCircuit: true,
      };
    }
    if (specifier === 'expo/fetch') {
      return {
        url: `data:text/javascript,${encodeURIComponent('export const fetch = (...args) => globalThis.fetch(...args);')}`,
        shortCircuit: true,
      };
    }
    if (specifier === 'react-native-reanimated') {
      return {
        url: `data:text/javascript,${encodeURIComponent(`
          export const useSharedValue = (init) => ({ value: init });
          export const useAnimatedStyle = (fn) => fn();
          export const withTiming = (toValue, _config, cb) => { if (cb) cb(true); return toValue; };
          export const withSpring = (toValue, _config, cb) => { if (cb) cb(true); return toValue; };
          export const interpolate = (_val, _input, output) => output[output.length - 1];
          export const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };
          export const runOnJS = (fn) => fn;
          export const Easing = { bezier: () => (t) => t, out: (fn) => fn, cubic: (t) => t };
          const Animated = { View: 'View', createAnimatedComponent: (c) => c };
          export default Animated;
        `)}`,
        shortCircuit: true,
      };
    }
    if (specifier.startsWith('.') && context.parentURL && sourceRoots.some((root) => context.parentURL.startsWith(root))) {
      const url = new URL(specifier, context.parentURL);
      for (const extension of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const candidate = new URL(url.href + extension);
        if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (sourceRoots.some((root) => url.startsWith(root)) && /\.tsx?$/.test(url)) {
      // 必须带上真实文件名：transpileModule 依据扩展名决定 TS 还是 TSX 解析。
      // 缺省时按 TSX 解析，泛型箭头函数与类型断言会被当成 JSX 破坏源码。
      const fileName = fileURLToPath(url);
      const output = ts.transpileModule(readFileSync(fileName, 'utf8'), {
        fileName,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      });
      return { format: 'module', source: output.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
