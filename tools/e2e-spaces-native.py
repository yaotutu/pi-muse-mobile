"""真实 Android UI 操作空间迁移；仅操作 Node harness 创建的验收空间，不注入状态。"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

root = Path(sys.argv[1])
context = json.loads((root / 'context.json').read_text())
adb = os.environ.get('ADB', str(Path.home() / 'Library/Android/sdk/platform-tools/adb'))
target = ['-s', os.environ['ANDROID_SERIAL']] if os.environ.get('ANDROID_SERIAL') else ['-e']
checks = []
tree = None
width, height = 1080, 2400


def sh(*args):
    return subprocess.check_output([adb, *target, *args], timeout=45)


def refresh():
    global tree
    for _ in range(4):
        result = sh('shell', 'uiautomator', 'dump', '/sdcard/spaces-e2e.xml')
        # 冷启动可能返回 null root 且退出码为 0；拒绝读取上一次残留的界面树。
        if b'dumped to' in result:
            tree = ET.fromstring(sh('exec-out', 'cat', '/sdcard/spaces-e2e.xml'))
            return
        time.sleep(.5)
    raise AssertionError('UIAutomator did not produce a fresh hierarchy')


def find(label):
    matches = []
    for n in tree.iter('node'):
        b = list(map(int, re.findall(r'-?\d+', n.get('bounds', ''))))
        if len(b) != 4 or b[2] <= b[0] or b[3] <= b[1]:
            continue
        if not (0 <= (b[0]+b[2])/2 < width and height*.03 <= (b[1]+b[3])/2 < height*.98):
            continue
        if label in [n.get('content-desc'), n.get('text'), n.get('resource-id')]:
            matches.append(n)
    # 分组标题与输入框可能同名，优先真实可编辑/可点击控件，不能点击说明文字后假定已输入。
    return next((n for n in matches if n.get('class') == 'android.widget.EditText'),
                next((n for n in matches if n.get('clickable') == 'true'), matches[0] if matches else None))


def text():
    return '\n'.join(n.get('text', '') for n in tree.iter('node'))


def wait(predicate, label, seconds=90):
    end = time.time() + seconds
    while time.time() < end:
        if (root / 'failed').exists():
            raise AssertionError('HTTP harness failed')
        refresh()
        if predicate():
            return
        time.sleep(.5)
    raise AssertionError('Timed out: ' + label)


def tap(label, scroll=False):
    for _ in range(18):
        refresh()
        n = find(label)
        if n is not None and n.get('enabled') != 'false':
            x1, y1, x2, y2 = map(int, re.findall(r'-?\d+', n.get('bounds')))
            sh('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
            time.sleep(.4)
            return
        if scroll:
            sh('shell', 'input', 'swipe', str(int(width*.9)), str(int(height*.85)), str(int(width*.9)), str(int(height*.38)), '350')
        else:
            time.sleep(.5)
    raise AssertionError('Missing enabled native control: ' + label)


def screenshot(name):
    refresh()
    (root / (name + '.xml')).write_bytes(ET.tostring(tree, encoding='utf-8'))
    (root / (name + '.png')).write_bytes(sh('exec-out', 'screencap', '-p'))


def passed(name):
    checks.append(name)
    print('PASS NATIVE', name, flush=True)


def flag(name):
    (root / name).write_text('verified through actual Android UI')


def hide_keyboard():
    # AVD 可能启用了硬件键盘；无软键盘时 BACK 会关闭整个连接 Modal，而不是收起 IME。
    state = sh('shell', 'dumpsys', 'input_method').decode()
    if 'mInputShown=true' in state or 'mIsInputViewShown=true' in state:
        sh('shell', 'input', 'keyevent', 'KEYCODE_BACK')


def select_space():
    def selected():
        identity = find('打开当前会话面板')
        return identity is not None and find('收起空间侧栏') is None and any(
            n.get('text') == context['spaceId'] for n in identity.iter('node'))

    tap('打开空间侧栏')
    tap(context['spaceId'], scroll=True)
    wait(selected, 'test space selected and drawer closed')


def reset_dialog():
    tap('打开当前会话面板')
    tap('重置当前会话')
    wait(lambda: '重置当前会话？' in text(), 'confirmation text')
    assert '空间规则、技能开关与已保存的工作区文件都会保留' in text()
    assert find('同时清理定时任务与网页监控').get('checked') == 'false'


try:
    size = sh('shell', 'wm', 'size').decode()
    width, height = map(int, re.findall(r'(\d+)x(\d+)', size)[-1])
    sh('reverse', 'tcp:8082', 'tcp:8082')
    sh('shell', 'am', 'force-stop', 'host.exp.exponent')
    sh('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://127.0.0.1:8082', 'host.exp.exponent')
    time.sleep(5)
    for _ in range(15):
        refresh()
        if find('Continue') is not None:
            tap('Continue')
        elif find('Wait') is not None:
            tap('Wait')
        elif find('关闭会话面板') is not None:
            tap('关闭会话面板')
        elif find('聊天') is not None:
            break
        time.sleep(1)
    refresh()
    if find('配置服务器连接') is not None:
        # 仅在全新宿主未配置时通过正常连接表单设置；绝不改已有服务器或清理用户凭据。
        tap('配置服务器连接')
        tap('服务器地址')
        sh('shell', 'input', 'text', context['base'])
        hide_keyboard()
        tap('测试连接', scroll=True)
        wait(lambda: '测试通过，尚未保存' in text(), 'actual connection test')
        tap('workspace-connection-save', scroll=True)
        # 保存成功会自动关闭连接面板，不能再按其旧关闭按钮。
        wait(lambda: find('打开空间侧栏') is not None, 'connection saved and panel closed')
    tap('应用')
    wait(lambda: context['base'] in text(), 'the exact confirmed real server')
    tap('聊天')
    select_space()
    tap('消息输入框')
    sh('shell', 'input', 'text', f'Reply%swith%sexactly%s{context["firstMarker"]}.%sDo%snot%suse%stools.')
    hide_keyboard()
    tap('发送消息')
    # 发送后草稿被清空，空输入的发送按钮本来就应禁用；以运行结束和真实回读核对回复。
    wait(lambda: find('发送消息') is not None and find('停止当前运行') is None and context['firstMarker'] in text(), 'real streamed reply and authoritative history', 170)
    assert context['firstMarker'] in text()
    screenshot('chat-before-reset')
    passed('native composer sends real spaceId chat and consumes the streamed reply')

    sh('shell', 'am', 'force-stop', 'host.exp.exponent')
    sh('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://127.0.0.1:8082', 'host.exp.exponent')
    wait(lambda: find('打开空间侧栏') is not None, 'credential restoration')
    select_space()
    wait(lambda: context['firstMarker'] in text(), 'authoritative chat restored after process restart')
    passed('native process restart restores connection and the selected space history')

    reset_dialog()
    screenshot('reset-confirm-default')
    tap('取消重置会话')
    flag('native-cancelled')
    wait(lambda: (root / 'api-cancel-verified').exists(), 'cancel has no server side effect')
    tap('关闭会话面板')
    reset_dialog()
    tap('确认重置会话')
    wait(lambda: find('打开空间侧栏') is not None and find('conversation-empty') is not None, 'reset returns to a genuinely empty chat')
    assert context['firstMarker'] not in text()
    screenshot('reset-default-empty')
    flag('native-reset-default')
    wait(lambda: (root / 'api-default-verified').exists(), 'default reset preserves space configuration and the paused monitor')
    passed('default reset clears actual chat but preserves the space, rules, skills and monitor')

    reset_dialog()
    tap('同时清理定时任务与网页监控')
    refresh()
    assert find('同时清理定时任务与网页监控').get('checked') == 'true'
    screenshot('reset-confirm-clear-schedules')
    tap('确认重置会话')
    wait(lambda: find('打开空间侧栏') is not None and find('conversation-empty') is not None, 'explicit cascade reset returns to chat')
    flag('native-reset-cleared')
    wait(lambda: (root / 'api-clear-verified').exists(), 'opt-in reset deletes the owned monitor and preserves settings')
    passed('explicit checkbox changes the actual reset request and removes the owned monitor')
    tap('打开当前会话面板')
    tap('workspace-session-tab-workspace')
    wait(lambda: '空间规则' in text() and 'Dedicated mobile space/session migration acceptance' in text(), 'rules remain on actual space settings UI')
    screenshot('preserved-space-settings')
    tap('关闭会话面板')
    tap('打开空间侧栏')
    tap('主空间')
    (root / 'native-results.json').write_text(json.dumps({'passed': True, 'checks': checks}, ensure_ascii=False, indent=2))
except Exception as error:
    screenshot('native-failure')
    (root / 'native-results.json').write_text(json.dumps({'passed': False, 'checks': checks, 'error': str(error)}, ensure_ascii=False, indent=2))
    raise
