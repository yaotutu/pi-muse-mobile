/**
 * Web 联调代理（临时工具，服务端补上 CORS 后退役）：
 * 8791 → 127.0.0.1:8788 透传 /api/* 与 /openapi.json，
 * 给所有响应注入 Access-Control-Allow-Origin 等头。
 *
 * 背景：服务端 OPTIONS 预检正常但不回 Access-Control-Allow-Origin，
 * Expo Web（8082）跨域调试被浏览器拦截；原生 App 无 CORS 概念不走本代理。
 * 用法：node tools/dev-proxy.mjs（默认上游 8788，可用 UPSTREAM= 覆盖）
 */
import { createServer } from 'node:http';

const PORT = 8791;
const UPSTREAM = process.env.UPSTREAM ?? '127.0.0.1:8788';

const server = createServer(async (req, res) => {
  const cors = {
    'access-control-allow-origin': req.headers.origin ?? '*',
    'access-control-allow-headers': 'Authorization,Content-Type',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-max-age': '86400',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  try {
    const upstream = await fetch(`http://${UPSTREAM}${req.url}`, {
      method: req.method,
      headers: { authorization: req.headers.authorization ?? '', 'content-type': req.headers['content-type'] ?? '' },
      body: ['GET', 'HEAD'].includes(req.method ?? '') ? undefined : req,
      duplex: 'half',
    });
    const headers = { ...cors };
    upstream.headers.forEach((value, key) => {
      if (!['access-control-allow-origin', 'transfer-encoding', 'content-encoding', 'connection'].includes(key)) {
        headers[key] = value;
      }
    });
    res.writeHead(upstream.status, headers);
    if (upstream.body) {
      // SSE 需逐块透传，不能等整个响应结束
      for await (const chunk of upstream.body) res.write(chunk);
    }
    res.end();
  } catch (error) {
    res.writeHead(502, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `代理转发失败: ${String(error)}` }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-proxy] http://localhost:${PORT} → http://${UPSTREAM}（CORS 注入已启用）`);
});
