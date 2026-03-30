# Ctrl+B 搜索框与 SPA 导航冲突 — 调试记录

## 问题概述

Ctrl+B 呼出悬浮搜索框后，在 B站（bilibili.com）视频页点击右侧推荐视频，URL 会改变但页面不加载新视频——pushState 成功执行，Vue Router 的视图更新却没有触发。关闭搜索框后点击则一切正常。

该问题在其他 SPA 网站上是否存在尚未验证，但根因与 Shadow DOM 焦点机制相关，理论上可能影响任何依赖类似路由机制的 SPA。

---

## 时间线

### 2026-03-29 14:33 — `65088f2` feat: B站视频颜色反转工具

- 新增 B站视频工具条（颜色反转、通道交换 R↔G / R↔B / G↔B）
- 搜索框使用 `closed` Shadow DOM
- 搜索框有 `autofocus` 属性
- 有"点击外部关闭搜索框"逻辑（document 级 click handler 调用 hideSearchBox）

### 2026-03-29 15:35 — `daafbb1` feat: B站视频工具增强

- 增加旋转、镜像、适应/填充功能
- 工具条功能完善

### 2026-03-29 16:52 — `59da88b` wip: 存在未解决的间歇性点击 bug

- 发现点击 B站右侧推荐视频后不跳转的问题
- 问题时有时无，难以稳定复现

### 2026-03-29 22:13 — `88689c6` debug: Ctrl+B 搜索框与 B站 SPA 导航冲突排查

主要改动：
- `closed` Shadow DOM → `open`（排除 closed shadow 对焦点的干扰）
- 移除 `autofocus` 属性
- 移除"点击外部关闭"逻辑（消除 document 级 click handler 对页面点击的干扰）
- 多次暴力 `setTimeout` focus → 单次 `requestAnimationFrame` focus
- 加入 iframe 过滤（`if (window !== window.top) return`）
- 加入大量调试日志和 `history.pushState/replaceState` hook

### 2026-03-29 23:03 — `84ac087` fix: 收敛 Ctrl+B 搜索框交互并清理调试残留

- 清理调试代码，保留上述修复
- 保留不关闭搜索框的策略
- 添加 Esc 全局关闭功能
- 当时测试似乎解决了问题，但后续发现问题仍然存在，且复现概率从"时有时无"变为"100%"

### 2026-03-30 14:37 — `2b4e41a` debug: 禁用 searchInput.focus()（临时方案）

- 通过系统化的二分排查，定位到 `searchInput.focus()` 是根因
- 临时方案：去掉自动 focus，用户需手动点击搜索框才能输入
- 跳转问题解决

### 2026-03-30 14:58 — `e497a85` fix: 修复视频工具条通道交换顺序依赖和镜像方向问题

- 通道交换按钮改为循环排列：红↔绿、绿↔蓝、蓝↔红
- 通道交换从多个 SVG filter 串联改为单一矩阵行交换计算
- 镜像 scaleX(-1) 移到 transform 最左边

---

## 根因定位过程

### 已确认的事实

1. **点击本身有效**：URL 会改变，说明 click 事件到达了链接元素，pushState 成功执行
2. **不是遮挡**：同上，如果被遮挡 URL 不会变
3. **不是事件拦截**：搜索框没有在 document 级拦截 click 事件
4. **搜索框开着就出问题，关了就好**：说明问题与搜索框的可见状态相关
5. **focus 后立即 blur → 跳转正常**：说明 focus 本身不造成不可逆破坏
6. **焦点持续停留 → 跳转失败**：问题是焦点持续在 shadow DOM input 上

### 二分排查过程

| 步骤 | 操作 | 结果 |
|------|------|------|
| 1 | 最小 createSearchBox：空 div，无 Shadow DOM | ✅ 跳转正常 |
| 2 | 加回 Shadow DOM + 完整 UI（不绑事件/动画/interval） | ✅ 跳转正常 |
| 3 | 加回 bindEvents() | ✅ 跳转正常 |
| 4 | 加回 startSpectrumAnimation() + initZoomCompensation() | ✅ 跳转正常 |
| 5 | 恢复完整 showSearchBox()（含 searchInput.focus()） | ❌ 跳转失败 |
| 6 | 去掉 focus 调用 | ✅ 跳转正常 |
| 7 | focus 后立即 blur | ✅ 跳转正常 |
| 8 | closed Shadow DOM + focus | ❌ 跳转失败 |

**结论**：`searchInput.focus()` 将焦点转入 Shadow DOM 内的 input，焦点持续停留时会干扰 B站 Vue Router 的视图更新。

---

## 尝试过的修复方案

### 方案 A：pointerdown 捕获阶段 blur

**思路**：用户点击搜索框外时，在 pointerdown 捕获阶段（比 click 更早）blur input。

**实现**：
```js
document.addEventListener('pointerdown', (e) => {
  if (shadowRoot?.activeElement !== searchInput) return;
  if (e.composedPath().includes(host)) return;
  searchInput.blur();
}, true);
```

**结果**：❌ 跳转仍然失败。

**分析**：pointerdown 阶段 blur 对 Vue Router 来说可能太晚，或者 Vue Router 的路由处理不在 click 事件流程中。

### 方案 B：mousedown 捕获阶段 blur

**思路**：同 A，换成 mousedown。

**结果**：❌ 跳转仍然失败。

### 方案 C：延迟 focus + keydown 触发

**思路**：不自动 focus，用户打字时在 keydown 捕获阶段 focus 并手动插入首字符。

**实现**：
```js
const onFirstKey = (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  searchInput.focus({ preventScroll: true });
  searchInput.value = ev.key;
};
document.addEventListener('keydown', onFirstKey, true);
```

**结果**：✅ 跳转正常，但中文输入法首字母 100% 丢失。

**分析**：`preventDefault()` 阻止了 IME 的启动，keydown 事件已经在 focus 之前发出，IME 无法收到。

### 方案 D：延迟 focus + keydown 不 preventDefault

**思路**：keydown 时只 focus，不 preventDefault，让按键自然传播到 input。

**结果**：❌ 首字母仍然丢失。

**分析**：focus 发生在事件传播中途，浏览器不会把已发出的 keydown 重新路由到新 focus 的元素。

### 方案 E：dispatchEvent 重放 KeyboardEvent

**思路**：focus 后 dispatch 一个克隆的 keydown 事件到 searchInput。

**结果**：❌ 导致无限递归（Maximum call stack size exceeded）。且合成的 KeyboardEvent 不触发浏览器默认输入行为（安全限制），首字母依然丢失。

### 方案 F：外部代理 input

**思路**：在主文档创建透明 input 叠在搜索框上，焦点给代理 input，内容同步到 Shadow DOM 内的显示 input。

**结果**：❌ 导致 Ctrl+B 无法关闭（keydown handler 检测到焦点在 input 里会跳过 Ctrl+B 处理），且跳转仍然失败。

### 方案 G：pointer-events: none

**思路**：给 host 元素加 `pointer-events: none`，排查 host 是否截获了点击。

**结果**：❌ 跳转仍然失败（排除了 host 元素截获点击的可能）。

### 方案 H：去掉 Ctrl+B keydown 的 stopPropagation

**思路**：只保留 preventDefault，去掉 stopPropagation，让 Ctrl+B 的 keydown 事件继续传播。

**结果**：❌ 跳转仍然失败。

### 方案 I：closed Shadow DOM

**思路**：改回 closed Shadow DOM，外部 `document.activeElement` 无法看到 shadow 内部元素。

**结果**：❌ 跳转仍然失败。

---

## 可行的路径

| 方案 | 跳转 | 输入 | 首字母 | 评价 |
|------|------|------|--------|------|
| 不 focus（当前方案） | ✅ | 需手动点击 | ✅ 不丢 | 小妥协，最稳定 |
| focus + 立即 blur | ✅ | 无法输入 | — | 无意义 |
| 延迟 focus（方案 C） | ✅ | ✅ | ❌ 丢失 | 体验更差 |

**当前采用方案**：不自动 focus（方案 1），用户 Ctrl+B 呼出后需手动点击搜索框才能输入。

---

## 走不通的路径总结

所有尝试在"保持 focus"的同时"修复跳转"的方向都失败了：

1. **在 click 之前 blur**（pointerdown/mousedown）：不生效，说明问题不在 click 事件时间点
2. **不用 Shadow DOM focus**（外部代理 input）：引入新问题（Ctrl+B 快捷键失效），且未解决跳转
3. **改 Shadow DOM 模式**（closed）：不生效
4. **延迟 focus**：解决跳转但丢首字母，依赖事件转发的方案都有缺陷

---

## 未解之谜

1. **为什么 pointerdown 阶段 blur 无效**：focus 后立即 blur 可以工作，但 pointerdown 阶段 blur（焦点已经持续了一段时间）却不行。两者的区别在于焦点持续时间——可能 B站的代码在焦点进入 shadow DOM 的瞬间就在某处记录了状态，后续 blur 无法撤销这个影响。

2. **具体是 Vue Router 的什么机制被影响了**：pushState 成功执行，但视图不更新。可能是 Vue 的 watcher、computed、或 router guard 在焦点位于 shadow DOM 时行为异常。没有 B站源码无法确认。

3. **为什么从"时有时无"变成"100% 复现"**：早期代码用 6 个 setTimeout（50/100/200/400/800ms）暴力 focus，在某些时序下焦点可能还没成功就被用户点击覆盖了。改为单次 `requestAnimationFrame` focus 后更"干净"地持有焦点，导致 100% 复现。
