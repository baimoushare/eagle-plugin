# -*- coding: utf-8 -*-
"""eagle-ui.js v1.2.0 -> v1.3.0:修复 setTags 不清 loading;folderPicker 单选化+最近文件夹;新增折叠面板/连接状态/mode卡/本地目录行/进度区/help 组件。"""
import io

path = 'eagle-ui.js'
src = io.open(path, encoding='utf-8').read()

def rep(old, new, cnt=1):
    global src
    assert old in src, 'MISSING: ' + old[:60]
    src = src.replace(old, new, cnt)

# ---------- 0. 版本 ----------
rep("const VERSION = '1.2.0';", "const VERSION = '1.3.0';")

# ---------- 1. 修复:setTags 灌入数据时清除 loading,否则列表永远显示"正在读取" ----------
rep("""            setTags(entries) {
                state.tags = (Array.isArray(entries) ? entries : [])
                    .map(t => ({ name: String(t.name || '').trim(), count: Number.isFinite(Number(t.count)) ? Number(t.count) : null }))
                    .filter(t => t.name);
                state.error = '';
                renderMenu();
            },""",
"""            setTags(entries) {
                state.tags = (Array.isArray(entries) ? entries : [])
                    .map(t => ({ name: String(t.name || '').trim(), count: Number.isFinite(Number(t.count)) ? Number(t.count) : null }))
                    .filter(t => t.name);
                state.error = '';
                // 灌入数据即代表加载完成,必须清掉 loading,否则列表永远停在"正在读取"
                state.loading = false;
                renderMenu();
            },""")

# ---------- 2. folderPicker 单选化 + 最近文件夹 ----------
rep("        const multiple = o.multiple !== false;\n        const menuHeight = o.menuHeight || 540;",
    "        const menuHeight = o.menuHeight || 540;")

rep("""        const state = {
            folders: [],            // Eagle 原始树 [{id,name,children}]
            selected: [],           // 已选 ID 列表（'' 表示根目录，约定不存 ''，空数组即根目录）
            expanded: new Set(),    // 展开的节点 ID
            keyword: '',
        };""",
"""        const state = {
            folders: [],            // Eagle 原始树 [{id,name,children}]
            selected: [],           // 已选 ID（单选语义,至多一个元素;空数组即根目录/自动目录）
            recent: [],             // 最近使用的文件夹 ID（由脚本持久化,经 recent/onRecentChange 供给回传）
            expanded: new Set(),    // 展开的节点 ID
            keyword: '',
        };""")

# trigger 摘要:删多选分支
rep("""            let text;
            if (state.selected.length === 0) text = rootLabelText();
            else if (multiple) text = names.length > 1 ? `${names.length} 个文件夹` : (names[0] || rootLabelText());
            else text = names[0] || rootLabelText();""",
"""            const text = state.selected.length === 0 ? rootLabelText() : (names[0] || rootLabelText());""")

# footer 文案:删多选分支
rep("        const footerHint = el('span', '', multiple ? '可多选文件夹' : '选择保存目录');",
    "        const footerHint = el('span', '', '选择保存目录');")

# toggleSelection:单选化 + 记住最近
rep("""        /* —— 勾选逻辑（multiple:false 时单选替换并自动收起） —— */
        function toggleSelection(folderId) {
            const id = String(folderId || '').trim();
            if (!id) {
                state.selected = [];
            } else if (state.selected.includes(id)) {
                state.selected = state.selected.filter(v => v !== id);
            } else if (multiple) {
                state.selected = [...state.selected, id];
            } else {
                state.selected = [id];
            }
            // 展开已选目录的祖先链，重新打开时能直接看到选中位置
            const path = id ? findPathById(id, state.folders) : null;
            if (path) path.forEach(pid => state.expanded.add(pid));
            renderTree();
            syncTriggerLabel();
            if (o.onChange) o.onChange(state.selected.slice());
            if (!multiple && state.selected.length > 0) close();
        }""",
"""        /* —— 最近文件夹:选中即置顶,上限 5 个,由脚本持久化 —— */
        function touchRecentFolder(id) {
            if (!id) return;
            state.recent = [id, ...state.recent.filter(v => v !== id)].slice(0, 5);
            if (o.onRecentChange) o.onRecentChange(state.recent.slice());
        }

        /* —— 勾选逻辑（单选:再次点击取消;选中非根目录后自动收起） —— */
        function toggleSelection(folderId) {
            const id = String(folderId || '').trim();
            if (!id) {
                state.selected = [];
            } else if (state.selected.includes(id)) {
                state.selected = [];
            } else {
                state.selected = [id];
                touchRecentFolder(id);
            }
            // 展开已选目录的祖先链，重新打开时能直接看到选中位置
            const path = id ? findPathById(id, state.folders) : null;
            if (path) path.forEach(pid => state.expanded.add(pid));
            renderTree();
            syncTriggerLabel();
            if (o.onChange) o.onChange(state.selected.slice());
            if (state.selected.length > 0) close();
        }""")

# 菜单顶部:已选摘要 chip -> 真实"最近使用"文件夹列表
rep("""            // 顶部"最近"chip：展示当前已选摘要，点击聚焦树中对应项
            recent.innerHTML = '';
            const selectedNames = state.selected.map(id => findNameById(id)).filter(Boolean);
            recent.classList.toggle('has-items', selectedNames.length > 0 && !keyword);
            if (selectedNames.length > 0 && !keyword) {
                const chip = el('button', 'egc-recent-chip');
                chip.type = 'button';
                chip.textContent = selectedNames.length > 1 ? `已选：${selectedNames.length} 个文件夹` : `已选：${selectedNames[0]}`;
                chip.title = selectedNames.join('、');
                recent.appendChild(chip);
            }""",
"""            // 顶部"最近使用"文件夹 chip：点击即选中（搜索时隐藏,避免干扰过滤结果）
            recent.innerHTML = '';
            const recentNodes = (keyword ? [] : state.recent)
                .map(id => ({ id, name: findNameById(id) }))
                .filter(n => n.name);
            recent.classList.toggle('has-items', recentNodes.length > 0);
            recentNodes.forEach(n => {
                const chip = el('button', 'egc-recent-chip', n.name);
                chip.type = 'button';
                chip.title = '快速选择：' + n.name;
                chip.addEventListener('click', () => toggleSelection(n.id));
                recent.appendChild(chip);
            });""")

# handle:暴露 setRecent
rep("""            /** 灌入 Eagle 文件夹树（原始 children 结构即可） */
            setFolders(treeData) { state.folders = treeData || []; renderTree(); syncTriggerLabel(); },""",
"""            /** 灌入 Eagle 文件夹树（原始 children 结构即可） */
            setFolders(treeData) { state.folders = treeData || []; renderTree(); syncTriggerLabel(); },
            /** 灌入最近使用的文件夹 ID 列表（配合 onRecentChange 由脚本持久化） */
            setRecent(ids) {
                state.recent = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean).slice(0, 5);
                renderTree();
            },""")

# ---------- 3. 新组件 CSS(追加到无障碍规则之前) ----------
NEW_CSS = '''
/* ══════════ 折叠面板(fab/web 形态):折叠为悬浮球,展开为完整面板 ══════════ */
.egc-coll {
    position: fixed;
    top: 80px;
    right: 12px;
    z-index: 99999;
    width: min(296px, calc(100vw - 24px));
    max-width: calc(100vw - 24px);
    min-width: 0;
    box-sizing: border-box;
    background: var(--egc-bg);
    border: 1px solid var(--egc-border);
    border-radius: var(--egc-radius);
    box-shadow: var(--egc-shadow);
    backdrop-filter: blur(18px) saturate(140%);
    -webkit-backdrop-filter: blur(18px) saturate(140%);
    font-family: var(--egc-font);
    font-size: 13px;
    color: var(--egc-fg);
    transition:
        width 320ms var(--egc-ease),
        max-height 360ms var(--egc-ease),
        border-radius 260ms var(--egc-ease),
        transform 180ms ease,
        box-shadow 220ms ease,
        background 220ms ease;
    max-height: 720px;
    overflow: hidden;
    user-select: none;
}
.egc-coll::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background:
        linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0) 42%),
        radial-gradient(circle at top right, rgba(255,255,255,0.10), transparent 46%);
    opacity: 0.72;
}
.egc-coll.collapsed {
    width: 46px;
    height: 46px;
    min-height: 46px;
    max-height: 46px;
    border-radius: 50%;
    cursor: pointer;
    background: rgba(29, 32, 40, 0.78);
    border-color: rgba(255, 255, 255, 0.14);
    box-shadow: 0 12px 26px rgba(10, 14, 22, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.egc-coll.collapsed::after {
    content: "";
    position: absolute;
    inset: -6px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.18);
    opacity: 0;
    transform: scale(0.88);
    transition: opacity 220ms ease, transform 260ms var(--egc-ease);
    pointer-events: none;
}
.egc-coll.collapsed:hover { transform: translateY(-2px) scale(1.035); }
.egc-coll.collapsed:hover::after { opacity: 0.95; transform: scale(1.05); }
.egc-coll.collapsed:active { transform: scale(0.98); }
.egc-coll.expanded { transform: translateY(0); height: auto; min-height: 0; max-height: 720px; border-radius: 14px; overflow: visible; }
.egc-coll.expanded:hover { box-shadow: 0 18px 46px rgba(4, 10, 20, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.09); }
.egc-coll-icon {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #f6f8fb;
    transition: opacity 200ms ease, transform 300ms var(--egc-ease);
}
.egc-coll-icon svg { width: 22px; height: 22px; }
.egc-coll.expanded .egc-coll-icon { opacity: 0; transform: scale(0.6); pointer-events: none; }
.egc-coll-header {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 14px 10px 14px;
    cursor: pointer;
    font-weight: 600;
    font-size: 14px;
    background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0)), rgba(255,255,255,0.02);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    transition: opacity 220ms ease, transform 320ms var(--egc-ease), max-height 320ms var(--egc-ease), padding 320ms var(--egc-ease);
}
.egc-coll.collapsed .egc-coll-header {
    opacity: 0;
    max-height: 0;
    padding: 0;
    overflow: hidden;
    transform: translateY(-6px);
    pointer-events: none;
    border-bottom-color: transparent;
}
.egc-coll-title { display: flex; align-items: center; gap: 10px; min-width: 0; max-width: 100%; overflow: hidden; }
.egc-coll-title > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.egc-coll-title-icon {
    width: 20px;
    height: 20px;
    flex: 0 0 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #f6f8fb;
    opacity: 0.95;
    transform-origin: center;
    transition: transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.egc-coll.expanded .egc-coll-header:hover .egc-coll-title-icon { transform: scale(1.06); }
.egc-coll-sub-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.egc-coll-sub { font-size: 11px; opacity: 0.72; font-weight: 400; margin-top: 2px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.egc-coll-toggle { font-size: 12px; opacity: 0.62; transition: transform 220ms var(--egc-ease); }
.egc-coll.expanded .egc-coll-toggle { transform: rotate(180deg); }
.egc-coll-body {
    position: relative;
    z-index: 1;
    padding: 12px 14px 14px 14px;
    display: grid;
    grid-template-rows: 1fr;
    opacity: 1;
    transition: opacity 220ms ease, transform 360ms var(--egc-ease), padding 360ms var(--egc-ease);
}
.egc-coll.collapsed .egc-coll-body {
    grid-template-rows: 0fr;
    padding-top: 0;
    padding-bottom: 0;
    opacity: 0;
    transform: translateY(8px);
    pointer-events: none;
}
.egc-coll-body-content { min-height: 0; max-width: 100%; overflow-x: hidden; overflow-y: visible; }
/* 边界护栏:目标站点全局样式不得撑宽面板内部结构 */
.egc-coll-header, .egc-coll-header > div, .egc-coll-body, .egc-coll-body-content { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
.egc-coll button { max-width: 100%; min-width: 0 !important; box-sizing: border-box; }

/* ── Eagle 连接状态灯 ── */
.egc-conn { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; font-size: 10px; line-height: 1; color: var(--egc-fg-faint); white-space: nowrap; }
.egc-conn-dot { width: 6px; height: 6px; border-radius: 50%; background: #f0b24b; box-shadow: 0 0 0 3px rgba(240, 178, 75, 0.12); }
.egc-conn.is-connected { color: rgba(190, 244, 204, 0.88); }
.egc-conn.is-connected .egc-conn-dot { background: #63d889; box-shadow: 0 0 0 3px rgba(99, 216, 137, 0.14); }
.egc-conn.is-disconnected { color: rgba(255, 190, 190, 0.88); }
.egc-conn.is-disconnected .egc-conn-dot { background: #ee6b6b; box-shadow: 0 0 0 3px rgba(238, 107, 107, 0.14); }

/* ── 保存方式双卡片(mode 切换) ── */
.egc-mode-card { margin-bottom: 12px; }
.egc-mode-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.egc-mode-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 42px;
    padding: 8px 11px;
    border-radius: 9px;
    border: 1px solid rgba(255, 255, 255, 0.10);
    background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03)), rgba(255, 255, 255, 0.04);
    color: rgba(236, 241, 247, 0.92);
    cursor: pointer;
    text-align: center;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
    font-family: var(--egc-font);
    transition: transform 140ms ease, border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}
.egc-mode-btn:hover { transform: translateY(-1px); border-color: rgba(255, 255, 255, 0.18); }
.egc-mode-btn:active { transform: scale(0.992); }
.egc-mode-btn.active {
    border: 1px solid rgba(171, 214, 255, 0.88);
    background: rgba(146, 186, 224, 0.16);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 0 0 1px rgba(138, 196, 245, 0.16);
    transform: none;
}
.egc-mode-btn:not(.active) { opacity: 0.72; }
.egc-mode-btn:disabled { opacity: 0.56; cursor: not-allowed; transform: none; }
.egc-mode-btn-title { font-size: 12px; font-weight: 600; color: #f6f8fb; display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── 本地下载目录行 ── */
.egc-local-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.egc-local-trigger {
    flex: 1;
    min-width: 0;
    max-width: 100%;
    height: 40px;
    padding: 0 12px;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(244, 247, 251, 0.92);
    font-size: 12px;
    font-family: var(--egc-font);
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: border-color 160ms ease, background 160ms ease;
}
.egc-local-trigger:hover { border-color: rgba(255, 255, 255, 0.22); background: rgba(255, 255, 255, 0.09); }
.egc-local-hint { margin-top: 5px; color: var(--egc-fg-fainter); font-size: 10px; line-height: 1.35; max-width: 100%; overflow-wrap: anywhere; }

/* ── 进度区(文本 + 进度条,默认隐藏) ── */
.egc-progress-block { margin-bottom: 12px; display: none; }
.egc-progress-block.visible { display: block; }
.egc-progress-text { font-size: 11px; color: var(--egc-fg-dim); margin-bottom: 6px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── 问号帮助提示(body 顶层浮层) ── */
.egc-help {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    border: 1px solid rgba(235, 240, 248, 0.42);
    border-radius: 50%;
    color: rgba(241, 245, 250, 0.78);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    padding: 0;
    box-sizing: border-box;
    vertical-align: middle;
    cursor: help;
    user-select: none;
    outline: none;
}
.egc-tooltip {
    position: fixed;
    z-index: 1000000;
    box-sizing: border-box;
    max-width: min(232px, calc(100vw - 24px));
    padding: 7px 9px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    background: rgba(18, 21, 28, 0.97);
    box-shadow: 0 10px 24px rgba(3, 8, 16, 0.30);
    color: rgba(246, 248, 252, 0.94);
    font-size: 11px;
    font-weight: 400;
    line-height: 1.45;
    white-space: normal;
    pointer-events: none;
    opacity: 0;
    transform: translateY(-3px);
    transition: opacity 140ms ease, transform 160ms ease;
}
.egc-tooltip.visible { opacity: 1; transform: translateY(0); }

'''
rep('/* ── 无障碍：用户开启"减少动态效果"时关闭动画 ── */', NEW_CSS + '/* ── 无障碍：用户开启"减少动态效果"时关闭动画 ── */')

# ---------- 4. 新组件 JS(插在 versionBadge 之前) ----------
NEW_JS = '''    /* ══════════════ 折叠面板(fab/web 形态) ══════════════ */

    /**
     * 创建折叠面板:折叠时为 46px 悬浮球,点击展开为完整毛玻璃面板。
     * 面板内容(字段/按钮等)由脚本填充到返回的 body 容器中。
     * @param {Object} opts
     * @param {string} opts.title          标题(如"Eagle 批量采集")
     * @param {string} [opts.subtitle]     副标题(如站点名·页面类型)
     * @param {string} opts.icon           SVG 内联字符串
     * @param {boolean} [opts.startCollapsed=true] 初始是否折叠
     * @param {string} [opts.top/right]    定位偏移
     * @returns {{el, body, subRow, setSubtitle, isExpanded, expand, collapse, toggle}}
     */
    function createCollapsiblePanel(opts) {
        injectStyles();
        const o = opts || {};
        const root = el('div', 'egc-coll');
        if (o.top) root.style.top = o.top;
        if (o.right) root.style.right = o.right;
        const icon = o.icon || '';
        root.innerHTML = `
            <div class="egc-coll-icon">${icon}</div>
            <div class="egc-coll-header">
                <div>
                    <div class="egc-coll-title"><span class="egc-coll-title-icon">${icon}</span><span class="egc-coll-title-text"></span></div>
                    <div class="egc-coll-sub-row"><div class="egc-coll-sub"></div></div>
                </div>
                <span class="egc-coll-toggle">▲</span>
            </div>
            <div class="egc-coll-body"><div class="egc-coll-body-content"></div></div>`;
        const titleText = root.querySelector('.egc-coll-title-text');
        const subEl = root.querySelector('.egc-coll-sub');
        const body = root.querySelector('.egc-coll-body-content');
        titleText.textContent = o.title || 'Eagle 批量采集';
        subEl.textContent = o.subtitle || '';
        const handle = {
            el: root,
            body,                     // 内容挂载点(脚本把字段/按钮塞进这里)
            subRow: root.querySelector('.egc-coll-sub-row'), // 副标题行,可挂连接状态灯等
            setSubtitle(text) { subEl.textContent = text || ''; },
            isExpanded() { return root.classList.contains('expanded'); },
            expand() { root.classList.remove('collapsed'); root.classList.add('expanded'); },
            collapse() { root.classList.remove('expanded'); root.classList.add('collapsed'); },
            toggle() { handle.isExpanded() ? handle.collapse() : handle.expand(); },
        };
        root.classList.add(o.startCollapsed === false ? 'expanded' : 'collapsed');
        // 展开态:点 header 折叠;折叠态:整个悬浮球可点(此时 header 已禁用交互)
        root.querySelector('.egc-coll-header').addEventListener('click', () => {
            if (handle.isExpanded()) handle.collapse();
        });
        root.addEventListener('click', (event) => {
            if (handle.isExpanded()) return;
            if (event.target === root || root.querySelector('.egc-coll-icon').contains(event.target)) handle.expand();
        });
        return handle;
    }

    /* ══════════════ Eagle 连接状态灯 ══════════════ */

    /**
     * 创建连接状态指示(pending 黄 / connected 绿 / disconnected 红)。
     * @param {string} [initialLabel='检测中']
     * @returns {{el, set: (state: 'pending'|'connected'|'disconnected', label?: string) => void}}
     */
    function createConnectionStatus(initialLabel) {
        injectStyles();
        const wrap = el('span', 'egc-conn');
        const dot = el('span', 'egc-conn-dot');
        const label = el('span', '', initialLabel || '检测中');
        wrap.append(dot, label);
        return {
            el: wrap,
            set(state, text) {
                wrap.classList.toggle('is-connected', state === 'connected');
                wrap.classList.toggle('is-disconnected', state === 'disconnected');
                if (text !== undefined) label.textContent = text;
            },
        };
    }

    /* ══════════════ 保存方式双卡片 ══════════════ */

    /**
     * 创建保存方式切换(保存到 Eagle / 本地下载)。
     * @param {Object} opts
     * @param {Array<{value: string, label: string}>} opts.options 选项
     * @param {string} [opts.value] 初始选中值
     * @param {(value: string) => void} [opts.onChange]
     * @returns {{el, set: (value: string, silent?: boolean) => void}}
     */
    function createModeSwitch(opts) {
        injectStyles();
        const o = opts || {};
        const wrap = el('div', 'egc-mode-card');
        const grid = el('div', 'egc-mode-grid');
        wrap.appendChild(grid);
        const buttons = new Map();
        (o.options || []).forEach(op => {
            const btn = el('button', 'egc-mode-btn');
            btn.type = 'button';
            btn.appendChild(el('span', 'egc-mode-btn-title', op.label));
            btn.addEventListener('click', () => handle.set(op.value));
            buttons.set(op.value, btn);
            grid.appendChild(btn);
        });
        const handle = {
            el: wrap,
            set(value, silent) {
                buttons.forEach((btn, key) => btn.classList.toggle('active', key === value));
                if (!silent && o.onChange) o.onChange(value);
            },
        };
        handle.set(o.value, true);
        return handle;
    }

    /* ══════════════ 本地下载目录行 ══════════════ */

    /**
     * 创建本地下载目录选择行(触发按钮 + 可选说明)。
     * @param {Object} opts
     * @param {string} [opts.label='默认下载文件夹'] 按钮文案
     * @param {string} [opts.hint]                   底部说明文字
     * @param {() => void} [opts.onPick]             点击按钮回调(脚本在此弹目录选择)
     * @returns {{el, setLabel, setHint}}
     */
    function createLocalFolderRow(opts) {
        injectStyles();
        const o = opts || {};
        const wrap = el('div');
        const row = el('div', 'egc-local-row');
        const trigger = el('button', 'egc-local-trigger', o.label || '默认下载文件夹');
        trigger.type = 'button';
        trigger.addEventListener('click', () => { if (o.onPick) o.onPick(); });
        row.appendChild(trigger);
        wrap.appendChild(row);
        const hintEl = el('div', 'egc-local-hint', o.hint || '');
        if (o.hint) wrap.appendChild(hintEl);
        return {
            el: wrap,
            setLabel(text) { trigger.textContent = text || '默认下载文件夹'; trigger.title = text || ''; },
            setHint(text) {
                hintEl.textContent = text || '';
                if (text && !wrap.contains(hintEl)) wrap.appendChild(hintEl);
            },
        };
    }

    /* ══════════════ 进度区(文本 + 进度条) ══════════════ */

    /**
     * 创建进度区,默认隐藏。
     * @returns {{el, show: (text?, percent?) => void, hide, setText, setBar}}
     */
    function createProgress() {
        injectStyles();
        const wrap = el('div', 'egc-progress-block');
        const text = el('div', 'egc-progress-text', '准备就绪');
        const outer = el('div', 'egc-progress-bar-outer');
        const inner = el('div', 'egc-progress-bar-inner');
        outer.appendChild(inner);
        wrap.append(text, outer);
        const handle = {
            el: wrap,
            show(t, percent) {
                wrap.classList.add('visible');
                if (t !== undefined) handle.setText(t);
                if (percent !== undefined) handle.setBar(percent);
            },
            hide() { wrap.classList.remove('visible'); },
            setText(t) { text.textContent = t; text.title = t; },
            setBar(percent) { inner.style.width = Math.max(0, Math.min(100, Number(percent) || 0)) + '%'; },
        };
        return handle;
    }

    /* ══════════════ 问号帮助提示 ══════════════ */

    let helpTooltipEl = null;
    function ensureHelpTooltip() {
        if (helpTooltipEl && helpTooltipEl.isConnected) return helpTooltipEl;
        helpTooltipEl = el('div', 'egc-tooltip');
        helpTooltipEl.setAttribute('role', 'tooltip');
        document.body.appendChild(helpTooltipEl);
        return helpTooltipEl;
    }

    /**
     * 创建"?"帮助图标,悬停/聚焦时显示 body 顶层浮层说明(不被面板 overflow 裁切)。
     * @param {string} text 提示文案
     * @returns {HTMLSpanElement}
     */
    function createHelp(text) {
        injectStyles();
        const help = el('span', 'egc-help', '?');
        help.tabIndex = 0;
        help.setAttribute('aria-label', (text || '') + ' 说明');
        const show = () => {
            const tip = ensureHelpTooltip();
            tip.textContent = text || '';
            tip.classList.add('visible');
            const r = help.getBoundingClientRect();
            tip.style.left = '0px';
            tip.style.top = '0px';
            const tr = tip.getBoundingClientRect();
            let left = r.left + r.width / 2 - tr.width / 2;
            left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
            let top = r.bottom + 7;
            if (top + tr.height > window.innerHeight - 8) top = r.top - tr.height - 7;
            tip.style.left = Math.round(left) + 'px';
            tip.style.top = Math.round(top) + 'px';
        };
        const hide = () => { if (helpTooltipEl) helpTooltipEl.classList.remove('visible'); };
        help.addEventListener('mouseenter', show);
        help.addEventListener('mouseleave', hide);
        help.addEventListener('focus', show);
        help.addEventListener('blur', hide);
        return help;
    }

'''
rep("    /** 版本徽标元素：放进面板标题行，直观确认当前生效的库版本 */",
    NEW_JS + "    /** 版本徽标元素：放进面板标题行，直观确认当前生效的库版本 */")

# ---------- 5. 导出新组件 ----------
rep("""        createFolderPicker,
        createTagPicker,
        versionBadge,""",
"""        createFolderPicker,
        createTagPicker,
        createCollapsiblePanel,
        createConnectionStatus,
        createModeSwitch,
        createLocalFolderRow,
        createProgress,
        createHelp,
        versionBadge,""")

io.open(path, 'w', encoding='utf-8', newline='').write(src)
print('eagle-ui.js v1.3.0 OK')
