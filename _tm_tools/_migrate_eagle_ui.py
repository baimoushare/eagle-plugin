# -*- coding: utf-8 -*-
"""一次性迁移脚本:给 eagle-ui.js 的 tagPicker 增加分组支持与刷新按钮、folderPicker rootLabel 函数化。"""
import io

path = 'eagle-ui.js'
src = io.open(path, encoding='utf-8').read()

# ---------- 1. tagPicker state 增加 groups / collapsedGroups ----------
old_state = """        const state = {
            tags: [],          // [{name, count|null}]
            selected: [],
            recent: (Array.isArray(o.recent) ? o.recent : []).map(String).filter(Boolean),
            keyword: '',
            loading: false,
            error: '',
        };"""
new_state = """        const state = {
            tags: [],          // [{name, count|null}]
            groups: [],        // [{id, name, tags: [标签名...]}]，Eagle 标签分组（可选）
            collapsedGroups: new Set(), // 记住用户折叠了哪些分组
            selected: [],
            recent: (Array.isArray(o.recent) ? o.recent : []).map(String).filter(Boolean),
            keyword: '',
            loading: false,
            error: '',
        };"""
assert old_state in src, 'state anchor missing'
src = src.replace(old_state, new_state, 1)

# ---------- 2. tagPicker head 增加 onRefresh 按钮 ----------
old_head = """        const mode = el('span', 'egc-picker-mode', '可多选');
        head.append(search, mode);"""
new_head = """        const mode = el('span', 'egc-picker-mode', '可多选');
        head.append(search, mode);
        // 提供刷新回调时（如 X 版"刷新标签"），在弹层头部出现刷新按钮
        if (typeof o.onRefresh === 'function') {
            const refreshBtn = el('button', 'egc-menu-refresh', '刷新标签');
            refreshBtn.type = 'button';
            refreshBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                o.onRefresh();
            });
            head.appendChild(refreshBtn);
        }"""
assert old_head in src, 'head anchor missing'
src = src.replace(old_head, new_head, 1)

# ---------- 3. 列表渲染重构:抽 buildOption + 分组渲染 ----------
old_list = """            // 全量列表（两列网格）
            list.innerHTML = '';
            if (state.loading) {
                list.appendChild(el('div', 'egc-tag-empty', '正在读取 Eagle 标签...'));
                return;
            }
            if (state.error) {
                list.appendChild(el('div', 'egc-tag-empty', state.error));
                return;
            }
            const items = el('div', 'egc-tag-items');
            let visibleCount = 0;
            state.tags.forEach(entry => {
                if (keyword && !entry.name.toLowerCase().includes(keyword)) return;
                visibleCount++;
                const selected = state.selected.includes(entry.name);
                const option = el('button', 'egc-tag-option' + (selected ? ' active' : ''));
                option.type = 'button';
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', selected ? 'true' : 'false');
                option.innerHTML = '<span class="egc-tag-option-check">' + (selected ? '✓' : '') + '</span><span class="egc-tag-option-label"></span><span class="egc-tag-option-count"></span>';
                option.querySelector('.egc-tag-option-label').textContent = entry.name;
                option.querySelector('.egc-tag-option-count').textContent = entry.count === null || entry.count === undefined ? '' : String(entry.count);
                option.addEventListener('click', () => {
                    touchRecent(entry.name);
                    setSelected(selected ? state.selected.filter(v => v !== entry.name) : [...state.selected, entry.name]);
                });
                items.appendChild(option);
            });
            if (visibleCount > 0) list.appendChild(items);
            else list.appendChild(el('div', 'egc-tag-empty', state.tags.length === 0 ? 'Eagle 中没有可用标签' : '没有匹配的 Eagle 标签'));"""

new_list = """            // 全量列表（两列网格；灌入过分组时按分组分区渲染，标题可折叠）
            list.innerHTML = '';
            if (state.loading) {
                list.appendChild(el('div', 'egc-tag-empty', '正在读取 Eagle 标签...'));
                return;
            }
            if (state.error) {
                list.appendChild(el('div', 'egc-tag-empty', state.error));
                return;
            }

            // 单个标签行：勾选切换 + 数量展示
            const buildOption = (entry) => {
                const selected = state.selected.includes(entry.name);
                const option = el('button', 'egc-tag-option' + (selected ? ' active' : ''));
                option.type = 'button';
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', selected ? 'true' : 'false');
                option.innerHTML = '<span class="egc-tag-option-check">' + (selected ? '✓' : '') + '</span><span class="egc-tag-option-label"></span><span class="egc-tag-option-count"></span>';
                option.querySelector('.egc-tag-option-label').textContent = entry.name;
                option.querySelector('.egc-tag-option-count').textContent = entry.count === null || entry.count === undefined ? '' : String(entry.count);
                option.addEventListener('click', () => {
                    touchRecent(entry.name);
                    setSelected(selected ? state.selected.filter(v => v !== entry.name) : [...state.selected, entry.name]);
                });
                return option;
            };
            // 分组区：标题行（可折叠）+ 组内两列；单个条目时退化为单列
            const buildGroup = (groupId, title, entries) => {
                const visibleEntries = entries.filter(entry => !keyword || entry.name.toLowerCase().includes(keyword));
                if (visibleEntries.length === 0) return false;
                const section = el('section', 'egc-tag-group');
                const collapsed = state.collapsedGroups.has(groupId);
                const header = el('button', 'egc-tag-group-title' + (collapsed ? ' collapsed' : ''));
                header.type = 'button';
                header.innerHTML = '<span>' + title + ' <span class="egc-tag-group-title-meta">(' + visibleEntries.length + ')</span></span><span class="egc-tag-group-title-chevron">⌄</span>';
                header.addEventListener('click', () => {
                    if (state.collapsedGroups.has(groupId)) state.collapsedGroups.delete(groupId);
                    else state.collapsedGroups.add(groupId);
                    renderMenu();
                });
                section.appendChild(header);
                if (!collapsed) {
                    const items = el('div', 'egc-tag-items' + (visibleEntries.length < 2 ? ' single-column' : ''));
                    visibleEntries.forEach(entry => items.appendChild(buildOption(entry)));
                    section.appendChild(items);
                }
                list.appendChild(section);
                return true;
            };

            if (state.groups.length > 0) {
                // 分组渲染：先各分组，再"未分组"兜底（与 Eagle 官方弹层一致）
                const byName = new Map(state.tags.map(t => [t.name, t]));
                const groupedNames = new Set();
                let hasVisibleGroup = false;
                state.groups.forEach(group => {
                    const entries = (Array.isArray(group.tags) ? group.tags : [])
                        .map(name => byName.get(String(name || '').trim()))
                        .filter(Boolean);
                    entries.forEach(entry => groupedNames.add(entry.name));
                    if (buildGroup(String(group.id), String(group.name || '未命名分组'), entries)) hasVisibleGroup = true;
                });
                const ungrouped = state.tags.filter(entry => !groupedNames.has(entry.name));
                if (buildGroup('__ungrouped__', '未分组', ungrouped)) hasVisibleGroup = true;
                if (!hasVisibleGroup) {
                    list.appendChild(el('div', 'egc-tag-empty', state.tags.length === 0 ? 'Eagle 中没有可用标签' : '没有匹配的 Eagle 标签'));
                }
            } else {
                // 无分组：平铺两列
                const items = el('div', 'egc-tag-items');
                let visibleCount = 0;
                state.tags.forEach(entry => {
                    if (keyword && !entry.name.toLowerCase().includes(keyword)) return;
                    visibleCount++;
                    items.appendChild(buildOption(entry));
                });
                if (visibleCount > 0) list.appendChild(items);
                else list.appendChild(el('div', 'egc-tag-empty', state.tags.length === 0 ? 'Eagle 中没有可用标签' : '没有匹配的 Eagle 标签'));
            }"""
assert old_list in src, 'list anchor missing'
src = src.replace(old_list, new_list, 1)

# ---------- 4. single-column 样式 ----------
old_css = ".egc-tag-items {\n    display: grid;\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n    gap: 0 4px;\n    padding-top: 2px;\n}"
new_css = ".egc-tag-items {\n    display: grid;\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n    gap: 0 4px;\n    padding-top: 2px;\n}\n.egc-tag-items.single-column { grid-template-columns: minmax(0, 1fr); }"
assert old_css in src, 'css anchor missing'
src = src.replace(old_css, new_css, 1)

# ---------- 5. handle 暴露 setGroups ----------
old_set = "            setRecent(tags) { state.recent = normalize(tags).slice(0, MAX_RECENT); renderMenu(); },"
new_set = ("            setRecent(tags) { state.recent = normalize(tags).slice(0, MAX_RECENT); renderMenu(); },\n"
           "            /** 灌入 Eagle 标签分组 groups: [{id, name, tags: [标签名...]}]，传入后列表按分组渲染 */\n"
           "            setGroups(groups) {\n"
           "                state.groups = (Array.isArray(groups) ? groups : [])\n"
           "                    .map(g => ({ id: String(g.id), name: String(g.name || '未命名分组'), tags: Array.isArray(g.tags) ? g.tags.map(String) : [] }));\n"
           "                renderMenu();\n"
           "            },")
assert old_set in src, 'setRecent anchor missing'
src = src.replace(old_set, new_set, 1)

io.open(path, 'w', encoding='utf-8', newline='').write(src)
print('tagPicker groups OK')
