# -*- coding: utf-8 -*-
"""X 脚本外壳升级:createLauncher+createPanel → createCollapsiblePanel(fab 范式)。CRLF 文件。"""
CRLF = chr(13) + chr(10)

p = 'eagle-x-collector.user.js'
s = open(p, encoding='utf-8', newline='').read()

# ── 块 1:替换 init 函数 + setText(从 init 起到 setText 块尾) ──
start = s.index('            init: function (ctx) {')
settext_idx = s.index('            setText: function (status, progress) {', start)
end = s.index(CRLF + '            },', settext_idx) + len(CRLF + '            },')

new_block = """
            init: function (ctx) {
                if (this.panel) return
                this.ctx = ctx
                this.selectedTags = Array.isArray(eagle_selected_tags) ? [...eagle_selected_tags] : []
                this.recentTags = Array.isArray(eagle_recent_tags) ? [...eagle_recent_tags] : []
                this.actionMode = GM_getValue('eagle_action_mode', 'eagle') || 'eagle'
                // UI 外壳:家族共享库折叠面板(悬浮球 ↔ 展开),与 fab/抖音同款范式。
                // 本脚本只保留 X 数据源(GraphQL/滚动)与批量主循环。
                const collPanel = EagleUI.createCollapsiblePanel({
                    title: lang.batch_title,
                    subtitle: 'X · 时间线',
                    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="12" height="8.5" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.1 10l2.1-2.3 2.3 2.8 2-1.7M8 15.5h7.5M18.4 6.2v10.1M15.9 13.9l2.5 2.5 2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
                })
                this.collPanel = collPanel
                this.panel = collPanel.el
                collPanel.el.querySelector('.egc-coll-title').appendChild(EagleUI.versionBadge())
                this.connStatus = EagleUI.createConnectionStatus('检测中')
                collPanel.subRow.appendChild(this.connStatus.el)

                collPanel.body.innerHTML = `
<div id="tmd-progress" class="egc-progress-block">
  <div id="tmd-progress-text" class="egc-progress-text">${lang.batch_idle}</div>
  <div class="egc-progress-bar-outer"><div id="tmd-progress-bar" class="egc-progress-bar-inner"></div></div>
</div>
<div id="tmd-mode-group"></div>
<div id="tmd-eagle-folder-section" class="egc-field egc-config-section">
  <div class="egc-label">Eagle 目标文件夹</div>
  <div id="tmd-folder-picker-slot"></div>
</div>
<div id="tmd-eagle-tags-section" class="egc-field egc-config-section">
  <div class="egc-label">标签（仅保存到 Eagle）</div>
  <div id="tmd-tag-picker-slot"></div>
</div>
<button id="tmd-btn-start" type="button" class="egc-btn start full"><span class="egc-btn-label"></span></button>
<div id="tmd-control-row" class="egc-btn-row" style="display:none;">
  <button id="tmd-btn-stop" type="button" class="egc-btn danger">${lang.stop}</button>
</div>
<div id="tmd-status" class="egc-status">${lang.batch_idle}</div>
`
                document.body.appendChild(this.panel)
                this.statusEl = collPanel.body.querySelector('#tmd-status')
                this.progressEl = collPanel.body.querySelector('#tmd-progress-text')

                // ── 保存方式切换(mode 卡,家族统一组件;local=本地下载) ──
                this.modeSwitch = EagleUI.createModeSwitch({
                    options: [
                        { value: 'eagle', label: lang.save_to_eagle },
                        { value: 'local', label: lang.batch_download },
                    ],
                    value: this.actionMode,
                    onChange: (mode) => this.setActionMode(mode),
                })
                collPanel.body.querySelector('#tmd-mode-group').appendChild(this.modeSwitch.el)
                this.updateActionModeUI()

                // 文件夹选择器:配置与旧版完全一致,仅换挂载点
                this.folderPicker = EagleUI.createFolderPicker({
                    rootLabel: () => `自动目录：${ctx.getEagleRootPathText()} / ${ctx.getEagleChildTemplateText()}`,
                    recent: (Array.isArray(GM_getValue('eagle_recent_folders', [])) ? GM_getValue('eagle_recent_folders', []) : []).map(String),
                    onRecentChange: (ids) => {
                        GM_setValue('eagle_recent_folders', ids)
                    },
                    onRefresh: () => this.refreshFolderOptions(ctx, true),
                    onChange: (ids) => {
                        eagle_selected_folder_id = String(ids[0] || '')
                        GM_setValue('eagle_selected_folder_id', eagle_selected_folder_id)
                    },
                })
                if (eagle_selected_folder_id) this.folderPicker.setSelected([eagle_selected_folder_id])
                collPanel.body.querySelector('#tmd-folder-picker-slot').appendChild(this.folderPicker.el)

                // 标签选择器:持久化键沿用 eagle_selected_tags/eagle_recent_tags
                this.tagPicker = EagleUI.createTagPicker({
                    selected: this.selectedTags,
                    recent: this.recentTags,
                    onRefresh: () => this.refreshEagleTags(true),
                    onChange: (selected) => {
                        this.selectedTags = selected
                        eagle_selected_tags = [...selected]
                        GM_setValue('eagle_selected_tags', eagle_selected_tags)
                    },
                    onRecentChange: (recent) => {
                        this.recentTags = recent
                        eagle_recent_tags = [...recent]
                        GM_setValue('eagle_recent_tags', eagle_recent_tags)
                    },
                })
                collPanel.body.querySelector('#tmd-tag-picker-slot').appendChild(this.tagPicker.el)

                collPanel.body.querySelector('#tmd-btn-start').onclick = () =>
                    this.start(ctx, this.actionMode === 'local' ? 'download' : 'eagle')
                collPanel.body.querySelector('#tmd-btn-stop').onclick = () => this.stop()
                this.refreshFolderOptions(ctx, false)
                this.refreshEagleTags(false)
                this.renderButtons()
            },

            /** 切换保存方式并持久化 */
            setActionMode: function (mode) {
                this.actionMode = mode
                GM_setValue('eagle_action_mode', mode)
                this.updateActionModeUI()
            },

            /** 本地下载模式下隐藏 Eagle 专属配置,并同步开始按钮文案与模式卡高亮 */
            updateActionModeUI: function () {
                const mode = this.actionMode
                const folderSection = this.panel && this.panel.querySelector('#tmd-eagle-folder-section')
                const tagsSection = this.panel && this.panel.querySelector('#tmd-eagle-tags-section')
                if (folderSection) folderSection.style.display = mode === 'local' ? 'none' : 'block'
                if (tagsSection) tagsSection.classList.toggle('disabled', mode === 'local')
                const label = this.panel && this.panel.querySelector('#tmd-btn-start .egc-btn-label')
                if (label) label.textContent = mode === 'local' ? lang.batch_download : lang.save_to_eagle
                if (this.modeSwitch) this.modeSwitch.set(mode, true)
            },

            setText: function (status, progress) {
                if (this.statusEl && typeof status !== 'undefined') this.statusEl.textContent = status
                if (this.progressEl && typeof progress !== 'undefined') {
                    this.progressEl.textContent = progress
                    // 进度块与 fab 同款:有进度文字才显示,结束后自动收起
                    const block = this.progressEl.closest('.egc-progress-block')
                    if (block) block.classList.toggle('visible', !!String(progress).trim())
                }
            },
""".replace(chr(10), CRLF)

s = s[:start] + new_block + s[end:]

# ── 块 2:替换 renderButtons ──
old_rb = """            renderButtons: function () {
                if (!this.panel) return
                const downloadBtn = this.panel.querySelector('[data-action="download"]')
                const eagleBtn = this.panel.querySelector('[data-action="eagle"]')
                const stopBtn = this.panel.querySelector('[data-action="stop"]')
                downloadBtn.disabled = this.running
                eagleBtn.disabled = this.running
                stopBtn.disabled = !this.running
                this.panel.classList.toggle('running', this.running)
            },""".replace(chr(10), CRLF)
new_rb = """            renderButtons: function () {
                if (!this.panel) return
                const startBtn = this.panel.querySelector('#tmd-btn-start')
                const stopBtn = this.panel.querySelector('#tmd-btn-stop')
                const controlRow = this.panel.querySelector('#tmd-control-row')
                if (startBtn) startBtn.disabled = this.running
                if (controlRow) controlRow.style.display = this.running ? 'flex' : 'none'
                if (stopBtn) stopBtn.disabled = !this.running
            },""".replace(chr(10), CRLF)
assert s.count(old_rb) == 1, 'renderButtons anchor=' + str(s.count(old_rb))
s = s.replace(old_rb, new_rb)

# ── 块 3:refreshFolderOptions 接连接灯 ──
old_rf = """            refreshFolderOptions: async function (ctx, force = false) {
                if (!this.folderPicker) return
                try {
                    const folders = await ctx.eagle.getFolders(!!force)
                    this.folderPicker.setFolders(Array.isArray(folders) ? folders : [])
                } catch (err) {
                    console.debug('[TMD][Eagle][folder-list]', err)
                }
            },""".replace(chr(10), CRLF)
new_rf = """            refreshFolderOptions: async function (ctx, force = false) {
                if (!this.folderPicker) return
                try {
                    const folders = await ctx.eagle.getFolders(!!force)
                    this.folderPicker.setFolders(Array.isArray(folders) ? folders : [])
                    if (this.connStatus) this.connStatus.set('connected')
                } catch (err) {
                    if (this.connStatus) this.connStatus.set('disconnected')
                    console.debug('[TMD][Eagle][folder-list]', err)
                }
            },""".replace(chr(10), CRLF)
assert s.count(old_rf) == 1, 'refreshFolderOptions anchor=' + str(s.count(old_rf))
s = s.replace(old_rf, new_rf)

# ── 块 4:bump 版本 ──
assert s.count('// @version            1.3.3') == 1
s = s.replace('// @version            1.3.3', '// @version            1.3.4')

open(p, 'w', encoding='utf-8', newline='').write(s)
print('X folded-panel shell upgrade done, bump 1.3.4')
