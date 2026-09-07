# Fab 专用版发布方案（eagle-fab-collector）

## 背景与决定

- 完整版 `eagle-web-collector.user.js` 因支持 E-Hentai / ExHentai，按 Greasy Fork 规则必须勾选“成人内容”标记，勾选后脚本默认从搜索结果隐藏，只能通过链接访问。
- 为让 Fab 用户能直接搜到脚本，从完整版复制出 **Fab 专用版** `eagle-fab-collector.user.js`，删除全部 E-Hentai / ExHentai 站点规则与相关 `@match` / `@connect`，只保留 Fab.com。
- 专用版**不涉及成人站点**，发布时**不勾选**成人内容标记，搜索结果对所有用户默认可见。
- 两版并存：完整版保留成人标记服务 E-Hentai 用户；专用版无标记供 Fab 用户搜索安装。

## 与完整版的差异

| 项目 | 完整版 | Fab 专用版 |
|---|---|---|
| 文件名 | eagle-web-collector.user.js | eagle-fab-collector.user.js |
| 脚本名 | Eagle 网页采集 · 通用图片 | Eagle 网页采集 · Fab 专用 |
| namespace | eagle-web-collector | eagle-fab-collector |
| 版本号 | 1.1.11 | 1.0.0 |
| 支持站点 | Fab + E-Hentai + ExHentai | 仅 Fab |
| 成人标记 | 必须勾选 | 不勾选 |

功能上 Fab 部分与完整版完全一致：自动建目录（英文｜中文）、SPA 路由识别、翻译双源回退、本地下载模式等。

## 发布页面文案

### 脚本名称

Eagle 网页采集 · Fab 专用

### 简短描述

在 Fab.com 页面批量采集图片，可保存到 Eagle 或本地下载，按“英文｜中文”自动创建目录。

### 详细介绍

本脚本在 Fab.com 商品页显示采集面板，自动识别商品名称并翻译为中文，按“英文原名｜中文译名”自动创建 Eagle 目录；图片可保存到正在运行的 Eagle 素材库，也可直接下载到本地。支持选择 Eagle 文件夹、标签、暂停、继续和停止任务。

使用前请安装 Tampermonkey。使用“保存到 Eagle”时，请先启动 Eagle 并确认本机 Eagle Web API 可用；选择“本地下载”时不依赖 Eagle。

本脚本只在用户主动操作后执行采集和下载，不包含广告、统计或开发者服务器上报。商品名仅用于本地目录命名，翻译请求只发送公开商品标题；保存到 Eagle 时会请求用户电脑上的 `localhost:41595` Eagle 接口。

请仅保存你有权访问和使用的素材，并遵守目标网站的服务条款和适用法律。

### 权限说明

- `GM_xmlhttpRequest`：请求跨域图片资源并连接本机 Eagle，以及翻译服务。
- `GM_download`：执行本地文件下载。
- `GM_getValue` / `GM_setValue`：保存用户选择的模式、文件夹和标签设置。
- `@connect`：支持网站、图片 CDN、本机 Eagle API 与两个翻译接口；通用图片识别会遇到动态图片域名，因此保留通配连接声明。

### 反馈

邮箱：`www.774466655@qq.com`

## 发布检查清单

1. [ ] 本地在 Tampermonkey 中安装 `eagle-fab-collector.user.js`，确认名称/版本号为“Eagle 网页采集 · Fab 专用 / 1.0.0”。
2. [ ] 在 fab.com 商品页测试：直接打开与站内点入两种方式，自动建目录名称正确（英文｜中文）。
3. [ ] 测试保存到 Eagle、本地下载两种模式。
4. [ ] 发布页面**不要勾选**“包含成人内容”。
5. [ ] 发布后从 Greasy Fork 页面重新安装，确认可被搜索到（搜索“Fab Eagle”或“Eagle 采集”）。
6. [ ] 记录公开页面地址、发布时间与版本哈希。
