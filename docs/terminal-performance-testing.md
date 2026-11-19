# Terminal 渲染性能测试

用于判断终端「CPU 占用高」到底是输出管线、xterm 渲染器，还是某个可选功能（关键词高亮、按帧合并、WebGL）的问题。

## 为什么需要专门的脚本

终端渲染成本**不随字节数线性增长**。DOM 渲染器每帧对每个脏行执行：

```ts
rowElement.replaceChildren(...this._rowFactory.createRow(...));
```

而 `createRow` 按**颜色/属性变化**切分 `<span>`（`DomRendererRowFactory.ts:186` 处逐单元格 `document.createElement('span')`）。所以：

- 10 MB 单色滚动日志，可能比 100 KB 每单元格不同颜色的全屏重绘**更便宜**
- 衡量指标应该是「每秒重绘行数 × 每行 span 数」，不是「KB/s」

`terminal-load-test.py` 的各个模式就是按这个维度设计的。

## 脚本

`scripts/terminal-load-test.py`（仅依赖 Python 3 标准库，无第三方包）

配套的 Windows 测量脚本：

- `scripts/windows-sample-cpu.ps1` — 统计 NyaTerm 整棵进程树的平均 CPU
- `scripts/windows-check-render-process.ps1` — 分辨 WebView2 各子进程（gpu / renderer / browser）谁在吃 CPU

```sh
# 最接近真实使用：htop / btop 风格的框线面板
python3 scripts/terminal-load-test.py --mode dashboard --duration 30

# 最坏情况：每个单元格都用不同颜色全屏重绘
python3 scripts/terminal-load-test.py --mode fullscreen --fps 60 --color-churn 1

# 普通滚动日志（tail -f / 编译输出）
python3 scripts/terminal-load-test.py --mode stream --color-churn 0.9

# 只测生成开销，排除终端影响
python3 scripts/terminal-load-test.py --mode dashboard --duration 5 > /dev/null
```

统计输出走 **stderr**，不会混进被测量的屏幕内容。

### 模式对照

| 模式 | 模拟场景 | 重绘特征 | 相对开销 |
|---|---|---|---|
| `spinner` | 单行进度指示 | 1 行原地重绘 | 极低 |
| `progress` | 多行进度条 | 8 行原地重绘 | 低 |
| `stream` | `tail -f`、构建日志 | 滚动，每行少量 span | 中 |
| `dashboard` | htop / btop / nvtop | 框线 + 局部数值变化 | 中高 |
| `fullscreen` | 全屏重绘型 TUI | 所有行、颜色密集 | 最高 |

### 参数

| 参数 | 说明 |
|---|---|
| `--fps` | 目标刷新率；240 可用于压极限 |
| `--duration` | 秒数；`0` 表示一直运行到 Ctrl-C |
| `--cols` / `--rows` | 覆盖终端尺寸（默认读实际尺寸） |
| `--color-churn` | 0..1，颜色变化频率。`1` 让每格颜色不同，span 数量最大化 |
| `--sync` | 每帧包在 DEC 2026 同步输出里；不加则可能看到半成品帧 |
| `--no-alt-screen` | 不切换备用屏（默认 dashboard/fullscreen 会切换） |

## 正确的测法

1. **先开渲染诊断**：设置 → 终端 → 记录渲染统计。日志会每 5 秒输出 `rowsPerSecond`、`rendererKind`、`fullScreenFrames`。
2. **固定负载**：用同一个模式、同样的 `--fps` 和 `--color-churn`，逐项切换设置。
3. **每次只改一个变量**：按帧合并、关键词高亮、WebGL 分别单独测。
4. **读 `actual fps`**：如果明显低于 `--fps`，说明渲染端追不上，此时 CPU 高是真实瓶颈而非测量噪声。

推荐基线组合：

```sh
# A. 基线
python3 scripts/terminal-load-test.py --mode dashboard --fps 60 --duration 30

# B. 开启「按帧合并终端输出」后再跑一次，对比 rowsPerSecond 与 CPU

# C. 最坏情况，用来观察上限
python3 scripts/terminal-load-test.py --mode fullscreen --fps 60 --color-churn 1 --duration 30
```

## 现成的第三方工具

有一些通用工具可以产生 TUI 负载，但都不是为了测渲染器而设计的：

| 工具 | 用途 | 局限 |
|---|---|---|
| `htop` / `btop` / `nvtop` | 真实 TUI 负载，最贴近日常 | 帧率与色彩密度不可控，不便于对比 |
| `yes` / `cat /dev/urandom \| base64` | 单色滚动压力 | 无法产生原地重绘和颜色密集场景 |
| `cmatrix` / `hollywood` | 全屏动画 | 依赖具体系统，参数不可控 |
| `vtebench` | 终端模拟器基准（VTE 项目） | 偏重吞吐，不模拟 TUI 局部重绘 |

结论：**没有一个工具能同时控制帧率、色彩密度、重绘范围和是否启用同步输出**，而这四项恰好决定了 DOM 渲染器的成本。所以要自己写一个。

## Windows 上怎么测

终端渲染运行在 WebView2 的子进程（`msedgewebview2.exe`）里，不在
`nyaterm-classic.exe` 主进程中。只看主进程会严重低估占用。

两个窗口，各跑一个：

```powershell
# 窗口 A（NyaTerm 的终端标签）：产生负载
python terminal-load-test.py --mode dashboard --fps 30 --duration 60

# 窗口 B（NyaTerm 外面的普通 PowerShell）：采样
.\scripts\windows-sample-cpu.ps1 -Seconds 20

# 想知道是哪个子进程在忙
.\scripts\windows-check-render-process.ps1
```

后者的输出里 `renderer` 最热说明问题在 JS/DOM（可在代码里修）；
`gpu` 最热说明 WebView2 在用软件光栅化，只能靠降帧率或给虚拟机开 3D 加速。

## 结果记录

测试时建议记录：

- 机器：是否虚拟机、是否启用 GPU 加速、WebView2 版本
- 设置：按帧合并 / 关键词高亮 / WebGL 各自开关状态
- 脚本参数：模式、fps、color-churn、几何尺寸
- 日志里的 `rowsPerSecond`、`framesPerSecond`、`fullScreenFrames`
- 任务管理器中的 CPU 占用（观察稳定后 10 秒的平均值）
