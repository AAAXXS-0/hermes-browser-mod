# Third-party notices / 第三方声明

本仓库原创 mod 源码采用 [MIT](LICENSE)。MIT 不适用于第三方软件本身，也不替代下述宿主软件许可。

## Hermes Agent CN Desktop

- 来源：https://github.com/Eynzof/Hermes-CN-Desktop
- 固定版本：v0.9.0
- 固定 commit：270f6ba796a291cf1397b63dee5cd697cb0c9cdf
- 上游许可：PolyForm Noncommercial License 1.0.0
- 完整原文及 Required Notice：[licenses/Hermes-CN-Desktop-v0.9.0.LICENSE.txt](licenses/Hermes-CN-Desktop-v0.9.0.LICENSE.txt)

Required Notice: Copyright (c) 2026 Qingdao Wanderminds Network Technology Co., Ltd. / 青岛万德缦思网络科技有限公司

Required Notice: Hermes Agent CN Desktop is licensed for noncommercial use under the PolyForm Noncommercial License 1.0.0. Commercial use requires separate authorization. Contact: lijiale@wanderminds.cn

构建脚本从固定上游源码生成修改后的前端：启用预览栏浏览器页签、接入本仓库 BrowserModTab，并在对话页挂载自动展开 hook。脚本中的上游匹配片段、构建时使用的宿主组件/CSS，以及生成的宿主前端副本仍须遵守上游许可。不得将整个宿主前端构建包称为 MIT，或据本仓库 MIT 条款声称获得上游商业使用授权。

发布源码不包含宿主 EXE 或完整前端构建包。生成的前端副本同时携带上游 LICENSE、本仓库 LICENSE 和本声明；MIT 仅覆盖本仓库原创部分。

本项目是独立、非官方社区 mod，未获 Nous Research、Hermes Agent 中文社区或其维护者的官方背书；第三方名称用于说明兼容性和来源。

## npm dependencies

依赖由 package-lock.json 锁定，npm ci 从包分发渠道安装；各依赖包附带的许可继续适用。本仓库不把 node_modules 打包发布，也不重新许可其内容。

| 直接依赖 | 声明许可 | 来源 |
|---|---|---|
| @modelcontextprotocol/sdk | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| playwright | Apache-2.0 | https://github.com/microsoft/playwright |
| ws | MIT | https://github.com/websockets/ws |
| yaml | ISC | https://github.com/eemeli/yaml |

实际安装版本以锁文件及其包内 LICENSE 为准；分发额外依赖或二进制时须另行保留相应许可。Microsoft Edge / WebView2 不包含在本源码分发内，由用户按其自身条款安装。
