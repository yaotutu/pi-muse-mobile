"""任务页真实原生 UI 验收；仅系统触摸/输入，不注入状态、不读凭据、不 mock。"""
import datetime
import json
import pathlib
import re
import sys
import time

assert len(sys.argv) == 2, 'Usage: e2e-tasks-visual-native.py EVIDENCE_ROOT'
prefix = pathlib.Path(__file__).with_name('e2e-themes-native.py').read_text()
exec(prefix.split('\ntry:\n')[0], globals())
assert root.is_dir() and (root/'context.json').is_file(), 'Evidence root with context.json required'
space, marker = context['spaceId'], context['marker']
ids = context['resourceIds']
assert space != 'local-main' and marker
assert all(isinstance(ids.get(k), list) and len(ids[k]) == 1 for k in ('jobs', 'activities', 'monitors'))
job_id, activity_id, monitor_id = (ids[k][0] for k in ('jobs', 'activities', 'monitors'))
prepared = json.loads((root/'prepare-resources.json').read_text())
job, activity, monitor = (prepared[k][0] for k in ('jobs', 'activities', 'monitors'))
steps = json.loads((root/'activity-created.json').read_text())['detail']['steps']
assert (job['id'], activity['id'], monitor['id']) == (job_id, activity_id, monitor_id)
assert (job['originSpaceId'], activity['spaceId'], monitor['originSpaceId']) == (space, space, space)
assert job['status'] == 'scheduled' and job['enabled'] and monitor['status'] == 'paused'
assert datetime.datetime.fromisoformat(job['at'].replace('Z', '+00:00')) > datetime.datetime.now(datetime.timezone.utc)
activity_title, monitor_title = activity['title'], monitor['title']
saved, unsaved = marker+' native edited task', marker+' narrow unsaved task'
original_size = original_density = ''
size_changed = False
stage = 'bootstrap'


def begin(name):
    global stage
    stage = name
    print('STEP', name, flush=True)


def texts():
    refresh()
    return [n.get('text', '') for n in tree.iter('node') if visible(n) and n.get('text')]


def seek(part, scrolling=False, down=False):
    end = time.time()+45
    while time.time() < end:
        refresh()
        if any(part in text for text in texts()):
            return
        if scrolling:
            scroll(down)
        else:
            time.sleep(.4)
    raise AssertionError('Missing visible text: '+part)


def top():
    refresh()
    for _ in range(30):
        before = tuple(n.get('text', '') for n in tree.iter('node') if visible(n) and n.get('text'))
        scroll(down=True)
        refresh()
        after = tuple(n.get('text', '') for n in tree.iter('node') if visible(n) and n.get('text'))
        if after == before:
            return
    raise AssertionError('ScrollView did not reach the top')


def tap_top(label):
    refresh()
    if find(label) is not None:
        tap(label)
        return
    tap(label, scrolling=True, down=True)


def owner(kind):
    top()
    if kind == 'activity':
        wait('活动：'+activity_id, scrolling=True)
    elif kind == 'job':
        wait('任务 ID：'+job_id, scrolling=True)
    else:
        wait('monitor-item-'+monitor_id, scrolling=True)
        wait(monitor_title, scrolling=True)
    wait('来源空间：'+space, scrolling=True)


def back_to(kind):
    tap_top('活动历史' if kind == 'activity' else '定时任务')
    refresh()
    label = '返回活动列表' if kind == 'activity' else '返回定时任务列表'
    if find(label) is not None:
        tap(label, scrolling=True, down=True)


def select_scope(label):
    node = find(label)
    if node is None or node.get('selected') != 'true':
        tap_top(label)
    assert wait(label, scrolling=True).get('selected') == 'true'


def status_filter(label):
    for _ in range(10):
        refresh()
        node = find(label)
        if node is not None and node.get('clickable') == 'true':
            tap(label)
            return
        row = find('活动状态筛选')
        if row is None:
            scroll(down=True)
            continue
        x1, y1, x2, y2 = bounds(row)
        left, right, middle = int(x1+(x2-x1)*.12), int(x1+(x2-x1)*.88), (y1+y2)//2
        start, end = (left, right) if label == '全部活动状态' else (right, left)
        sh('shell', 'input', 'swipe', str(start), str(middle), str(end), str(middle), '400')
        time.sleep(.3)
    raise AssertionError('Missing activity status filter: '+label)


def order(labels):
    refresh()
    current = next((label for label in labels if find(label) is not None), None)
    assert current is not None
    if current != labels[0]:
        tap(current)
    wait(labels[0])


def timeline():
    expected = ['activity-step-'+step['runId']+'-'+step['id'] for step in steps]
    observed = []
    top()
    for _ in range(40):
        refresh()
        for node in tree.iter('node'):
            resource_id = node.get('resource-id', '')
            if visible(node) and resource_id.startswith('activity-step-'):
                assert resource_id in expected
                if resource_id not in observed:
                    observed.append(resource_id)
        if observed == expected:
            return
        scroll()
    raise AssertionError('Activity step order mismatch: '+repr(observed))


def job_confirm(action):
    # 写请求前以真实详情中的 ID 与来源空间复核归属，绝不操作其它空间资源。
    owner('job')
    tap(action, scrolling=True)
    wait('确认'+action, scrolling=True)
    wait(job_id, scrolling=True)
    tap('确认'+action, scrolling=True)


def hide_keyboard():
    state = sh('shell', 'dumpsys', 'window').decode()
    focus = re.search(r'mCurrentFocus=[^\n]*', state)
    shown = any('InputMethod}' in block.splitlines()[0] and 'mHasSurface=true' in block and 'isVisible=true' in block
                for match in re.finditer(r'(?ms)^  Window #\d+ .*?(?=^  Window #\d+ |\Z)', state)
                for block in [match.group(0)])
    if shown and focus is not None and 'host.exp.exponent/' in focus.group():
        sh('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        time.sleep(.3)


def capture_sections(theme):
    # 每个分区截图前回到顶部，不继承上一主题或上一分区的滚动位置。
    tap_top('任务')
    back_to('activity')
    select_scope('当前空间活动')
    status_filter('全部活动状态')
    top()
    wait('activity-open-'+activity_id, scrolling=True)
    capture(theme+'-activity-list')
    tap('activity-open-'+activity_id, scrolling=True)
    seek('执行步骤 ·', scrolling=True)
    owner('activity')
    capture(theme+'-activity-detail')
    back_to('job')
    select_scope('当前空间定时任务')
    tap_top('按下次执行')
    order(('升序', '降序'))
    top()
    wait('job-open-'+job_id, scrolling=True)
    capture(theme+'-jobs-list')
    tap('job-open-'+job_id, scrolling=True)
    owner('job')
    capture(theme+'-job-detail')
    back_to('job')
    tap_top('网页监控')
    select_scope('当前空间监控')
    tap_top('按创建时间排序')
    order(('排序方向：降序', '排序方向：升序'))
    top()
    wait('monitor-item-'+monitor_id, scrolling=True)
    capture(theme+'-monitors-list')
    owner('monitor')
    capture(theme+'-monitor-card')


def restore():
    global width, height
    if size_changed and original_size:
        saved_size = re.findall(r'Override size: (\d+x\d+)', original_size)
        sh('shell', 'wm', 'size', saved_size[0] if saved_size else 'reset')
        width, height = map(int, re.findall(r'(\d+)x(\d+)', original_size)[-1])
    if original_density:
        saved_density = re.search(r'Override density: (\d+)', original_density)
        sh('shell', 'wm', 'density', saved_density.group(1) if saved_density else 'reset')
    time.sleep(1)
    launch()
    tap_top('应用')
    choose_theme('classic')
    tap_top('聊天')
    select_space('主空间', 'main')
    hide_keyboard()


failure = None
try:
    begin('launch dedicated real space')
    original_size = sh('shell', 'wm', 'size').decode()
    original_density = sh('shell', 'wm', 'density').decode()
    width, height = map(int, re.findall(r'(\d+)x(\d+)', original_size)[-1])
    sh('reverse', 'tcp:8082', 'tcp:8082')
    launch()
    select_space(space, space, space)
    wait(space)
    passed('Metro app launched and dedicated real space selected')

    begin('activity scopes filters detail and refresh')
    tap_top('任务')
    back_to('activity')
    assert wait('全部空间活动', scrolling=True).get('selected') == 'true'
    wait('activity-open-'+activity_id, scrolling=True)
    select_scope('当前空间活动')
    wait('activity-open-'+activity_id, scrolling=True)
    select_scope('全部空间活动')
    status_filter('已完成')
    assert wait('已完成').get('selected') == 'true'
    tap('activity-open-'+activity_id, scrolling=True)
    seek('执行步骤 ·', scrolling=True)
    owner('activity')
    timeline()
    tap_top('返回活动列表')
    tap_top('刷新活动列表')
    wait('activity-open-'+activity_id, scrolling=True)
    passed('activity current/all scopes, completed filter, real steps and refresh')

    begin('jobs scopes sorts and detail')
    tap_top('定时任务')
    assert wait('全部空间定时任务', scrolling=True).get('selected') == 'true'
    wait('job-open-'+job_id, scrolling=True)
    select_scope('当前空间定时任务')
    for label in ('按下次执行', '按更新时间', '按创建时间'):
        tap_top(label)
        assert wait(label).get('selected') == 'true'
        for direction in ('升序', '降序'):
            order((direction, '降序' if direction == '升序' else '升序'))
            wait('job-open-'+job_id, scrolling=True)
    tap('job-open-'+job_id, scrolling=True)
    owner('job')
    passed('job all/current scopes, three sorts, both directions and detail')

    begin('job pause resume edit and delete cancel')
    job_confirm('暂停调度')
    wait('已暂停', scrolling=True, down=True)
    wait('调度未启用', scrolling=True, down=True)
    job_confirm('恢复调度')
    wait('已排期', scrolling=True, down=True)
    wait('调度已启用', scrolling=True, down=True)
    tap_top('删除定时任务')
    wait('确认删除任务？', scrolling=True)
    wait(job_id, scrolling=True)
    tap('放弃任务操作', scrolling=True)
    wait('已排期', scrolling=True, down=True)
    seek('下次执行：', scrolling=True, down=True)
    before = next(text for text in texts() if text.startswith('下次执行：'))
    owner('job')
    tap('编辑定时任务', scrolling=True)
    tap_top('编辑任务')
    enter('定时任务内容', saved)
    tap('保存定时任务', scrolling=True)
    wait('任务已更新', scrolling=True, down=True)
    wait(saved, scrolling=True, down=True)
    seek('下次执行：', scrolling=True, down=True)
    assert next(text for text in texts() if text.startswith('下次执行：')) == before
    passed('job pause/resume/delete confirmations and prompt edit keep future schedule')

    begin('monitor scopes sorts and controls')
    tap_top('网页监控')
    assert wait('全部空间监控', scrolling=True).get('selected') == 'true'
    wait('monitor-item-'+monitor_id, scrolling=True)
    select_scope('当前空间监控')
    for label in ('按创建时间排序', '按最近检查排序', '按状态排序'):
        tap_top(label)
        assert wait(label).get('selected') == 'true'
        for direction in ('排序方向：升序', '排序方向：降序'):
            other = '排序方向：降序' if direction == '排序方向：升序' else '排序方向：升序'
            order((direction, other))
            wait('monitor-item-'+monitor_id, scrolling=True)
    owner('monitor')
    tap('恢复 '+monitor_title, scrolling=True)
    wait('监控中', scrolling=True, down=True)
    tap('暂停 '+monitor_title, scrolling=True)
    wait('已暂停', scrolling=True, down=True)
    passed('monitor all/current scopes, three sorts, resume then final pause')

    begin('monitor stop and delete confirmations cancelled')
    owner('monitor')
    tap('停止 '+monitor_title, scrolling=True)
    wait('取消停止 '+monitor_title, scrolling=True, down=True)
    wait(monitor_title, scrolling=True)
    tap('取消停止 '+monitor_title, scrolling=True, down=True)
    owner('monitor')
    wait('已暂停', scrolling=True, down=True)
    owner('monitor')
    tap('删除 '+monitor_title, scrolling=True)
    wait('取消删除 '+monitor_title, scrolling=True, down=True)
    wait('监控 ID：'+monitor_id, scrolling=True)
    tap('取消删除 '+monitor_title, scrolling=True, down=True)
    owner('monitor')
    wait('已暂停', scrolling=True, down=True)
    passed('monitor stop/delete confirmations cancelled; fixture remains paused')

    begin('session panel shared activity history')
    tap_top('聊天')
    tap('打开当前会话面板')
    tap('历史')
    wait('activity-open-'+activity_id, scrolling=True)
    tap('activity-open-'+activity_id, scrolling=True)
    seek('执行步骤 ·', scrolling=True)
    owner('activity')
    timeline()
    tap('关闭会话面板')
    passed('session-panel history shares real activity detail and steps')

    begin('three themes section captures')
    for theme in ('classic', 'light', 'dark'):
        tap_top('应用')
        choose_theme(theme)
        capture_sections(theme)
    passed('three themes captured activity/job/monitor sections from top')

    begin('320dp section captures and editor cancel')
    density = int(re.findall(r'\d+', original_density)[-1])
    narrow_width = round(320*density/160)
    narrow_height = round(height*narrow_width/width)
    size_changed = True
    sh('shell', 'wm', 'size', f'{narrow_width}x{narrow_height}')
    width, height = narrow_width, narrow_height
    time.sleep(1)
    tap_top('任务')
    back_to('activity')
    select_scope('当前空间活动')
    status_filter('全部活动状态')
    top()
    wait('activity-open-'+activity_id, scrolling=True)
    capture('narrow-activity-list')
    back_to('job')
    top()
    wait('job-open-'+job_id, scrolling=True)
    capture('narrow-jobs-list')
    tap('job-open-'+job_id, scrolling=True)
    owner('job')
    tap('编辑定时任务', scrolling=True)
    tap_top('编辑任务')
    enter('定时任务内容', unsaved)
    capture('narrow-job-editor')
    tap('取消编辑定时任务', scrolling=True)
    wait(saved, scrolling=True, down=True)
    assert not any(unsaved in text for text in texts())
    tap_top('网页监控')
    top()
    wait('monitor-item-'+monitor_id, scrolling=True)
    capture('narrow-monitors-list')
    passed('320dp activity/job/monitor lists and editor cancel preserve saved prompt')
except Exception as error:
    # 失败只保存现场和阶段，不重放任何写入；由主 Agent 根据证据人工核对。
    failure = stage+': '+str(error)
    try:
        capture('native-failure')
    except Exception as capture_error:
        failure += '; failure capture: '+str(capture_error)
    (root/'native-failure.json').write_text(json.dumps(
        {'passed': False, 'stage': stage, 'error': str(error), 'checks': checks}, ensure_ascii=False, indent=2))
finally:
    try:
        restore()
    except Exception as error:
        failure = ('restore environment: '+str(error)) if failure is None else failure+'; restore: '+str(error)

if failure is not None:
    save(False, failure)
    print('FAIL NATIVE', failure, flush=True)
    sys.exit(1)
passed('restored original size/density, classic theme, main space and hidden keyboard')
save(True)
print('PASS NATIVE tasks visual flow complete', flush=True)
