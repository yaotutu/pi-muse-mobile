"""通过 Android 原生界面验收指定消息的反馈；不启动应用、不调用业务 API。

用法：python3 tools/e2e-message-feedback-native.py EVIDENCE_DIR [--phase reaction|comments|restore|all]
EVIDENCE_DIR/context.json 须含 spaceId、sessionId、messageIds.user、messageIds.assistant。
主调用方负责选择测试空间、准备真实消息和独立回读服务端；本工具只证明实际 UI 行为。
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('evidence_dir', type=Path)
parser.add_argument('--phase', choices=('reaction', 'comments', 'restore', 'all'), default='all')
args = parser.parse_args()
root = args.evidence_dir
if not root.is_dir():
    parser.error('evidence_dir must already exist')
context = json.loads((root / 'context.json').read_text(encoding='utf-8'))
for key in ('spaceId', 'sessionId'):
    if not isinstance(context.get(key), str) or not context[key]:
        parser.error('context.json requires nonempty ' + key)
ids = context.get('messageIds')
if not isinstance(ids, dict) or any(not isinstance(ids.get(role), str) or not ids[role] for role in ('user', 'assistant')):
    parser.error('context.json requires messageIds.user and messageIds.assistant')
if ids['user'] == ids['assistant']:
    parser.error('user and assistant message IDs must differ')

adb = os.environ.get('ADB', str(Path.home() / 'Library/Android/sdk/platform-tools/adb'))
serial = os.environ.get('ANDROID_SERIAL', 'emulator-5556')
device = [adb, '-s', serial]
remote_xml = '/sdcard/message-feedback-e2e.xml'
result_path = root / 'message-feedback-native-results.json'
if result_path.exists():
    result = json.loads(result_path.read_text(encoding='utf-8'))
    if result.get('sessionId') != context['sessionId'] or result.get('messageIds') != ids:
        parser.error('existing results belong to different messages or session')
    if result.get('status') == 'failed':
        parser.error('previous run failed; inspect attempted writes before any manual continuation')
else:
    result = {'spaceId': context['spaceId'], 'sessionId': context['sessionId'],
              'messageIds': ids, 'device': serial, 'phases': {}, 'steps': [], 'status': 'running'}
phases = ('reaction', 'comments', 'restore') if args.phase == 'all' else (args.phase,)
if any(phase in result['phases'] for phase in phases):
    parser.error('requested phase was already attempted; inspect evidence before any manual rerun')

suffix = hashlib.sha256(context['sessionId'].encode('utf-8')).hexdigest()[:8]
comment_a = 'native_a_' + suffix
comment_b = 'native_b_' + suffix
comment_a_edit = 'native_a_edit_' + suffix
comment_user = 'native_user_' + suffix
tree = None
width = height = 0
density = 1.0


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
    return list(map(int, re.findall(r'-?\d+', node.get('bounds', ''))))


def visible(node):
    box = bounds(node)
    return (len(box) == 4 and box[2] > box[0] and box[3] > box[1]
            and 0 <= (box[0] + box[2]) / 2 < width
            and height * .03 <= (box[1] + box[3]) / 2 < height * .98)


def matches(node, label):
    return label in (node.get('resource-id'), node.get('content-desc'), node.get('text'))


def center_in_box(node, box):
    left, top, right, bottom = bounds(node)
    x, y = (left + right) / 2, (top + bottom) / 2
    # UIAutomator 的相邻 View 边缘可能因像素取整差 1；仅放宽中心坐标 1px。
    return box[0] - 1 <= x <= box[2] + 1 and box[1] - 1 <= y <= box[3] + 1


def find(label, scope=None, kind=None):
    source = tree if scope is None or isinstance(scope, tuple) else scope
    nodes = [node for node in source.iter('node') if visible(node) and matches(node, label)
             and (not isinstance(scope, tuple) or center_in_box(node, scope))
             and (kind is None or node.get('class') == kind)]
    # 关闭评论同时有遮罩与标题栏按钮；优先较小的真实控件，避免点在遮罩中心的面板上。
    clickable = [node for node in nodes if node.get('clickable') == 'true']
    nodes = clickable or nodes
    return min(nodes, key=lambda node: (bounds(node)[2] - bounds(node)[0]) *
               (bounds(node)[3] - bounds(node)[1])) if nodes else None


def visible_text(value):
    return any(node.get('text') == value and visible(node) for node in tree.iter('node'))


def correct_space():
    header = find('workspace-open-session')
    if header is None:
        header = find('打开当前会话面板')
    if header is None:
        return False
    left, top, right, bottom = bounds(header)
    return any(node.get('text') == context['spaceId'] and visible(node)
               and left <= (bounds(node)[0] + bounds(node)[2]) / 2 <= right
               and top <= (bounds(node)[1] + bounds(node)[3]) / 2 <= bottom
               for node in tree.iter('node'))


def wait(predicate, label, seconds=35):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        refresh()
        if predicate():
            return
        if visible_text('结果待核对。请刷新确认后再修改；不会自动重试。'):
            raise AssertionError('feedback result became uncertain while waiting for ' + label)
        time.sleep(.45)
    raise AssertionError('timed out waiting for visible UI: ' + label)


def capture(name):
    # 以刚核对的新鲜 XML 留证；截图紧接采集，不重复业务操作。
    (root / (name + '.xml')).write_bytes(ET.tostring(tree, encoding='utf-8'))
    (root / (name + '.png')).write_bytes(sh('exec-out', 'screencap', '-p'))


def step(name, predicate):
    wait(predicate, name)
    capture(name)
    result['steps'].append({'name': name, 'status': 'passed', 'xml': name + '.xml', 'screenshot': name + '.png'})
    save()
    print('PASS NATIVE', name, flush=True)


def tap_node(node, label):
    if node is None or not visible(node) or node.get('enabled') == 'false' or node.get('clickable') != 'true':
        raise AssertionError('missing enabled native control: ' + label)
    left, top, right, bottom = bounds(node)
    sh('shell', 'input', 'tap', str((left + right) // 2), str((top + bottom) // 2))


def tap(label, scope=None, kind=None):
    refresh()
    tap_node(find(label, scope, kind), label)


def write_step(name, click, predicate):
    # 先记账再发出唯一一次写入。崩溃、超时或结果不明后，不会因脚本重跑而重复提交。
    result['steps'].append({'name': name, 'status': 'attempted'})
    save()
    click()
    wait(predicate, name)
    capture(name)
    result['steps'][-1] = {'name': name, 'status': 'passed', 'xml': name + '.xml', 'screenshot': name + '.png'}
    save()
    print('PASS NATIVE', name, flush=True)


def chat_scroll(down):
    refresh()
    composer = find('消息输入框')
    if composer is None:
        raise AssertionError('chat composer absent; refusing to scroll another page')
    top_limit = bounds(composer)[1]
    areas = [bounds(node) for node in tree.iter('node') if visible(node)
             and node.get('class') == 'android.widget.ScrollView'
             and bounds(node)[2] - bounds(node)[0] > width * .5
             and bounds(node)[1] < top_limit and bounds(node)[3] <= top_limit + height * .04]
    if not areas:
        raise AssertionError('chat ScrollView not identifiable')
    left, top, right, bottom = max(areas, key=lambda box: (box[2]-box[0]) * (box[3]-box[1]))
    upper, lower = top + (bottom-top)*.2, bottom - (bottom-top)*.15
    start, end = (upper, lower) if down else (lower, upper)
    x = min(right-1, max(left+1, left + int(36*density)))
    sh('shell', 'input', 'swipe', str(x), str(int(start)), str(x), str(int(end)), '350')


def chat_viewport():
    composer = find('消息输入框')
    if composer is None:
        raise AssertionError('chat composer absent')
    top_limit = bounds(composer)[1]
    areas = [bounds(node) for node in tree.iter('node') if visible(node)
             and node.get('class') == 'android.widget.ScrollView'
             and bounds(node)[2] - bounds(node)[0] > width * .5
             and bounds(node)[1] < top_limit and bounds(node)[3] <= top_limit + height * .04]
    if not areas:
        raise AssertionError('chat ScrollView not identifiable')
    return max(areas, key=lambda box: (box[2] - box[0]) * (box[3] - box[1]))


def bubble_press_point(message_id):
    bubble = find('message-bubble-' + message_id)
    if bubble is None:
        return None
    box, viewport = bounds(bubble), chat_viewport()
    left, top = max(box[0], viewport[0]), max(box[1], viewport[1])
    right, bottom = min(box[2], viewport[2]), min(box[3], viewport[3])
    if right - left < 20 * density or bottom - top < 20 * density:
        return None
    # 优先落在目标气泡内可见正文 Text 上；UIAutomator 扁平化正文时选正文起始区域。
    texts = [node for node in tree.iter('node') if node.get('class') == 'android.widget.TextView'
             and node.get('text') and visible(node) and center_in_box(node, box)
             and left + 2 <= (bounds(node)[0] + bounds(node)[2]) / 2 <= right - 2
             and top + 2 <= (bounds(node)[1] + bounds(node)[3]) / 2 <= bottom - 2]
    if texts:
        target = min(texts, key=lambda node: bounds(node)[1])
        x, y = (bounds(target)[0] + bounds(target)[2]) // 2, (bounds(target)[1] + bounds(target)[3]) // 2
    else:
        x = min(right - 3, left + int(24 * density))
        y = min(bottom - 3, top + int(24 * density))
    return x, y


def seek_bubble(message_id):
    refresh()
    if bubble_press_point(message_id) is not None:
        return
    # 仅滚动聊天列表；绝不点击或长按其他消息，也不把离屏节点当成可操作目标。
    for down, limit in ((True, 14), (False, 28)):
        for _ in range(limit):
            chat_scroll(down)
            refresh()
            if bubble_press_point(message_id) is not None:
                return
    raise AssertionError('target persisted message bubble not visible: ' + message_id)


def feedback_scope(message_id):
    root_node = find('message-feedback-menu-' + message_id)
    if root_node is None:
        raise AssertionError('target message context menu is not open: ' + message_id)
    box = tuple(bounds(root_node))
    if find('message-comments-open-' + message_id, box) is None or find('喜欢这条消息', box) is None and find('撤销喜欢', box) is None:
        raise AssertionError('target feedback controls are outside their own context menu: ' + message_id)
    if box[3] - box[1] > 280 * density or box[0] < 0 or box[2] > width or box[1] < 0 or box[3] > height:
        raise AssertionError('context menu is too large or extends beyond the screen: ' + message_id)
    return box


def open_actions(message_id):
    refresh()
    if find('message-feedback-menu-' + message_id) is None:
        if find('message-comments-panel-' + message_id) is not None:
            raise AssertionError('target comment panel is open; refusing to long-press hidden chat')
        if any(find('message-feedback-menu-' + other) is not None or
               find('message-comments-panel-' + other) is not None for other in ids.values()):
            raise AssertionError('another message panel is open; refusing to target hidden chat')
        seek_bubble(message_id)
        point = bubble_press_point(message_id)
        if point is None:
            raise AssertionError('target bubble is outside visible chat viewport: ' + message_id)
        sh('shell', 'input', 'swipe', str(point[0]), str(point[1]),
           str(point[0]), str(point[1]), '900')
    wait(lambda: find('message-feedback-menu-' + message_id) is not None
         and find('message-comments-open-' + message_id) is not None,
         'target message panel opened by native long press')
    feedback_scope(message_id)


def reaction_state(message_id, reaction):
    scope = feedback_scope(message_id)
    if reaction == 'like':
        control = find('撤销喜欢', scope)
        return control is not None and control.get('enabled') != 'false'
    if reaction == 'dislike':
        control = find('撤销不喜欢', scope)
        return control is not None and control.get('enabled') != 'false'
    like = find('喜欢这条消息', scope)
    dislike = find('不喜欢这条消息', scope)
    return (like is not None and like.get('enabled') != 'false'
            and dislike is not None and dislike.get('enabled') != 'false')


def badge_state(message_id, reaction):
    if find('message-feedback-menu-' + message_id) is not None:
        return False
    badge = find('message-feedback-badge-' + message_id)
    if reaction is None:
        return badge is None
    summary = (badge.get('content-desc') or '') if badge is not None else ''
    return ('已喜欢' if reaction == 'like' else '已不喜欢') in summary


def badge_count(message_id, count):
    badge = find('message-feedback-badge-' + message_id)
    if badge is None:
        return count == 0
    return str(count) + ' 条评论' in (badge.get('content-desc') or '')


def react(message_id, action, expected, name):
    open_actions(message_id)
    refresh()
    scope = feedback_scope(message_id)
    if find(action, scope) is None:
        raise AssertionError('unexpected reaction precondition: ' + action)
    write_step(name, lambda: tap_node(find(action, scope), action),
               lambda: badge_state(message_id, expected))


def open_comments(message_id):
    open_actions(message_id)
    tap('message-comments-open-' + message_id, feedback_scope(message_id))
    wait(lambda: find('message-comments-panel-' + message_id) is not None
         and (lambda field: field is not None and field.get('enabled') != 'false')(
             find('新评论', kind='android.widget.EditText'))
         and visible_text('评论'), 'target comment panel ready')


def keyboard_visible():
    state = sh('shell', 'dumpsys', 'window').decode(errors='replace')
    return re.search(r'\bmImeShowing\s*=\s*true\b', state) is not None


def hide_keyboard_if_visible():
    if keyboard_visible():
        sh('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        wait(lambda: find('新评论', kind='android.widget.EditText') is not None and not keyboard_visible(),
             'Back hides keyboard while comments remain open')


def close_comments_with_back(name, message_id):
    hide_keyboard_if_visible()
    sh('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    step(name, lambda: find('message-comments-panel-' + message_id) is None
         and find('新评论', kind='android.widget.EditText') is None
         and find('打开空间侧栏') is not None)


def enter(label, value):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', value):
        raise AssertionError('adb input accepts only controlled ASCII acceptance markers')
    refresh()
    field = find(label, kind='android.widget.EditText')
    if field is None:
        raise AssertionError('comment field not visible: ' + label)
    tap_node(field, label)
    refresh()
    field = find(label, kind='android.widget.EditText')
    if field is None or field.get('focused') != 'true':
        raise AssertionError('comment field did not gain native focus: ' + label)
    sh('shell', 'input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A')
    sh('shell', 'input', 'keyevent', 'KEYCODE_DEL')
    wait(lambda: (lambda node: node is not None and node.get('focused') == 'true'
                  and node.get('text', '') in ('', node.get('hint', '')))(find(label, kind='android.widget.EditText')),
         'selected comment input cleared', 8)
    sh('shell', 'input', 'text', value)
    wait(lambda: (lambda node: node is not None and node.get('focused') == 'true'
                  and node.get('text') == value)(find(label, kind='android.widget.EditText')),
         'exact ASCII comment entered', 8)
    hide_keyboard_if_visible()


def empty_new_comment():
    field = find('新评论', kind='android.widget.EditText')
    return field is not None and field.get('text', '') in ('', field.get('hint', ''), '写评论')


def row_for(comment_text):
    if find('新评论', kind='android.widget.EditText') is None:
        raise AssertionError('comment panel must be open before selecting a comment row')
    text_node = find(comment_text)
    if text_node is None or text_node.get('text') != comment_text:
        raise AssertionError('target comment is not visible: ' + comment_text)
    text_box = bounds(text_node)
    # 评论 View 也可能被扁平化；两个操作必须紧贴目标正文下方、同一横行且各仅一个。
    def controls(label):
        return [node for node in tree.iter('node') if visible(node) and matches(node, label)
                and node.get('clickable') == 'true' and node.get('enabled') != 'false'
                and text_box[3] - 1 <= (bounds(node)[1] + bounds(node)[3]) / 2 <= text_box[3] + 120 * density]
    edits, deletes = controls('编辑评论'), controls('删除评论')
    if len(edits) != 1 or len(deletes) != 1:
        raise AssertionError('cannot isolate one edit/delete pair for target comment: ' + comment_text)
    edit_box, delete_box = bounds(edits[0]), bounds(deletes[0])
    if abs((edit_box[1] + edit_box[3]) / 2 - (delete_box[1] + delete_box[3]) / 2) > 24 * density:
        raise AssertionError('target comment actions are not on the same row: ' + comment_text)
    return (min(text_box[0], edit_box[0], delete_box[0]), text_box[1],
            max(text_box[2], edit_box[2], delete_box[2]), max(edit_box[3], delete_box[3]))


def phase_reaction():
    assistant = ids['assistant']
    refresh()
    if find('message-feedback-badge-' + assistant) is not None:
        raise AssertionError('neutral assistant unexpectedly has a feedback badge')
    open_actions(assistant)
    if not reaction_state(assistant, None):
        raise AssertionError('assistant reaction must initially be neutral in dedicated test data')
    step('reaction-initial', lambda: reaction_state(assistant, None))
    react(assistant, '喜欢这条消息', 'like', 'assistant-like')
    react(assistant, '不喜欢这条消息', 'dislike', 'assistant-dislike')
    react(assistant, '撤销不喜欢', None, 'assistant-reaction-cleared')


def phase_comments():
    assistant = ids['assistant']
    open_comments(assistant)
    if any(visible_text(value) for value in (comment_a, comment_b, comment_a_edit)):
        raise AssertionError('assistant acceptance comments already exist; refusing duplicate writes')
    step('assistant-comments-initial', lambda: find('新评论', kind='android.widget.EditText') is not None)
    enter('新评论', comment_a)
    write_step('assistant-comment-one', lambda: tap('添加评论'),
               lambda: visible_text(comment_a) and empty_new_comment())
    enter('新评论', comment_b)
    write_step('assistant-comment-two', lambda: tap('添加评论'),
               lambda: visible_text(comment_a) and visible_text(comment_b) and empty_new_comment())
    refresh()
    row = row_for(comment_a)
    tap_node(find('编辑评论', row), 'edit first target comment')
    wait(lambda: find('编辑评论', kind='android.widget.EditText') is not None,
         'first comment editor opened')
    enter('编辑评论', comment_a_edit)
    write_step('assistant-comment-edited', lambda: tap('保存评论'),
               lambda: visible_text(comment_a_edit) and not visible_text(comment_a)
               and find('编辑评论', kind='android.widget.EditText') is None)
    refresh()
    row = row_for(comment_b)
    tap_node(find('删除评论', row), 'delete second target comment')
    wait(lambda: find('确认删除评论') is not None and visible_text('确认删除这条评论？'),
         'second comment deletion confirmation')
    step('assistant-delete-confirmation', lambda: find('确认删除评论') is not None)
    write_step('assistant-comment-deleted', lambda: tap('确认删除评论'),
               lambda: not visible_text(comment_b) and visible_text(comment_a_edit)
               and find('确认删除评论') is None)
    hide_keyboard_if_visible()
    tap('关闭消息操作')
    step('assistant-comments-closed', lambda: find('新评论', kind='android.widget.EditText') is None
         and badge_count(assistant, 1))
    open_comments(assistant)
    step('assistant-comments-reopened', lambda: visible_text(comment_a_edit) and not visible_text(comment_b))
    close_comments_with_back('assistant-comments-back-closed', assistant)

    user = ids['user']
    open_actions(user)
    if not reaction_state(user, None):
        raise AssertionError('user reaction must initially be neutral in dedicated test data')
    react(user, '喜欢这条消息', 'like', 'user-like')
    open_comments(user)
    if visible_text(comment_user):
        raise AssertionError('user acceptance comment already exists; refusing duplicate write')
    enter('新评论', comment_user)
    write_step('user-comment-added', lambda: tap('添加评论'),
               lambda: visible_text(comment_user) and empty_new_comment())
    close_comments_with_back('user-comments-back-closed', user)
    step('user-comment-badge', lambda: badge_count(user, 1))


def phase_restore():
    # 可由主调用方重启应用后单独运行；这里仅核对 UI，绝不自行重启或宣称后端持久化。
    open_actions(ids['assistant'])
    step('restore-assistant-reaction', lambda: reaction_state(ids['assistant'], None))
    open_comments(ids['assistant'])
    step('restore-assistant-comment', lambda: visible_text(comment_a_edit) and not visible_text(comment_b))
    close_comments_with_back('restore-assistant-closed', ids['assistant'])
    open_actions(ids['user'])
    step('restore-user-reaction', lambda: reaction_state(ids['user'], 'like'))
    open_comments(ids['user'])
    step('restore-user-comment', lambda: visible_text(comment_user))
    close_comments_with_back('restore-user-closed', ids['user'])


try:
    size = sh('shell', 'wm', 'size').decode()
    width, height = map(int, re.findall(r'(\d+)x(\d+)', size)[-1])
    density_text = sh('shell', 'wm', 'density').decode()
    density = int(re.findall(r'(\d+)', density_text)[-1]) / 160
    refresh()
    if find('打开空间侧栏') is None or find('消息输入框') is None or not correct_space():
        raise AssertionError('expected chat and exact test space must already be visible')
    result['status'] = 'running'
    save()
    step('chat-preflight-' + args.phase, lambda: find('打开空间侧栏') is not None
         and find('消息输入框') is not None and correct_space())
    for phase in phases:
        result['phases'][phase] = 'attempted'
        save()
        {'reaction': phase_reaction, 'comments': phase_comments, 'restore': phase_restore}[phase]()
        result['phases'][phase] = 'passed'
        save()
    result['status'] = 'passed-ui-only'
    save()
except Exception as error:
    result['status'] = 'failed'
    result['error'] = str(error)
    try:
        refresh()
        capture('message-feedback-failure')
        result['failureEvidence'] = ['message-feedback-failure.xml', 'message-feedback-failure.png']
    except Exception as capture_error:
        result['captureError'] = str(capture_error)
    save()
    raise
