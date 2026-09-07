# 更新日志

## 1.1.1 — 2026-08-23

- 首次准备公开发布到 Greasy Fork。
- 补齐作者、使用许可和反馈入口元数据。
- 更新公开描述，明确 Eagle、本地下载、网络请求和使用责任。

## 2026-08-29

### 完整版（eagle-web-collector）

- 修复 SPA 站内跳转后不识别商品页、不自动建目录的问题（新增路由轮询监听）。
- 修复目录名恒为“Fab”：商品名提取改为 h1 > JSON-LD > meta 兜底，并剔除站名段。
- 翻译双源回退：mymemory 为主，Google 公开接口为备；失败时目录创建文案可见提示。
- 新增 `@connect translate.googleapis.com`。

### Fab 专用版（eagle-fab-collector）v1.0.0

- 从完整版拆分，仅保留 Fab.com，无成人站点，发布时不需勾选成人内容标记。
- 功能与完整版 Fab 部分一致。发布方案见 `Fab专用版发布方案.md`。


