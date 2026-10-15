# 手动推送与发布

这是重新导出的公开仓库，主分支 main，首次公开版本 V1.6.0。请从此目录推送；不要把私人开发仓库的对象、标签或分支重新合并进来。你需要在 GitHub 创建自己拥有的空仓库，不预置 README 或 LICENSE。

## 推送前

```powershell
git status --short
npm run release:check
git log --oneline --all
git remote -v
```

发布检查只扫描有限密钥/私人标识格式，不代替人工审查；读取 MIT、第三方声明及兼容范围后再上传。首次推送前确认 Git 提交显示的作者符合你的偏好；本地默认身份为 Hermes Browser Mod contributors，而非个人邮箱。

## 添加你自己的远端并推送

下方 OWNER / REPOSITORY 是需要你替换的占位符，不是已经创建的远端：

```powershell
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin main
git push origin V1.6.0
```

仓库若已经有 origin，先检查它，使用 git remote set-url origin 设置确认过的目标。仅推 main 和这个公开标签；不使用 --mirror 或从私人仓库推 --all / --tags。

## GitHub Release

使用 V1.6.0 标签，标题可写 Hermes Browser Mod V1.6.0，正文使用 [Release 草稿](docs/RELEASE-NOTES-V1.6.0.md)。这是首个公开源码版本，界面仅验证 Windows + CN Desktop v0.9.0，请按试验性 mod 说明发布。

源码包可用 git archive --format=zip --output=../hermes-browser-mod-V1.6.0-source.zip V1.6.0 生成；也可使用 GitHub 自动生成的 Source code。不要上传整个工作目录、.runtime、node_modules、Edge/宿主 EXE 或私人测试截图。仓库中的 package.json 保留 private:true 仅用于防止误发 npm，不影响 GitHub 仓库公开。

自动 CI 仅检查源码与独立 fixture；不会创建 Release、上传构建或推送代码。官方 Hermes 插件目录是另一个审核流程，本仓库没有宣称获其收录。
