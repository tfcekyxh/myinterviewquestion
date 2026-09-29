# 面试题背诵 · UED 设计规范 v1

> 依据 `project-scope.md` 产出。目标平台：手机 H5（iPhone 竖屏优先），Safari 打开。
> 配套文件：`design/prototype.html`（可交互高保真原型，手机浏览器可直接打开）。

---

## 一、设计目标与原则

**产品定位**：一个人的、安静的、专注的背题工具。不是社交产品，不是效率工具。

| 原则 | 含义 | 具体做法 |
|---|---|---|
| 内容优先 | 屏幕上最重要的永远是题目本身 | 题干 22px 起、正文区不加边框、装饰元素一律省略 |
| 一屏一事 | 每屏只有一个主操作 | 主按钮全宽、每屏最多 1 个实心按钮 |
| 不打断 | 背题过程不能被弹窗、动画干扰 | 无 loading 弹层、切换无转场动画、无 Toast 堆叠 |
| 状态可见 | 用户随时知道「第几题 / 背到哪」 | 每屏顶部固定显示 `第 x / N 题` + 细进度条 |
| 单手可达 | 只用拇指就能完成全部操作 | 主操作固定在屏幕下方 1/3 区域 |

---

## 二、设计令牌（Design Tokens）

### 2.1 颜色

| 令牌 | 值 | 用途 |
|---|---|---|
| `primary` | `#2563EB` | 主按钮、进度条、选中态 |
| `primary-soft` | `#EFF4FF` | 主色浅底（选中卡片、提示块） |
| `success` | `#0E9F6E` | 已背完、自评「会了」 |
| `success-soft` | `#E9F7F1` | 成功态浅底 |
| `danger` | `#E5484D` | 录音中、错误提示、自评「不会」 |
| `danger-soft` | `#FDEDED` | 录音条底色、错误块底色 |
| `bg` | `#F5F6F8` | 页面底色 |
| `surface` | `#FFFFFF` | 卡片、输入框 |
| `surface-2` | `#F0F2F5` | 次级块（如答案区、波形底） |
| `text-1` | `#141A23` | 题干、标题 |
| `text-2` | `#69737F` | 答案正文、说明文字 |
| `text-3` | `#98A1AC` | 计数、占位符、辅助文字 |
| `line` | `#E6E9EE` | 分隔线、卡片描边 |

**约束**：全局颜色不超过以上 13 个。不使用渐变、不使用阴影色（阴影仅用于卡片浮起，见 2.4）。

### 2.2 字体

- 字体族：`-apple-system, "PingFang SC", "SF Pro Text", sans-serif`
- 全部使用系统字，不引入 web font（首屏速度优先）

| 样式 | 字号 / 行高 | 字重 | 用途 |
|---|---|---|---|
| `display` | 28 / 36 | 600 | 登录页产品名 |
| `title-1` | 22 / 32 | 600 | 题干 |
| `title-2` | 17 / 26 | 600 | 页面标题、区块标题 |
| `body` | 15 / 26 | 400 | 答案正文 |
| `body-strong` | 15 / 26 | 500 | 按钮文字、列表主文字 |
| `caption` | 13 / 20 | 400 | 说明、次要信息 |
| `micro` | 11 / 16 | 400 | 计数、角标 |

### 2.3 间距与圆角

- 间距基数 `4px`，只使用：`4 / 8 / 12 / 16 / 20 / 24 / 32`
- 页面左右安全边距：`20px`
- 圆角：`8px`（小控件）/ `12px`（按钮、输入框）/ `16px`（卡片）/ `22px`（大卡片、麦克风按钮）
- 最小可点区域：`44 × 44px`

### 2.4 阴影

只允许一种，用于卡片浮起：
`0 1px 2px rgba(20,26,35,0.04), 0 8px 24px rgba(20,26,35,0.06)`

---

## 三、组件清单

在 Figma 中先建组件再拼页面，不要复制粘贴图层。

| 组件名 | 变体 | 说明 |
|---|---|---|
| `Button/Primary` | default / pressed / disabled / loading | 全宽、高 50px、圆角 12 |
| `Button/Secondary` | default / pressed | 描边版，高 50px |
| `Button/Mic` | idle / recording | 圆形，直径 88px，唯一的大圆按钮 |
| `Input/Text` | default / focus / error / filled | 高 50px，圆角 12，label 在框上方 |
| `Card/Question` | 背诵态 / 复习态 | 题干 + 分隔线 + 答案（复习态答案区可隐藏） |
| `Chip/Mode` | 顺序 / 随机 | 胶囊，高 32px，选中为 primary-soft 底 + primary 字 |
| `ProgressBar` | 顶部细条 / 卡片内粗条 | 细条高 3px，粗条高 6px |
| `NavBar` | 返回型 / 无返回型 | 高 56px，居中标题，左返回、右操作 |
| `TabBar` | — | 底部 3 项：背诵 / 复习 / 我的（本期仅作视觉占位） |
| `Empty/Placeholder` | — | 虚线框，用于「还没导入题库」 |
| `Feedback/Inline` | info / error | 行内提示，不用弹窗 |

---

## 四、页面流程

```
登录 ──▶ 首页 ──┬──▶ 导入题库 ──▶ 解析结果 ──▶ 背诵页
                │
                ├──▶ 继续背诵 ──▶ 背诵页 ──▶ (背完一轮) ──▶ 复习范围选择
                │
                └──▶ 开始复习 ──▶ 复习范围选择 ──▶ 复习·待录 ──▶ 复习·录音中 ──▶ 复习·对照答案
                                                                                    │
                                                                          (下一题，循环回待录)
我的 ◀── 首页右上角入口
```

**关键跳转规则**

1. 背诵页背到最后一题 → 弹出「这一轮背完了，要去复习吗？」→ 是则进复习范围选择（默认选中「刚背完的这一轮」）。
2. 复习范围选择页提供「顺序 / 随机」切换；默认沿用背诵时的模式。
3. 复习页每一题都是：待录 → 录音中 → 对照答案 → 下一题。答案在「对照答案」之前**不可见**（无任何可点的「显示答案」入口）。

---

## 五、逐屏设计说明

> 每屏均给出 Figma 建议的 Frame 名与 Auto Layout 结构，可直接照着搭。

### S0 登录

- **Frame**：`S0_Login`，390 × 844
- **结构**：`Vertical, padding 20/20/32/20, gap 0`（三段：头部留白 flex-grow、表单、底部说明）
- **元素**
  - 产品名 `display`：「面试题背诵」
  - 副标题 `caption` text-2：「把题库变成一张张卡片」
  - `Input/Text` 账号 → `Input/Text` 密码（右侧「显示」小按钮）
  - `Button/Primary`「登录」
  - `Feedback/Inline error`（错误时才显示）：「账号或密码不正确」
  - 底部 `micro` text-3：「仅本人使用，不开放注册」
- **交互**：提交时按钮进入 loading；失败在按钮上方显示行内错误，不弹窗；密码错误 5 次不做锁定（单用户，无必要）

### S1 首页

- **Frame**：`S1_Home`，390 × 844
- **结构**：`Vertical, padding 20, gap 20`
- **元素**
  - 顶部行：`下午好`（`title-2`） + 右上角齿轮图标（进「我的」）
  - 进度卡 `Card`：`已背 128 / 240`（进度数字用 24px/600）+ `ProgressBar` 粗条 + 一行 `caption`：「上次背到第 129 题」
  - 主按钮 `Button/Primary`：「继续背诵」
  - 次按钮 `Button/Secondary`：「开始复习」
  - 题库信息行 `caption` text-3：「题库：面试题库.pdf · 240 题」+ 右侧「管理」
- **未导入题库时**：进度卡替换为 `Empty/Placeholder`：「还没有题库，点这里导入 PDF」，主按钮变为「导入题库」，隐藏复习入口
- **交互**：首页不做自动跳转；「继续背诵」永远从上次的位置进入（云端进度）

### S2 导入题库

- **Frame**：`S2_Import`，390 × 844
- **元素**
  - `NavBar` 「导入题库」
  - `Empty/Placeholder` 虚线区：图标 + 「点击选择 PDF 文件」+ `caption`「支持 .pdf；扫描版图片需要额外识别」
  - 已选文件行：`面试题库.pdf` + `caption`「2.4 MB」
  - 说明块 `Feedback/Inline info`：「解析会按 PDF 的排版自动切分题目与答案，解析完可以逐题检查」
  - `Button/Primary`「开始解析」（未选文件时 disabled）
- **交互**：选择文件后按钮激活；点击后进入 S3

### S3 解析结果

- **Frame**：`S3_ParseResult`，390 × 844
- **元素**
  - `NavBar` 「解析完成」
  - 统计行（3 个并排 `Metric`）：`240` 题目 / `240` 答案 / `2` 处待确认
  - 标题 `title-2`「前 3 题预览」
  - 3 张预览卡：题干（1 行截断）+ 答案前一行（text-3，1 行截断）+ 右上角「修正」
  - `Button/Primary`「开始背诵」
  - `Button/Secondary`「重新导入」
- **交互**：「修正」进入单题编辑；`2 处待确认` 是黄色警告色入口，点击可跳转到第一处问题

### S4 背诵页（题答同屏）

- **Frame**：`S4_Recite`，390 × 844
- **结构**：`Vertical`，顶部固定 / 中部滚动 / 底部固定
- **元素**
  - 顶部：返回箭头 + `第 12 / 240 题`（`caption`）+ 右侧 `Chip/Mode`（顺序 / 随机，点击切换并提示「已切换为随机」行内提示）
  - `ProgressBar` 细条，紧贴顶部下方
  - `Card/Question`：题干 `title-1` → `line` 分隔 → 答案 `body` text-2
  - 底部操作行：`Button/Secondary`「上一题」+ `Button/Primary`「下一题」
  - 底部 `micro` text-3 居中：「答案与题目同屏，先自己过一遍再看」
- **交互**：左右滑动手势等同上一题 / 下一题；切到随机模式时记录当前题位置，切回顺序可继续
- **不做**：不加「显示答案 / 隐藏答案」按钮（本期决策为同屏）

### S5 复习范围选择

- **Frame**：`S5_ReviewScope`，390 × 844
- **元素**
  - `NavBar` 「开始复习」
  - 说明 `caption` text-2：「答案会先藏起来，请对着题目开口讲一遍并录音」
  - 两张可选中卡片（`primary-soft` 底 + `primary` 描边表示选中）
    - 「刚背完的这一轮」`caption`「第 1 – 12 题」
    - 「整个题库」`caption`「共 240 题」
  - `Chip/Mode` 行：顺序 / 随机（默认沿用背诵时的模式）
  - `Button/Primary`「开始复习」
- **交互**：默认选中「刚背完的这一轮」；从首页进入时若没有「刚背完的一轮」记录，则该卡片 disabled 并标注「还没有背完的记录」

### S6 复习 · 待录

- **Frame**：`S6_Review_Ready`，390 × 844
- **元素**
  - 顶部：返回 + `第 12 / 240 题` + `Chip/Mode`
  - `ProgressBar` 细条
  - 题干 `title-1`
  - 答案区：**不显示内容**，只留一块 `surface-2` 的占位，中间一行 `caption` text-3：「答案已隐藏」
  - 底部：`Button/Mic`（idle）+ 下方 `caption`「按住说话，讲完松手」
- **交互**：按住开始录音；松手即进入 S7 的结束态（或直接结束）。**整个页面没有任何可点开答案的入口**，这是复习模式的核心约束

### S7 复习 · 录音中

- **Frame**：`S7_Review_Recording`，390 × 844
- **元素**
  - 顶部同 S6
  - 题干 `title-1`（保持可见，边讲边看题）
  - 计时行：红点（8px 圆，danger）+ `录音中` + `00:14`（`mono`，等宽数字）
  - 波形：24 根 2px 宽竖条，高 6–24px，颜色 danger
  - `Button/Mic`（recording 态，danger 描边）
  - `Button/Secondary`「说完了」
- **交互**：波形随音量实时变化（真实实现用 AnalyserNode）；超过 3 分钟给一次震动/行内提示但不强制停止

### S8 复习 · 对照答案

- **Frame**：`S8_Review_Compare`，390 × 844
- **元素**
  - 顶部同 S6
  - 题干 `title-1`（缩小为 `title-2`，为答案让出空间）
  - 回放条 `Card`：左侧三角播放图标 + 「回放我刚才说的」+ 右侧时长 `00:14`，中间一条细播放进度
  - 分隔 `line`
  - 「参考答案」`title-2` + 答案 `body` text-2
  - 底部：`Button/Secondary`「上一题」+ `Button/Primary`「下一题」
- **交互**：回放条可拖动进度；离开本屏时音频自动停止

### S9 我的

- **Frame**：`S9_Me`，390 × 844
- **元素**
  - `NavBar` 「我的」
  - 账号卡：头像占位（首字母）+ 账号（脱敏显示）+ `caption`「已登录」
  - 列表组：
    - 题库：`面试题库.pdf · 240 题` → 「重新导入」
    - 背诵进度：`已背 128 / 240` → 「重置」
    - 录音存储：`仅保存在本机` （右侧开关置灰，标注「待定」）
  - `Button/Secondary`「退出登录」（danger 文字色）
- **交互**：「重置进度」需要二次确认（行内展开确认条，不用弹窗）

---

## 六、Figma 文件组织建议

```
Page 1 · 🎨 Design Tokens
   ├─ Color styles  （13 个，命名：primary / text-1 / line …）
   ├─ Text styles   （7 个，命名：display / title-1 / body …）
   └─ Effect styles （shadow-card）

Page 2 · 🧩 Components
   ├─ Button/Primary        （4 变体）
   ├─ Button/Secondary      （2 变体）
   ├─ Button/Mic            （2 变体）
   ├─ Input/Text            （4 变体）
   ├─ Card/Question         （2 变体）
   ├─ Chip/Mode             （2 变体）
   ├─ ProgressBar           （2 变体）
   ├─ NavBar                （2 变体）
   └─ Feedback/Inline       （2 变体）

Page 3 · 📱 Screens
   ├─ 01 S0_Login
   ├─ 02 S1_Home          （含「未导入题库」变体）
   ├─ 03 S2_Import
   ├─ 04 S3_ParseResult
   ├─ 05 S4_Recite
   ├─ 06 S5_ReviewScope
   ├─ 07 S6_Review_Ready
   ├─ 08 S7_Review_Recording
   ├─ 09 S8_Review_Compare
   └─ 10 S9_Me

Page 4 · 🔗 Prototype
   └─ 用 Screens 复制一份，连好流程（见第四节）
```

**Auto Layout 约定**

- 所有 Frame 均为 `Vertical`，页面级 padding `20`，元素间距 `20`
- 卡片内部 padding `16`，标题与正文间距 `12`，正文行距按文字样式自带
- 顶部 NavBar 高 `56`，底部按钮区高 `72`（含安全区）
- 所有文本节点宽度设为 `Fill container`，不手动断行

---

## 七、给开发的标注要点

1. 触控目标不小于 44×44px（特别是返回箭头、Chip）。
2. 底部固定元素需适配 iPhone 安全区（`env(safe-area-inset-bottom)`）。
3. 麦克风相关操作**必须**在 HTTPS + Safari 下才可用，需要做能力检测与明确提示。
4. 题干长短差异极大，卡片高度必须自适应，不做固定高。
5. 数字（题号、计时、进度）使用等宽数字（`font-variant-numeric: tabular-nums`），避免跳动。
