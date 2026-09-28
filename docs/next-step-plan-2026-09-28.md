# ECHO 下一步计划（2026-09-28）

## 目的

本文记录当前主干下一阶段的工作顺序。计划仅纳入已经结合现有源码重新核实的问题，不以外部代码审查报告作为后续实施依据。

执行原则：先修复真实的用户行为缺陷，再做低成本安全加固，随后清理技术债，最后更新文档。每一项在实施前仍需结合当时的最新主干重新确认，不因已写入计划就机械修改。

本文取证基线为 `main` 提交 `42c8f6b`（2026-09-25，版本 1.4.6）。下文以函数名、状态名和调用路径作为主要定位依据，行号仅用于辅助；若后续代码移动，应先在最新主干重新定位并确认问题仍然存在。

## 1. 修复有序插入标签时的状态未写回问题

### 现状

`background/tab-coordinator.js` 在处理浏览器创建的新标签时，某个分支会创建新的局部插入状态，但没有把它写回 `insertStateByWindow`。

默认的 `newest` 排序不依赖累计插入数量，因此通常不受影响。用户选择 `ordered` 后，如果 Service Worker 的内存状态已经因休眠而丢失，再从同一页面连续中键打开多个后台标签，后续标签可能反复插入同一个位置，最终顺序与打开顺序相反。

### 当前代码链路

涉及文件：`background/tab-coordinator.js`。

1. `handleTabCreated()` 从 `getInsertState(tab.windowId)` 取得当前窗口状态，并把当时的 `baseTabId` 作为快照交给 `queueCreatedTab()`。
2. `queueCreatedTab()` 按窗口串行调用 `handleNewTabCreated()`，这层队列本身能够避免多个创建事件并发修改顺序。
3. `handleNewTabCreated()` 在当前基准与 `tab.openerTabId` 不一致时执行：

   ```js
   state = { baseTabId: effectiveBaseTabId, baseTabIndex, insertCount: 0 };
   ```

   这里替换的只是局部变量 `state`，没有修改 `insertStateByWindow` 中原来的对象，也没有把新对象放回 Map。
4. 标签移动完成后，函数重新通过 `getInsertState(windowId)` 取得 `globalState`，只有 `globalState.baseTabId === state.baseTabId` 时才增加 `insertCount`。在上述分支中，Map 内仍可能是空基准，因此计数不会增加。
5. 下一次后台标签创建时，代码再次从未更新的 Map 状态开始计算，可能继续使用相同的目标位置。

`handleTabActivated()` 会在标签激活时重建基准，因此前台打开或随后切换标签可能掩盖问题；但连续中键打开后台标签不会激活新标签。Service Worker 重启后 `insertStateByWindow` 为空，使这条路径具有现实触发条件。

### 预期行为示例

基准排列为 `A | B`，用户停留在 A，并在 `ordered` 模式下依次中键打开链接 1、2、3：

- 预期：`A | 1 | 2 | 3 | B`；
- 缺陷路径可能得到：`A | 3 | 2 | 1 | B`。

在 `newest` 模式下，`A | 3 | 2 | 1 | B` 本来就是预期结果，因此不能只用默认配置验证修复。

### 计划

1. 让新的基准标签、基准位置和 `insertCount` 始终写回窗口级状态。优先考虑修改 Map 中现有对象的属性，避免同一函数内同时存在“Map 对象引用”和“脱离 Map 的局部对象”；如果选择替换对象，则必须明确执行 `insertStateByWindow.set(windowId, state)`。
2. 保持 `newest` 与 `ordered` 两种既有产品语义不变。
3. 增加贴近真实浏览器事件的回归测试，测试标签必须带 `openerTabId`。
4. 覆盖“全新 Service Worker 状态下连续打开多个后台标签”的场景，不能依赖预先触发标签激活事件来初始化状态。

### 测试落点

主要测试文件：`tests/background/background.characterization.test.js`；浏览器模拟位于 `tests/helpers/fake-chrome.js`。

现有“keeps rapid ordered background tabs in creation order”测试调用 `chrome.tabs.create()` 时没有提供 `openerTabId`，因而会通过查询活动标签的兜底路径直接修改 Map 内对象，没有覆盖缺陷分支。补充测试时至少应做到：

- 初始窗口包含活动标签 A 和右侧标签 B；
- 设置 `newTabOrder: 'ordered'`；
- 不预先触发 `tabs.onActivated` 来建立插入状态；
- 连续创建三个 `active: false` 且 `openerTabId: A.id` 的标签；
- 等待窗口创建队列完成后，断言顺序为 `A、1、2、3、B`；
- 另以 `newest` 配置断言顺序仍为 `A、3、2、1、B`。

### 验收标准

- `ordered`：连续打开的后台标签保持 `1、2、3` 的创建顺序。
- `newest`：最新打开的标签仍然最靠近基准标签。
- Service Worker 重启前后行为一致。
- 扩展主动创建标签、加号新标签和标签关闭后的行为不发生回归。

## 2. 对头条热搜标题进行预防性安全加固

### 现状

`search-box/trending-controller.js` 将头条接口返回的标题转义后拼入 `innerHTML`。当前转义方式适合文本节点，但没有覆盖双引号属性上下文，因此异常或恶意标题可以破坏 `data-query`、`title` 等属性结构。

数据来自正常的第三方公开接口，现实攻击概率较低；普通标题中出现引号也不等于可以直接执行脚本。因此本项属于预防性加固，不按正在发生的高危漏洞处理。

### 当前代码链路

涉及文件：`search-box/trending-controller.js`，主要函数为 `escapeHtml()`、`renderVisibleWords()` 和 `fetchToutiaoTrends()`。

1. `fetchToutiaoTrends()` 通过后台代理读取头条公开接口，把每一项规范化为 `{ title: item.Title || '' }`，但不会也不应该假定标题符合 HTML 属性语法。
2. `escapeHtml()` 通过临时 `div` 的 `textContent`/`innerHTML` 做文本转义。这会处理 `&`、`<`、`>`，但文本节点中的双引号不需要转义，所以结果仍可包含 `"`。
3. `renderVisibleWords()` 把同一个结果同时放入元素文本和双引号属性：

   ```js
   data-query="${escapeHtml(item.title)}"
   title="${escapeHtml(item.title)}"
   ```

4. 因此普通引号可能破坏属性解析；只有标题本身包含完整恶意载荷、且页面安全策略允许时，才进一步具备脚本执行条件。本项修复的目标是消除不必要的 HTML 解释过程，而不是把头条接口定性为不可信或正在被攻击。

浮动搜索框由 `search-box/search-box.js` 创建。热搜面板最终位于搜索框 iframe 内，但该 iframe 没有 `sandbox` 属性，不能把 iframe 本身当作忽略输入边界的理由。

### 计划

1. 不再用字符串拼接方式生成热搜链接。
2. 使用 `createElement`、`textContent`、`dataset` 或 `setAttribute` 分别设置文本和属性。
3. 保持当前三项轮播、点击搜索和视觉结构不变。
4. 增加包含双引号、单引号、尖括号及事件属性样式载荷的测试。

实现时应保留每个词条的既有 DOM 契约：元素为 `.trending-word`，当前项带 `.active`，相邻项带 `.adjacent`，`data-offset` 保持数值语义，`data-query`、`title` 和可见文本均来自同一原始标题。不要通过扩充手写转义表继续维持 HTML 模板拼接。

### 测试落点

主要测试文件：

- `tests/search-box/trending-controller.test.js`：控制器级渲染和请求生命周期；
- `tests/search-box/search-box.characterization.test.js`：真实搜索框 iframe 装配及点击行为。

建议在现有“renders three escaped Toutiao trends and opens the active item”场景上补充或新增用例，至少验证：

- 标题 `他说"你好"` 的显示文本、`title` 和 `dataset.query` 完整一致；
- 类似 `" onmouseover="globalThis.__unexpected = true` 的字符串不会产生 `onmouseover` 属性；
- `<img src=x onerror=...>` 只显示为文本，不产生 `img` 元素；
- 点击后发送的 Bing 查询参数来自完整原始标题，而不是被 DOM 解析截断后的值。

### 验收标准

- 任意标题都只能作为文本和属性值存在，不能生成额外元素或额外属性。
- 点击搜索时使用的查询词与接口原始标题一致。
- 正常标题的展示、轮播和点击行为不变。

## 3. 清理已经确认的技术债

本阶段不以提高测试数量或降低代码行数为目标。每个清理项必须先证明它是重复、失真或已经没有生产入口的内容。

### 3.1 清理 NTP 壁纸播放模式的旧实现

- 生产 HTML `ntp/ntp.html` 中存在的是 `playModeRandomBtn`、`playModeFixedBtn`；旧 ID `playModeRandom`、`playModeFixed` 不存在。
- `ntp/modules/wallpaper-settings-controller.js` 的 `initPlaybackButtons()` 与 `ntp/modules/wallpaper-status-view.js` 的 `updatePlayModeButtons()` 使用真实 `*Btn` ID，构成当前有效功能链路。
- 核对并删除 `ntp/modules/wallpaper-collection-controller.js` 的 `init()` 和 `ntp/modules/wallpaper-status-view.js` 的 `setCollectionPlayMode()` 中只引用旧 ID 的无效路径。
- 保留真实页面使用的 `playModeRandomBtn`、`playModeFixedBtn` 实现。
- 删除 `tests/ntp/wallpaper-collection-controller.test.js` 与 `tests/ntp/wallpaper-status-view.test.js` 中人为创建、但生产 HTML 中不存在的旧 ID fixture，以及只验证该旧路径的断言。
- 用真实 DOM 结构验证播放模式的显示条件、点击行为和激活状态。

### 3.2 整理低价值或失真的测试

- 优先删除只为已经不存在的实现服务的测试。
- 将仅断言实现细节、却不能保护用户行为的测试改成行为测试；若没有实际保护价值，再考虑删除。
- 不把样式契约测试、characterization test 或简单断言一概视为“无用测试”。删除前必须说明它原本保护的契约，以及由什么测试接替。
- 保留发布包 allowlist、权限基线、真实页面装配和核心行为回归等有效契约测试。

### 3.3 其他候选技术债

以下内容只作为后续候选，实施前单独评估收益和回归风险：

- `content.js` 与 `common/` 输入交互模块之间的重复实现；
- 悬浮搜索框和 B站工具的缩放轮询是否适合改为事件驱动；
- 直接读取批量设置的路径是否需要统一补充 schema 校验；
- 备份导出是否补充一条明确验证敏感本地数据不会进入备份的回归测试。

## 4. 处理文档债

代码行为稳定后再更新文档，避免文档先于实现变化。

### 计划

1. 更新 `README.md` 中功能说明和技术栈部分关于 Shadow DOM 的描述；更新 `ARCHITECTURE.md` 的架构图、“Shadow DOM 隔离与缩放补偿”章节及仍把搜索框描述为 Shadow DOM 的相关段落。
2. 准确说明 iframe 提供的是样式和布局隔离，不把未设置 `sandbox` 属性的 iframe 描述成安全沙箱。
3. 以 `search-box/search-box.js` 的 `createSearchBox()` 为准更新架构示例：当前实现创建 `about:blank` iframe，把 `iframeDoc.body` 作为内部挂载点，并把旧样式中的 `:host` 替换为 `body`。
4. 保留缩放补偿的有效说明，但重新核对代码位置和轮询描述，不沿用旧 Shadow Root 示例。
5. 顺带检查已经失效的行号、模块名称和旧功能描述，但不借文档更新扩大代码修改范围。

## 执行顺序

1. 标签有序插入状态修复及回归测试；
2. 头条热搜标题的 DOM 构建加固及回归测试；
3. 已确认死代码、失真 fixture 和低价值测试的清理；
4. README、ARCHITECTURE 等文档同步。

除非出现新的高影响缺陷，上述顺序保持不变。每完成一项，应先确认完整测试和发布校验通过，再进入下一项。
