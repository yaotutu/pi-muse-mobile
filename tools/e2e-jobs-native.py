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
density = 1
checks = []


def sh(*args):
    return subprocess.check_output([adb, *target, *args], timeout=40)


def refresh():
    global tree
    for attempt in range(5):
        try:
            result = sh('shell', 'uiautomator', 'dump', '/sdcard/jobs-e2e.xml')
        except subprocess.CalledProcessError as error:
            # 仅有界重试被终止的只读采样；不重放业务操作，也不读取上次 XML 冒充新界面。
            if error.returncode != 137 or attempt == 4:
                raise
            print('RETRY native hierarchy dump terminated with137', attempt + 1, flush=True)
            time.sleep(.5)
            continue
        if b'dumped to' in result:
            tree = ET.fromstring(sh('exec-out', 'cat', '/sdcard/jobs-e2e.xml'))
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


def tappable(node):
    if not visible(node) or node.get('enabled') == 'false':
        return False
    x1, y1, x2, y2 = bounds(node)
    # 父按钮可能只露出一条边，UIAutomator 仍称其可见；文字被裁空时先滚动，不能假定点击已生效。
    for child in node.iter('node'):
        if child is node or not child.get('text') or child.get('class') == 'android.widget.EditText':
            continue
        if not visible(child):
            return False
        left, top, right, bottom = bounds(child)
        if left < x1 or top < y1 or right > x2 or bottom > y2:
            return False
    return True


def selection_popup_visible(state):
    focus = re.search(r'mCurrentFocus=[^\n]*', state)
    if not focus or 'host.exp.exponent/' not in focus.group():
        return False
    # 系统文字选择浮栏不在应用的 XML 根中；只识别本应用当前显示的浮栏，不能盲发 Back。
    return any('PopupWindow:' in block and 'package=host.exp.exponent ' in block
               and 'ty=APPLICATION_ABOVE_SUB_PANEL' in block and 'isVisible=true' in block
               and 'Surface: shown=true' in block
               for block in re.split(r'(?m)^  Window #\d+ ', state))


def dismiss_selection():
    if selection_popup_visible(sh('shell', 'dumpsys', 'window').decode()):
        sh('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        time.sleep(.2)


def swipe(down=False):
    dismiss_selection()
    areas = [bounds(n) for n in tree.iter('node') if n.get('class') == 'android.widget.ScrollView' and visible(n)
             and bounds(n)[2]-bounds(n)[0] > width*.5 and bounds(n)[3]-bounds(n)[1] > height*.25]
    x1, top, x2, bottom = areas[0] if areas else (0, height*.3, width, height*.9)
    upper, lower = top+(bottom-top)*.2, bottom-(bottom-top)*.1
    y1, y2 = (upper, lower) if down else (lower, upper)
    # 在返回手势热区外的卡片内边距滑动，不拖拽 selectable 文字或系统选择句柄。
    x = int(min(x2-1, x1+36*density))
    sh('shell', 'input', 'swipe', str(x), str(int(y1)), str(x), str(int(y2)), '350')
    time.sleep(.3)


def tap(label, scroll=False, down=False):
    for _ in range(18 if scroll else 10):
        dismiss_selection()
        refresh()
        node = find(label)
        if node is not None and tappable(node):
            x1, y1, x2, y2 = bounds(node)
            sh('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
            print('UI tap', label, flush=True)
            time.sleep(.4)
            return
        if scroll:
            swipe(down)
        else:
            time.sleep(.5)
    raise AssertionError('Missing enabled control: '+label)


def seek(part, scroll=False, down=False):
    for _ in range(18 if scroll else 12):
        dismiss_selection()
        refresh()
        if any(part in n.get('text', '') for n in tree.iter('node') if visible(n)):
            return
        if scroll:
            swipe(down)
        else:
            time.sleep(.5)
    raise AssertionError('Missing visible text: '+part)


def dismiss_keyboard():
    # Gboard 的 mIsInputViewShown 在窗口隐藏后仍可能为 true，不能据此发 Back。
    # 使用 WindowManager 当前显示状态且焦点确为受测应用，避免误退出或操作其他应用。
    state = sh('shell', 'dumpsys', 'window').decode()
    focus = re.search(r'mCurrentFocus=[^\n]*', state)
    if re.search(r'\bmImeShowing\s*=\s*true\b', state) and focus and 'host.exp.exponent' in focus.group():
        sh('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        time.sleep(.3)


def enter(label, value, down=False):
    dismiss_keyboard()
    tap(label, scroll=True, down=down)
    # IME 会压缩视口并暂时给已聚焦控件返回反向裁剪 bounds；先正常收起键盘再输入。
    dismiss_keyboard()
    refresh()
    def input_node():
        return next((node for node in tree.iter('node') if node.get('class') == 'android.widget.EditText' and node.get('content-desc') == label and node.get('focused') == 'true'), None)
    field = input_node()
    assert field is not None and field.get('class') == 'android.widget.EditText' and field.get('focused') == 'true', 'TextInput must actually have focus'
    # 多行输入的 MOVE_END 只到当前行末；使用真实系统全选，避免连续删除与受控输入竞争。
    # 只输入 ASCII 验收标记，不执行 JS、不读取或写入设备凭据。
    sh('shell', 'input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A')
    sh('shell', 'input', 'keyevent', 'KEYCODE_DEL')
    time.sleep(.4)
    refresh()
    cleared = input_node()
    # UIAutomator 把空 TextInput 的 placeholder 同时作为 text 暴露；最终仍逐字核对新值。
    assert cleared.get('text', '') in ('', cleared.get('hint', '')), 'System select-all must clear the exact focused field'
    sh('shell', 'input', 'text', value.replace(' ', '%s'))
    dismiss_keyboard()
    time.sleep(.3)
    refresh()
    assert input_node().get('text') == value, 'Native text entry did not replace exact field content'


def screenshot(name):
    dismiss_selection()
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
    end = time.time()+900
    while time.time() < end:
        data = json.loads((root/'context.json').read_text())
        if data['phase'] == wanted:
            return data
        if data['phase'] == 'failed':
            raise AssertionError('HTTP harness failed: '+data['error'])
        time.sleep(.3)
    raise AssertionError('Timed out waiting for '+wanted)


def tasks():
    tap('任务')
    tap('定时任务', scroll=True, down=True)


def control(action):
    tap(action, scroll=True)
    tap('确认'+action, scroll=True)
    seek(action+'已提交', scroll=True, down=True)


try:
    width, height = map(int, re.findall(r'(\d+)x(\d+)', sh('shell', 'wm', 'size').decode())[-1])
    density = int(re.findall(r'density:\s*(\d+)', sh('shell', 'wm', 'density').decode())[-1])/160
    context = phase('start')
    sh('reverse', 'tcp:8082', 'tcp:8082')
    sh('shell', 'am', 'force-stop', 'host.exp.exponent')
    sh('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://127.0.0.1:8082', 'host.exp.exponent')
    for _ in range(35):
        refresh()
        if find('打开空间侧栏') is not None:
            break
        # Expo Go 可在冷启动时恢复开发菜单；只关闭可见菜单，不清除应用数据。
        if find('Close') is not None and find('Reload') is not None:
            tap('Close')
            continue
        if find('Wait') is not None:
            tap('Wait')
        time.sleep(1)
    refresh()
    tools = find('Tools')
    if tools is not None:
        x1, y1, x2, y2 = bounds(tools)
        sh('shell', 'input', 'swipe', str((x1+x2)//2), str((y1+y2)//2), str(int(width*.96)), str(int(height*.65)), '1000')
    tap('设置')
    seek(context['base'])
    tap('选择经典蓝白主题', scroll=True)
    tap('聊天')
    tap('打开空间侧栏')
    tap(context['spaceId'], scroll=True)
    tasks()
    tap('当前空间定时任务', scroll=True)
    tap('查看定时任务 '+context['id'], scroll=True)
    seek(context['spaceId'], scroll=True)
    screenshot('detail-classic')
    passed('native real-service connection, source scope, nonempty list and detail')
    tap('编辑定时任务', scroll=True)
    enter('定时任务内容', context['texts']['edited'], down=True)
    tap('每日重复', scroll=True)
    enter('定时任务时刻', '24:00')
    tap('保存定时任务', scroll=True)
    seek('执行时间请填写 HH:mm', scroll=True, down=True)
    enter('定时任务时刻', '09:00')
    tap('保存定时任务', scroll=True)
    seek('任务已更新', scroll=True, down=True)
    seek('每天 09:00', scroll=True)
    screenshot('daily-classic')
    passed('invalid clock rejected locally; native daily edit persists HH:mm with server-zone caption')
    signal('daily')
    phase('daily')
    tap('编辑定时任务', scroll=True)
    tap('仅一次', scroll=True, down=True)
    enter('定时任务日期', context['onceDate'])
    enter('定时任务时刻', '09:30')
    tap('保存定时任务', scroll=True)
    seek('任务已更新', scroll=True, down=True)
    screenshot('once-classic')
    signal('once')
    phase('once')
    control('暂停调度')
    signal('paused')
    phase('paused')
    control('恢复调度')
    signal('resumed')
    phase('resumed')
    tap('取消任务', scroll=True)
    tap('放弃任务操作', scroll=True)
    seek('已排期', scroll=True, down=True)
    control('取消任务')
    signal('cancelled')
    phase('cancelled')
    passed('native pause/resume/cancel use explicit confirmations and show authoritative readback')
    tap('编辑定时任务', scroll=True)
    enter('定时任务内容', context['texts']['draft'], down=True)
    tap('聊天')
    tasks()
    seek(context['texts']['draft'], scroll=True)
    tap('设置')
    tap('选择晨光白主题', scroll=True)
    tasks()
    seek(context['texts']['draft'], scroll=True)
    screenshot('draft-daylight')
    tap('切换到暗色主题')
    seek(context['texts']['draft'])
    screenshot('draft-midnight')
    tap('切换到亮色主题')
    passed('draft survives main-tab navigation and all three theme presets without re-creating a task')
    sh('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    signal('background')
    phase('foreground')
    sh('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://127.0.0.1:8082', 'host.exp.exponent')
    dismiss_keyboard()
    seek(context['texts']['draft'], scroll=True, down=True)
    seek(context['texts']['foreground'], scroll=True)
    tap('保存定时任务', scroll=True, down=True)
    seek('其他地方更新', scroll=True, down=True)
    tap('取消编辑定时任务', scroll=True)
    passed('foreground reads external real update, preserves draft and prevents overwriting external changes')
    signal('foreground')
    context = phase('trigger')
    tap('返回定时任务列表', scroll=True, down=True)
    tap('查看定时任务 '+context['id'], scroll=True)
    seek('已排期', scroll=True)
    signal('trigger-visible')
    phase('delivered')
    tap('刷新定时任务', scroll=True, down=True)
    seek('上次成功', scroll=True)
    seek('最近执行结果', scroll=True)
    seek(context['marker'], scroll=True)
    screenshot('automatic-result')
    signal('delivered')
    context = phase('retry-ready')
    tap('返回定时任务列表', scroll=True, down=True)
    tap('查看定时任务 '+context['id'], scroll=True)
    seek('上次失败', scroll=True)
    tap('立即重试', scroll=True)
    tap('放弃任务操作', scroll=True)
    signal('retry-cancelled')
    phase('retry-confirm')
    control('立即重试')
    signal('retried')
    phase('retry-done')
    tap('刷新定时任务', scroll=True, down=True)
    seek('上次成功', scroll=True)
    screenshot('retry-success')
    passed('actual scheduler result, legitimate failure and confirmed retry are consumed by native detail')
    tap('删除定时任务', scroll=True)
    tap('放弃任务操作', scroll=True)
    signal('delete-cancelled')
    phase('delete-confirm')
    tap('删除定时任务', scroll=True)
    tap('确认删除任务', scroll=True)
    seek('删除任务已提交', scroll=True, down=True)
    seek('还没有定时任务', scroll=True)
    screenshot('deleted')
    signal('deleted')
    phase('done')
    tap('设置')
    tap('选择经典蓝白主题', scroll=True)
    tap('聊天')
    tap('打开空间侧栏')
    tap('主空间', scroll=True)
    pid = sh('shell', 'pidof', 'host.exp.exponent').decode().strip().split()[0]
    logs = sh('logcat', '-d', '--pid='+pid, 'ReactNativeJS:E', 'AndroidRuntime:E', '*:S').decode()
    (root/'native-errors.log').write_text(logs)
    assert 'FATAL EXCEPTION' not in logs and 'ReactNativeJS:' not in logs, 'Current native process has JS/fatal errors'
    passed('cancelled deletion has no effect; confirmed deletion is real; no current-process JS/fatal errors')
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
