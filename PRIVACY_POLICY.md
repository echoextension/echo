# [English Version] ECHO Extension Privacy Policy

**Effective Date**: February 1, 2026

Thank you for using **ECHO 易可 - 让 Edge 更懂中国用户 (Edge Chinese Helper & Optimizer)**. We value your privacy and are committed to protecting your personal data. This policy explains how we handle your information.

**ECHO is a fully open-source project.** The complete source code is publicly available on [GitHub](https://github.com/echoextension/echo) under the [GPL-3.0](https://github.com/echoextension/echo/blob/main/LICENSE) license. Every claim in this privacy policy can be verified by inspecting the code.

### 1. Local-First Principle

ECHO adheres to a **"Local First"** development philosophy.

- **Local Execution**: Core features such as Mouse Gestures, Super Drag, Boss Key, and Tab Management run entirely within your local browser environment.

- **No Data Collection**: We **do NOT** upload your browsing history, bookmarks, passwords, or form inputs to any servers.

- **Settings Storage**: Your extension preferences are stored locally or synced via your encrypted Microsoft Edge Sync account. The developer has no access to this data.

- **Zhihu Blocklist Filter**: If you explicitly enable this feature and start a manual sync, ECHO reads your Zhihu account ID and official blocklist through your existing logged-in Zhihu session. The account ID, blocked-user IDs, URL tokens, sync time, and page author identifiers are processed and stored only in `chrome.storage.local`. They are not uploaded by ECHO, placed in sync storage, or included in ECHO backup exports. Disabling the filter stops page processing; removing the extension clears extension-local storage.

- **Bilibili Feed History**: While this feature is enabled, ECHO stores up to 10 structured recommendation batches per Bilibili tab in `chrome.storage.session`, including card links, titles, covers, authors, durations, play counts, and danmaku counts. This data stays in the local browser session, is isolated by tab, is not uploaded or included in backups, and is removed when the tab closes.

- **Backup & Restore**: ECHO provides an optional export/import feature for data backup. The exported JSON file contains **only** ECHO version number, export timestamp, feature toggle settings, and NTP wallpaper favorites. It does **NOT** contain any personal information, browsing history, bookmarks, passwords, or any other browser data.

### 2. Permissions Usage

To provide enhanced functionality, ECHO requires certain browser permissions:

- **Read and change all your data on the websites you visit (`*://*/*`)**:
  
  - *Purpose*: Essential for mouse gestures, super drag, and enabled site enhancements such as Bilibili feed history and Zhihu blocklist filtering.
  - *Promise*: Site enhancements inspect only the page structures and identifiers needed for their stated function. This data is processed locally and is not uploaded by ECHO.

- **Read your browsing history / Tabs (`tabs`)**:
  
  - *Purpose*: Required to manage tab closing, switching, and opening new tabs in specific positions.

- **Downloads (`downloads`)**:
  
  - *Purpose*: Enables the "Alt+Click to Quick Save Image" feature, allowing you to save webpage images directly to your designated local folder.
  - *Promise*: Download operations are executed entirely locally. The extension does not log download content or file paths.

- **Dynamic Script Injection (`scripting`)**:
  
  - *Purpose*: Used to load ECHO site-enhancement modules when required.
  - *Promise*: Only injects this extension's own functional scripts. No third-party or advertising code is ever injected.

- **Modify Network Request Headers (`declarativeNetRequest`)**:
  
  - *Purpose*: Used by Quick Save Image to temporarily adjust request headers for images that enforce hotlink protection.
  - *Scope*: Temporary rules apply only to the specific image being saved and are removed immediately afterward.
  - *Promise*: No user browsing data, cookies, or authentication headers are modified or intercepted.

### 3. Third-Party Data Sources for Trending Lists

The trending lists displayed in this extension are sourced from publicly available third-party APIs on the internet:

- **New Tab Page (NTP) Trending**: Data sourced from **Baidu Hot Search** (`top.baidu.com`) public API.
- **Floating Search Box (Ctrl+B) Trending**: Data sourced from **Toutiao Hot Board** (`toutiao.com`) public API.

This data is **NOT** proprietary to this extension, nor is it official data from Microsoft or Edge. These lists are provided for reference only, and their accuracy and availability depend on the respective third-party services. Additionally, the daily wallpaper displayed on the New Tab Page is sourced from **Bing's publicly available Daily Wallpaper API**. It is used solely for visual enhancement and does not involve any collection or upload of user data.

### 4. Search Redirection

Features that initiate searches (e.g., Floating Search Box, Super Drag Search) simply construct a standard URL (`bing.com/search?q=...`) and open it in a new tab. ECHO does not intercept or log your search queries.

### 5. Code Transparency Note

If you review the source code, for the sake of transparency, we explicitly clarify the status of certain "unused" or "high-risk appearing" code modules:

1. **Bookmark Bar Management Logic** (`getBookmarkBar`, etc.):
   
   * **Status**: **Fully Deprecated**.
   * **Explanation**: This is legacy code from an early attempt to implement a custom bookmark bar. Since the `bookmarks` permission has been removed from `manifest.json`, this code is physically unable to execute and is effectively dead code.

### 6. Change Notification

If there are significant changes to our privacy policy (especially those involving data collection practices), we will notify you through the extension's update log or a pop-up notification.

### 7. Contact Us

If you have any questions regarding this privacy policy, please contact the developer at:

- Email: echoextension [at] hotmail [dot] com

---

# [中文版] ECHO 易可 插件隐私保护指引

**生效日期 (Effective Date)**：2026年2月1日

感谢您使用 ECHO 易可 - 让 Edge 更懂中国用户 (Edge Chinese Helper & Optimizer)。我们深知个人隐私的重要性，并承诺严格保护您的数据安全。本指引将详细说明我们如何处理您的数据。

**ECHO 是一个完全开源的项目。**全部源代码以 [GPL-3.0](https://github.com/echoextension/echo/blob/main/LICENSE) 许可证公开托管于 [GitHub](https://github.com/echoextension/echo)。本隐私指引中的每一项承诺，均可通过审查源码加以验证。

### 1. 核心原则：数据不上传

ECHO 遵循 **"Local First"（本地优先）** 的开发原则。

- **本地运行**：ECHO 的核心功能（包括鼠标手势、超级拖拽、老板键、标签页管理等）均完全运行在您的浏览器本地。
- **不收集数据**：我们**不会**将您的浏览历史、书签内容、密码或任何表单输入数据上传至任何服务器。
- **配置保存**：您的插件设置选项仅保存在您浏览器的本地存储 (Local Storage) 或通过您的 Edge 账号进行加密同步 (Sync Storage)，开发者无法访问这些数据。

- **知乎黑名单过滤**：仅当您主动开启功能并手动同步时，ECHO 才会通过您现有的知乎登录态读取知乎账号 ID 和官方黑名单。账号 ID、被屏蔽用户 ID、URL Token、同步时间及页面作者标识只在 `chrome.storage.local` 中处理和保存，不会由 ECHO 上传，不进入同步存储，也不包含在 ECHO 备份导出中。关闭功能后停止页面处理；卸载扩展会清除扩展本地存储。

- **B站推荐回退**：功能启用期间，ECHO 会按 B站标签页在 `chrome.storage.session` 中保存最多 10 批结构化推荐，包括卡片链接、标题、封面、作者、时长、播放数和弹幕数。数据只存在于本地浏览器会话，按标签页隔离，不会上传或进入备份，并在标签页关闭时删除。

- **备份与恢复**：ECHO 提供可选的数据导出/导入功能，用于防止卸载扩展时数据丢失。导出的 JSON 文件**仅包含** ECHO 插件版本号、导出时间戳、功能开关设置和新标签页 (NTP) 壁纸收藏。**绝不包含**任何个人信息、浏览记录、收藏夹、密码或任何其他浏览器数据。

### 2. 权限使用说明

为了实现增强功能，ECHO 需要申请部分浏览器权限，用途如下：

- **读取和更改所有网站上的数据 (`*://*/*`)**：
  
  - *用途*：用于「鼠标手势」「超级拖拽」，以及处于启用状态的 B站推荐回退、知乎黑名单过滤等站点增强功能。
  - *承诺*：站点增强只读取实现其明确功能所需的页面结构和作者标识，数据仅在本地处理，不由 ECHO 上传。

- **读取浏览历史 / 标签页 (`tabs`)**：
  
  - *用途*：用于控制标签页的关闭、切换、以及在特定位置打开新标签页。

- **下载 (`downloads`)**：
  
  - *用途*：用于「Alt+点击快速保存图片」功能，将网页图片直接保存到您指定的本地文件夹。
  - *承诺*：下载操作完全在本地执行，插件不记录下载内容或路径。

- **动态脚本注入 (`scripting`)**：
  
  - *用途*：用于按需加载 ECHO 的站点增强模块。
  - *承诺*：仅注入本插件自身的功能脚本，不注入任何第三方或广告代码。

- **修改网络请求头 (`declarativeNetRequest`)**：
  - *用途*：用于「Alt+点击快速保存图片」功能，在图片存在防盗链限制时临时调整请求头。
  - *影响范围*：临时规则仅作用于正在保存的特定图片，并在操作结束后立即删除。
  - *承诺*：不修改或拦截任何用户的浏览数据、Cookies 或身份验证信息。

### 3. 榜单数据来源说明

本插件中展示的热搜榜单数据来源于互联网上公开可用的第三方 API 接口，具体如下：

- **新标签页 (NTP) 热搜**：数据来源于**百度热搜** (`top.baidu.com`) 公开接口。
- **悬浮搜索框 (Ctrl+B) 热搜**：数据来源于**今日头条热榜** (`toutiao.com`) 公开接口。

这些数据**并非**本插件的自有数据，也**并非**微软或 Edge 官方提供的数据。榜单内容仅供参考，其准确性和可用性取决于相应的第三方服务。此外，新标签页展示的每日壁纸来源于 **Bing 每日壁纸**的公开接口，仅用于美化展示，不涉及任何用户数据的收集或上传。

### 4. 搜索重定向

ECHO 提供的「使用 Bing 搜索」功能（如悬浮搜索框、超级拖拽搜索）仅将您的搜索词拼接为标准 URL (`bing.com/search?q=...`) 并打开新标签页。这与您在地址栏直接搜索的行为一致，插件本身不拦截或记录搜索内容。

### 5. 代码透明度声明

如果您审查源代码，为了确保公开透明，我们对以下几个看似“未使用”或“风险”的代码模块进行特别说明：

1. **书签栏管理逻辑** (`getBookmarkBar` 等)：
   
   * **状态**：**已完全废弃 (Deprecated)**。
   * **说明**：这是早期尝试自定义书签栏的遗留代码。由于 `manifest.json` 中已移除 `bookmarks` 权限，这些代码在物理上无法执行，属于死代码。

### 6. 变更通知

如果我们的隐私策略发生重大变更（特别是涉及数据收集方式的变化），我们将通过插件更新日志或弹窗提示的方式通知您。

### 7. 联系我们

如果您对本隐私指引有任何疑问，请通过以下方式联系开发者：

- 电子邮件：echoextension [at] hotmail [dot] com
