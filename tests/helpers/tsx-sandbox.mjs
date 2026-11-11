// 组件沙箱测试共用：JSX 元素记录器、样式展平（含动画样式）与统一转译选项。
// 调用方保留各自的模块映射与 runInNewContext 环境，不在这里堆业务桩。
import ts from 'typescript';

export const sandboxElement = (type, props, key) => ({ type, props, key });
export const flattenStyle = (value) =>
  Object.assign({}, ...[value].flat(Infinity).filter(Boolean).map((part) => (part && part.__animated ? part.__animated() : part)));
export const transpileTsx = (fileName, source) => ts.transpileModule(source, { fileName, compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;
