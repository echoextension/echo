# NTP 自定义壁纸上传 — 产品设计文档

> 状态：待实现  
> 创建日期：2026-03-10

---

## 一、功能定位

补回用户因安装 ECHO（覆盖 NTP）而失去的 Edge 原生"上传自定义壁纸"能力。  
定位为**轻量级辅助功能**，不作为主打特性，不在 L1 暴露入口。

---

## 二、核心设计原则

- **自定义壁纸是壁纸库的一部分**，和 Bing 收藏混排，不独立成第三个来源模式
- **自定义壁纸是本地特性**：不跨设备同步、不参与备份恢复
- **尽量复用现有机制**：收藏、锁定、轮播逻辑不需要为自定义壁纸新建概念

---

## 三、入口与触达路径

入口放在 **L3 壁纸库管理面板**，收藏网格的第一格为固定的 "+" 卡片。

用户触达路径：

```
路径 A：右上角 [设置] → 壁纸来源选 [我的壁纸库] → [管理壁纸库] → 网格首位 [+]
路径 B：右上角 [收藏/管理] → 直接进入壁纸库面板 → 网格首位 [+]
```

空壁纸库时的引导文案改为："收藏 Bing 壁纸，或上传自己的图片"

---

## 四、交互流程

### 4.1 上传

1. 用户点击 "+" 卡片
2. 触发 `<input type="file" accept="image/jpeg,image/png,image/webp">`
3. 前端校验：
   - 格式：仅 jpg / png / webp
   - 大小：单张不超过 20MB
   - 数量：已有自定义壁纸达到 10 张上限时，提示"已达上限（10/10），请先删除一些自定义壁纸"
4. 校验通过 → 读取文件为 Blob → 生成缩略图（小尺寸）→ 原图 Blob 和缩略图 Blob 均存入 IndexedDB
5. 自动加入壁纸库收藏列表（favorites）
6. **立即显示为当前壁纸**
7. **自动锁定**（设置 pinnedDate 为该壁纸的 date 标识）

### 4.2 管理

- 壁纸库网格中，自定义壁纸缩略图左上角显示小 📷 角标，标识来源为本地上传
- 缩略图从 IndexedDB 读取（上传时生成的小尺寸版本），而非原图缩放
- 支持删除：删除时同步清理 IndexedDB 中的原图 Blob + 缩略图 Blob，并从 favorites 中移除

### 4.3 显示

- 自定义壁纸显示时，**不显示壁纸信息卡片和手柄**（左上角的标题、版权、日期区域）
- 不要求用户填写标题等元信息

### 4.4 参与轮播与锁定

- 自定义壁纸在 favorites 列表中，与 Bing 收藏一视同仁参与"轮播收藏"模式
- 可被锁定（pinnedDate 指向其 date 标识）
- "换一张"浏览时可以翻到

---

## 五、数据模型

### 5.1 壁纸对象

```javascript
// Bing 壁纸（现有）
{ id: 'SnowOtters_EN-US0138589680', date: '2026-03-10', desc: '...', copyright: '...' }

// 自定义壁纸（新增）
{ id: 'custom_1741612800000', date: 'custom:1741612800000', type: 'custom', desc: '' }
```

- `date` 使用 `custom:` 前缀 + 时间戳，永远不会与 Bing 壁纸的 `YYYY-MM-DD` 格式冲突
- `type: 'custom'` 字段用于快速判断来源

### 5.2 IndexedDB 存储

复用现有 `echo_wallpaper_cache` 数据库，新增或复用 store：

| 数据 | key | value |
|---|---|---|
| 原图 Blob | `custom:1741612800000` | `{ url: 'custom:...', blob: Blob, timestamp: ... }` |
| 缩略图 Blob | `custom_thumb:1741612800000` | `{ url: 'custom_thumb:...', blob: Blob, timestamp: ... }` |

### 5.3 Favorites

`favorites` 数组（存于 `chrome.storage.sync`）中混存：

```javascript
['2026-03-10', '2026-02-28', 'custom:1741612800000']
```

---

## 六、与现有机制的边界处理

### 6.1 备份恢复

- **导出时**：过滤掉 favorites 中 `custom:` 前缀的条目，不导出自定义壁纸数据
- **导入时**：同理，忽略 `custom:` 条目（即使旧备份文件中意外包含）

### 6.2 跨设备同步

- `chrome.storage.sync` 中的 favorites 会自动同步到其他设备
- 其他设备发现 `custom:` 前缀条目但 IndexedDB 中无对应 Blob 时：**静默跳过**
  - 轮播时跳过该条目
  - 壁纸库网格中不显示（或显示占位提示"图片仅存于其他设备"）

### 6.3 缓存清理

- 现有 `cleanOldWallpaperCache()` 按 7 天 TTL 清理 Bing 缓存
- 自定义壁纸 **不参与 TTL 清理**（通过 `custom:` 前缀判断跳过）
- 仅在用户主动删除时清理

### 6.4 displayWallpaper 分支

```
if (wp.type === 'custom') → 从 IndexedDB 按 date 读取 Blob → createObjectURL → 渲染
else → 现有逻辑（buildBingUrl → 缓存/网络）
```

### 6.5 壁纸信息卡片

- `updateWallpaperInfo(wp)` 中检测 `wp.type === 'custom'` 时，隐藏信息卡片和手柄
- 切换到 Bing 壁纸时恢复显示

---

## 七、约束与上限

| 约束 | 值 | 原因 |
|---|---|---|
| 最大数量 | 10 张 | 控制 IndexedDB 存储占用 |
| 单张大小 | ≤ 20MB | 合理上限，覆盖绝大部分壁纸 |
| 格式 | jpg / png / webp | 主流图片格式 |
| 不做裁剪/编辑 | — | 保持简单 |
| 不做标题/描述 | — | 类比 Windows 壁纸设置，不要求元信息 |
| 不参与备份 | — | 轻量插件不提供文件级云端同步 |

---

## 八、改动范围预估

| 文件 | 改动 |
|---|---|
| `ntp/ntp.html` | L3 壁纸库网格添加 "+" 上传卡片；空状态文案修改 |
| `ntp/ntp.css` | "+" 卡片样式；📷 角标样式 |
| `ntp/ntp.js` | `displayWallpaper` 加 custom 分支；`selectWallpaper` 兼容 custom date；上传逻辑；缩略图生成；删除逻辑；信息卡片隐藏逻辑；缓存清理跳过 custom |
| `options/options.js` | 备份导出/导入过滤 `custom:` 条目 |
| `manifest.json` | 无需改动（不需要新权限） |
