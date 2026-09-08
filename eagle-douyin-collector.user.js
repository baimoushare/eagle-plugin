// ==UserScript==
// @name         抖音视频图集批量保存到Eagle
// @namespace    eagle-douyin-collector
// @version      0.5.4
// @modified      2026-09-08
// @description  在抖音网页版批量采集作者作品/喜欢列表的视频与图集，可保存到 Eagle 或本地下载，自动建目录、打标签、三层去重
// @author       laobai
// @license      Copyright (c) 2026 laobai. All rights reserved.
// @supportURL   mailto:www.774466655@qq.com
// @match        *://www.douyin.com/*
// @match        *://douyin.com/*
// @require      https://update.greasyfork.org/scripts/594761/Eagle%20Collector%20UI.js
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * 实现说明（与 eagle-x-collector 同架构）：
 *
 * 数据源：不调用抖音列表 API（规避 favorite 接口风控与 a_bogus 签名问题），
 * 而是从作者主页已渲染的 DOM 卡片沿 React Fiber 读取 awemeInfo 数据对象
 * （该路线已在参考实现「抖音网页版增强下载工具」中被验证可行），
 * 配合自动滚动逐步加载全部作品。
 *
 * 三层去重：
 * 1. 本地索引（GM_setValue，键独立于 X 版脚本，卸载脚本即清空）；
 * 2. Eagle API 按 website URL 精确查重（dedupeTag / annotation 命中）；
 * 3. URL 变体候选（video/note 双路径）。
 *
 * Eagle 写入：POST /api/v2/item/add（Eagle 自行拉取媒体直链）。
 * 抖音 CDN 直链存在 Referer 校验风险，Eagle 拉取失败的任务会自动降级为
 * 本地下载（File System Access API 已授权目录时）并计入提示。
 */

(function() {
    'use strict';

    const LOG_PREFIX = '[EDD]'; // Eagle Douyin Downloader

    const Log = {
        info: (...args) => console.log(LOG_PREFIX, ...args),
        warn: (...args) => console.warn(LOG_PREFIX, ...args),
        error: (...args) => console.error(LOG_PREFIX, ...args),
        debug: (...args) => console.debug(LOG_PREFIX, ...args),
    };

    Log.info('脚本已加载:', window.location.href);

    // ╔══════════════════════════════════════════════════════════════╗
    // ║              1. 通用工具层（平台无关）                        ║
    // ╚══════════════════════════════════════════════════════════════╝

    const TDD = {
        /**
         * 统一的异步等待工具。
         * 批量模式下需要在“扫描页面 / 下载资源 / 自动滚动”之间加入节奏控制。
         */
        sleep: function (ms) {
            return new Promise(resolve => setTimeout(resolve, ms))
        },

        getCookie: function (name) {
            const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'))
            return match ? decodeURIComponent(match[1]) : ''
        },

        /**
         * 抖音接口时间戳（毫秒数字）→ 本地日期字符串。
         * 用于文件名与 annotation，保持与 Eagle 素材排序可读。
         */
        formatDate: function (ms) {
            const d = new Date(Number(ms) || Date.now())
            if (Number.isNaN(d.getTime())) return ''
            const pad = n => String(n).padStart(2, '0')
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        },

        /**
         * 供文件名清洗共用的非法字符映射表（Windows 文件名约束）。
         */
        invalidChars: function () {
            return { '\\': '＼', '\/': '／', '\|': '｜', '<': '＜', '>': '＞', ':': '：', '*': '＊', '?': '？', '"': '＂', '\u200b': '', '\u200c': '', '\u200d': '', '\u2060': '', '\ufeff': '', '\n': ' ', '\r': '', '\t': ' ' }
        },

        sanitizeFileName: function (raw, maxLength = 80) {
            const map = this.invalidChars()
            let text = Array.from(String(raw || ''))
                .map(ch => (ch in map ? map[ch] : ch))
                .join('')
                .replace(/\s+/g, ' ')
                .trim()
            if (text.length > maxLength) text = text.slice(0, maxLength).trim()
            return text
        },

        isFirefox: function () {
            return navigator.userAgent.toLowerCase().includes('firefox')
        },

        // ╔════════════════════════════════════════════════════════════╗
        // ║          2. 本地下载层（File System Access + 浏览器兜底）  ║
        // ╚════════════════════════════════════════════════════════════╝

        /**
         * File System Access API 直写本地目录：
         * - 批量本地下载的主路径（一次授权，逐文件落盘）；
         * - Eagle 拉取抖音 CDN 失败时的自动降级目标。
         */
        localDownload: {
            dirHandle: null,
            isSupported: function () {
                return typeof window.showDirectoryPicker === 'function'
            },
            ensurePermission: async function (dirHandle) {
                if (!dirHandle) return false
                if (typeof dirHandle.queryPermission === 'function') {
                    let state = await dirHandle.queryPermission({ mode: 'readwrite' })
                    if (state === 'granted') return true
                }
                if (typeof dirHandle.requestPermission === 'function') {
                    let state = await dirHandle.requestPermission({ mode: 'readwrite' })
                    return state === 'granted'
                }
                return true
            },
            ensureDirectory: async function (forcePick) {
                if (!this.isSupported()) return null
                if (this.dirHandle && !forcePick) {
                    const ok = await this.ensurePermission(this.dirHandle)
                    if (ok) return this.dirHandle
                }
                try {
                    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
                    const ok = await this.ensurePermission(handle)
                    if (!ok) throw new Error('FOLDER_PICK_CANCELLED')
                    this.dirHandle = handle
                    return handle
                } catch (err) {
                    if (err && (err.name === 'AbortError' || String(err.message || err).includes('aborted'))) {
                        throw new Error('FOLDER_PICK_CANCELLED')
                    }
                    throw err
                }
            },
            /**
             * 经 GM_xmlhttpRequest 取 Blob 再写盘：
             * 抖音 CDN 对页面 fetch 有 CORS/Referer 约束，扩展后台通道更稳。
             */
            saveTask: async function (task, dirHandle) {
                const handle = dirHandle || await this.ensureDirectory(false)
                if (!handle) throw new Error('FOLDER_PICK_CANCELLED')

                const blob = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: task.url,
                        responseType: 'blob',
                        timeout: 300000,
                        onload: (response) => {
                            if (!(response.status >= 200 && response.status < 300)) {
                                reject(new Error(`HTTP ${response.status}`))
                                return
                            }
                            let outBlob = response.response
                            if (!(outBlob instanceof Blob)) {
                                outBlob = new Blob([response.response])
                            }
                            resolve(outBlob)
                        },
                        onerror: () => reject(new Error('GM_xmlhttpRequest failed')),
                        ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout')),
                    })
                })

                const fileHandle = await handle.getFileHandle(task.name, { create: true })
                const writable = await fileHandle.createWritable()
                try {
                    await writable.write(blob)
                    await writable.close()
                } catch (err) {
                    try { await writable.abort() } catch (abortErr) {}
                    throw err
                }
            },
        },

        /**
         * 单文件浏览器下载兜底（无 FS Access 时逐个落下载栏）。
         * 与 eagle-x 相同的策略：GM 取 blob → dataURL → GM_download，
         * 规避部分 Tampermonkey + Edge 组合下 GM_download 直链假“完成”的问题。
         */
        downloadViaBrowser: function (task) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: task.url,
                    responseType: 'blob',
                    timeout: 300000,
                    onload: (response) => {
                        if (!(response.status >= 200 && response.status < 300)) {
                            reject(new Error(`HTTP ${response.status}`))
                            return
                        }
                        let blob = response.response
                        if (!(blob instanceof Blob)) {
                            blob = new Blob([response.response])
                        }
                        if (this.isFirefox() && typeof GM_download === 'function') {
                            GM_download({
                                url: task.url,
                                name: task.name,
                                onload: () => resolve(),
                                onerror: (err) => reject(new Error(err?.details?.current || 'GM_download failed')),
                            })
                            return
                        }
                        const reader = new FileReader()
                        reader.onload = () => {
                            GM_download({
                                url: reader.result,
                                name: task.name,
                                saveAs: false,
                                onload: () => resolve(),
                                onerror: (err) => reject(new Error(err?.details?.current || 'GM_download failed')),
                            })
                        }
                        reader.onerror = () => reject(new Error('FileReader failed'))
                        reader.readAsDataURL(blob)
                    },
                    onerror: () => reject(new Error('GM_xmlhttpRequest failed')),
                    ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout')),
                })
            })
        },

        // ╔════════════════════════════════════════════════════════════╗
        // ║          3. Eagle API 层 + 三层去重（与 X 版同构）          ║
        // ╚════════════════════════════════════════════════════════════╝

        eagle: {
            baseURL: 'http://127.0.0.1:41595',
            folderTreeCache: null,
            folderIndexCache: null,
            tagCatalogCache: null,
            pendingFolderResolvers: {},
            // 本地去重索引键与 X 版分开，两个脚本互不干扰、互不清空对方数据。
            importIndexKey: 'eagle_import_index_douyin_v1',
            importIndexCache: null,
            eagleItemLookupCache: new Map(),

            request: function (path, method, data) {
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: method || 'GET',
                        url: this.baseURL + path,
                        headers: { 'Content-Type': 'application/json' },
                        data: data ? JSON.stringify(data) : undefined,
                        timeout: 8000,
                        onload: (response) => {
                            try {
                                const parsed = JSON.parse(response.responseText || '{}')
                                if (!(response.status >= 200 && response.status < 300)) {
                                    reject(new Error(`Eagle HTTP ${response.status}`))
                                    return
                                }
                                if (parsed.status && parsed.status !== 'success') {
                                    reject(new Error(parsed.message || parsed.code || 'Eagle API error'))
                                    return
                                }
                                resolve(parsed)
                            } catch (err) {
                                reject(err)
                            }
                        },
                        onerror: () => reject(new Error('Eagle API request failed')),
                        ontimeout: () => reject(new Error('Eagle API request timeout')),
                    })
                })
            },

            checkAlive: async function () {
                try {
                    const result = await this.request('/api/v2/app/info', 'GET')
                    return !!result?.data
                } catch (err) {
                    const fallback = await this.request('/api/application/info', 'GET')
                    return !!fallback?.data
                }
            },

            /**
             * 归一化用于本地索引匹配的 URL。
             * 抖音页面 URL（website）形如 https://www.douyin.com/video/{id}，
             * 无签名参数，去掉 query/hash 后即可稳定匹配。
             */
            normalizeImportUrl: function (url) {
                return String(url || '')
                    .trim()
                    .replace(/[?#].*$/, '')
            },

            /**
             * Eagle 的 item/get?url= 匹配素材记录中的来源页面 URL。
             * 抖音作品存在 /video/{id} 与 /note/{id} 两种规范路径，
             * 加上分享短链格式，按 awemeId 主动补齐变体以便互查。
             */
            buildEagleLookupUrlCandidates: function (task) {
                const rawUrl = String(task?.website || '').trim()
                const normalizedUrl = this.normalizeImportUrl(rawUrl)
                const candidates = [rawUrl, normalizedUrl]
                const awemeId = String(task?.statusId || '').trim()
                if (awemeId) {
                    candidates.push(`https://www.douyin.com/video/${awemeId}`)
                    candidates.push(`https://www.douyin.com/note/${awemeId}`)
                    candidates.push(`https://www.douyin.com/user/self?modal_id=${awemeId}`)
                    candidates.push(`https://www.iesdouyin.com/share/video/${awemeId}`)
                }
                return Array.from(new Set(candidates.filter(Boolean)))
            },

            /**
             * 稳定去重标签，随素材写入 Eagle 的 tags 与 annotation。
             * 即使本地索引丢失（卸载重装脚本），Eagle 侧仍能据此识别已导入。
             */
            buildEagleDedupeTag: function (task) {
                const awemeId = String(task?.statusId || '').trim()
                const mediaId = String(task?.mediaId || '').trim()
                const mediaIndex = String(task?.mediaIndex ?? '').trim()
                const fileType = String(task?.fileType || '').trim()
                const tagKey = [awemeId, mediaId || mediaIndex, fileType].filter(Boolean).join(':')
                return tagKey ? `tdd:${tagKey}` : ''
            },

            buildImportKeys: function (task) {
                const keys = []
                const fingerprint = String(task?.mediaFingerprint || '').trim()
                const dedupeTag = String(task?.dedupeTag || '').trim()
                const statusId = String(task?.statusId || '').trim()
                const normalizedUrl = this.normalizeImportUrl(task?.url || task?.website || '')
                if (dedupeTag) keys.push(`v3::${dedupeTag}`)
                if (fingerprint) keys.push(`v2::${fingerprint}`)
                if (statusId || normalizedUrl) keys.push(`v2::${statusId}::${normalizedUrl}`)
                return Array.from(new Set(keys.filter(Boolean)))
            },

            existsInEagleByUrl: async function (task) {
                const candidates = this.buildEagleLookupUrlCandidates(task)
                if (candidates.length === 0) return false
                const dedupeTag = String(task?.dedupeTag || '').trim()

                for (const candidate of candidates) {
                    try {
                        const cacheKey = this.normalizeImportUrl(candidate) || candidate
                        let items = this.eagleItemLookupCache.get(cacheKey)
                        if (!Array.isArray(items)) {
                            const response = await this.request(`/api/v2/item/get?url=${encodeURIComponent(candidate)}&limit=100`, 'GET')
                            items = Array.isArray(response?.data?.data) ? response.data.data : []
                            this.eagleItemLookupCache.set(cacheKey, items)
                        }
                        if (items.length > 0) {
                            const matched = items.some(item => {
                                const itemTags = Array.isArray(item?.tags) ? item.tags : []
                                const itemName = String(item?.name || '').trim()
                                if (dedupeTag && itemTags.includes(dedupeTag)) return true
                                if (dedupeTag && String(item?.annotation || '').includes(dedupeTag)) return true
                                if (String(task?.name || '').trim() && itemName === String(task?.name || '').trim()) return true
                                return false
                            })
                            if (matched) return true
                        }
                    } catch (err) {
                        // 二次校验失败不中断导入，退回本地索引策略
                        Log.debug('[dedupe-check]', candidate, err)
                    }
                }
                return false
            },

            getImportIndex: async function () {
                if (this.importIndexCache && typeof this.importIndexCache === 'object') {
                    return this.importIndexCache
                }
                const stored = await GM_getValue(this.importIndexKey, {})
                this.importIndexCache = stored && typeof stored === 'object' ? stored : {}
                return this.importIndexCache
            },

            saveImportIndex: async function (index) {
                const entries = Object.entries(index || {})
                    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
                    .slice(0, 12000)
                const next = Object.fromEntries(entries)
                this.importIndexCache = next
                await GM_setValue(this.importIndexKey, next)
                return next
            },

            hasImportedTask: async function (task) {
                const keys = this.buildImportKeys(task)
                if (!Array.isArray(keys) || keys.length === 0) {
                    return await this.existsInEagleByUrl(task)
                }
                const index = await this.getImportIndex()
                if (keys.some(key => !!index[key])) {
                    Log.debug('[dedupe-hit][local-index]', keys)
                    return true
                }
                if (await this.existsInEagleByUrl(task)) {
                    await this.markTaskImported(task)
                    return true
                }
                return false
            },

            /**
             * 解析失败后按作品 ID 再做一次 Eagle 侧确认，
             * 覆盖“历史已保存但本次页面数据不完整”的情况。
             */
            hasImportedStatus: async function (awemeId) {
                const id = String(awemeId || '').trim()
                if (!id) return false
                const index = await this.getImportIndex()
                const localHit = Object.keys(index || {}).some(key => {
                    return key.startsWith('v2::' + id + '::') || key.startsWith('v3::tdd:' + id + ':')
                })
                if (localHit) return true

                const candidates = [
                    `https://www.douyin.com/video/${id}`,
                    `https://www.douyin.com/note/${id}`,
                    `https://www.douyin.com/user/self?modal_id=${id}`,
                ]
                for (const candidate of candidates) {
                    try {
                        const cacheKey = this.normalizeImportUrl(candidate) || candidate
                        let items = this.eagleItemLookupCache.get(cacheKey)
                        if (!Array.isArray(items)) {
                            const response = await this.request('/api/v2/item/get?url=' + encodeURIComponent(candidate) + '&limit=100', 'GET')
                            items = Array.isArray(response?.data?.data) ? response.data.data : []
                            this.eagleItemLookupCache.set(cacheKey, items)
                        }
                        if (items.length > 0) return true
                    } catch (err) {
                        Log.debug('[status-dedupe-check]', candidate, err)
                    }
                }
                return false
            },

            markTaskImported: async function (task) {
                const keys = this.buildImportKeys(task)
                if (!Array.isArray(keys) || keys.length === 0) return
                const index = await this.getImportIndex()
                for (const key of keys) {
                    index[key] = Date.now()
                }
                await this.saveImportIndex(index)
            },

            clearFolderCache: function () {
                this.folderTreeCache = null
                this.folderIndexCache = null
            },
            buildFolderKey: function (parentId, name) {
                return `${parentId || 'root'}::${String(name || '').trim().toLowerCase()}`
            },
            sanitizeFolderName: function (name) {
                return String(name || '')
                    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 80)
            },
            extractFolderPage: function (response) {
                const page = response?.data?.data
                if (Array.isArray(page)) return page
                if (Array.isArray(response?.data)) return response.data
                return []
            },
            indexFolderTree: function (nodes, parentId = '') {
                if (!this.folderIndexCache) this.folderIndexCache = new Map()
                if (!Array.isArray(nodes)) return
                for (const node of nodes) {
                    if (!node || !node.id) continue
                    const safeName = this.sanitizeFolderName(node.name)
                    if (safeName) {
                        const key = this.buildFolderKey(parentId || node.parent || '', safeName)
                        this.folderIndexCache.set(key, node)
                    }
                    this.indexFolderTree(node.children, node.id)
                }
            },
            getFolders: async function (force = false) {
                if (!force && Array.isArray(this.folderTreeCache)) {
                    return this.folderTreeCache
                }
                const all = []
                const limit = 200
                let offset = 0
                let total = 0
                do {
                    const response = await this.request(`/api/v2/folder/get?offset=${offset}&limit=${limit}`, 'GET')
                    const page = this.extractFolderPage(response)
                    total = Number(response?.data?.total || page.length || 0)
                    all.push(...page)
                    offset += limit
                    if (page.length === 0) break
                } while (offset < total)
                this.folderTreeCache = all
                this.folderIndexCache = new Map()
                this.indexFolderTree(all)
                return all
            },
            /**
             * 拉取 Eagle 标签目录（含分组）。
             * v2 标签接口在旧版 Eagle 上可能 404，回退旧接口；
             * 不能因标签不可读误报 Eagle 未运行。
             */
            getTagCatalog: async function (force = false) {
                if (!force && this.tagCatalogCache) return this.tagCatalogCache
                let normalizedTagsResponse = null
                try {
                    const allTags = []
                    let offset = 0
                    let total = Infinity
                    do {
                        const tagsResponse = await this.request('/api/v2/tag/get?offset=' + offset + '&limit=50', 'GET')
                        const page = Array.isArray(tagsResponse?.data?.data)
                            ? tagsResponse.data.data
                            : (Array.isArray(tagsResponse?.data) ? tagsResponse.data : [])
                        allTags.push(...page)
                        total = Number(tagsResponse?.data?.total || allTags.length)
                        offset += page.length
                        if (page.length === 0) break
                    } while (offset < total)
                    if (allTags.length > 0) normalizedTagsResponse = { data: allTags }
                } catch (err) {
                    Log.debug('[tag-v2-fallback]', err)
                }
                if (!normalizedTagsResponse) {
                    normalizedTagsResponse = await this.request('/api/tag/list', 'GET')
                }
                let groupsResponse = null
                try {
                    groupsResponse = await this.request('/api/v2/tagGroup/get?offset=0&limit=500', 'GET')
                } catch (err) {
                    Log.debug('[tag-group-list]', err)
                }
                const tags = Array.isArray(normalizedTagsResponse?.data?.data)
                    ? normalizedTagsResponse.data.data
                    : (Array.isArray(normalizedTagsResponse?.data) ? normalizedTagsResponse.data : [])
                const groups = Array.isArray(groupsResponse?.data?.data)
                    ? groupsResponse.data.data
                    : (Array.isArray(groupsResponse?.data) ? groupsResponse.data : [])
                this.tagCatalogCache = { tags, groups }
                return this.tagCatalogCache
            },
            ensureFolder: async function (name, parentId = '') {
                const safeName = this.sanitizeFolderName(name)
                if (!safeName) return ''
                await this.getFolders()
                const key = this.buildFolderKey(parentId, safeName)
                const cached = this.folderIndexCache && this.folderIndexCache.get(key)
                if (cached?.id) return cached.id
                if (this.pendingFolderResolvers[key]) {
                    return await this.pendingFolderResolvers[key]
                }
                this.pendingFolderResolvers[key] = (async () => {
                    Log.info('create folder:', { parentId, name: safeName })
                    const created = await this.request('/api/v2/folder/create', 'POST', {
                        name: safeName,
                        parent: parentId || undefined,
                    })
                    const createdId = created?.data?.id
                    if (createdId) {
                        if (!this.folderIndexCache) this.folderIndexCache = new Map()
                        this.folderIndexCache.set(key, { id: createdId, name: safeName, parent: parentId || '', children: [] })
                        return createdId
                    }
                    // 部分 Eagle 版本创建成功但返回体不完整：刷新缓存重查
                    this.clearFolderCache()
                    await this.getFolders(true)
                    const refreshed = this.folderIndexCache && this.folderIndexCache.get(key)
                    if (refreshed?.id) return refreshed.id
                    throw new Error(`创建 Eagle 文件夹失败: ${safeName}`)
                })()
                try {
                    return await this.pendingFolderResolvers[key]
                } finally {
                    delete this.pendingFolderResolvers[key]
                }
            },
            ensureFolderPath: async function (parts, initialParentId = '') {
                const cleanParts = (Array.isArray(parts) ? parts : [])
                    .map(part => this.sanitizeFolderName(part))
                    .filter(Boolean)
                if (cleanParts.length === 0) return undefined
                let parentId = String(initialParentId || '')
                let currentId = parentId
                for (const part of cleanParts) {
                    currentId = await this.ensureFolder(part, parentId)
                    parentId = currentId
                }
                return currentId ? [currentId] : undefined
            },
            normalizeTask: async function (task) {
                const normalized = {
                    url: task.url,
                    name: task.name,
                    website: task.website,
                    tags: Array.isArray(task.tags) ? task.tags : [],
                    annotation: task.annotation || '',
                }
                if (Array.isArray(task.folders) && task.folders.length > 0) {
                    normalized.folders = task.folders
                } else if (Array.isArray(task.folderPath) && task.folderPath.length > 0) {
                    normalized.folders = await this.ensureFolderPath(task.folderPath, task.folderParentId)
                } else if (task.folderParentId) {
                    normalized.folders = [task.folderParentId]
                }
                return normalized
            },
            /**
             * 部分 Eagle 版本接受 item/add 但没真正写入 folders，
             * 导入后用 item/update 再确认一次。
             */
            ensureItemFolders: async function (options = {}) {
                const folderIds = Array.isArray(options.folderIds) ? options.folderIds.filter(Boolean) : []
                if (folderIds.length === 0) return true
                const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
                const itemId = String(options.itemId || '').trim()
                const lookupUrl = String(options.lookupUrl || '').trim()
                const fileName = String(options.fileName || '').trim()
                const annotation = String(options.annotation || '').trim()

                const extractItems = (response) => {
                    if (Array.isArray(response?.data?.data)) return response.data.data
                    if (response?.data?.id) return [response.data]
                    if (Array.isArray(response?.data)) return response.data
                    return []
                }
                const updateFoldersByItem = async (item) => {
                    if (!item || !item.id) return false
                    const currentFolders = Array.isArray(item.folders) ? item.folders.filter(Boolean) : []
                    const nextFolders = Array.from(new Set([...currentFolders, ...folderIds]))
                    const missing = folderIds.filter(id => !currentFolders.includes(id))
                    if (missing.length === 0) return true
                    const updated = await this.request('/api/v2/item/update', 'POST', {
                        id: item.id,
                        folders: nextFolders,
                    })
                    return !!(updated && updated.data !== false)
                }

                if (itemId) {
                    for (let attempt = 1; attempt <= 8; attempt++) {
                        try {
                            const response = await this.request('/api/v2/item/get', 'POST', { id: itemId })
                            const matched = extractItems(response)[0]
                            if (matched && await updateFoldersByItem(matched)) return true
                        } catch (err) {
                            Log.debug('[folder-bind-id]', attempt, err)
                        }
                        await sleep(250)
                    }
                }
                if (lookupUrl) {
                    for (let attempt = 1; attempt <= 10; attempt++) {
                        try {
                            const response = await this.request('/api/v2/item/get', 'POST', { url: lookupUrl, limit: 50 })
                            const candidates = extractItems(response)
                            const matched = candidates.find(item => item.name === fileName && item.annotation === annotation)
                                || candidates.find(item => item.name === fileName)
                                || candidates[0]
                            if (matched && await updateFoldersByItem(matched)) return true
                        } catch (err) {
                            Log.debug('[folder-bind-url]', attempt, err)
                        }
                        await sleep(400)
                    }
                }
                return false
            },
            addItemByUrl: async function (task) {
                if (await this.hasImportedTask(task)) {
                    return { status: 'success', skipped: true, savedCount: 0, skippedCount: 1 }
                }
                const normalizedTask = await this.normalizeTask(task)
                const response = await this.request('/api/v2/item/add', 'POST', normalizedTask)
                if (Array.isArray(normalizedTask.folders) && normalizedTask.folders.length > 0) {
                    try {
                        await this.ensureItemFolders({
                            itemId: response?.data?.id,
                            folderIds: normalizedTask.folders,
                            fileName: normalizedTask.name,
                            lookupUrl: normalizedTask.website,
                            annotation: normalizedTask.annotation,
                        })
                    } catch (folderErr) {
                        Log.warn('[folder-bind-failed]', normalizedTask.name, folderErr)
                    }
                }
                await this.markTaskImported(task)
                response.savedCount = 1
                response.skippedCount = 0
                return response
            },
            /**
             * 批量写入入口：3 worker 并发（Eagle 本地 API 可承受少量并发）。
             */
            addItemsByUrl: async function (taskList) {
                const list = (Array.isArray(taskList) ? taskList : []).filter(Boolean)
                this.eagleItemLookupCache.clear()
                let savedCount = 0
                let skippedCount = 0
                const errors = []
                let cursor = 0
                const worker = async () => {
                    while (true) {
                        const index = cursor++
                        if (index >= list.length) return
                        const task = list[index]
                        try {
                            const result = await this.addItemByUrl(task)
                            savedCount += Number(result?.savedCount || 0)
                            skippedCount += Number(result?.skippedCount || 0)
                        } catch (err) {
                            Log.error('[add-item-failed]', { name: task?.name, url: task?.url }, err)
                            errors.push(`${task?.name || 'unknown'}: ${err?.message || String(err)}`)
                        }
                    }
                }
                await Promise.all(Array.from({ length: Math.min(3, list.length) }, () => worker()))
                if (savedCount === 0 && skippedCount === 0 && errors.length > 0) {
                    throw new Error(errors.slice(0, 3).join(' | '))
                }
                return { status: 'success', savedCount, skippedCount, errors }
            },
        },

        // ╔════════════════════════════════════════════════════════════╗
        // ║          4. 抖音页面上下文检测                                ║
        // ╚════════════════════════════════════════════════════════════╝

        /**
         * 抖音网页版路由约定（与参考实现一致）：
         * - 作者主页：/user/{sec_uid}?showTab=post|like|favorite_collection
         * - 作品详情：/video/{awemeId} 或 /note/{awemeId}
         * - 弹层播放：主页点击卡片后出现的 #sliderVideo（同页内嵌）
         */
        isProfilePage: function (pathname = location.pathname) {
            return pathname.startsWith('/user/')
        },
        getRouteAwemeId: function (pathname = location.pathname) {
            return pathname.match(/\/(?:video|note)\/(\d+)/)?.[1] || ''
        },
        /**
         * 识别当前作者主页激活的 tab。
         * showTab=post 为作品，like 为喜欢，favorite_collection 为收藏。
         */
        getProfileTab: function () {
            const tab = new URLSearchParams(location.search).get('showTab') || 'post'
            return tab
        },
        getProfileSecUid: function (pathname = location.pathname) {
            return pathname.match(/^\/user\/([^/?#]+)/)?.[1] || ''
        },

        /**
         * 页面上下文 → Eagle 目录与标签规则：
         * - 作者主页“作品”tab：目录 抖音/{作者昵称}，标签含页面来源“作品”
         * - “喜欢”tab：目录 抖音/喜欢/{作者昵称}（保留作者维度，便于回溯）
         * - 其他 tab 统一 抖音/{tab名}/{作者昵称}
         * 用户在面板手动选定文件夹时，以所选文件夹为根目录再追加作者子目录。
         */
        getPageContextLabel: function (tab) {
            if (tab === 'like') return '喜欢'
            if (tab === 'post') return '作品'
            if (tab === 'favorite_collection') return '收藏'
            return ''
        },

        // ╔════════════════════════════════════════════════════════════╗
        // ║          5. 作品收割器（React Fiber 数据源）                  ║
        // ╚════════════════════════════════════════════════════════════╝

        harvester: {
            // awemeId → 完整 awemeInfo 对象。虚拟列表会随时卸载旧卡片 DOM，
            // 但数据在这里缓存后不受影响（参考实现同款策略）。
            awemeCache: new Map(),
            // 作者昵称缓存：secUid → nickname（从任意已见 aweme 的 author 字段学习）
            authorNameCache: new Map(),
            fiberPropCache: null,

            /**
             * 在元素自身属性里找 React Fiber 入口 key（形如 __reactFiber$xxx）。
             * key 的后缀哈希每次构建不同，必须动态发现。
             */
            findFiberProp: function (el) {
                if (this.fiberPropCache) return this.fiberPropCache
                const key = Object.keys(el || {}).find(k => k.startsWith('__reactFiber$'))
                if (key) this.fiberPropCache = key
                return key || null
            },

            /**
             * 从卡片元素沿 Fiber 链向上最多 20 层，读 memoizedProps 里的 awemeInfo。
             * 候选路径与参考实现保持一致：
             * props.awemeInfo || props.itemInfo.awemeInfo || props.itemInfo(带 awemeId)
             */
            extractAwemeFromCard: function (cardEl) {
                try {
                    const fiberProp = this.findFiberProp(cardEl)
                    if (!fiberProp) return null
                    let fiber = cardEl[fiberProp]
                    for (let depth = 0; fiber && depth < 20; depth++) {
                        const props = fiber.memoizedProps
                        if (props && typeof props === 'object') {
                            const candidate =
                                props.awemeInfo ||
                                props.itemInfo?.awemeInfo ||
                                (props.itemInfo?.awemeId ? props.itemInfo : null)
                            if (candidate && (candidate.awemeId || candidate.id)) {
                                return candidate
                            }
                        }
                        fiber = fiber.return
                    }
                } catch (err) {
                    Log.debug('[fiber-extract]', err)
                }
                return null
            },

            /**
             * 作者主页作品卡片选择器（参考实现同款）。
             * 覆盖瀑布流容器与直接 a 链接两种渲染形态。
             */
            cardSelector: '.waterfall-videoCardContainer[href], [href*="/video/"][target="_blank"], [href*="/note/"][target="_blank"]',

            /**
             * 扫描当前 DOM 的全部卡片并收割 awemeInfo。
             * 返回本轮新增的 awemeId 数组（供滚动循环判断是否还有进展）。
             */
            scanCards: function () {
                const freshIds = []
                try {
                    const cards = document.querySelectorAll(this.cardSelector)
                    for (const card of cards) {
                        const aweme = this.extractAwemeFromCard(card)
                        const awemeId = String(aweme?.awemeId || aweme?.id || '').trim()
                        if (!awemeId || this.awemeCache.has(awemeId)) continue
                        this.awemeCache.set(awemeId, aweme)
                        freshIds.push(awemeId)
                        const secUid = String(aweme?.author?.secUid || aweme?.author?.sec_uid || '').trim()
                        const nickname = String(aweme?.author?.nickname || '').trim()
                        if (secUid && nickname && !this.authorNameCache.has(secUid)) {
                            this.authorNameCache.set(secUid, nickname)
                        }
                    }
                } catch (err) {
                    Log.debug('[scan-cards]', err)
                }
                return freshIds
            },

            /**
             * 详情页/弹层播放器：从 window.player.config.awemeInfo 拿当前作品。
             * 页面上下文切换后 id 变化时覆盖写入。
             */
            capturePlayerAweme: function () {
                try {
                    const pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window
                    const aweme = pageWindow?.player?.config?.awemeInfo
                    const awemeId = String(aweme?.awemeId || aweme?.id || '').trim()
                    if (awemeId) {
                        this.awemeCache.set(awemeId, aweme)
                        const secUid = String(aweme?.author?.secUid || aweme?.author?.sec_uid || '').trim()
                        const nickname = String(aweme?.author?.nickname || '').trim()
                        if (secUid && nickname) this.authorNameCache.set(secUid, nickname)
                        return awemeId
                    }
                } catch (err) {
                    Log.debug('[capture-player]', err)
                }
                return ''
            },

            /**
             * 从页面 DOM 解析当前 tab 标注的作品总数（如“作品 123”）。
             * 必须按当前 tab 取对应词，否则喜欢页会误读“作品 N”。
             * 拿不到返回 0（滚动循环改用“连续无新增”判停）。
             */
            getReportedTotal: function () {
                try {
                    const text = document.body.innerText || ''
                    const tab = TDD.getProfileTab()
                    const word = tab === 'like' ? '喜欢' : tab === 'favorite_collection' ? '收藏' : '作品'
                    const match = text.match(new RegExp(`(?:^|\\s)${word}\\s*([0-9]{1,7})`, 'm'))
                    if (match) return Number(match[1]) || 0
                } catch (err) {
                    Log.debug('[reported-total]', err)
                }
                return 0
            },

            /**
             * 探测作者页真实的滚动容器。
             * 抖音作者页的滚动条多数情况下不在 window 上，而在某个
             * overflow 容器里——只滚 window 会完全无效（表现为“不自动滚动”）。
             * 策略（与参考实现一致）：从第一张作品卡片向上找第一个
             * overflowY 可滚且内容超出的祖先；找不到再退回页面级容器。
             */
            findScrollContainer: function () {
                const firstCard = document.querySelector(this.cardSelector)
                let current = firstCard instanceof HTMLElement ? firstCard.parentElement : null
                while (current instanceof HTMLElement) {
                    const style = window.getComputedStyle(current)
                    const isScrollable =
                        ['auto', 'scroll', 'overlay'].includes(style.overflowY) &&
                        current.scrollHeight > current.clientHeight + 100
                    if (isScrollable) return current
                    current = current.parentElement
                }
                return (
                    document.querySelector('.route-scroll-container') ||
                    document.querySelector('.parent-route-container') ||
                    document.scrollingElement ||
                    document.documentElement
                )
            },

            /**
             * 滚动一屏（0.85 屏或至少 480px），等 1.2s 供懒加载渲染。
             * 注意用 behavior:'auto' 瞬时滚动——smooth 动画会让位置判断失真。
             */
            scrollPageOnce: async function () {
                const container = this.findScrollContainer()
                if (!container) return { changed: false, atBottom: true }
                const isDocumentScroll =
                    container === document.body ||
                    container === document.documentElement ||
                    container === document.scrollingElement
                const beforeTop = isDocumentScroll ? (window.scrollY || document.documentElement.scrollTop || 0) : container.scrollTop
                const clientHeight = isDocumentScroll ? (window.innerHeight || document.documentElement.clientHeight || 800) : container.clientHeight
                const scrollHeight = container.scrollHeight
                const maxTop = Math.max(0, scrollHeight - clientHeight)
                const nextTop = Math.min(beforeTop + Math.max(Math.floor(clientHeight * 0.85), 480), maxTop)

                if (nextTop <= beforeTop + 4) {
                    return { changed: false, atBottom: true }
                }
                if (isDocumentScroll) {
                    window.scrollTo({ top: nextTop, behavior: 'auto' })
                } else {
                    container.scrollTo({ top: nextTop, behavior: 'auto' })
                }
                await TDD.sleep(1200)
                const afterTop = isDocumentScroll ? (window.scrollY || document.documentElement.scrollTop || 0) : container.scrollTop
                return {
                    changed: afterTop > beforeTop + 40,
                    atBottom: afterTop >= maxTop - 40,
                }
            },
        },

        // ╔════════════════════════════════════════════════════════════╗
        // ║          6. aweme 解析器 → 统一 task 契约                    ║
        // ╚════════════════════════════════════════════════════════════╝

        /**
         * 相对 playApi（/aweme/v1/play/?video_id=...）→ 绝对 URL。
         * 抖音部分字段给 //xxx 开头的协议相对地址，统一补 https:。
         */
        absolutizeUrl: function (raw) {
            const url = String(raw || '').trim()
            if (!url) return ''
            if (url.startsWith('//')) return 'https:' + url
            if (url.startsWith('/')) return 'https://www.douyin.com' + url
            return url
        },

        /**
         * 从 awemeInfo 里取视频下载地址（优先高码率 mp4，过滤 dash）。
         * bitRateList 各档的 playApi 为同源 302 跳转地址，
         * playAddr[].src 为 CDN 直链；两者都可用，playApi 更稳。
         */
        extractVideoUrl: function (video) {
            const bitRates = Array.isArray(video?.bitRateList) ? video.bitRateList : []
            const mp4Rates = bitRates.filter(rate => String(rate?.format || '').toLowerCase() !== 'dash')
            const sorted = mp4Rates.slice().sort((a, b) => Number(b?.bitRate || 0) - Number(a?.bitRate || 0))
            for (const rate of sorted) {
                const playApi = this.absolutizeUrl(rate?.playApi)
                if (playApi) return { url: playApi, ext: 'mp4' }
                const src = this.absolutizeUrl(rate?.playAddr?.[0]?.src || rate?.playAddr?.src)
                if (src) return { url: src, ext: 'mp4' }
            }
            const fallbackApi = this.absolutizeUrl(video?.playApi || video?.playApiH265)
            if (fallbackApi) return { url: fallbackApi, ext: 'mp4' }
            const fallbackAddr = this.absolutizeUrl(video?.playAddr?.urlList?.[0] || video?.play_addr?.url_list?.[0])
            if (fallbackAddr) return { url: fallbackAddr, ext: 'mp4' }
            return null
        },

        /**
         * 图集：images[].urlList / downloadUrlList；图集内的 live 图走 image.video。
         * 返回 [{url, ext, isLiveVideo}]，失败的图跳过。
         */
        extractImageUrls: function (images) {
            const results = []
            for (const image of (Array.isArray(images) ? images : [])) {
                const url = this.absolutizeUrl(
                    image?.urlList?.[0] ||
                    image?.url_list?.[0] ||
                    image?.downloadUrlList?.[0] ||
                    image?.download_url_list?.[0]
                )
                if (url) {
                    const webp = /format=webp|\.webp/i.test(url)
                    results.push({ url, ext: webp ? 'webp' : 'jpeg', isLiveVideo: false })
                    continue
                }
                const liveVideo = this.extractVideoUrl(image?.video)
                if (liveVideo) results.push({ ...liveVideo, isLiveVideo: true })
            }
            return results
        },

        /**
         * awemeInfo → 批量任务数组。task 字段与 eagle-x 契约对齐，
         * 使 Eagle 层（normalizeTask/addItemByUrl/去重）零改动复用：
         * statusId=awemeId, website=规范页面 URL, dedupeTag=tdd:前缀。
         */
        parseAwemeToTasks: function (aweme, options = {}) {
            const awemeId = String(aweme?.awemeId || aweme?.id || '').trim()
            if (!awemeId) return { awemeId: '', tasks: [] }

            const author = aweme?.author || {}
            const secUid = String(author.secUid || author.sec_uid || '').trim()
            const nickname = String(author.nickname || '').trim() || (secUid ? (TDD.harvester.authorNameCache.get(secUid) || '') : '')
            const desc = String(aweme?.desc || '').trim()
            const createTime = Number(aweme?.createTime || aweme?.create_time) || 0
            const isNote = Array.isArray(aweme?.images) && aweme.images.length > 0
            const website = `https://www.douyin.com/${isNote ? 'note' : 'video'}/${awemeId}`

            const pageTab = options.pageTab || TDD.getProfileTab()
            const contextLabel = TDD.getPageContextLabel(pageTab)

            // 目录规则：默认 抖音/[上下文/]作者昵称；面板选定文件夹时以它为根
            const folderPath = []
            if (options.folderParentId) {
                // 手动选定目录：直接用选定目录本身，不叠加（保持用户意图）
            } else {
                folderPath.push('抖音')
                if (contextLabel && contextLabel !== '作品') folderPath.push(contextLabel)
                if (nickname) folderPath.push(TDD.sanitizeFileName(nickname, 40))
            }

            // 标签：抖音 + 页面来源 + 作者昵称 + 用户手选标签
            const baseTags = Array.from(new Set([
                '抖音',
                ...(contextLabel ? [contextLabel] : []),
                ...(nickname ? [TDD.sanitizeFileName(nickname, 30)] : []),
                ...(Array.isArray(options.extraTags) ? options.extraTags : []),
            ].filter(Boolean)))

            const annotationLines = [
                desc,
                `作者: ${nickname}${secUid ? ` (${secUid})` : ''}`,
                createTime ? `发布: ${TDD.formatDate(createTime * 1000)}` : '',
                website,
            ].filter(Boolean)

            const videoInfo = isNote ? null : this.extractVideoUrl(aweme?.video)
            const mediaItems = isNote
                ? this.extractImageUrls(aweme.images).map(item => ({ ...item, fileType: item.isLiveVideo ? 'video' : 'image' }))
                : (videoInfo ? [{ ...videoInfo, fileType: 'video' }] : [])

            const descName = TDD.sanitizeFileName(desc, 36) || awemeId

            const tasks = mediaItems.map((item, index) => {
                const suffix = mediaItems.length > 1 ? `-${String(index + 1).padStart(2, '0')}` : ''
                const name = `${descName}${suffix}-${awemeId}.${item.ext}`
                const dedupeTag = this.eagle.buildEagleDedupeTag({
                    statusId: awemeId,
                    mediaIndex: index,
                    fileType: item.fileType,
                })
                const mediaFingerprint = [awemeId, String(index), item.fileType].filter(Boolean).join('::')
                return {
                    url: item.url,
                    name,
                    website,
                    fileType: item.fileType,
                    statusId: awemeId,
                    mediaId: '',
                    mediaIndex: index,
                    mediaFingerprint,
                    dedupeTag,
                    annotation: `${annotationLines.join('\n')}\n[EDD] ${dedupeTag}`.trim(),
                    folderPath: folderPath.length > 0 ? folderPath : undefined,
                    folderParentId: options.folderParentId || '',
                    tags: [...baseTags],
                    nickname,
                    secUid,
                    createTime,
                }
            })

            return { awemeId, website, isNote, nickname, tasks }
        },

        // ╔════════════════════════════════════════════════════════════╗
        // ║          7. 批量面板 + 采集主循环                             ║
        // ╚════════════════════════════════════════════════════════════╝

        batch: {
            running: false,
            mode: '',
            processed: new Set(),
            inFlight: new Set(),
            successAwemes: 0,
            failedAwemes: 0,
            successMedia: 0,
            skippedMedia: 0,
            failedMedia: 0,
            lastError: '',
            panel: null,
            launcher: null,
            statusEl: null,
            progressEl: null,
            folderPicker: null,
            tagPicker: null,
            folderLimitEl: null,
            eagleDegraded: 0,
            localDirHandle: null,
            reportedTotal: 0,
            selectedTags: [],
            recentTags: [],
            eagleTags: [],
            tagCatalogLoading: false,


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


            /**
             * 从 Eagle 拉取标签目录灌入共享库标签选择器。
             * Eagle 未运行/拉取失败时在弹层内显示提示文案，不影响其他功能。
             */
            loadTagCatalog: async function () {
                if (!this.tagPicker) return
                if (this.tagCatalogLoading) return
                this.tagCatalogLoading = true
                this.tagPicker.setLoading(true)
                try {
                    const catalog = await TDD.eagle.getTagCatalog()
                    this.eagleTags = Array.isArray(catalog?.tags) ? catalog.tags : []
                    this.tagPicker.setTags(this.eagleTags)
                } catch (err) {
                    this.tagPicker.setError('标签目录不可用（Eagle 未运行或接口异常）')
                } finally {
                    this.tagCatalogLoading = false
                }
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

            formatProgress: function (suffix = '') {
                const collected = TDD.harvester.awemeCache.size
                const ratio = this.reportedTotal > 0 ? `${collected}/${this.reportedTotal}` : `${collected}/?`
                const base = `已收 ${ratio}｜本轮已处理 ${this.processed.size}｜新存 ${this.successMedia}｜已存过跳过 ${this.skippedMedia}｜失败 ${this.failedMedia}`
                return suffix ? `${base}｜${suffix}` : base
            },

            /**
             * 结束态总结：与过程态分开，用一句话讲清“收了多少、新存多少、跳过多少”。
             * 跳过 = 三层去重判定 Eagle 里已有（历史批次已保存），不是丢失。
             */
            formatSummary: function () {
                const collected = TDD.harvester.awemeCache.size
                const ratio = this.reportedTotal > 0 ? `${collected}/${this.reportedTotal}` : `${collected}`
                const parts = [
                    `共发现 ${ratio} 个作品`,
                    `本次新存 ${this.successMedia}`,
                    this.skippedMedia > 0 ? `已存过自动跳过 ${this.skippedMedia}` : '',
                    this.failedMedia > 0 ? `失败 ${this.failedMedia}` : '',
                    this.eagleDegraded > 0 ? `转本地保存 ${this.eagleDegraded}` : '',
                ].filter(Boolean)
                return parts.join('，')
            },

            getLimit: function () {
                const value = Number(this.folderLimitEl ? this.folderLimitEl.value : 0)
                return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
            },

            /**
             * 拉取 Eagle 文件夹树灌入共享库文件夹选择器（保留原始层级）。
             */
            refreshFolderOptions: async function () {
                if (!this.folderPicker) return
                try {
                    const folders = await TDD.eagle.getFolders()
                    this.folderPicker.setFolders(Array.isArray(folders) ? folders : [])
                    if (this.connStatus) this.connStatus.set('connected')
                } catch (err) {
                    if (this.connStatus) this.connStatus.set('disconnected')
                    Log.warn('[refresh-folders]', err)
                }
            },

            restoreFolderSelection: async function () {
                const saved = String(await GM_getValue('edd_selected_folder_id', '') || '')
                if (saved) {
                    await this.refreshFolderOptions()
                    if (this.folderPicker) this.folderPicker.setSelected([saved])
                }
            },

            /**
             * 采集主循环：滚动 → 收割 → 逐作品处理 → 判断终止。
             * 与参考实现不同点：边滚边采边下载，无需先滚完全页再选择。
             */
            start: async function (mode) {
                if (this.running) return
                if (!TDD.isProfilePage()) {
                    this.setText('仅作者主页支持批量', '请打开 /user/ 页面（作品或喜欢 tab）')
                    return
                }
                let folderParentId = ''
                if (mode === 'eagle') {
                    try {
                        await TDD.eagle.checkAlive()
                        await this.refreshFolderOptions()
                        folderParentId = String((this.folderPicker && this.folderPicker.getSelected()[0]) || '')
                    } catch (err) {
                        this.setText('Eagle 未连接', String(err.message || err))
                        return
                    }
                }
                if (mode === 'download' && TDD.localDownload.isSupported()) {
                    try {
                        this.setText('请选择本地保存目录...', '')
                        this.localDirHandle = await TDD.localDownload.ensureDirectory(false)
                    } catch (err) {
                        if (String(err.message || err) === 'FOLDER_PICK_CANCELLED') {
                            this.setText('已取消', '未选择本地目录')
                            return
                        }
                        this.setText('本地目录选择失败', String(err.message || err))
                        return
                    }
                }

                this.running = true
                this.mode = mode
                this.processed = new Set()
                this.inFlight = new Set()
                this.successAwemes = 0
                this.failedAwemes = 0
                this.successMedia = 0
                this.skippedMedia = 0
                this.failedMedia = 0
                this.eagleDegraded = 0
                this.lastError = ''
                this.renderButtons()
                this.setText(mode === 'download' ? '本地下载中' : '正在存入 Eagle', '开始扫描页面...')

                const limit = this.getLimit()
                this.reportedTotal = TDD.harvester.getReportedTotal()
                let idleRounds = 0
                const maxIdle = 8

                while (this.running) {
                    const fresh = TDD.harvester.scanCards()
                    if (fresh.length > 0) idleRounds = 0

                    const pending = Array.from(TDD.harvester.awemeCache.keys())
                        .filter(id => !this.processed.has(id) && !this.inFlight.has(id))

                    if (limit > 0 && this.processed.size >= limit) {
                        this.setText('达到数量上限，已停止', this.formatSummary())
                        break
                    }

                    if (pending.length === 0) {
                        if (this.reportedTotal > 0 && TDD.harvester.awemeCache.size >= this.reportedTotal) {
                            this.setText('采集完成（已收满页面总数）', this.formatSummary())
                            break
                        }
                        if (idleRounds >= maxIdle) {
                            this.setText('采集结束（页面已无更多内容）', this.formatSummary() + '；若还有未加载部分，可手动下拉后再开始，已完成部分会自动跳过')
                            break
                        }
                        const scroll = await TDD.harvester.scrollPageOnce()
                        if (scroll.changed) {
                            // 滚动仍有进展：懒加载可能正在填充，重置空转计数
                            idleRounds = 0
                        } else if (scroll.atBottom) {
                            idleRounds++
                            await TDD.sleep(1800)
                        } else {
                            idleRounds++
                        }
                        this.setText(
                            mode === 'download' ? '本地下载中' : '正在存入 Eagle',
                            this.formatProgress(`滚动加载中（空转 ${idleRounds}/${maxIdle}）`)
                        )
                        continue
                    }

                    for (const awemeId of pending) {
                        if (!this.running) break
                        if (limit > 0 && this.processed.size >= limit) break
                        this.inFlight.add(awemeId)
                        this.setText(
                            mode === 'download' ? '本地下载中' : '正在存入 Eagle',
                            `${this.processed.size} 处理中...`
                        )
                        try {
                            const aweme = TDD.harvester.awemeCache.get(awemeId)
                            const payload = TDD.parseAwemeToTasks(aweme, {
                                extraTags: this.selectedTags,
                                folderParentId,
                            })
                            if (!payload.tasks || payload.tasks.length === 0) {
                                throw new Error('MEDIA_NOT_FOUND')
                            }
                            if (mode === 'download') {
                                for (const task of payload.tasks) {
                                    if (this.localDirHandle) {
                                        await TDD.localDownload.saveTask(task, this.localDirHandle)
                                    } else {
                                        await TDD.downloadViaBrowser(task)
                                    }
                                    this.successMedia++
                                    await TDD.sleep(300)
                                }
                            } else {
                                try {
                                    const result = await TDD.eagle.addItemsByUrl(payload.tasks)
                                    this.successMedia += Number(result?.savedCount || 0)
                                    this.skippedMedia += Number(result?.skippedCount || 0)
                                } catch (eagleErr) {
                                    // 抖音 CDN 直链可能因 Referer 校验导致 Eagle 拉取失败：
                                    // 自动降级为本地下载（已授权目录时），否则记失败提示。
                                    if (this.localDirHandle) {
                                        for (const task of payload.tasks) {
                                            await TDD.localDownload.saveTask(task, this.localDirHandle)
                                            this.successMedia++
                                        }
                                        this.eagleDegraded++
                                        this.lastError = `Eagle 拉取失败已转本地保存（${this.eagleDegraded}）`
                                    } else {
                                        throw eagleErr
                                    }
                                }
                            }
                            this.successAwemes++
                            this.processed.add(awemeId)
                        } catch (err) {
                            const errText = String(err?.message || err || 'UNKNOWN_ERROR').slice(0, 160)
                            // 解析失败后按作品 ID 再做一次 Eagle 侧确认（历史已保存 → 记跳过）
                            let alreadyImported = false
                            if (mode === 'eagle') {
                                try {
                                    alreadyImported = await TDD.eagle.hasImportedStatus(awemeId)
                                } catch (dedupeErr) {
                                    Log.debug('[post-failure-dedupe]', awemeId, dedupeErr)
                                }
                            }
                            if (alreadyImported) {
                                this.skippedMedia++
                                this.processed.add(awemeId)
                            } else {
                                this.processed.add(awemeId)
                                this.failedAwemes++
                                this.failedMedia += 1
                                this.lastError = errText
                                Log.error('[batch]', awemeId, err)
                            }
                        } finally {
                            this.inFlight.delete(awemeId)
                        }
                        this.setText(
                            mode === 'download' ? '本地下载中' : '正在存入 Eagle',
                            this.formatProgress(this.lastError ? '最近错误：' + this.lastError : '')
                        )
                    }
                }

                const finishedByUser = !this.running
                this.running = false
                this.renderButtons()
                this.setText(
                    finishedByUser ? '已停止' : '采集完成',
                    this.formatSummary()
                )
            },

            /**
             * 详情页/弹层单发：从播放器实例拿当前作品，立即保存。
             */
            collectCurrent: async function () {
                if (this.running) return
                let awemeId = TDD.harvester.capturePlayerAweme()
                if (!awemeId) {
                    awemeId = TDD.getRouteAwemeId()
                }
                if (!awemeId) {
                    this.setText('未检测到当前作品', '请打开视频/图文详情页，或先播放一次')
                    return
                }
                let aweme = TDD.harvester.awemeCache.get(awemeId)
                if (!aweme) {
                    this.setText('未捕获作品数据', '请稍等播放器加载后重试')
                    return
                }
                this.running = true
                this.renderButtons()
                try {
                    await TDD.eagle.checkAlive()
                    const folderParentId = String((this.folderPicker && this.folderPicker.getSelected()[0]) || '')
                    const payload = TDD.parseAwemeToTasks(aweme, {
                        extraTags: this.selectedTags,
                        folderParentId,
                    })
                    if (!payload.tasks || payload.tasks.length === 0) {
                        throw new Error('MEDIA_NOT_FOUND')
                    }
                    const result = await TDD.eagle.addItemsByUrl(payload.tasks)
                    this.setText(
                        '当前作品已保存',
                        `新增 ${result?.savedCount || 0}｜跳过 ${result?.skippedCount || 0}`
                    )
                } catch (err) {
                    this.setText('保存失败', String(err.message || err))
                } finally {
                    this.running = false
                    this.renderButtons()
                }
            },

            renderButtons: function () {
                if (!this.panel) return
                const startBtn = this.panel.querySelector('#edd-btn-start')
                const currentBtn = this.panel.querySelector('#edd-btn-current')
                const stopBtn = this.panel.querySelector('#edd-btn-stop')
                const controlRow = this.panel.querySelector('#edd-control-row')
                if (startBtn) startBtn.disabled = this.running
                if (currentBtn) currentBtn.disabled = this.running
                if (controlRow) controlRow.style.display = this.running ? 'flex' : 'none'
                if (stopBtn) stopBtn.disabled = !this.running
            },

            stop: function () {
                this.running = false
                this.setText('已停止', this.formatSummary())
                this.renderButtons()
            },
        },

        // ╔════════════════════════════════════════════════════════════╗
        // ║   8. 样式 —— 已统一收敛到家族共享库 eagle-ui.js（@require） ║
        // ╚════════════════════════════════════════════════════════════╝

        // ╔════════════════════════════════════════════════════════════╗
        // ║          9. 启动：SPA 路由轮询 + 面板挂载                     ║
        // ╚════════════════════════════════════════════════════════════╝

        init: function () {
            // 抖音是 SPA：无刷新路由切换，用轻量轮询同步面板显隐与被动收割。
            // 作者主页显示面板；详情页保留面板（供“采集当前作品”）；其他页面隐藏。
            const syncPanelVisibility = () => {
                const shouldShow = this.isProfilePage() || !!this.getRouteAwemeId()
                if (shouldShow && !this.batch.panel) {
                    this.batch.init()
                }
                if (this.batch.launcher) {
                    this.batch.launcher.style.display = shouldShow ? '' : 'none'
                    if (!shouldShow && this.batch.panel) {
                        this.batch.panel.classList.remove('is-open')
                    }
                }
                // 被动收割：任何页面都持续缓存卡片数据，切 tab 后缓存仍在
                if (this.isProfilePage()) {
                    this.harvester.scanCards()
                }
            }
            syncPanelVisibility()
            setInterval(syncPanelVisibility, 2500)
        },
    }

    TDD.init()
})()
