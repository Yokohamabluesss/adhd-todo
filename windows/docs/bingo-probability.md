# How many tasks does it take to make a Bingo?

[中文版](#zh)

On a full 3×3 board with equal weights, following the draw gives you a **38.10%** chance of having a line by your fourth task and **77.78%** by your fifth. By your seventh, a line is guaranteed on that board.

| Starting layout and how tasks are picked | 3 tasks | 4 tasks | 5 tasks | 6 tasks | 7 tasks |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full board, equal weights | 9.52% | 38.10% | 77.78% | 97.62% | 100.00% |
| Centre empty, equal weights | 7.14% | 28.57% | 64.29% | 92.86% | 100.00% |
| Top row Standard, other squares Low | 10.96% | 41.72% | 80.97% | 98.21% | 100.00% |
| Must-do in the centre | 14.29% | 50.00% | 88.57% | 100.00% | 100.00% |
| Must-do in a corner | 10.71% | 41.07% | 80.00% | 98.21% | 100.00% |
| Must-do in a corner, sometimes pick manually | 18.97% | 60.27% | 89.88% | 98.87% | 100.00% |

Each column gives the chance of having **at least one line** by that many completions. A row, column or main diagonal counts. The board stays fixed throughout, and each task can be completed once. The first five rows follow every draw. Standard tasks have two tickets and Low tasks have one. In both Must-do layouts the other eight tasks have equal weights.

In the last scenario the Must-do is in the bottom-right corner. Each choice has a 50% chance of picking the leftmost unfinished task in the top row. The other half follow the draw. Once that row is complete, every choice follows the draw. For this strategy, the chance of **round success**, which requires clearing the corner Must-do as well, is **6.47% after 3 tasks**, then **60.27%, 89.88%, 98.87% and 100%** after 4 through 7. In the other five cases, the chance of a line and the chance of round success agree at these counts.

## Reproduce the study on Windows

Run the command below from the repository root. The study models the draw rules used by both editions. It reads no personal board data.

There are 84 ways to choose three squares out of nine, and eight are lines. For the other counts and layouts, the script uses exact enumeration, recalculating draw chances after each completion. It also samples 100,000 rounds per layout, 600,000 in total. For instance, on the equal-weight full board the simulated five-task rate was 77.90%, compared with the exact 77.78%. The script prints both estimates and 95% Wilson intervals for the simulated proportions. [Python script](../../scripts/simulate_bingo.py)

```powershell
py scripts/simulate_bingo.py --trials 100000 --seed 20261121
```

---

<a id="zh"></a>

# 做完几项任务，比较容易连成 Bingo？

在九格全满、每格抽中机会相同的棋盘上，如果一直跟随抽选，**做完 4 项时有 38.10% 的机会已经连线，做完 5 项时升到 77.78%**。做到第 7 项，这种棋盘一定能连线。

| 起始摆法与选择方式 | 3 项 | 4 项 | 5 项 | 6 项 | 7 项 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 满盘，所有格子同权 | 9.52% | 38.10% | 77.78% | 97.62% | 100.00% |
| 中心留空，其余同权 | 7.14% | 28.57% | 64.29% | 92.86% | 100.00% |
| 第一行三个标准格，其余低优先级 | 10.96% | 41.72% | 80.97% | 98.21% | 100.00% |
| 必做放中心 | 14.29% | 50.00% | 88.57% | 100.00% | 100.00% |
| 必做放角落 | 10.71% | 41.07% | 80.00% | 98.21% | 100.00% |
| 必做放角落，部分手选 | 18.97% | 60.27% | 89.88% | 98.87% | 100.00% |

每一列是做到该项数时，**已经连成至少一条线**的精确概率。线可以是一整行、一整列或一条大对角线。全程保持同一布局，每项任务只完成一次。表中前五种都跟随抽选。标准任务有两张签，低优先级任务有一张签。两个必做场景里的其余八格权重相同。

最后一种把必做放在右下角。每步以 50% 的概率手选第一行最左边的待做格，否则跟随抽选。第一行做完后只跟随抽选。这个策略下，**本轮成功**还要做完角落的必做任务，做完 3 项时为 **6.47%**，做完 4 到 7 项时依次为 **60.27%、89.88%、98.87%、100%**。其余五种在表列项数下，连线概率与本轮成功概率相同。

## 在 Windows 上复算

在仓库根目录运行下方命令。研究使用两版共用的抽选口径，输入为预设布局，无需读取个人棋盘。

九格选三格，共有 84 种组合，其中 8 种能成线。其他项数和摆法由脚本精确枚举，每完成一项都重算抽中剩余各格的概率。另外，每种布局独立模拟 10 万轮，共 60 万轮。例如满盘同权时，五项内连线的模拟值为 77.90%，精确值为 77.78%。脚本会输出两种结果，以及模拟比例的 95% Wilson 区间。[Python 脚本](../../scripts/simulate_bingo.py)

```powershell
py scripts/simulate_bingo.py --trials 100000 --seed 20261121
```
