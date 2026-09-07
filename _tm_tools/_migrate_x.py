# -*- coding: utf-8 -*-
"""一次性迁移脚本:eagle-x-collector 从 tmd-batch 自研面板迁移到 eagle-ui.js 家族共享库。"""
import io
import re

path = 'eagle-x-collector.user.js'
src = io.open(path, encoding='utf-8').read()

# ---------- 1. 头部:@require 家族库 + 版本 bump ----------
old = "// @version            1.1.13"
new = "// @version            1.2.0"
assert old in src
src = src.replace(old, new, 1)

old = "// @require            https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js"
new = ("// @require            https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js\n"
       "// @require            https://cdn.jsdelivr.net/gh/baimoushare/eagle-plugin@main/eagle-ui.js")
assert old in src
src = src.replace(old, new, 1)

# ---------- 2. batch state 清理 ----------
old_state = """            panel: null,
            launcher: null,
            statusEl: null,
            progressEl: null,
            folderSelectEl: null,
            folderSearchEl: null,
            folderList: [],
            folderExpandedIds: new Set(),
            folderRecentEl: null,
            tagSearchEl: null,
            tagListEl: null,
            tagRecentEl: null,
            ctx: null,
            selectedTags: [],
            recentTags: [],
            eagleTags: [],
            eagleTagGroups: [],
            tagGroupsCollapsed: new Set(),
            tagCatalogLoading: false,
            tagCatalogError: '',
            tagSearchKeyword: '',"""
new_state = """            panel: null,
            launcher: null,
            statusEl: null,
            progressEl: null,
            folderPicker: null,
            tagPicker: null,
            ctx: null,
            selectedTags: [],
            recentTags: [],
            eagleTags: [],
            eagleTagGroups: [],
            tagCatalogLoading: false,"""
assert old_state in src, 'state anchor missing'
src = src.replace(old_state, new_state, 1)

# ---------- 3. init 整段重写(从 init: 到 setText: 之前) ----------
m = re.search(r"            init: function \(ctx\) \{.*?(?=            setText: function)", src, re.DOTALL)
assert m, 'init block not found'
new_init = """            init: function (ctx) {
                if (this.panel) return
                this.ctx = ctx
                this.selectedTags = Array.isArray(eagle_selected_tags) ? [...eagle_selected_tags] : []
                this.recentTags = Array.isArray(eagle_recent_tags) ? [...eagle_recent_tags] : []
                // UI 外壳交给家族共享库（eagle-ui.js）：样式、开合动画、两个选择器弹层统一由库维护，
                // 本脚本只保留 X 数据源（GraphQL/滚动）与批量主循环。
                const launcherHandle = EagleUI.createLauncher({
                    title: lang.batch_title,
                    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="12" height="8.5" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.1 10l2.1-2.3 2.3 2.8 2-1.7M8 15.5h7.5M18.4 6.2v10.1M15.9 13.9l2.5 2.5 2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
                })
                const launcher = launcherHandle.el
                document.body.appendChild(launcher)
                this.launcher = launcher

                const panelHandle = EagleUI.createPanel({})
                const panel = panelHandle.el
                panel.innerHTML = `
<div class="egc-title">${lang.batch_title}<span class="egc-version">UI ${EagleUI.version}</span></div>
<div class="egc-status">${lang.batch_idle}</div>
<div class="egc-progress">${lang.batch_idle}</div>
<div class="egc-field">
  <div class="egc-label">Eagle 目标文件夹</div>
  <div data-slot="folder-picker"></div>
</div>
<div class="egc-field">
  <div class="egc-label">标签（仅保存到 Eagle）</div>
  <div data-slot="tag-picker"></div>
</div>
<div class="egc-actions">
  <button type="button" class="egc-btn primary" data-action="download">${lang.batch_download}</button>
  <button type="button" class="egc-btn" data-action="eagle">${lang.save_to_eagle}</button>
  <button type="button" class="egc-btn ghost" data-action="stop">${lang.stop}</button>
</div>
`
                document.body.appendChild(panel)
                this.panel = panel
                launcher.onclick = () => {
                    const open = panelHandle.toggle()
                    launcherHandle.setOpen(open)
                    launcher.setAttribute('aria-expanded', open ? 'true' : 'false')
                }
                this.statusEl = panel.querySelector('.egc-status')
                this.progressEl = panel.querySelector('.egc-progress')

                // 文件夹选择器:fab 同款弹层(搜索+树+单选+刷新),选择写入全局变量与 GM 存储(键不变)
                this.folderPicker = EagleUI.createFolderPicker({
                    multiple: false,
                    rootLabel: () => `自动目录：${ctx.getEagleRootPathText()} / ${ctx.getEagleChildTemplateText()}`,
                    onRefresh: () => this.refreshFolderOptions(ctx, true),
                    onChange: (ids) => {
                        eagle_selected_folder_id = String(ids[0] || '')
                        GM_setValue('eagle_selected_folder_id', eagle_selected_folder_id)
                    },
                })
                if (eagle_selected_folder_id) this.folderPicker.setSelected([eagle_selected_folder_id])
                panel.querySelector('[data-slot="folder-picker"]').appendChild(this.folderPicker.el)

                // 标签选择器:搜索+已选chips+最近+分组勾选列表+手输,持久化键沿用 eagle_selected_tags/eagle_recent_tags
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
                panel.querySelector('[data-slot="tag-picker"]').appendChild(this.tagPicker.el)

                panel.querySelector('[data-action="download"]').onclick = () => this.start(ctx, 'download')
                panel.querySelector('[data-action="eagle"]').onclick = () => this.start(ctx, 'eagle')
                panel.querySelector('[data-action="stop"]').onclick = () => this.stop()
                this.refreshFolderOptions(ctx, false)
                this.refreshEagleTags(false)
                this.renderButtons()
            },

"""
src = src[:m.start()] + new_init + src[m.end():]

# ---------- 4. refreshFolderOptions..legacyRenderTagOptions 整段重写为两个数据灌入函数 ----------
m = re.search(r"            /\*\*\n             \* \?\? Eagle.*?(?=            formatProgress: function)", src, re.DOTALL)
if not m:
    m = re.search(r"            refreshFolderOptions: async function.*?(?=            formatProgress: function)", src, re.DOTALL)
assert m, 'folder/tag block not found'
new_block = """            /**
             * 拉取 Eagle 文件夹树灌入共享库选择器（保留层级；失败时保留上次的树）。
             */
            refreshFolderOptions: async function (ctx, force = false) {
                if (!this.folderPicker) return
                try {
                    const folders = await ctx.eagle.getFolders(!!force)
                    this.folderPicker.setFolders(Array.isArray(folders) ? folders : [])
                } catch (err) {
                    console.debug('[TMD][Eagle][folder-list]', err)
                }
            },

            /**
             * 拉取 Eagle 标签目录（含分组）灌入共享库选择器。
             */
            refreshEagleTags: async function (force = false) {
                if (this.tagCatalogLoading) return
                this.tagCatalogLoading = true
                if (this.tagPicker) this.tagPicker.setLoading(true)
                try {
                    const catalog = await (this.ctx?.eagle || TMD.eagle).getTagCatalog(force)
                    this.eagleTags = Array.isArray(catalog?.tags) ? catalog.tags.filter(item => item && item.name) : []
                    this.eagleTagGroups = Array.isArray(catalog?.groups) ? catalog.groups.filter(item => item && item.id) : []
                    this.tagPicker.setTags(this.eagleTags)
                    this.tagPicker.setGroups(this.eagleTagGroups)
                } catch (err) {
                    this.eagleTags = []
                    this.eagleTagGroups = []
                    this.tagPicker.setError('无法读取 Eagle 标签，请确认 Eagle 正在运行')
                    console.debug('[TMD][Eagle][tag-list]', err)
                } finally {
                    this.tagCatalogLoading = false
                }
            },

"""
src = src[:m.start()] + new_block + src[m.end():]

# ---------- 5. start() 中 folderSelectEl 引用改为 picker ----------
count = src.count('eagle_selected_folder_id = String(this.folderSelectEl.value')
if count:
    src = src.replace('eagle_selected_folder_id = String(this.folderSelectEl.value || \'\') || eagle_selected_folder_id',
                      'eagle_selected_folder_id = String((this.folderPicker && this.folderPicker.getSelected()[0]) || \'\')')
    src = src.replace("eagle_selected_folder_id = String(this.folderSelectEl.value || '')",
                      "eagle_selected_folder_id = String((this.folderPicker && this.folderPicker.getSelected()[0]) || '')")

# ---------- 6. CSS:删除 tmd-batch-* 相关行(保留 tmd-notifier / tmd-down 等) ----------
lines = src.split('\n')
kept = [ln for ln in lines if not re.search(r'tmd-batch', ln)]
src = '\n'.join(kept)

io.open(path, 'w', encoding='utf-8', newline='').write(src)
print('X migration OK')
