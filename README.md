# Eagle 采集插件

油猴(Tampermonkey)脚本合集:在浏览网页时把图片/视频批量采集进 [Eagle](https://cn.eagle.cool/)(素材管理软件),或打包下载到本地。支持自动归类文件夹、打标签、去重。

## 三个脚本

| 脚本 | 版本 | 适用站点 | 功能 |
|---|---|---|---|
| `eagle-fab-collector.user.js` | 1.0.3 | Fab.com | Fab 专用版,批量采集图片/模型预览图,按"英文｜中文"自动建目录,商品名智能提取 |
| `eagle-web-collector.user.js` | 1.1.14 | Fab.com、E-Hentai、ExHentai | 综合版,批量采集页面图片,自动匹配站点目录与标签 |
| `eagle-x-collector.user.js` | 1.2.2 | X(Twitter) | 一键下载推文图片/视频/音频,批量采集时间线与"喜欢",三层去重(本地索引 + Eagle 查重 + URL 兜底) |
| `eagle-douyin-collector.user.js` | 0.4.2 | 抖音网页版 | 批量采集作者作品/喜欢列表的视频与图集,自动滚动加载,三层去重,Eagle 拉取失败自动转本地保存 |

所有脚本均支持两种保存方式:存入 Eagle / 本地 zip 打包下载。

## 共享 UI 设计库(eagle-ui.js)

各脚本的前端界面统一由 `eagle-ui.js` 提供(设计基因源自 Fab 面板:毛玻璃、白玻璃控件、蓝色选中态),脚本通过 `@require` 引用,改一处全家族生效。

### 引用地址(Greasy Fork Library)

`eagle-ui.js` 以 [Greasy Fork Library「Eagle Collector UI」](https://greasyfork.org/zh-CN/scripts/594761) 形式分发,四个脚本统一引用(**省略版本号的地址永远指向最新版**,不要用带 `/1924684/` 版本段的链接):

```
// @require https://update.greasyfork.org/scripts/594761/Eagle%20Collector%20UI.js
```

- Library 的源码同步地址:`https://raw.githubusercontent.com/baimoushare/eagle-plugin/main/eagle-ui.js`(Greasy Fork 定期拉取,配置 GitHub Webhook 后 push 即同步)
- jsDelivr 直链方案已停用(Greasy Fork 不接受自有 jsDelivr 文件作为外部 @require)
- 同步配置详见 [GitHub 与 Greasy Fork 自动同步操作](docs/greasy-fork/GitHub与Greasy-Fork自动同步操作.md)

## 版本与同步

- 组件:悬浮启动钮、面板容器(含采集中 running 阴影态)、**文件夹树选择弹层**(搜索+树+多选/单选+动态根目录文案+可选刷新按钮)、**标签选择弹层**(搜索+已选 chips+最近使用+可选分组+勾选列表+手动输入+可选刷新按钮)、进度条、版本徽标
- 接入状态:抖音版(0.4.1)、X 版(1.2.1)已完整迁移;Fab 版(1.0.2)、综合版(1.1.13)已挂载库并显示版本徽标,面板完整迁移待库补齐折叠面板/模式卡片/连接状态等 fab 专属组件后进行
- 确认当前版本:面板标题旁的"UI x.y.z"徽标 / 控制台 `window.EagleUI.version`
- 本地预览:仓库根起 `python -m http.server 8799`,浏览器开 `_tm_tools/ui-preview-eagle-ui.html`(含模拟 Eagle 数据,可点验两个选择器交互)
- 日常更新:改 `eagle-ui.js` → bump 库版本与四个脚本 `@version` → push → Greasy Fork(Webhook/轮询)同步 Library 与四个脚本 → 用户端 Tampermonkey 更新时重新拉取库

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

本项目为**源码公开、非开源**项目:版权所有 (c) 2026 laobai,保留所有权利。允许个人安装使用与本地修改,禁止未经授权公开发布修改版、镜像搬运与商业再分发。完整条款见根目录 [LICENSE](LICENSE),导览说明见 [docs/greasy-fork/脚本使用许可.md](docs/greasy-fork/脚本使用许可.md)。

第三方代码例外:`eagle-x-collector.user.js` 含上游 MIT 代码,JSZip 为 MIT 运行时依赖,均按其原许可证执行,详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
