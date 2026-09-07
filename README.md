# Eagle 采集插件

油猴(Tampermonkey)脚本合集:在浏览网页时把图片/视频批量采集进 [Eagle](https://cn.eagle.cool/)(素材管理软件),或打包下载到本地。支持自动归类文件夹、打标签、去重。

## 三个脚本

| 脚本 | 版本 | 适用站点 | 功能 |
|---|---|---|---|
| `eagle-fab-collector.user.js` | 1.0.0 | Fab.com | Fab 专用版,批量采集图片/模型预览图,按"英文｜中文"自动建目录,商品名智能提取 |
| `eagle-web-collector.user.js` | 1.1.11 | Fab.com、E-Hentai、ExHentai | 综合版,批量采集页面图片,自动匹配站点目录与标签 |
| `eagle-x-collector.user.js` | 1.1.13 | X(Twitter) | 一键下载推文图片/视频/音频,批量采集时间线与"喜欢",三层去重(本地索引 + Eagle 查重 + URL 兜底) |
| `eagle-douyin-collector.user.js` | 0.2.0 | 抖音网页版 | 批量采集作者作品/喜欢列表的视频与图集,自动滚动加载,三层去重,Eagle 拉取失败自动转本地保存 |

所有脚本均支持两种保存方式:存入 Eagle / 本地 zip 打包下载。

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
├── docs/greasy-fork/      # 发布文档:CHANGELOG、发布方案、测试记录、使用许可
├── _release/              # 历史发布版存档
├── _tm_backup/            # 脚本历史备份与 Tampermonkey 数据备份
└── _tm_tools/             # 调试与同步工具脚本
```

## 许可

Copyright (c) 2026 laobai. All rights reserved. 详见 [docs/greasy-fork/脚本使用许可.md](docs/greasy-fork/脚本使用许可.md)
