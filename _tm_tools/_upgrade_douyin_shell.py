# -*- coding: utf-8 -*-
"""抖音脚本外壳升级:createLauncher+createPanel → createCollapsiblePanel(fab 范式)。LF 文件。"""
p = 'eagle-douyin-collector.user.js'
s = open(p, encoding='utf-8', newline='').read()

# ── 块 1:替换整个 init 函数(起:init 声明;止:init 尾部的 setTimeout 预拉段后的 },) ──
start = s.index('            init: function () {')
tail_anchor = """                // 初始化 1.2s 后也预拉一次，用户第一次展开就能看到可选项
                setTimeout(() => {
                    this.refreshFolderOptions()
                    this.loadTagCatalog()
                }, 1200)
            },"""
end = s.index(tail_anchor, start) + len(tail_anchor)

new_init = """
            init: function () {
                if (this.panel) return
                this.recentTags = Array.isArray(GM_getValue('edd_recent_tags', [])) ? GM_getValue('edd_recent_tags', []) : []
                this.actionMode = GM_getValue('edd_action_mode', 'eagle') || 'eagle'
                // UI 外壳:家族共享库折叠面板(悬浮球 ↔ 展开),与 fab/X 同款范式。
                const collPanel = EagleUI.createCollapsiblePanel({
                    title: '抖音采集',
                    subtitle: '抖音 · 作者页',
                    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="12" height="8.5" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.1 10l2.1-2.3 2.3 2.8 2-1.7M8 15.5h7.5M18.4 6.2v10.1M15.9 13.9l2.5 2.5 2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
                })
                this.collPanel = collPanel
                this.panel = collPanel.el
                collPanel.el.querySelector('.egc-coll-title').appendChild(EagleUI.versionBadge())
                this.connStatus = EagleUI.createConnectionStatus('检测中')
                collPanel.subRow.appendChild(this.connStatus.el)

                collPanel.body.innerHTML = `
<div id="edd-progress" class="egc-progress-block">
  <div id="edd-progress-text" class="egc-progress-text">待命</div>
  <div class="egc-progress-bar-outer"><div id="edd-progress-bar" class="egc-progress-bar-inner"></div></div>
</div>
<div id="edd-mode-group"></div>
<div id="edd-eagle-folder-section" class="egc-field egc-config-section">
  <div class="egc-label">Eagle 目标文件夹</div>
  <div id="edd-folder-picker-slot"></div>
</div>
<div id="edd-local-folder-section" style="display:none;">
  <div class="egc-local-row">
    <button id="edd-local-folder-trigger" type="button" class="egc-local-trigger">默认下载文件夹</button>
  </div>
  <div class="egc-local-hint">点击上方按钮即可选择下载目录；未选择时开始采集后再选。</div>
</div>
<div id="edd-eagle-tags-section" class="egc-field egc-config-section">
  <div class="egc-label">标签（仅保存到 Eagle）</div>
  <div id="edd-tag-picker-slot"></div>
</div>
<div id="edd-limit-row" class="egc-switch-row egc-config-section">
  <label class="egc-switch-label" for="edd-limit-input">数量上限（0 = 全部）</label>
  <input id="edd-limit-input" class="egc-checkbox" data-action="limit-input" type="number" min="0" step="1" value="0" />
</div>
<button id="edd-btn-current" type="button" class="egc-btn secondary full">存当前作品到Eagle</button>
<button id="edd-btn-start" type="button" class="egc-btn start full"><span class="egc-btn-label">开始采集</span></button>
<div id="edd-control-row" class="egc-btn-row" style="display:none;">
  <button id="edd-btn-stop" type="button" class="egc-btn danger">停止</button>
</div>
<div id="edd-status" class="egc-status">待命</div>
`
                document.body.appendChild(this.panel)
                this.statusEl = collPanel.body.querySelector('#edd-status')
                this.progressEl = collPanel.body.querySelector('#edd-progress-text')
                this.folderLimitEl = collPanel.body.querySelector('[data-action="limit-input"]')

                // ── 保存方式切换(mode 卡,家族统一组件;local=本地下载) ──
                this.modeSwitch = EagleUI.createModeSwitch({
                    options: [
                        { value: 'eagle', label: '存入 Eagle' },
                        { value: 'local', label: '本地下载' },
                    ],
                    value: this.actionMode,
                    onChange: (mode) => this.setActionMode(mode),
                })
                collPanel.body.querySelector('#edd-mode-group').appendChild(this.modeSwitch.el)
                this.updateActionModeUI()

                // 本地下载目录行:复用 TDD.localDownload 的目录授权,start('download') 会优先复用已选目录
                this.localFolderRow = EagleUI.createLocalFolderRow({
                    label: '默认下载文件夹',
                    hint: '点击选择下载目录；未选择时开始采集后再选。',
                    onPick: async () => {
                        try {
                            const handle = await TDD.localDownload.ensureDirectory(true)
                            if (handle && this.localFolderRow) this.localFolderRow.setLabel(handle.name || '已选择目录')
                        } catch (err) { /* 用户取消选择目录,静默保持原状 */ }
                    },
                })
                const localRowWrap = collPanel.body.querySelector('#edd-local-folder-section')
                if (localRowWrap) localRowWrap.innerHTML = ''
                if (localRowWrap && this.localFolderRow) localRowWrap.appendChild(this.localFolderRow.el)

                // 文件夹选择器:配置与旧版一致(fab 同款弹层,搜索+目录树+单选)
                this.folderPicker = EagleUI.createFolderPicker({
                    rootLabel: '自动目录（抖音/作者）',
                    recent: (Array.isArray(GM_getValue('edd_recent_folders', [])) ? GM_getValue('edd_recent_folders', []) : []).map(String),
                    onRecentChange: (ids) => {
                        GM_setValue('edd_recent_folders', ids)
                    },
                    onChange: (ids) => {
                        GM_setValue('edd_selected_folder_id', String(ids[0] || ''))
                    },
                })
                collPanel.body.querySelector('#edd-folder-picker-slot').appendChild(this.folderPicker.el)

                // 标签选择器:recentTags 持久化在 edd_recent_tags
                this.tagPicker = EagleUI.createTagPicker({
                    recent: this.recentTags,
                    onChange: (selected) => {
                        this.selectedTags = selected
                    },
                    onRecentChange: (recent) => {
                        this.recentTags = recent
                        GM_setValue('edd_recent_tags', recent)
                    },
                })
                collPanel.body.querySelector('#edd-tag-picker-slot').appendChild(this.tagPicker.el)

                collPanel.body.querySelector('#edd-btn-start').onclick = () =>
                    this.start(this.actionMode === 'local' ? 'download' : 'eagle')
                collPanel.body.querySelector('#edd-btn-current').onclick = () => this.collectCurrent()
                collPanel.body.querySelector('#edd-btn-stop').onclick = () => this.stop()
                this.restoreFolderSelection()

                // 初始化 1.2s 后也预拉一次，用户第一次展开就能看到可选项
                setTimeout(() => {
                    this.refreshFolderOptions()
                    this.loadTagCatalog()
                }, 1200)
            },

            /** 切换保存方式并持久化 */
            setActionMode: function (mode) {
                this.actionMode = mode
                GM_setValue('edd_action_mode', mode)
                this.updateActionModeUI()
            },

            /** 本地下载模式下切换目录行与 Eagle 专属配置的显隐 */
            updateActionModeUI: function () {
                const mode = this.actionMode
                const folderSection = this.panel && this.panel.querySelector('#edd-eagle-folder-section')
                const localSection = this.panel && this.panel.querySelector('#edd-local-folder-section')
                const tagsSection = this.panel && this.panel.querySelector('#edd-eagle-tags-section')
                if (folderSection) folderSection.style.display = mode === 'local' ? 'none' : 'block'
                if (localSection) localSection.style.display = mode === 'local' ? 'block' : 'none'
                if (tagsSection) tagsSection.classList.toggle('disabled', mode === 'local')
                if (this.modeSwitch) this.modeSwitch.set(mode, true)
            },
"""

s = s[:start] + new_init + s[end:]

# ── 块 2:setText 接进度块显隐 ──
old_st = """            setText: function (status, progress) {
                if (this.statusEl && typeof status !== 'undefined') this.statusEl.textContent = status
                if (this.progressEl && typeof progress !== 'undefined') this.progressEl.textContent = progress
            },"""
new_st = """            setText: function (status, progress) {
                if (this.statusEl && typeof status !== 'undefined') this.statusEl.textContent = status
                if (this.progressEl && typeof progress !== 'undefined') {
                    this.progressEl.textContent = progress
                    // 进度块与 fab 同款:有进度文字才显示,结束后自动收起
                    const block = this.progressEl.closest('.egc-progress-block')
                    if (block) block.classList.toggle('visible', !!String(progress).trim())
                }
            },"""
assert s.count(old_st) == 1, 'setText anchor=' + str(s.count(old_st))
s = s.replace(old_st, new_st)

# ── 块 3:refreshFolderOptions 接连接灯 ──
old_rf = """            refreshFolderOptions: async function () {
                if (!this.folderPicker) return
                try {
                    const folders = await TDD.eagle.getFolders()
                    this.folderPicker.setFolders(Array.isArray(folders) ? folders : [])
                } catch (err) {
                    Log.warn('[refresh-folders]', err)
                }
            },"""
new_rf = """            refreshFolderOptions: async function () {
                if (!this.folderPicker) return
                try {
                    const folders = await TDD.eagle.getFolders()
                    this.folderPicker.setFolders(Array.isArray(folders) ? folders : [])
                    if (this.connStatus) this.connStatus.set('connected')
                } catch (err) {
                    if (this.connStatus) this.connStatus.set('disconnected')
                    Log.warn('[refresh-folders]', err)
                }
            },"""
assert s.count(old_rf) == 1, 'refreshFolderOptions anchor=' + str(s.count(old_rf))
s = s.replace(old_rf, new_rf)

# ── 块 4:renderButtons 适配新按钮结构 ──
old_rb = """            renderButtons: function () {
                if (!this.panel) return
                for (const action of ['eagle', 'download', 'current']) {
                    const btn = this.panel.querySelector(`[data-action="${action}"]`)
                    if (btn) btn.disabled = this.running
                }
            },"""
new_rb = """            renderButtons: function () {
                if (!this.panel) return
                const startBtn = this.panel.querySelector('#edd-btn-start')
                const currentBtn = this.panel.querySelector('#edd-btn-current')
                const stopBtn = this.panel.querySelector('#edd-btn-stop')
                const controlRow = this.panel.querySelector('#edd-control-row')
                if (startBtn) startBtn.disabled = this.running
                if (currentBtn) currentBtn.disabled = this.running
                if (controlRow) controlRow.style.display = this.running ? 'flex' : 'none'
                if (stopBtn) stopBtn.disabled = !this.running
            },"""
assert s.count(old_rb) == 1, 'renderButtons anchor=' + str(s.count(old_rb))
s = s.replace(old_rb, new_rb)

# ── 块 5:bump 版本 ──
assert s.count('// @version      0.5.3') == 1
s = s.replace('// @version      0.5.3', '// @version      0.5.4')

open(p, 'w', encoding='utf-8', newline='').write(s)
print('douyin folded-panel shell upgrade done, bump 0.5.4')
