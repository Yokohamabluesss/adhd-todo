# Maintain and release the Windows edition

[简体中文](#zh)

## Update a working copy

Start with `git status -sb` and `git remote -v`. The Windows work began on `python-local`. If the branch already tracks a remote branch, `git pull --ff-only` brings in committed changes. If there are local edits, review those before pulling. To work on a separate change, create a branch from the Windows revision you intend to ship.

Use the [Windows build instructions](../README.md) for the first checkout. The web and Windows builds use the same TypeScript screens and translations. For a gameplay change, update the corresponding TypeScript and Python rules and add the scenario to the parity cases. For a save change, check both the old-file importer and a round trip between editions.

## Build and check a candidate

Run in PowerShell at the repository root, with the build environment from the README available.

```powershell
$python = (Resolve-Path windows/.build/env/Scripts/python.exe).Path
.\windows\build.ps1 -Python $python
npm.cmd test
& $python windows/test_rules.py
& $python windows/test_ui.py --docs
& $python windows/test_package.py
Get-FileHash -Algorithm SHA256 -LiteralPath 'windows/out/ADHD Todo.exe'
```

| Check | What to look for |
| --- | --- |
| Shared tests and rule parity | The same inputs produce the same intermediate boards and points. A repeated confirmation pays once. A failed transaction preserves the previous save. |
| UI and guides | The UI suite uses disposable native databases. With `--docs`, it also replays both illustrated guides and writes 29 images to `windows/docs`. Review the screenshots beside the instructions. Use `windows/test_ui.py` alone for a regression run without replacing the images. |
| Packaged executable | The test opens and closes actual app windows, verifies a web → Windows → web transfer, compares Board, Set up and Stats, then reopens the executable and checks the saved round. |
| A second Windows PC | Copy the candidate executable to a Windows x64 PC with Edge installed. Follow the [first round](first-round.md), close the app mid-round and reopen it. For an upgrade, download a backup from the previous build first, close it, and run the candidate under the same Windows account. Verify the default board, steps, points and history. Record the Windows and Edge versions. |

## Commit and publish

Review `git diff` and `git status --short`. Stage the intended source, documentation and screenshots, review `git diff --cached`, then commit. Use `git push -u origin python-local` when publishing that branch for the first time. On later visits use `git pull --ff-only` before editing and `git push` after committing.

For a packaged release, tag the **tested commit**, create a GitHub Release for that tag, attach `windows/out/ADHD Todo.exe`, and include its SHA-256, supported platform and user-visible changes. The executable is a release attachment. Keep personal databases, Edge profiles, local build directories and private project notes out of the release. To check the download, compare its hash with the one calculated above. GitHub Pages serves the web edition separately.

If a candidate fails an upgrade test, keep the old executable and the pre-upgrade backup. Reproduce the issue in a separate `--data-dir`. To return to the old version, restore the backup made with that version into a separate workspace first and verify the round before continuing.

## Changes and next steps

The first desktop build adds offline double-click launch, a durable SQLite workspace per Windows account and transfer of single boards or full saves between editions. It carries over the sample, notes and images, Task steps, manual endings, day boundary, bilingual UI and Stats. The in-app **Update** page lists shared feature changes.

Planned shared features include more round goals and draw options, optional timers and Pomodoro sessions, finer time increments, and comparing planned with actual focus time. Optional script and AI interpretation of personal statistics is also planned. The [architecture notes](../README.md) describe what future integrations and cloud sync would require.

<a id="zh"></a>

# Windows 版维护与发布流程

## 更新本地工作区

先运行 `git status -sb` 和 `git remote -v` 查看分支、工作区和远程地址。Windows 版从 `python-local` 分支开发。已有远程跟踪分支时，用 `git pull --ff-only` 拉取已提交的更新。本地如有改动，拉取前先检查这些改动。单独开发一项功能时，从准备交付的 Windows 版本创建工作分支。

首次构建见 [Windows README](../README.md#zh)。两版共用页面和翻译。如果改玩法，需要同时核对 TypeScript 和 Python 规则，把对应场景加进两端的对照测试。改存档时，既要能读旧档，也要能把进行中的轮次在两端来回迁移。

## 打包和验收

在仓库根目录打开 PowerShell，使用 README 中配置好的构建环境。

```powershell
$python = (Resolve-Path windows/.build/env/Scripts/python.exe).Path
.\windows\build.ps1 -Python $python
npm.cmd test
& $python windows/test_rules.py
& $python windows/test_ui.py --docs
& $python windows/test_package.py
Get-FileHash -Algorithm SHA256 -LiteralPath 'windows/out/ADHD Todo.exe'
```

| 检查 | 怎样判断通过 |
| --- | --- |
| 共用测试与规则对照 | 同一组操作的中间盘面和点数逐步一致。重复确认只发一次点，事务失败后能读回原进度。 |
| 界面与图文指南 | 测试使用临时 SQLite。带 `--docs` 会额外重走两套指南，把 29 张图写入 `windows/docs`。按图核对操作文字。日常回归只运行 `windows/test_ui.py`，即可保留现有截图。 |
| 打包产物 | 测试真实打开并关闭程序窗口，验证网页 → Windows → 网页互导，对照主板、摆盘与统计页面，再次启动 exe 读取刚才的轮次。 |
| 换一台 Windows 电脑 | 把 exe 复制到装有 Edge 的 Windows x64 电脑，按[第一轮试玩](first-round.md#zh)操作，中途关窗再开。测升级前，先用旧版本下载全部棋盘，关窗后用同一账户启动候选版本，核对默认棋盘、步骤、余额和历史，并记录 Windows 和 Edge 版本。 |

## 提交和发布

用 `git diff` 和 `git status --short` 检查改动，暂存这次的源码、文档和截图，再用 `git diff --cached` 复核并提交。首次决定公开这个分支时，运行 `git push -u origin python-local`。之后每次修改前用 `git pull --ff-only`，提交后用 `git push`。

发布可执行文件时，给**实际通过测试的提交**打标签，在 GitHub 为这个标签创建 Release，把 `windows/out/ADHD Todo.exe` 添加为附件。说明里写上 SHA-256、支持的平台和这次影响用户的变化。发布内容只包含分发所需文件，个人数据库、Edge 配置、本地构建目录和私人维护记录留在本机。下载后复算哈希，与打包时的值核对。GitHub Pages 单独提供网页版。

若升级验证失败，保留旧 exe 和升级前的备份，用单独的 `--data-dir` 重现。回到旧版本前，先在独立目录导入由旧版本制作的备份，确认轮次完整再继续。

## 本版更新与后续

首版支持双击离线启动，按 Windows 账户保存固定的 SQLite 文件，还可以和网页版互导单棋盘或全量存档。示例、图文备注、任务步骤、手动收工、自定义分日、中英文和统计都沿用网页版体验。程序内的**更新**页可以查看两版共有的功能变化。

后续共用功能包括更多轮次目标与抽选选项、可选计时器和番茄钟、更细的时间单位、预计和实际专注时长对比，以及用脚本和可选 AI 接口解读个人统计。未来接插件或做云同步时需要增加哪些能力，见[架构说明](../README.md#zh)。
