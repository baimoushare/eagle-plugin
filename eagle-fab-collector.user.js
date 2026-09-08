// ==UserScript==
// @name        Fab图片批量保存到Eagle
// @namespace    eagle-fab-collector
// @version      1.1.0
// @modified      2026-09-08
// @description  在 Fab.com 页面批量采集图片，可保存到 Eagle 或本地下载，按“英文｜中文”自动建目录
// @author       laobai
// @license      Copyright (c) 2026 laobai. All rights reserved.
// @supportURL   mailto:www.774466655@qq.com
// @match        *://www.fab.com/*
// @match        *://fab.com/*
// @require      https://update.greasyfork.org/scripts/594761/Eagle%20Collector%20UI.js
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      localhost
// @connect      127.0.0.1
// @connect      media.fab.com
// @connect      api.mymemory.translated.net
// @connect      translate.googleapis.com
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 🔍 诊断：脚本加载确认（任何匹配的页面都会执行到此）
    console.log('[EagleScraper] 🟢 脚本已加载！当前URL:', window.location.href, 'hostname:', window.location.hostname);

    // ╔══════════════════════════════════════════════════════════════╗
    // ║              1. 日志工具 —— 统一调试输出                       ║
    // ╚══════════════════════════════════════════════════════════════╝
    const LOG_PREFIX = '[EagleScraper]';

    const Log = {
        info: (...args) => console.log(LOG_PREFIX, ...args),
        warn: (...args) => console.warn(LOG_PREFIX, ...args),
        error: (...args) => console.error(LOG_PREFIX, ...args),
        debug: (...args) => console.debug(LOG_PREFIX, ...args),
    };

    /**
     * 脚本内部使用的持久化 Key。
     * 这里用来记住用户上次选择的 Eagle 文件夹、操作模式和最近使用过的标签。
     * 已选标签按网站隔离，不能从 Fab 自动带到 E-Hentai。
     */
    const STORAGE_KEYS = {
        lastFolderId: 'eagle.scraper.lastFolderId',
        folderIds: 'eagle.scraper.folderIds',
        actionMode: 'eagle.scraper.actionMode',
        recentTags: 'eagle.scraper.recentTags',
        recentFolders: 'eagle.scraper.recentFolders',
        selectedTagsBySite: 'eagle.scraper.selectedTagsBySite',
        // 旧版全局已选标签 Key，仅用于升级时清理，不再读取。
        selectedTags: 'eagle.scraper.selectedTags',
    };

    /** 将内部页面类型转换为用户可见的中文文案。 */
    function getPageTypeLabel(pageType = '') {
        return ({
            gallery_detail: '画廊详情',
            gallery_list: '画廊列表',
            image_viewer: '图片查看器',
            listing_detail: '商品页面',
            any_page: '任意页面',
        })[pageType] || '当前页面';
    }

    /**
     * E-Hentai / ExHentai 的保守限频配置。
     *
     * 说明：
     * 1. 这类站点对短时间内连续请求比较敏感；
     * 2. 一旦触发限制，轻则只能拿到低清/重采样图，重则直接跳到限制说明页；
     * 3. 因此这里默认采用“单线程 + 随机慢速延迟”策略，优先稳定性而不是极限速度。
     */
    const EHENTAI_RATE_LIMIT = {
        concurrency: 1,
        galleryPageDelayMin: 2800,
        galleryPageDelayMax: 4200,
        itemDelayMin: 2400,
        itemDelayMax: 3800,
        currentPageDelayMin: 1800,
        currentPageDelayMax: 2800,
    };

    // ╔══════════════════════════════════════════════════════════════╗
    // ║           2. 站点规则配置中心 —— 添加新网站只需补充此处         ║
    // ╚══════════════════════════════════════════════════════════════╝
    const SITE_RULES = {
        /*
         * Fab 专用版:仅保留 Fab.com 站点规则。
         * 本版本不包含 E-Hentai / ExHentai 支持(完整版见 eagle-web-collector),
         * 因此不涉及成人站点,Greasy Fork 发布时无需勾选成人内容标记,
         * 搜索结果对所有用户默认可见。
         */
        // ──── Fab.com ──────────────────────────────────────────
        'www.fab.com': {
            name: 'Fab',
            hostnames: ['www.fab.com', 'fab.com'],
            pages: {
                // 📄 产品详情/列表页 —— /listings/xxx
                listing_detail: {
                    match: /\/listings\//,
                    type: 'fab_gallery',
                    minWidth: 400,
                    minHeight: 300,
                },
                // 📄 Fab.com 任意页面（兜底规则，保证面板始终出现）
                //    将此规则放在最后，前面的规则优先匹配
                any_page: {
                    match: /fab\.com\//,
                    type: 'generic_scan',
                    minWidth: 400,
                    minHeight: 300,
                },
            },
        },
    };

    // ╔══════════════════════════════════════════════════════════════╗
    // ║              3. 通用工具函数                                  ║
    // ╚══════════════════════════════════════════════════════════════╝

    /**
     * 根据当前 URL 匹配站点规则
     * @returns {{ siteKey: string, siteConfig: object, pageType: string, pageConfig: object } | null}
     */
    function matchSiteRule() {
        const hostname = window.location.hostname;
        // 遍历所有站点规则，按 hostname 匹配
        for (const [siteKey, siteConfig] of Object.entries(SITE_RULES)) {
            if (siteConfig.hostnames && siteConfig.hostnames.includes(hostname)) {
                // 找到站点，进一步匹配页面类型
                for (const [pageType, pageConfig] of Object.entries(siteConfig.pages)) {
                    if (pageConfig.match && pageConfig.match.test(window.location.href)) {
                        return { siteKey, siteConfig, pageType, pageConfig };
                    }
                }
            }
        }
        return null;
    }

    /**
     * 将相对 URL 转成绝对 URL
     * @param {string} url - 可能是相对路径的 URL
     * @param {string} base - 基础 URL（默认当前页面 origin）
     */
    function toAbsoluteURL(url, base) {
        try {
            return new URL(url, base || window.location.origin).href;
        } catch (e) {
            return url;
        }
    }

    /**
     * 从 blob 转换为 base64 字符串（使用 FileReader 的 Promise 封装）
     * @param {Blob} blob - 图片的二进制数据
     * @returns {Promise<string>} base64 编码字符串（不含 data: 前缀）
     */
    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                // FileReader 返回 "data:image/jpeg;base64,xxxxx"
                // 去掉前缀，只保留纯 base64 数据
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * 判断一个 Blob 是否大概率真的是图片。
     *
     * 为什么需要这个判断：
     * 1. E-Hentai 的“Download original”有时会跳到登录页 / 搜图页 HTML
     * 2. 浏览器或 GM 请求虽然返回 200，但内容其实不是图片
     * 3. 如果把 HTML 当图片送进 Eagle，面板会显示成功，但 Eagle 会一直卡在导入队列
     *
     * @param {Blob} blob
     * @param {string} sourceUrl
     * @returns {boolean}
     */
    function isLikelyImageBlob(blob, sourceUrl = '') {
        if (!blob) return false;

        const mimeType = String(blob.type || '').toLowerCase();
        if (mimeType.startsWith('image/')) {
            return true;
        }

        // 某些下载响应可能不给标准图片 MIME，而是 application/octet-stream，
        // 这时再根据 URL 后缀做一次兜底判断。
        try {
            const pathname = new URL(sourceUrl, window.location.href).pathname.toLowerCase();
            if (
                (mimeType === '' || mimeType === 'application/octet-stream') &&
                /\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(pathname)
            ) {
                return true;
            }
        } catch (err) {
            // 忽略 URL 解析失败
        }

        return false;
    }

    /**
     * 从 E-Hentai viewer 文档中稳定提取“Download original”链接。
     *
     * 不能再用“最后一个 a”这种脆弱规则，原因：
     * - 浏览器翻译插件 / 页面增强插件可能会在 <a> 后注入额外节点
     * - 这会导致 a:last-child / 最后一个链接失真
     *
     * 更稳的策略：
     * 1. 优先找 href 中包含 /fullimg/ 的链接
     * 2. 再找文本包含 Download original 的链接
     *
     * @param {Document} doc
     * @returns {string|null}
     */
    function extractEHentaiOriginalUrl(doc) {
        const anchors = Array.from(doc.querySelectorAll('#i6 a[href]'));
        const matched = anchors.find(a => /\/fullimg\//i.test(a.href))
            || anchors.find(a => /download original/i.test((a.textContent || '').trim()));

        if (!matched) return null;
        return toAbsoluteURL(matched.getAttribute('href') || matched.href, window.location.origin);
    }

    /**
     * 下载 E-Hentai 最终可用图片：
     * - 先尝试 Download original
     * - 若返回的不是图片（常见是登录页 / 搜图页 HTML），则自动回退到 viewer 页里的主图
     *
     * @param {{ originalUrl?: string|null, fullImageUrl?: string|null, viewerLink: string }}
     * @returns {Promise<{ blob: Blob, finalUrl: string, source: 'original' | 'display' }>}
     */
    async function downloadEHentaiBestImage({ originalUrl, fullImageUrl, viewerLink }) {
        const candidates = [
            { url: originalUrl, source: 'original' },
            { url: fullImageUrl, source: 'display' },
        ].filter(item => !!item.url);

        const errors = [];

        for (const candidate of candidates) {
            try {
                const blob = await downloadImageBlobSmart(candidate.url, {
                    credentials: 'include',
                    headers: {
                        'User-Agent': navigator.userAgent,
                        'Referer': viewerLink,
                    },
                }, {
                    headers: {
                        'User-Agent': navigator.userAgent,
                        'Referer': viewerLink,
                    },
                    timeout: 30000,
                    maxRetries: 3,
                    delayMs: 3000,
                });

                if (!isLikelyImageBlob(blob, candidate.url)) {
                    throw new Error(`返回的不是图片，type=${blob.type || 'unknown'}`);
                }

                if (candidate.source === 'display' && originalUrl) {
                    Log.warn(`E-Hentai 原图不可用，已回退到页面主图: ${viewerLink}`);
                }

                return {
                    blob,
                    finalUrl: candidate.url,
                    source: candidate.source,
                };
            } catch (err) {
                errors.push(`${candidate.source}: ${err.message}`);
                Log.warn(`E-Hentai ${candidate.source === 'original' ? '原图' : '页面主图'}下载失败: ${err.message}`);
            }
        }

        throw new Error(`原图和页面主图都不可用：${errors.join(' | ')}`);
    }

    /**
     * 将浏览器不够稳定的图片格式（主要是 WebP / AVIF）统一转成 JPEG，
     * 避免 Eagle 对 data URI 某些格式的兼容性不一致，导致“API 成功但导入队列卡住”。
     *
     * 目前主要用于 E-Hentai 的页面主图回退，因为那边常见的是 WebP。
     *
     * @param {Blob} blob
     * @returns {Promise<Blob>}
     */
    async function normalizeBlobForEagle(blob) {
        const mimeType = String(blob && blob.type || '').toLowerCase();
        if (!blob || (!mimeType.includes('webp') && !mimeType.includes('avif'))) {
            return blob;
        }

        try {
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();

            const jpegBlob = await new Promise((resolve, reject) => {
                canvas.toBlob((result) => {
                    if (result) resolve(result);
                    else reject(new Error('canvas.toBlob 返回空结果'));
                }, 'image/jpeg', 0.95);
            });

            Log.info(`图片格式已转为 JPEG: ${mimeType} -> image/jpeg`);
            return jpegBlob;
        } catch (err) {
            Log.warn(`图片格式转换失败，继续使用原始格式 ${mimeType}: ${err.message}`);
            return blob;
        }
    }

    /**
     * 为 E-Hentai / ExHentai 生成更稳定的文件名。
     * 这样能降低历史测试残留文件造成的“重复覆盖”干扰，也更方便定位页码。
     *
     * @param {string} viewerLink
     * @param {string|number|null} actualPage
     * @param {string} sourceUrl
     * @param {string} mimeType
     * @returns {string}
     */
    function buildEHentaiFileName(viewerLink, actualPage, sourceUrl, mimeType = 'image/jpeg') {
        const galleryInfo = getEHentaiGalleryInfo();
        const galleryTitle = galleryInfo.title || '';
        let galleryId = 'gallery';
        let pageNo = String(actualPage || '').trim();

        const viewerMatch = String(viewerLink || '').match(/\/s\/[a-f0-9]+\/(\d+)-(\d+)/i);
        if (viewerMatch) {
            galleryId = viewerMatch[1] || galleryId;
            if (!pageNo) pageNo = viewerMatch[2] || '';
        }

        const extMap = {
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif',
            'image/bmp': 'bmp',
            'image/avif': 'avif',
        };
        const normalizedMime = String(mimeType || '').toLowerCase();
        const ext = extMap[normalizedMime] || (normalizedMime.split('/')[1] || 'jpg');
        const paddedPage = String(pageNo || '0').padStart(4, '0');

        const titlePart = sanitizeFileBaseName(galleryTitle, 56);

        // 文件名包含画廊 ID、标题和固定宽度页码：
        // 1. 在 Eagle、资源管理器和导出软件中按名称排序就是漫画阅读顺序；
        // 2. 标题便于脱离 Eagle 后快速识别来源；
        // 3. 画廊 ID 保留为稳定去重线索；
        // 4. 即使单个画廊超过 9999 页，padStart 也不会截断页码。
        return `eh_${galleryId}${titlePart ? `_${titlePart}` : ''}_p${paddedPage}.${ext}`;
    }

    /**
     * 读取当前 E-Hentai / ExHentai 画廊信息。
     * 画廊详情页优先使用 #gn（英文标题），#gj 作为补充；
     * 图片查看器页则从当前 URL 提取画廊 ID，标题缺失时仍能创建稳定目录。
     */
    function getEHentaiGalleryInfo() {
        const href = String(window.location.href || '');
        const path = String(window.location.pathname || '');
        const idMatch = path.match(/\/g\/(\d+)\//i) || href.match(/\/s\/[a-f0-9]+\/(\d+)-\d+/i);
        const galleryId = idMatch ? idMatch[1] : 'gallery';
        const englishTitle = getTextContent('#gn')
            || getTextContent('.arc-list .gtitle')
            || '';
        const japaneseTitle = getTextContent('#gj');
        const documentTitle = String(document.title || '')
            .replace(/\s*[-|]\s*E-?Hentai.*$/i, '')
            .trim();
        const title = englishTitle || japaneseTitle || documentTitle || `Gallery ${galleryId}`;
        const folderBase = sanitizeFileBaseName(title, 72);
        return {
            galleryId,
            title,
            folderName: `eh_${galleryId}_${folderBase}`,
        };
    }

    /**
     * 带重试的 fetch 请求
     * @param {string} url - 目标 URL
     * @param {object} options - fetch 选项
     * @param {number} maxRetries - 最大重试次数（默认 3）
     * @param {number} delayMs - 重试间隔基础毫秒数（指数退避）
     */
    async function fetchWithRetry(url, options = {}, maxRetries = 3, delayMs = 1000) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                return response;
            } catch (err) {
                Log.warn(`请求失败 (${attempt}/${maxRetries}): ${url} —— ${err.message}`);
                if (attempt === maxRetries) throw err;
                // 指数退避：1s → 2s → 4s
                await sleep(delayMs * Math.pow(2, attempt - 1));
            }
        }
    }

    /**
     * 延迟函数（Promise 封装 setTimeout）
     * @param {number} ms - 毫秒数
     */

    /**
     * 判断异常是否像典型的 CORS / 跨域失败。
     * 这里用于决定是否从 fetch 自动回退到 GM_xmlhttpRequest。
     * @param {any} err
     * @returns {boolean}
     */
    function isCorsLikeError(err) {
        const message = (err && err.message ? String(err.message) : String(err || '')).toLowerCase();
        return (
            message.includes('failed to fetch') ||
            message.includes('networkerror') ||
            message.includes('cors') ||
            message.includes('cross-origin') ||
            message.includes('access-control-allow-origin')
        );
    }
    /**
     * 将 ArrayBuffer 转为 Blob。
     * 之所以单独封装，是因为部分 Tampermonkey / 浏览器环境下
     * GM_xmlhttpRequest 对 responseType=blob 的兼容性不如 arraybuffer 稳定。
     * @param {ArrayBuffer} buffer
     * @param {string} mimeType
     * @returns {Blob}
     */
    function arrayBufferToBlob(buffer, mimeType = 'application/octet-stream') {
        return new Blob([buffer], { type: mimeType || 'application/octet-stream' });
    }

    /**
     * 使用 Tampermonkey 的 GM_xmlhttpRequest 下载图片 Blob。
     * 该请求位于扩展层，可绕过页面级 CORS 限制。
     * @param {string} url
     * @param {object} options
     * @returns {Promise<Blob>}
     */
    function downloadBlobWithGM(url, options = {}) {
        const maxRetries = options.maxRetries || 3;
        const retryDelay = options.retryDelay || 1200;

        const run = (attempt) => new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: options.headers || {},
                timeout: options.timeout || 30000,
                responseType: 'arraybuffer',
                anonymous: false,
                onload: async (resp) => {
                    try {
                        if (resp.status >= 200 && resp.status < 300 && resp.response) {
                            const responseHeaders = String(resp.responseHeaders || '');
                            const ctMatch = responseHeaders.match(/content-type:\s*([^\r\n;]+)/i);
                            const mimeType = ctMatch ? ctMatch[1].trim() : (options.mimeType || 'application/octet-stream');
                            const blob = arrayBufferToBlob(resp.response, mimeType);
                            Log.info(`GM 下载成功: ${url} | status=${resp.status} | type=${mimeType}`);
                            resolve(blob);
                            return;
                        }

                        if (attempt < maxRetries) {
                            Log.warn(`GM HTTP 失败，准备重试 (${attempt}/${maxRetries}): ${url}`);
                            await sleep(retryDelay * attempt);
                            resolve(run(attempt + 1));
                            return;
                        }

                        reject(new Error(`GM HTTP ${resp.status} ${resp.statusText || ''}`.trim()));
                    } catch (e) {
                        if (attempt < maxRetries) {
                            Log.warn(`GM 解析失败，准备重试 (${attempt}/${maxRetries}): ${url}`);
                            await sleep(retryDelay * attempt);
                            resolve(run(attempt + 1));
                            return;
                        }
                        reject(new Error(`GM 解析响应失败: ${e.message}`));
                    }
                },
                onerror: async () => {
                    if (attempt < maxRetries) {
                        Log.warn(`GM 请求失败，准备重试 (${attempt}/${maxRetries}): ${url}`);
                        await sleep(retryDelay * attempt);
                        resolve(run(attempt + 1));
                        return;
                    }
                    reject(new Error(`GM_xmlhttpRequest failed: ${url}`));
                },
                ontimeout: async () => {
                    if (attempt < maxRetries) {
                        Log.warn(`GM 请求超时，准备重试 (${attempt}/${maxRetries}): ${url}`);
                        await sleep(retryDelay * attempt);
                        resolve(run(attempt + 1));
                        return;
                    }
                    reject(new Error(`GM_xmlhttpRequest timeout: ${url}`));
                },
            });
        });

        return run(1);
    }

    /**
     * 智能下载图片 Blob：
     * 1. 先尝试普通 fetch
     * 2. 若被 CORS 拦截，则自动回退到 GM_xmlhttpRequest
     * @param {string} url
     * @param {object} fetchOptions
     * @param {object} gmOptions
     * @returns {Promise<Blob>}
     */
    async function downloadImageBlobSmart(url, fetchOptions = {}, gmOptions = {}) {
        const targetHost = (() => {
            try { return new URL(url, window.location.href).hostname; } catch (e) { return ''; }
        })();

        // 这些站点的图片资源明确属于跨域下载场景，直接走 GM 更稳：
        // - Fab: media.fab.com
        // - E-Hentai / ExHentai: 动态 *.hath.network
        //
        // 这样做的好处：
        // 1. 避免先触发一轮 fetch/CORS 报错
        // 2. 减少无意义的重试等待
        // 3. 配合明确的 @connect 域名声明后，不会再出现“一张图弹一次授权页”
        if (
            targetHost === 'media.fab.com' ||
            targetHost === 'hath.network' ||
            targetHost.endsWith('.hath.network')
        ) {
            Log.info(`跨域图片直接使用 GM 下载: ${url}`);
            return await downloadBlobWithGM(url, {
                headers: gmOptions.headers || fetchOptions.headers || {},
                timeout: gmOptions.timeout || 30000,
            });
        }

        try {
            const response = await fetchWithRetry(
                url,
                fetchOptions,
                gmOptions.maxRetries || 2,
                gmOptions.delayMs || 1500
            );
            return await response.blob();
        } catch (err) {
            if (!isCorsLikeError(err)) {
                throw err;
            }

            Log.warn(`fetch 疑似被 CORS 拦截，改用 GM 下载: ${url}`);
            return await downloadBlobWithGM(url, {
                headers: gmOptions.headers || fetchOptions.headers || {},
                timeout: gmOptions.timeout || 30000,
            });
        }
    }

    /**
     * 获取当前动作模式的人类可读名称。
     * 这里统一收口，避免后面各处文案写死。
     *
     * @param {'eagle'|'local'} mode
     * @returns {string}
     */
    function getActionModeLabel(mode = 'eagle') {
        return mode === 'local' ? '本地下载' : '保存到 Eagle';
    }

    /**
     * 将文件名规范化，避免包含浏览器下载不支持的保留字符。
     *
     * @param {string} fileName
     * @returns {string}
     */
    function normalizeDownloadFileName(fileName = '') {
        const raw = String(fileName || '').trim() || `download_${Date.now()}.jpg`;
        return raw
            .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
            .replace(/\s+/g, ' ')
            .replace(/\.+$/g, '')
            .trim() || `download_${Date.now()}.jpg`;
    }

    /**
     * 触发浏览器本地下载。
     *
     * 设计说明：
     * 1. 优先使用 Tampermonkey 的 GM_download，批量下载时稳定性更好；
     * 2. 若当前环境未注入 GM_download，或对 blob URL 处理失败，则回退到原生 <a download>；
     * 3. 本地下载模式不依赖 Eagle，因此这条链路必须可独立运行。
     *
     * @param {string} url
     * @param {string} fileName
     * @returns {Promise<void>}
     */
    async function triggerLocalDownload(url, fileName, options = {}) {
        const safeName = normalizeDownloadFileName(fileName);
        const saveAs = options.saveAs === true;

        // 优先走 GM_download，避免某些浏览器对批量 anchor 下载做更严格的拦截。
        if (typeof GM_download === 'function') {
            try {
                await new Promise((resolve, reject) => {
                    GM_download({
                        url,
                        name: safeName,
                        saveAs,
                        onload: () => resolve(),
                        onerror: (err) => reject(new Error(`GM_download 失败: ${err?.error || err?.details || 'unknown error'}`)),
                        ontimeout: () => reject(new Error('GM_download 超时')),
                    });
                });
                return;
            } catch (err) {
                Log.warn(`GM_download 失败，回退到原生下载: ${safeName} | ${err.message}`);
            }
        }

        // 兜底方案：使用原生 download 属性触发下载。
        await new Promise((resolve) => {
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = safeName;
            anchor.rel = 'noopener';
            anchor.style.display = 'none';
            document.body.appendChild(anchor);
            anchor.click();
            setTimeout(() => {
                anchor.remove();
                resolve();
            }, 180);
        });
    }

    /**
     * 将已拿到的 Blob 保存为本地文件。
     *
     * 为什么不直接依赖远程 URL：
     * - E-Hentai / ExHentai 原图链接依赖当前会话；
     * - 某些站点需要带 Referer / Cookie 才能拿到真图；
     * - 因此一旦前面已成功拿到 Blob，就应该复用这份“已确认可用”的图片数据直接落盘。
     *
     * @param {Blob} blob
     * @param {string} fileName
     * @returns {Promise<void>}
     */
    async function saveBlobLocally(blob, fileName, directoryHandle = null, options = {}) {
        if (!(blob instanceof Blob)) {
            throw new Error('保存本地失败：blob 无效');
        }

        // 用户在面板中明确选定目录后，优先直接写入该目录。
        // 没有选择时仍使用浏览器 / Tampermonkey 的默认下载目录，保持原有可靠的下载链路。
        if (directoryHandle) {
            const safeName = normalizeDownloadFileName(fileName);
            const fileHandle = await directoryHandle.getFileHandle(safeName, { create: true });
            const writable = await fileHandle.createWritable();
            try {
                await writable.write(blob);
            } finally {
                await writable.close();
            }
            return;
        }

        const objectUrl = URL.createObjectURL(blob);
        try {
            await triggerLocalDownload(objectUrl, fileName, options);
        } finally {
            setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
        }
    }
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 在一个时间区间内随机等待。
     * 这样比固定间隔更像正常用户操作，可略微降低被频率规则命中的概率。
     *
     * @param {number} minMs
     * @param {number} maxMs
     * @returns {Promise<void>}
     */
    function sleepRandom(minMs, maxMs) {
        const safeMin = Math.max(0, Number(minMs) || 0);
        const safeMax = Math.max(safeMin, Number(maxMs) || safeMin);
        const delay = safeMin + Math.random() * (safeMax - safeMin);
        return sleep(delay);
    }

    /**
     * 检测 E-Hentai 返回内容中是否包含“请求过快 / 配额受限 / 临时限制”提示。
     *
     * 注意：
     * - 不依赖某一条完全固定的英文句子；
     * - 只要命中一批常见关键词，就给出统一的友好提示；
     * - 这样即使站点文案稍有调整，也仍有较大概率识别出来。
     *
     * @param {string} source
     * @returns {string} 若检测到限制，返回适合显示给用户的短提示；否则返回空字符串
     */
    function detectEHentaiRateLimitWarning(source) {
        const text = String(source || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!text) return '';

        const patterns = [
            /too many requests/i,
            /request(?:ing)?\s+images?\s+too\s+quickly/i,
            /temporarily restricted/i,
            /temporarily banned/i,
            /image viewing limits?/i,
            /download(?:ing)?\s+too\s+many\s+pages?/i,
            /resampled\s+images?/i,
            /unlock(?:ed)?\s+your\s+quota/i,
            /current ip address/i,
        ];

        if (!patterns.some(pattern => pattern.test(text))) {
            return '';
        }

        return '检测到站点正在限制访问频率，当前可能只能返回低清图或限制页。建议降低速度、减少连续全量采集，必要时等待配额恢复后再继续。';
    }

    /**
     * 获取页面中某个元素的文本内容
     * @param {string} selector - CSS 选择器
     * @param {Document} doc - 文档对象（默认当前 document）
     * @returns {string|null}
     */
    function getTextContent(selector, doc = document) {
        const el = doc.querySelector(selector);
        return el ? el.textContent.trim() : null;
    }

    /**
     * 检测当前域名对应的站点 key
     */
    function getSiteKey() {
        const hostname = window.location.hostname;
        for (const [key, config] of Object.entries(SITE_RULES)) {
            if (config.hostnames && config.hostnames.includes(hostname)) {
                return key;
            }
        }
        return null;
    }

    /**
     * 将 Eagle 文件夹树拍平成列表，方便填充到下拉框中。
     * @param {Array} folders
     * @param {number} depth
     * @returns {Array<{id:string,name:string,depth:number,raw:any}>}
     */
    function flattenFolders(folders = [], depth = 0) {
        const result = [];
        for (const folder of folders) {
            result.push({
                id: folder.id,
                name: folder.name,
                depth,
                raw: folder,
            });
            if (folder.children && folder.children.length > 0) {
                result.push(...flattenFolders(folder.children, depth + 1));
            }
        }
        return result;
    }

    /**
     * 在 Eagle 文件夹树中查找指定文件夹的祖先路径。
     * 返回结果包含目标文件夹自身，适合用于“自动展开选中项的父级目录”。
     *
     * @param {Array} folders
     * @param {string} targetId
     * @param {string[]} trail
     * @returns {string[]|null}
     */
    function findFolderPathById(folders = [], targetId = '', trail = []) {
        for (const folder of folders) {
            const nextTrail = trail.concat(folder.id);
            if (folder.id === targetId) {
                return nextTrail;
            }
            if (folder.children && folder.children.length > 0) {
                const found = findFolderPathById(folder.children, targetId, nextTrail);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * 将用户输入的标签文本解析成标签数组。
     * 支持中文逗号、英文逗号、换行分隔。
     * @param {string} text
     * @returns {string[]}
     */
    function parseTagsInput(text) {
        return String(text || '')
            .split(/[\n,，]/)
            .map(tag => tag.trim())
            .filter(Boolean);
    }

    /**
     * 合并多个标签数组，并去重、过滤空值。
     * @param {...Array<string>} lists
     * @returns {string[]}
     */
    function mergeTags(...lists) {
        const set = new Set();
        for (const list of lists) {
            if (!Array.isArray(list)) continue;
            for (const item of list) {
                const tag = String(item || '').trim();
                if (tag) set.add(tag);
            }
        }
        return Array.from(set);
    }

    /**
     * 获取 Fab 当前商品名称信息：
     * - originalName: 原始名称（优先 document.title）
     * - localizedName: 当前页面可见标题（用户浏览器翻译后通常为中文）
     * - folderName: 自动建目录时使用的推荐名称
     *
     * @returns {{ originalName: string, localizedName: string, folderName: string }}
     */
    function getFabListingNames() {
        /*
         * 取名优先级必须以「页面实时渲染的内容」为准：
         * Fab 是 SPA，站内跳转不刷新页面，og:title / twitter:title 仍是
         * 首屏 SSR 注入的旧值（首页通常是站点名 "Fab"），document.title
         * 也可能尚未被前端更新——此前 meta 优先导致目录名总是 "Fab"。
         * 因此 h1 > JSON-LD Product.name > meta/title 兜底；
         * 所有来源统一剔除 "| Fab" / "Fab |" 站名段后再使用。
         */
        const pickTitle = (raw) => {
            const parts = String(raw || '').split('|').map(p => p.trim()).filter(Boolean);
            if (parts.length === 0) return '';
            const meaningful = parts.filter(p => p.toLowerCase() !== 'fab');
            return (meaningful[0] || parts[0] || '').trim();
        };

        const heading = document.querySelector('h1');
        const headingText = heading ? heading.textContent.trim() : '';

        let originalName = pickTitle(headingText);

        if (!originalName) {
            // JSON-LD 商品名与页面内容同步渲染，可靠性高于 meta 标签
            try {
                const product = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
                    .map(s => { try { return JSON.parse(s.textContent); } catch (e) { return null; } })
                    .find(j => j && j['@type'] === 'Product' && j.name);
                if (product) originalName = pickTitle(product.name);
            } catch (e) { /* JSON-LD 解析失败时走兜底来源 */ }
        }

        if (!originalName) {
            originalName = pickTitle(
                document.querySelector('meta[property="og:title"]')?.getAttribute('content')
                || document.querySelector('meta[name="twitter:title"]')?.getAttribute('content')
                || document.title
            );
        }

        const localizedName = headingText;
        const hasChinese = /[\u4e00-\u9fff]/.test(localizedName);
        let folderName = originalName || localizedName || 'Fab Listing';
        if (hasChinese && localizedName && localizedName !== originalName) {
            folderName = `${originalName}｜${localizedName}`;
        }

        return {
            originalName,
            localizedName,
            folderName,
        };
    }

    /**
     * 判断文本是否已经包含中文。
     * Fab 默认返回英文标题；如果页面被浏览器翻译过，则 h1 可能已经是中文，
     * 这种情况直接复用页面翻译结果，不再额外请求翻译服务。
     */
    function hasChineseText(text) {
        return /[\u3400-\u9fff]/.test(String(text || ''));
    }

    /**
     * 通过轻量公开翻译接口补齐 Fab 商品中文名。
     * - 只发送公开商品标题，不发送用户信息或 Eagle 数据；
     * - 结果写入 Tampermonkey 缓存，之后再次采集同一标题不重复请求；
     * - 双源回退：mymemory 为主，Google 公开接口为备；
     * - 两个源都失败时返回空字符串，目录仍使用英文原名，不阻断采集。
     */
    async function translateFabTitleToChinese(sourceText) {
        const source = String(sourceText || '').trim();
        if (!source || hasChineseText(source)) return '';

        const cacheKey = `eagle.fab.title.zh.${source}`;
        try {
            const cached = await GM_getValue(cacheKey, '');
            if (cached && hasChineseText(cached)) return String(cached).trim();
        } catch (err) {
            Log.debug('读取 Fab 中文标题缓存失败:', err?.message || err);
        }

        /*
         * mymemory 免费接口会被限流，部分网络环境也访问不到它；
         * 失败时改走 Google 翻译公开接口（能访问 fab.com 的网络通常也能访问它）。
         * 任一源拿到含中文的有效译文即采用并写缓存。
         */
        const translated = await translateViaMyMemory(source) || await translateViaGoogle(source);
        if (translated && hasChineseText(translated) && translated.toLowerCase() !== source.toLowerCase()) {
            try { await GM_setValue(cacheKey, translated); } catch (err) {
                Log.debug('保存 Fab 中文标题缓存失败:', err?.message || err);
            }
            return translated;
        }
        Log.warn('Fab 标题翻译失败（两个翻译源均不可用），目录将使用纯英文名');
        return '';
    }

    /** 翻译源 1：mymemory 公开接口。任何失败一律返回空串，交由上层回退。 */
    function translateViaMyMemory(source) {
        return new Promise(resolve => {
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(source)}&langpair=en|zh-CN`;
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 12000,
                onload: response => {
                    try {
                        if (!(response.status >= 200 && response.status < 300)) {
                            resolve('');
                            return;
                        }
                        const data = JSON.parse(response.responseText || '{}');
                        // 超限时接口会在 translatedText 里塞英文警告文案，需过滤
                        const translated = String(data?.responseData?.translatedText || '').trim();
                        resolve(hasChineseText(translated) ? translated : '');
                    } catch (err) {
                        Log.debug('解析 mymemory 结果失败:', err?.message || err);
                        resolve('');
                    }
                },
                onerror: () => resolve(''),
                ontimeout: () => resolve(''),
            });
        });
    }

    /**
     * 翻译源 2：Google 翻译公开接口（gtx）。
     * 返回形如 [[["译文","原文",...],...],...]，需要拼接各分段的译文。
     */
    function translateViaGoogle(source) {
        return new Promise(resolve => {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(source)}`;
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 10000,
                onload: response => {
                    try {
                        if (!(response.status >= 200 && response.status < 300)) {
                            resolve('');
                            return;
                        }
                        const data = JSON.parse(response.responseText || '[]');
                        const segments = Array.isArray(data?.[0]) ? data[0] : [];
                        const translated = segments.map(seg => String(seg?.[0] || '')).join('').trim();
                        resolve(hasChineseText(translated) ? translated : '');
                    } catch (err) {
                        Log.debug('解析 Google 翻译结果失败:', err?.message || err);
                        resolve('');
                    }
                },
                onerror: () => resolve(''),
                ontimeout: () => resolve(''),
            });
        });
    }

    /**
     * 异步生成 Fab 自动目录名。
     * 英文原名 + 中文译名使用全角竖线“｜”分隔，便于 Eagle 中检索和排序。
     */
    async function getFabListingNamesAsync() {
        let names = getFabListingNames();
        /*
         * 点击「开始采集」时标题可能尚未渲染完成（SPA 刚跳转、页面加载中）。
         * 取不到商品名时短暂等待重试，避免用过期标题或 "Fab" 站点名建目录。
         */
        for (let i = 0; i < 4 && !names.originalName; i++) {
            await sleep(500);
            names = getFabListingNames();
        }
        const source = names.originalName || names.localizedName || 'Fab Listing';
        if (hasChineseText(names.localizedName) && names.localizedName !== source) {
            return { ...names, folderName: `${source}｜${names.localizedName}`, translationFailed: false };
        }

        const translated = await translateFabTitleToChinese(source);
        return {
            ...names,
            localizedName: translated || names.localizedName,
            folderName: translated ? `${source}｜${translated}` : source,
            // 两个翻译源都失败时带上标志，调用方在状态栏给出可见提示
            translationFailed: !translated && !hasChineseText(names.localizedName),
        };
    }

    /**
     * 将任意文本清洗成更适合当文件名的片段。
     * - 保留中文、英文、数字、下划线、短横线
     * - 合并多余空白 / 特殊符号
     * - 控制长度，避免文件名过长
     *
     * @param {string} text
     * @param {number} maxLength
     * @returns {string}
     */
    function sanitizeFileBaseName(text, maxLength = 48) {
        const safe = String(text || '')
            .trim()
            .replace(/[\\/:*?"<>|]+/g, ' ')
            .replace(/\s+/g, '_')
            .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');

        if (!safe) return 'untitled';
        return safe.slice(0, maxLength);
    }

    /**
     * 提取 Fab 当前 listing 的唯一 ID。
     * 典型 URL:
     *   https://www.fab.com/listings/0667e321-31a7-40ed-b85c-6db5bbc4366b
     *
     * @returns {string}
     */
    function getFabListingId() {
        const match = String(window.location.pathname || '').match(/\/listings\/([^/?#]+)/i);
        return match ? match[1] : 'listing';
    }

    /**
     * 根据 MIME 类型或源链接推断文件扩展名。
     * @param {string} mimeType
     * @param {string} sourceUrl
     * @returns {string}
     */
    function inferFileExtension(mimeType = '', sourceUrl = '') {
        const mime = String(mimeType || '').toLowerCase();
        const mimeMap = {
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif',
            'image/bmp': 'bmp',
            'image/avif': 'avif',
        };
        if (mimeMap[mime]) return mimeMap[mime];

        try {
            const rawName = decodeURIComponent(new URL(sourceUrl, window.location.href).pathname.split('/').pop() || '');
            const extMatch = rawName.match(/\.([a-z0-9]+)$/i);
            if (extMatch) return extMatch[1].toLowerCase();
        } catch (err) {
            // ignore
        }

        return 'jpg';
    }

    /**
     * 为 Fab 商品图生成规则化文件名。
     *
     * 当前规则：
     *   fab_{商品名片段}_{listing短ID}_m{序号}.{ext}
     *
     * 示例：
     *   fab_模块化科幻空间站_0667e321_m0001.jpg
     *
     * @param {{index:number, sourceUrl:string, mimeType:string}} options
     * @returns {string}
     */
    function buildFabFileName(options = {}) {
        const { originalName, localizedName } = options.listingNames || getFabListingNames();
        const listingId = getFabListingId();
        const shortId = listingId.slice(0, 8) || 'listing';
        const titleBase = sanitizeFileBaseName(localizedName || originalName || 'Fab_Listing', 40);
        const ext = inferFileExtension(options.mimeType, options.sourceUrl);
        const mediaIndex = String((options.index || 0) + 1).padStart(4, '0');

        return `fab_${titleBase}_${shortId}_m${mediaIndex}.${ext}`;
    }

    // ╔══════════════════════════════════════════════════════════════╗
    // ║         4. Eagle 本地 API 客户端                             ║
    // ║   Eagle 启动后会在 localhost:41595 提供 HTTP API             ║
    // ║   使用 GM_xmlhttpRequest 绕过 CORS 跨域限制                  ║
    // ╚══════════════════════════════════════════════════════════════╝

    const EagleAPI = {
        BASE_URL: 'http://localhost:41595',
        tagCatalogCache: null,

        /**
         * 通用 GM_xmlhttpRequest Promise 封装
         * @param {object} opts - { method, path, data, headers }
         */
        _request(opts) {
            return new Promise((resolve, reject) => {
                const url = `${this.BASE_URL}${opts.path}`;
                /*
                 * Content-Type 用 text/plain 而不是 application/json：
                 * Eagle 服务端不校验 Content-Type，JSON body 照常解析；
                 * 而 text/plain 的 POST 属于 CORS「简单请求」，不触发预检。
                 * Eagle 的 HTTP API 对 OPTIONS 预检一律返回 405，一旦脚本
                 * 管理器把请求退化为页面级 fetch（TM 重装/授权变化后可能出现），
                 * 预检失败会让浏览器直接拦截请求，面板表现为「Eagle 未运行」。
                 */
                const reqParams = {
                    method: opts.method || 'GET',
                    url: url,
                    headers: Object.assign({ 'Content-Type': 'text/plain' }, opts.headers || {}),
                    timeout: opts.timeout || 5000,   // 5 秒超时（避免 Eagle 未运行时长时间阻塞）
                    onload: (resp) => {
                        try {
                            if (!(resp.status >= 200 && resp.status < 300)) {
                                reject(new Error(`Eagle API HTTP ${resp.status}: ${resp.statusText || resp.responseText || 'request failed'}`));
                                return;
                            }
                            const data = JSON.parse(resp.responseText);
                            if (data && data.status && data.status !== 'success') {
                                reject(new Error(`Eagle API error: ${data.message || data.code || 'unknown error'}`));
                                return;
                            }
                            resolve(data);
                        } catch (e) {
                            resolve(resp.responseText);
                        }
                    },
                    onerror: (err) => reject(new Error(`Eagle API 请求失败: ${url}`)),
                    ontimeout: () => reject(new Error(`Eagle API 请求超时: ${url}`)),
                };
                if (opts.data) {
                    reqParams.data = typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data);
                }
                // 使用 GM_xmlhttpRequest 发送跨域请求
                GM_xmlhttpRequest(reqParams);
            });
        },

        /**
         * 检查 Eagle 是否在运行
         * @returns {Promise<boolean>}
         */
        async checkAlive() {
            // 不把单一应用信息接口当成唯一判据：部分 Eagle/脚本管理器组合下，
            // /api/application/info 可能偶发超时，但目录和标签接口仍然可用。
            const infoPaths = ['/api/application/info', '/api/v2/app/info'];
            const infoResults = await Promise.all(infoPaths.map(async path => {
                try {
                    return await this._request({ path, timeout: 8000 });
                } catch (err) {
                    Log.debug('Eagle 状态检测失败:', path, err?.message || err);
                    return null;
                }
            }));
            if (infoResults.some(result => result && result.data)) return true;

            // 应用信息接口失败时，用实际业务接口做兜底探测。即使目录为空，
            // 只要 API 返回了合法数组，也说明 Eagle 已启动并可通信。
            const probePaths = [
                '/api/folder/list',
                '/api/v2/tag/get?offset=0&limit=1',
                '/api/tag/list',
            ];
            const probeResults = await Promise.all(probePaths.map(async path => {
                try {
                    return await this._request({ path, timeout: 8000 });
                } catch (err) {
                    Log.debug('Eagle 业务接口探测失败:', path, err?.message || err);
                    return null;
                }
            }));
            return probeResults.some(result => {
                if (Array.isArray(result?.data)) return true;
                return Array.isArray(result?.data?.data);
            });
        },

        /**
         * 获取 Eagle 文件夹列表
         * @returns {Promise<Array<{id: string, name: string}>>}
         */
        async getFoldersWithStatus() {
            try {
                const result = await this._request({ path: '/api/folder/list', timeout: 8000 });
                return {
                    ok: Array.isArray(result?.data),
                    folders: Array.isArray(result?.data) ? result.data : [],
                };
            } catch (e) {
                Log.error('获取文件夹列表失败:', e.message);
                return { ok: false, folders: [] };
            }
        },

        async getFolders() {
            const result = await this.getFoldersWithStatus();
            return result.folders;
        },

        /**
         * 创建 Eagle 文件夹（Eagle 4.x Web API v2）。
         * 当前项目里主要用于 Fab 商品采集时自动按“原名 + 中文名”建目录。
         *
         * @param {string} name - 文件夹名称
         * @param {string} parentFolderId - 父文件夹 ID；为空时创建在 Eagle 根目录
         * @returns {Promise<{id:string,name:string}>}
         */
        async createFolder(name, parentFolderId = '') {
            /**
             * Eagle Web API 的稳定目录创建接口使用 folderName / parent。
             * 旧实现调用 /api/v2/folder/create 并传 name，会始终在顶层建目录，
             * 因而用户手动选择的目标目录不会成为商品目录的父目录。
             */
            const payload = {
                folderName: name,
                parent: parentFolderId || undefined,
            };
            const result = await this._request({
                method: 'POST',
                path: '/api/folder/create',
                data: payload,
            });
            return result.data;
        },

        /** 将已有目录改名；用于把旧版创建的英文 Fab 目录升级为“英文｜中文”。 */
        async renameFolder(folderId, newName) {
            const id = String(folderId || '').trim();
            const name = String(newName || '').trim();
            if (!id || !name) throw new Error('Eagle 目录重命名参数不完整');
            const result = await this._request({
                method: 'POST',
                path: '/api/folder/rename',
                data: { folderId: id, newName: name },
                timeout: 8000,
            });
            return result?.data !== false;
        },

        /**
         * 将 options 中的文件夹参数统一整理成去重后的数组。
         *
         * 兼容两种传法：
         * 1. folderId: 'xxx'
         * 2. folders: ['xxx', 'yyy']
         *
         * @param {object} options
         * @returns {string[]}
         */
        _normalizeFolderIds(options = {}) {
            const folderIds = Array.isArray(options.folders)
                ? options.folders
                : (options.folderId ? [options.folderId] : []);

            return Array.from(new Set(folderIds.filter(Boolean)));
        },

        /**
         * 在 item/add 返回后，尽量确认目标文件夹真的已经写入到条目中。
         *
         * 这里优先走“按返回的 item id 直接查询”：
         * - 对 URL 直传模式，这一步通常非常快，也最稳定；
         * - 对 base64 导入模式，如果刚返回时条目尚未落库，再回退到 url 查询。
         *
         * 注意：
         * 1. Eagle 的“素材来源网址”字段对应 item.url；
         * 2. 对于远程 URL 导入，我们通常会把 item.url 保存成商品页面，而不是原始图片 CDN；
         * 3. 因此 fallback 查询时，必须查“website / lookupUrl”，不能盲目查图片源地址。
         *
         * @param {object} options
         * @param {string} options.itemId
         * @param {string[]} options.folderIds
         * @param {string} options.fileName
         * @param {string} options.lookupUrl
         * @param {string} options.annotation
         * @returns {Promise<boolean>}
         */
        async _ensureItemFolders(options = {}) {
            const itemId = String(options.itemId || '').trim();
            const folderIds = Array.isArray(options.folderIds) ? options.folderIds.filter(Boolean) : [];
            const fileName = String(options.fileName || '').trim();
            const lookupUrl = String(options.lookupUrl || '').trim();
            const annotation = String(options.annotation || '').trim();

            if (folderIds.length === 0) return true;

            const updateFoldersByItem = async (item) => {
                if (!item || !item.id) return false;

                const currentFolders = Array.isArray(item.folders) ? item.folders.filter(Boolean) : [];
                const nextFolders = Array.from(new Set([...currentFolders, ...folderIds]));

                // 如果当前条目已经包含所有目标文件夹，就不再重复更新。
                const missingFolders = folderIds.filter(id => !currentFolders.includes(id));
                if (missingFolders.length === 0) {
                    return true;
                }

                const updateResult = await this._request({
                    method: 'POST',
                    path: '/api/v2/item/update',
                    data: {
                        id: item.id,
                        folders: nextFolders,
                    },
                });

                return !!(updateResult && updateResult.data !== false);
            };

            // 第一优先级：如果 item/add 已返回 id，则直接轮询这个 id。
            if (itemId) {
                for (let attempt = 1; attempt <= 8; attempt++) {
                    try {
                        const itemInfo = await this._request({
                            method: 'POST',
                            path: '/api/v2/item/get',
                            data: { id: itemId },
                        });

                        const matched = Array.isArray(itemInfo?.data?.data) ? itemInfo.data.data[0] : null;
                        if (!matched || !matched.id) {
                            await sleep(500);
                            continue;
                        }

                        const done = await updateFoldersByItem(matched);
                        if (done) return true;
                    } catch (err) {
                        // 继续重试，兼容 Eagle 异步入库时的短暂查不到。
                    }

                    await sleep(500);
                }
            }

            // 第二优先级：按“素材来源网址”回查，再结合文件名 / 注释精确匹配。
            if (lookupUrl) {
                for (let attempt = 1; attempt <= 10; attempt++) {
                    try {
                        const itemInfo = await this._request({
                            method: 'POST',
                            path: '/api/v2/item/get',
                            data: {
                                url: lookupUrl,
                                limit: 20,
                            },
                        });

                        const candidates = Array.isArray(itemInfo?.data?.data) ? itemInfo.data.data : [];
                        const matched =
                            candidates.find(item => item.name === fileName && item.annotation === annotation)
                            || candidates.find(item => item.name === fileName)
                            || candidates[0]
                            || null;

                        if (!matched || !matched.id) {
                            await sleep(800);
                            continue;
                        }

                        const done = await updateFoldersByItem(matched);
                        if (done) return true;
                    } catch (err) {
                        // 继续重试
                    }

                    await sleep(800);
                }
            }

            return false;
        },

        /**
         * 通过 base64 数据向 Eagle 添加图片
         * @param {string} base64Data - base64 编码的图片数据，可带或不带 data: 前缀
         * @param {string} fileName - 文件名（含后缀，如 "image_001.jpg"）
         * @param {object} options - { folderId, tags, annotation, website }
         * @returns {Promise<object>} API 响应
         */
        async addFromBase64(base64Data, fileName, options = {}) {
            const folderIds = this._normalizeFolderIds(options);
            const mimeType = String(options.mimeType || 'image/jpeg').trim() || 'image/jpeg';
            const rawBase64 = String(base64Data || '').trim();
            if (!rawBase64) {
                throw new Error(`Eagle 导入失败：${fileName} 的 base64 数据为空`);
            }

            // Eagle 4.x 的 item/add 对“纯 base64 字符串”会返回成功 id，
            // 但实际不会完成入库；必须传完整 data URI 才能稳定触发图片解析。
            const dataUri = /^data:[^,]+,/i.test(rawBase64)
                ? rawBase64
                : `data:${mimeType};base64,${rawBase64.replace(/^data:[^,]+,/i, '')}`;

            const payload = {
                base64: dataUri,
                name: fileName,
                website: options.website || window.location.href,
                tags: options.tags || [],
                folders: folderIds,
                annotation: options.annotation || '',
            };

            const uploadTimeout = Math.min(180000, Math.max(45000, Math.ceil(String(payload.base64 || '').length / 1024 / 1024) * 30000));
            const result = await this._request({
                method: 'POST',
                path: '/api/v2/item/add',
                data: payload,
                // E-Hentai ??? base64 ???????Eagle ????????????? 5 ??
                // ?????? 45~180 ????????????? Eagle ????????????
                timeout: uploadTimeout,
            });

            // API 返回 success 只代表请求已被 Eagle 接收；轮询 item/get，
            // 确认素材真的落库后，界面才允许把这一张计入“成功”。
            const createdItemId = result && result.data && result.data.id;
            let importedItem = null;
            if (createdItemId) {
                for (let attempt = 1; attempt <= 12; attempt++) {
                    try {
                        const itemInfo = await this._request({
                            method: 'POST',
                            path: '/api/v2/item/get',
                            data: { id: createdItemId },
                            timeout: 10000,
                        });
                        importedItem = Array.isArray(itemInfo?.data?.data) ? itemInfo.data.data[0] : null;
                        if (importedItem && importedItem.id) break;
                    } catch (verifyErr) {
                        // Eagle 正在异步解析图片时，短暂查不到属于正常情况。
                    }
                    await sleep(750);
                }
            }

            if (!importedItem || !importedItem.id) {
                throw new Error(`Eagle 已接受请求但未完成入库: ${fileName}`);
            }

            /**
             * 关键兼容修复：
             * 经本地实测，Eagle v2 的 item/add 虽然支持传 folders，
             * 但实际导入后，部分情况下 folders 字段并不会真正写入项目。
             *
             * 因此这里增加一个“二次兜底”：
             * 1. 先 item/add 导入图片
             * 2. 如果返回了 item id，且本次确实指定了 folderIds
             * 3. 再额外调用一次 item/update，把 folders 强制写进去
             *
             * 这样可以稳定解决：
             * - 图片进了 Eagle
             * - 但仍然留在“未分类 / 根目录”
             * - 没有真正进入目标文件夹
             */
            // item/add 已经携带 folders；文件夹二次确认属于慢路径，仅在显式要求时执行。
            if (folderIds.length > 0 && options.verifyFolders === true && options.deferFolderBinding !== true) {
                try {
                    const updateApplied = await this._ensureItemFolders({
                        itemId: createdItemId,
                        folderIds,
                        fileName,
                        lookupUrl: options.lookupUrl || options.website || window.location.href,
                        annotation: options.annotation || '',
                    });

                    if (!updateApplied) {
                        Log.warn(`导入成功，但文件夹绑定未确认生效: ${fileName} | lookup=${options.lookupUrl || options.website || window.location.href}`);
                    }
                } catch (updateErr) {
                    Log.warn(`导入成功，但写入文件夹失败: ${fileName} | ${updateErr.message}`);
                }
            }

            return result;
        },

        /**
         * 通过“远程图片 URL”直接让 Eagle 自己下载并导入。
         *
         * 这个方法主要给 Fab 使用：
         * 1. Fab 图片 URL 通常是公开可访问的；
         * 2. 不需要浏览器 Cookie；
         * 3. 因此没必要再走“浏览器下载 blob -> base64 -> 上传给 Eagle”的慢链路。
         *
         * 这样可以显著降低：
         * - 浏览器内存占用
         * - base64 膨胀带来的传输成本
         * - Eagle 长时间卡在“正在添加文件... 0/N”的概率
         *
         * @param {string} remoteUrl - 图片真实下载地址
         * @param {string} fileName - 保存到 Eagle 的规则化文件名
         * @param {object} options - { folderId, folders, tags, annotation, website, lookupUrl }
         * @returns {Promise<object>}
         */
        async addFromRemoteURL(remoteUrl, fileName, options = {}) {
            const folderIds = this._normalizeFolderIds(options);
            const payload = {
                url: remoteUrl,
                name: fileName,
                website: options.website || window.location.href,
                tags: options.tags || [],
                folders: folderIds,
                annotation: options.annotation || '',
            };

            const result = await this._request({
                method: 'POST',
                path: '/api/v2/item/add',
                data: payload,
                timeout: 90000,
            });

            const createdItemId = result && result.data && result.data.id;
            // Fab 远程 URL 导入优先保证吞吐；需要严格确认目录时再传 verifyFolders=true。
            if (folderIds.length > 0 && options.verifyFolders === true && options.deferFolderBinding !== true) {
                try {
                    const updateApplied = await this._ensureItemFolders({
                        itemId: createdItemId,
                        folderIds,
                        fileName,
                        lookupUrl: options.lookupUrl || options.website || window.location.href,
                        annotation: options.annotation || '',
                    });

                    if (!updateApplied) {
                        Log.warn(`URL 导入成功，但文件夹绑定未确认生效: ${fileName} | lookup=${options.lookupUrl || options.website || window.location.href}`);
                    }
                } catch (updateErr) {
                    Log.warn(`URL 导入成功，但写入文件夹失败: ${fileName} | ${updateErr.message}`);
                }
            }

            return result;
        },

        /**
         * 批量添加图片（逐张调用，避免请求体过大）
         * @param {Array<{base64: string, name: string, options: object}>} items
         * @param {function} onProgress - 进度回调 (current, total)
         * @param {function} shouldPause - 暂停检查回调，返回 true 则暂停
         */
        async addBatch(items, onProgress, shouldPause) {
            const results = { success: 0, failed: [], total: items.length };

            for (let i = 0; i < items.length; i++) {
                // 检查是否需要暂停
                if (shouldPause && shouldPause()) {
                    Log.info('用户暂停，等待恢复...');
                    await this._waitForResume(shouldPause);
                    Log.info('继续执行...');
                }

                const item = items[i];
                try {
                    await this.addFromBase64(item.base64, item.name, item.options);
                    results.success++;
                    Log.info(`已发送到 Eagle (${i + 1}/${items.length}): ${item.name}`);
                } catch (err) {
                    results.failed.push({ index: i, name: item.name, error: err.message });
                    Log.error(`发送失败 (${i + 1}/${items.length}): ${item.name} —— ${err.message}`);
                }

                if (onProgress) onProgress(i + 1, items.length);

                // 请求间添加小延迟，避免给 Eagle 造成压力
                await sleep(200);
            }

            return results;
        },

        /**
         * 获取 Eagle 真实标签及标签分组。
         *
         * 注意：该方法必须属于 EagleAPI。面板只负责调用和渲染；如果误放到 UIPanel，
         * 调用 EagleAPI.getTagCatalog() 时会直接抛出“不是函数”，并被界面误报为 Eagle 未运行。
         */
        async getTagCatalog(force = false) {
            if (!force && this.tagCatalogCache) return this.tagCatalogCache;

            // v2 标签接口单页最多返回 50 条，因此按 total 分页读取完整标签列表。
            // 某些 Eagle 版本不支持该 v2 接口，请求失败或结构异常时回退旧接口。
            let normalizedTagsResult = null;
            try {
                const allTags = [];
                let offset = 0;
                let total = Infinity;
                do {
                    const tagsResult = await this._request({ path: '/api/v2/tag/get?offset=' + offset + '&limit=50' });
                    const page = Array.isArray(tagsResult?.data?.data)
                        ? tagsResult.data.data
                        : (Array.isArray(tagsResult?.data) ? tagsResult.data : []);
                    allTags.push(...page);
                    total = Number(tagsResult?.data?.total || allTags.length);
                    offset += page.length;
                    if (page.length === 0) break;
                } while (offset < total);
                if (allTags.length > 0) normalizedTagsResult = { data: allTags };
            } catch (err) {
                Log.warn('Eagle v2 标签接口不可用，回退旧接口:', err.message);
            }
            if (!normalizedTagsResult) {
                normalizedTagsResult = await this._request({ path: '/api/tag/list' });
            }

            // 标签是主数据；分组读取失败时仍然显示标签，并统一归入“未分组”。
            let groupsResult = null;
            try {
                groupsResult = await this._request({ path: '/api/v2/tagGroup/get?offset=0&limit=500' });
            } catch (err) {
                Log.warn('Eagle 标签分组接口不可用，将按未分组显示:', err.message);
            }

            const tags = Array.isArray(normalizedTagsResult?.data?.data)
                ? normalizedTagsResult.data.data
                : (Array.isArray(normalizedTagsResult?.data) ? normalizedTagsResult.data : []);
            const groups = Array.isArray(groupsResult?.data?.data)
                ? groupsResult.data.data
                : (Array.isArray(groupsResult?.data) ? groupsResult.data : []);
            this.tagCatalogCache = { tags, groups };
            return this.tagCatalogCache;
        },

        /**
         * 等待暂停恢复（每秒检查一次）
         */
        async _waitForResume(shouldPause) {
            while (shouldPause && shouldPause()) {
                await sleep(1000);
            }
        },
    };

    // ╔══════════════════════════════════════════════════════════════╗
    // ║         5. 图片提取引擎 —— 规则提取 & 通用扫描               ║
    // ╚══════════════════════════════════════════════════════════════╝

    const ImageExtractor = {
        /**
         * 通用图片扫描模式 —— 扫描页面所有 img 标签
         * 按最小尺寸过滤，同时提取 CSS background-image
         * @param {object} config - { minWidth, minHeight }
         * @returns {Array<{url: string, width: number, height: number, element: Element}>}
         */
        scanGeneric(config = {}) {
            const minW = config.minWidth || 300;
            const minH = config.minHeight || 200;
            const results = [];
            const urlSet = new Set(); // 用于去重

            // ── 第一步：扫描 <img> 标签 ──
            const imgElements = document.querySelectorAll('img');
            imgElements.forEach(img => {
                const src = img.currentSrc || img.src || img.dataset.src || img.getAttribute('data-src');
                if (!src || urlSet.has(src)) return;

                // 跳过明显的图标和占位图
                if (this._isExcluded(src)) return;

                // 获取图片实际尺寸（naturalWidth/Height 需要图片已加载）
                const w = img.naturalWidth || img.width || img.clientWidth || 0;
                const h = img.naturalHeight || img.height || img.clientHeight || 0;

                // 尺寸过滤：如果已知尺寸且不满足最小值，跳过
                // 但如果 naturalWidth 为 0（图片未加载），也先收集起来
                if (w > 0 && h > 0 && (w < minW || h < minH)) return;

                urlSet.add(src);
                results.push({ url: src, width: w, height: h, element: img, type: 'img' });
            });

            // ── 第二步：扫描 CSS background-image ──
            const allElements = document.querySelectorAll('*');
            allElements.forEach(el => {
                try {
                    const bg = window.getComputedStyle(el).backgroundImage;
                    if (!bg || bg === 'none') return;

                    // 提取 url("...") 中的 URL
                    const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
                    if (!match) return;

                    let bgUrl = match[1];
                    bgUrl = toAbsoluteURL(bgUrl);

                    if (urlSet.has(bgUrl) || this._isExcluded(bgUrl)) return;

                    // 背景图无法获取自然尺寸，但可以通过元素尺寸估算
                    const rect = el.getBoundingClientRect();
                    if (rect.width < minW || rect.height < minH) return;

                    urlSet.add(bgUrl);
                    results.push({ url: bgUrl, width: rect.width, height: rect.height, element: el, type: 'bg' });
                } catch (e) {
                    // 忽略无法访问的元素（如跨域 iframe 内容）
                }
            });

            Log.info(`通用扫描完成: 发现 ${results.length} 张候选图片`);
            return results;
        },

        /**
         * 排除明显的非内容图片 URL
         * @param {string} url - 图片 URL
         */
        _isExcluded(url) {
            const excludedPatterns = [
                /favicon/i, /\.svg(\?|$)/, /logo/i, /icon/i,
                /pixel/i, /tracking/i, /1x1/i, /blank/i,
                /spacer/i, /avatar/i, /emoji/i, /badge/i,
                /data:image\/svg/i, // base64 SVG 图标
            ];
            return excludedPatterns.some(p => p.test(url));
        },

        /**
         * 按 CSS 选择器提取所有匹配元素的指定属性值
         * @param {string} selector - CSS 选择器
         * @param {string} attr - 要提取的属性名（如 'src', 'href'）
         * @param {Document} doc - 文档对象
         * @returns {string[]} 提取到的值列表
         */
        extractBySelector(selector, attr, doc = document) {
            const elements = doc.querySelectorAll(selector);
            const values = [];
            elements.forEach(el => {
                const val = el.getAttribute(attr);
                if (val) values.push(val);
            });
            return values;
        },

        /**
         * 从 E-Hentai 画廊详情页的 HTML 中提取图片查看器链接
         * @param {string} html - 页面 HTML 字符串
         * @returns {{ links: string[], totalCount: number|null }}
         */
        parseGalleryDetailHTML(html) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // 从 #gdt a[href] 提取所有图片入口链接
            const links = [];
            const gdt = doc.querySelector('#gdt');
            if (gdt) {
                const anchors = gdt.querySelectorAll('a[href]');
                anchors.forEach(a => {
                    const href = a.getAttribute('href');
                    if (href) {
                        links.push(toAbsoluteURL(href, window.location.origin));
                    }
                });
            }

            // 尝试从 .gpc 文本获取总数（"Showing X - Y of Z images"）
            // 注意：如果用户开了网页翻译，这段文本可能会被翻译成中文，
            // 所以不能只依赖英文 regex，下面还会再用分页链接做兜底。
            let totalCount = null;
            const gpcEl = doc.querySelector('.gpc');
            if (gpcEl) {
                const match = gpcEl.textContent.match(/of\s+(\d+)\s+images/i);
                if (match) totalCount = parseInt(match[1], 10);
            }

            // 从分页条中提取总页数：
            // 例如最后一页链接常是 ?p=22，则总页数 = 23
            let totalPages = null;
            const pageIndexes = Array.from(doc.querySelectorAll('.ptt a[href], .ptb a[href]'))
                .map(a => {
                    try {
                        const url = new URL(a.getAttribute('href') || a.href, window.location.origin);
                        const p = url.searchParams.get('p');
                        return p === null ? 0 : parseInt(p, 10);
                    } catch (err) {
                        return null;
                    }
                })
                .filter(num => Number.isInteger(num) && num >= 0);

            if (pageIndexes.length > 0) {
                totalPages = Math.max(...pageIndexes) + 1;
            }

            return { links, totalCount, totalPages };
        },

        /**
         * 从 E-Hentai 图片查看器 HTML 中提取原始下载链接
         * @param {string} html - 查看器页面 HTML
         * @returns {{ originalUrl: string|null, fullImageUrl: string|null, pageNum: string|null, totalPages: string|null }}
         */
        parseViewerHTML(html) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // 原始下载链接（Download original）
            // 注意：不能用“最后一个 a”判断，因为翻译插件可能会插入额外节点扰乱结构。
            let originalUrl = extractEHentaiOriginalUrl(doc);

            // 全尺寸 WebP 图片 —— #img 的 src
            let fullImageUrl = null;
            const imgEl = doc.querySelector('#img');
            if (imgEl) {
                fullImageUrl = imgEl.getAttribute('src');
            }

            // 页码信息 "1 / 198"
            let pageNum = null, totalPages = null;
            const snSpan = doc.querySelector('.sn span');
            if (snSpan) {
                // 查询所有 span 元素（.sn 下的所有 span 标签）
                const spans = doc.querySelectorAll('.sn span');
                // 结构通常是: <span>1</span> / <span>198</span>
                const spanTexts = [];
                doc.querySelectorAll('.sn span').forEach(s => spanTexts.push(s.textContent.trim()));
                if (spanTexts.length >= 2) {
                    pageNum = spanTexts[spanTexts.length - 2];  // 倒数第二个
                    totalPages = spanTexts[spanTexts.length - 1]; // 最后一个
                }
            }

            return { originalUrl, fullImageUrl, pageNum, totalPages };
        },

        /**
         * 从 Fab 页面内嵌的 hydration JSON 中提取当前 listing 数据。
         *
         * 关键背景：
         * 1. Fab 商品页并不会把全部大图一次性完整渲染到 DOM；
         * 2. DOM 中往往只能看到首屏 5~6 张缩略图 / 当前主图；
         * 3. 但页面内嵌 JSON 里通常已经包含完整 medias 列表与多种分辨率。
         *
         * 因此 Fab 的主采集链路应该优先走这里，而不是只依赖轮播点击。
         *
         * @returns {object|null}
         */
        getFabListingHydrationData() {
            const listingId = getFabListingId();
            const targetKey = `/i/listings/${listingId}`;
            const scripts = Array.from(document.querySelectorAll('script[type="application/json"]'));

            for (let i = 0; i < scripts.length; i++) {
                const raw = String(scripts[i].textContent || '').trim();
                if (!raw || raw.length < 2) continue;

                /**
                 * 小优化：
                 * 先做字符串级快速过滤，避免把页面里所有 JSON 都完整 JSON.parse。
                 */
                if (
                    !raw.includes(listingId) &&
                    !raw.includes(targetKey) &&
                    !raw.includes('"medias"')
                ) {
                    continue;
                }

                try {
                    const parsed = JSON.parse(raw);
                    const matched = this._findFabListingNode(parsed, listingId, targetKey);
                    if (matched) {
                        Log.info(`Fab hydration 命中 script[${i}]，medias=${Array.isArray(matched.medias) ? matched.medias.length : 0}`);
                        return matched;
                    }
                } catch (err) {
                    // 忽略非目标 JSON，继续尝试下一段 script。
                }
            }

            return null;
        },

        /**
         * 在任意 JSON 对象中递归查找 Fab listing 节点。
         * 优先命中 /i/listings/{id} 这种最稳定的 key；
         * 若页面结构调整，则回退到“uid + medias”特征识别。
         *
         * @param {any} value
         * @param {string} listingId
         * @param {string} targetKey
         * @param {WeakSet<object>} visited
         * @param {number} depth
         * @returns {object|null}
         */
        _findFabListingNode(value, listingId, targetKey, visited = new WeakSet(), depth = 0) {
            if (!value || typeof value !== 'object') return null;
            if (depth > 10) return null;
            if (visited.has(value)) return null;
            visited.add(value);

            if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, targetKey)) {
                const directNode = value[targetKey];
                if (this._isFabListingNode(directNode, listingId)) {
                    return directNode;
                }
            }

            if (this._isFabListingNode(value, listingId)) {
                return value;
            }

            const children = Array.isArray(value) ? value : Object.values(value);
            for (const child of children) {
                if (!child || typeof child !== 'object') continue;
                const matched = this._findFabListingNode(child, listingId, targetKey, visited, depth + 1);
                if (matched) return matched;
            }

            return null;
        },

        /**
         * 判断一个对象是否“像” Fab 当前商品的 listing 数据节点。
         * @param {any} node
         * @param {string} listingId
         * @returns {boolean}
         */
        _isFabListingNode(node, listingId) {
            if (!node || typeof node !== 'object') return false;
            if (!Array.isArray(node.medias) || node.medias.length === 0) return false;

            const uid = String(node.uid || node.id || '');
            if (uid) {
                return uid === listingId;
            }

            /**
             * 兜底策略：
             * 某些结构里可能没有 uid，但会带 title / medias / thumbnails 等字段。
             * 这里不要求 100% 严格，只要具备 listing 的核心结构即可接受。
             */
            return Boolean(node.title || node.name || node.thumbnails);
        },

        /**
         * 解析 srcset，尽量取其中尺寸最大的那个候选图。
         * @param {string} srcset
         * @returns {Array<{url:string,width:number,height:number,size:number,pathHint:string}>}
         */
        _parseFabSrcset(srcset) {
            const results = [];
            const raw = String(srcset || '').trim();
            if (!raw) return results;

            raw.split(',')
                .map(item => item.trim())
                .filter(Boolean)
                .forEach(part => {
                    const bits = part.split(/\s+/).filter(Boolean);
                    const url = bits[0] || '';
                    const descriptor = bits[1] || '';
                    let width = 0;

                    if (/^\d+w$/i.test(descriptor)) {
                        width = parseInt(descriptor, 10) || 0;
                    }

                    if (url) {
                        results.push({
                            url,
                            width,
                            height: 0,
                            size: 0,
                            pathHint: 'srcset',
                        });
                    }
                });

            return results;
        },

        /**
         * 从任意对象节点中提取 URL 候选项。
         *
         * 说明：
         * 某些 Fab 页面里，大图 URL 不一定只放在 media.images 里，
         * 也可能藏在 image/url/src/mediaUrl/originalUrl 等不同字段中。
         * 因此这里做一层宽松提取，把“像图片资源的 URL”都收集起来再统一打分。
         *
         * @param {any} node
         * @param {string} pathHint
         * @param {Array<{url:string,width:number,height:number,size:number,pathHint:string}>} results
         * @param {WeakSet<object>} visited
         * @param {number} depth
         * @returns {Array<{url:string,width:number,height:number,size:number,pathHint:string}>}
         */
        _collectFabUrlCandidates(node, pathHint = '', results = [], visited = new WeakSet(), depth = 0) {
            if (node == null || depth > 4) return results;

            if (typeof node === 'string') {
                const raw = node.trim();
                if (/^(https?:)?\/\//i.test(raw) || /^\/[^/]/.test(raw)) {
                    results.push({
                        url: raw,
                        width: 0,
                        height: 0,
                        size: 0,
                        pathHint,
                    });
                }
                return results;
            }

            if (typeof node !== 'object') return results;
            if (visited.has(node)) return results;
            visited.add(node);

            if (Array.isArray(node)) {
                node.forEach((child, index) => {
                    this._collectFabUrlCandidates(child, `${pathHint}[${index}]`, results, visited, depth + 1);
                });
                return results;
            }

            const width = Number(node.width || node.imageWidth || node.w || 0) || 0;
            const height = Number(node.height || node.imageHeight || node.h || 0) || 0;
            const size = Number(node.size || node.fileSize || 0) || 0;

            for (const [key, value] of Object.entries(node)) {
                const nextPath = pathHint ? `${pathHint}.${key}` : key;

                if (typeof value === 'string') {
                    if (/srcset/i.test(key)) {
                        this._parseFabSrcset(value).forEach(item => {
                            results.push({
                                url: item.url,
                                width: item.width || width,
                                height: item.height || height,
                                size: item.size || size,
                                pathHint: `${nextPath}:${item.pathHint}`,
                            });
                        });
                        continue;
                    }

                    if (
                        /(url|src|href)$/i.test(key) ||
                        /(image|media|preview|original|download|large|full)/i.test(key)
                    ) {
                        const rawUrl = value.trim();
                        if (/^(https?:)?\/\//i.test(rawUrl) || /^\/[^/]/.test(rawUrl)) {
                            results.push({
                                url: rawUrl,
                                width,
                                height,
                                size,
                                pathHint: nextPath,
                            });
                        }
                    }
                } else if (value && typeof value === 'object') {
                    this._collectFabUrlCandidates(value, nextPath, results, visited, depth + 1);
                }
            }

            return results;
        },

        /**
         * 为 Fab 图片候选项打分。
         * 分数越高，越可能是“最终应下载的大图”。
         *
         * @param {{url:string,width:number,height:number,size:number,pathHint:string}} candidate
         * @returns {number}
         */
        _scoreFabUrlCandidate(candidate) {
            const url = String(candidate.url || '').toLowerCase();
            const pathHint = String(candidate.pathHint || '').toLowerCase();
            const width = Number(candidate.width || 0) || 0;
            const height = Number(candidate.height || 0) || 0;
            const size = Number(candidate.size || 0) || 0;

            let score = (width * height) + Math.min(size, 50 * 1024 * 1024) / 32;

            /**
             * 更倾向于真正的大图 / 原图字段。
             *
             * 这次通过本地实际抓包验证发现：
             * - Fab 某些商品页中，media.images[*] 只是 160 / 320 / 640 / 960 / 1280 的预览版本
             * - 而 media.mediaUrl 往往才是真正更大的原图
             *
             * 因此这里对 “精确来自 mediaUrl 字段” 的候选给出最高优先级。
             */
            if (pathHint === 'mediaurl' || /\.mediaurl$/i.test(pathHint)) score += 12000000;
            if (/(originalurl|downloadurl|fullurl|largeurl)/i.test(pathHint)) score += 10000000;
            if (/(original|download|full|large|xl|xlarge|max)/i.test(url)) score += 3000000;
            if (/(original|download|full|large)/i.test(pathHint)) score += 2000000;

            /**
             * 明显的缩略图降权。
             *
             * 注意不要再直接对 URL 中的 “image_previews” 目录名做 preview 降权，
             * 因为 Fab 的原图 / 大图链接本身也常位于该目录下。
             * 否则会把真正可下载的大图全部错误降权。
             */
            if (/(thumb|thumbnail|poster|small|tiny|icon)(?:[._/-]|$)/i.test(url)) score -= 4000000;
            if (/(thumb|thumbnail|preview|poster|small)/i.test(pathHint)) score -= 3000000;

            // URL 中直接带尺寸时，也作为辅助判断。
            const sizeMatches = url.match(/(?:^|[^\d])(\d{2,4})[xX](\d{2,4})(?:[^\d]|$)/g) || [];
            for (const part of sizeMatches) {
                const m = part.match(/(\d{2,4})[xX](\d{2,4})/);
                if (m) {
                    const w = parseInt(m[1], 10) || 0;
                    const h = parseInt(m[2], 10) || 0;
                    score += (w * h) / 2;
                }
            }

            // 太小的图强烈降权，避免把 160x90 / 320x180 缩略图选中。
            if (width > 0 && height > 0 && (width < 700 || height < 500)) {
                score -= 2500000;
            }

            return score;
        },

        /**
         * 从单个 Fab media 节点里选出“最适合下载”的大图 URL。
         *
         * 规则：
         * 1. 不再只盯着 media.images；
         * 2. 会递归扫描 media 对象里所有可能的图片 URL 字段；
         * 3. 再根据分辨率 / 文件大小 / 路径语义综合打分；
         * 4. 这样能尽量避免选到缩略图。
         *
         * @param {object} media
         * @returns {{ url: string, width: number, height: number, size: number } | null}
         */
        pickFabBestMediaVariant(media) {
            if (!media || typeof media !== 'object') return null;

            const rawCandidates = this._collectFabUrlCandidates(media);
            const deduped = new Map();

            rawCandidates.forEach(item => {
                const normalizedUrl = toAbsoluteURL(item.url, window.location.origin);
                if (!normalizedUrl) return;

                const candidate = {
                    url: normalizedUrl,
                    width: Number(item.width || 0) || 0,
                    height: Number(item.height || 0) || 0,
                    size: Number(item.size || 0) || 0,
                    pathHint: item.pathHint || '',
                };

                const existing = deduped.get(normalizedUrl);
                if (!existing) {
                    deduped.set(normalizedUrl, candidate);
                    return;
                }

                // 合并时保留更大的尺寸信息和更丰富的来源提示。
                existing.width = Math.max(existing.width, candidate.width);
                existing.height = Math.max(existing.height, candidate.height);
                existing.size = Math.max(existing.size, candidate.size);
                if ((candidate.pathHint || '').length > (existing.pathHint || '').length) {
                    existing.pathHint = candidate.pathHint;
                }
            });

            const candidates = Array.from(deduped.values());

            if (candidates.length === 0) return null;

            candidates.sort((a, b) => {
                const scoreDiff = this._scoreFabUrlCandidate(b) - this._scoreFabUrlCandidate(a);
                if (scoreDiff !== 0) return scoreDiff;
                const aArea = a.width * a.height;
                const bArea = b.width * b.height;
                if (bArea !== aArea) return bArea - aArea;
                if (b.size !== a.size) return b.size - a.size;
                return String(b.url).length - String(a.url).length;
            });

            Log.debug(
                'Fab media 候选排序:',
                candidates.slice(0, 5).map(item =>
                    `${item.width || 0}x${item.height || 0} | score=${this._scoreFabUrlCandidate(item)} | ${item.pathHint} | ${item.url}`
                ).join('\n')
            );

            return candidates[0];
        },

        /**
         * Fab 主方案：
         * 直接从 hydration JSON 提取完整图片列表，而不是依赖页面缩略图轮播。
         *
         * @returns {Array<{url:string,name:string,index:number,alt:string,width:number,height:number,source:string}>}
         */
        extractFabGalleryEntriesFromHydration() {
            const listingData = this.getFabListingHydrationData();
            if (!listingData || !Array.isArray(listingData.medias)) {
                return [];
            }

            const seenUrls = new Set();
            const entries = [];
            const medias = listingData.medias
                .filter(Boolean)
                .slice()
                .sort((a, b) => {
                    const aPos = Number.isFinite(Number(a.position)) ? Number(a.position) : 999999;
                    const bPos = Number.isFinite(Number(b.position)) ? Number(b.position) : 999999;
                    return aPos - bPos;
                });

            medias.forEach((media, idx) => {
                const mediaType = String(media.type || '').toLowerCase();
                if (mediaType && mediaType !== 'image') {
                    return;
                }

                const best = this.pickFabBestMediaVariant(media);
                if (!best || !best.url) return;
                if (seenUrls.has(best.url)) return;
                seenUrls.add(best.url);

                const mediaIndex = Number.isFinite(Number(media.position)) ? Number(media.position) : idx;
                let resolvedName = '';
                try {
                    resolvedName = decodeURIComponent(new URL(best.url, window.location.href).pathname.split('/').pop() || '');
                } catch (err) {
                    resolvedName = '';
                }

                entries.push({
                    url: best.url,
                    name: resolvedName || `fab_media_${mediaIndex + 1}.jpg`,
                    index: mediaIndex,
                    alt: String(media.name || listingData.title || '').trim(),
                    width: best.width || 0,
                    height: best.height || 0,
                    source: 'hydration',
                });
            });

            return entries.sort((a, b) => a.index - b.index);
        },

        /**
         * 获取 Fab 当前主图信息（DOM 回退模式）。
         *
         * 注意：
         * 这个方法现在只作为“hydration 解析失败后的兜底方案”。
         * 真正的首选方案是 extractFabGalleryEntriesFromHydration。
         *
         * @returns {{ url: string, alt: string, width: number, height: number } | null}
         */
        getFabMainMediaInfo() {
            const allCandidates = Array.from(document.querySelectorAll('img'))
                .map(img => {
                    const url = img.currentSrc || img.src || '';
                    const rect = img.getBoundingClientRect();
                    return {
                        img,
                        url,
                        alt: img.alt || '',
                        width: img.naturalWidth || 0,
                        height: img.naturalHeight || 0,
                        area: Math.max(0, rect.width) * Math.max(0, rect.height),
                    };
                })
                .filter(item => item.url.includes('media.fab.com'));

            if (allCandidates.length === 0) return null;

            /**
             * 关键优化：
             * Fab 的缩略图按钮内部同样包含 media.fab.com 图片，
             * 而且它们的 naturalWidth / naturalHeight 往往与主图接近，
             * 仅按分辨率排序容易误选到缩略图，导致“漏图 / 跳图 / 数量不对”。
             *
             * 因此这里优先筛选：
             * 1. 不在缩略图按钮内
             * 2. 当前可见面积足够大
             * 3. 优先按页面上的显示面积排序，而不是只看自然分辨率
             */
            let candidates = allCandidates.filter(item => (
                item.area >= 90000 &&
                item.width >= 400 &&
                item.height >= 220 &&
                !item.img.closest('[data-media="true"]')
            ));

            // 若当前页面结构有变化，回退到“可见面积最大”的 media 图片，保证兼容性。
            if (candidates.length === 0) {
                candidates = allCandidates.filter(item => item.area > 0);
            }

            candidates.sort((a, b) => {
                // 优先按当前显示面积排序，再按自然分辨率面积排序，主图更稳定。
                const aPixels = a.width * a.height;
                const bPixels = b.width * b.height;
                if (b.area !== a.area) return b.area - a.area;
                if (bPixels !== aPixels) return bPixels - aPixels;
                return String(a.url).localeCompare(String(b.url));
            });

            const best = candidates[0];
            return {
                url: best.url,
                alt: best.alt,
                width: best.width,
                height: best.height,
            };
        },

        /**
         * 获取 Fab 缩略图按钮列表。
         * Fab 的商品媒体缩略图按钮带有稳定的 data-media="true"。
         * aria-label 会随页面语言变化，例如：
         *   - Display media 0
         *   - 显示媒体 0
         *
         * 这比猜 className 更稳，所以优先使用 aria-label。
         *
         * @returns {HTMLButtonElement[]}
         */
        getFabThumbnailButtons() {
            let buttons = Array.from(document.querySelectorAll('button[data-media="true"]'));

            // 兼容旧版 Fab：若没有 data-media，再按“标签末尾是媒体序号”兜底。
            if (buttons.length === 0) {
                buttons = Array.from(document.querySelectorAll('button[aria-label]'))
                    .filter(btn => /(?:display\s+media|显示媒体)\s*\d+\s*$/i.test(btn.getAttribute('aria-label') || ''));
            }

            return buttons
                .sort((a, b) => {
                    const getIndex = (btn) => {
                        const label = btn.getAttribute('aria-label') || '';
                        const match = label.match(/(\d+)\s*$/);
                        return match ? parseInt(match[1], 10) : 999999;
                    };
                    return getIndex(a) - getIndex(b);
                });
        },

        /**
         * 获取 Fab 缩略图横向滚动条容器。
         *
         * 说明：
         * - 某些商品页首屏只渲染前 5~6 个缩略图；
         * - 后续缩略图需要横向滚动后才会继续挂载到 DOM；
         * - 因此这里要找到真正的横向滚动容器，后面才能主动滚动并把所有媒体都扫描出来。
         *
         * @returns {HTMLElement|null}
         */
        getFabThumbnailStrip() {
            const firstBtn = this.getFabThumbnailButtons()[0] || null;
            if (!firstBtn) return null;

            let el = firstBtn.parentElement;
            while (el) {
                const style = window.getComputedStyle(el);
                const canScrollX = el.scrollWidth > el.clientWidth + 8;
                const overflowX = style.overflowX;
                if (canScrollX && (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay')) {
                    return el;
                }
                el = el.parentElement;
            }

            return null;
        },
    };

    // ╔══════════════════════════════════════════════════════════════╗
    // ║        6. E-Hentai 深度扫描引擎                              ║
    // ║   自动翻页收集所有图片入口 → 逐张获取原始大图 → 输出到目标端   ║
    // ╚══════════════════════════════════════════════════════════════╝

    class EHentaiDeepScanner {
        /**
         * @param {object} options
         * @param {object} options.pageConfig - 当前页面的规则配置
         * @param {'eagle'|'local'} options.mode - 当前输出模式
         * @param {string} options.folderId - Eagle 目标文件夹 ID
         * @param {string[]} options.tags - 图片标签列
         * @param {function} options.outputImage - 统一图片输出函数
         * @param {function} options.onProgress - 进度回调 (phase, current, total, message)
         * @param {function} options.shouldPause - 暂停检查回调
         */
        constructor(options = {}) {
            this.pageConfig = options.pageConfig;
            this.mode = options.mode === 'local' ? 'local' : 'eagle';
            this.folderId = options.folderId || '';
            this.tags = options.tags || [];
            this.outputImage = options.outputImage || (async () => {});
            this.onProgress = options.onProgress || (() => {});
            this.shouldPause = options.shouldPause || (() => false);
            this.concurrency = options.concurrency || EHENTAI_RATE_LIMIT.concurrency;
            this.galleryPageDelayMin = options.galleryPageDelayMin || EHENTAI_RATE_LIMIT.galleryPageDelayMin;
            this.galleryPageDelayMax = options.galleryPageDelayMax || EHENTAI_RATE_LIMIT.galleryPageDelayMax;
            this.itemDelayMin = options.itemDelayMin || EHENTAI_RATE_LIMIT.itemDelayMin;
            this.itemDelayMax = options.itemDelayMax || EHENTAI_RATE_LIMIT.itemDelayMax;
            this.isStopped = false;
        }

        /**
         * 执行完整深度扫描
         * 流程：收集所有图片入口 URL → 逐张获取原始大图 → 按模式输出
         * @returns {Promise<{success: number, failed: Array, total: number}>}
         */
        async execute() {
            // ── 阶段 1：收集所有图片入口链接 ──
            this.onProgress('collect', 0, 0, '正在收集图片入口链接...');
            const viewerLinks = await this._collectAllViewerLinks();

            if (this.isStopped) return { success: 0, failed: [], total: 0 };
            if (viewerLinks.length === 0) {
                Log.warn('未找到任何图片入口链接');
                return { success: 0, failed: [], total: 0 };
            }

            Log.info(`收集完成: ${viewerLinks.length} 个图片入口链接`);
            this.onProgress('collect', viewerLinks.length, viewerLinks.length,
                `收集完成: ${viewerLinks.length} 个链接`);

            // ── 阶段 2：逐张获取原始大图并发送 Eagle ──
            return await this._processViewerLinks(viewerLinks);
        }

        /**
         * 阶段 1：自动翻页收集画廊详情页中所有图片入口链接
         * 直接通过 fetch 获取每页 HTML（不跳转页面）
         * @returns {Promise<string[]>} 所有 /s/{token}/{gid}-{n} 链接
         */
        async _collectAllViewerLinks() {
            const allLinks = [];
            let totalCount = null;

            // 先解析当前页获取总图片数
            const firstPageResult = ImageExtractor.parseGalleryDetailHTML(document.documentElement.innerHTML);
            totalCount = firstPageResult.totalCount;
            Log.info(`当前页发现 ${firstPageResult.links.length} 个链接，总图片数: ${totalCount || '未知'}，分页数: ${firstPageResult.totalPages || '未知'}`);

            // 计算总页数（优先用分页条，因为翻译插件可能导致 .gpc 英文文本失效）
            const totalPages = firstPageResult.totalPages || (totalCount ? Math.ceil(totalCount / 20) : 1);
            Log.info(`预计需要遍历 ${totalPages} 页`);

            // 获取当前页面的基础 URL（去掉 ?p= 参数）
            const baseUrl = window.location.href.replace(/\?p=\d+/, '').replace(/\?$/, '');

            // 遍历每一页
            for (let page = 0; page < totalPages; page++) {
                if (this.isStopped) break;
                if (this.shouldPause()) {
                    await EagleAPI._waitForResume(this.shouldPause);
                }

                let html;
                if (page === 0) {
                    // 第一页直接用当前 document
                    html = document.documentElement.innerHTML;
                } else {
                    // 后续页面通过 fetch 获取
                    const pageUrl = `${baseUrl}?p=${page}`;
                    Log.info(`正在获取第 ${page + 1}/${totalPages} 页: ${pageUrl}`);
                    this.onProgress('collect', page, totalPages, `收集链接: 第 ${page + 1}/${totalPages} 页`);

                    try {
                        const response = await fetchWithRetry(pageUrl, {
                            credentials: 'include',
                            headers: { 'User-Agent': navigator.userAgent },
                        }, 3, 2000);
                        html = await response.text();
                    } catch (err) {
                        Log.error(`获取第 ${page + 1} 页失败:`, err.message);
                        continue; // 跳过失败的页，继续下一页
                    }
                }

                const result = ImageExtractor.parseGalleryDetailHTML(html);
                allLinks.push(...result.links);
                Log.info(`第 ${page + 1}/${totalPages} 页: 提取 ${result.links.length} 个链接`);

                // 页面间延迟，避免触发反爬
                if (page < totalPages - 1) {
                    await sleepRandom(this.galleryPageDelayMin, this.galleryPageDelayMax);
                }
            }

            return allLinks;
        }

        /**
         * 阶段 2：处理每个图片入口链接
         * 流程：获取 viewer 页面 HTML → 提取 fullimg URL → fetch 图片 → 按模式输出
         * @param {string[]} viewerLinks - /s/{token}/{gid}-{n} 链接列表
         */
        async _processViewerLinks(viewerLinks) {
            const total = viewerLinks.length;
            const results = { success: 0, failed: [], total };
            let processed = 0;

            // 使用并发队列处理
            const queue = viewerLinks.slice(); // 复制一份
            const workers = [];

            const processOne = async () => {
                while (queue.length > 0 && !this.isStopped) {
                    if (this.shouldPause()) {
                        await EagleAPI._waitForResume(this.shouldPause);
                    }

                    const link = queue.shift();
                    const index = total - queue.length;
                    const pageNum = index; // 简陋的估算，实际页码从 viewer 页面提取更准

                    this.onProgress('process', index, total, `处理中: ${index}/${total}`);

                    try {
                        await this._processSingleLink(link, pageNum);
                        results.success++;
                        processed++;
                        this.onProgress('process', processed, total, `\u5df2\u4fdd\u5b58: ${results.success}/${total}\uff0c\u5931\u8d25: ${results.failed.length}`);
                    } catch (err) {
                        results.failed.push({
                            link,
                            pageNum,
                            error: err.message,
                        });
                        processed++;
                        this.onProgress('process', processed, total, `\u5df2\u4fdd\u5b58: ${results.success}/${total}\uff0c\u5931\u8d25: ${results.failed.length}`);
                        Log.error(`处理失败 (${index}/${total}): ${err.message}`);
                    }

                    // 间隔延迟（避免触发反爬和 Eagle 压力）
                    await sleepRandom(this.itemDelayMin, this.itemDelayMax);
                }
            };

            // 启动并发 worker
            for (let i = 0; i < this.concurrency; i++) {
                workers.push(processOne());
            }

            await Promise.all(workers);

            if (this.isStopped) {
                Log.info('扫描已停止');
            }

            return results;
        }

        /**
         * 处理单个图片入口链接
         * @param {string} viewerLink - 图片查看器页面 URL
         * @param {number} pageNum - 图片序号（从 1 开始）
         */
        async _processSingleLink(viewerLink, pageNum) {
            Log.info(`处理图片 ${pageNum}: ${viewerLink}`);

            // 步骤 1：获取 viewer 页面 HTML
            const viewerHTML = await fetchWithRetry(viewerLink, {
                credentials: 'include',
                headers: { 'User-Agent': navigator.userAgent },
            }, 3, 2000).then(r => r.text());

            // 若 viewer 页面本身已经被频率限制页替代，则直接抛出更友好的错误信息。
            const rateLimitWarning = detectEHentaiRateLimitWarning(viewerHTML);
            if (rateLimitWarning) {
                throw new Error(rateLimitWarning);
            }

            // 步骤 2：解析 HTML 提取原始下载链接
            const { originalUrl, fullImageUrl, pageNum: actualPage } =
                ImageExtractor.parseViewerHTML(viewerHTML);

            if (!originalUrl && !fullImageUrl) {
                throw new Error('未找到图片 URL（originalUrl 和 fullImageUrl 均为空）');
            }

            Log.info(`候选图片 URL: ${(originalUrl || fullImageUrl).substring(0, 80)}...`);

            // 步骤 3：优先下载原图，若原图实际返回 HTML / 登录页，则自动回退到页面主图
            const { blob, finalUrl, source } = await downloadEHentaiBestImage({
                originalUrl,
                fullImageUrl,
                viewerLink,
            });
            const normalizedBlob = await normalizeBlobForEagle(blob);
            Log.info(`最终采用 ${source === 'original' ? '原图' : '页面主图'}: ${finalUrl.substring(0, 80)}...`);

            // 步骤 4：准备输出
            // 从 URL 中提取原始文件名
            const fileName = buildEHentaiFileName(
                viewerLink,
                actualPage || pageNum,
                finalUrl,
                normalizedBlob.type || 'image/jpeg'
            );

            // 构造页码信息作为注释
            const pageInfo = actualPage ? `Page ${actualPage}` : `Page ${pageNum}`;

            if (this.mode === 'eagle') {
                const base64Data = await blobToBase64(normalizedBlob);
                Log.info(`图片大小: ${(normalizedBlob.size / 1024).toFixed(1)} KB, base64: ${(base64Data.length / 1024).toFixed(1)} KB`);
                await this.outputImage({
                    fileName,
                    blob: normalizedBlob,
                    base64: base64Data,
                    folderId: this.folderId,
                    tags: this.tags,
                    annotation: `${pageInfo} | ${viewerLink}`,
                    website: viewerLink,
                    lookupUrl: viewerLink,
                    mimeType: normalizedBlob.type || 'image/jpeg',
                });
                return;
            }

            Log.info(`图片大小: ${(normalizedBlob.size / 1024).toFixed(1)} KB，准备本地保存`);
            await this.outputImage({
                fileName,
                blob: normalizedBlob,
                remoteUrl: finalUrl,
                annotation: `${pageInfo} | ${viewerLink}`,
                website: viewerLink,
                mimeType: normalizedBlob.type || 'image/jpeg',
            });
        }

        /** 停止扫描 */
        stop() {
            this.isStopped = true;
            Log.info('深度扫描已收到停止信号');
        }
    }

    // ╔══════════════════════════════════════════════════════════════╗
    // ║         7. UI 悬浮面板                                       ║
    // ║   固定在页面右侧，紧凑清爽，可折叠/展开                        ║
    // ╚══════════════════════════════════════════════════════════════╝

    const UIPanel = {
        container: null,        // 面板容器 DOM
        isExpanded: false,      // 是否展开
        isCollapsed: true,      // 是否折叠（初始折叠）
        scanInProgress: false,  // 是否正在扫描
        scanner: null,          // 当前扫描器实例
        siteInfo: null,         // 当前站点信息
        actionMode: 'eagle',    // 当前动作模式：eagle | local
        eagleAvailable: false,  // Eagle 当前是否可用
        eagleLastSuccessAt: 0,   // 最近一次收到 Eagle 成功响应的时间戳
        folderId: '',           // 选中的 Eagle 文件夹 ID
        selectedFolderIds: [],   // 参考 Eagle 官方采集器：允许同时选择多个目标文件夹
        folders: [],            // Eagle 文件夹列表
        selectedTags: [],
        selectedTagsBySite: {},
        recentTags: [],
        eagleTags: [],
        eagleTagGroups: [],
        tagCatalogLoading: false,
        tagCatalogError: '',
        connectionCheckId: 0, // 防止并发刷新目录时，旧请求把新状态覆盖回“检测中”
        lastFailureReport: [], // 最近一次采集的失败明细，供用户一键复制排查
        localDirectoryHandle: null, // 本地模式下由用户授权的目录句柄；为空时走浏览器默认下载目录

        /**
         * 初始化并注入面板到页面
         * 注：不依赖任何外部 CSS 库，所有样式内联
         */
        init(siteInfo) {
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

        /** 展开面板(库折叠面板) */
        expand() {
            if (this.collPanel) this.collPanel.expand();
            this.isExpanded = true;
            this.isCollapsed = false;
        },

        /** 折叠面板(先收起可能展开的选择器弹层) */
        collapse() {
            if (this.folderPicker) this.folderPicker.close();
            if (this.tagPicker) this.tagPicker.close();
            if (this.collPanel) this.collPanel.collapse();
            this.isExpanded = false;
            this.isCollapsed = true;
        },

        /** 切换展开/折叠 */
        toggle() {
            if (this.isCollapsed) {
                this.expand();
            } else {
                this.collapse();
            }
        },

        /** 更新状态文字 */
        setStatus(text, type = '') {
            const el = this.container.querySelector('#esp-status');
            if (el) {
                el.textContent = text;
                el.className = 'egc-status ' + type;
            }
        },

        /** 清空上一轮失败明细，避免把旧错误混入本次采集结果。 */
        clearFailureReport() {
            this.lastFailureReport = [];
            this.syncFailureReportButton();
        },

        /**
         * 保存一轮采集的失败明细。失败原因同时写入控制台，
         * 并在面板提供“复制失败日志”按钮，用户无需打开开发者工具。
         *
         * @param {string} context
         * @param {Array<{link?: string, url?: string, pageNum?: string|number, error?: string}>} failedItems
         */
        setFailureReport(context, failedItems = []) {
            const list = Array.isArray(failedItems) ? failedItems : [];
            this.lastFailureReport = list.map((item, index) => ({
                index: index + 1,
                pageNum: item?.pageNum || '',
                source: String(item?.link || item?.url || ''),
                error: String(item?.error || '未知错误'),
            }));
            this.syncFailureReportButton();

            if (this.lastFailureReport.length > 0) {
                Log.error(`${context}失败明细：\n${this.formatFailureReport(context)}`);
            }
        },

        /** 生成可读、可复制的纯文本失败报告。 */
        formatFailureReport(context = '图片采集') {
            const header = [
                `${context}失败日志`,
                `时间: ${new Date().toLocaleString()}`,
                `页面: ${window.location.href}`,
                `失败数: ${this.lastFailureReport.length}`,
                '',
            ];
            const rows = this.lastFailureReport.map(item => [
                `#${item.index}${item.pageNum ? ` | 页码: ${item.pageNum}` : ''}`,
                `原因: ${item.error}`,
                `来源: ${item.source || '未记录'}`,
                '',
            ].join('\n'));
            return header.concat(rows).join('\n');
        },

        /** 根据是否有失败项，显示或隐藏日志复制按钮。 */
        syncFailureReportButton() {
            const btn = this.container?.querySelector('#esp-btn-copy-failure-log');
            if (!btn) return;
            const count = this.lastFailureReport.length;
            btn.style.display = count > 0 ? 'block' : 'none';
            btn.textContent = `复制失败日志（${count}）`;
        },

        /** 将失败日志复制到剪贴板；浏览器拒绝剪贴板权限时提供可手动复制的兜底。 */
        async copyFailureReport() {
            if (this.lastFailureReport.length === 0) {
                this.setStatus('当前没有失败日志可复制');
                return;
            }

            const report = this.formatFailureReport('Eagle 图片采集');
            try {
                await navigator.clipboard.writeText(report);
                this.setStatus(`已复制 ${this.lastFailureReport.length} 条失败日志，可直接粘贴查看`, 'error');
            } catch (err) {
                // 在非安全上下文或浏览器拒绝权限时，prompt 仍可让用户 Ctrl+C 手动复制。
                window.prompt('浏览器未授予剪贴板权限，请 Ctrl+C 复制以下失败日志：', report);
            }
        },

        /** 更新进度条 */
        updateProgress(percent, text) {
            const progressDiv = this.container.querySelector('#esp-progress');
            const bar = this.container.querySelector('#esp-progress-bar');
            const textEl = this.container.querySelector('#esp-progress-text');

            if (progressDiv) progressDiv.classList.add('visible');
            if (bar) bar.style.width = Math.min(100, Math.max(0, percent)) + '%';
            if (textEl) textEl.textContent = text || '';
        },

        /** 隐藏进度条 */
        hideProgress() {
            const progressDiv = this.container.querySelector('#esp-progress');
            if (progressDiv) progressDiv.classList.remove('visible');
        },

        /** 显示控制按钮 */
        showControls() {
            const row = this.container.querySelector('#esp-control-row');
            if (row) row.style.display = 'flex';
        },

        /** 隐藏控制按钮 */
        hideControls() {
            const row = this.container.querySelector('#esp-control-row');
            if (row) row.style.display = 'none';
        },

        /** 设置按钮状态 */
        setButtonsEnabled(enabled) {
            ['esp-btn-deep-scan', 'esp-btn-current-page', 'esp-btn-generic-scan'].forEach(id => {
                const btn = this.container.querySelector('#' + id);
                if (btn) btn.disabled = !enabled;
            });
            if (this.modeSwitch) this.modeSwitch.el.querySelectorAll('button').forEach(btn => {
                btn.disabled = !enabled;
            });
        },

        async refreshEagleTags(force = false) {
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
        },

        /** 获取 Eagle 标签名称，供任务标签合并时做一致性处理。 */
        getTagSuggestions() {
            return this.eagleTags.map(item => String(item.name || '').trim()).filter(Boolean);
        },

        /**
         * 获取当前网站的标签存储范围。
         * 使用 hostname 隔离：同站连续采集可复用，跨站不会误带标签。
         */
        getTagStorageScope() {
            return String(window.location.hostname || 'unknown-site').toLowerCase();
        },

        /**
         * 更新当前网站的已选标签。
         * 最近使用的标签单独保存，便于下次重新点选。
         */
        setSelectedTags(tags = []) {
            this.selectedTags = mergeTags(tags).slice(0, 24);
            const scope = this.getTagStorageScope();
            if (this.selectedTags.length > 0) this.selectedTagsBySite[scope] = this.selectedTags;
            else delete this.selectedTagsBySite[scope];
            try {
                GM_setValue(STORAGE_KEYS.selectedTagsBySite, this.selectedTagsBySite);
                GM_setValue(STORAGE_KEYS.selectedTags, []);
            } catch (err) {
                Log.warn('保存当前网站已选标签失败:', err.message);
            }
            if (this.tagPicker) this.tagPicker.setSelected(this.selectedTags, true);
        },

        getActionMode() {
            return this.actionMode === 'local' ? 'local' : 'eagle';
        },

        /**
         * 当前是否为“保存到 Eagle”模式。
         * @returns {boolean}
         */
        isEagleMode() {
            return this.getActionMode() === 'eagle';
        },

        /**
         * 当前是否为“本地下载”模式。
         * @returns {boolean}
         */
        isLocalMode() {
            return this.getActionMode() === 'local';
        },

        /**
         * 切换动作模式，并同步更新 UI。
         *
         * @param {'eagle'|'local'} mode
         * @param {{ persist?: boolean, silent?: boolean }} options
         */
        setActionMode(mode, options = {}) {
            const { persist = true, silent = false } = options;
            const normalizedMode = mode === 'local' ? 'local' : 'eagle';
            this.actionMode = normalizedMode;

            if (persist) {
                try {
                    GM_setValue(STORAGE_KEYS.actionMode, normalizedMode);
                } catch (err) {
                    Log.warn('保存动作模式失败:', err.message);
                }
            }

            this.updateActionModeUI();

            if (!silent) {
                if (normalizedMode === 'local') {
                    this.setStatus('⬇️ 已切换为本地下载模式');
                } else if (this.eagleAvailable) {
                    this.setStatus('🦅 已切换为保存到 Eagle 模式');
                } else {
                    this.setStatus('⚠️ 已切换为保存到 Eagle 模式，请先启动 Eagle', 'error');
                }
            }
        },

        /**
         * 根据当前模式刷新面板上的交互状态。
         * - 本地下载模式：禁用 Eagle 相关配置
         * - Eagle 模式：恢复文件夹 / 标签 / 自动建目录等配置
         */
        updateActionModeUI() {
            const mode = this.getActionMode();
            const localFolderSection = this.container.querySelector('#esp-local-folder-section');
            const eagleFolderWrap = this.container.querySelector('#esp-eagle-folder-section');
            const tagsSection = this.container.querySelector('#esp-eagle-tags-section');
            const autoFolderRow = this.container.querySelector('#esp-auto-folder-row');
            const genericButton = this.container.querySelector('#esp-btn-generic-scan');

            // 本地模式改用本地目录授权控件；Eagle 目录、标签、自动建目录不参与本地下载。
            if (localFolderSection) localFolderSection.style.display = mode === 'local' ? 'block' : 'none';
            if (eagleFolderWrap) eagleFolderWrap.style.display = mode === 'local' ? 'none' : 'block';
            if (tagsSection) tagsSection.style.display = mode === 'local' ? 'none' : '';
            if (autoFolderRow) autoFolderRow.style.display = mode === 'local' ? 'none' : (this.isFabContext() || this.isEHentaiContext() ? 'flex' : autoFolderRow.style.display);
            if (genericButton && this.isFabContext()) this.setGenericButtonLabel(mode === 'local' ? '开始下载' : '开始采集');

            // 1. 同步顶部模式按钮高亮(库 mode 组件)
            if (this.modeSwitch) this.modeSwitch.set(mode, true);

            // 2. Eagle 专属配置区在本地模式下置灰并禁用
            const eagleOnlySelectors = [
                '#esp-eagle-folder-section',
                '#esp-eagle-tags-section',
                '#esp-auto-folder-row',
            ];
            eagleOnlySelectors.forEach(selector => {
                const section = this.container.querySelector(selector);
                if (!section) return;

                section.classList.toggle('disabled', mode === 'local' && selector !== '#esp-eagle-folder-section');
                section.querySelectorAll('input, textarea, button, select').forEach(control => {
                    if (selector === '#esp-auto-folder-row' && control.id === 'esp-auto-folder') {
                        control.disabled = mode === 'local';
                        return;
                    }
                    control.disabled = mode === 'local';
                });
            });

            // 3. 本地模式下收起文件夹选择器弹层(Eagle 配置区已整体隐藏)
            if (mode === 'local' && this.folderPicker) this.folderPicker.close();

        },

        /** 统一更新通用采集按钮文案，避免覆盖边框动效所需的内部标签。 */
        setGenericButtonLabel(text) {
            const button = this.container.querySelector('#esp-btn-generic-scan');
            const label = button?.querySelector('.egc-btn-label');
            if (label) label.textContent = text;
            else if (button) button.textContent = text;
        },

        /**
         * 请求用户授权一个本地下载目录。
         * 浏览器不允许脚本直接读取 Windows 的绝对路径，但用户可以在目录授权对话框中选择“下载”、其他盘符或系统文件夹。
         */
        async pickLocalDirectory() {
            if (typeof window.showDirectoryPicker !== 'function') {
                this.setStatus('当前浏览器不支持目录授权，将使用默认下载文件夹', 'error');
                return;
            }

            try {
                const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
                this.localDirectoryHandle = handle;
                this.syncLocalDirectoryLabel();
                this.setStatus(`本地保存目录：${handle.name}`);
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                Log.warn('选择本地目录失败:', err?.message || err);
                this.localDirectoryHandle = null;
                this.syncLocalDirectoryLabel();
                this.setStatus('未选择目录，将使用浏览器默认下载文件夹');
            }
        },

        /** 同步本地目录选择按钮的可见文案。 */
        syncLocalDirectoryLabel() {
            const trigger = this.container.querySelector('#esp-local-folder-trigger');
            if (!trigger) return;
            if (this.localDirectoryHandle) {
                const name = String(this.localDirectoryHandle.name || '').trim();
                // 根目录句柄的 name 可能就是“C:\\”。不能再把它当成空值隐藏，
                // 否则用户选择其他盘符后无法确认实际目标位置。
                trigger.textContent = name ? ('已选择：' + name) : '已选择本地文件夹';
            } else {
                trigger.textContent = '默认下载文件夹';
            }
        },

        /** 更新顶部 Eagle 连接状态圆点。 */
        markEagleAvailable(source = '') {
            this.eagleAvailable = true;
            this.eagleLastSuccessAt = Date.now();
            this.setEagleConnectionStatus('connected');
            if (source) Log.debug('Eagle 可用证据:', source);
        },

        /** 更新顶部 Eagle 连接状态圆点。 */
        setEagleConnectionStatus(state = 'pending') {
            const el = this.container.querySelector('#esp-connection-status');
            if (!el) return;

            // 目录/标签已经成功读到，或之前已经完成过一次 Eagle 保存时，
            // 任何迟到的失败回调都不能把状态回退成“未启动”。
            const hasUsableEvidence = this.eagleAvailable
                || this.folders.length > 0
                || this.eagleTags.length > 0
                || this.eagleTagGroups.length > 0;
            const normalized = state === 'connected'
                ? 'connected'
                : state === 'pending' && hasUsableEvidence
                    ? 'connected'
                : state === 'disconnected' && hasUsableEvidence
                    ? 'connected'
                    : state === 'disconnected' ? 'disconnected' : 'pending';
            const labels = {
                connected: '已启动',
                disconnected: '未启动',
                pending: '检测中',
            };
            el.className = `esp-connection-status is-${normalized}`;
            if (this.connStatus) this.connStatus.set(normalized, labels[normalized]);
        },

        /**
         * 当前是否处于 Fab 页面上下文。
         * @returns {boolean}
         */
        isFabContext() {
            return !!(this.siteInfo && this.siteInfo.siteKey === 'www.fab.com');
        },

        /** 当前是否处于 E-Hentai / ExHentai 画廊上下文。 */
        isEHentaiContext() {
            return !!(this.siteInfo && ['e-hentai.org', 'exhentai.org'].includes(this.siteInfo.siteKey));
        },

        /**
         * 判断当前是否开启“Fab 自动建目录”。
         * @returns {boolean}
         */
        isAutoFolderEnabled() {
            const el = this.container.querySelector('#esp-auto-folder');
            return !!(el && el.checked);
        },

        /**
         * 在当前用户选择的基础目录下创建或复用自动目录。
         * Fab 与 E-Hentai 共用这条逻辑，避免两个站点的目录行为不一致。
         */
        async ensureAutoTargetFolder(folderName) {
            if (this.isLocalMode() || !this.isAutoFolderEnabled()) {
                const selectedFolderIds = this.getSelectedFolderIds();
                this.folderId = selectedFolderIds[0] || '';
                this.selectedFolderIds = selectedFolderIds;
                return this.folderId;
            }

            const selectedFolderIds = this.getSelectedFolderIds();
            const manuallySelected = selectedFolderIds[0] || '';
            if (!this.folders || this.folders.length === 0) {
                this.folders = await EagleAPI.getFolders();
            }

            const flatFolders = flattenFolders(this.folders);
            const parentFolder = flatFolders.find(folder => folder.id === manuallySelected)?.raw || null;
            const siblingFolders = manuallySelected
                ? (Array.isArray(parentFolder?.children) ? parentFolder.children : [])
                : this.folders;
            const foundRaw = siblingFolders.find(folder => folder.name === folderName) || null;
            let found = foundRaw
                ? { id: foundRaw.id, name: foundRaw.name, raw: foundRaw }
                : null;

            if (!found) {
                this.setStatus(`正在创建目录：${folderName}`);
                const created = await EagleAPI.createFolder(folderName, manuallySelected);
                found = { id: created.id, name: created.name, raw: created };
                await this.loadFolders();
                if (this.folderPicker && manuallySelected) this.folderPicker.setSelected([manuallySelected]);
            }

            // 单选语义:自动目录只作为本轮写入目标(folderId),不改变用户手动选择。
            this.folderId = found.id;
            return found.id;
        },

        /** 根据当前站点和画廊信息返回自动目录 ID。 */
        async ensureCurrentPageTargetFolder() {
            if (this.isFabContext()) {
                return this.ensureFabTargetFolder();
            }
            if (this.isEHentaiContext() && ['gallery_detail', 'image_viewer'].includes(this.siteInfo?.pageType)) {
                const { folderName } = getEHentaiGalleryInfo();
                return this.ensureAutoTargetFolder(folderName);
            }
            this.folderId = this.getSelectedFolderIds()[0] || '';
            return this.folderId;
        },

        getSelectedFolderIds() {
            // 单选语义:库 picker 持有唯一真值;空数组即"默认(根目录)"。
            return this.folderPicker ? this.folderPicker.getSelected() : (this.selectedFolderIds || []).slice(0, 1);
        },

        buildScanTags(baseTags = []) {
            // 手动输入的标签已由库标签选择器并入 selectedTags,这里只做页面标签与已选的合并。
            return mergeTags(baseTags, this.selectedTags);
        },

        /**
         * 确保当前动作可以继续执行：
         * - 本地下载模式：直接通过
         * - 保存到 Eagle 模式：必须确认 Eagle 已运行，并尽量加载文件夹列表
         *
         * @returns {Promise<boolean>}
         */
        async ensureActionReady() {
            if (this.isLocalMode()) return true;

            // 连接可用不应依赖“至少有一个文件夹”；根目录保存和空目录 Eagle
            // 同样是合法状态，不能因目录列表为空而重复检测并误报未启动。
            if (this.eagleAvailable) {
                return true;
            }

            const loaded = await this.loadFolders();
            if (!loaded) {
                // loadFolders 内部已给出带排查指引的详细文案，这里不覆盖。
                Log.warn('Eagle 未就绪，采集未开始（目录也不会创建）');
            }
            return loaded;
        },

        /**
         * 统一处理“图片输出”。
         *
         * 设计目标：
         * 1. 让 E-Hentai / Fab / 通用扫描三条链路复用同一套模式分流；
         * 2. Eagle 模式下继续保留原有最稳的导入方式；
         * 3. 本地模式下复用已获取到的 Blob，避免重新鉴权、重新取图。
         *
         * @param {object} options
         * @param {string} options.fileName
         * @param {Blob=} options.blob
         * @param {string=} options.base64
         * @param {string=} options.remoteUrl
         * @param {string=} options.website
         * @param {string=} options.lookupUrl
         * @param {string=} options.annotation
         * @param {string[]=} options.tags
         * @param {string=} options.folderId
         * @param {string=} options.mimeType
         * @param {boolean=} options.preferRemoteEagle
         * @param {object=} options.fetchOptions
         * @param {object=} options.gmOptions
         * @returns {Promise<void>}
         */
        async outputImage(options = {}) {
            const mode = this.getActionMode();
            const fileName = normalizeDownloadFileName(options.fileName || '');
            const selectedFolderIds = Array.isArray(options.folderIds)
                ? options.folderIds.filter(Boolean).map(String)
                : this.getSelectedFolderIds();

            if (mode === 'local') {
                let localBlob = options.blob;
                if (!(localBlob instanceof Blob)) {
                    if (!options.remoteUrl) {
                        throw new Error('本地下载失败：既没有可用 blob，也没有远程图片地址');
                    }
                    localBlob = await downloadImageBlobSmart(
                        options.remoteUrl,
                        options.fetchOptions || {},
                        options.gmOptions || {}
                    );
                }

                await saveBlobLocally(localBlob, fileName, this.localDirectoryHandle);
                return;
            }

            if (!(await this.ensureActionReady())) {
                throw new Error('Eagle 未运行或尚未连接成功');
            }

            if (options.preferRemoteEagle && options.remoteUrl) {
                await EagleAPI.addFromRemoteURL(options.remoteUrl, fileName, {
                    folderId: options.folderId,
                    folders: selectedFolderIds,
                    tags: options.tags || [],
                    annotation: options.annotation || '',
                    website: options.website || window.location.href,
                    lookupUrl: options.lookupUrl || options.website || window.location.href,
                    verifyFolders: selectedFolderIds.length > 0,
                });
                // 能成功写入 Eagle 就说明连接已可用；即使启动检测回调丢失，
                // 顶部状态也不能继续显示“检测中”。
                this.eagleAvailable = true;
                this.setEagleConnectionStatus('connected');
                return;
            }

            let base64Data = options.base64;
            if (!base64Data) {
                if (!(options.blob instanceof Blob)) {
                    if (!options.remoteUrl) {
                        throw new Error('保存到 Eagle 失败：既没有 base64/blob，也没有远程图片地址');
                    }
                    const fetchedBlob = await downloadImageBlobSmart(
                        options.remoteUrl,
                        options.fetchOptions || {},
                        options.gmOptions || {}
                    );
                    base64Data = await blobToBase64(fetchedBlob);
                } else {
                    base64Data = await blobToBase64(options.blob);
                }
            }

            await EagleAPI.addFromBase64(base64Data, fileName, {
                folderId: options.folderId,
                folders: selectedFolderIds,
                tags: options.tags || [],
                annotation: options.annotation || '',
                website: options.website || window.location.href,
                lookupUrl: options.lookupUrl || options.website || window.location.href,
                mimeType: options.mimeType || (options.blob && options.blob.type) || '',
                verifyFolders: selectedFolderIds.length > 0,
            });
            this.eagleAvailable = true;
            this.setEagleConnectionStatus('connected');
        },

        /**
         * 确保 Fab 当前商品拥有一个目标文件夹：
         * - 若手动已选文件夹，则直接使用
         * - 若开启自动建目录，则按商品名称自动创建 / 复用目录
         *
         * @returns {Promise<string>} folderId
         */
        async ensureFabTargetFolder(listingNames = null) {
            // 本地下载模式不依赖 Eagle 文件夹，直接返回空字符串即可。
            if (this.isLocalMode()) {
                this.folderId = '';
                return '';
            }

            const selectedFolderIds = this.getSelectedFolderIds();
            const manuallySelected = selectedFolderIds[0] || '';

            if (!this.isAutoFolderEnabled()) {
                this.folderId = manuallySelected;
                this.selectedFolderIds = selectedFolderIds;
                return manuallySelected;
            }

            // 若用户点击得很快，文件夹列表可能还没来得及异步加载完成；
            // 这里主动补一次，避免误判“目录不存在”而创建重复目录。
            if (!this.folders || this.folders.length === 0) {
                this.folders = await EagleAPI.getFolders();
            }

            const resolvedNames = listingNames || await getFabListingNamesAsync();
            const { folderName, originalName } = resolvedNames;
            const flatFolders = flattenFolders(this.folders);

            /**
             * “目标文件夹”是用户选择的基础目录；自动商品目录应创建在它下面。
             * 只在同一父目录的直接子级中复用同名目录，避免误命中其他分支的同名文件夹。
             */
            const parentFolder = flatFolders.find(folder => folder.id === manuallySelected)?.raw || null;
            const siblingFolders = manuallySelected
                ? (Array.isArray(parentFolder?.children) ? parentFolder.children : [])
                : this.folders;
            const foundRaw = siblingFolders.find(folder => folder.name === folderName) || null;
            let found = foundRaw
                ? { id: foundRaw.id, name: foundRaw.name, raw: foundRaw }
                : null;

            // 旧版本可能已经在第一次点击时创建了纯英文目录。若目标中英名尚不存在，
            // 优先原地改名并复用原目录，避免再次创建目录导致素材被拆成两份。
            if (!found && originalName && folderName !== originalName) {
                const legacyEnglishFolder = siblingFolders.find(folder => folder.name === originalName) || null;
                if (legacyEnglishFolder?.id) {
                    try {
                        this.setStatus(`正在升级目录名称：${folderName}`);
                        await EagleAPI.renameFolder(legacyEnglishFolder.id, folderName);
                        legacyEnglishFolder.name = folderName;
                        found = {
                            id: legacyEnglishFolder.id,
                            name: folderName,
                            raw: legacyEnglishFolder,
                        };
                    } catch (renameErr) {
                        Log.warn(`Fab 英文目录升级失败，将创建中英目录: ${renameErr.message}`);
                    }
                }
            }

            if (!found) {
                // 翻译双源都失败时目录退回纯英文名；把原因并入创建文案，
                // 避免独立提示被后续状态立即覆盖而无法被用户看到。
                this.setStatus(`正在创建目录：${folderName}${resolvedNames.translationFailed ? '（翻译暂不可用，使用纯英文名）' : ''}`);
                const created = await EagleAPI.createFolder(folderName, manuallySelected);
                found = {
                    id: created.id,
                    name: created.name,
                    depth: 0,
                    raw: created,
                };

                // 重新加载目录树，但恢复用户选择的基础目录，不让自动子目录污染“上次选择”。
                await this.loadFolders();
                if (this.folderPicker && manuallySelected) this.folderPicker.setSelected([manuallySelected]);
            }

            // 单选语义:自动目录只作为本轮写入目标(folderId),不改变用户手动选择。
            this.folderId = found.id;
            return found.id;
        },

        /**
         * 加载 Eagle 文件夹列表并填充选择器
         */
        async loadFolders() {
            const requestId = ++this.connectionCheckId;
            this.setStatus('正在刷新目录...');
            this.setEagleConnectionStatus('pending');
            const isAlive = await EagleAPI.checkAlive();
            // 并发刷新时，即使该请求后来变成“旧请求”，成功结果仍然是有效证据；
            // 只允许旧请求证明 Eagle 可用，不允许旧失败覆盖较新的成功状态。
            if (isAlive) this.markEagleAvailable('alive-probe');
            if (requestId !== this.connectionCheckId) return this.eagleAvailable;

            // 应用信息接口偶发失败时，继续读取真实目录接口；目录接口成功即证明
            // Eagle 已可用，不能因为单次 checkAlive 误判就显示“未启动”。
            const folderResult = await EagleAPI.getFoldersWithStatus();
            if (folderResult.ok) this.markEagleAvailable('folder-list');
            if (requestId !== this.connectionCheckId) return this.eagleAvailable;
            const apiReachable = !!isAlive || folderResult.ok;
            const hadKnownConnection = this.eagleAvailable || this.folders.length > 0 || this.eagleTags.length > 0;
            this.eagleAvailable = apiReachable;

            if (!apiReachable) {
                // 已经成功读取过目录/标签或完成过一次 Eagle 保存时，短暂探测失败
                // 不应把用户界面降级成“未启动”，否则用户会误以为不能点击采集。
                if (hadKnownConnection) {
                    this.eagleAvailable = true;
                    this.setEagleConnectionStatus('connected');
                    this.updateActionModeUI();
                    this.setStatus('Eagle 连接检查暂时失败，保留现有配置');
                    return true;
                }
                this.setEagleConnectionStatus('disconnected');
                this.updateActionModeUI();
                this.setStatus(
                    this.isLocalMode()
                        ? '本地下载模式已就绪'
                        // Eagle 已在运行却显示未启动，几乎都是脚本管理器的跨域授权问题：
                        // Tampermonkey 重装/升级后首次跨域请求会弹授权框，误点拒绝后所有请求静默失败。
                        : '无法连接 Eagle（端口 41595）。若 Eagle 已在运行，请点击 Tampermonkey 图标 → 本脚本，把站点访问权限设为允许，并重新打开本页',
                    this.isLocalMode() ? '' : 'error'
                );
                return false;
            }

            // Eagle 已连接但目录刷新失败时，保留上一次可用目录和用户选择，
            // 避免顶部状态与面板内容互相矛盾。
            if (!folderResult.ok) {
                this.setEagleConnectionStatus('connected');
                this.updateActionModeUI();
                this.setStatus(this.folders.length > 0
                    ? 'Eagle 已连接，保留现有目录'
                    : 'Eagle 已连接，暂时使用根目录');
                // 文件夹接口暂时不可用时仍允许采集，folderId 为空即写入 Eagle 根目录。
                return true;
            }

            this.folders = folderResult.folders;
            // 灌入库文件夹选择器(保留 Eagle 原始层级,树内按需展开)
            if (this.folderPicker) this.folderPicker.setFolders(this.folders);

            /**
             * 恢复上次选择的文件夹。
             * 若没有历史记录，则优先选择 “Eagle丨成长”，方便当前这个项目直接使用。
             */
            let preferredFolderId = '';
            let preferredFolderIds = [];
            try {
                preferredFolderId = GM_getValue(STORAGE_KEYS.lastFolderId, '') || '';
                const storedFolderIds = GM_getValue(STORAGE_KEYS.folderIds, []);
                preferredFolderIds = Array.isArray(storedFolderIds) ? storedFolderIds.filter(Boolean).map(String) : [];
            } catch (err) {
                Log.warn('读取上次文件夹选择失败:', err.message);
            }
            if (preferredFolderIds.length === 0 && preferredFolderId) preferredFolderIds = [String(preferredFolderId)];

            if (!preferredFolderId) {
                const growthFolder = flatFolders.find(folder => folder.name === 'Eagle丨成长');
                if (growthFolder) {
                    preferredFolderId = growthFolder.id;
                    if (preferredFolderIds.length === 0) preferredFolderIds = [String(growthFolder.id)];
                }
            }

            const flatFolders = flattenFolders(this.folders);
            const validPreferredIds = preferredFolderIds.filter(id => flatFolders.some(folder => folder.id === id)).slice(0, 1);
            if (this.folderPicker) this.folderPicker.setSelected(validPreferredIds);
            this.selectedFolderIds = validPreferredIds;
            this.folderId = validPreferredIds[0] || '';

            this.updateActionModeUI();
            this.setEagleConnectionStatus('connected');
            this.setStatus(this.isLocalMode() ? '本地下载模式已就绪' : '目录已加载，可以开始采集');
            return true;
        },

        // ── 扫描控制 ──

        _isPaused: false,

        /**
         * 启动 E-Hentai 深度扫描
         */
        async _startDeepScan() {
            if (this.scanInProgress) return;
            if (!(await this.ensureActionReady())) return;
            this.scanInProgress = true;
            this.clearFailureReport();

            // 收集画廊信息（标题、标签）
            const pageConfig = this.siteInfo.pageConfig;
            const title = getTextContent(pageConfig.titleSelector || '#gn') || '未命名画廊';
            const tagEls = document.querySelectorAll(pageConfig.tagsSelector || '#taglist .gt');
            const tags = this.buildScanTags(
                Array.from(tagEls).map(el => el.textContent.trim()).filter(Boolean)
            );
            const rateLimitWarning = detectEHentaiRateLimitWarning(document.body ? document.body.innerText : '');

            // 根据当前画廊自动创建/复用目标目录；关闭开关时保留用户手动选择。
            this.folderId = await this.ensureCurrentPageTargetFolder();
            const actionMode = this.getActionMode();
            const actionLabel = getActionModeLabel(actionMode);

            this.expand();
            this.setButtonsEnabled(false);
            this.showControls();
            this.updateProgress(0, `准备深度扫描: ${title}（${actionLabel}）`);
            this.setStatus(
                rateLimitWarning
                    ? `⚠️ ${rateLimitWarning}`
                    : `🏷️ 标签: ${tags.slice(0, 5).join(', ')}${tags.length > 5 ? '...' : ''} ｜ 模式: ${actionLabel} ｜ 限频: 单线程慢速`
            );

            // 创建扫描器
            this.scanner = new EHentaiDeepScanner({
                pageConfig: this.siteInfo.pageConfig,
                mode: actionMode,
                folderId: this.folderId,
                tags: tags,
                outputImage: (payload) => this.outputImage(payload),
                concurrency: EHENTAI_RATE_LIMIT.concurrency,
                galleryPageDelayMin: EHENTAI_RATE_LIMIT.galleryPageDelayMin,
                galleryPageDelayMax: EHENTAI_RATE_LIMIT.galleryPageDelayMax,
                itemDelayMin: EHENTAI_RATE_LIMIT.itemDelayMin,
                itemDelayMax: EHENTAI_RATE_LIMIT.itemDelayMax,
                onProgress: (phase, current, total, message) => {
                    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
                    this.updateProgress(percent, message);
                },
                shouldPause: () => this._isPaused,
            });

            try {
                const results = await this.scanner.execute();
                this.setFailureReport('E-Hentai 深度扫描', results.failed);

                // 汇总结果
                const msg = `✅ ${actionLabel}完成: ${results.success}/${results.total} 张成功`;
                this.setStatus(
                    results.failed.length > 0
                        ? msg + `, ${results.failed.length} 张失败`
                        : msg,
                    results.failed.length > 0 ? 'error' : 'success'
                );
            } catch (err) {
                Log.error('深度扫描异常:', err);
                this.setStatus('❌ 扫描出错: ' + err.message, 'error');
            } finally {
                this.scanInProgress = false;
                this.scanner = null;
                this.setButtonsEnabled(true);
                this.hideControls();
                this._isPaused = false;
                this.container.querySelector('#esp-btn-pause').textContent = '⏸️ 暂停';
            }
        },

        /**
         * 仅采集当前页（快速模式）
         * 对于 E-Hentai 画廊详情页：从 #gdt a[href] 提取链接，fetch viewer 页面获取原图
         */
        async _captureCurrentPage() {
            if (this.scanInProgress) return;
            if (!(await this.ensureActionReady())) return;
            this.scanInProgress = true;
            this.clearFailureReport();

            const pageConfig = this.siteInfo.pageConfig;
            const rateLimitWarning = detectEHentaiRateLimitWarning(document.body ? document.body.innerText : '');
            const actionMode = this.getActionMode();
            const actionLabel = getActionModeLabel(actionMode);

            this.expand();
            this.setButtonsEnabled(false);
            this.hideControls();
            this.updateProgress(0, `采集当前页...（${actionLabel}）`);
            if (rateLimitWarning) {
                this.setStatus(`⚠️ ${rateLimitWarning}`, 'error');
            } else {
                this.setStatus(`正在${actionLabel}当前页图片...`);
            }

            try {
                // 提取当前页的所有图片入口链接
                const links = ImageExtractor.extractBySelector(
                    pageConfig.itemSelector,
                    pageConfig.itemAttr
                ).map(url => toAbsoluteURL(url, window.location.origin));

                if (links.length === 0) {
                    this.setStatus('未找到图片链接', 'error');
                    return;
                }

                Log.info(`当前页发现 ${links.length} 个图片链接`);

                // 逐张处理（使用与深度扫描相同的逻辑，但不翻页）
                this.folderId = await this.ensureCurrentPageTargetFolder();
                const tags = this.buildScanTags(this._getCurrentPageTags());

                let successCount = 0;
                const failedItems = [];

                for (let i = 0; i < links.length; i++) {
                    const link = links[i];
                    this.updateProgress(Math.round((i / links.length) * 100), `处理: ${i + 1}/${links.length}`);

                    try {
                        // 获取 viewer 页面 HTML
                        const html = await fetchWithRetry(link, {
                            credentials: 'include',
                            headers: { 'User-Agent': navigator.userAgent },
                        }, 2, 2000).then(r => r.text());

                        const viewerRateLimitWarning = detectEHentaiRateLimitWarning(html);
                        if (viewerRateLimitWarning) {
                            throw new Error(viewerRateLimitWarning);
                        }

                        const { originalUrl, fullImageUrl, pageNum } = ImageExtractor.parseViewerHTML(html);
                        if (!originalUrl && !fullImageUrl) {
                            throw new Error('未找到图片 URL');
                        }

                        // 下载图片：
                        // 优先尝试“Download original”，如果得到的其实是 HTML / 登录页，
                        // 自动回退到 viewer 中可见的大图，避免 Eagle 卡死在导入队列。
                        const { blob, finalUrl } = await downloadEHentaiBestImage({
                            originalUrl,
                            fullImageUrl,
                            viewerLink: link,
                        });
                        const normalizedBlob = await normalizeBlobForEagle(blob);

                        // 按当前模式输出
                        const fileName = buildEHentaiFileName(
                            link,
                            pageNum || (i + 1),
                            finalUrl,
                            normalizedBlob.type || 'image/jpeg'
                        );

                        const payload = {
                            folderId: this.folderId,
                            tags: tags,
                            blob: normalizedBlob,
                            annotation: `Page ${pageNum || i + 1} | ${link}`,
                            website: link,
                            lookupUrl: link,
                            remoteUrl: finalUrl,
                            mimeType: normalizedBlob.type || 'image/jpeg',
                        };
                        if (actionMode === 'eagle') {
                            payload.base64 = await blobToBase64(normalizedBlob);
                        }

                        await this.outputImage({
                            fileName,
                            ...payload,
                        });

                        successCount++;
                    } catch (err) {
                        failedItems.push({ link, error: err.message });
                        Log.error(`处理失败 (${i + 1}/${links.length}):`, err.message);
                    }

                    await sleepRandom(
                        EHENTAI_RATE_LIMIT.currentPageDelayMin,
                        EHENTAI_RATE_LIMIT.currentPageDelayMax
                    );
                }

                const msg = `✅ 当前页${actionLabel}完成: ${successCount}/${links.length} 张`;
                this.setFailureReport('E-Hentai 当前页采集', failedItems);
                this.setStatus(
                    failedItems.length > 0 ? msg + `, ${failedItems.length} 失败` : msg,
                    failedItems.length > 0 ? 'error' : 'success'
                );
                this.updateProgress(100, msg);
            } catch (err) {
                Log.error('当前页采集异常:', err);
                this.setStatus('❌ 出错: ' + err.message, 'error');
            } finally {
                this.scanInProgress = false;
                this.setButtonsEnabled(true);
            }
        },

        /**
         * 通用图片扫描模式（用于 Fab.com 等未适配网站）
         */
        async _startGenericScan() {
            if (this.scanInProgress) return;

            /**
             * Fab 商品详情页不走普通“DOM 通用扫描”。
             * 原因：
             * - 页面中的图片不是一次性完整加载
             * - 很多只是缩略图，主图需要点击后才切换
             * - 因此这里直接切到 Fab 专用轮播遍历器
             */
            if (
                this.siteInfo &&
                this.siteInfo.siteKey === 'www.fab.com' &&
                this.siteInfo.pageConfig &&
                this.siteInfo.pageConfig.type === 'fab_gallery'
            ) {
                return await this._startFabGalleryScan();
            }

            if (!(await this.ensureActionReady())) return;
            this.scanInProgress = true;
            this.clearFailureReport();

            const pageConfig = this.siteInfo.pageConfig;
            const actionMode = this.getActionMode();
            const actionLabel = getActionModeLabel(actionMode);

            this.expand();
            this.setButtonsEnabled(false);
            this.updateProgress(0, `正在扫描页面图片（${actionLabel}）...`);
            this.setStatus(`正在${actionLabel}页面图片...`);

            try {
                const images = ImageExtractor.scanGeneric({
                    minWidth: pageConfig.minWidth || 400,
                    minHeight: pageConfig.minHeight || 300,
                });

                if (images.length === 0) {
                    this.setStatus('未发现符合条件的图片', 'error');
                    this.updateProgress(0, '');
                    return;
                }

                this.folderId = this.getSelectedFolderIds()[0] || '';
                const pageTags = this.buildScanTags([document.title.split(' - ')[0]].filter(Boolean));

                let successCount = 0;
                const failedItems = [];

                for (let i = 0; i < images.length; i++) {
                    const img = images[i];
                    this.updateProgress(
                        Math.round((i / images.length) * 100),
                        `下载: ${i + 1}/${images.length}`
                    );

                    try {
                        // 下载图片
                        const blob = await downloadImageBlobSmart(img.url, {
                            credentials: 'include',
                            headers: {
                                'User-Agent': navigator.userAgent,
                                'Referer': window.location.href,
                            },
                        }, {
                            headers: {
                                'User-Agent': navigator.userAgent,
                                'Referer': window.location.href,
                            },
                            timeout: 30000,
                            maxRetries: 2,
                            delayMs: 5000,
                        });
                        // 构造文件名
                        let fileName;
                        if (this.siteInfo && this.siteInfo.siteKey === 'www.fab.com') {
                            fileName = buildFabFileName({
                                index: i,
                                sourceUrl: img.url,
                                mimeType: blob.type || 'image/jpeg',
                            });
                        } else {
                            const urlPath = new URL(img.url).pathname;
                            fileName = urlPath.substring(urlPath.lastIndexOf('/') + 1) || `generic_${i + 1}.jpg`;
                            // 如果 URL 没带文件后缀，根据 blob 类型补充
                            if (!fileName.includes('.')) {
                                const ext = blob.type.split('/')[1] || 'jpg';
                                fileName += '.' + ext;
                            }
                        }

                        const payload = {
                            folderId: this.folderId,
                            tags: pageTags,
                            blob,
                            annotation: `来源: ${window.location.href}`,
                            website: window.location.href,
                            lookupUrl: window.location.href,
                            remoteUrl: img.url,
                            fetchOptions: {
                                credentials: 'include',
                                headers: {
                                    'User-Agent': navigator.userAgent,
                                    'Referer': window.location.href,
                                },
                            },
                            gmOptions: {
                                headers: {
                                    'User-Agent': navigator.userAgent,
                                    'Referer': window.location.href,
                                },
                                timeout: 30000,
                                maxRetries: 2,
                                delayMs: 5000,
                            },
                            mimeType: blob.type || 'image/jpeg',
                        };
                        if (actionMode === 'eagle') {
                            payload.base64 = await blobToBase64(blob);
                        }

                        await this.outputImage({
                            fileName,
                            ...payload,
                        });

                        successCount++;
                    } catch (err) {
                        failedItems.push({ url: img.url, error: err.message });
                        Log.error(`通用扫描失败 (${i + 1}/${images.length}):`, err.message);
                    }

                    await sleep(500);
                }

                const msg = `✅ 通用扫描${actionLabel}完成: ${successCount}/${images.length} 张`;
                this.setFailureReport('通用图片采集', failedItems);
                this.setStatus(
                    failedItems.length > 0 ? msg + `, ${failedItems.length} 失败` : msg,
                    failedItems.length > 0 ? 'error' : 'success'
                );
                this.updateProgress(100, msg);
            } catch (err) {
                Log.error('通用扫描异常:', err);
                this.setStatus('❌ 出错: ' + err.message, 'error');
            } finally {
                this.scanInProgress = false;
                this.setButtonsEnabled(true);
            }
        },

        /** 停止当前扫描 */
        stopScan() {
            if (this.scanner) {
                this.scanner.stop();
            }
            this.scanInProgress = false;
            this._isPaused = false;
            this.setButtonsEnabled(true);
            this.hideControls();
            this.setStatus('已停止', '');
            this.container.querySelector('#esp-btn-pause').textContent = '⏸️ 暂停';
        },

        /**
         * 获取当前页面的标签（从画廊详情页提取）
         */
        _getCurrentPageTags() {
            const pageConfig = this.siteInfo.pageConfig;
            if (pageConfig.tagsSelector) {
                const tagEls = document.querySelectorAll(pageConfig.tagsSelector);
                return Array.from(tagEls).map(el => el.textContent.trim()).filter(Boolean);
            }
            return [];
        },

        /**
         * Fab 专用：在图片全部导入结束后，做一次“补绑文件夹”。
         *
         * 为什么需要这一步：
         * 1. Eagle 的 item/add 返回 success 时，项目有时仍在后台入库；
         * 2. 此时立即 item/update 往往会返回 success，但 data=false，实际没写进去；
         * 3. 等整批图片导入完，再按 url / 文件名 / annotation 回查，就稳定得多。
         *
         * @param {Array<{fileName:string, sourceUrl:string, annotation:string, folderId:string}>} bindings
         * @returns {Promise<{success:number, failed:number}>}
         */
        async _finalizeFabFolderAssignments(bindings = []) {
            const tasks = Array.isArray(bindings) ? bindings.filter(Boolean) : [];
            if (tasks.length === 0) return { success: 0, failed: 0, pendingTasks: [] };

            let success = 0;
            let failed = 0;
            const pendingTasks = [];

            for (let i = 0; i < tasks.length; i++) {
                const task = tasks[i];
                if (!task.folderId) continue;

                let done = false;
                for (let attempt = 1; attempt <= 15; attempt++) {
                    try {
                        const itemInfo = await EagleAPI._request({
                            method: 'POST',
                            path: '/api/v2/item/get',
                            data: {
                                url: task.sourceUrl,
                                limit: 10,
                            },
                        });

                        const candidates = Array.isArray(itemInfo?.data?.data) ? itemInfo.data.data : [];
                        const matched =
                            candidates.find(item => item.name === task.fileName && item.annotation === task.annotation)
                            || candidates.find(item => item.name === task.fileName)
                            || candidates[0]
                            || null;

                        if (!matched || !matched.id) {
                            await sleep(1200);
                            continue;
                        }

                        const nextFolders = Array.from(new Set([...(matched.folders || []), task.folderId].filter(Boolean)));
                        const updateResult = await EagleAPI._request({
                            method: 'POST',
                            path: '/api/v2/item/update',
                            data: {
                                id: matched.id,
                                folders: nextFolders,
                            },
                        });

                        if (updateResult && updateResult.data !== false) {
                            done = true;
                            success++;
                            break;
                        }
                    } catch (err) {
                        // 继续重试
                    }

                    await sleep(1200);
                }

                if (!done) {
                    failed++;
                    pendingTasks.push(task);
                    Log.warn(`Fab 补绑文件夹失败: ${task.fileName} | ${task.sourceUrl}`);
                }
            }

            return { success, failed, pendingTasks };
        },

        /**
         * Fab 专用：在前台快速补绑失败后，继续后台慢速重试。
         * 这样即使 Eagle 仍在异步生成素材，也能在稍后自动归档进目标目录。
         *
         * @param {Array<{fileName:string, sourceUrl:string, annotation:string, folderId:string}>} bindings
         */
        _scheduleFabFolderBindingRetry(bindings = []) {
            const queue = Array.isArray(bindings) ? bindings.map(item => ({ ...item, _retryCount: 0 })) : [];
            if (queue.length === 0) return;

            const maxRounds = 18; // 最多后台重试约 18 * 10s = 3 分钟
            let round = 0;

            const runner = async () => {
                round++;
                const remaining = [];

                for (const task of queue.splice(0, queue.length)) {
                    try {
                        const result = await this._finalizeFabFolderAssignments([task]);
                        if (result.success > 0) {
                            continue;
                        }
                    } catch (err) {
                        // 忽略，继续加入剩余队列
                    }

                    task._retryCount++;
                    remaining.push(task);
                }

                if (remaining.length === 0) {
                    Log.info('Fab 后台文件夹补绑已全部完成');
                    return;
                }

                if (round >= maxRounds) {
                    Log.warn(`Fab 后台文件夹补绑结束，仍有 ${remaining.length} 项未完成`);
                    return;
                }

                queue.push(...remaining);
                Log.info(`Fab 后台文件夹补绑重试中: round=${round}, remaining=${remaining.length}`);
                setTimeout(runner, 10000);
            };

            setTimeout(runner, 10000);
        },

        /**
         * Fab 专用：等待主图切换完成。
         *
         * 由于点击缩略图后，Fab 不一定立刻替换主图资源，
         * 所以这里使用轮询等待，直到主图 URL 变化，或超时后读取当前主图。
         *
         * @param {string|null} previousUrl - 点击前主图 URL
         * @param {number} timeoutMs - 最长等待时间
         * @returns {Promise<{url:string,alt:string,width:number,height:number}|null>}
         */
        async _waitForFabMainMediaChange(previousUrl, timeoutMs = 3000) {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                const current = ImageExtractor.getFabMainMediaInfo();
                if (current && current.url && current.url !== previousUrl) {
                    return current;
                }
                await sleep(150);
            }
            return ImageExtractor.getFabMainMediaInfo();
        },

        /**
         * 从缩略图按钮 aria-label 中提取媒体序号。
         * @param {HTMLButtonElement|null} btn
         * @returns {number|null}
         */
        _getFabThumbnailIndex(btn) {
            if (!btn) return null;
            const label = btn.getAttribute('aria-label') || '';
            const match = label.match(/(\d+)\s*$/);
            return match ? parseInt(match[1], 10) : null;
        },

        /**
         * Fab 专用：遍历商品轮播图，收集完整媒体列表。
         *
         * 设计思路：
         * 1. 依次点击每个 “Display media N” 缩略图按钮
         * 2. 读取切换后的主图 URL
         * 3. 去重后形成最终待下载列表
         *
         * 这样可以解决“Fab 页面不是一次性全部加载大图”导致的漏图问题。
         *
         * @returns {Promise<Array<{url:string,name:string,index:number,alt:string}>>}
         */
        async _collectFabGalleryEntries() {
            /**
             * 第一优先级：直接读取页面 hydration JSON。
             * 这是目前 Fab 最稳定、最完整的采集方式：
             * - 能直接拿到完整 medias 列表
             * - 能拿到每张图的多种尺寸
             * - 不会误把缩略图当成最终下载图
             */
            const hydrationEntries = ImageExtractor.extractFabGalleryEntriesFromHydration();
            if (hydrationEntries.length > 0) {
                Log.info(`Fab hydration 提取完成: ${hydrationEntries.length} 张图片`);
                return hydrationEntries;
            }

            Log.warn('Fab hydration 未提取到图片，回退到 DOM 轮播扫描模式');

            const entries = [];
            const seenUrls = new Set();
            const processedIndexes = new Set();

            // 先尝试记录默认当前主图，避免用户正好停留在第一张时漏掉
            const initialMain = ImageExtractor.getFabMainMediaInfo();
            if (initialMain && initialMain.url) {
                seenUrls.add(initialMain.url);
                entries.push({
                    url: initialMain.url,
                    name: (new URL(initialMain.url)).pathname.split('/').pop() || 'fab_media_0.jpg',
                    index: 0,
                    alt: initialMain.alt || '',
                });
            }

            /**
             * 关键修复：
             * 旧逻辑只读取“首次进入页面时已经出现在 DOM 中的缩略图按钮”，
             * 这在某些 Fab 商品页里只能拿到前 6 张。
             *
             * 新逻辑改为：
             * 1. 找到横向缩略图滚动容器
             * 2. 每一屏都重新扫描当前可见按钮
             * 3. 处理完当前可见按钮后继续向右滚动
             * 4. 直到滚动到底部且没有新按钮出现为止
             *
             * 这样即使 Fab 使用“懒渲染 / 虚拟列表”，后面的图片也能被逐步发现。
             */
            const strip = ImageExtractor.getFabThumbnailStrip();
            const discoveredIndexes = new Set();
            const processVisibleButtons = async () => {
                const buttons = ImageExtractor.getFabThumbnailButtons();
                buttons.forEach(btn => {
                    const idx = this._getFabThumbnailIndex(btn);
                    if (idx !== null) discoveredIndexes.add(idx);
                });

                for (const btn of buttons) {
                    const mediaIndex = this._getFabThumbnailIndex(btn);
                    if (mediaIndex === null || processedIndexes.has(mediaIndex)) continue;

                    processedIndexes.add(mediaIndex);
                    const before = ImageExtractor.getFabMainMediaInfo();
                    const beforeUrl = before ? before.url : null;

                    try {
                        btn.click();
                    } catch (err) {
                        Log.warn(`Fab 缩略图点击失败 (media ${mediaIndex}):`, err.message);
                        continue;
                    }

                    const current = await this._waitForFabMainMediaChange(beforeUrl, 3500);
                    if (!current || !current.url) continue;

                    if (seenUrls.has(current.url)) continue;
                    seenUrls.add(current.url);

                    entries.push({
                        url: current.url,
                        name: (new URL(current.url)).pathname.split('/').pop() || `fab_media_${mediaIndex + 1}.jpg`,
                        index: mediaIndex,
                        alt: current.alt || '',
                    });
                }
            };

            if (!strip) {
                Log.warn('Fab 未找到缩略图滚动容器，回退到当前 DOM 按钮遍历模式');
                await processVisibleButtons();
                Log.info(`Fab 轮播遍历完成(回退模式): 收集 ${entries.length} 张图片`);
                return entries;
            }

            // 先回到最左侧，确保从第一屏开始完整扫描。
            strip.scrollLeft = 0;
            await sleep(250);

            const maxRounds = 30;
            for (let round = 0; round < maxRounds; round++) {
                const beforeScrollLeft = strip.scrollLeft;
                await processVisibleButtons();

                const reachedEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 8;
                if (reachedEnd) break;

                const step = Math.max(Math.floor(strip.clientWidth * 0.9), 320);
                strip.scrollLeft = Math.min(strip.scrollLeft + step, strip.scrollWidth);
                await sleep(350);

                // 如果滚动位置没动，说明已经到底，直接退出。
                if (Math.abs(strip.scrollLeft - beforeScrollLeft) < 4) {
                    break;
                }
            }

            Log.info(`Fab 缩略图发现序号: ${Array.from(discoveredIndexes).sort((a, b) => a - b).join(', ')}`);
            Log.info(`Fab 轮播遍历完成: 收集 ${entries.length} 张图片`);
            return entries;
        },

        /**
         * Fab 专用采集入口。
         * 这里优先走 hydration JSON 解析；
         * 若页面结构异常，再回退到轮播图 DOM 遍历。
         */
        async _startFabGalleryScan() {
            if (this.scanInProgress) return;
            if (!(await this.ensureActionReady())) return;
            this.scanInProgress = true;
            this.clearFailureReport();
            const actionMode = this.getActionMode();
            const actionLabel = getActionModeLabel(actionMode);

            this.expand();
            this.setButtonsEnabled(false);
            this.updateProgress(0, `正在解析 Fab 商品图片（${actionLabel}）...`);
            this.setStatus(`正在${actionLabel} Fab 商品图片...`);

            try {
                this.updateProgress(2, '正在读取 Fab 商品名称...');
                const listingNames = await getFabListingNamesAsync();
                const { originalName, localizedName } = listingNames;
                this.updateProgress(5, '正在准备 Eagle 目标目录...');
                this.folderId = await this.ensureFabTargetFolder(listingNames);
                const pageTags = this.buildScanTags([
                    'Fab',
                    originalName,
                    localizedName,
                ].filter(Boolean));
                this.updateProgress(8, '正在解析 Fab 商品图片...');
                const entries = await this._collectFabGalleryEntries();

                if (entries.length === 0) {
                    this.setStatus('未发现可采集的 Fab 图片', 'error');
                    this.updateProgress(0, '');
                    return;
                }

                Log.info(
                    'Fab 最终待采集列表:',
                    entries.map(item => `${item.index + 1}:${item.width || 0}x${item.height || 0} | ${item.url}`).join('\n')
                );

                Log.info(`Fab 当前输出模式：${actionLabel}（共 ${entries.length} 张）`);

                let successCount = 0;
                const failedItems = [];
                let nextIndex = 0;
                const worker = async () => {
                    while (true) {
                        const i = nextIndex++;
                        if (i >= entries.length) return;
                        const item = entries[i];
                        this.updateProgress(
                            Math.round((i / entries.length) * 100),
                            `Fab ${actionLabel}: ${i + 1}/${entries.length}`
                        );

                        try {
                            const fileName = buildFabFileName({
                                index: item.index,
                                sourceUrl: item.url,
                                mimeType: '',
                                listingNames,
                            });
                            const annotation = [
                                `Fab Media ${(item.index || 0) + 1}`,
                                `Page: ${window.location.href}`,
                                `Source: ${item.url}`,
                            ].join(' | ');

                            await this.outputImage({
                                fileName,
                                folderId: this.folderId,
                                tags: pageTags,
                                annotation,
                                website: window.location.href,
                                lookupUrl: window.location.href,
                                remoteUrl: item.url,
                                preferRemoteEagle: true,
                                fetchOptions: {
                                    credentials: 'include',
                                    headers: {
                                        'User-Agent': navigator.userAgent,
                                        'Referer': window.location.href,
                                    },
                                },
                                gmOptions: {
                                    headers: {
                                        'User-Agent': navigator.userAgent,
                                        'Referer': window.location.href,
                                    },
                                    timeout: 30000,
                                    maxRetries: 2,
                                    delayMs: 1500,
                                },
                            });

                            successCount++;
                        } catch (err) {
                            failedItems.push({ url: item.url, error: err.message });
                            Log.error(`Fab 专用采集失败 (${i + 1}/${entries.length}):`, err.message);
                        }

                        // 保留极短让步，避免连续回调压满页面主线程。
                        await sleep(30);
                    }
                };
                await Promise.all(Array.from({ length: Math.min(3, entries.length) }, () => worker()));

                const msg = `✅ Fab ${actionLabel}完成: ${successCount}/${entries.length} 张`;
                this.setFailureReport('Fab 图片采集', failedItems);
                this.setStatus(
                    failedItems.length > 0 ? msg + `, ${failedItems.length} 失败` : msg,
                    failedItems.length > 0 ? 'error' : 'success'
                );
                this.updateProgress(100, msg);
            } catch (err) {
                Log.error('Fab 专用采集异常:', err);
                this.setStatus('❌ Fab 采集异常: ' + err.message, 'error');
            } finally {
                this.scanInProgress = false;
                this.setButtonsEnabled(true);
            }
        },
    };

    // ╔══════════════════════════════════════════════════════════════╗
    // ║         8. 主入口 —— 站点检测 & 面板启动                      ║
    // ╚══════════════════════════════════════════════════════════════╝

    async function main() {
        try {
        Log.info('========================================');
        Log.info('Eagle 多网站图片批量抓取脚本 v1.0.0');
        Log.info('========================================');

        // ── 步骤 1：检测当前站点并匹配规则 ──
        // 🔍 诊断步骤 1：检查站点匹配
        console.log('[EagleScraper] 🔍 开始站点匹配...hostname=', window.location.hostname, 'href=', window.location.href);
        const siteInfo = matchSiteRule();
        console.log('[EagleScraper] 🔍 matchSiteRule 结果:', siteInfo ? JSON.stringify({siteKey: siteInfo.siteKey, pageType: siteInfo.pageType}) : 'null（未匹配）');

        if (!siteInfo) {
            Log.info('当前网站未配置规则，脚本不做任何处理');
            return; // 静默退出，不注入面板
        }

        Log.info(`检测到站点: ${siteInfo.siteConfig.name} (${siteInfo.siteKey})`);
        Log.info(`页面类型: ${siteInfo.pageType}`);
        Log.info(`当前 URL: ${window.location.href}`);

        // ── 步骤 2：等待页面 DOM 加载完成 ──
        // 某些网站（如 Fab.com）是 SPA，需要等待渲染
        await sleep(1500);

        // ── 步骤 3：注入 UI 面板（先显示面板，不阻塞）──
        console.log('[EagleScraper] 🔍 开始注入面板...document.body=', !!document.body);
        UIPanel.init(siteInfo);
        console.log('[EagleScraper] 🔍 面板注入完成，container=', !!UIPanel.container);

        // ── 步骤 4：异步检测 Eagle 并加载文件夹列表（不阻塞面板显示）──
        // loadFolders 已经包含连接检测；只保留这一条链路，避免两个并发检测互相覆盖状态。
        UIPanel.loadFolders().then(alive => {
            if (alive) Log.info('✅ Eagle 已连接');
            else Log.warn('⚠️ Eagle 未运行，面板仍会显示（采集时会报错）');
        }).catch(err => {
            // 如果目录/标签已经读到，说明 Eagle 通路成立；这里只记录初始化异常，
            // 不允许迟到的 Promise reject 覆盖成“未启动”。
            if (!UIPanel.eagleAvailable && UIPanel.folders.length === 0 && UIPanel.eagleTags.length === 0) {
                UIPanel.setEagleConnectionStatus('disconnected');
            } else {
                UIPanel.eagleAvailable = true;
                UIPanel.setEagleConnectionStatus('connected');
            }
            Log.warn('⚠️ Eagle 状态初始化失败:', err?.message || err);
        });

        // ── 步骤 5：针对不同站点/页面类型调整 UI ──
        adjustUIForPageType(siteInfo);

        /**
         * ── SPA 路由监听 ──
         * Fab / E-Hentai 都是单页应用，站内跳转不会刷新页面。
         * siteInfo 若不跟随 URL 更新，从首页点进商品页时仍按 any_page
         * 通用扫描执行：图片照常入库（存到手动选择的目录），但永远不会
         * 自动新建目录——这正是“能存图却不见新文件夹”的来源。
         * 这里用轻量轮询检测 URL 变化，同站点内更新页面类型并重刷按钮形态。
         */
        let lastRouteUrl = window.location.href;
        window.setInterval(() => {
            if (window.location.href === lastRouteUrl) return;
            // 采集进行中暂不切换；lastRouteUrl 不更新，结束后下一轮自动补上
            if (UIPanel.scanInProgress) return;
            lastRouteUrl = window.location.href;
            const fresh = matchSiteRule();
            if (!fresh || !UIPanel.siteInfo) return;
            if (fresh.siteKey !== UIPanel.siteInfo.siteKey) return;
            if (fresh.pageType === UIPanel.siteInfo.pageType
                && fresh.pageConfig === UIPanel.siteInfo.pageConfig) return;
            UIPanel.siteInfo = fresh;
            adjustUIForPageType(fresh);
            Log.info('SPA 路由变化，页面类型已更新:', fresh.pageType);
        }, 1000);

        Log.info('初始化完成，等待用户操作...');
        } catch (err) {
            Log.error('脚本初始化失败:', err.message, err.stack);
            // 在页面上显示可见的错误提示
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999;background:#e74c3c;color:#fff;padding:12px 16px;border-radius:8px;font-size:13px;font-family:sans-serif;max-width:350px;box-shadow:0 4px 16px rgba(0,0,0,0.3);';
            errorDiv.textContent = '🐛 Eagle Scraper 错误: ' + err.message;
            try { document.body.appendChild(errorDiv); } catch(e2) { console.error('无法添加错误提示', e2); }
        }
    }

    /**
     * 根据页面类型调整 UI 显示
     * @param {object} siteInfo - 站点匹配结果
     */
    function adjustUIForPageType(siteInfo) {
        const pageType = siteInfo.pageType;
        const autoFolderRow = UIPanel.container.querySelector('#esp-auto-folder-row');

        // 默认隐藏 Fab 专属的自动建目录开关，只有商品页相关场景才显示。
        if (autoFolderRow) autoFolderRow.style.display = 'none';

        // E-Hentai / ExHentai 画廊详情页：显示深度扫描按钮与自动建目录
        if (pageType === 'gallery_detail') {
            const deepBtn = UIPanel.container.querySelector('#esp-btn-deep-scan');
            const currentBtn = UIPanel.container.querySelector('#esp-btn-current-page');
            const genericBtn = UIPanel.container.querySelector('#esp-btn-generic-scan');

            if (deepBtn) deepBtn.style.display = 'block';
            if (currentBtn) {
                currentBtn.style.display = 'block';
                currentBtn.textContent = '📸 采集当前页（20张）';
            }
            // 画廊详情页已有规则适配，隐藏通用扫描
            if (genericBtn) genericBtn.style.display = 'none';
            if (autoFolderRow) autoFolderRow.style.display = UIPanel.isLocalMode() ? 'none' : 'flex';
        }

        // E-Hentai 图片查看器：只显示当前页采集，也沿用当前画廊自动目录
        if (pageType === 'image_viewer') {
            const deepBtn = UIPanel.container.querySelector('#esp-btn-deep-scan');
            const currentBtn = UIPanel.container.querySelector('#esp-btn-current-page');
            const genericBtn = UIPanel.container.querySelector('#esp-btn-generic-scan');

            if (deepBtn) deepBtn.style.display = 'none';
            if (currentBtn) {
                currentBtn.style.display = 'block';
                currentBtn.textContent = '📸 采集当前图片';
            }
            if (genericBtn) genericBtn.style.display = 'none';
            if (autoFolderRow) autoFolderRow.style.display = UIPanel.isLocalMode() ? 'none' : 'flex';
        }

        // E-Hentai 画廊列表页
        if (pageType === 'gallery_list') {
            const deepBtn = UIPanel.container.querySelector('#esp-btn-deep-scan');
            const currentBtn = UIPanel.container.querySelector('#esp-btn-current-page');
            const genericBtn = UIPanel.container.querySelector('#esp-btn-generic-scan');

            if (deepBtn) deepBtn.style.display = 'none';
            if (currentBtn) {
                currentBtn.style.display = 'block';
                currentBtn.textContent = '📸 采集当前页缩略图';
            }
            if (genericBtn) genericBtn.style.display = 'block';
        }

        // Fab.com：仅显示通用扫描（含任意页面兜底）
        if (pageType === 'listing_detail' || pageType === 'any_page') {
            const deepBtn = UIPanel.container.querySelector('#esp-btn-deep-scan');
            const currentBtn = UIPanel.container.querySelector('#esp-btn-current-page');
            const genericBtn = UIPanel.container.querySelector('#esp-btn-generic-scan');

            if (deepBtn) deepBtn.style.display = 'none';
            if (currentBtn) currentBtn.style.display = 'none';
            if (genericBtn) {
                genericBtn.style.display = 'block';
                UIPanel.setGenericButtonLabel('开始采集');
            }
            if (autoFolderRow) autoFolderRow.style.display = UIPanel.isLocalMode() ? 'none' : 'flex';
        }
    }

    // ╔══════════════════════════════════════════════════════════════╗
    // ║         9. 启动                                              ║
    // ╚══════════════════════════════════════════════════════════════╝

    // 页面加载完成后启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }

})();
