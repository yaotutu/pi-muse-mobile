"""通过 Android 原生界面验收技能库审批与启用；不调用业务 API。

用法：python3 tools/e2e-skill-authoring-native.py EVIDENCE_DIR --phase create-approve
      python3 tools/e2e-skill-authoring-native.py EVIDENCE_DIR --phase enable-use
EVIDENCE_DIR/context.json 至少包含 spaceId、skillName、uniqueMarker；第二阶段由主调用方
独立回读技能文件后设置 diskVerified=true。主调用方负责连接和选中隔离测试空间。
"""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('evidence_dir', type=Path)
parser.add_argument('--phase', choices=('create-approve', 'enable-use'))
args = parser.parse_args()
root = args.evidence_dir
if not root.is_dir():
    parser.error('evidence_dir must already exist')
context = json.loads((root / 'context.json').read_text(encoding='utf-8'))
phase = args.phase or context.get('phase')
if phase not in ('create-approve', 'enable-use'):
    parser.error('set --phase or context.phase to create-approve or enable-use')
for key in ('spaceId', 'skillName', 'uniqueMarker'):
    if not isinstance(context.get(key), str) or not re.fullmatch(r'[A-Za-z0-9_-]+', context[key]):
        parser.error('context.json requires nonempty ASCII ' + key)
name = context['skillName']
marker = context['uniqueMarker']
default_create = (
    f'Create one Pi Muse product skill named {name}. '
    f'Use the skills tool save action to save only {name}/SKILL.md in the product skill library. '
    'Do not use ordinary workspace write or edit tools. '
    f'Give SKILL.md YAML frontmatter with name {name} and a nonempty description. '
    f'Put exact marker {marker} in the skill instructions. '
    f'The instructions must require {marker} in the final reply when using this skill. '
    'Do not create or edit any other file.'
)
default_use = (
    f'Use the enabled Pi Muse product skill {name}. '
    f'First use the ordinary read tool to read its current {name}/SKILL.md. '
    'Follow the current instructions in your reply. Do not guess from earlier conversation.'
)
prompt_key = 'createPrompt' if phase == 'create-approve' else 'usePrompt'
prompt = context.get(prompt_key, default_create if phase == 'create-approve' else default_use)
if not isinstance(prompt, str) or not re.fullmatch(r'[A-Za-z0-9 _./-]+', prompt):
    parser.error(prompt_key + ' must contain only ASCII letters, digits, spaces, underscore, hyphen, dot and slash')
if name not in prompt:
    parser.error(prompt_key + ' must mention skillName')
if phase == 'create-approve' and (marker not in prompt or 'SKILL.md' not in prompt):
    parser.error('createPrompt must mention uniqueMarker and SKILL.md')
if phase == 'enable-use' and marker in prompt:
    parser.error('usePrompt must not reveal uniqueMarker to the model')

adb = os.environ.get('ADB', str(Path.home() / 'Library/Android/sdk/platform-tools/adb'))
serial = os.environ.get('ANDROID_SERIAL', 'emulator-5554')
device = [adb, '-s', serial]
remote_xml = '/sdcard/skill-authoring-e2e.xml'
result_path = root / 'skill-authoring-native-results.json'
if result_path.exists():
    result = json.loads(result_path.read_text(encoding='utf-8'))
    if any(result.get(key) != context[key] for key in ('spaceId', 'skillName', 'uniqueMarker')):
        parser.error('existing results belong to another acceptance run')
else:
    result = {key: context[key] for key in ('spaceId', 'skillName', 'uniqueMarker')}
    result.update({'device': serial, 'phases': {}, 'steps': []})
if phase in result['phases']:
    parser.error('phase was already attempted; inspect evidence before manual continuation')
if phase == 'enable-use' and (result['phases'].get('create-approve') != 'passed' or context.get('diskVerified') is not True):
    parser.error('enable-use requires passed creation and independent diskVerified=true')
result['phases'][phase] = 'running'
tree = None
width = height = 0


def save():
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def sh(*command):
    return subprocess.check_output([*device, *command], timeout=45)


def refresh():
    global tree
    for _ in range(4):
        response = sh('shell', 'uiautomator', 'dump', remote_xml)
        if b'dumped to' in response:
            tree = ET.fromstring(sh('exec-out', 'cat', remote_xml))
            return
        time.sleep(.4)
    raise AssertionError('uiautomator did not produce a fresh hierarchy')


def bounds(node):
    return tuple(map(int, re.findall(r'-?\d+', node.get('bounds', ''))))


def visible(node):
    box = bounds(node)
    return len(box) == 4 and box[2] > box[0] and box[3] > box[1] and 0 <= (box[0] + box[2]) / 2 < width and height * .03 <= (box[1] + box[3]) / 2 < height * .98


def find(label, prefix=False, kind=None):
    candidates = [node for node in tree.iter('node') if visible(node)
                  and any((label in value if prefix else value == label)
                          for value in (node.get('resource-id') or '', node.get('content-desc') or '', node.get('text') or ''))
                  and (kind is None or node.get('class') == kind)]
    clickable = [node for node in candidates if node.get('clickable') == 'true']
    return (clickable or candidates or [None])[0]


def text_nodes():
    return [node for node in tree.iter('node') if visible(node) and node.get('text')]


def has_text(value):
    return any(value in node.get('text', '') for node in text_nodes())


def wait(predicate, label, seconds=90):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        refresh()
        if predicate():
            return
        time.sleep(.6)
    raise AssertionError('timed out waiting for native UI: ' + label)


def capture(label):
    # XML 与截图紧邻采集，写结果时只引用实际存在的证据文件。
    refresh()
    (root / (label + '.xml')).write_bytes(ET.tostring(tree, encoding='utf-8'))
    (root / (label + '.png')).write_bytes(sh('exec-out', 'screencap', '-p'))
    return {'xml': label + '.xml', 'screenshot': label + '.png'}


def observed(label, predicate, seconds=90):
    wait(predicate, label, seconds)
    evidence = capture(label)
    result['steps'].append({'phase': phase, 'name': label, 'status': 'passed', **evidence})
    save()
    print('PASS NATIVE', label, flush=True)


def attempt(label, action, predicate, seconds=90):
    # 先落盘 attempted，再进行一次界面写操作；断线或超时后绝不自动重放。
    entry = {'phase': phase, 'name': label, 'status': 'attempted'}
    result['steps'].append(entry)
    save()
    action()
    wait(predicate, label, seconds)
    entry.update({'status': 'passed', **capture(label)})
    save()
    print('PASS NATIVE', label, flush=True)


def tap(label, prefix=False):
    refresh()
    node = find(label, prefix=prefix)
    if node is None or node.get('enabled') == 'false' or node.get('clickable') != 'true':
        raise AssertionError('missing enabled native control: ' + label)
    box = bounds(node)
    sh('shell', 'input', 'tap', str((box[0] + box[2]) // 2), str((box[1] + box[3]) // 2))


def scroll_to(label, container_label, direction='down', contains=False, limit=12):
    for _ in range(limit):
        refresh()
        if find(label, prefix=contains) is not None:
            return
        container = find(container_label)
        if container is None:
            raise AssertionError('scroll container missing: ' + container_label)
        outer = bounds(container)
        areas = [bounds(node) for node in tree.iter('node') if visible(node)
                 and node.get('class') == 'android.widget.ScrollView'
                 and bounds(node)[0] >= outer[0] and bounds(node)[2] <= outer[2]
                 and bounds(node)[1] >= outer[1] and bounds(node)[3] <= outer[3]]
        if not areas:
            raise AssertionError('native ScrollView missing inside: ' + container_label)
        box = max(areas, key=lambda item: (item[2] - item[0]) * (item[3] - item[1]))
        x = (box[0] + box[2]) // 2
        upper = int(box[1] + (box[3] - box[1]) * .26)
        lower = int(box[1] + (box[3] - box[1]) * .78)
        start, end = (lower, upper) if direction == 'down' else (upper, lower)
        sh('shell', 'input', 'swipe', str(x), str(start), str(x), str(end), '450')
    raise AssertionError('control not found after native scrolling: ' + label)


def selected_space():
    tap('打开空间侧栏')
    wait(lambda: find(context['spaceId']) is not None, 'test space row in native drawer')
    refresh()
    row = find(context['spaceId'])
    if row is None or row.get('selected') != 'true':
        raise AssertionError('main caller has not selected the test space')
    result['steps'].append({'phase': phase, 'name': 'selected-space-' + phase, 'status': 'passed',
                            **capture('selected-space-' + phase)})
    save()
    tap('关闭空间侧栏')
    observed('chat-ready-' + phase, lambda: find('消息输入框', kind='android.widget.EditText') is not None)


def enter_prompt():
    refresh()
    field = find('消息输入框', kind='android.widget.EditText')
    if field is None or field.get('text', '') not in ('', field.get('hint', '')):
        raise AssertionError('chat draft is not empty; refusing to overwrite it')
    tap('消息输入框')
    refresh()
    field = find('消息输入框', kind='android.widget.EditText')
    if field is None or field.get('focused') != 'true':
        raise AssertionError('chat input did not gain focus')
    # adb 一次注入长文本可能丢后缀；逐段核对累计原文，失配即停止且不重输。
    for offset in range(0, len(prompt), 40):
        chunk = prompt[offset:offset + 40]
        sh('shell', 'input', 'text', chunk.replace(' ', '%s'))
        expected = prompt[:offset + len(chunk)]
        wait(lambda: (lambda node: node is not None and node.get('focused') == 'true'
              and node.get('text') == expected)(find('消息输入框', kind='android.widget.EditText')),
             'exact prompt prefix after native input', 20)
    observed('prompt-entered-' + phase, lambda: (lambda node: node is not None and node.get('text') == prompt)(find('消息输入框', kind='android.widget.EditText')), 20)


def bubble_ids():
    return {node.get('resource-id', '').split('message-bubble-', 1)[1]
            for node in tree.iter('node') if visible(node) and 'message-bubble-' in node.get('resource-id', '')}


def bubble_with_text(value, exclude=()):
    for node in tree.iter('node'):
        resource = node.get('resource-id', '')
        if 'message-bubble-' not in resource or not visible(node):
            continue
        bubble_id = resource.split('message-bubble-', 1)[1]
        if bubble_id in exclude:
            continue
        left, top, right, bottom = bounds(node)
        if any(value in child.get('text', '') and left <= (bounds(child)[0] + bounds(child)[2]) / 2 <= right
               and top <= (bounds(child)[1] + bounds(child)[3]) / 2 <= bottom
               for child in text_nodes()):
            return bubble_id
    return None


def bubble_text(bubble_id):
    bubble = find('message-bubble-' + bubble_id)
    if bubble is None:
        raise AssertionError('assistant bubble is no longer visible')
    left, top, right, bottom = bounds(bubble)
    return '\n'.join(node.get('text', '') for node in text_nodes()
                     if left <= (bounds(node)[0] + bounds(node)[2]) / 2 <= right
                     and top <= (bounds(node)[1] + bounds(node)[3]) / 2 <= bottom)


def send_message():
    refresh()
    before = bubble_ids()
    # 长消息可能在工具卡出现后立即滚出可见区；输入清空并出现当前运行即可确认 UI 已接收。
    def accepted():
        field = find('消息输入框', kind='android.widget.EditText')
        return (field is not None and field.get('text', '') in ('', field.get('hint', ''))
                and (find('停止当前运行') is not None or bubble_with_text(prompt, before) is not None))

    attempt('message-sent-' + phase, lambda: tap('发送消息'),
            accepted, 45)
    refresh()
    return bubble_with_text(prompt, before), before


def input_state_visible(state):
    # 优先实际显示状态；键盘收起后 view 标志仍可能为 true，不能将两者简单取或。
    input_shown = re.search(r'\bmInputShown\s*=\s*(true|false)\b', state)
    if input_shown is not None:
        return input_shown.group(1) == 'true'
    input_view_shown = re.search(r'\bmIsInputViewShown\s*=\s*(true|false)\b', state)
    return input_view_shown is not None and input_view_shown.group(1) == 'true'


def keyboard_visible():
    # 仅在 Android 输入法报告实际显示时才允许按 Back，避免误关聊天或会话面板。
    return input_state_visible(sh('shell', 'dumpsys', 'input_method').decode(errors='replace'))


def open_panel(tab):
    if keyboard_visible():
        sh('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        # 收起后以新层级中的面板按钮作为可操作信号，避免受滞留的 IME 标志影响；
        # 等待期间不再次发送 Back，防止误关聊天或退出应用。
        wait(lambda: find('打开当前会话面板') is not None,
             'native chat actionable after dismissing keyboard', 10)
    tap('打开当前会话面板')
    observed('session-open-' + phase, lambda: find('workspace-session-panel') is not None)
    tap(tab)
    observed('tab-open-' + phase, lambda: find('approval-panel' if tab.endswith('approvals') else '空间规则') is not None)


def preview_content():
    # React Native 的全文 Text 节点须在原生 XML 中可见；缺失时不批准。
    refresh()
    candidates = [node.get('text', '') for node in text_nodes() if marker in node.get('text', '')]
    after = next((value for value in candidates if 'name:' in value and 'description:' in value), None)
    frontmatter = re.match(r'\A---\s*\n(.*?)\n---(?:\s*\n|$)', after or '', re.S)
    if (frontmatter is None or not re.search(r'^name:\s*' + re.escape(name) + r'\s*$', frontmatter.group(1), re.M)
            or not re.search(r'^description:\s*\S+', frontmatter.group(1), re.M)
            or marker not in after[frontmatter.end():]):
        raise AssertionError('complete skill frontmatter and marker are not visible in native approval preview')
    return after


def create_approve():
    selected_space()
    enter_prompt()
    send_message()
    open_panel('workspace-session-tab-approvals')
    observed('approval-pending', lambda: find('approval-open-', prefix=True) is not None, 180)
    refresh()
    rows = [node for node in tree.iter('node') if visible(node) and 'approval-open-' in node.get('resource-id', '')]
    if len(rows) != 1:
        raise AssertionError('expected exactly one pending approval in test space')
    tap(rows[0].get('resource-id'))
    observed('skill-scope', lambda: has_text('技能库') and has_text(name + '/SKILL.md'))
    scroll_to('文件尚不存在', 'workspace-session-panel', contains=True)
    observed('skill-before', lambda: has_text('文件尚不存在'))
    scroll_to(marker, 'workspace-session-panel', contains=True)
    after = preview_content()
    result['previewAfter'] = after
    observed('skill-preview', lambda: preview_content() == after)
    scroll_to('批准本次操作', 'workspace-session-panel')
    tap('批准本次操作')
    observed('approval-confirmation', lambda: has_text('确认授权这一次操作'))
    attempt('approval-decision-sent', lambda: tap('确认批准'),
            lambda: not has_text('确认授权这一次操作'), 90)
    scroll_to('已批准（仅授权）', 'workspace-session-panel', direction='up')
    observed('approval-approved', lambda: has_text('已批准（仅授权）'))
    scroll_to('执行回执', 'workspace-session-panel')
    observed('execution-succeeded', lambda: has_text('文件写入成功'), 180)
    tap('关闭会话面板')
    observed('chat-after-approval', lambda: find('消息输入框', kind='android.widget.EditText') is not None)


def enable_use():
    selected_space()
    open_panel('workspace-session-tab-workspace')
    scroll_to('技能 ' + name, 'workspace-session-panel')
    refresh()
    switch = find('技能 ' + name)
    if switch is None or switch.get('checked') != 'false':
        raise AssertionError('new skill is not visible and disabled before enable')
    attempt('skill-toggled', lambda: tap('技能 ' + name),
            lambda: (lambda node: node is not None and node.get('checked') == 'true')(find('技能 ' + name)))
    scroll_to('保存空间技能', 'workspace-session-panel')
    attempt('skill-save', lambda: tap('保存空间技能'),
            lambda: find('保存空间技能') is None and (lambda node: node is not None and node.get('checked') == 'true')(find('技能 ' + name)), 90)
    tap('关闭会话面板')
    observed('chat-after-enable', lambda: find('消息输入框', kind='android.widget.EditText') is not None)
    enter_prompt()
    user_id, prior_bubbles = send_message()
    excluded_bubbles = prior_bubbles | ({user_id} if user_id is not None else set())
    observed('skill-reply-marker', lambda: find('停止当前运行') is None
             and bubble_with_text(marker, excluded_bubbles) is not None, 180)
    refresh()
    result['assistantBubbleId'] = bubble_with_text(marker, excluded_bubbles)
    result['assistantReplyObserved'] = bubble_text(result['assistantBubbleId'])
    save()


try:
    size = sh('shell', 'wm', 'size').decode(errors='replace')
    width, height = tuple(map(int, re.findall(r'(\d+)x(\d+)', size)[-1]))
    save()
    if phase == 'create-approve':
        create_approve()
    else:
        enable_use()
    result['phases'][phase] = 'passed'
    save()
except Exception as error:
    result['phases'][phase] = 'failed'
    result['error'] = str(error)
    if tree is not None:
        try:
            result['failureEvidence'] = capture('failure-' + phase)
        except Exception:
            pass
    save()
    raise
