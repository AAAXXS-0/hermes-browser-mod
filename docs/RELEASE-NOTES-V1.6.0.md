# Hermes Browser Mod V1.6.0

首个面向公众的源码版本，从本地 V1.5.1 功能基线导出，保留从 V1.0.0 开始的版本演进，公开 Git 历史重新建立并排除私人诊断与运行数据。

- 独立 Edge + 16 项 stdio MCP 工具，实时画面、指针、iframe 操作、逐字中文/英文输入。
- 手动接管与交还；网页弹窗处理独立于普通动作队列，防止死锁和积压操作重放。
- 可选 CN Desktop v0.9.0 原生侧栏，工具开始时自动展开并显示最近动作状态。
- 安装路径显式配置，独立 MCP 使用用户 home 回退；构建固定上游 commit 和 pnpm 版本，安装/撤销保留归属检查。
- 原创代码 MIT；上游 CN Desktop 与修改后前端仍受 PolyForm Noncommercial 约束，详见 THIRD_PARTY_NOTICES.md。

此版本是非官方、试验性的源码分发。只验证 Windows + CN Desktop v0.9.0；不附宿主或浏览器二进制。多个聊天共用浏览器；登录、验证码和关键提交需用户核对。安装和卸载见 README，真实测试范围见 docs/TESTING.md。
