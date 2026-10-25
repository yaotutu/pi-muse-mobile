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
        # 压缩树排除无障碍服务不重要的节点，与实际读屏可访问性语义一致。
        result = sh('shell', 'uiautomator', 'dump', '--compressed', '/sdcard/themes-e2e.xml')
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


def header_bounds(space_name):
    # 三项分别核对；状态文案可随真实运行变化，但其占位必须固定。
    refresh()
    avatar = find('Pi Muse 头像')
    names = [n for n in tree.iter('node') if visible(n) and n.get('text') == space_name]
    status = find('workspace-session-status')
    assert avatar is not None and names and status is not None and status.get('text'), 'Missing native session avatar, name or real status'
    name = min(names, key=lambda n: bounds(n)[1])
    return bounds(avatar), bounds(name), bounds(status)


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
    # 最后一次滚动可能发生在 deadline 边界；超时判定前必须再看一次 fresh hierarchy。
    refresh()
    node = find(label)
    if node is not None:
        return node
    raise AssertionError('Missing native UI: '+label)


def tap(label, scrolling=False, down=False):
    node = wait(label, scrolling, down)
    assert node.get('enabled') != 'false', 'Disabled control: '+label
    x1, y1, x2, y2 = bounds(node)
    sh('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
    time.sleep(.35)


def enter(label, value):
    def typed_text(node):
        text = node.get('text')
        hint = node.get('hint')
        # Android 可能把空输入的 placeholder 同时导出为 text 与 hint；仅此情形视作空值。
        return '' if text == '' or (hint is not None and text == hint) else text

    tap(label)
    refresh()
    field = find(label)
    assert field.get('focused') == 'true' and field.get('class') == 'android.widget.EditText', 'Text input did not actually acquire focus: '+label
    # 多行框中 MOVE_END 只到当前行末；用原生全选快捷键后一次删除整段内容。
    sh('shell', 'input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A')
    sh('shell', 'input', 'keyevent', 'KEYCODE_DEL')
    # RN 受控输入可能在 DEL 注入后才异步清空；用有限采样次数等待连续两次稳定空值。
    empty_reads = 0
    for _ in range(3):
        refresh()
        field = find(label)
        if field is not None and field.get('class') == 'android.widget.EditText' and field.get('focused') == 'true' and typed_text(field) == '':
            empty_reads += 1
            if empty_reads == 2:
                break
        else:
            empty_reads = 0
        time.sleep(.15)
    assert empty_reads == 2, 'Input did not stabilize at an empty focused value: '+label
    # 分段 ASCII 输入并回读，避免长 ADB 文本被截断；不提交消息。
    for offset in range(0, len(value), 90):
        part = value[offset:offset+90].replace(' ', '%s').replace('"', '\\"')
        sh('shell', 'input', 'text', part)

    def window_state():
        return sh('shell', 'dumpsys', 'window').decode()

    def app_focused(state):
        focus = re.search(r'mCurrentFocus=[^\n]*', state)
        return focus is not None and 'host.exp.exponent/' in focus.group()

    def keyboard_visible(state):
        # 全局 mImeShowing 可能滞后；只认具体 InputMethod 窗口的真实 Surface/可见状态。
        return any(
            'mIsImWindow=true' in block and 'mHasSurface=true' in block and 'isVisible=true' in block
            for match in re.finditer(r'(?ms)^  Window #\d+ .*?(?=^  Window #\d+ |\Z)', state)
            for block in [match.group(0)]
            if 'InputMethod}' in block.splitlines()[0]
        )

    # IMS 的 mInputShown/mIsInputViewShown 可能滞后；只用 WindowManager 显示态和应用焦点判断。
    shown = False
    stable = time.time()+1
    while time.time() < stable:
        state = window_state()
        assert app_focused(state), 'Input lost Expo foreground focus: '+label
        if keyboard_visible(state):
            shown = True
            break
        if time.time() >= stable:
            break
        time.sleep(.15)
    if shown:
        sh('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        hidden = time.time()+2
        while time.time() < hidden:
            state = window_state()
            if app_focused(state) and not keyboard_visible(state):
                break
            time.sleep(.15)
        state = window_state()
        assert app_focused(state) and not keyboard_visible(state), 'Keyboard did not hide without leaving Expo: '+label
    else:
        assert app_focused(state), 'Input finished outside Expo foreground: '+label

    refresh()
    field = find(label)
    assert field is not None and typed_text(field) == value, 'Exact text input mismatch: '+label


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
    def expo_menu_visible():
        texts = {n.get('text') for n in tree.iter('node') if visible(n)}
        return 'Reload' in texts and 'Go home' in texts and any(text.startswith('SDK version:') for text in texts if text)

    menu_closed = False
    deadline = time.time()+100
    while time.time() < deadline:
        refresh()
        if expo_menu_visible():
            # 冷启动偶发的 Expo Go 开发菜单是原生 Modal；身份明确后只关闭一次。
            if not menu_closed:
                sh('shell', 'input', 'keyevent', 'KEYCODE_BACK')
                menu_closed = True
        elif find('打开空间侧栏') is not None:
            return
        time.sleep(.4)
    raise AssertionError('Fresh native workspace unavailable after Expo startup')


def exact_node(label):
    return next((n for n in tree.iter('node') if visible(n) and n.get('content-desc') == label), None)


def tap_space_row(label):
    node = exact_node(label)
    assert node is not None and node.get('clickable') == 'true' and node.get('class') != 'android.widget.EditText', 'Missing actual space row: '+label
    x1, y1, x2, y2 = bounds(node)
    sh('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
    time.sleep(.35)


def space_selected(identity_text):
    identity = exact_node('打开当前会话面板')
    # 关闭按钮是常驻侧栏树；前景遮罩只在 drawerOpen 时条件渲染，才是侧栏仍打开的证据。
    if identity is None or exact_node('收起空间侧栏') is not None:
        return False
    return identity_text is None or any(n.get('text') == identity_text for n in identity.iter('node'))


def select_space(label, query, identity_text=None):
    tap('打开空间侧栏')
    direct = time.time()+1.2
    while time.time() < direct:
        refresh()
        if exact_node(label) is not None:
            break
        time.sleep(.25)
    else:
        # 只有目标行不在当前视口时才过滤；避免键盘收起动画吞掉首点。
        enter('搜索空间', query)
        time.sleep(.35)
    tap_space_row(label)
    # 后置条件必须同时证明前景可见和身份正确；补点仅限侧栏与目标行仍然确切存在。
    for attempt in range(2):
        settled = time.time()+2.5
        while time.time() < settled:
            refresh()
            if space_selected(identity_text):
                return
            time.sleep(.25)
        refresh()
        if attempt == 0 and exact_node('收起空间侧栏') is not None and exact_node(label) is not None:
            tap_space_row(label)
    assert False, 'Space selection did not reach foreground identity: '+label


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
    select_space(context['spaceId'], context['spaceId'], context['spaceId'])
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
        chat_header = header_bounds(context['spaceId'])
        tap('打开当前会话面板')
        assert header_bounds(context['spaceId']) == chat_header, 'Session avatar, name or status moved after opening panel'
        refresh()
        assert find('消息输入框') is None and find('应用') is None, 'Panel exposes background chat or main navigation'
        if theme == 'classic':
            # 系统返回先关闭面板，不能离开应用；再次打开后侧栏边缘手势不得拉出抽屉。
            sh('shell', 'input', 'keyevent', 'KEYCODE_BACK')
            assert wait('消息输入框').get('text') == context['draft'], 'System Back left chat or lost draft'
            tap('打开当前会话面板')
            y = str(int(height*.45))
            sh('shell', 'input', 'touchscreen', 'swipe', str(int(width*.02)), y, str(int(width*.36)), y, '220')
            refresh()
            assert find('你的空间') is None, 'Drawer opened through session panel gesture'
            if find('关闭会话面板') is None:
                tap('打开当前会话面板')  # Android 系统边缘返回可能先关闭面板。
            # 原生连续触控在关闭动画未结束时再次点击同一位置，核对转场反向可用。
            close = wait('关闭会话面板')
            x1, y1, x2, y2 = bounds(close)
            x, y = str((x1+x2)//2), str((y1+y2)//2)
            # 同一次设备 shell 内连续发两次真实触控；用设备 uptime 对整段输入计时，
            # 整段小于 260ms 才能证明第二次触控确实落在关闭动画期间。
            timing = sh('shell',
                        f'read start rest </proc/uptime; input tap {x} {y}; sleep 0.02; '
                        f'input tap {x} {y}; read end rest </proc/uptime; echo "$start $end"')
            start, end = map(float, timing.decode().strip().split()[-2:])
            assert end - start < .26, 'Native tap driver exceeded the 260ms transition window'
            time.sleep(.35)
            refresh()
            assert find('关闭会话面板') is not None, 'Rapid close and reopen did not reverse panel transition'
            assert header_bounds(context['spaceId']) == chat_header, 'Rapid transition moved session header'
            passed('native Back, drawer gesture isolation and rapid panel reversal')
        tap('历史')
        tap('当前空间活动')
        wait('还没有已登记的活动')
        capture(theme+'-history')
        # 往返明暗不关闭面板、不重置 Tab 或筛选，且返回当前选中的浅色方案。
        first = '切换到亮色主题' if theme == 'dark' else '切换到暗色主题'
        second = '切换到暗色主题' if theme == 'dark' else '切换到亮色主题'
        tap(first)
        assert wait('历史').get('selected') == 'true'
        assert wait('当前空间活动').get('selected') == 'true'
        assert header_bounds(context['spaceId']) == chat_header, 'Theme switch moved session avatar, name or status'
        tap(second)
        assert wait('历史').get('selected') == 'true'
        wait('还没有已登记的活动')
        assert header_bounds(context['spaceId']) == chat_header, 'Theme roundtrip moved session header'
        tap('关闭会话面板')
        assert wait('消息输入框').get('text') == context['draft']
        assert header_bounds(context['spaceId']) == chat_header, 'Session avatar, name or status moved after closing panel'
        passed(theme+' selection, real connection modal, stable header, isolated panel, preserved space/draft/filter and quick-toggle roundtrip')
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
        select_space(context['spaceId'], context['spaceId'], context['spaceId'])
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
