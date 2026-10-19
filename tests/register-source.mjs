import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import ts from 'typescript';

// 同时转译本项目 src 与测试 helper；其余严格项目范围。Expo fetch 保留为可注入的网络边界。
const sourceRoots = [
  new URL('../src/', import.meta.url).href,
  new URL('./helpers/', import.meta.url).href,
];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'expo/fetch') {
      return {
        url: `data:text/javascript,${encodeURIComponent('export const fetch = (...args) => globalThis.fetch(...args);')}`,
        shortCircuit: true,
      };
    }
    if (specifier.startsWith('.') && context.parentURL && sourceRoots.some((root) => context.parentURL.startsWith(root))) {
      const url = new URL(specifier, context.parentURL);
      for (const extension of ['.ts', '.tsx']) {
        const candidate = new URL(url.href + extension);
        if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (sourceRoots.some((root) => url.startsWith(root)) && /\.tsx?$/.test(url)) {
      const output = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      });
      return { format: 'module', source: output.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
