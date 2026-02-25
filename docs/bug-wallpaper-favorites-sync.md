# Bug Report: 壁纸收藏跨设备同步失效

> 创建日期: 2026-02-25  
> 状态: 待修复  
> 严重程度: 中（功能不可用但不影响核心浏览体验）  
> 影响范围: NTP 壁纸收藏功能

---

## 问题描述

壁纸收藏（favorites）使用 `chrome.storage.sync` 存储，预期跨设备同步，但实际表现为**完全不同步**——在 A 设备收藏的壁纸，在 B 设备的 NTP 上看不到。

## 根因分析

### 问题 1（主因）：NTP 未监听 sync storage 的收藏变化

**位置**: `ntp/ntp.js` L3574-L3583

```javascript
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'sync') return;
  
  // 只处理了 bookmarkBarDensity，没有处理 wallpaper favorites
  if (changes.bookmarkBarDensity) {
    const barHeight = await getBookmarkBarHeight();
    setBookmarkBarHeightVar(barHeight);
  }
});
```

当 B 设备的 sync storage 从云端接收到 A 设备推送的收藏更新后，`storage.onChanged` 事件会触发，但因为没有处理 `echo_ntp_wallpaper_favorites` 的 case，NTP 页面内存中的 `wallpaperState.favorites` 永远不会更新。用户必须手动刷新 NTP 才可能看到，而即便刷新也取决于 sync 数据是否已到达。

### 问题 2（次要）：无 merge/conflict 解决机制

**位置**: `ntp/ntp.js` L2249-L2253（`saveFavorites` 函数）

```javascript
await chrome.storage.sync.set({
  [WALLPAPER_FAVORITES_KEY]: wallpaperState.favorites
});
```

收藏保存是**整体覆盖**，不做合并。假设 A 设备收藏了壁纸 X，B 设备收藏了壁纸 Y，后写入的一方会覆盖先写入的一方的数据，导致收藏丢失。

当前优先级：先修问题 1（不修这个，问题 2 也无从触发）。问题 2 可作为后续优化。

---

## 修复方案

### 修复问题 1：在 onChanged 监听器中增加收藏变化处理

在 `ntp/ntp.js` 的 `chrome.storage.onChanged` 监听器中，增加对 `echo_ntp_wallpaper_favorites` 变化的处理：

```javascript
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'sync') return;
  
  // 密度变化时更新高度
  if (changes.bookmarkBarDensity) {
    const barHeight = await getBookmarkBarHeight();
    setBookmarkBarHeightVar(barHeight);
  }

  // 壁纸收藏变化（来自其他设备的同步）
  if (changes[WALLPAPER_FAVORITES_KEY]) {
    const newFavorites = changes[WALLPAPER_FAVORITES_KEY].newValue || [];
    wallpaperState.favorites = newFavorites;
    
    // 刷新相关 UI
    updateFavoriteCount();
    updateWallpaperStatus();
    updateL2SourceSelector();
    
    // 如果收藏面板正在展示，刷新网格
    const collectionPanel = document.getElementById('collectionPanel');
    if (collectionPanel?.classList.contains('visible')) {
      const activeTab = document.querySelector('.collection-tab.active')?.dataset.tab;
      if (activeTab === 'favorites') {
        renderFavoritesGrid();
      }
    }
    
    // 如果当前是"轮播收藏"模式且收藏变空，自动切回每日模式
    if (wallpaperState.settings.mode === 'collection' && 
        !wallpaperState.settings.pinnedDate &&
        newFavorites.length === 0) {
      wallpaperState.settings.mode = 'daily';
      await saveWallpaperSettings();
      updateL2SourceSelector();
    }
  }
});
```

### 关于问题 2（merge）的后续优化思路

如需实现，可采用"并集合并"策略：

```javascript
// 伪代码：收到远端变化时合并而非覆盖
const remoteFavorites = changes[KEY].newValue || [];
const localFavorites = wallpaperState.favorites;
const merged = [...new Set([...localFavorites, ...remoteFavorites])];
```

但需注意：合并后还需要回写 sync storage，可能引发循环触发 onChanged 的问题，需要加锁或标记跳过自身写入。复杂度较高，建议独立评估。

---

## 测试计划

### 前置条件

- 使用已提交商店的正式版本（开发模式 ID 不固定，sync 不会跨设备同步）
- 或使用下方"方案 A"在本地模拟

### 方案 A：同设备模拟 sync 变化（推荐用于开发验证）

无需两台设备。利用 Service Worker DevTools 手动触发 sync storage 写入，验证 NTP 是否响应。

**步骤：**

1. 打开 NTP 页面，右键 → 检查（打开 NTP 的 DevTools），切到 Console
2. 打开 `edge://extensions/` → ECHO 扩展 → 点击"Service Worker"链接，打开 SW DevTools
3. 在 **SW DevTools Console** 中执行：

```javascript
// 查看当前收藏
chrome.storage.sync.get('echo_ntp_wallpaper_favorites', (data) => {
  console.log('当前收藏:', data);
});
```

4. 在 **SW DevTools Console** 中模拟远端推送：

```javascript
// 模拟另一台设备同步了新收藏
chrome.storage.sync.get('echo_ntp_wallpaper_favorites', (data) => {
  const current = data.echo_ntp_wallpaper_favorites || [];
  current.push('20260101');  // 添加一个测试日期
  chrome.storage.sync.set({ echo_ntp_wallpaper_favorites: current }, () => {
    console.log('模拟远端同步写入完成');
  });
});
```

5. **不刷新 NTP 页面**，观察：
   - 收藏计数是否更新
   - 如正在查看收藏面板，网格是否刷新
   - 壁纸状态指示器是否更新

6. 在 SW DevTools Console 中模拟清空收藏：

```javascript
chrome.storage.sync.set({ echo_ntp_wallpaper_favorites: [] }, () => {
  console.log('模拟远端清空收藏');
});
```

7. 验证 NTP 是否：
   - 收藏计数归零
   - 若处于"轮播收藏"模式，是否自动切回"每日模式"

### 方案 B：双 Profile 真实同步测试

**前提**：使用商店已发布的正式版。

1. 用同一 Microsoft 账号登录两个 Edge Profile（Profile A 和 Profile B）
2. 确保两个 Profile 都启用了扩展同步（Edge 设置 → 个人资料 → 同步 → 扩展）
3. 在 Profile A 的 NTP 中收藏一张壁纸
4. 等待 2-5 分钟（Edge sync 周期）
5. 在 Profile B 的 NTP 中检查收藏是否出现

### 回归测试清单

| # | 测试项 | 预期结果 | 通过 |
|---|--------|----------|------|
| 1 | 本地收藏一张壁纸 | 收藏列表正确显示，计数 +1 | ☐ |
| 2 | 本地取消收藏 | 列表正确移除，计数 -1 | ☐ |
| 3 | 模拟远端新增收藏（方案 A） | NTP 不刷新即可看到变化 | ☐ |
| 4 | 模拟远端清空收藏（方案 A） | 收藏归零，轮播模式回退每日 | ☐ |
| 5 | 壁纸锁定状态 | 远端收藏变化不影响当前锁定的壁纸 | ☐ |
| 6 | 收藏面板打开时收到远端更新 | 网格实时刷新 | ☐ |
| 7 | 收藏面板关闭时收到远端更新 | 无报错，下次打开面板显示最新数据 | ☐ |
| 8 | 双 Profile 真实同步（方案 B） | A 收藏出现在 B | ☐ |
| 9 | sync 配额溢出回退 | 超出配额时 fallback 到 local，无报错 | ☐ |
