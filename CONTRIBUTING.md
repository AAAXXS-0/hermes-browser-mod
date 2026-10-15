# 贡献指南

欢迎提交独立、范围明确的修复。先在自己的分支开发，PR 说明问题、改动、测试和兼容性影响。提交格式使用 Conventional Commits，例如 fix(browser): 修复弹窗等待；遵守 [AGENTS.md](AGENTS.md)。

需要 Node.js 22+ 与 Windows Edge。先 npm ci，再运行 npm run check、npm test 和 npm run release:check。新增浏览器行为应以本地练习页/fixture 验证，不在 CI 连接个人 Hermes、操作真实网站或发送模型消息。原生前端变更还需固定上游源码的 TypeScript 与定向组件测试。

依赖更改更新 package-lock.json。测试日志、profile、截图原始目录和凭据不能提交。截图如需公开，必须重新用无真实账号的 fixture 生成并目视检查。

本项目接入固定版本 CN Tauri 桌面，不是上游官方插件目录条目；不要把兼容性扩大到未验证版本。变更如需修改上游核心，请先提出通用接口需求，避免扩张本仓库职责。

提交原创贡献表示按本仓库 MIT 许可提供该贡献；第三方代码需保留来源及原许可。不要把受其他许可约束的代码改称 MIT。
