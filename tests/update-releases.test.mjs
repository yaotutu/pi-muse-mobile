// 测试对象：src/update/releases.ts
// 该模块在本 worktree 尚不存在（主工作区未提交的源码不会被 worktree 拾起），
// 测试文件按用户明确的 API 契约编写，等源文件提交进 worktree 后即可运行。
import assert from 'node:assert/strict';
import './register-source.mjs';
import test from 'node:test';

const releases = await import('../src/update/releases.ts');
const {
  isNewerVersion,
  parseRelease,
  getLatestRelease,
  apkAssetNameForAbi,
  latestApkDownloadUrl,
  LATEST_RELEASE_URL,
  UNIVERSAL_APK_NAME,
} = releases;

// --- 辅助 ----------------------------------------------------------------

const withFetch = async (fetchImpl, callback) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const jsonResponse = (body, status = 200, headers = {}) => new Response(
  JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json', ...headers } },
);

const buildValidRelease = (overrides = {}) => ({
  id: 123,
  draft: false,
  prerelease: false,
  tag_name: 'v1.2.3',
  assets: [{
    id: 456,
    name: 'app-release.apk',
    size: 7890,
    browser_download_url:
      'https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk',
  }],
  ...overrides,
});

// 带全部拆分资产的正式 release；assetId 前缀用于断言选中了哪个包。
const buildSplitRelease = () => ({
  id: 123,
  draft: false,
  prerelease: false,
  tag_name: 'v1.2.3',
  assets: [
    'app-release.apk',
    'app-armeabi-v7a-release.apk',
    'app-arm64-v8a-release.apk',
    'app-x86-release.apk',
    'app-x86_64-release.apk',
  ].map((name, index) => ({
    id: 400 + index,
    name,
    size: 1000 + index,
    browser_download_url:
      `https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/${name}`,
  })),
});

// --- LATEST_RELEASE_URL ---------------------------------------------------

test('LATEST_RELEASE_URL 锁定 GitHub Releases API 官方地址', () => {
  assert.equal(
    LATEST_RELEASE_URL,
    'https://api.github.com/repos/yaotutu/pi-muse-mobile/releases/latest',
  );
});

// --- isNewerVersion ------------------------------------------------------

test('isNewerVersion: 1.0.10 > 1.0.9 为 true', () => {
  assert.equal(isNewerVersion('1.0.10', '1.0.9'), true);
});

test('isNewerVersion: 相等版本为 false', () => {
  assert.equal(isNewerVersion('1.0.10', '1.0.10'), false);
});

test('isNewerVersion: 旧候选为 false', () => {
  assert.equal(isNewerVersion('1.0.9', '1.0.10'), false);
});

test('isNewerVersion: 主版本号更大为 true', () => {
  assert.equal(isNewerVersion('2.0.0', '1.99.99'), true);
});

test('isNewerVersion: 次版本号更大为 true', () => {
  assert.equal(isNewerVersion('1.10.0', '1.9.99'), true);
});

test('isNewerVersion: 不接受 v 前缀', () => {
  assert.throws(() => isNewerVersion('v1.0.10', '1.0.9'));
  assert.throws(() => isNewerVersion('1.0.10', 'v1.0.9'));
});

test('isNewerVersion: 非数字字段直接抛错', () => {
  assert.throws(() => isNewerVersion('1.0', '1.0.0'));
  assert.throws(() => isNewerVersion('1.0.0.x', '1.0.0'));
  assert.throws(() => isNewerVersion('abc', '1.0.0'));
  assert.throws(() => isNewerVersion('', '1.0.0'));
});

test('isNewerVersion: 负数或非安全整数直接抛错', () => {
  assert.throws(() => isNewerVersion('-1.0.0', '1.0.0'));
  assert.throws(() => isNewerVersion('1.0.0', '-1.0.0'));
});

// --- parseRelease --------------------------------------------------------

test('parseRelease: 正式 release 解析为精简字段并去除 v 前缀', () => {
  const summary = parseRelease(buildValidRelease());
  assert.deepEqual(summary, {
    id: 123,
    assetId: 456,
    version: '1.2.3',
    size: 7890,
    url: 'https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk',
  });
});

test('parseRelease: draft 为 true 直接抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({ draft: true })));
});

test('parseRelease: prerelease 为 true 直接抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({ prerelease: true })));
});

test('parseRelease: 缺少 assets 抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({ assets: undefined })));
});

test('parseRelease: assets 为空数组抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({ assets: [] })));
});

test('parseRelease: assets 多于一个抛错（必须唯一）', () => {
  const release = buildValidRelease();
  release.assets.push({
    id: 999,
    name: 'app-release.apk',
    size: 100,
    browser_download_url:
      'https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk',
  });
  assert.throws(() => parseRelease(release));
});

test('parseRelease: asset 名称不是 app-release.apk 抛错', () => {
  const release = buildValidRelease();
  release.assets[0].name = 'debug.apk';
  assert.throws(() => parseRelease(release));
});

test('parseRelease: asset id 非正整数抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({
    assets: [{
      id: 0,
      name: 'app-release.apk',
      size: 7890,
      browser_download_url: 'https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk',
    }],
  })));
  assert.throws(() => parseRelease(buildValidRelease({
    assets: [{
      id: -1,
      name: 'app-release.apk',
      size: 7890,
      browser_download_url: 'https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk',
    }],
  })));
});

test('parseRelease: release id 非正整数抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({ id: 0 })));
});

test('parseRelease: asset size 非正整数抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({
    assets: [{
      id: 456,
      name: 'app-release.apk',
      size: 0,
      browser_download_url: 'https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk',
    }],
  })));
});

test('parseRelease: download URL host 错误抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({
    assets: [{
      id: 456,
      name: 'app-release.apk',
      size: 7890,
      browser_download_url: 'https://evil.example.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk',
    }],
  })));
});

test('parseRelease: download URL 使用 HTTP 抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({
    assets: [{
      id: 456,
      name: 'app-release.apk',
      size: 7890,
      browser_download_url: 'http://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk',
    }],
  })));
});

test('parseRelease: download URL 路径错误（用户名不对）抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({
    assets: [{
      id: 456,
      name: 'app-release.apk',
      size: 7890,
      browser_download_url: 'https://github.com/attacker/pi-muse-mobile/releases/download/v1.2.3/app-release.apk',
    }],
  })));
});

test('parseRelease: download URL 路径错误（仓库不对）抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({
    assets: [{
      id: 456,
      name: 'app-release.apk',
      size: 7890,
      browser_download_url: 'https://github.com/yaotutu/wrong-repo/releases/download/v1.2.3/app-release.apk',
    }],
  })));
});

test('parseRelease: download URL 路径里 tag 与 tag_name 不一致抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({
    assets: [{
      id: 456,
      name: 'app-release.apk',
      size: 7890,
      browser_download_url: 'https://github.com/yaotutu/pi-muse-mobile/releases/download/v9.9.9/app-release.apk',
    }],
  })));
});

test('parseRelease: download URL 非默认端口抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({
    assets: [{
      id: 456,
      name: 'app-release.apk',
      size: 7890,
      browser_download_url: 'https://github.com:8443/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk',
    }],
  })));
});

test('parseRelease: download URL 含 query 抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({
    assets: [{
      id: 456,
      name: 'app-release.apk',
      size: 7890,
      browser_download_url: 'https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk?token=x',
    }],
  })));
});

test('parseRelease: download URL 含 hash 抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({
    assets: [{
      id: 456,
      name: 'app-release.apk',
      size: 7890,
      browser_download_url: 'https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk#frag',
    }],
  })));
});

test('parseRelease: download URL 含 username:password 抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({
    assets: [{
      id: 456,
      name: 'app-release.apk',
      size: 7890,
      browser_download_url: 'https://user:pass@github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk',
    }],
  })));
});

test('parseRelease: tag_name 缺 v 前缀抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({ tag_name: '1.2.3' })));
});

test('parseRelease: tag_name 非数字字段抛错', () => {
  assert.throws(() => parseRelease(buildValidRelease({ tag_name: 'v1.2' })));
  assert.throws(() => parseRelease(buildValidRelease({ tag_name: 'vabc' })));
});

test('parseRelease: 输入为 null 或非对象抛错', () => {
  assert.throws(() => parseRelease(null));
  assert.throws(() => parseRelease(undefined));
  assert.throws(() => parseRelease('release'));
  assert.throws(() => parseRelease(42));
});

// --- ABI 拆分资产选择 ------------------------------------------------------

test('apkAssetNameForAbi: 四种 ABI 映射到对应拆分包名', () => {
  assert.equal(apkAssetNameForAbi('arm64-v8a'), 'app-arm64-v8a-release.apk');
  assert.equal(apkAssetNameForAbi('armeabi-v7a'), 'app-armeabi-v7a-release.apk');
  assert.equal(apkAssetNameForAbi('x86'), 'app-x86-release.apk');
  assert.equal(apkAssetNameForAbi('x86_64'), 'app-x86_64-release.apk');
});

test('apkAssetNameForAbi: 未知或缺失 ABI 回退通用包名', () => {
  assert.equal(apkAssetNameForAbi('riscv64'), UNIVERSAL_APK_NAME);
  assert.equal(apkAssetNameForAbi(''), UNIVERSAL_APK_NAME);
  assert.equal(apkAssetNameForAbi(null), UNIVERSAL_APK_NAME);
  assert.equal(apkAssetNameForAbi(undefined), UNIVERSAL_APK_NAME);
});

test('latestApkDownloadUrl: 生成固定官方 latest 地址', () => {
  assert.equal(
    latestApkDownloadUrl('app-arm64-v8a-release.apk'),
    'https://github.com/yaotutu/pi-muse-mobile/releases/latest/download/app-arm64-v8a-release.apk',
  );
  assert.equal(
    latestApkDownloadUrl(UNIVERSAL_APK_NAME),
    'https://github.com/yaotutu/pi-muse-mobile/releases/latest/download/app-release.apk',
  );
});

test('latestApkDownloadUrl: 拒绝名单外文件名', () => {
  assert.throws(() => latestApkDownloadUrl('debug.apk'));
  assert.throws(() => latestApkDownloadUrl('../app-release.apk'));
});

test('parseRelease: 指定 ABI 资产存在时优先选中并校验其 URL', () => {
  const summary = parseRelease(buildSplitRelease(), 'app-arm64-v8a-release.apk');
  assert.equal(summary.assetId, 402);
  assert.equal(summary.size, 1002);
  assert.equal(summary.url, 'https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-arm64-v8a-release.apk');
});

test('parseRelease: 拆分资产缺失时回退通用包', () => {
  const body = { ...buildSplitRelease(), assets: buildSplitRelease().assets.filter((a) => a.name !== 'app-x86_64-release.apk') };
  const summary = parseRelease(body, 'app-x86_64-release.apk');
  assert.equal(summary.assetId, 400);
  assert.equal(summary.url, 'https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk');
  // 过滤掉通用包且拆分包也没有时应抛错。
  const noMatch = { ...body, assets: body.assets.filter((a) => a.name !== UNIVERSAL_APK_NAME) };
  assert.throws(() => parseRelease(noMatch, 'app-x86_64-release.apk'));
});

test('parseRelease: 同名拆分资产出现两份抛错，不猜', () => {
  const release = buildSplitRelease();
  const dup = { ...release.assets[2] };
  release.assets.push(dup);
  assert.throws(() => parseRelease(release, 'app-arm64-v8a-release.apk'));
});

test('parseRelease: 选中拆分包但 URL 文件名不一致抛错', () => {
  const release = buildSplitRelease();
  release.assets[2].browser_download_url =
    'https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk';
  assert.throws(() => parseRelease(release, 'app-arm64-v8a-release.apk'));
});

test('parseRelease: 默认仍只认通用包名（旧调用方兼容）', () => {
  const summary = parseRelease(buildSplitRelease());
  assert.equal(summary.assetId, 400);
  assert.equal(summary.url, 'https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk');
});

// --- getLatestRelease ----------------------------------------------------

test('getLatestRelease: 正式 release 200 返回精简结构', async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, LATEST_RELEASE_URL);
    assert.equal((init.method ?? 'GET'), 'GET');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('accept'), 'application/vnd.github+json');
    assert.equal(headers.has('authorization'), false);
    assert.equal(headers.has('cookie'), false);
    return jsonResponse(buildValidRelease());
  }, async () => {
    const summary = await getLatestRelease(new AbortController().signal);
    assert.deepEqual(summary, {
      id: 123,
      assetId: 456,
      version: '1.2.3',
      size: 7890,
      url: 'https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-release.apk',
    });
  });
});

test('getLatestRelease: 精确锁定请求 URL 不带任何参数', async () => {
  let capturedUrl = null;
  await withFetch(async (url) => {
    capturedUrl = url;
    return jsonResponse(buildValidRelease());
  }, async () => {
    await getLatestRelease(new AbortController().signal);
  });
  assert.equal(capturedUrl, LATEST_RELEASE_URL);
  // 防御：URL 不应携带任何 query / hash。
  const parsed = new URL(capturedUrl);
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, '');
});

test('getLatestRelease: 请求中不携带 Authorization 或 Cookie 头', async () => {
  let capturedHeaders = null;
  await withFetch(async (_url, init) => {
    capturedHeaders = init.headers;
    return jsonResponse(buildValidRelease());
  }, async () => {
    await getLatestRelease(new AbortController().signal);
  });
  const headers = new Headers(capturedHeaders);
  assert.equal(headers.has('authorization'), false);
  assert.equal(headers.has('cookie'), false);
});

test('getLatestRelease: 404 抛普通 Error（非 AbortError）', async () => {
  await withFetch(async () => jsonResponse({ message: 'Not Found' }, 404), async () => {
    await assert.rejects(getLatestRelease(new AbortController().signal), (error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.name !== 'AbortError');
      return true;
    });
  });
});

test('getLatestRelease: 403 抛普通 Error', async () => {
  await withFetch(async () => jsonResponse({ message: 'rate limit' }, 403), async () => {
    await assert.rejects(getLatestRelease(new AbortController().signal), (error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.name !== 'AbortError');
      return true;
    });
  });
});

test('getLatestRelease: 429 抛普通 Error', async () => {
  await withFetch(async () => jsonResponse({ message: 'too many' }, 429), async () => {
    await assert.rejects(getLatestRelease(new AbortController().signal), (error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.name !== 'AbortError');
      return true;
    });
  });
});

test('getLatestRelease: 其他非 2xx 抛普通 Error', async () => {
  await withFetch(async () => jsonResponse({ message: 'server error' }, 500), async () => {
    await assert.rejects(getLatestRelease(new AbortController().signal), (error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.name !== 'AbortError');
      return true;
    });
  });
});

test('getLatestRelease: draft 响应透传抛出', async () => {
  await withFetch(async () => jsonResponse(buildValidRelease({ draft: true })), async () => {
    await assert.rejects(getLatestRelease(new AbortController().signal));
  });
});

test('getLatestRelease: 外部 AbortController 取消 -> AbortError', async () => {
  await withFetch(async (_url, init) => {
    // 永远 pending 的 Promise，外部 abort 触发后 reject 一个 AbortError。
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    });
  }, async () => {
    const controller = new AbortController();
    // 先挂上断言再触发取消，避免竞态漏掉 reject。
    const pending = assert.rejects(getLatestRelease(controller.signal), (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, 'AbortError');
      return true;
    });
    controller.abort();
    await pending;
  });
});

test('getLatestRelease: 超时抛普通 Error（含超时描述）', async () => {
  // 模拟永不返回的请求：内部超时中止 signal 时 reject。
  await withFetch(async (_url, init) => {
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    });
  }, async () => {
    // 先挂上断言再启动，让 setTimeout/abort 时序落在断言之内。
    const promise = assert.rejects(getLatestRelease(new AbortController().signal, 5), (error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.name !== 'AbortError');
      assert.match(error.message, /超时|timeout/i);
      return true;
    });
    await promise;
  });
});

test('getLatestRelease: 默认 timeoutMs 不强制传入即生效', async () => {
  // 不传 timeoutMs，确认函数签名允许省略。
  await withFetch(async () => jsonResponse(buildValidRelease()), async () => {
    const summary = await getLatestRelease(new AbortController().signal);
    assert.equal(summary.version, '1.2.3');
  });
});

test('getLatestRelease: apkName 透传给资产选择', async () => {
  await withFetch(async () => jsonResponse(buildSplitRelease()), async () => {
    const summary = await getLatestRelease(
      new AbortController().signal,
      undefined,
      'app-armeabi-v7a-release.apk',
    );
    assert.equal(summary.assetId, 401);
    assert.equal(summary.url, 'https://github.com/yaotutu/pi-muse-mobile/releases/download/v1.2.3/app-armeabi-v7a-release.apk');
  });
});