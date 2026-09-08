# -*- coding: utf-8 -*-
"""eagle-fab-collector 迁移到 eagle-ui 家族库(v1.3.1 组件):
- 面板外壳换成库折叠面板,功能性元素 id 全部保留(业务方法零改动)
- 文件夹/标签自研弹层换成库 picker(单选+最近/分组+手输)
- 删除 31 个自研 UI 方法与全部 esp- 样式注入
注意:本文件为 CRLF 行尾,newline='' 读写保持原样。
"""
import io
import re

path = 'eagle-fab-collector.user.js'
src = io.open(path, encoding='utf-8', newline='').read()
# 处理期统一为 LF(正则与锚点均按 LF 编写),写回前显式恢复 CRLF,行尾不变
CRLF = chr(13) in src
if CRLF:
    src = src.replace(chr(13) + chr(10), chr(10))

def rep(old, new, cnt=1, must=True):
    global src
    if must:
        assert old in src, 'MISSING: ' + old[:70]
    src = src.replace(old, new, cnt)

def drop_method(name):
    """删除 UIPanel 中的方法块(连同紧邻 JSDoc 注释)。"""
    global src
    m = re.search(r'^ {8}(?:async )?' + re.escape(name) + r'\s*\(', src, re.M)
    assert m, 'method not found: ' + name
    start = m.start()
    pm = re.search(r'(\n +/\*\*(?:[^*]|\*(?!/))*\*/\s*)$', src[:start])
    if pm:
        start = pm.start(1) + 1
    rest = src[m.end():]
    nm = re.search(r'^ {8}(?:async )?_?[a-zA-Z][$\w]*\s*[:(]', rest, re.M)
    end = m.end() + nm.start() if nm else len(src)
    src = src[:start] + src[end:]

# ---------- 0. 版本 ----------
rep('// @version      1.0.4', '// @version      1.1.0')

# ---------- 1. init 整段替换(init 起 -> _createStyles 的 JSDoc 前) ----------
m = re.search(r'^        init\(siteInfo\) \{.*?(?=^        /\*\*\n         \* 注入面板样式)', src, re.M | re.S)
assert m, 'init block not found'

NEW_INIT = '''        init(siteInfo) {
            this.siteInfo = siteInfo;
            // ── 读取持久化配置(键与逻辑沿用旧版,用户数据无缝) ──
            try {
                const savedMode = GM_getValue(STORAGE_KEYS.actionMode, 'eagle');
                this.actionMode = savedMode === 'local' ? 'local' : 'eagle';
            } catch (err) {
                this.actionMode = 'eagle';
            }
            try {
                const savedTags = GM_getValue(STORAGE_KEYS.recentTags, []);
                this.recentTags = Array.isArray(savedTags) ? savedTags.filter(Boolean).slice(0, 24) : [];
                // 按站点(hostname)隔离已选标签,最近使用保持全局可复用。
                const savedTagsBySite = GM_getValue(STORAGE_KEYS.selectedTagsBySite, {});
                this.selectedTagsBySite = savedTagsBySite && typeof savedTagsBySite === 'object' && !Array.isArray(savedTagsBySite)
                    ? savedTagsBySite
                    : {};
                this.selectedTags = Array.isArray(this.selectedTagsBySite[this.getTagStorageScope()])
                    ? this.selectedTagsBySite[this.getTagStorageScope()].filter(Boolean).slice(0, 24)
                    : [];
                GM_setValue(STORAGE_KEYS.selectedTags, []);
            } catch (err) {
                this.recentTags = [];
                this.selectedTags = [];
                this.selectedTagsBySite = {};
            }
            try {
                const savedFolderIds = GM_getValue(STORAGE_KEYS.folderIds, []);
                this.selectedFolderIds = Array.isArray(savedFolderIds)
                    ? savedFolderIds.filter(Boolean).map(String).slice(0, 1)   // 单选语义:只取一个
                    : [];
            } catch (err) {
                this.selectedFolderIds = [];
            }
            try {
                const savedRecentFolders = GM_getValue(STORAGE_KEYS.recentFolders, []);
                this.recentFolders = Array.isArray(savedRecentFolders) ? savedRecentFolders.filter(Boolean).map(String).slice(0, 5) : [];
            } catch (err) {
                this.recentFolders = [];
            }

            // ── UI 外壳:家族共享库折叠面板(折叠=悬浮球,展开=完整面板) ──
            const siteName = this.siteInfo ? this.siteInfo.siteConfig.name : '未知站点';
            const pageType = this.siteInfo ? getPageTypeLabel(this.siteInfo.pageType) : '';
            const iconSvg = `
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                    <rect x="3.5" y="4" width="12" height="8.5" rx="2.4" stroke="currentColor" stroke-width="1.5"/>
                    <path d="M6.1 10l2.1-2.3 2.3 2.8 2-1.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M8 15.5h7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <path d="M18.4 6.2v10.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    <path d="M15.9 13.9l2.5 2.5 2.5-2.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `;
            this.collPanel = EagleUI.createCollapsiblePanel({
                title: 'Eagle 批量采集',
                subtitle: `${siteName} · ${pageType}`,
                icon: iconSvg,
            });
            this.container = this.collPanel.el;
            // 标题行挂家族版本徽标 + Eagle 连接状态灯
            this.collPanel.el.querySelector('.egc-coll-title').appendChild(EagleUI.versionBadge());
            this.connStatus = EagleUI.createConnectionStatus('检测中');
            this.collPanel.subRow.appendChild(this.connStatus.el);

            // ── 面板内容(功能性 id 与旧版一致,业务方法零改动) ──
            this.collPanel.body.innerHTML = `
                <div id="esp-progress" class="egc-progress-block">
                    <div id="esp-progress-text" class="egc-progress-text">准备就绪</div>
                    <div class="egc-progress-bar-outer"><div id="esp-progress-bar" class="egc-progress-bar-inner"></div></div>
                </div>
                <div id="esp-mode-card" class="egc-mode-card"><div id="esp-mode-group" class="egc-mode-grid"></div></div>
                <div id="esp-eagle-folder-section" class="egc-field egc-config-section">
                    <div class="egc-label" id="lbl-folder">Eagle 目标文件夹</div>
                    <div id="esp-folder-picker-slot"></div>
                </div>
                <div id="esp-local-folder-section" style="display:none;">
                    <div class="egc-local-row">
                        <button id="esp-local-folder-trigger" type="button" class="egc-local-trigger">默认下载文件夹</button>
                    </div>
                    <div class="egc-local-hint">点击上方按钮即可选择下载目录、系统文件夹或其他盘符；未选择时使用浏览器默认下载目录。</div>
                </div>
                <div id="esp-eagle-tags-section" class="egc-field egc-config-section">
                    <div class="egc-label" id="lbl-tags">标签</div>
                    <div id="esp-tag-picker-slot"></div>
                </div>
                <div id="esp-auto-folder-row" class="egc-switch-row egc-config-section">
                    <label class="egc-switch-label" for="esp-auto-folder">自动建目录</label>
                    <input id="esp-auto-folder" class="egc-checkbox" type="checkbox" checked />
                </div>
                <button id="esp-btn-deep-scan" type="button" class="egc-btn primary full">深度扫描全部（自动翻页+原始大图）</button>
                <button id="esp-btn-current-page" type="button" class="egc-btn secondary full">仅采集当前页面</button>
                <button id="esp-btn-generic-scan" type="button" class="egc-btn start full"><span class="egc-btn-label">开始采集</span></button>
                <div id="esp-control-row" class="egc-btn-row" style="display:none;">
                    <button id="esp-btn-pause" type="button" class="egc-btn secondary">⏸️ 暂停</button>
                    <button id="esp-btn-stop" type="button" class="egc-btn danger">停止</button>
                </div>
                <div id="esp-status" class="egc-status">等待操作...</div>
                <button id="esp-btn-copy-failure-log" type="button" class="egc-btn secondary full" style="display:none;">复制失败日志</button>
            `;

            // 问号帮助说明
            this.collPanel.body.querySelector('#lbl-folder').appendChild(EagleUI.createHelp('选择采集结果写入的 Eagle 目录；开启自动建目录时会以该目录作为父目录。'));
            this.collPanel.body.querySelector('#lbl-tags').appendChild(EagleUI.createHelp('标签仅保存到 Eagle，可多选，也可手动输入。'));
            this.collPanel.body.querySelector('.egc-switch-label').appendChild(EagleUI.createHelp('Fab 英文商品名会自动补充中文译名，并按“英文｜中文”创建目录。'));

            // ── 保存方式切换(mode 卡) ──
            this.modeSwitch = EagleUI.createModeSwitch({
                options: [
                    { value: 'eagle', label: '保存到 Eagle' },
                    { value: 'local', label: '本地下载' },
                ],
                value: this.actionMode,
                onChange: (mode) => this.setActionMode(mode),
            });
            this.collPanel.body.querySelector('#esp-mode-group').appendChild(this.modeSwitch.el);

            // ── 文件夹选择器:单选 + 搜索 + 最近(库组件) ──
            this.folderPicker = EagleUI.createFolderPicker({
                rootLabel: '默认（根目录）',
                recent: this.recentFolders,
                onRecentChange: (ids) => {
                    this.recentFolders = ids;
                    try { GM_setValue(STORAGE_KEYS.recentFolders, ids); } catch (err) { Log.warn('保存最近文件夹失败:', err.message); }
                },
                onChange: (ids) => {
                    this.selectedFolderIds = ids;
                    this.folderId = ids[0] || '';
                    try {
                        GM_setValue(STORAGE_KEYS.lastFolderId, this.folderId || '');
                        GM_setValue(STORAGE_KEYS.folderIds, ids);
                    } catch (err) { Log.warn('保存文件夹选择失败:', err.message); }
                },
            });
            if (this.selectedFolderIds.length > 0) this.folderPicker.setSelected(this.selectedFolderIds);
            this.collPanel.body.querySelector('#esp-folder-picker-slot').appendChild(this.folderPicker.el);

            // ── 标签选择器:搜索+已选+最近+分组+手输(库组件) ──
            this.tagPicker = EagleUI.createTagPicker({
                selected: this.selectedTags,
                recent: this.recentTags,
                onRefresh: () => this.refreshEagleTags(true),
                onChange: (selected) => this.setSelectedTags(selected),
                onRecentChange: (recent) => {
                    this.recentTags = recent;
                    try { GM_setValue(STORAGE_KEYS.recentTags, recent); } catch (err) { Log.warn('保存最近标签失败:', err.message); }
                },
            });
            this.collPanel.body.querySelector('#esp-tag-picker-slot').appendChild(this.tagPicker.el);

            // ── 业务按钮绑定(沿用旧逻辑,id 不变) ──
            const body = this.collPanel.body;
            body.querySelector('#esp-btn-deep-scan').addEventListener('click', () => this._startDeepScan());
            body.querySelector('#esp-btn-current-page').addEventListener('click', () => this._captureCurrentPage());
            body.querySelector('#esp-btn-generic-scan').addEventListener('click', () => this._startGenericScan());
            body.querySelector('#esp-btn-pause').addEventListener('click', () => {
                const btn = body.querySelector('#esp-btn-pause');
                if (btn.textContent.includes('暂停')) {
                    this._isPaused = true;
                    btn.textContent = '▶️ 继续';
                } else {
                    this._isPaused = false;
                    btn.textContent = '⏸️ 暂停';
                }
            });
            body.querySelector('#esp-btn-stop').addEventListener('click', () => this.stopScan());
            body.querySelector('#esp-btn-copy-failure-log').addEventListener('click', () => this.copyFailureReport());
            // 本地下载目录选择：必须由用户点击触发浏览器授权。
            body.querySelector('#esp-local-folder-trigger').addEventListener('click', async () => {
                await this.pickLocalDirectory();
            });

            document.body.appendChild(this.container);
            this.collapse();
            this.updateActionModeUI();
            Log.info('UI 面板已注入（eagle-ui 家族组件）');
        },

'''
src = src[:m.start()] + NEW_INIT + src[m.end():]

# ---------- 2. 删除自研 UI 方法 ----------
for name in [
    '_createStyles', '_buildPanel', '_bindEvents', '_bindHelpTooltips',
    'positionPickerMenu', 'positionOpenPickerMenus',
    'openFolderMenu', 'closeFolderMenu', 'toggleFolderMenu', 'renderFolderMenu',
    'toggleFolderExpanded', 'isFolderExpanded', 'expandFolderAncestors',
    'setFolderSelection', 'toggleFolderSelection', 'syncFolderTriggerLabel',
    'getSelectedFolderName', 'getFolderSelect', 'getFolderTrigger',
    'getFolderTree', 'getFolderSearchInput', 'getFolderWrap',
    'openTagMenu', 'closeTagMenu', 'toggleTagMenu',
    'renderTagMenu', 'renderEagleTagMenu', 'syncTagTriggerLabel', 'getTagWrap', 'getManualTags',
]:
    drop_method(name)
print('methods dropped')

# ---------- 3. expand/collapse/toggle 换薄封装(锚点不含 JSDoc,drop 可能已吞邻接注释) ----------
rep('''        expand() {
            this.container.classList.remove('collapsed');
            this.container.classList.add('expanded');
            this.isExpanded = true;
            this.isCollapsed = false;
        },''',
'''        /** 展开面板(库折叠面板) */
        expand() {
            if (this.collPanel) this.collPanel.expand();
            this.isExpanded = true;
            this.isCollapsed = false;
        },''')

rep('''        collapse() {
            this.closeFolderMenu();
            this.container.classList.add('collapsed');
            this.container.classList.remove('expanded');
            this.isExpanded = false;
            this.isCollapsed = true;
        },''',
'''        /** 折叠面板(先收起可能展开的选择器弹层) */
        collapse() {
            if (this.folderPicker) this.folderPicker.close();
            if (this.tagPicker) this.tagPicker.close();
            if (this.collPanel) this.collPanel.collapse();
            this.isExpanded = false;
            this.isCollapsed = true;
        },''')

# ---------- 4. setStatus 类名 ----------
rep("                el.className = 'esp-status ' + type;", "                el.className = 'egc-status ' + type;")

# ---------- 5. setButtonsEnabled:mode 按钮 ----------
rep('''            this.container.querySelectorAll('.esp-mode-btn').forEach(btn => {
                btn.disabled = !enabled;''',
'''            if (this.modeSwitch) this.modeSwitch.el.querySelectorAll('button').forEach(btn => {
                btn.disabled = !enabled;''')

# ---------- 6. setGenericButtonLabel 类名 ----------
rep("            const label = button?.querySelector('.esp-btn-label');", "            const label = button?.querySelector('.egc-btn-label');")

# ---------- 7. setEagleConnectionStatus:改用库组件 ----------
rep('''            const label = el.querySelector('.esp-connection-label');
            if (label) label.textContent = labels[normalized];''',
'''            if (this.connStatus) this.connStatus.set(normalized, labels[normalized]);''')

# ---------- 8. updateActionModeUI:mode 高亮/触发器禁用段 ----------
rep('''            // 1. 同步顶部模式按钮高亮
            this.container.querySelectorAll('.esp-mode-btn').forEach(btn => {
                const active = btn.dataset.mode === mode;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            });''',
'''            // 1. 同步顶部模式按钮高亮(库 mode 组件)
            if (this.modeSwitch) this.modeSwitch.set(mode, true);''')

rep('''            // 3. 目录触发器禁用状态单独处理，避免“仅靠 disabled 样式但仍能打开菜单”
            const folderTrigger = this.getFolderTrigger();
            const folderWrap = this.getFolderWrap();
            const localFolderTrigger = this.container.querySelector('#esp-local-folder-trigger');
            if (folderTrigger) {
                folderTrigger.disabled = mode === 'local';
            }
            if (localFolderTrigger) {
                localFolderTrigger.disabled = false;
            }
            if (mode === 'local' && folderWrap) {
                folderWrap.classList.remove('open');
            }''',
'''            // 3. 本地模式下收起文件夹选择器弹层(Eagle 配置区已整体隐藏)
            if (mode === 'local' && this.folderPicker) this.folderPicker.close();''')

# ---------- 9. refreshEagleTags:渲染改灌库 ----------
rep('''        async refreshEagleTags(force = false) {
            if (this.tagCatalogLoading) return;
            this.tagCatalogLoading = true;
            this.tagCatalogError = '';
            this.renderTagMenu();
            try {
                const catalog = await EagleAPI.getTagCatalog(force);
                this.eagleTags = Array.isArray(catalog?.tags) ? catalog.tags.filter(item => item && item.name) : [];
                this.eagleTagGroups = Array.isArray(catalog?.groups) ? catalog.groups.filter(item => item && item.id) : [];
                this.markEagleAvailable('tag-catalog');
            } catch (err) {
                // 标签是辅助配置；刷新失败时保留上次成功读取的内容，
                // 不能因为标签接口偶发失败把 Eagle 状态降级成未启动。
                this.tagCatalogError = '无法读取 Eagle 标签，请确认 Eagle 正在运行';
                Log.warn('读取 Eagle 标签失败:', err.message);
            } finally {
                this.tagCatalogLoading = false;
                this.renderTagMenu();
            }
        },''',
'''        async refreshEagleTags(force = false) {
            if (this.tagCatalogLoading) return;
            this.tagCatalogLoading = true;
            this.tagCatalogError = '';
            if (this.tagPicker) this.tagPicker.setLoading(true);
            try {
                const catalog = await EagleAPI.getTagCatalog(force);
                this.eagleTags = Array.isArray(catalog?.tags) ? catalog.tags.filter(item => item && item.name) : [];
                this.eagleTagGroups = Array.isArray(catalog?.groups) ? catalog.groups.filter(item => item && item.id) : [];
                if (this.tagPicker) {
                    this.tagPicker.setTags(this.eagleTags);
                    this.tagPicker.setGroups(this.eagleTagGroups);
                }
                this.markEagleAvailable('tag-catalog');
            } catch (err) {
                // 标签是辅助配置；刷新失败时保留上次成功读取的内容，
                // 不能因为标签接口偶发失败把 Eagle 状态降级成未启动。
                this.tagCatalogError = '无法读取 Eagle 标签，请确认 Eagle 正在运行';
                if (this.tagPicker) this.tagPicker.setError(this.tagCatalogError);
                Log.warn('读取 Eagle 标签失败:', err.message);
            } finally {
                this.tagCatalogLoading = false;
            }
        },''')

# ---------- 10. setSelectedTags:渲染改库(syncTagTriggerLabel 已删,锚点用方法体) ----------
rep('''            this.renderTagMenu();
            this.syncTagTriggerLabel();
        },''',
'''            if (this.tagPicker) this.tagPicker.setSelected(this.selectedTags, true);
        },''')

# ---------- 11. buildScanTags:手输已并入 selectedTags ----------
rep('''        buildScanTags(baseTags = []) {
            const tags = mergeTags(baseTags, this.getManualTags());
            const manualTags = parseTagsInput(document.getElementById('esp-tags-input')?.value || '');
            if (manualTags.length > 0) {
                this.recentTags = mergeTags(manualTags, this.recentTags).slice(0, 24);
                try { GM_setValue(STORAGE_KEYS.recentTags, this.recentTags); } catch (err) { Log.warn('保存最近标签失败:', err.message); }
            }
            return tags;
        },''',
'''        buildScanTags(baseTags = []) {
            // 手动输入的标签已由库标签选择器并入 selectedTags,这里只做页面标签与已选的合并。
            return mergeTags(baseTags, this.selectedTags);
        },''')

# ---------- 12. ensureAutoTargetFolder / ensureFabTargetFolder:去掉多选合并与 setFolderSelection ----------
rep('''                await this.loadFolders();
                this.setFolderSelection(manuallySelected, {
                    persist: false,
                    refreshHint: false,
                });
            }

            this.folderId = found.id;
            this.selectedFolderIds = Array.from(new Set([found.id, ...selectedFolderIds.filter(id => id !== manuallySelected)]));
            return found.id;
        },

        /**
         * 加载 Eagle 文件夹列表并填充下拉框
         */''',
'''                await this.loadFolders();
                if (this.folderPicker && manuallySelected) this.folderPicker.setSelected([manuallySelected]);
            }

            // 单选语义:自动目录只作为本轮写入目标(folderId),不改变用户手动选择。
            this.folderId = found.id;
            return found.id;
        },

        /**
         * 加载 Eagle 文件夹列表并填充选择器
         */''')

rep('''            if (!found) {
                this.setStatus(`正在创建目录：${folderName}`);
                const created = await EagleAPI.createFolder(folderName, manuallySelected);
                found = { id: created.id, name: created.name, raw: created };
                await this.loadFolders();
                this.setFolderSelection(manuallySelected, { persist: false, refreshHint: false });
            }

            this.folderId = found.id;
            this.selectedFolderIds = Array.from(new Set([found.id, ...selectedFolderIds.filter(id => id !== manuallySelected)]));
            return found.id;''',
'''            if (!found) {
                this.setStatus(`正在创建目录：${folderName}`);
                const created = await EagleAPI.createFolder(folderName, manuallySelected);
                found = { id: created.id, name: created.name, raw: created };
                await this.loadFolders();
                if (this.folderPicker && manuallySelected) this.folderPicker.setSelected([manuallySelected]);
            }

            // 单选语义:自动目录只作为本轮写入目标(folderId),不改变用户手动选择。
            this.folderId = found.id;
            return found.id;''')

# ---------- 13. getSelectedFolderIds:改走库 picker ----------
rep('''        getSelectedFolderIds() {
            const validIds = new Set(flattenFolders(this.folders).map(folder => String(folder.id)));
            return Array.from(new Set((this.selectedFolderIds || []).map(String)))
                .filter(id => validIds.size === 0 || validIds.has(id));
        },''',
'''        getSelectedFolderIds() {
            // 单选语义:库 picker 持有唯一真值;空数组即"默认(根目录)"。
            return this.folderPicker ? this.folderPicker.getSelected() : (this.selectedFolderIds || []).slice(0, 1);
        },''')

# ---------- 14. loadFolders 尾部:灌库 picker ----------
rep('''            this.folders = folderResult.folders;
            // 首次打开时展开一级目录，保持 Eagle 原始顺序；更深层级按需展开。
            this.folderExpandedIds = new Set(['', ...this.folders.filter(folder => folder && folder.id).map(folder => folder.id)]);
            const select = this.container.querySelector('#esp-folder-select');
            const flatFolders = flattenFolders(this.folders);

            // 清空并填充选项
            select.innerHTML = '<option value="">默认（根目录）</option>';
            flatFolders.forEach(folder => {
                const option = document.createElement('option');
                option.value = folder.id;
                option.textContent = `${'　'.repeat(folder.depth)}${folder.name}`;
                select.appendChild(option);
            });''',
'''            this.folders = folderResult.folders;
            // 灌入库文件夹选择器(保留 Eagle 原始层级,树内按需展开)
            if (this.folderPicker) this.folderPicker.setFolders(this.folders);''')

rep('''            const validPreferredIds = preferredFolderIds.filter(id => flatFolders.some(folder => folder.id === id));
            if (validPreferredIds.length > 0) {
                this.selectedFolderIds = validPreferredIds;
                this.folderId = validPreferredIds[0] || '';
                this.setFolderSelection(validPreferredIds[0], {
                        persist: false,
                        refreshHint: false,
                });
                this.selectedFolderIds = validPreferredIds;
                this.folderId = validPreferredIds[0] || '';
            } else {
                this.setFolderSelection('', {
                    persist: false,
                    refreshHint: false,
                });
            }

            this.renderFolderMenu();
            this.syncFolderTriggerLabel();
            this.updateActionModeUI();''',
'''            const flatFolders = flattenFolders(this.folders);
            const validPreferredIds = preferredFolderIds.filter(id => flatFolders.some(folder => folder.id === id)).slice(0, 1);
            if (this.folderPicker) this.folderPicker.setSelected(validPreferredIds);
            this.selectedFolderIds = validPreferredIds;
            this.folderId = validPreferredIds[0] || '';

            this.updateActionModeUI();''')

if CRLF:
    src = src.replace(chr(10), chr(13) + chr(10))
io.open(path, 'w', encoding='utf-8', newline='').write(src)
print('fab migration OK')
