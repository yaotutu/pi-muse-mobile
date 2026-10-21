"""ADB 驱动真实应用；不写偏好文件、不注入状态、不读取设备凭据。"""
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

root = pathlib.Path(sys.argv[1])
context = json.loads((root/'context.json').read_text())
adb = os.environ.get('ADB', str(pathlib.Path.home()/'Library/Android/sdk/platform-tools/adb'))
target = ['-s', os.environ['ANDROID_SERIAL']] if os.environ.get('ANDROID_SERIAL') else ['-e']
tree = None
width, height = 1080, 2400
checks = []
original_size = None
size_changed = False
themes = {'classic': '经典蓝白', 'light': '晨光白', 'dark': '深夜黑'}
saved_note = '主题保存在本机；亮暗快捷键会返回上次选择的浅色主题。'


def sh(*args):
    return subprocess.check_output([adb, *target, *args], timeout=45)


def refresh():
    global tree
    for _ in range(5):
        result = sh('shell', 'uiautomator', 'dump', '/sdcard/themes-e2e.xml')
        if b'dumped to' in result:
            tree = ET.fromstring(sh('exec-out', 'cat', '/sdcard/themes-e2e.xml'))
            return
        time.sleep(.4)
    raise AssertionError('Fresh native hierarchy unavailable')


def bounds(node):
    return list(map(int, re.findall(r'-?\d+', node.get('bounds', ''))))


def visible(node):
    b = bounds(node)
    return len(b) == 4 and b[2] > b[0] and b[3] > b[1] and 0 <= (b[0]+b[2])/2 < width and height*.03 < (b[1]+b[3])/2 < height*.98


def find(label):
    nodes = [n for n in tree.iter('node') if visible(n) and label in (n.get('text'), n.get('content-desc'), n.get('resource-id'))]
    return next((n for n in nodes if n.get('class') == 'android.widget.EditText'),
                next((n for n in nodes if n.get('clickable') == 'true'), nodes[0] if nodes else None))


def scroll(down=False):
    areas = [bounds(n) for n in tree.iter('node') if visible(n) and n.get('class') == 'android.widget.ScrollView' and bounds(n)[3]-bounds(n)[1] > height*.25]
    left, top, right, bottom = areas[0] if areas else (0, height*.25, width, height*.89)
    high, low = top+(bottom-top)*.2, bottom-(bottom-top)*.12
    start, end = (high, low) if down else (low, high)
    # 不在系统返回手势热区滚动，否则 Android 会先离开应用页而非滚动设置。
    x = int(right-(right-left)*.25)
    # 使用完整触屏拖动，给冷启动后的模拟器足够时间交接 Pressable 与原生滚动手势。
    sh('shell', 'input', 'touchscreen', 'swipe', str(x), str(int(start)), str(x), str(int(end)), '1000')
    time.sleep(.5)


def wait(label, scrolling=False, down=False, seconds=45):
    end = time.time()+seconds
    while time.time() < end:
        refresh()
        node = find(label)
        if node is not None:
            return node
        if scrolling:
            scroll(down)
        else:
            time.sleep(.4)
    raise AssertionError('Missing native UI: '+label)


def tap(label, scrolling=False, down=False):
    node = wait(label, scrolling, down)
    assert node.get('enabled') != 'false', 'Disabled control: '+label
    x1, y1, x2, y2 = bounds(node)
    sh('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
    time.sleep(.35)


def enter(label, value):
    tap(label)
    refresh()
    field = find(label)
    assert field.get('focused') == 'true' and field.get('class') == 'android.widget.EditText', 'Text input did not actually acquire focus: '+label
    count = len(field.get('text', ''))
    sh('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END')
    sh('shell', 'input', 'keyevent', *(['KEYCODE_DEL']*(count+1)))
    # 分段 ASCII 输入并回读，避免长 ADB 文本被截断；不提交消息。
    for offset in range(0, len(value), 90):
        part = value[offset:offset+90].replace(' ', '%s').replace('"', '\\"')
        sh('shell', 'input', 'text', part)
    state = sh('shell', 'dumpsys', 'input_method').decode()
    if 'mInputShown=true' in state or 'mIsInputViewShown=true' in state:
        sh('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    refresh()
    assert find(label).get('text') == value, 'Exact text input mismatch'


def capture(name):
    refresh()
    (root/(name+'.xml')).write_bytes(ET.tostring(tree, encoding='utf-8'))
    (root/(name+'.png')).write_bytes(sh('exec-out', 'screencap', '-p'))


def save(passed=False, error=None):
    (root/'native-results.json').write_text(json.dumps({'passed': passed, 'checks': checks, 'error': error}, ensure_ascii=False, indent=2))


def passed(name):
    checks.append(name)
    save()
    print('PASS NATIVE', name, flush=True)


def launch():
    sh('shell', 'am', 'force-stop', 'host.exp.exponent')
    sh('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://127.0.0.1:8082', 'host.exp.exponent')
    wait('打开空间侧栏', seconds=100)
    tools = find('Tools')
    if tools is not None:
        x1, y1, x2, y2 = bounds(tools)
        sh('shell', 'input', 'swipe', str((x1+x2)//2), str((y1+y2)//2), str(int(width*.96)), str(int(height*.65)), '1000')


def select_space(label, query):
    tap('打开空间侧栏')
    enter('搜索空间', query)
    # 搜索框的值与目标 ID 相同，只能点击空间行的无障碍标签，不能误点输入框。
    refresh()
    node = next((n for n in tree.iter('node') if visible(n) and n.get('content-desc') == label and n.get('clickable') == 'true' and n.get('class') != 'android.widget.EditText'), None)
    assert node is not None, 'Missing actual space row: '+label
    x1, y1, x2, y2 = bounds(node)
    sh('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
    time.sleep(.4)


def choose_theme(theme):
    tap('选择'+themes[theme]+'主题', scrolling=True)
    node = wait('选择'+themes[theme]+'主题')
    assert node.get('checked') == 'true', 'Theme radio must actually be checked'
    wait(saved_note, scrolling=True)


def theme_checked(theme):
    node = wait('选择'+themes[theme]+'主题', scrolling=True)
    assert node.get('checked') == 'true', 'Restored wrong theme: '+theme


try:
    original_size = sh('shell', 'wm', 'size').decode()
    width, height = map(int, re.findall(r'(\d+)x(\d+)', original_size)[-1])
    sh('reverse', 'tcp:8082', 'tcp:8082')
    launch()
    select_space(context['spaceId'], context['spaceId'])
    identity = wait('打开当前会话面板')
    assert any(n.get('text') == context['spaceId'] for n in identity.iter('node')), 'Dedicated space must be selected before typing'
    enter('消息输入框', context['draft'])
    for theme in themes:
        tap('应用')
        choose_theme(theme)
        capture(theme+'-picker')
        tap('服务器连接', scrolling=True, down=True)
        wait(context['base'])
        capture(theme+'-connection')
        tap('关闭服务器连接')
        tap('聊天')
        assert wait('消息输入框').get('text') == context['draft'], 'Theme switch lost unsent draft'
        wait(context['spaceId'])
        capture(theme+'-chat')
        tap('打开当前会话面板')
        tap('历史')
        tap('当前空间活动')
        wait('还没有已登记的活动')
        capture(theme+'-history')
        # 往返明暗不关闭 Modal、不重置 Tab 或筛选，且返回当前选中的浅色方案。
        first = '切换到亮色主题' if theme == 'dark' else '切换到暗色主题'
        second = '切换到暗色主题' if theme == 'dark' else '切换到亮色主题'
        tap(first)
        assert wait('历史').get('selected') == 'true'
        assert wait('当前空间活动').get('selected') == 'true'
        tap(second)
        assert wait('历史').get('selected') == 'true'
        wait('还没有已登记的活动')
        tap('关闭会话面板')
        assert wait('消息输入框').get('text') == context['draft']
        passed(theme+' selection, real connection modal, preserved space/draft/panel/filter and quick-toggle roundtrip')
    tap('应用')
    choose_theme('classic')
    tap('聊天')
    enter('消息输入框', context['prompt'])
    tap('发送消息')
    wait(context['response'], seconds=150)
    capture('classic-real-chat')
    (root/'native-chat').write_text('Actual streamed assistant response visible')
    passed('real UI sends one dedicated message and renders actual streamed assistant reply')
    # 三套主题逐一跨进程恢复；同时恢复连接并回读专用空间历史，不能只核对设置页。
    for theme in ['light', 'dark', 'classic']:
        tap('应用')
        choose_theme(theme)
        launch()
        select_space(context['spaceId'], context['spaceId'])
        wait(context['response'], seconds=80)
        tap('应用')
        theme_checked(theme)
        capture(theme+'-cold-restored')
        tap('聊天')
        passed(theme+' preference survives process restart alongside real connection/history restore')
    # 仅覆写模拟器尺寸复核 320dp 窄屏；finally 恢复原尺寸，不冒充物理设备。
    sh('shell', 'wm', 'size', '840x1491')
    size_changed = True
    width, height = 840, 1491
    time.sleep(1)
    tap('应用')
    for theme in ['light', 'dark', 'classic']:
        choose_theme(theme)
    capture('narrow-classic-picker')
    passed('all three choices remain reachable and selectable on 320dp narrow layout')
    if 'Override size:' in original_size:
        sh('shell', 'wm', 'size', re.findall(r'Override size: (\d+x\d+)', original_size)[0])
    else:
        sh('shell', 'wm', 'size', 'reset')
    size_changed = False
    width, height = map(int, re.findall(r'(\d+)x(\d+)', original_size)[-1])
    tap('聊天')
    select_space('主空间', 'main')
    pid = sh('shell', 'pidof', 'host.exp.exponent').decode().strip().split()[0]
    logs = sh('logcat', '-d', '--pid='+pid, 'ReactNativeJS:E', 'AndroidRuntime:E', '*:S').decode()
    (root/'native-errors.log').write_text(logs)
    assert 'FATAL EXCEPTION' not in logs and 'ReactNativeJS:' not in logs, 'Current process contains native/JS errors'
    passed('returned to main space with classic theme; no JS/fatal errors')
    save(True)
except Exception as error:
    try:
        capture('native-failure')
    except Exception:
        pass
    save(False, str(error))
    print('FAIL NATIVE', error, flush=True)
    sys.exit(1)
finally:
    if size_changed:
        if 'Override size:' in original_size:
            sh('shell', 'wm', 'size', re.findall(r'Override size: (\d+x\d+)', original_size)[0])
        else:
            sh('shell', 'wm', 'size', 'reset')
