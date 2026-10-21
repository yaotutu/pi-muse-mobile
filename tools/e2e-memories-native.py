"""ADB 操作实际原生界面，不注入业务状态、不读取设备或服务端凭据。"""
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
tree = None
width, height = 1080, 2400
checks = []


def sh(*args):
    return subprocess.check_output([adb, *target, *args], timeout=40)


def refresh():
    global tree
    for _ in range(5):
        result = sh('shell', 'uiautomator', 'dump', '/sdcard/memories-e2e.xml')
        if b'dumped to' in result:
            tree = ET.fromstring(sh('exec-out', 'cat', '/sdcard/memories-e2e.xml'))
            return
        time.sleep(.5)
    raise AssertionError('Fresh UI hierarchy unavailable')


def bounds(node):
    return list(map(int, re.findall(r'-?\d+', node.get('bounds', ''))))


def visible(node):
    b = bounds(node)
    return len(b) == 4 and b[2] > b[0] and b[3] > b[1] and 0 <= (b[0]+b[2])/2 < width and height*.04 <= (b[1]+b[3])/2 < height*.97


def find(label):
    matches = [n for n in tree.iter('node') if visible(n) and label in (n.get('content-desc'), n.get('text'), n.get('resource-id'))]
    return next((n for n in matches if n.get('class') == 'android.widget.EditText'),
                next((n for n in matches if n.get('clickable') == 'true'), matches[0] if matches else None))


def swipe(down=False):
    areas = [bounds(n) for n in tree.iter('node') if n.get('class') == 'android.widget.ScrollView' and visible(n)
             and bounds(n)[2]-bounds(n)[0] > width*.5 and bounds(n)[3]-bounds(n)[1] > height*.25]
    x1, top, x2, bottom = areas[0] if areas else (0, height*.3, width, height*.9)
    upper, lower = top+(bottom-top)*.2, bottom-(bottom-top)*.1
    y1, y2 = (upper, lower) if down else (lower, upper)
    # 留出 Android 系统返回手势热区，避免把内容滚动误识别为离开当前页。
    x = int(x2-(x2-x1)*.25)
    sh('shell', 'input', 'swipe', str(x), str(int(y1)), str(x), str(int(y2)), '350')
    time.sleep(.3)


def tap(label, scroll=False, down=False):
    for _ in range(18 if scroll else 10):
        refresh()
        node = find(label)
        if node is not None and node.get('enabled') != 'false':
            x1, y1, x2, y2 = bounds(node)
            sh('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
            time.sleep(.4)
            return
        if scroll:
            swipe(down)
        else:
            time.sleep(.5)
    raise AssertionError('Missing enabled control: '+label)


def seek(part, scroll=False, down=False):
    for _ in range(18 if scroll else 12):
        refresh()
        if any(part in n.get('text', '') for n in tree.iter('node') if visible(n)):
            return
        if scroll:
            swipe(down)
        else:
            time.sleep(.5)
    raise AssertionError('Missing visible text: '+part)


def enter(label, value):
    tap(label, scroll=True, down=True)
    refresh()
    field = find(label)
    assert field is not None and field.get('class') == 'android.widget.EditText' and field.get('focused') == 'true', 'TextInput must actually have focus'
    old_length = len(field.get('text', ''))
    # 只输入 ASCII 验收标记；系统文本输入替换真实 TextInput，不执行 JS 或写入设备存储。
    sh('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END')
    sh('shell', 'input', 'keyevent', *(['KEYCODE_DEL']*(old_length+1)))
    sh('shell', 'input', 'text', value.replace(' ', '%s'))
    # AVD 使用硬件键盘时 BACK 会退出整个应用，必须先核对软键盘是否真的显示。
    state = sh('shell', 'dumpsys', 'input_method').decode()
    if 'mInputShown=true' in state or 'mIsInputViewShown=true' in state:
        sh('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    time.sleep(.3)
    refresh()
    assert find(label).get('text') == value, 'Native text entry did not replace exact field content'


def screenshot(name):
    refresh()
    (root/(name+'.xml')).write_bytes(ET.tostring(tree, encoding='utf-8'))
    (root/(name+'.png')).write_bytes(sh('exec-out', 'screencap', '-p'))


def save(passed=False, error=None):
    (root/'native-results.json').write_text(json.dumps({'passed': passed, 'checks': checks, 'error': error}, ensure_ascii=False, indent=2))


def passed(name):
    checks.append(name)
    save()
    print('PASS NATIVE', name, flush=True)


def signal(name):
    (root/('native-'+name)).write_text('Verified real UI: '+name)


def phase(wanted):
    end = time.time()+150
    while time.time() < end:
        data = json.loads((root/'context.json').read_text())
        if data['phase'] == wanted:
            return data
        if data['phase'] == 'failed':
            raise AssertionError('HTTP harness failed: '+data['error'])
        time.sleep(.3)
    raise AssertionError('Timed out waiting for '+wanted)


try:
    width, height = map(int, re.findall(r'(\d+)x(\d+)', sh('shell', 'wm', 'size').decode())[-1])
    context = phase('start')
    sh('reverse', 'tcp:8082', 'tcp:8082')
    sh('shell', 'am', 'force-stop', 'host.exp.exponent')
    sh('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://127.0.0.1:8082', 'host.exp.exponent')
    for _ in range(30):
        refresh()
        if find('打开空间侧栏') is not None:
            break
        if find('Wait') is not None:
            tap('Wait')
        time.sleep(1)
    refresh()
    tools = find('Tools')
    if tools is not None:
        x1, y1, x2, y2 = bounds(tools)
        sh('shell', 'input', 'swipe', str((x1+x2)//2), str((y1+y2)//2), str(int(width*.96)), str(int(height*.65)), '1000')
    if find('切换到亮色主题') is not None:
        tap('切换到亮色主题')
    tap('应用')
    seek(context['base'])
    tap('打开长期记忆', scroll=True)
    seek('所有空间共用')
    enter('记忆搜索关键词', context['marker'])
    tap('搜索记忆')
    seek('没有匹配的记忆', scroll=True)
    passed('exact real-service configuration and empty dedicated global-memory search')
    tap('新增记忆', scroll=True, down=True)
    enter('记忆内容', context['texts']['initial'])
    tap('保存记忆', scroll=True)
    seek('记忆已新增')
    seek(context['texts']['initial'], scroll=True)
    screenshot('created-light')
    signal('created')
    context = phase('created')
    tap('编辑记忆 '+context['id'], scroll=True)
    enter('记忆内容', context['texts']['edited'])
    tap('保存记忆', scroll=True)
    seek('记忆已更新')
    seek(context['texts']['edited'], scroll=True)
    passed('native create and edit persisted through real HTTP')
    signal('edited')
    phase('edited')
    tap('删除记忆 '+context['id'], scroll=True)
    tap('取消删除记忆', scroll=True, down=True)
    seek(context['texts']['edited'], scroll=True)
    signal('cancelled-delete')
    phase('cancel-verified')
    passed('delete confirmation can be cancelled without a write')
    enter('记忆搜索关键词', context['marker'].lower())
    tap('搜索记忆')
    seek(context['texts']['edited'], scroll=True)
    enter('记忆搜索关键词', context['marker']+'-absent')
    tap('搜索记忆')
    seek('没有匹配的记忆', scroll=True)
    tap('全部记忆', scroll=True, down=True)
    seek(context['texts']['edited'], scroll=True)
    passed('native case-insensitive search, no-match and all-list recovery')
    # 使用唯一关键词隔离截图和后续操作；不动用户已有记忆。
    enter('记忆搜索关键词', context['marker'])
    tap('搜索记忆')
    seek(context['texts']['edited'], scroll=True)
    tap('新增记忆', scroll=True, down=True)
    draft = context['marker']+' unsent-draft'
    enter('记忆内容', draft)
    tap('返回应用设置', scroll=True, down=True)
    tap('打开长期记忆', scroll=True)
    seek(draft, scroll=True)
    passed('leaving and reopening retains an unsent draft without creating a record')
    sh('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    signal('background')
    phase('foreground')
    sh('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://127.0.0.1:8082', 'host.exp.exponent')
    seek(draft, scroll=True, down=True)
    seek(context['texts']['foreground'], scroll=True)
    screenshot('foreground-light')
    passed('foreground reloads externally edited memory and preserves draft')
    tap('取消编辑记忆', scroll=True, down=True)
    signal('foreground')
    phase('manual-refresh')
    tap('刷新记忆', scroll=True, down=True)
    seek(context['texts']['refreshed'], scroll=True)
    tap('切换到暗色主题')
    seek(context['texts']['refreshed'])
    screenshot('refreshed-dark')
    tap('切换到亮色主题')
    passed('manual HTTP refresh and both themes retain the actual record')
    signal('refreshed')
    phase('delete')
    tap('删除记忆 '+context['id'], scroll=True)
    tap('确认删除记忆', scroll=True, down=True)
    seek('记忆已删除')
    seek('没有匹配的记忆', scroll=True)
    screenshot('deleted-light')
    signal('deleted')
    phase('done')
    tap('返回应用设置', scroll=True, down=True)
    tap('聊天')
    pid = sh('shell', 'pidof', 'host.exp.exponent').decode().strip().split()[0]
    logs = sh('logcat', '-d', '--pid='+pid, 'ReactNativeJS:E', 'AndroidRuntime:E', '*:S').decode()
    (root/'native-errors.log').write_text(logs)
    assert 'FATAL EXCEPTION' not in logs and 'ReactNativeJS:' not in logs, 'Current native process has JS/fatal errors'
    passed('confirmed deletion and no JS/fatal errors in current native process')
    save(True)
    signal('done')
except Exception as error:
    try:
        screenshot('native-failure')
    except Exception:
        pass
    save(False, str(error))
    print('FAIL NATIVE', str(error), flush=True)
    raise
