# Eagle 采集插件

油猴(Tampermonkey)脚本合集:在浏览网页时把图片/视频批量采集进 [Eagle](https://cn.eagle.cool/)(素材管理软件),或打包下载到本地。支持自动归类文件夹、打标签、去重。

## 三个脚本

| 脚本 | 版本 | 适用站点 | 功能 |
|---|---|---|---|
| `eagle-fab-collector.user.js` | 1.0.1 | Fab.com | Fab 专用版,批量采集图片/模型预览图,按"英文｜中文"自动建目录,商品名智能提取 |
| `eagle-web-collector.user.js` | 1.1.12 | Fab.com、E-Hentai、ExHentai | 综合版,批量采集页面图片,自动匹配站点目录与标签 |
| `eagle-x-collector.user.js` | 1.2.0 | X(Twitter) | 一键下载推文图片/视频/音频,批量采集时间线与"喜欢",三层去重(本地索引 + Eagle 查重 + URL 兜底) |
| `eagle-douyin-collector.user.js` | 0.4.0 | 抖音网页版 | 批量采集作者作品/喜欢列表的视频与图集,自动滚动加载,三层去重,Eagle 拉取失败自动转本地保存 |

所有脚本均支持两种保存方式:存入 Eagle / 本地 zip 打包下载。

## 共享 UI 设计库(eagle-ui.js)

各脚本的前端界面统一由 `eagle-ui.js` 提供(设计基因源自 Fab 面板:毛玻璃、白玻璃控件、蓝色选中态),脚本通过 `@require` 引用,改一处全家族生效:

```
// @require https://cdn.jsdelivr.net/gh/baimoushare/eagle-plugin@main/eagle-ui.js
```

- 组件:悬浮启动钮、面板容器(含采集中 running 阴影态)、**文件夹树选择弹层**(搜索+树+多选/单选+动态根目录文案+可选刷新按钮)、**标签选择弹层**(搜索+已选 chips+最近使用+可选分组+勾选列表+手动输入+可选刷新按钮)、进度条、版本徽标
- 接入状态:抖音版(0.4.0)、X 版(1.2.0)已完整迁移;Fab 版(1.0.1)、综合版(1.1.12)已挂载库并显示版本徽标,面板完整迁移待库补齐折叠面板/模式卡片/连接状态等 fab 专属组件后进行
- 确认当前版本:面板标题旁的"UI x.y.z"徽标 / 控制台 `window.EagleUI.version`
- 本地预览:仓库根起 `python -m http.server 8799`,浏览器开 `_tm_tools/ui-preview-eagle-ui.html`(含模拟 Eagle 数据,可点验两个选择器交互)
- 更新流程:修改 `eagle-ui.js` → push 到 GitHub main 分支 → 浏览器访问 `https://purge.jsdelivr.net/gh/baimoushare/eagle-plugin@main/eagle-ui.js` 清 CDN 缓存 → 已安装用户最迟一周内(Tampermonkey 外部脚本默认每周检查)自动换新;脚本版本号 +0.0.1 重存可强制立即刷新

## 安装

**前置条件**

1. 安装 [Eagle](https://cn.eagle.cool/) 并保持运行(脚本通过本地 API `localhost:41595` 通信;若提示连接失败,请在 Tampermonkey 中允许脚本访问该站点)
2. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展

**安装步骤**

1. 打开 Tampermonkey 面板 → 添加新脚本
2. 用本仓库对应 `.user.js` 文件的全部内容覆盖默认模板,保存(Ctrl+S)
3. 打开目标网站(如 fab.com、x.com),页面出现采集面板即为安装成功

> Fab 专用版与综合版功能有重叠:只在 Fab.com 采集选 `eagle-fab-collector`;同时用 E-Hentai 选 `eagle-web-collector`;两者可共存(域名匹配互不干扰)。

## 目录结构

```
├── eagle-*.user.js        # 三个活跃脚本
├── eagle-ui.js            # 家族共享 UI 设计库(经 @require 引用,详见上文)
├── docs/greasy-fork/      # 发布文档:CHANGELOG、发布方案、测试记录、使用许可
├── _release/              # 历史发布版存档
├── _tm_backup/            # 脚本历史备份与 Tampermonkey 数据备份
└── _tm_tools/             # 调试与同步工具脚本、UI 预览页
```

## 许可

Copyright (c) 2026 laobai. All rights reserved. 详见 [docs/greasy-fork/脚本使用许可.md](docs/greasy-fork/脚本使用许可.md)
