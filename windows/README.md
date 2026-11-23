# ADHD Todo for Windows

[简体中文](#zh)

**Requires Windows x64 and a local installation of Microsoft Edge.** Double-click **ADHD Todo.exe** to open the board in a dedicated Edge window. The executable includes Python, the interface, and SQLite, so you can play offline. Close the window when you finish and reopen the executable to resume.

The first launch opens a full sample board. Choose **Start round → Draw a task** to let the board pick where to begin. Three squares say “Write my paper”. Placing several copies gives that project more chances in an eligible draw. When a Bingo feels like enough for today, choose **End round**. Unfinished tasks stay on the board for next time.

![A Windows round with a Must-do square selected](docs/board.png)

| What would you like to try? | Windows guide |
| --- | --- |
| Play one round, from setup to Bingo and the decision to stop | [First round in screenshots](docs/first-round.md) |
| Adjust weights, add steps, carry work over, restore a save and preview resets | [Detailed walkthrough](docs/detailed-walkthrough.md) |
| Understand how the board helps with starting, stopping and keeping several projects in play | [ADHD design notes](docs/adhd-design-notes.md) |
| Interpret the calendar, draw adoption and completion rates, or query your local data | [Board statistics and SQL](docs/metrics.md) |
| Compare six layouts and see the chance of Bingo after 3–7 completions | [Bingo probability study](docs/bingo-probability.md) |
| Test a change, refresh screenshots, prepare a release or review planned features | [Maintenance, release and changes](docs/maintenance.md) |

## Where your boards live

The default save is `%LOCALAPPDATA%\ADHD Todo\boards.sqlite`. Paste `%LOCALAPPDATA%\ADHD Todo` into File Explorer to find it. Updating or moving the executable keeps using this file. The adjacent `window` folder holds the dedicated Edge profile, including your language and chart preferences.

| What you want to move | In the original app | In Windows or the web app |
| --- | --- | --- |
| One board, with its current round and history | Saves → Download current board | Import a save → Add board |
| The entire workspace and its default board | Saves → Download all boards | Import a save → Replace boards |

Use **Saves** to back up while the app is open. Notes, images, placed tasks, steps, points, and statistics travel together. Existing web backups (v1–v3) and individual board transfers (v4) use the same import and confirmation screens. The hosted web app and this local file advance independently after transfer.

## Architecture

| Component | Responsibilities |
| --- | --- |
| TypeScript interface | Shares the web edition’s screens, input handling, animations, task forms and translations. It validates imported saves and runs the Stats queries. |
| Python board rules | Handles task placement, weighted draws, shuffling, scoring, Bingo, round completion and resets. |
| SQLite storage | Python reads and writes boards, rounds, completions and events. Each write checks the workspace revision and commits the changes in one transaction. The database exposes the same reporting views used by Stats. |

At launch, the executable starts a Python HTTP service on `127.0.0.1` and opens the interface in Microsoft Edge’s app mode. The interface sends gameplay commands to the service. Form edits and validated imports send a workspace snapshot. The interface displays the state returned after the transaction commits.

## Build from source

From the repository root on Windows x64, install Node.js 24+, Python 3.11+ with SQLite, and Microsoft Edge. The packaged build was tested with Python 3.14 and PyInstaller 6.18. Run in PowerShell:

```powershell
npm.cmd ci
py -m venv windows/.build/env
$python = (Resolve-Path windows/.build/env/Scripts/python.exe).Path
& $python -m pip install PyInstaller==6.18.0
.\windows\build.ps1 -Python $python
```

The executable is written to `windows/out/ADHD Todo.exe`. To run the source directly, use `npm.cmd run build:windows`, then `py windows/app.py`. The default local port is 4176. If another program owns it, pass `--port 4180`. For isolated test data pass `--data-dir PATH`. The optional `--serve-only` flag runs the same service without launching a window.

## Verify a change

Run these from the repository root after building. The UI and package checks open Edge with disposable data directories. The package check opens and closes real desktop windows.

```powershell
npm.cmd test
py windows/test_rules.py
py windows/test_ui.py
py windows/test_package.py
```

The rule suite compares intermediate Python and TypeScript board states, rollbacks and competing completions. The UI suite reuses the web app's browser scenarios. The package suite transfers an open round both ways, compares the Board, Set up and Stats renderings on the same data, and checks the disk save after closing and reopening the executable.

<a id="zh"></a>

# ADHD Todo Windows 版

**运行要求为 Windows x64，且本机已安装 Microsoft Edge。** 双击 **ADHD Todo.exe** 后，棋盘会在独立的 Edge 窗口中打开。程序自带 Python、界面资源和 SQLite，可以离线使用。用完直接关窗，下次双击继续。

首次启动会打开满盘示例。点**开始本轮 → 抽一项任务**，让棋盘帮你决定从哪里开始。示例里有三个格子都叫「Write my paper」：想多做写论文这件事，就可以多放几份，增加它在符合条件时被抽中的机会。连成 Bingo 后，如果觉得今天可以收工了，就手动结束。未完成的事下轮还能接着做。

![Windows 棋盘进行中，当前选中一格必做任务](docs/board.png)

| 想体验什么 | Windows 版文档 |
| --- | --- |
| 从摆盘开始，试一次抽选、连线和手动收工 | [第一轮试玩图解](docs/first-round.md#zh) |
| 调整权重、拆步骤、跨轮续做、迁移存档、预览三种重置 | [详细操作图解](docs/detailed-walkthrough.md#zh) |
| 了解棋盘怎样帮助启动、安心收工、同时推进几个项目 | [ADHD 设计说明](docs/adhd-design-notes.md#zh) |
| 看懂日历、首抽采纳与完成率，或查询本地记录 | [统计指标与 SQL](docs/metrics.md#zh) |
| 比较六种摆法，看看做完 3–7 项时的连线概率 | [Bingo 概率研究](docs/bingo-probability.md#zh) |
| 修改后验收、更新截图、准备发布，或查看后续功能 | [维护、发布流程与更新记录](docs/maintenance.md#zh) |

## 存档位置和互导

默认存档为 `%LOCALAPPDATA%\ADHD Todo\boards.sqlite`。将 `%LOCALAPPDATA%\ADHD Todo` 粘贴到文件资源管理器地址栏即可找到。移动或替换 exe 后依然读取这份文件。同目录的 `window` 是专用 Edge 配置，保存语言和图表等界面偏好。

| 想带走什么 | 在原来的程序里 | 在 Windows 或网页版里 |
| --- | --- | --- |
| 一个棋盘、它进行中的轮次和历史 | 存档 → 下载当前棋盘 | 导入存档 → 添加棋盘 |
| 全部棋盘和默认棋盘选择 | 存档 → 下载所有棋盘 | 导入存档 → 替换棋盘 |

开着程序时可直接通过**存档**菜单做备份。任务、步骤、文字与图片备注、点数和统计会一起带走。网页版旧备份（v1–v3）和单棋盘文件（v4）沿用相同的导入及确认流程。迁移后，两端各自记录新的进度。

## 架构

| 组件 | 职责 |
| --- | --- |
| TypeScript 界面 | 与网页版共用页面、输入处理、动画、任务表单和翻译。负责校验导入的存档，并运行统计页的 SQL 查询。 |
| Python 棋盘规则 | 处理任务上板、加权抽选、打乱、计分、Bingo 判定、轮次结束和重置。 |
| SQLite 存储 | Python 读写棋盘、轮次、完成记录和操作事件。每次写入时校验工作区版本，并在同一事务中提交变更。数据库包含统计页使用的 SQL 视图。 |

双击 exe 后，程序在 `127.0.0.1` 启动 Python HTTP 服务，并用 Microsoft Edge 的应用窗口显示界面。抽选、完成任务等操作以单条指令发送给 Python。表单编辑和通过校验的导入操作提交整个工作区快照。事务提交后，界面显示服务返回的棋盘状态。

## 从源码构建

在 Windows x64 电脑上安装 Node.js 24+、自带 SQLite 的 Python 3.11+ 和 Microsoft Edge。本次打包使用 Python 3.14 和 PyInstaller 6.18。在仓库根目录打开 PowerShell，执行：

```powershell
npm.cmd ci
py -m venv windows/.build/env
$python = (Resolve-Path windows/.build/env/Scripts/python.exe).Path
& $python -m pip install PyInstaller==6.18.0
.\windows\build.ps1 -Python $python
```

生成的文件位于 `windows/out/ADHD Todo.exe`。源码试玩可直接运行 `npm.cmd run build:windows`，然后运行 `py windows/app.py`。默认本机端口为 4176，若已被其他程序占用，可以加 `--port 4180`。需要隔离测试存档时加 `--data-dir 路径`，只启动服务时加 `--serve-only`。

## 修改后怎样验证

构建后在仓库根目录执行。界面和打包测试都使用临时数据。打包测试会真实打开、关闭桌面窗口。

```powershell
npm.cmd test
py windows/test_rules.py
py windows/test_ui.py
py windows/test_package.py
```

规则测试逐步对照 Python 和 TypeScript 的盘面，并验证写入回滚和同时确认同一格。界面测试直接复用网页版的浏览器操作脚本。打包测试在两端互导进行中的轮次，用同一份数据比较主板、摆盘、统计的画面，并在关闭和重开 exe 后检查磁盘存档。
