/**
 * eagle-ui.js —— Eagle 采集插件家族 · 共享 UI 设计库
 * ============================================================
 *
 * 定位：所有 eagle-*-collector 油猴脚本共用的前端设计体系（单一事实源）。
 * 各脚本通过 Tampermonkey 的 @require 引用本文件：
 *
 *   // @require https://cdn.jsdelivr.net/gh/baimoushare/eagle-plugin@main/eagle-ui.js
 *
 * 修改本文件 → push → 访问 purge.jsdelivr.net 同路径清缓存，
 * 全部已安装脚本即统一换上新 UI，无需逐个改脚本。
 *
 * 设计基因来源：eagle-fab-collector 的面板视觉体系（毛玻璃、白玻璃控件、
 * 蓝色选中态、缓出动画曲线），视觉数值全部收敛为 --egc-* 设计令牌。
 *
 * 版本规范：语义化。破坏组件 API 时升主版本；新增组件/令牌升次版本；
 * 仅调整视觉数值升修订版本。EagleUI.version 会在控制台可查，便于排查
 * 用户端实际加载到的是哪一版。
 *
 * 命名规约：CSS 类与变量统一 egc- 前缀（Eagle Collector），
 * 避免与目标站点样式、各脚本历史前缀（esp-/tmd-/edd-）冲突。
 *
 * 幂等性：多个脚本匹配同一页面时，Tampermonkey 会为每个脚本各注入
 * 一份本库 —— 全局挂载与样式注入均做了防重复处理，重复执行无害。
 */
(function () {
    'use strict';

    // 幂等守卫：同页第二个脚本再次 @require 本库时，直接复用已挂载实例
    if (typeof window !== 'undefined' && window.EagleUI && window.EagleUI.version) {
        return;
    }

    /** 库版本号（排查"用户用的是哪版 UI"的依据） */
    const VERSION = '1.0.0';

    /**
     * 设计令牌 + 组件样式（单一 CSS 文本，注入一次）。
     * 所有可调视觉参数均以 --egc-* 变量声明在 .egc-launcher / .egc-panel 上，
     * 后续家族级调优（换色、改圆角、收窄间距）只改这一块。
     */
    const CSS = `
/* ── 设计令牌（源自 eagle-fab 面板视觉体系） ── */
.egc-launcher, .egc-panel {
    --egc-bg: rgba(26, 28, 34, 0.68);
    --egc-bg-hover: rgba(35, 38, 47, 0.88);
    --egc-bg-open: rgba(38, 42, 52, 0.92);
    --egc-border: rgba(255, 255, 255, 0.12);
    --egc-border-soft: rgba(255, 255, 255, 0.10);
    --egc-border-strong: rgba(255, 255, 255, 0.22);
    --egc-divider: rgba(255, 255, 255, 0.08);
    --egc-radius: 14px;
    --egc-radius-sm: 10px;
    --egc-radius-chip: 7px;
    --egc-shadow: 0 16px 44px rgba(4, 10, 20, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    --egc-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --egc-fg: #edf1f7;
    --egc-fg-bright: #f6f8fb;
    --egc-fg-dim: rgba(235, 240, 248, 0.72);
    --egc-fg-faint: rgba(235, 240, 248, 0.62);
    --egc-fg-fainter: rgba(235, 240, 248, 0.46);
    --egc-accent-border: rgba(171, 214, 255, 0.7);
    --egc-accent-bg: rgba(146, 186, 224, 0.16);
    --egc-control-bg: rgba(255, 255, 255, 0.06);
    --egc-control-bg-hover: rgba(255, 255, 255, 0.10);
    --egc-ease: cubic-bezier(0.16, 1, 0.3, 1);
    font-family: var(--egc-font);
}

/* ── 悬浮启动钮（圆形毛玻璃） ── */
.egc-launcher {
    position: fixed;
    top: 18px;
    right: 18px;
    z-index: 100000;
    width: 46px;
    height: 46px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 50%;
    background: rgba(29, 32, 40, 0.78);
    color: #f6f8fb;
    box-shadow: 0 12px 26px rgba(10, 14, 22, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    cursor: pointer;
    transition: transform 180ms ease, background 180ms ease;
}
.egc-launcher svg { width: 26px; height: 26px; display: block; }
.egc-launcher:hover { transform: translateY(-2px) scale(1.035); background: var(--egc-bg-hover); }
.egc-launcher.is-open { background: var(--egc-bg-open); border-color: rgba(255, 255, 255, 0.22); }

/* ── 面板容器（毛玻璃卡片，is-open 控制开合） ── */
.egc-panel {
    position: fixed;
    top: 76px;
    right: 18px;
    z-index: 99999;
    width: min(300px, calc(100vw - 36px));
    box-sizing: border-box;
    padding: 12px 14px 14px;
    border-radius: var(--egc-radius);
    background: var(--egc-bg);
    color: var(--egc-fg);
    backdrop-filter: blur(18px) saturate(140%);
    -webkit-backdrop-filter: blur(18px) saturate(140%);
    box-shadow: var(--egc-shadow);
    border: 1px solid var(--egc-border);
    font-size: 13px;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(-8px) scale(0.98);
    transform-origin: top right;
    transition:
        transform 220ms var(--egc-ease),
        opacity 180ms ease,
        visibility 180ms ease;
}
.egc-panel.is-open {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateY(0) scale(1);
}

/* ── 标题 / 状态 / 进度文本 ── */
.egc-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; color: var(--egc-fg-bright); }
.egc-status, .egc-progress {
    font-size: 11px;
    line-height: 1.45;
    color: var(--egc-fg-dim);
}
.egc-progress { margin-top: 2px; min-height: 16px; }

/* ── 进度条（可选组件，配合 .egc-progress 使用） ── */
.egc-progress-bar-outer {
    height: 6px;
    margin-top: 6px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    overflow: hidden;
}
.egc-progress-bar-inner {
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, rgba(228, 233, 240, 0.78), rgba(255, 255, 255, 0.96));
    border-radius: 999px;
    transition: width 0.3s ease;
}

/* ── 字段分组（顶部分隔线 + 标签） ── */
.egc-field { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--egc-divider); }
.egc-label {
    font-size: 11px;
    color: var(--egc-fg-faint);
    margin-bottom: 6px;
    max-width: 100%;
    overflow-wrap: anywhere;
}

/* ── 输入框 / 下拉框（白玻璃底） ── */
.egc-select, .egc-input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--egc-border-soft);
    border-radius: var(--egc-radius-sm);
    background: var(--egc-control-bg);
    color: var(--egc-fg);
    padding: 8px 10px;
    font-size: 12px;
    font-family: var(--egc-font);
    outline: none;
    transition: border-color 160ms ease, background 160ms ease;
}
.egc-select:focus, .egc-input:focus {
    border-color: var(--egc-border-strong);
    background: rgba(255, 255, 255, 0.08);
}
/* 原生下拉的选项面板无法继承毛玻璃，用深色实底保证可读 */
.egc-select option { background: #14171e; color: #f8fafc; }

/* ── 已选标签 chip 流 ── */
.egc-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.egc-tag-chip {
    padding: 3px 8px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: var(--egc-radius-chip);
    background: var(--egc-control-bg);
    color: rgba(237, 241, 247, 0.88);
    font-size: 11px;
    font-family: var(--egc-font);
    cursor: pointer;
}
.egc-tag-chip:hover { background: var(--egc-control-bg-hover); color: #fff; }
.egc-tag-chip.is-selected {
    border-color: var(--egc-accent-border);
    background: var(--egc-accent-bg);
    color: #fff;
}

/* ── Eagle 标签目录（可点选 chip 流，滚动区域） ── */
.egc-tag-catalog {
    margin-top: 6px;
    max-height: 96px;
    overflow-y: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    align-content: flex-start;
    font-size: 11px;
    color: var(--egc-fg-fainter);
    scrollbar-width: thin;
}
.egc-tag-catalog::-webkit-scrollbar { width: 6px; }
.egc-tag-catalog::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.16); border-radius: 999px; }
.egc-tag-catalog-chip {
    padding: 2px 7px;
    border: 1px solid var(--egc-border-soft);
    border-radius: 6px;
    background: transparent;
    color: rgba(237, 241, 247, 0.72);
    font-size: 11px;
    font-family: var(--egc-font);
    cursor: pointer;
}
.egc-tag-catalog-chip:hover { background: var(--egc-control-bg-hover); color: #fff; }
.egc-tag-catalog-chip.is-selected {
    border-color: var(--egc-accent-border);
    background: var(--egc-accent-bg);
    color: #fff;
}

/* ── 按钮区 / 按钮（primary 为主操作，ghost 为轻操作） ── */
.egc-actions { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
.egc-btn {
    appearance: none;
    border: 1px solid var(--egc-border-soft);
    background: var(--egc-control-bg);
    color: #f5f7fb;
    border-radius: var(--egc-radius-sm);
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 500;
    font-family: var(--egc-font);
    cursor: pointer;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    transition: transform 140ms ease, background 180ms ease, border-color 180ms ease;
}
.egc-btn:hover {
    background: var(--egc-control-bg-hover);
    border-color: rgba(255, 255, 255, 0.18);
    transform: translateY(-1px);
}
.egc-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
.egc-btn.primary {
    background: rgba(255, 255, 255, 0.14);
    border-color: rgba(255, 255, 255, 0.20);
}
.egc-btn.ghost { background: transparent; }

/* ── 无障碍：用户开启"减少动态效果"时关闭动画 ── */
@media (prefers-reduced-motion: reduce) {
    .egc-launcher, .egc-panel, .egc-btn { transition: none !important; }
}
`;

    /** 样式是否已注入（data 标记挂在 style 标签上，跨脚本共享检查） */
    function injectStyles() {
        const MARKER = 'data-eagle-ui-version';
        if ((document.head || document.documentElement).querySelector(`style[${MARKER}]`)) return;
        const style = document.createElement('style');
        style.textContent = CSS;
        // 记录库版本，控制台可查（document.head 里能看到当前生效的 UI 版本）
        style.setAttribute(MARKER, VERSION);
        (document.head || document.documentElement).appendChild(style);
    }

    /**
     * 创建悬浮启动钮（圆形毛玻璃按钮）。
     * @param {Object} opts
     * @param {string} opts.icon      SVG 内联字符串（currentColor 描边）
     * @param {string} opts.title     悬停提示文案
     * @param {string} [opts.top]     顶部偏移，默认 18px
     * @param {string} [opts.right]   右侧偏移，默认 18px
     * @returns {{el: HTMLButtonElement, setOpen: (open: boolean) => void}}
     */
    function createLauncher(opts) {
        injectStyles();
        const o = opts || {};
        const launcher = document.createElement('button');
        launcher.type = 'button';
        launcher.className = 'egc-launcher';
        launcher.title = o.title || 'Eagle 采集';
        launcher.innerHTML = o.icon || '';
        if (o.top) launcher.style.top = o.top;
        if (o.right) launcher.style.right = o.right;
        return {
            el: launcher,
            // 与面板开合状态同步高亮（is-open）
            setOpen(open) { launcher.classList.toggle('is-open', !!open); },
        };
    }

    /**
     * 创建面板容器（毛玻璃卡片，自带开合动画与句柄方法）。
     * 面板内部的内容结构由各站点脚本用 egc-* 类自行填充，
     * 保证"外观归库、内容与行为归脚本"的边界。
     * @param {Object} opts
     * @param {string} [opts.top]     顶部偏移，默认 76px（衔接 46px 启动钮）
     * @param {string} [opts.right]   右侧偏移，默认 18px
     * @param {number} [opts.width]   面板宽度，默认 300
     * @returns {{el: HTMLDivElement, open: () => void, close: () => void,
     *            toggle: () => boolean, isOpen: () => boolean}}
     */
    function createPanel(opts) {
        injectStyles();
        const o = opts || {};
        const panel = document.createElement('div');
        panel.className = 'egc-panel';
        if (o.top) panel.style.top = o.top;
        if (o.right) panel.style.right = o.right;
        if (o.width) panel.style.width = `min(${o.width}px, calc(100vw - 36px))`;
        return {
            el: panel,
            open() { panel.classList.add('is-open'); },
            close() { panel.classList.remove('is-open'); },
            toggle() { return panel.classList.toggle('is-open'); },
            isOpen() { return panel.classList.contains('is-open'); },
        };
    }

    // 挂载全局：Tampermonkey / Violentmonkey 的 @require 与脚本本体
    // 运行在同一沙箱函数作用域，挂 window 保证跨管理器可见。
    window.EagleUI = {
        version: VERSION,
        css: CSS,
        injectStyles,
        createLauncher,
        createPanel,
    };
})();
