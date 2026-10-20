"""通过 ADB/UIAutomator 操作真实 Expo Go UI；不注入页面状态或访问设备凭据。"""
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

root = pathlib.Path(sys.argv[1])
adb = os.environ.get('ADB', str(pathlib.Path.home() / 'Library/Android/sdk/platform-tools/adb'))
target = ['-s', os.environ['ANDROID_SERIAL']] if os.environ.get('ANDROID_SERIAL') else ['-e']
checks = []
tree = None
width, height = 1080, 2400


def sh(*args):
    return subprocess.check_output([adb, *target, *args], timeout=40)


def refresh():
    global tree
    sh('shell', 'uiautomator', 'dump', '/sdcard/activity-e2e.xml')
    tree = ET.fromstring(sh('exec-out', 'cat', '/sdcard/activity-e2e.xml'))
    return tree


def bounds(node):
    return list(map(int, re.findall(r'-?\d+', node.get('bounds', ''))))


def visible(node):
    b = bounds(node)
    return len(b) == 4 and b[2] > b[0] and b[3] > b[1] and 0 <= (b[0]+b[2])/2 < width and height*.04 <= (b[1]+b[3])/2 < height*.97


def find(label):
    matches = [n for n in tree.iter('node') if visible(n) and label in (n.get('content-desc'), n.get('text'), n.get('resource-id'))]
    return next((n for n in matches if n.get('clickable') == 'true'), matches[0] if matches else None)


def text():
    return '\n'.join(n.get('text', '') for n in tree.iter('node') if visible(n))


def swipe(down=False):
    # 限定在内容区，不误触顶栏或底部主 Tab；down 表示回到列表顶部。
    y1, y2 = (height*.38, height*.85) if down else (height*.87, height*.40)
    sh('shell', 'input', 'swipe', str(int(width*.92)), str(int(y1)), str(int(width*.92)), str(int(y2)), '400')
    time.sleep(.3)


def tap(label, scroll=False, down=False):
    for _ in range(14 if scroll else 7):
        refresh()
        node = find(label)
        if node is not None and node.get('enabled') != 'false':
            x1, y1, x2, y2 = bounds(node)
            sh('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
            time.sleep(.5)
            return
        if scroll:
            swipe(down)
        else:
            time.sleep(.5)
    raise AssertionError('No enabled visible control: '+label)


def seek(part, scroll=False, down=False):
    for _ in range(16 if scroll else 10):
        refresh()
        if part in text():
            return
        if scroll:
            swipe(down)
        else:
            time.sleep(.5)
    raise AssertionError('Missing visible text: '+part)


def status_filter(label):
    # 状态胶囊是横向列表；不能用父级纵向滚动寻找被横向裁剪的按钮。
    for reverse in (label == '全部活动状态',):
        for _ in range(8):
            refresh()
            node = find(label)
            if node is not None and node.get('clickable') == 'true':
                tap(label)
                return
            row = find('活动状态筛选')
            if row is None:
                swipe(down=True)
                continue
            x1, y1, x2, y2 = bounds(row)
            left, right, middle = int(x1+(x2-x1)*.12), int(x1+(x2-x1)*.88), (y1+y2)//2
            start, end = (left, right) if reverse else (right, left)
            sh('shell', 'input', 'swipe', str(start), str(middle), str(end), str(middle), '400')
    raise AssertionError('Missing horizontal activity filter: '+label)


def screenshot(name):
    refresh()
    (root / (name+'.xml')).write_bytes(ET.tostring(tree, encoding='utf-8'))
    (root / (name+'.png')).write_bytes(sh('exec-out', 'screencap', '-p'))


def save(passed=False, error=None):
    (root/'native-results.json').write_text(json.dumps({'passed': passed, 'checks': checks, 'error': error}, ensure_ascii=False, indent=2))


def passed(name, **data):
    checks.append({'name': name, **data})
    save()
    print('PASS NATIVE', name, flush=True)


def phase(wanted):
    end = time.time()+170
    while time.time() < end:
        data = json.loads((root/'context.json').read_text())
        if data['phase'] == wanted:
            return data
        if data['phase'] == 'failed':
            raise AssertionError('API harness failed: '+data['error'])
        time.sleep(.3)
    raise AssertionError('Timed out waiting for '+wanted)


def timeline(filename):
    expected = json.loads((root/filename).read_text())['steps']
    expected_ids = ['activity-step-'+s['runId']+'-'+s['id'] for s in expected]
    observed = []
    for _ in range(30):
        refresh()
        ids = [n.get('resource-id', '') for n in tree.iter('node') if visible(n) and n.get('resource-id', '').startswith('activity-step-')]
        for step_id in ids:
            assert step_id in expected_ids, ('Unexpected step', step_id)
            if step_id not in observed:
                observed.append(step_id)
        if len(observed) == len(expected_ids):
            break
        swipe()
    assert observed == expected_ids, ('Native step order differs from actual HTTP detail', observed, expected_ids)
    screenshot(filename.replace('.json', '-timeline'))
    passed('complete native timeline matches real HTTP order: '+filename, stepCount=len(observed))


try:
    size = sh('shell', 'wm', 'size').decode()
    width, height = map(int, re.findall(r'(\d+)x(\d+)', size)[-1])
    sh('reverse', 'tcp:8082', 'tcp:8082')
    # 仅重启测试宿主进程以加载最终 bundle，不清除应用数据或设备凭据。
    sh('shell', 'am', 'force-stop', 'host.exp.exponent')
    sh('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://127.0.0.1:8082', 'host.exp.exponent')
    for _ in range(25):
        refresh()
        if find('打开空间侧栏') is not None:
            break
        if find('Wait') is not None:
            tap('Wait')
        time.sleep(1)
    context = phase('incomplete')
    refresh()
    if find('关闭会话面板') is not None:
        tap('关闭会话面板')
    if find('关闭空间侧栏') is not None:
        tap('关闭空间侧栏')
    if find('切换到亮色主题') is not None:
        tap('切换到亮色主题')
    tap('应用')
    seek(context['base'])
    passed('native application is configured for the exact confirmed real service')
    tap('聊天')
    tap('打开空间侧栏')
    tap(context['spaceId'], scroll=True)
    tap('打开当前会话面板')
    tap('workspace-session-tab-history')
    tap('activity-open-'+context['id'], scroll=True)
    seek('等待明确继续')
    screenshot('incomplete-overview')
    passed('session history consumes actual unfinished activity without claiming completion')
    timeline('incomplete.json')
    # 保留在详情页退后台，由真实服务在后台推进同一工作。
    sh('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    (root/'native-background').write_text('Backgrounded on actual activity detail')
    context = phase('completed')
    sh('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://127.0.0.1:8082', 'host.exp.exponent')
    seek('结果：', scroll=True, down=True)
    seek(context['delivery'])
    screenshot('completed-overview')
    passed('foreground automatically consumes delivered completed result on original detail')
    tap('刷新活动详情', scroll=True, down=True)
    seek(context['delivery'], scroll=True)
    passed('explicit detail refresh retains actual delivered result')
    tap('切换到暗色主题')
    seek(context['delivery'])
    screenshot('completed-dark')
    passed('dark theme keeps actual selected activity/result')
    tap('切换到亮色主题')
    # 重新从顶部遍历，校验跨 run 的步骤复合键及原始顺序。
    tap('刷新活动详情', scroll=True, down=True)
    timeline('completed.json')
    (root/'native-completed').write_text('Native completion and two-run steps verified')
    context = phase('second')
    tap('返回活动列表', scroll=True, down=True)
    tap('刷新活动列表')
    seek(context['secondTitle'], scroll=True)
    screenshot('two-activities-list')
    passed('manual refresh discovers a new real activity on first page')
    tap('当前空间活动', scroll=True, down=True)
    tap('全部空间活动')
    seek(context['secondTitle'], scroll=True)
    tap('activity-open-'+context['secondId'], scroll=True)
    seek('已完成')
    passed('all-session filter opens second real completed activity')
    tap('返回活动列表', scroll=True, down=True)
    tap('当前空间活动')
    status_filter('等待明确继续')
    seek('当前范围没有已登记的活动', scroll=True)
    screenshot('empty-continuation-filter')
    passed('status filter shows real empty result, not completed work')
    status_filter('全部活动状态')
    tap('workspace-session-tab-activity')
    tap('查看关联活动', scroll=True, down=True)
    seek(context['secondTitle'], scroll=True, down=True)
    passed('current execution opens its explicitly associated activity')
    tap('关闭会话面板')
    tap('任务')
    seek('活动与执行历史')
    tap('activity-open-'+context['secondId'], scroll=True)
    seek(context['secondTitle'])
    screenshot('main-task-entry-detail')
    passed('main task entry consumes same actual activity detail')
    # 返回原主会话与聊天页，不替用户清除设备已保存连接信息。
    tap('聊天')
    tap('打开空间侧栏')
    tap('主会话', scroll=True, down=True)
    pid = sh('shell', 'pidof', 'host.exp.exponent').decode().strip().split()[0]
    logs = sh('logcat', '-d', '--pid='+pid, 'ReactNativeJS:E', 'AndroidRuntime:E', '*:S').decode()
    (root/'native-errors.log').write_text(logs)
    assert 'FATAL EXCEPTION' not in logs and 'ReactNativeJS:' not in logs, 'Native JS/fatal errors present'
    passed('current native process has no JS/fatal errors')
    save(True)
    (root/'native-done').write_text('All native checks passed')
except Exception as error:
    try:
        screenshot('native-failure')
    except Exception:
        pass
    save(False, str(error))
    print('FAIL NATIVE', str(error), flush=True)
    raise
