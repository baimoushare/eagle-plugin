# 第三方代码与组件声明

本仓库整体采用根目录 `LICENSE` 所述的自定义使用许可（版权所有 © 2026 laobai，保留所有权利），但以下第三方代码不在此许可覆盖范围内，继续按其原始许可证授权，分发时必须保留相应声明：

## eagle-x-collector.user.js —— 上游 MIT 代码

- 上游项目：[ChinaGodMan/UserScripts](https://github.com/ChinaGodMan/UserScripts)
- 上游作者：goemon2017、天音、Tiande、人民的勤务员 <china.qinwuyuan@gmail.com>
- 上游许可证：MIT
- 说明：本文件由上游 Twitter Media Download 系列脚本（及其更早来源）衍生而来，文件内保留的原有版权与 MIT 声明持续有效。laobai 的自定义使用许可仅覆盖本仓库新增、修改的原创部分，不影响上游 MIT 授予的权利。

## _tm_tools/ref_douyin_enhanced.user.js —— 参考实现归档（MIT）

- 上游项目：[xiaohuitongxue88-ctrl/douyin-downloader](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader)
- 上游作者：小辉同學
- 上游许可证：MIT
- 说明：作为 `eagle-douyin-collector.user.js` 的架构参考源码归档于本仓库，按 MIT 原样保留。抖音采集脚本的原创实现不包含其代码直接拷贝；如后续确认存在片段复用，须在此处同步登记。

## JSZip（@require 运行时依赖）

- 来源：<https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js>
- 许可证：MIT（dual licensed with GPLv3）
- 说明：`eagle-x-collector.user.js` 通过 `@require` 从 cdnjs 引入，仅运行时引用，本仓库不包含其源码副本。

## 修订要求

- 新增第三方依赖或参考实现时，必须同步在本文件登记来源、作者、许可证与涉及文件；
- 不得删除或改写任何上游版权、许可证与来源声明；
- 本仓库自定义许可与第三方开源许可冲突时，以第三方许可对其自身代码的授权为准。
