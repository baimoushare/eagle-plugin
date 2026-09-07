# -*- coding: utf-8 -*-
"""一次性迁移脚本:web/fab 两个脚本挂载 eagle-ui 家族库(@require + 版本徽标 + bump)。
完整面板迁移待库补齐 mode 卡片/连接状态/折叠面板等组件后进行。"""
import io
import re

REQUIRE = "// @require      https://cdn.jsdelivr.net/gh/baimoushare/eagle-plugin@main/eagle-ui.js"
BADGE = """
            // 家族共享库版本徽标:确认当前生效的 eagle-ui 版本
            try {
                const badge = EagleUI.versionBadge();
                this.container.querySelector('.esp-header-title')?.appendChild(badge);
            } catch (err) { /* 徽标失败不影响面板 */ }
"""

def patch(path, version_old, version_new):
    src = io.open(path, encoding='utf-8').read()
    # 1. 版本 bump
    assert version_old in src, path + ' version'
    src = src.replace(version_old, version_new, 1)
    # 2. @require 插在第一个 @grant 行之前(头部存在 @grant GM_xmlhttpRequest)
    assert '@grant        GM_xmlhttpRequest' in src, path + ' grant'
    src = src.replace('@grant        GM_xmlhttpRequest',
                      REQUIRE + '\n// @grant        GM_xmlhttpRequest', 1)
    # 3. 版本徽标:_buildPanel() 后追加
    anchor = '            this._buildPanel();\n'
    assert anchor in src, path + ' buildPanel'
    src = src.replace(anchor, anchor + BADGE, 1)
    io.open(path, 'w', encoding='utf-8', newline='').write(src)
    print(path, 'OK')

patch('eagle-fab-collector.user.js', '// @version      1.0.0', '// @version      1.0.1')
patch('eagle-web-collector.user.js', '// @version      1.1.11', '// @version      1.1.12')
