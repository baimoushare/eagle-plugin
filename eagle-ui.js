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
 * 设计基因来源：eagle-fab-collector 的面板与选择器视觉体系（毛玻璃、白玻璃
 * 控件、蓝色选中态、缓出动画曲线、body 顶层弹层选择器），视觉数值全部
 * 收敛为 --egc-* 设计令牌。
 *
 * 版本规范：语义化。破坏组件 API 时升主版本；新增组件/令牌升次版本；
 * 仅调整视觉数值升修订版本。EagleUI.version 会在面板版本徽标与控制台可见，
 * 便于排查用户端实际加载到的是哪一版。
 *
 * 命名规约：CSS 类与变量统一 egc- 前缀（Eagle Collector），
 * 避免与目标站点样式、各脚本历史前缀（esp-/tmd-/edd-）冲突。
 *
 * 幂等性：多个脚本匹配同一页面时，Tampermonkey 会为每个脚本各注入
 * 一份本库 —— 全局挂载与样式注入均做了防重复处理，重复执行无害。
 *
 * 组件清单：
 * - createLauncher(opts)       悬浮启动圆钮
 * - createPanel(opts)          毛玻璃面板容器（开合动画）
 * - createFolderPicker(opts)   Eagle 文件夹选择器（弹层：搜索+树+多选/单选）
 * - createTagPicker(opts)      Eagle 标签选择器（弹层：搜索+已选+最近+列表+手输）
 * - versionBadge()             面板版本徽标（确认"用户跑的是哪版 UI"）
 */
(function () {
    'use strict';

    // 幂等守卫：同页第二个脚本再次 @require 本库时，直接复用已挂载实例
    if (typeof window !== 'undefined' && window.EagleUI && window.EagleUI.version) {
        return;
    }

    /** 库版本号（排查"用户用的是哪版 UI"的依据） */
    const VERSION = '1.1.0';

    /**
     * 设计令牌 + 组件样式（单一 CSS 文本，注入一次）。
     * 所有可调视觉参数均以 --egc-* 变量声明在面板/弹层根上，
     * 后续家族级调优（换色、改圆角、收窄间距）只改这一块。
     */
    const CSS = `
/* ── 设计令牌（源自 eagle-fab 面板视觉体系） ── */
.egc-launcher, .egc-panel, .egc-menu {
    --egc-bg: rgba(26, 28, 34, 0.68);
    --egc-bg-hover: rgba(35, 38, 47, 0.88);
    --egc-bg-open: rgba(38, 42, 52, 0.92);
    --egc-menu-bg: rgba(20, 23, 30, 0.98);
    --egc-border: rgba(255, 255, 255, 0.12);
    --egc-border-soft: rgba(255, 255, 255, 0.10);
    --egc-border-strong: rgba(255, 255, 255, 0.22);
    --egc-divider: rgba(255, 255, 255, 0.08);
    --egc-radius: 14px;
    --egc-radius-sm: 10px;
    --egc-radius-chip: 7px;
    --egc-shadow: 0 16px 44px rgba(4, 10, 20, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    --egc-menu-shadow: 0 18px 40px rgba(5, 10, 18, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    --egc-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --egc-fg: #edf1f7;
    --egc-fg-bright: #f6f8fb;
    --egc-fg-dim: rgba(235, 240, 248, 0.72);
    --egc-fg-faint: rgba(235, 240, 248, 0.62);
    --egc-fg-fainter: rgba(235, 240, 248, 0.46);
    --egc-accent-border: rgba(171, 214, 255, 0.7);
    --egc-accent-bg: rgba(146, 186, 224, 0.16);
    --egc-accent-checkbox: rgba(177, 215, 248, 0.22);
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

/* ── 标题 / 状态 / 进度文本 / 版本徽标 ── */
.egc-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; color: var(--egc-fg-bright); }
.egc-status, .egc-progress {
    font-size: 11px;
    line-height: 1.45;
    color: var(--egc-fg-dim);
}
.egc-progress { margin-top: 2px; min-height: 16px; }
/* 版本徽标：面板上直观确认当前生效的库版本 */
.egc-version {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 999px;
    color: var(--egc-fg-fainter);
    font-size: 9px;
    font-weight: 400;
    vertical-align: 1px;
    cursor: default;
}

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
.egc-btn.primary { background: rgba(255, 255, 255, 0.14); border-color: rgba(255, 255, 255, 0.20); }
.egc-btn.ghost { background: transparent; }

/* ── 简易 chip（面板内静态展示用；选择器内另有专属 chip 体系） ── */
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

/* ════════════════════════════════════════════════════════════
   弹层选择器（源自 fab：菜单挂 body 顶层，fixed 定位，
   不受面板 overflow 裁切，也不被站点样式污染）
   ════════════════════════════════════════════════════════════ */
@keyframes egcMenuIn {
    from { opacity: 0; transform: translateY(-4px) scale(0.985); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
}
.egc-menu {
    position: fixed;
    z-index: 1000000;
    display: none;
    width: min(420px, calc(100vw - 20px));
    box-sizing: border-box;
    padding: 8px;
    overflow: hidden;
    border-radius: 12px;
    background: var(--egc-menu-bg);
    border: 1px solid var(--egc-border);
    box-shadow: var(--egc-menu-shadow);
    backdrop-filter: blur(18px) saturate(140%);
    -webkit-backdrop-filter: blur(18px) saturate(140%);
    font-family: var(--egc-font);
    color: var(--egc-fg);
}
.egc-menu.open {
    display: flex;
    flex-direction: column;
    animation: egcMenuIn 160ms cubic-bezier(0.16, 1, 0.3, 1);
}
/* 菜单头部（搜索框 + 模式说明，sticky 顶部） */
.egc-picker-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
    position: sticky;
    top: 0;
    z-index: 2;
    padding-bottom: 8px;
    margin-bottom: 4px;
    background: linear-gradient(180deg, rgba(20, 23, 30, 0.98), rgba(20, 23, 30, 0.88));
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
}
.egc-menu-search {
    flex: 1;
    min-width: 0;
    height: 36px;
    padding: 0 12px;
    appearance: none !important;
    -webkit-appearance: none !important;
    border: 1px solid rgba(255, 255, 255, 0.10) !important;
    border-radius: 10px !important;
    background: rgba(255, 255, 255, 0.06) !important;
    color: rgba(244, 247, 251, 0.96) !important;
    -webkit-text-fill-color: rgba(244, 247, 251, 0.96) !important;
    caret-color: rgba(244, 247, 251, 0.96) !important;
    opacity: 1 !important;
    visibility: visible !important;
    text-shadow: none !important;
    font-size: 12px;
    font-family: var(--egc-font);
    outline: none;
    box-sizing: border-box;
    box-shadow: none !important;
    transition: border-color 160ms ease, background 160ms ease;
}
.egc-menu-search:hover { border-color: rgba(255, 255, 255, 0.24) !important; }
.egc-menu-search:focus,
.egc-menu-search:focus-visible {
    border-color: rgba(171, 214, 255, 0.82) !important;
    background: rgba(255, 255, 255, 0.09) !important;
    box-shadow: 0 0 0 3px rgba(138, 196, 245, 0.16) !important;
}
.egc-menu-search::placeholder { color: rgba(235, 240, 248, 0.42) !important; opacity: 1 !important; }
.egc-picker-mode {
    flex: 0 0 auto;
    color: rgba(235, 240, 248, 0.46);
    font-size: 10px;
    white-space: nowrap;
}
/* 最近使用 chip 行（文件夹菜单顶部 / 标签菜单内均用） */
.egc-menu-recent {
    flex: 0 0 auto;
    display: none;
    gap: 5px;
    overflow-x: auto;
    padding: 1px 0 5px;
    scrollbar-width: none;
}
.egc-menu-recent.has-items { display: flex; }
.egc-menu-recent::-webkit-scrollbar { display: none; }
.egc-recent-chip {
    flex: 0 0 auto;
    max-width: 170px;
    min-width: 0;
    padding: 5px 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(237, 241, 247, 0.78);
    font-size: 10px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.egc-recent-chip:hover { background: rgba(255, 255, 255, 0.10); color: #fff; }
/* 菜单底部（操作提示 + 完成按钮） */
.egc-menu-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding-top: 8px;
    margin-top: 6px;
    border-top: 1px solid var(--egc-divider);
    color: rgba(235, 240, 248, 0.42);
    font-size: 10px;
    flex: 0 0 auto;
    min-height: 26px;
}
.egc-menu-done {
    margin-left: auto;
    padding: 4px 9px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(248, 250, 253, 0.88);
    font-size: 10px;
    cursor: pointer;
}
.egc-menu-done:hover { background: rgba(255, 255, 255, 0.14); border-color: rgba(255, 255, 255, 0.24); }
/* 菜单滚动条 */
.egc-menu-tree::-webkit-scrollbar,
.egc-tag-list::-webkit-scrollbar { width: 7px; }
.egc-menu-tree::-webkit-scrollbar-thumb,
.egc-tag-list::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.16); border-radius: 999px; }

/* ── 选择器触发按钮（文件夹与标签共用形态） ── */
.egc-folder-select-wrap, .egc-tag-select-wrap { position: relative; }
.egc-folder-trigger, .egc-tag-trigger {
    width: 100%;
    max-width: 100% !important;
    min-width: 0 !important;
    min-height: 40px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(237, 241, 247, 0.92);
    font-size: 12px;
    font-family: var(--egc-font);
    text-align: left;
    cursor: pointer;
    box-sizing: border-box;
    overflow: hidden;
    transition: border-color 160ms ease, background 160ms ease;
}
.egc-tag-trigger { justify-content: space-between; }
.egc-folder-trigger:hover,
.egc-folder-select-wrap.open .egc-folder-trigger,
.egc-tag-trigger:hover,
.egc-tag-select-wrap.open .egc-tag-trigger {
    border-color: rgba(255, 255, 255, 0.20);
    background: rgba(255, 255, 255, 0.09);
}
.egc-folder-trigger-text, .egc-tag-trigger-text {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.egc-tag-trigger-meta {
    flex: 0 0 auto;
    max-width: 42%;
    color: rgba(235, 240, 248, 0.48);
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.egc-folder-trigger-icon {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    color: rgba(235, 240, 248, 0.55);
    transition: transform 160ms var(--egc-ease);
}
.egc-folder-select-wrap.open .egc-folder-trigger-icon { transform: rotate(180deg); }

/* ── 文件夹树选项 ── */
.egc-menu-tree {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    padding: 2px 2px 8px 0;
}
.egc-folder-option {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 30px;
    padding: 4px 8px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: rgba(237, 241, 247, 0.88);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: background 160ms ease, color 160ms ease, transform 140ms ease;
    box-sizing: border-box;
}
.egc-folder-option:hover { background: rgba(255, 255, 255, 0.08); color: rgba(248, 250, 253, 0.98); }
.egc-folder-option:active { transform: scale(0.992); }
.egc-folder-option.active { background: rgba(255, 255, 255, 0.10); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); color: #ffffff; }
.egc-folder-option-label {
    flex: 1;
    order: 3;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.egc-folder-option-checkbox {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid rgba(235, 240, 248, 0.42);
    border-radius: 4px;
    background: transparent;
    color: rgba(248, 250, 253, 0.96);
    cursor: pointer;
    order: 1;
}
.egc-folder-option-checkbox:hover,
.egc-folder-option-checkbox.checked {
    border-color: rgba(177, 215, 248, 0.84);
    background: var(--egc-accent-checkbox);
}
.egc-folder-option-checkbox svg { width: 14px; height: 14px; }
.egc-folder-option-icon {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: rgba(237, 241, 247, 0.62);
    order: 2;
}
.egc-folder-option-icon svg { width: 18px; height: 18px; }
.egc-folder-option-toggle {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: rgba(237, 241, 247, 0.50);
    flex-shrink: 0;
    cursor: pointer;
    order: 4;
    transition: transform 160ms ease, color 160ms ease;
}
.egc-folder-option-toggle:hover { background: rgba(255, 255, 255, 0.08); color: rgba(248, 250, 253, 0.92); }
.egc-folder-option-toggle.expanded { transform: rotate(90deg); color: rgba(248, 250, 253, 0.82); }
.egc-folder-option-spacer { width: 28px; height: 28px; margin-left: auto; flex-shrink: 0; order: 4; }
.egc-folder-group { display: flex; flex-direction: column; gap: 4px; width: 100%; min-width: 0; }
.egc-folder-empty, .egc-tag-empty {
    padding: 12px 8px;
    color: rgba(235, 240, 248, 0.48);
    font-size: 11px;
    text-align: center;
}

/* ── 标签菜单内部件 ── */
.egc-selected-tags {
    display: none;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    padding: 4px 0 7px;
    border-bottom: 1px solid var(--egc-divider);
}
.egc-selected-tags.has-items { display: flex; }
.egc-selected-tag {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    max-width: 150px;
    height: 24px;
    padding: 0 5px 0 8px;
    border: 1px solid rgba(177, 215, 248, 0.32);
    border-radius: 999px;
    background: rgba(139, 177, 211, 0.16);
    color: rgba(240, 246, 252, 0.92);
    font-size: 11px;
}
.egc-selected-tag-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.egc-selected-tag-remove {
    width: 18px;
    height: 18px;
    margin-left: 3px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: rgba(240, 246, 252, 0.64);
    font-size: 14px;
    line-height: 18px;
    cursor: pointer;
}
.egc-selected-tag-remove:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }
.egc-selected-tags-clear {
    margin-left: auto;
    padding: 3px 5px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: rgba(235, 240, 248, 0.58);
    font-size: 10px;
    cursor: pointer;
}
.egc-selected-tags-clear:hover { background: rgba(255, 255, 255, 0.08); color: rgba(248, 250, 253, 0.94); }
.egc-tag-recent.has-items {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 4px;
    padding: 1px 0 4px;
}
.egc-tag-recent .egc-recent-chip {
    width: 100%;
    max-width: none;
    min-height: 26px;
    padding: 3px 5px;
    border-color: transparent;
    border-radius: 6px;
    background: transparent;
    font-size: 11px;
    text-align: left;
}
.egc-tag-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    padding: 1px 2px 4px 0;
}
.egc-tag-items {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 4px;
    padding-top: 2px;
}
.egc-tag-option {
    width: 100%;
    min-height: 26px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 5px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: rgba(237, 241, 247, 0.84);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
}
.egc-tag-option:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
.egc-tag-option.active { background: rgba(255, 255, 255, 0.10); color: #fff; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); }
.egc-tag-option-check { width: 10px; flex: 0 0 10px; color: rgba(248, 250, 253, 0.90); font-size: 10px; text-align: center; }
.egc-tag-option-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.egc-tag-option-count { margin-left: 3px; color: rgba(235, 240, 248, 0.46); font-size: 9px; }
.egc-tag-manual { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--egc-divider); }
.egc-menu-textarea {
    width: 100%;
    min-height: 30px;
    max-height: 30px;
    padding: 5px 7px;
    line-height: 18px;
    resize: none;
    box-sizing: border-box;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 10px;
    color: #edf1f7;
    font-size: 12px;
    font-family: var(--egc-font);
    outline: none;
    transition: border-color 180ms ease, background 180ms ease;
}
.egc-menu-textarea::placeholder { color: rgba(235, 240, 248, 0.38); }
.egc-menu-textarea:focus { border-color: rgba(255, 255, 255, 0.22); background: rgba(255, 255, 255, 0.08); }

/* ── 无障碍：用户开启"减少动态效果"时关闭动画 ── */
@media (prefers-reduced-motion: reduce) {
    .egc-launcher, .egc-panel, .egc-btn, .egc-menu { transition: none !important; animation: none !important; }
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

    /* ══════════════ 通用 DOM 小工具 ══════════════ */

    /** 创建带类名的元素，可一次性塞入 HTML */
    function el(tag, className, html) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (html !== undefined) node.innerHTML = html;
        return node;
    }

    const CHECK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.2l3.1 3.1 6.5-6.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const FOLDER_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.8 5.6h5l1.5 1.8h7.9v7.1a1.8 1.8 0 0 1-1.8 1.8H4.6a1.8 1.8 0 0 1-1.8-1.8V5.6Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/></svg>';
    const CHEVRON_SVG = '<svg viewBox="0 0 12 8" width="12" height="8" fill="none" aria-hidden="true"><path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const ARROW_SVG = '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true"><path d="M4 2.5L8 6L4 9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    /* ══════════════ 弹层公共管理 ══════════════
     * 同一时刻最多一个弹层展开（与 fab 行为一致）；
     * document 级监听器惰性注册一次，供所有 picker 实例共享。
     */
    const openPickers = new Set();

    function ensureGlobalDismiss() {
        if (ensureGlobalDismiss.bound) return;
        ensureGlobalDismiss.bound = true;
        document.addEventListener('click', (event) => {
            for (const picker of Array.from(openPickers)) {
                if (!picker._ownsTarget(event.target)) picker.close();
            }
        }, true);
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            for (const picker of Array.from(openPickers)) picker.close();
        }, true);
        // 视口变化时重新贴附已展开的弹层
        const reposition = () => {
            for (const picker of openPickers) picker._reposition();
        };
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
    }

    /**
     * 弹层定位（移植自 fab positionPickerMenu）：
     * 挂 body 顶层 + fixed，按触发按钮的视口位置决定向上/向下展开，
     * 并保证浮层不越过浏览器左右边界。
     */
    function positionMenu(menu, trigger, desiredHeight) {
        if (!menu || !trigger) return;
        const viewportMargin = 16;
        const horizontalMargin = 10;
        const gap = 8;
        const rect = trigger.getBoundingClientRect();
        const availableBelow = Math.max(0, window.innerHeight - rect.bottom - gap - viewportMargin);
        const availableAbove = Math.max(0, rect.top - gap - viewportMargin);

        let openAbove = false;
        if (availableBelow >= desiredHeight) openAbove = false;
        else if (availableAbove >= desiredHeight) openAbove = true;
        else openAbove = availableAbove > availableBelow;

        const availableHeight = openAbove ? availableAbove : availableBelow;
        const resolvedHeight = Math.max(96, Math.floor(Math.min(desiredHeight, availableHeight)));
        menu.style.top = openAbove ? 'auto' : Math.round(rect.bottom + gap) + 'px';
        menu.style.bottom = openAbove ? Math.round(window.innerHeight - rect.top + gap) + 'px' : 'auto';
        menu.style.height = resolvedHeight + 'px';
        menu.style.maxHeight = resolvedHeight + 'px';
        menu.style.transformOrigin = openAbove ? 'bottom right' : 'top right';

        const menuWidth = menu.getBoundingClientRect().width;
        const minLeft = horizontalMargin;
        const maxLeft = Math.max(minLeft, window.innerWidth - horizontalMargin - menuWidth);
        const targetLeft = Math.max(minLeft, Math.min(rect.right - menuWidth, maxLeft));
        menu.style.left = Math.round(targetLeft) + 'px';
        menu.style.right = 'auto';
    }

    /* ══════════════ 文件夹选择器 ══════════════ */

    /**
     * 创建 Eagle 文件夹选择器（触发按钮 + body 顶层弹层）。
     * 交互完全对齐 fab 版：搜索过滤、树形展开、多选勾选（multiple:false 时单选）、
     * 已选目录祖先链自动展开、Esc/外点/完成 关闭。
     *
     * @param {Object} opts
     * @param {boolean} [opts.multiple=true]      是否允许多选
     * @param {string[]} [opts.value=[]]          初始选中的文件夹 ID 列表
     * @param {string} [opts.rootLabel]           根目录项文案，默认"默认（根目录）"
     * @param {string} [opts.searchPlaceholder]   搜索框占位文案
     * @param {number} [opts.menuHeight=540]      弹层期望高度（实际按视口自适应收缩）
     * @param {(ids: string[]) => void} [opts.onChange] 勾选变化回调
     * @returns 句柄：{ el, setFolders, getSelected, setSelected, open, close, toggle, destroy }
     */
    function createFolderPicker(opts) {
        injectStyles();
        ensureGlobalDismiss();
        const o = opts || {};
        const multiple = o.multiple !== false;
        const menuHeight = o.menuHeight || 540;
        const state = {
            folders: [],            // Eagle 原始树 [{id,name,children}]
            selected: [],           // 已选 ID 列表（'' 表示根目录，约定不存 ''，空数组即根目录）
            expanded: new Set(),    // 展开的节点 ID
            keyword: '',
        };

        // —— 面板内：wrap + 触发按钮 ——
        const wrap = el('div', 'egc-folder-select-wrap');
        const trigger = el('button', 'egc-folder-trigger');
        trigger.type = 'button';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        const triggerText = el('span', 'egc-folder-trigger-text');
        const triggerIcon = el('span', 'egc-folder-trigger-icon', CHEVRON_SVG);
        trigger.append(triggerText, triggerIcon);
        wrap.appendChild(trigger);

        // —— body 顶层：弹层 ——
        const menu = el('div', 'egc-menu');
        const head = el('div', 'egc-picker-head');
        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'egc-menu-search';
        search.placeholder = o.searchPlaceholder || '搜索文件夹...';
        const mode = el('span', 'egc-picker-mode', multiple ? '选择目标' : '选择目标');
        head.append(search, mode);
        const recent = el('div', 'egc-menu-recent');
        const tree = el('div', 'egc-menu-tree');
        tree.setAttribute('role', 'tree');
        const footer = el('div', 'egc-menu-footer');
        const footerHint = el('span', '', multiple ? '可多选文件夹' : '选择保存目录');
        const doneBtn = el('button', 'egc-menu-done', '完成');
        doneBtn.type = 'button';
        footer.append(footerHint, doneBtn);
        menu.append(head, recent, tree, footer);
        document.body.appendChild(menu);

        /* —— 工具：扁平化查找 —— */
        const walkFolders = (nodes, fn, depth) => {
            for (const node of (Array.isArray(nodes) ? nodes : [])) {
                if (!node || !node.id) continue;
                fn(node, depth);
                walkFolders(node.children, fn, depth + 1);
            }
        };
        const findNameById = (id) => {
            let found = '';
            walkFolders(state.folders, (node) => {
                if (String(node.id) === id) found = String(node.name || '').trim();
            }, 0);
            return found;
        };
        /** 返回 id 的祖先链（含自身），供自动展开 */
        const findPathById = (id, nodes) => {
            for (const node of (Array.isArray(nodes) ? nodes : [])) {
                if (String(node.id) === id) return [String(node.id)];
                const sub = findPathById(id, node.children);
                if (sub) return [String(node.id), ...sub];
            }
            return null;
        };

        /* —— 触发按钮摘要 —— */
        function syncTriggerLabel() {
            const names = state.selected.map(id => findNameById(id)).filter(Boolean);
            let text;
            if (state.selected.length === 0) text = o.rootLabel || '默认（根目录）';
            else if (multiple) text = names.length > 1 ? `${names.length} 个文件夹` : (names[0] || o.rootLabel || '默认（根目录）');
            else text = names[0] || o.rootLabel || '默认（根目录）';
            triggerText.textContent = text;
            triggerText.title = names.join('、') || text;
        }

        /* —— 树渲染（搜索时自动展开命中链路，逻辑移植自 fab） —— */
        function renderTree() {
            if (search.value !== state.keyword) search.value = state.keyword;
            const keyword = state.keyword.trim().toLowerCase();

            // 顶部"最近"chip：展示当前已选摘要，点击聚焦树中对应项
            recent.innerHTML = '';
            const selectedNames = state.selected.map(id => findNameById(id)).filter(Boolean);
            recent.classList.toggle('has-items', selectedNames.length > 0 && !keyword);
            if (selectedNames.length > 0 && !keyword) {
                const chip = el('button', 'egc-recent-chip');
                chip.type = 'button';
                chip.textContent = selectedNames.length > 1 ? `已选：${selectedNames.length} 个文件夹` : `已选：${selectedNames[0]}`;
                chip.title = selectedNames.join('、');
                recent.appendChild(chip);
            }

            tree.innerHTML = '';
            const isSelected = id => state.selected.includes(id);

            // 根目录项（selected 为空 = 使用根目录）
            const rootItem = el('div', 'egc-folder-option' + (state.selected.length === 0 ? ' active' : ''));
            rootItem.setAttribute('role', 'treeitem');
            rootItem.setAttribute('aria-selected', state.selected.length === 0 ? 'true' : 'false');
            const rootCheck = el('button', 'egc-folder-option-checkbox' + (state.selected.length === 0 ? ' checked' : ''));
            rootCheck.type = 'button';
            rootCheck.setAttribute('aria-label', state.selected.length === 0 ? '当前使用默认根目录' : '选择默认根目录');
            if (state.selected.length === 0) rootCheck.innerHTML = CHECK_SVG;
            rootCheck.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleSelection('');
            });
            const rootIcon = el('span', 'egc-folder-option-icon', FOLDER_SVG);
            const rootLabel = el('span', 'egc-folder-option-label', o.rootLabel || '默认（根目录）');
            rootItem.append(rootCheck, rootIcon, rootLabel);
            tree.appendChild(rootItem);

            const isMatched = (node) => {
                const name = String(node.name || '').trim().toLowerCase();
                if (!keyword) return true;
                if (name.includes(keyword)) return true;
                return (Array.isArray(node.children) ? node.children : []).some(isMatched);
            };

            const appendNode = (node, depth, container, forceExpand) => {
                const folderId = String(node.id);
                const name = String(node.name || '').trim() || '未命名文件夹';
                const children = Array.isArray(node.children) ? node.children : [];

                // 搜索过滤：自身或任一后代命中才显示
                const childFlags = children.map(isMatched);
                const selfMatched = !keyword || name.toLowerCase().includes(keyword);
                if (!selfMatched && !childFlags.some(Boolean)) return;

                const expanded = forceExpand || state.expanded.has(folderId) || !!keyword;
                const selected = isSelected(folderId);
                const item = el('div', 'egc-folder-option' + (selected ? ' active' : ''));
                item.setAttribute('role', 'treeitem');
                item.setAttribute('aria-selected', selected ? 'true' : 'false');
                item.style.paddingLeft = `${10 + depth * 14}px`;

                const checkbox = el('button', 'egc-folder-option-checkbox' + (selected ? ' checked' : ''));
                checkbox.type = 'button';
                checkbox.setAttribute('aria-label', (selected ? '取消选择' : '选择') + '文件夹 ' + name);
                if (selected) checkbox.innerHTML = CHECK_SVG;
                checkbox.addEventListener('click', (event) => {
                    event.stopPropagation();
                    toggleSelection(folderId);
                });
                item.appendChild(checkbox);
                item.appendChild(el('span', 'egc-folder-option-icon', FOLDER_SVG));

                if (children.length > 0) {
                    const toggle = el('span', 'egc-folder-option-toggle' + (expanded ? ' expanded' : ''), ARROW_SVG);
                    toggle.addEventListener('click', (event) => {
                        event.stopPropagation();
                        state.expanded.has(folderId) ? state.expanded.delete(folderId) : state.expanded.add(folderId);
                        renderTree();
                    });
                    item.appendChild(toggle);
                } else {
                    item.appendChild(el('span', 'egc-folder-option-spacer'));
                }

                const label = el('span', 'egc-folder-option-label', name);
                label.title = name;
                item.appendChild(label);
                container.appendChild(item);

                if (children.length > 0 && expanded) {
                    const group = el('div', 'egc-folder-group');
                    children.forEach((child, index) => {
                        appendNode(child, depth + 1, group, !!keyword && childFlags[index]);
                    });
                    if (group.childElementCount > 0) container.appendChild(group);
                }
            };

            const before = tree.childElementCount;
            (Array.isArray(state.folders) ? state.folders : []).forEach(node => appendNode(node, 0, tree, false));
            if (tree.childElementCount === before && keyword) {
                tree.appendChild(el('div', 'egc-folder-empty', '未找到匹配的文件夹'));
            }
        }

        /* —— 勾选逻辑（multiple:false 时单选替换并自动收起） —— */
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
        }

        /* —— 开合 —— */
        function open() {
            for (const other of Array.from(openPickers)) {
                if (other !== handle) other.close();
            }
            wrap.classList.add('open');
            menu.classList.add('open');
            openPickers.add(handle);
            trigger.setAttribute('aria-expanded', 'true');
            handle._reposition();
            syncTriggerLabel();
            search.focus({ preventScroll: true });
            search.select();
        }
        function close() {
            wrap.classList.remove('open');
            menu.classList.remove('open');
            openPickers.delete(handle);
            trigger.setAttribute('aria-expanded', 'false');
            state.keyword = '';
            search.value = '';
            renderTree();
            syncTriggerLabel();
        }
        trigger.addEventListener('click', () => {
            wrap.classList.contains('open') ? close() : open();
        });
        menu.addEventListener('click', (event) => event.stopPropagation());
        doneBtn.addEventListener('click', close);
        search.addEventListener('input', () => {
            state.keyword = search.value;
            renderTree();
        });

        const handle = {
            el: wrap,
            /** 灌入 Eagle 文件夹树（原始 children 结构即可） */
            setFolders(treeData) { state.folders = treeData || []; renderTree(); syncTriggerLabel(); },
            getSelected() { return state.selected.slice(); },
            setSelected(ids) {
                state.selected = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
                renderTree();
                syncTriggerLabel();
            },
            open, close,
            toggle() { wrap.classList.contains('open') ? close() : open(); },
            destroy() {
                close();
                menu.remove();
                wrap.remove();
            },
            _ownsTarget(target) {
                return wrap.contains(target) || menu.contains(target);
            },
            _reposition() {
                if (!menu.classList.contains('open')) return;
                positionMenu(menu, trigger, menuHeight);
            },
        };

        renderTree();
        syncTriggerLabel();
        if (Array.isArray(o.value) && o.value.length > 0) handle.setSelected(o.value);
        return handle;
    }

    /* ══════════════ 标签选择器 ══════════════ */

    /**
     * 创建 Eagle 标签选择器（触发按钮 + body 顶层弹层）。
     * 交互对齐 fab 版：搜索过滤、已选 chips（单个移除/清空）、最近使用两列、
     * 全量标签两列勾选列表（带计数）、手动输入（逗号/换行分隔，回车或失焦合并）。
     *
     * @param {Object} opts
     * @param {string[]} [opts.selected=[]]     初始已选标签
     * @param {string[]} [opts.recent=[]]       最近使用标签（按脚本自己的持久化供给）
     * @param {number} [opts.menuHeight=600]    弹层期望高度
     * @param {(selected: string[]) => void} [opts.onChange] 选择变化回调（含手动输入合并结果）
     * @param {(recent: string[]) => void} [opts.onRecentChange] 最近使用序列变化回调（脚本负责持久化）
     * @returns 句柄：{ el, setTags, setLoading, setError, setRecent, getSelected, setSelected, open, close, toggle, destroy }
     */
    function createTagPicker(opts) {
        injectStyles();
        ensureGlobalDismiss();
        const o = opts || {};
        const menuHeight = o.menuHeight || 600;
        const state = {
            tags: [],          // [{name, count|null}]
            selected: [],
            recent: (Array.isArray(o.recent) ? o.recent : []).map(String).filter(Boolean),
            keyword: '',
            loading: false,
            error: '',
        };
        const MAX_RECENT = 12;

        const wrap = el('div', 'egc-tag-select-wrap');
        const trigger = el('button', 'egc-tag-trigger');
        trigger.type = 'button';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        const triggerText = el('span', 'egc-tag-trigger-text');
        const triggerMeta = el('span', 'egc-tag-trigger-meta');
        trigger.append(triggerText, triggerMeta);
        wrap.appendChild(trigger);

        const menu = el('div', 'egc-menu');
        const head = el('div', 'egc-picker-head');
        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'egc-menu-search';
        search.placeholder = '搜索标签...';
        const mode = el('span', 'egc-picker-mode', '可多选');
        head.append(search, mode);
        const selectedBox = el('div', 'egc-selected-tags');
        const recentBox = el('div', 'egc-menu-recent egc-tag-recent');
        const list = el('div', 'egc-tag-list');
        list.setAttribute('role', 'listbox');
        const manual = el('div', 'egc-tag-manual');
        const textarea = document.createElement('textarea');
        textarea.className = 'egc-menu-textarea';
        textarea.placeholder = '手动输入标签，逗号分隔，回车添加';
        manual.appendChild(textarea);
        const footer = el('div', 'egc-menu-footer');
        footer.append(el('span', '', '点击切换'), el('span', '', 'Esc 关闭'));
        menu.append(head, selectedBox, recentBox, list, manual, footer);
        document.body.appendChild(menu);

        const normalize = (tags) => Array.from(new Set((Array.isArray(tags) ? tags : []).map(t => String(t || '').trim()).filter(Boolean)));

        function setSelected(next, silent) {
            state.selected = normalize(next).slice(0, 24);
            renderMenu();
            syncTriggerLabel();
            if (!silent && o.onChange) o.onChange(state.selected.slice());
        }

        function touchRecent(tag) {
            state.recent = normalize([tag, ...state.recent]).slice(0, MAX_RECENT);
            if (o.onRecentChange) o.onRecentChange(state.recent.slice());
        }

        function syncTriggerLabel() {
            triggerText.textContent = state.selected.length > 0
                ? state.selected.slice(0, 2).join('、') + (state.selected.length > 2 ? '…' : '')
                : '未选择标签';
            triggerMeta.textContent = state.selected.length > 0 ? `${state.selected.length} 个已选` : '添加标签';
            trigger.setAttribute('aria-expanded', menu.classList.contains('open') ? 'true' : 'false');
        }

        function renderMenu() {
            if (search.value !== state.keyword) search.value = state.keyword;
            const keyword = state.keyword.trim().toLowerCase();
            const byName = new Map(state.tags.map(t => [t.name, t]));

            // 已选 chips（含手动输入的、Eagle 目录里不存在的标签）
            selectedBox.innerHTML = '';
            selectedBox.classList.toggle('has-items', state.selected.length > 0);
            state.selected.forEach(tag => {
                const chip = el('span', 'egc-selected-tag');
                chip.title = tag;
                chip.appendChild(el('span', 'egc-selected-tag-name', tag));
                const remove = el('button', 'egc-selected-tag-remove', '×');
                remove.type = 'button';
                remove.title = `移除标签：${tag}`;
                remove.setAttribute('aria-label', `移除标签：${tag}`);
                remove.addEventListener('click', () => setSelected(state.selected.filter(v => v !== tag)));
                chip.appendChild(remove);
                selectedBox.appendChild(chip);
            });
            if (state.selected.length > 1) {
                const clear = el('button', 'egc-selected-tags-clear', '清空已选');
                clear.type = 'button';
                clear.addEventListener('click', () => setSelected([]));
                selectedBox.appendChild(clear);
            }

            // 最近使用（只展示 Eagle 目录中仍存在的，与 fab 行为一致）
            recentBox.innerHTML = '';
            const recentItems = state.recent.filter(tag => byName.has(tag) && (!keyword || tag.toLowerCase().includes(keyword))).slice(0, 8);
            recentBox.classList.toggle('has-items', recentItems.length > 0);
            recentItems.forEach(tag => {
                const chip = el('button', 'egc-recent-chip', tag);
                chip.type = 'button';
                chip.title = '快速选择：' + tag;
                chip.addEventListener('click', () => {
                    touchRecent(tag);
                    setSelected([...state.selected, tag]);
                });
                recentBox.appendChild(chip);
            });

            // 全量列表（两列网格）
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
            else list.appendChild(el('div', 'egc-tag-empty', state.tags.length === 0 ? 'Eagle 中没有可用标签' : '没有匹配的 Eagle 标签'));
        }

        // 手动输入：回车或失焦时按逗号/换行解析合并进已选
        const applyManual = () => {
            const parsed = normalize(textarea.value.split(/[,，\n]/));
            if (parsed.length === 0) return;
            textarea.value = '';
            parsed.forEach(touchRecent);
            setSelected([...state.selected, ...parsed]);
        };
        textarea.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                applyManual();
            }
        });
        textarea.addEventListener('blur', applyManual);

        function open() {
            for (const other of Array.from(openPickers)) {
                if (other !== handle) other.close();
            }
            wrap.classList.add('open');
            menu.classList.add('open');
            openPickers.add(handle);
            handle._reposition();
            syncTriggerLabel();
            search.focus({ preventScroll: true });
            search.select();
        }
        function close() {
            applyManual();
            wrap.classList.remove('open');
            menu.classList.remove('open');
            openPickers.delete(handle);
            state.keyword = '';
            search.value = '';
            renderMenu();
            syncTriggerLabel();
        }
        trigger.addEventListener('click', () => {
            wrap.classList.contains('open') ? close() : open();
        });
        menu.addEventListener('click', (event) => event.stopPropagation());
        search.addEventListener('input', () => {
            state.keyword = search.value;
            renderMenu();
        });

        const handle = {
            el: wrap,
            /** 灌入 Eagle 标签目录 entries: [{name, count}] */
            setTags(entries) {
                state.tags = (Array.isArray(entries) ? entries : [])
                    .map(t => ({ name: String(t.name || '').trim(), count: Number.isFinite(Number(t.count)) ? Number(t.count) : null }))
                    .filter(t => t.name);
                state.error = '';
                renderMenu();
            },
            setLoading(loading) { state.loading = !!loading; renderMenu(); },
            setError(message) { state.error = String(message || ''); state.loading = false; renderMenu(); },
            setRecent(tags) { state.recent = normalize(tags).slice(0, MAX_RECENT); renderMenu(); },
            getSelected() { return state.selected.slice(); },
            setSelected(tags, silent) { setSelected(tags, silent); },
            open, close,
            toggle() { wrap.classList.contains('open') ? close() : open(); },
            destroy() {
                close();
                menu.remove();
                wrap.remove();
            },
            _ownsTarget(target) {
                return wrap.contains(target) || menu.contains(target);
            },
            _reposition() {
                if (!menu.classList.contains('open')) return;
                positionMenu(menu, trigger, menuHeight);
            },
        };

        state.selected = normalize(o.selected || []);
        renderMenu();
        syncTriggerLabel();
        return handle;
    }

    /* ══════════════ 基础组件 ══════════════ */

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

    /** 版本徽标元素：放进面板标题行，直观确认当前生效的库版本 */
    function versionBadge() {
        injectStyles();
        return el('span', 'egc-version', 'UI ' + VERSION);
    }

    // 挂载全局：Tampermonkey / Violentmonkey 的 @require 与脚本本体
    // 运行在同一沙箱函数作用域，挂 window 保证跨管理器可见。
    window.EagleUI = {
        version: VERSION,
        css: CSS,
        injectStyles,
        createLauncher,
        createPanel,
        createFolderPicker,
        createTagPicker,
        versionBadge,
    };
})();
