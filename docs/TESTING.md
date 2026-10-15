# 验证记录 · V1.6.0

日期：2026-10-15。环境：Windows、Node.js v24.14.0、Microsoft Edge；未在本机另测 Node.js 22，已配置 Windows / Node.js 22 的 GitHub Actions，但远程 CI 尚未执行。

## 已通过

- 独立目录 npm ci --ignore-scripts，依赖 99 个包安装成功；安装时 npm audit 报告 0 个已知漏洞（不是完整安全审计）。
- npm run check：全部项目 JavaScript 语法检查通过。
- npm test：当时完整 21 项测试中 20 项通过、1 项跳过（旧 Dashboard SDK opt-in，未设置用户 Dashboard 地址）。覆盖真实 Edge/MCP、坐标/指针、iframe、中文输入、接管、弹窗死锁和接入撤销。
- 随后新增的公开安装 CLI 与历史扫描测试各 1 项定向通过。当前合计 23 项测试已分别验证，22 项通过、1 项 opt-in 跳过；没有将跳过的旧 Dashboard 验证写成已完成。
- 安装 CLI 验证含空格的自定义 desktop/runtime/home 路径、缺路径及旧构建拒绝、其他配置保留与精确还原；只使用临时 fixture，不写真实宿主。
- 历史扫描测试：把合成 token 写入 fixture Git 历史再从当前文件删除，仍能检测并拒绝，防止只清理最新文件的遗漏。
- npm run native:prepare：从官方 v0.9.0 的固定 commit 准备新源码与锁定依赖，pnpm 9.15.0；已分别验证缓存复用和公开目录自身缓存的工具链引导。未复制原开发目录的源码/构建或用户 profile。
- npm run native:build：公开目录中的原生前端构建成功，产物在忽略目录 .runtime/native-ui/V1.6.0，包含上游 LICENSE、原创 MIT LICENSE 与第三方声明。
- 原生 web TypeScript 检查通过；自动展开、浏览器组件与预览工具定向 Vitest 共 45 项通过。
- npm run release:check 与 Markdown 本地链接检查通过；在创建提交后再次扫描公开 Git 历史。未复制私人仓库的旧对象、分支、标签或诊断文档。
- 首次发布的独立 Demo 图片由公开版本地练习页测试生成，并目视检查；没有真实账号、课程、私人 URL 或密钥。该图片保留在 docs/images/demo.png。

## README 主图更新 · 2026-10-15

- 按用户明确指定，将 README 主图替换为用户提供的原生桌面实际运行截图，文件为 docs/images/integrated.png；原图未经生成式修改。
- 图片展示 CN Desktop v0.9.0 + 本地 Mod V1.5.1；README 注明与公开源码 V1.6.0 的版本区别，不据此声称完成 V1.6.0 实机验收。
- 人工目视检查未见密钥、cookie 或密码；原图包含公开 GitHub 用户名和近期会话标题，按用户指定保留。PNG 仅含图像数据块，没有附加文本元数据。
- 本次仅更新文档与图片，检查图片完整性、引用和发布扫描；未重新运行模型或浏览器操作测试。

## 没有验证或执行（发布准备阶段）

- 未将公开仓库接入当前用户的真实 Hermes；当前用户仍使用原本地项目。未向真实模型发聊天、未操作真实网站、未公开上传。
- 未重编译 Rust / EXE，未验证跨平台或其他 CN Desktop 版本；原生仅针对 v0.9.0 / 270f6ba。
- 未执行上游完整发布流程，未申请官方插件目录；GitHub Actions 仅提供配置，等待用户 push 后远程运行。
- 发布扫描只匹配有限密钥/私人标识格式，不保证发现所有敏感数据；第三方登录 profile、运行配置和测试原始目录不进入版本库。
