# -*- coding: utf-8 -*-
"""eagle-ui.js v1.3.0 -> v1.3.1:fab/web 迁移所需的按钮变体、状态行、开关行、配置禁用态。"""
import io

path = 'eagle-ui.js'
src = io.open(path, encoding='utf-8').read()

def rep(old, new, cnt=1):
    global src
    assert old in src, 'MISSING: ' + old[:60]
    src = src.replace(old, new, cnt)

rep("const VERSION = '1.3.0';", "const VERSION = '1.3.1';")

NEW_CSS = '''
/* ── 按钮变体(采集动作条) ── */
.egc-btn.secondary { background: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.10); }
.egc-btn.danger { background: rgba(163, 52, 52, 0.42); border-color: rgba(255, 255, 255, 0.08); }
.egc-btn.full { width: 100%; margin-bottom: 8px; }
.egc-btn.start {
    color: #ffffff;
    border-color: rgba(177, 215, 248, 0.62);
    background: rgba(118, 151, 183, 0.22);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10), 0 0 0 1px rgba(167, 211, 246, 0.10);
}
.egc-btn.start:hover,
.egc-btn.start:focus-visible {
    border-color: rgba(205, 231, 255, 0.92);
    background: rgba(139, 177, 211, 0.28);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 0 0 1px rgba(181, 220, 255, 0.22);
}
.egc-btn .egc-btn-label {
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.egc-btn-row { display: flex; gap: 6px; margin-bottom: 8px; overflow: hidden; }

/* ── 状态文字行(扫描流程提示/错误) ── */
.egc-status {
    font-size: 11px;
    color: var(--egc-fg-faint);
    text-align: center;
    margin-top: 8px;
    line-height: 1.45;
    max-width: 100%;
    overflow-wrap: anywhere;
    word-break: break-word;
}
.egc-status:empty { display: none; }
.egc-status.error { color: rgba(255, 190, 190, 0.85); }

/* ── 开关行(checkbox 配置项) ── */
.egc-switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin: 10px 0 12px;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
}
.egc-switch-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: 1 1 auto;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: rgba(237, 241, 247, 0.92);
    line-height: 14px;
    cursor: default;
}
.egc-checkbox { width: 16px; height: 16px; flex: 0 0 16px; accent-color: #dce4f0; cursor: pointer; }

/* ── 配置区禁用态(本地模式下 Eagle 专属配置置灰) ── */
.egc-config-section.disabled { opacity: 0.52; }
.egc-config-section.disabled .egc-folder-trigger,
.egc-config-section.disabled .egc-tag-trigger,
.egc-config-section.disabled .egc-checkbox { pointer-events: none; }

'''
rep('/* ── 无障碍：用户开启"减少动态效果"时关闭动画 ── */', NEW_CSS + '/* ── 无障碍：用户开启"减少动态效果"时关闭动画 ── */')

io.open(path, 'w', encoding='utf-8', newline='').write(src)
print('eagle-ui.js v1.3.1 OK')
