# 抖音直播中控助手 — 代码审查报告

> 审查日期：2026-08-03
> 版本：manifest v2.0.0（实际 MV3）
> 结论：**架构思路清晰、可运行，但存在若干功能性 BUG、性能隐患、大量死代码，以及一处对直播带货场景有真实风险的设计缺陷（改价/库存无二次确认）。**

---

## 一、功能与架构概况

| 能力 | 实现方式 | 状态 |
|------|----------|------|
| 自动讲解 | 按间隔点击商品「讲解」按钮（循环+随机浮动） | ⚠️ 逻辑有 BUG |
| 自动发评 | 找聊天输入框→填值→点发送/回车 | ⚠️ 选择器脆弱 |
| 改价/改库存 | 点「改价/库存」→填弹窗 input→点确认 | ⚠️ 多字段弹窗易填错 + 无确认 |
| 页面探测 probe | 拦截 fetch/XHR、扫 Vue 实例、捕获 token/API | 🔶 结果基本未被业务使用 |
| 浮动面板 UI | 手写 CSS（Catppuccin 暗色），可拖拽/最小化 | ✅ 良好 |
| 弹窗 popup | 仅显示"是否在抖音页" + 刷新按钮 | ✅ 简单可用 |

**通信链路**：`popup.js` → `chrome.tabs` → `content.js`（桥接）→ `inject.js`（页面上下文运行主逻辑）+ `probe.js`（页面上下文探测）。
主逻辑全部跑在**页面上下文**（通过动态 `<script>` 注入），因此能直接调用页面 Vue 实例、读取 Cookie/Token、操作 DOM。这是本项目最合理、最稳健的设计选择。

---

## 二、功能性 BUG（建议优先修复）

### B1. 自动讲解在循环模式下会"反复开关" —— 最严重
- `inject.js:364-385` `clickExplain` 直接点击「讲解」按钮，而该按钮是**开关式**（讲解 ↔ 取消讲解）。
- `AutoExplain._doNext`（`:712-765`）在 `repeat=true` 时，每跑完一轮 `this._currentIndex` 归零，下一次会对**同一个商品再次点击** → 触发"取消讲解"。
- 结果：循环讲解实际上是在"开→关→开→关"地振荡，达不到"逐个讲解"的目的。
- **修复方向**：点击前读取按钮当前文案，仅在"讲解/自动讲解"态才点击；或维护一个"已讲解集合"，跳过已开启的商品；或调用页面 Vue 方法而非点击 toggle。

### B2. 商品列表缓存的是 DOM 引用，长会话会失效
- `PageAPI.scanProducts`（`:249-361`）把 `row`、`explainBtn`、`priceBtn`、`stockBtn` 这些**真实 DOM 节点**存进 `this._cache.products`，且 2 秒内的重复扫描直接返回缓存（`:251`）。
- 抖音中控台是 SPA，直播过程中商品行会被频繁 re-render（上下架、排序、库存变化）。缓存的节点一旦被替换就变成 detached 节点，`clickExplain`/`clickEditPrice` 点到的就是"幽灵节点"，静默失败。
- **修复方向**：缓存商品**标识（id/name）+ 稳定的定位策略**，每次操作时**现扫现点**，不要长期持有 DOM 引用。或缩短/取消缓存，改用"元素还在文档中才用、否则重新查找"的策略。

### B3. 弹窗填值/确认过于"盲找"，多字段弹窗会填错
- `setModalInput`（`:406-439`）：取**页面上第一个可见的 input** 填入价格/库存。若弹窗同时含"价格 + 库存 + 改价原因"等多个输入框，会填到错误字段。
- `clickModalConfirm`（`:442-474`）：取**第一个可见且文字含"确定/保存/提交"的按钮**。若弹窗内有多个确认类按钮（如"提交并继续"），可能误点。
- **修复方向**：按"输入框旁边的 label/placeholder 文字"或"data 属性"就近匹配（label[for] → input#id，或兄弟节点文字包含"价格"的那个 input）。

---

## 三、性能隐患

### P1. 商品扫描遍历全页所有 button/span/a/div
- `scanProducts` 策略 2（`:268`）`document.querySelectorAll("button, span, a, div")` → 在热闹的直播页可能有**数千~上万节点**，且每个都 `textContent` + `closest()`；该扫描由 `setInterval(..., 10000)`（`:1209`）每 10 秒触发一次。
- 这会周期性造成明显卡顿（尤其在低端机上直播时）。
- **修复方向**：把扫描范围限定到商品表格容器（特征如 `[class*='product']` 的列表根节点），而不是全文档。

---

## 四、死代码 / 可清理（不影响运行，但增加维护成本）

| 位置 | 说明 |
|------|------|
| `background.js:1-26` SSE 代理 | `inject.js` 从未发送 `_type:"sse_proxy"` / `toBackground` 消息。**整条 background 代理是死代码**。 |
| `content.js:5-27` 消息桥接 | 既无 `inject→background`（`toBackground`）也无 `background→inject`（`bgMessage`）的实际调用者，桥接逻辑从未触发。 |
| `inject.js:630-649` `PageAPI.callAPI` | 定义后从未被调用。所有操作走 DOM，符合抖音反爬现实，可保留为备用但通常用不上。 |
| `probe.js` token/apis/network 采集 | 收集了 token、API 端点、网络样本，但业务层只 `log.ok` 打了几行计数（`:975-978`），**未真正用于提效**。 |
| `ui_*.txt` / `feature_detail.txt` | 4 个研究 dump（组件名、特征文案、API、UI 字符串），是逆向抖音页的参考素材，**不属于扩展运行时**，建议移入 `docs/` 或排除在加载目录外。 |

> 收益：删除桥接 + SSE 代理后，可把 `background` 字段从 manifest 移除（若确认无其他用途），减少权限面与复杂度。

---

## 五、健壮性与可维护性

| 项 | 位置 | 问题 |
|----|------|------|
| Vue 检测只跑一次 | `probe.js:161` | SPA 渲染晚时 `scanVue` 在 app 未挂载前执行 → 永远探测不到 Vue，且不再重试。 |
| 讲解循环无异常兜底 | `AutoExplain._doNext:712` | 没有 try/catch，内部抛错会**静默中断整个循环**，用户无感知。 |
| 配置不持久化 | `inject.js` UI | 间隔/浮动/循环等每次加载都要重填；只有评论文本存进了 `localStorage`（且存的是**页面域 douyin.com 的** localStorage，非扩展 storage）。 |
| HTML 与 JS 默认值重复 | `inject.js:1001-1043` vs `config` | 输入框 `value="15"` 与 JS `config.interval:15` 两处维护，易漂移。 |
| popup 状态检测过于简单 | `popup.js:6` | 只判断 URL 域名，未确认脚本是否真的注入成功。 |

---

## 六、安全与平台合规风险（直播带货场景，建议重视）

1. **改价/库存无二次确认（高风险）**：`PriceStock.batchUpdate`（`:914-938`）+ 「全部改价」按钮，可一次把**所有商品**改成同一个价格/库存，且**没有任何确认弹窗**。一旦手误或批量逻辑出错，可能造成真实资损（例如全场 9.9、库存清空）。
   - 建议：① 批量改价前弹确认框显示"将影响 N 个商品，新价 X"；② 单商品改价也加确认；③ 保留"原值"以便一键回滚。

2. **平台风控 / 合规**：自动化点击讲解、发评、改价属于平台自动化操作，可能触发抖音风控（限流、验证码、封禁）。当前没有：
   - 操作频率上限 / 单场总次数上限；
   - 失败后退避（backoff）；
   - "实时开关"的显眼控制（虽有停止按钮，但批量任务中途难以急停）。

---

## 七、优化路线图建议（下一步）

- **P0 正确性**：B1 讲解开关逻辑、B2 缓存失效、B3 弹窗精确定位。
- **P1 性能**：P1 扫描范围收敛。
- **P2 安全/体验**：改价前确认 + 回滚、配置持久化（chrome.storage）、操作上限与退避、真实登录态校验。
- **P3 清理**：移除死代码（SSE 代理/桥接/callAPI 视情况）、把研究 txt 移出加载目录、统一默认值来源。

---

## 八、附：文件清单速览
- `manifest.json` — MV3，权限仅抖音域 ✅
- `js/content.js` — 注入 + 消息桥接（桥接未使用）
- `js/probe.js` — 页面探测（结果未充分利用）
- `js/inject.js` — **主逻辑 1281 行**，单 IIFE，全局对象式模块
- `js/background.js` — SSE 代理（死代码）
- `js/popup.js` — 弹窗
- `css/panel.css` — 面板样式（Catppuccin 暗色）✅
- `assets/` — 图标/图片资源
- `ui_*.txt` / `feature_detail.txt` — 逆向研究参考（非运行时）

---

## 附：优化执行记录（2026-08-03）

已按用户决策完成以下优化（详见当日对话与 git 变更）：

- ✅ **B1 讲解开关振荡修复**：`clickExplain` 改为状态感知 —— 按钮已是「取消讲解」（讲解中）则跳过不点，避免 repeat 模式反复开关。
- ✅ **B2 DOM 引用失效自愈**：新增 `isConnected` 校验 + `_locateRow`（按商品名重新定位）兜底；扫描缓存 TTL 2s→1s。
- ✅ **P1 扫描性能**：`scanProducts` 策略 2 从全页 `button,span,a,div` 收敛为商品容器（`_collectContainers`/`_collectRows`）。
- ✅ **删除改价库存功能**：整个 `PriceStock` 模块、改价库存 Tab、快捷价格/库存、相关 PageAPI 方法（`clickEditPrice/clickEditStock/setModalInput/clickModalConfirm`）全部移除。
- ✅ **死代码清理**：删除 `background.js`（SSE 代理）、content.js 消息桥接、`callAPI`/`isLoggedIn`、未用的 Utils 方法（`triggerInput/findElByText/findElContaining/waitForEl/waitForAny/deepGet/time/maybeParse`）、Probe 的 `getToken/getAPIs`、Panel 未用字段。manifest 移除 `background` 与 `storage` 权限，现为 `permissions: []`。
- ✅ **健壮性**：AutoExplain/AutoComment 循环加 try/catch，连续 3 次失败自动急停并提示。
- ✅ **配置持久化**：新增 `Config`（页面域 localStorage `dy_*` 前缀），讲解/发评参数启动时保存、加载时回填。
- ✅ **资源整理**：4 个研究 txt 移入 `docs/research/`；CSS 删除未使用块；CLAUDE.md 同步更新。
- ✅ 全部 JS 通过 `node --check` 语法校验，残留引用扫描无实际遗留。

