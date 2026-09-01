# ECHO 工程治理阶段 0：事实基线清单

> 清单状态：阶段 0 实施基线<br>
> 记录日期：2026-09-01<br>
> 分支：`feature/zhihu-blocklist-bili-feed-history`<br>
> 本地 `HEAD`：`82fc5889553caa642774dbc5517be2a8aace7def`<br>
> 上游提交：`82fc5889553caa642774dbc5517be2a8aace7def`<br>
> 扩展版本：`1.3.3`<br>
> 制定依据：当前工作树中的生产代码和 `manifest.json`

---

## 1. 清单用途与证据边界

本清单是 [`engineering-governance-implementation-plan.md`](./engineering-governance-implementation-plan.md) 阶段 0 的交付物，用于在测试和重构前冻结当前系统事实。

本清单遵守以下边界：

- 入口、设置、存储、消息和网络目标只从当前代码提取；
- QA 文档只用于映射预期行为，不用于证明当前缺陷；
- 标记为“无生产调用方候选”的代码，必须在阶段 4 再完成动态字符串和运行入口核验后才能删除；
- 标记为“需真实浏览器”的行为，不能由静态分析或 mock 单独判定通过；
- 本清单不是最终架构，后续状态变化必须同步更新。

---

## 2. Manifest 与生产入口

### 2.1 扩展级入口

来源：[`manifest.json`](../manifest.json)

| 类型 | 入口 | 注入条件 | 执行时机 | Frame 范围 |
| --- | --- | --- | --- | --- |
| Service Worker | `background.js` | 扩展后台 | 事件驱动 | 不适用 |
| NTP override | `ntp/ntp.html` | 新标签页 | 页面加载 | 顶层扩展页 |
| Options | `options/options.html` | 设置页 | 页面加载 | 顶层扩展页 |
| 通用内容脚本 | `search-box/search-box.js`、`content.js` | 所有 HTTP(S) 页面 | `document_start` | `all_frames: true` |
| B站视频工具 | `bili-tool/bili-tool.js` | `*.bilibili.com/*` | `document_idle` | 顶层 frame |
| B站推荐历史 | `bili-feed-history/bili-feed-history.js` | `www.bilibili.com/*` | `document_idle` | 顶层 frame |
| 知乎工具 | `zhihu-tool/zhihu-tool.js` | `www.zhihu.com/*`、`zhuanlan.zhihu.com/*` | `document_idle` | 顶层 frame |

通用脚本虽然由 manifest 注入所有 frame，但实际运行边界不同：

- 悬浮搜索框在 iframe 中立即返回；
- `content.js` 在 iframe 中只保留快速存图能力，其余手势、缩放、拖拽和 F2/F3 不运行；
- 三个站点模块均有顶层 frame 保护。

### 2.2 HTML 脚本顺序

#### NTP

来源：[`ntp/ntp.html`](../ntp/ntp.html)

1. `blank-init.js`：同步读取 localStorage 首帧镜像；
2. `common/lowpoly-bg.js`：`defer` 加载，自动初始化被关闭；
3. `search-box/search-box.js`：页面尾部加载；
4. `ntp.js`：页面尾部最后加载。

#### Options

来源：[`options/options.html`](../options/options.html)

1. `search-box/search-box.js`；
2. `common/lowpoly-bg.js`；
3. `options.js`。

#### FRE

四个 FRE 页面按各自页面需要加载：

- `common/lowpoly-bg.js`；
- `fre.js`；
- 对应步骤脚本；
- `common/mouse-gesture.js`；
- `common/super-drag.js`；
- `common/keyboard-enhance.js`；
- `search-box/search-box.js`。

具体页面的加载顺序略有差异，阶段 1 的静态资源测试必须按 HTML 实际顺序解析。

#### 文档查看器

来源：[`docs-viewer.html`](../docs-viewer.html)

1. `docs-viewer.js`；
2. `common/mouse-gesture.js`；
3. `common/super-drag.js`；
4. `common/keyboard-enhance.js`；
5. `search-box/search-box.js`。

### 2.3 当前权限

| 权限 | 当前用途 |
| --- | --- |
| `tabs` | 标签创建、移动、切换、缩放、静音、注入协调 |
| `storage` | sync/local/session 设置和状态 |
| `downloads` | 快速存图 |
| `scripting` | 为已打开的 B站标签补注入推荐历史脚本 |
| `declarativeNetRequest` | 快速存图时临时设置 Referer |
| `*://*/*` | 全网页内容脚本、跨域图片和数据代理 |

当前未声明 `bookmarks` 权限，但后台仍存在书签 API 相关遗留实现。

### 2.4 Web Accessible Resources

当前对 `<all_urls>` 暴露：

- `_favicon/*`；
- `wallpaper/*`；
- `icons/*`；
- `docs-viewer.html`；
- `*.md`。

阶段 1 需要验证资源存在性；阶段 4 再根据真实调用方评估暴露范围。

---

## 3. 设置清单

### 3.1 通用 sync 设置

下表以设置页当前默认值为 UI 基线，并同时记录后台或消费者差异。

| Key | 类型/允许值 | Options 默认 | Background 默认 | 主要读取方 | 主要写入方 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `mouseGesture` | boolean | `true` | `true` | `content.js`、Options UI | Options、安装初始化 | NTP 和 `common` 当前不读取该设置 |
| `bossKey` | boolean | `true` | `true` | Background | Options、安装初始化 | 命令触发时读取 |
| `quickMute` | boolean | `true` | `true` | Background | Options、安装初始化 | 命令触发时读取 |
| `fineZoom` | boolean | `true` | `true` | `content.js`、Options UI | Options、安装初始化 | NTP 和 `common` 当前不读取该设置 |
| `fineZoomLargeStep` | boolean | `true` | 未定义 | `content.js`、Options UI | Options | Background 安装初始化不会补该 key |
| `superDrag` | boolean | `true` | `true` | `content.js`、Options UI | Options、安装初始化 | NTP 和 `common` 当前不读取该设置 |
| `superDragActivate` | boolean | `false` | `false` | Background | Options、安装初始化 | 控制扩展打开标签是否激活 |
| `tabSwitchKey` | boolean | `true` | `true` | `content.js`、Background、Options UI | Options、安装初始化 | NTP 和 `common` 当前不读取该设置 |
| `quickSaveImage` | boolean | `true` | `true` | `content.js`、Background | Options、安装初始化 | iframe 也运行 |
| `quickSaveImageDateFolder` | boolean | `false` | `false` | Background | Options、安装初始化 | 控制下载日期子目录 |
| `floatingSearchBox` | boolean | `true` | `true` | Search Box | Options、安装初始化 | 初始关闭时脚本提前返回 |
| `floatingSearchBoxAlwaysShow` | boolean | `false` | `false` | Search Box | Options、安装初始化 | 部分行为在创建时形成快照 |
| `floatingSearchBoxTrending` | boolean | `false` | `false` | Search Box | Options、安装初始化 | Options 数组注释存在“默认开启”措辞漂移，实际值为 false |
| `floatingSearchBoxFollowZoom` | boolean | `false` | 未定义 | Search Box | Options | Background 安装初始化不会补该 key |
| `biliTool` | boolean | `true` | `true` | B站视频工具 | Options、安装初始化、旧 key 迁移 | 初始关闭时脚本提前返回 |
| `biliFeedHistory` | boolean | `true` | `true` | B站推荐历史、Background | Options、安装初始化 | Background 负责已开标签补注入 |
| `zhihuBlocklistFilter` | boolean | `false` | `false` | 仅作为旧版兼容 fallback | 旧设置、安装初始化 | 当前权威开关已迁至 local |
| `customBookmarkBar` | boolean | `false` | `false` | 多处遗留代码 | 安装初始化、重置 | 当前无 `EchoBookmarkBar` 生产实现入口 |
| `bookmarkBarPinned` | boolean | `true` | `true` | 内容脚本遗留 | 安装初始化、重置 | 已隐藏功能 |
| `bookmarkOpenInNewTab` | boolean | `false` | `false` | 书签栏遗留 | 安装初始化、重置 | 已隐藏功能 |
| `bookmarkBarDensity` | string | 未纳入 Options 主 schema | 未定义 | NTP、Options 遗留 | 旧版本数据 | fallback 为 `default` |
| `closeTabActivate` | `left` / `right` | `left` | `left` | Background、Options | Options、安装迁移 | 从旧 `activateLeftTab` 迁移 |
| `newTabPosition` | `afterCurrent` / `atEnd` | `afterCurrent` | `afterCurrent` | Background、Options | Options、安装初始化 | 标签位置策略 |
| `newTabOrder` | `newest` / `ordered` | `newest` | `newest` | Background、Options | Options、安装初始化 | 连续打开顺序 |
| `applyToPlusButton` | boolean | `false` | `false` | Background | Options、安装初始化 | 是否处理 NTP 新标签 |
| `biliToolPosition` | object | 工具内部 fallback | 未定义 | B站视频工具 | B站视频工具 | 新格式 `{ topRatio }`，兼容旧 `top` |

### 3.2 旧设置迁移

| 旧 Key | 新 Key/动作 | 执行位置 |
| --- | --- | --- |
| `activateLeftTab` | 迁移为 `closeTabActivate` 后删除旧 key | Background `runtime.onInstalled` |
| `sidepanelEnhanced` | 安装/升级时删除 | Background `runtime.onInstalled` |
| `floatingSearchBoxBiliTool` | 迁移为 `biliTool` 后删除 | B站视频工具启动 |
| 旧数值热搜分类 | 迁移为稳定 tab 字符串；`movie/teleplay` 回退 `realtime` | NTP 热搜初始化 |
| sync 中 `zhihuBlocklistFilter` | local key 缺失时读取并写入有效本地状态 | Options、知乎工具 |
| 旧 `biliToolPosition.top` | 按视口换算为 `topRatio` | B站视频工具 |

### 3.3 NTP 壁纸设置对象

权威存储 key：`chrome.storage.local.echo_ntp_wallpaper_v2`。

| 字段 | 类型/允许值 | 当前默认 | 生命周期 |
| --- | --- | --- | --- |
| `mode` | `daily` / `collection` / `off` | `daily` | 本机持久 |
| `quality` | `4k` / `1080p` | `4k` | 本机持久 |
| `pinnedDate` | string / null | `null` | 本机持久 |
| `collectionPlayMode` | `random` / `fixed` | `random` | UI 兼容状态 |
| `lastActiveMode` | `daily` / `collection` | `daily` | 本机持久 |
| `autoHideInfo` | boolean | `true` | 本机持久 |
| `minimalMode` | boolean | `false` | 本机持久 |
| `blankMode` | boolean | 首帧镜像或 `false` | 本机持久 |
| `infoPositionY` | number / null | `null` | 本机持久 |
| `lastShownWallpaperId` | string / null | `null` | 本机持久 |
| `previousMode` | 任意旧值 / null | `null` | 已废弃兼容字段 |

---

## 4. 存储与缓存清单

### 4.1 Chrome storage

| 区域 | Key | 数据 | 读取方 | 写入方 | 生命周期 |
| --- | --- | --- | --- | --- | --- |
| sync | 通用设置 key | 功能开关与策略 | Background、内容脚本、Options、站点模块 | Options、安装迁移、站点迁移 | 跨设备持久 |
| sync | `echo_ntp_wallpaper_favorites` | 壁纸日期数组 | NTP、Options 备份 | NTP、Options 导入 | 跨设备持久 |
| local | `echo_ntp_wallpaper_v2` | NTP 壁纸设置对象 | NTP、Options 备份 | NTP、Options 导入 | 本机持久 |
| local | `echo_ntp_trending` | NTP 热搜开关 | NTP | Background 新装、NTP | 本机持久 |
| local | `echo_ntp_trending_category` | 稳定分类 tab | NTP | NTP | 本机持久 |
| local | `echo_ntp_trending_cache_baidu_<tab>` | 分类数据与时间戳 | NTP | NTP | 本机缓存 |
| local | `echo_ntp_zoom` | NTP CSS 缩放比例 | NTP | NTP | 本机持久 |
| local | `freCompleted` | FRE 完成状态 | Background | FRE | 本机持久 |
| local | `zhihuBlocklistFilter` | 知乎过滤权威开关 | Options、知乎工具 | Options、Background 首次同步 | 本机持久 |
| local | `zhihuBlocklistAuthorized` | 知乎授权确认 | Options | Options | 本机持久 |
| local | `echoZhihuBlocklistV1` | 按账号分区的完整快照 | Options、知乎工具 | 知乎工具 | 本机隐私数据 |
| local | `echo_ntp_wallpaper_favorites` | sync 配额失败后的降级副本 | 当前无读取方 | NTP | 本机降级数据 |
| session | `echoBiliFeedHistory:<tabId>` | schema v3 推荐批次与索引 | Background | Background | 浏览器会话/标签 |

### 4.2 localStorage

| Key | 数据 | 权威性 | 用途 |
| --- | --- | --- | --- |
| `echo_ntp_blank_mode` | `true/false` 字符串 | 首帧镜像 | `blank-init.js` 消除首帧布局跳变 |
| `echo_ntp_trending` | `true/false` 字符串 | 首帧镜像 | 热搜关闭时预设 class |
| `echo_remote_wallpaper_cache` | 远程壁纸 JSON 和时间戳 | 缓存 | 24 小时远程列表缓存 |
| `echo_bing_api_cache` | Bing API 数据和时间戳 | 缓存 | 最新壁纸数据缓存 |
| `echo_ntp_view_history` | 最近 100 个壁纸日期 | 页面功能数据 | 壁纸浏览足迹 |
| `echo_ntp_bookmark_bar_enabled` | 旧书签栏开关镜像 | 遗留 | 预留书签栏首帧高度 |

### 4.3 IndexedDB

- 数据库：`echo_wallpaper_cache`
- Object store：`images`
- Key path：`url`

| Key 形态 | 值 | 生命周期 |
| --- | --- | --- |
| Bing 图片 URL | `{ url, blob, timestamp }` | 七天过期清理 |
| `custom:<timestamp>` | 自定义壁纸显示 Blob | 不自动过期 |
| `custom_thumb:<timestamp>` | 自定义壁纸缩略图 Blob | 不自动过期 |

---

## 5. 消息与 Port 清单

### 5.1 有生产调用方的 runtime action

| Action | 调用方 | 关键参数 | Sender 依赖 | 响应/异步 |
| --- | --- | --- | --- | --- |
| `loadBiliFeedHistory` | B站推荐历史 | 无 | `sender.tab.id` | `{ ok, state/error }`，异步 |
| `saveBiliFeedHistory` | B站推荐历史 | `state` schema v3 | `sender.tab.id` | `{ ok, error? }`，异步 |
| `clearBiliFeedHistory` | B站推荐历史 | 无 | `sender.tab.id` | `{ ok, error? }`，异步 |
| `mouseGestureStart` | `content.js`、`common/mouse-gesture.js` | 无 | 无校验 | `{ ok: true }` |
| `mouseGestureEnd` | `content.js`、`common/mouse-gesture.js` | 无 | 无校验 | `{ ok: true }` |
| `switchTab` | 内容脚本、NTP、Options、common | `direction`、`source` | 当前窗口查询 | 异步空响应 |
| `openInNewTab` | 内容脚本、NTP、Options、Search Box、B站工具 | `url`、`active?`、`forceAdjacentPosition?` | 当前活动标签 | 异步空响应 |
| `searchInNewTab` | 内容脚本、NTP、Options、common | `text`、`forceAdjacentPosition?` | 当前活动标签 | 异步空响应 |
| `getZoom` | 内容脚本、Search Box、Options、B站工具、common | 无 | 优先 `sender.tab.id` | `{ zoom }`，异步 callback |
| `setZoom` | 内容脚本、Options、common | `zoom` | 优先 `sender.tab.id` | `{ success }`，异步 callback |
| `quickSaveImage` | `content.js` | Data URL、原 URL、页面信息 | 无来源校验 | `{ success, downloadId/error }`，异步 |
| `fetchImageAsDataUrl` | `content.js` | `imageUrl`、`pageUrl` | 无来源校验 | `{ dataUrl/error }`，异步 |
| `proxyFetch` | NTP、Search Box | `url`、`options` | 无来源/域名校验 | `{ success, data/error }`，异步 |
| `bingSuggest` | NTP | `query` | 无来源校验 | `{ suggestions }`，异步 |

### 5.2 后台发送到页面的消息

| Action | 发送方 | 接收方 | 参数 | 用途 |
| --- | --- | --- | --- | --- |
| `syncMouseGestureState` | Background | 普通 HTTP(S) 内容脚本 | `isRightMouseDown` | 切换标签后延续右键状态 |
| `bookmarkBarUpdated` | 废弃通知函数 | 内容脚本、NTP、Options 遗留接收器 | 书签栏数据 | 当前无已注册书签事件入口 |
| `bookmarkFolderUpdated` | 废弃通知函数 | 内容脚本、NTP、Options 遗留接收器 | 文件夹数据 | 当前无已注册书签事件入口 |

### 5.3 Port 协议

#### Options 到 Background

Port 名：`echo-zhihu-blocklist-sync`

| 方向 | 消息 | 用途 |
| --- | --- | --- |
| Options → Background | `{ action: 'start', mode }` | 启动首次或手动同步 |
| Options → Background | `{ action: 'cancel' }` | 请求取消 |
| Background → Options | `{ type: 'state', state }` | 发布 opening/connecting/syncing/cancelling/completed/failed/cancelled |

#### Background 到知乎同步窗口

Port 名：`echo-zhihu-blocklist-worker`

| 方向 | 消息 | 用途 |
| --- | --- | --- |
| Background → Content | `{ type: 'ping' }` | 探测内容脚本就绪 |
| Content → Background | `{ type: 'ready' }` | 宣告可接收任务 |
| Background → Content | `{ action: 'start', taskId }` | 开始读取名单 |
| Background → Content | `{ action: 'cancel' }` | 请求取消 |
| Content → Background | `{ type: 'status', message }` | 连接阶段状态 |
| Content → Background | `{ type: 'progress', current, total }` | 分页进度 |
| Content → Background | `{ type: 'complete', total, syncedAt }` | 完整提交成功 |
| Content → Background | `{ type: 'cancelled', message }` | 已取消 |
| Content → Background | `{ type: 'error', message }` | 同步失败 |

### 5.4 无生产调用方或重复分支候选

以下只标记为阶段 4 清理候选，当前不得直接删除：

- `openInCurrentTab`；
- `segmentText`；
- `getBookmarkBar`；
- `getFolderContents`；
- `addBookmark`；
- `createFolder`；
- `updateBookmark`；
- `removeBookmark`；
- `removeBookmarkTree`；
- `openUrlInNewTab`；
- `openOptionsPage`；
- `getBookmark`；
- `getChildren`；
- `searchBookmarks`；
- `getBookmarkPath`；
- `moveBookmark`；
- `getFavicon`；
- `getWallpaperList`；
- 后置重复的 `searchInNewTab`、`openInNewTab` 和 `getZoom` 分支。

---

## 6. 关键状态所有权清单

### 6.1 Background Worker 临时状态

| 状态 | 当前所有者 | 用途 | Worker 重启后 |
| --- | --- | --- | --- |
| `bossKeyState` | Background | 保存最小化前窗口状态 | 丢失 |
| `isRightMouseDown` | Background | 跨标签延续鼠标手势 | 丢失 |
| `newTabInsertState` | Background | 每窗口新标签插入基准 | 丢失并重新学习 |
| `extensionCreatedTabs` | Background | 跳过扩展自产标签 | 丢失 |
| `tabCreationQueue` | Background | 每窗口串行处理新标签 | 丢失 |
| `windowTabsCache` | Background | 标签顺序和活动标签缓存 | 启动时异步重建 |
| `isProcessingRemoval` | Background | 抑制关闭触发的激活事件 | 丢失；当前跨窗口共享 |
| `zhihuSyncSubscribers` | Background | 设置页订阅者 | Port 断开后重建 |
| `zhihuSyncTask` | Background | 当前知乎同步任务 | 丢失 |
| `zhihuSyncState` | Background | 当前同步阶段 | 重置为 idle |

### 6.2 页面状态

| 页面/模块 | 主要状态 |
| --- | --- |
| `content.js` | 当前设置、右键状态、滚轮节流、拖拽状态、toast、缩放指示器 |
| Search Box | iframe、搜索 DOM、热搜数据、滚动定时器、缩放轮询、光谱 RAF |
| NTP | `wallpaperState`、热搜类别与缓存、NTP 缩放、搜索建议、多个观察和 UI 状态 |
| B站视频工具 | 视频效果、Canvas RAF、Shadow DOM、位置、缩放轮询、路由监听 |
| B站推荐历史 | 批次数组、索引、多个 Observer、overlay、延迟保存 |
| 知乎工具 | 当前快照、ID 集合、Observer、扫描队列、同步运行态、同步窗口遮罩 |
| Options | UI 设置、演示定时器、知乎任务状态、手势和拖拽页面状态 |

### 6.3 当前状态边界事实

- Background 同时拥有两套标签状态：新标签插入状态和关闭标签缓存；
- `isProcessingRemoval` 是跨窗口全局状态；
- B站推荐数据的权威会话存储是 `storage.session`，页面内存是工作副本；
- 知乎完整快照只在所有校验通过后写入 local；
- NTP 同时使用 sync、local、localStorage 和 IndexedDB；
- Search Box 的动画和缩放轮询在首次创建后拥有独立生命周期；
- 多套输入增强分别维护自己的手势、缩放和拖拽页面状态。

---

## 7. 网络目标清单

### 7.1 生产网络请求

| 目标 | 调用位置 | 方式 | 数据/用途 | 缓存 | 当前失败策略 |
| --- | --- | --- | --- | --- | --- |
| `cn.bing.com/HPImageArchive.aspx` | NTP | 页面 fetch | 最近 8 张壁纸元数据 | localStorage | 返回空数组，使用已有数据 |
| `cn.bing.com/th?id=...` | NTP | 页面 fetch/Image | 壁纸图片 | IndexedDB、内存预加载 | 尝试下一张 |
| `www.echoextension.com/wallpaper-data.json` | NTP | 页面 fetch | 远程壁纸历史 | localStorage 24h | 静默保留缓存/本地数据 |
| 打包 `website/wallpaper-data.json` | NTP | 扩展内 fetch | 壁纸基础数据 | 扩展包 | 警告后继续其他来源 |
| `top.baidu.com/api/board` | NTP → Background | `proxyFetch` | 分类热搜 JSON | storage.local 10 分钟 | 显示缓存或错误状态 |
| `toutiao.com/hot-event/hot-board` | Search Box → Background | `proxyFetch` | 悬浮搜索框热搜 | 页面内存 10 分钟 | 显示失败占位 |
| `api.bing.com/osjson.aspx` | NTP → Background | `bingSuggest` | 搜索建议 | 页面最近一次缓存 | 返回空建议 |
| 任意图片 URL | Content → Background | DNR + fetch | 快速存图 | 无 | toast 显示错误 |
| `_favicon` 扩展 URL | Background 遗留 | fetch | favicon Data URL | 无 | 回退网站 `/favicon.ico` |
| 任意网站 `/favicon.ico` | Background 遗留 | fetch | favicon Data URL | 无 | 返回 not found |
| 知乎 `/api/v4/me` | 知乎内容脚本 | 同源 fetch | 当前账号稳定 ID | 无 | 回退页面初始数据 |
| 知乎 `/api/v3/settings/blocked_users` | 知乎内容脚本 | 同源分页 fetch | 官方黑名单 | 完整快照写 local | 429/5xx 退避，失败保留旧快照 |
| 打包 Markdown | Docs Viewer | 扩展内 fetch | 文档正文 | 扩展包 | 页面显示错误 |

### 7.2 网络边界事实

- `proxyFetch` 当前接受消息中的 URL、method 和 headers，没有域名白名单；
- 快速存图的 DNR 规则使用固定 ID，并按图片域名匹配 XHR；
- NTP 壁纸图片分支和元数据分支具有不同缓存层；
- B站生产模块当前不主动请求 B站接口，主要依赖页面 DOM；
- 知乎同步请求在知乎内容脚本中执行，以使用同源登录态；
- 真实网络不应进入普通 PR 单元测试。

---

## 8. QA 到模块映射

来源：[`QA-CHECKLIST.md`](./QA-CHECKLIST.md)。本节只映射预期，不声明当前通过或失败。

| QA 范围 | 主要模块 | 自动化优先层 | 仍需真实浏览器的部分 |
| --- | --- | --- | --- |
| 冒烟 S1–S4 | NTP、Options、Content、Background | Chromium smoke + 消息集成 | 真实 Edge 手势体验 |
| 标签 T1–T8 | Background | reducer、FakeChrome、Chromium | 窗口焦点和 Edge 事件差异 |
| 手势 G1–G6 | Content、common、NTP、Options、Background | DOM 事件 + 消息集成 | 跨标签持续按键体验 |
| 拖拽 D1–D4 | Content、common、NTP、Options | DOM fixture | 宿主页原生拖拽冲突 |
| 壁纸 W1–W9 | NTP、Options | 纯逻辑、fake IDB、Chromium | GPU、视觉和真实配额 |
| 搜索 B1–B7 | NTP、Search Box、Background | DOM + 消息 + Chromium | 页面快捷键冲突和焦点 |
| 快捷键 K1–K8 | Background、Content、common | listener 测试 + Chromium | 物理快捷键和系统注册 |
| 站点 S1–S2c | B站推荐历史 | fixture + session + Chromium | 当前 B站 DOM/灰度布局 |
| 站点 S3–S8 | 知乎工具、Background、Options | API transcript + Port + DOM fixture | 登录态、真实无限滚动 |
| 站点 S9 | FRE、官网 | DOM/视觉测试 | 最终视觉人工验收 |
| 边界 E1–E13 | 多模块 | 按条目分层 | DPI、外网、防盗链、真实升级 |

---

## 9. 必须真实浏览器或真实站点验证的边界

### 9.1 Chromium/Edge 扩展上下文

- Manifest V3 Worker 终止和重启；
- 实际标签事件顺序；
- 窗口焦点和多窗口交互；
- `chrome.commands` 真实快捷键；
- 内容脚本 isolated world；
- 跨域 iframe 事件；
- DNR Referer 是否满足目标站点；
- 下载完成、中断和文件系统行为；
- `storage.sync` 真实配额和同步冲突；
- IndexedDB Blob 配额和结构化克隆。

### 9.2 B站

- 当前 `.feed-card` 和视频卡结构；
- 推荐换批是否始终零 URL 重合；
- 不同账号、登录态、视口和灰度布局；
- SPA 导航是否复用 document；
- 播放器 Shadow DOM/自定义元素变化；
- DRM、跨源 Canvas、全屏和画中画；
- 真实高 DPI 和缩放布局。

### 9.3 知乎

- 当前账号接口和黑名单分页；
- 当前评论和卡片作者标识；
- 信息流虚拟列表和无限滚动；
- popup 同步窗口与 Worker Port 生命周期；
- 登录退出和账号切换；
- www/专栏/回答/评论的当前 DOM 变体。

### 9.4 视觉和系统交互

- 高 DPI；
- 深浅主题；
- 页面缩放；
- 动画流畅性；
- 浏览器和操作系统快捷键冲突；
- Edge 商店安装和升级。

---

## 10. 阶段 0 候选问题登记

本节只登记后续测试目标，不在阶段 0 修改生产代码。

### 10.1 E2 级候选

- 标签关闭对 `lastActiveTabId` 的判定；
- 跨窗口共享 `isProcessingRemoval`；
- `bossKeyState` 的 Worker 重启恢复；
- 快速存图固定 DNR 规则 ID 的并发；
- local 收藏降级副本无读取路径；
- Search Box 隐藏后动画和缩放轮询继续；
- NTP 初始化中壁纸网络阻塞搜索和热搜绑定；
- 搜索建议乱序响应；
- 壁纸错误响应缓存；
- 备份导入 schema 和分步写入。

### 10.2 E3 级候选

- 当前知乎过滤与无限滚动；
- 当前知乎同步 Port 稳定性；
- 当前 B站 SPA 往返；
- 当前 B站批次完成条件；
- 快速滚轮缩放步进；
- 品牌 Edge 的扩展事件差异。

### 10.3 当前不得按 bug 处理

- 历史文档记录但当前未复现的问题；
- 已有生产前置分支处理、后置重复分支不可达的 action；
- 已明确文案要求刷新后生效的悬浮搜索框主开关；
- 仅因文件行数大而推断出的缺陷；
- 仅凭变量名推断知乎个人页路径应匹配 `urlToken`；现有探针样本支持当前 ID 路径，但样本仍需扩充。

---

## 11. 阶段 0 门禁结论

| 门禁 | 状态 | 证据/后续动作 |
| --- | --- | --- |
| 当前分支、HEAD、上游和版本已记录 | 满足 | 本地与上游均为 `82fc588...`，版本 `1.3.3` |
| Manifest 入口和脚本顺序已登记 | 满足 | 第 2 节 |
| 设置和迁移已登记 | 满足 | 第 3 节 |
| storage/localStorage/IndexedDB 已登记 | 满足 | 第 4 节 |
| 消息、Port 和候选无调用方 action 已登记 | 满足 | 第 5 节 |
| 关键状态所有权已登记 | 满足 | 第 6 节 |
| 网络目标、缓存和失败策略已登记 | 满足 | 第 7 节 |
| QA 已映射但未作为 bug 证据 | 满足 | 第 8 节 |
| 真实浏览器边界已登记 | 满足 | 第 9 节 |
| 生产行为未修改 | 满足 | 本阶段只新增治理文档 |

阶段 0 满足进入阶段 1 的文档门禁。阶段 1 开始前仍需确认开发依赖安装和测试命令执行授权。

---

## 12. 版本记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-01 | 1.1 | 明确 FRE 始终保留输入增强演示，其他运行页面服从用户开关 |
| 2026-09-01 | 1.0 | 冻结当前入口、设置、存储、消息、状态、网络和浏览器验证边界 |
