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
status_help_evidence = []


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


def scroll(down=False, fast=False):
    areas = [bounds(n) for n in tree.iter('node') if visible(n) and n.get('class') == 'android.widget.ScrollView' and bounds(n)[3]-bounds(n)[1] > height*.25]
    left, top, right, bottom = areas[0] if areas else (0, height*.25, width, height*.89)
    high, low = top+(bottom-top)*.2, bottom-(bottom-top)*.12
    start, end = (high, low) if down else (low, high)
    # 不在系统返回手势热区滚动，否则 Android 会先离开应用页而非滚动设置。
    # 窄屏沿卡片左内边距拖动，避开输入框、右侧开关与 Expo 开发悬浮入口。
    x = int(left+(right-left)*(.1 if fast else .75))
    # 窄视口采用已实测的短滑动；慢拖在该模拟器中位移过小，长列表保留原有手势。
    sh('shell', 'input', 'touchscreen', 'swipe', str(x), str(int(start)), str(x), str(int(end)), '200' if fast else '1000')
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


def tap_node(node):
    # 新增分段检查在动作前已持有新鲜树；直接使用节点边界，避免 tap 内再次 dump。
    assert node is not None and node.get('enabled') != 'false', 'Missing or disabled native node'
    x1, y1, x2, y2 = bounds(node)
    sh('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
    time.sleep(.35)


def capture_current(name):
    # 供已核对的新鲜树留证：截图不再触发第二次 uiautomator dump。
    (root/(name+'.xml')).write_bytes(ET.tostring(tree, encoding='utf-8'))
    (root/(name+'.png')).write_bytes(sh('exec-out', 'screencap', '-p'))


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


def reveal_label(label, down=False, scrolls=2, fast_scroll=False):
    # 动作后先检查当前新鲜树；仅目标未出现时才做有限等待/滚动。
    node = find(label)
    if node is not None:
        return node
    time.sleep(.2)
    refresh()
    node = find(label)
    if node is not None:
        return node
    for _ in range(scrolls):
        node = find(label)
        if node is not None:
            return node
        scroll(down, fast=fast_scroll or width == 840)
        refresh()
    refresh()
    node = find(label)
    if node is not None:
        return node
    raise AssertionError('Missing native UI: '+label)


def reveal_labels_together(labels, down=False, scrolls=3):
    # 仅用于确认/取消这类短按钮组；长文与入口仍逐项定位。
    nodes = [find(label) for label in labels]
    if all(node is not None for node in nodes):
        return nodes
    for _ in range(scrolls):
        scroll(down, fast=width == 840)
        refresh()
        nodes = [find(label) for label in labels]
        if all(node is not None for node in nodes):
            return nodes
    missing = [label for label, node in zip(labels, nodes) if node is None]
    raise AssertionError('Missing native UI together: '+', '.join(missing))


def has_resource(node, resource):
    # RN testID 在部分 Android 版本会带包名前缀；契约仍以完整后缀为准。
    value = node.get('resource-id', '')
    return value == resource or value.endswith(':'+resource)


def assert_absent_current(labels):
    present = [label for label in labels if find(label) is not None]
    assert not present, 'Native nodes unexpectedly remain: '+', '.join(present)


def assert_selected_tab(labels, expected):
    selected = []
    for label in labels:
        nodes = [n for n in tree.iter('node') if visible(n) and n.get('content-desc') == label]
        assert nodes, 'Missing native tab: '+label
        node = next((n for n in nodes if n.get('clickable') == 'true'), nodes[0])
        if node.get('selected') == 'true':
            selected.append(label)
        if label == expected:
            assert node.get('selected') == 'true', 'Native tab was not selected: '+label
    assert selected == [expected], 'Native tab selection is not unique: '+str(selected)


def assert_segment_tab(tab, panels, hidden_resources, down=False):
    resource, marker = panels[tab]
    marker_node = reveal_label(marker, down=down)
    if resource is not None:
        resource_node = reveal_label(resource, down=down)
        assert resource_node is not None, 'Missing segment panel: '+resource
    assert_selected_tab(panels, tab)
    assert marker_node is not None, 'Missing segment marker: '+marker
    # 选中态、当前内容与旧 panel 卸载共用动作后的同一棵新鲜树。
    for other_resource in hidden_resources:
        if other_resource != resource:
            assert not any(visible(n) and has_resource(n, other_resource) for n in tree.iter('node')), 'Segment tab kept another panel mounted: '+other_resource


def select_segment_tab(tab, panels, hidden_resources, down=False):
    tap_node(find(tab))
    refresh()
    assert_segment_tab(tab, panels, hidden_resources, down=down)


session_tab_panels = {
    # 动态是 CurrentExecution 底板，没有独立 testID；状态说明入口在空态与最近结果下都存在。
    '动态': (None, '状态说明'),
    '审批': ('approval-panel', '每一次授权，都由你决定'),
    # 工作区顶部是真实 SpaceSettings；FilesPanel 在长技能列表后，不作分段到达条件。
    '工作区': (None, '空间规则'),
    '历史': ('activity-panel', '活动历史'),
}
session_tab_evidence = {'动态': 'activity', '审批': 'approvals', '工作区': 'workspace', '历史': 'history'}


def select_session_tab(tab):
    hidden = {'activity-panel', 'approval-panel', 'workspace-files-panel'}
    if tab == '工作区':
        hidden.remove('workspace-files-panel')
    select_segment_tab(tab, session_tab_panels, hidden, down=False)


def record_status_help(theme, phase, expected_expanded):
    button = find('状态说明')
    assert button is not None, 'Missing status help button: '+phase
    expanded = button.get('expanded')
    expected = 'true' if expected_expanded else 'false'
    record = {
        'theme': theme,
        'phase': phase,
        'expanded': expanded,
        'expected_expanded': expected,
        'exported': expanded is not None,
        'result': 'unsupported_by_compressed_uiautomator' if expanded is None else ('match' if expanded == expected else 'mismatch'),
    }
    status_help_evidence.append(record)
    (root/'status-help-evidence.json').write_text(json.dumps(status_help_evidence, ensure_ascii=False, indent=2), encoding='utf-8')
    assert record['result'] != 'mismatch', 'Exported expanded state contradicts status help body: '+phase
    return record


def assert_status_help(theme, evidence_prefix=''):
    help_text = '本轮正常结束不等于整项工作完成；未登记活动的聊天不会出现在历史中。'
    # stock compressed XML 可能不导出 expanded；属性缺席只记录 unsupported，语义由正文严格判定。
    record_status_help(evidence_prefix+theme, 'initial', False)
    assert find(help_text) is None, 'Collapsed status help exposed its body'
    tap_node(find('状态说明'))
    refresh()
    body = reveal_label(help_text, down=False)
    assert body is not None, 'Native tap did not expose status help body'
    button = reveal_label('状态说明', down=True)
    record_status_help(evidence_prefix+theme, 'expanded', True)
    tap_node(button)
    refresh()
    record_status_help(evidence_prefix+theme, 'collapsed', False)
    assert find(help_text) is None, 'Native tap did not remove status help body'


def check_reset_confirmation(theme, evidence_prefix):
    risk = '重置将停止当前运行，清空聊天历史与未完成的审批，开启全新对话。空间规则、技能开关与已保存的工作区文件都会保留。'
    checkbox_label = '同时清理定时任务与网页监控'
    tap_node(find('重置当前会话'))
    refresh()
    # 窄屏下标题、长风险、复选框与按钮可能互相离屏；逐项寻找，不要求同视口。
    title = reveal_label('重置当前会话？', down=True)
    risk_node = reveal_label(risk, down=False)
    assert title is not None and risk_node is not None
    capture_current(evidence_prefix+theme+'-reset-confirmation')
    checkbox = reveal_label(checkbox_label, down=False)
    assert checkbox.get('checked') != 'true', 'Reset confirmation did not default to preserving schedules'
    unchecked = reveal_label('未选择：同时清理此空间下的定时任务与网页监控', down=False)
    assert unchecked is not None
    confirm, cancel = reveal_labels_together(['确认重置会话', '取消重置会话'], down=False)
    assert confirm.get('enabled') != 'false' and cancel.get('enabled') != 'false'
    if theme != 'classic':
        capture_current(evidence_prefix+theme+'-reset-actions')
        tap_node(cancel)
        refresh()
        assert_absent_current(['重置当前会话？', '确认重置会话', '取消重置会话'])
        return
    # 按钮定位可能已经滚动；勾选前重新取得当前视口中的复选框边界。
    checkbox = reveal_label(checkbox_label, down=True)
    tap_node(checkbox)
    refresh()
    checkbox = reveal_label(checkbox_label, down=False)
    assert checkbox.get('checked') == 'true', 'Clear-schedules checkbox did not toggle'
    checked = reveal_label('已选择：同时清理此空间下的定时任务与网页监控', down=False)
    assert checked is not None
    confirm, cancel = reveal_labels_together(['确认重置会话', '取消重置会话'], down=False)
    assert confirm.get('enabled') != 'false' and cancel.get('enabled') != 'false'
    capture_current(evidence_prefix+theme+'-reset-actions')
    tap_node(cancel)
    refresh()
    assert_absent_current(['重置当前会话？', '确认重置会话', '取消重置会话'])
    # 重新打开必须回到默认安全态；这里只取消，绝不提交真实重置。
    reset_entry = reveal_label('重置当前会话', down=True)
    tap_node(reset_entry)
    refresh()
    title = reveal_label('重置当前会话？', down=True)
    assert title is not None
    checkbox = reveal_label(checkbox_label, down=False)
    assert checkbox.get('checked') != 'true', 'Reopened reset confirmation retained checked state'
    unchecked = reveal_label('未选择：同时清理此空间下的定时任务与网页监控', down=False)
    assert unchecked is not None
    confirm, cancel = reveal_labels_together(['确认重置会话', '取消重置会话'], down=False)
    assert confirm.get('enabled') != 'false' and cancel.get('enabled') != 'false'
    tap_node(cancel)
    refresh()
    assert_absent_current(['确认重置会话', '取消重置会话'])


def check_delete_confirmation(theme, space_id, evidence_prefix):
    risk = '空间的全部聊天历史、工作区文件、规则、技能和绑定的定时任务、监控将被彻底删除，无法撤销。'
    if width == 840:
        # 通过现有重置确认页下方的同一删除入口验收，避免重复遍历无关的长技能列表。
        # 只打开确认页，不提交重置；删除入口的原回调会关闭重置确认。
        tap_node(find('重置当前会话'))
        refresh()
    delete_entry = reveal_label('删除当前空间', down=False, scrolls=15, fast_scroll=width == 840)
    tap_node(delete_entry)
    refresh()
    title = reveal_label('确认删除当前空间？', down=True, scrolls=6)
    risk_node = reveal_label(risk, down=False)
    assert title is not None and risk_node is not None
    capture_current(evidence_prefix+theme+'-delete-confirmation')
    identity = reveal_label(space_id, down=True)
    assert identity is not None
    confirm, cancel = reveal_labels_together(['确认删除空间', '取消删除空间'], down=False)
    assert confirm.get('enabled') != 'false' and cancel.get('enabled') != 'false'
    capture_current(evidence_prefix+theme+'-delete-actions')
    tap_node(cancel)
    refresh()
    assert_absent_current(['确认删除当前空间？', '确认删除空间', '取消删除空间'])


def check_session_controls(theme, space_id, chat_header, evidence_prefix=''):
    # 每主题都实际切换四项；完整状态/复选框矩阵只在 classic 深度执行一次。
    for tab in session_tab_panels:
        select_session_tab(tab)
        capture_current(f'{evidence_prefix}{theme}-session-tab-{session_tab_evidence[tab]}')
    if theme == 'classic':
        select_session_tab('动态')
        assert_status_help(theme, evidence_prefix)
        tap_node(find('查看活动历史'))
        refresh()
        assert_segment_tab('历史', session_tab_panels, {'activity-panel', 'approval-panel', 'workspace-files-panel'}, down=False)
    check_reset_confirmation(theme, evidence_prefix)
    check_delete_confirmation(theme, space_id, evidence_prefix)
    assert header_bounds(space_id) == chat_header, 'Session controls moved session header'
    capture_current(evidence_prefix+theme+'-session-controls')
    passed(evidence_prefix+theme+' session segmented navigation, help and confirmation controls')


task_tab_panels = {
    '活动历史': ('activity-panel', '当前空间活动'),
    '定时任务': ('jobs-panel', '刷新定时任务'),
    '网页监控': ('monitors-panel', '刷新网页监控'),
}


def select_task_tab(tab):
    select_segment_tab(tab, task_tab_panels, {'activity-panel', 'jobs-panel', 'monitors-panel'}, down=False)


def check_task_controls(theme, space_id, evidence_prefix='', check_draft=False):
    tap_node(find('任务'))
    refresh()
    for tab in task_tab_panels:
        select_task_tab(tab)
    capture_current(evidence_prefix+theme+'-tasks-controls')
    tap_node(find('聊天'))
    refresh()
    assert find(space_id) is not None, 'Tasks navigation lost current space'
    if check_draft:
        assert find('消息输入框').get('text') == context['draft'], 'Tasks navigation lost unsent draft'
    passed(evidence_prefix+theme+' tasks segmented navigation')


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
            # 同一次设备 shell 内先关闭再重开，直接调用 cmd input 避免两次 input 包装脚本。
            # uptime 采样分别是首触控前、首触控返回后、次触控返回后；整段只测量驱动
            # 实际注入区间，不把前置 UI 定位、ADB 建连或后续动画等待计入 260ms 阈值。
            timing = sh('shell',
                        f'read start rest </proc/uptime; cmd input tap {x} {y}; '
                        f'read first_tap_end rest </proc/uptime; cmd input tap {x} {y}; '
                        f'read end rest </proc/uptime; printf \'%s\\n%s\\n%s\\n\' '
                        f'"$start" "$first_tap_end" "$end"')
            start, first_tap_end, end = map(float, timing.decode().strip().splitlines())
            overall_elapsed = end-start
            (root/'rapid-panel-timing.json').write_text(json.dumps({
                'start_uptime_seconds': start,
                'first_tap_end_uptime_seconds': first_tap_end,
                'second_tap_end_uptime_seconds': end,
                'overall_elapsed_seconds': overall_elapsed,
                'threshold_seconds': .26,
            }, ensure_ascii=False, indent=2), encoding='utf-8')
            assert overall_elapsed < .26, 'Native tap driver exceeded the 260ms transition window'
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
