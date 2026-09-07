# Greasy Fork 与 GitHub 自动同步操作

## 当前报错

Greasy Fork 提示：

> 脚本同步失败 - Code 使用了一个未被允许的外部脚本：`@require https://cdn.jsdelivr.net/gh/baimoushare/eagle-plugin@main/eagle-ui.js`

这不是 GitHub 仓库权限错误，而是 Greasy Fork 在发布/同步脚本时不接受这个自有 `eagle-ui.js` 直链作为允许的外部代码来源。

## 正确架构

```text
GitHub eagle-ui.js
        ↓ Greasy Fork Library 源码同步
Greasy Fork 上的 Eagle UI Library
        ↓ 四个脚本 @require GF 库地址
Greasy Fork 上的四个用户脚本
        ↓ 用户安装
Tampermonkey
```

jsDelivr 直链方案已停用（Greasy Fork 不接受自有 jsDelivr 文件作为外部 @require）。四个脚本已统一引用 Greasy Fork 托管的 Library 地址：

```text
https://update.greasyfork.org/scripts/594761/Eagle%20Collector%20UI.js
```

注意：`@require` 必须使用上面的无版本号地址（永远指向最新版）；带 `/1924684/` 版本段的地址会永久锁定旧版本。

## 一次性设置

### 1. 在 Greasy Fork 创建 Library

1. 登录 Greasy Fork。
2. 进入创建脚本/Library 的入口，选择创建 Library，而不是普通用户脚本。
3. Library 名称建议：`Eagle Collector UI`。
4. 将源码同步地址设置为：

```text
https://raw.githubusercontent.com/baimoushare/eagle-plugin/main/eagle-ui.js
```

5. 保存并记下 Greasy Fork 生成的 Library 页面地址和安装代码中的 `@require` 地址。

已完成：Library ID 为 `594761`，页面地址 https://greasyfork.org/zh-CN/scripts/594761 。

### 2. 修改四个发布版脚本的 @require

已完成：四个脚本的 `@require` 已统一替换为

```javascript
https://update.greasyfork.org/scripts/594761/Eagle%20Collector%20UI.js
```

该地址对 GitHub 直装与 Greasy Fork 安装同样适用（Tampermonkey 均可拉取）。

### 3. 配置 Greasy Fork 脚本源码同步

四个脚本分别设置 GitHub Raw 源码同步地址：

```text
https://raw.githubusercontent.com/baimoushare/eagle-plugin/main/eagle-fab-collector.user.js
https://raw.githubusercontent.com/baimoushare/eagle-plugin/main/eagle-web-collector.user.js
https://raw.githubusercontent.com/baimoushare/eagle-plugin/main/eagle-x-collector.user.js
https://raw.githubusercontent.com/baimoushare/eagle-plugin/main/eagle-douyin-collector.user.js
```

先保存同步地址，再配置 Webhook。

### 4. 获取 Greasy Fork Webhook 信息

打开：

<https://greasyfork.org/zh-CN/users/webhook-info>

登录后：

1. 找到 GitHub 配置区域。
2. 点击 `Generate` 生成 Webhook Secret。
3. 复制页面显示的 `Payload URL`。
4. Secret 只用于验证 Webhook 签名，不是 GitHub PAT，不要放进仓库。

页面生成的 Payload URL 应原样复制，不要自行拼接；当前格式通常类似：

```text
https://api.greasyfork.org/zh-CN/users/<你的用户ID>/webhook
```

### 5. 配置 GitHub Webhook

GitHub 仓库 → `Settings` → `Webhooks` → `Add webhook`：

- `Payload URL`：粘贴 Greasy Fork 页面生成的 URL；
- `Content type`：选择 `application/json`；
- `Secret`：粘贴 Greasy Fork 生成的 Secret；
- Events：选择 `Just the push event`；
- `Active`：勾选；
- 保存。

进入 Webhook 的 `Recent Deliveries`，看到 ping/push 返回 2xx，说明连接成功。

## 日常更新流程

### 只改某个脚本

```text
修改脚本
→ 增加 @version
→ 本地测试
→ git commit
→ git push
→ GitHub Webhook 通知 Greasy Fork
→ Greasy Fork 根据 modified 文件同步对应脚本
→ Tampermonkey 检查更新
```

### 修改共享 UI 库

只改 `eagle-ui.js` 时，GitHub Webhook 只会同步 Library，不会自动改变四个用户脚本的版本。

推荐流程：

```text
修改 eagle-ui.js
→ 增加 eagle-ui.js 的 @version
→ 修改四个用户脚本的 @version
→ 确认四个脚本 @require 指向 GF Library
→ git push
→ Webhook 同步 Library 和四个脚本
→ 用户端 Tampermonkey 重新拉取脚本和外部 Library
```

若脚本用户需要立即更新，可以在 Tampermonkey 中手动执行“检查更新”，或临时将外部脚本检查周期调短。

## 常见失败原因

- Greasy Fork Library 尚未创建，脚本仍直接 `@require` jsDelivr 自有文件；
- 四个脚本在 GF 中没有设置 GitHub Raw 同步地址；
- GitHub Webhook 的 Content type 不是 `application/json`；
- Secret 与 Greasy Fork 页面生成的不一致；
- 只新增文件但没有修改文件，Webhook 当前主要匹配 `commits[].modified[]`；
- 脚本 `@version` 没有增加，GF 可能保存版本，但 Tampermonkey 可能不识别为升级；
- 把 GitHub PAT 填到了 Webhook Secret；
- GitHub 仓库设为私有，Greasy Fork 无法匿名读取 Raw URL。

## 私有仓库限制

GitHub 私有仓库不能直接作为当前 Greasy Fork 同步源，Webhook Secret 也不能代替 GitHub 访问令牌。仓库需要保持公开，才能同时使用 GitHub Raw、jsDelivr 和 Greasy Fork 自动同步。

## 官方来源

- <https://greasyfork.org/zh-CN/users/webhook-info>
- <https://greasyfork.org/zh-CN/help/external-scripts>
- <https://github.com/greasyfork-org/greasyfork>
- <https://github.com/greasyfork-org/greasyfork/blob/main/app/views/users/webhook_info.html.erb>
- <https://github.com/greasyfork-org/greasyfork/blob/main/app/controllers/concerns/webhooks.rb>
- <https://github.com/greasyfork-org/greasyfork/blob/main/lib/github.rb>
