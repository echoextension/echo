# [English Version] ECHO Extension Privacy Policy

**Effective Date**: February 1, 2026

Thank you for using **ECHO 易可 - 让 Edge 更懂中国用户 (Edge Chinese Helper & Optimizer)**. We value your privacy and are committed to protecting your personal data. This policy explains how we handle your information.

**ECHO is a fully open-source project.** The complete source code is publicly available on [GitHub](https://github.com/echoextension/echo) under the [GPL-3.0](LICENSE) license. Every claim in this privacy policy can be verified by inspecting the code.

### 1. Local-First Principle

ECHO adheres to a **"Local First"** development philosophy.

- **Local Execution**: With the exception of the experimental AI feature described in Section 3, all core features (Mouse Gestures, Super Drag, Boss Key, Tab Management) run entirely within your local browser environment.

- **No Data Collection**: We **do NOT** upload your browsing history, bookmarks, passwords, or form inputs to any servers.

- **Settings Storage**: Your extension preferences are stored locally or synced via your encrypted Microsoft Edge Sync account. The developer has no access to this data.

- **Backup & Restore**: ECHO provides an optional export/import feature for data backup. The exported JSON file contains **only** ECHO version number, export timestamp, feature toggle settings, and NTP wallpaper favorites. It does **NOT** contain any personal information, browsing history, bookmarks, passwords, or any other browser data.

### 2. Permissions Usage

To provide enhanced functionality, ECHO requires certain browser permissions:

- **Read and change all your data on the websites you visit (`*://*/*`)**:
  
  - *Purpose*: Essential for "Mouse Gestures" and "Super Drag" to detect mouse movements on web pages.
  - *Promise*: We only detect mouse events. We **never** collect page content (except for the specific feature described in Section 3).

- **Read your browsing history / Tabs (`tabs`)**:
  
  - *Purpose*: Required to manage tab closing, switching, and opening new tabs in specific positions.

- **Downloads (`downloads`)**:
  
  - *Purpose*: Enables the "Alt+Click to Quick Save Image" feature, allowing you to save webpage images directly to your designated local folder.
  - *Promise*: Download operations are executed entirely locally. The extension does not log download content or file paths.

- **Dynamic Script Injection (`scripting`)**:
  
  - *Purpose*: Used to dynamically load feature modules such as "Related Search" on eligible webpages.
  - *Promise*: Only injects this extension's own functional scripts. No third-party or advertising code is ever injected.

- **Modify Network Request Headers (`declarativeNetRequest`)**:
  
  - *Purpose*: Used solely to remove `Origin` and `Referer` headers from requests sent to the fallback AI service (Ollama public test server) described in Section 3, in order to resolve cross-origin access restrictions.
  - *Scope*: This rule applies **only** to requests directed at the specific fallback AI service endpoint. It does **not** affect any other network requests from your browser.
  - *Promise*: No user browsing data, cookies, or authentication headers are modified or intercepted.

### 3. Special Note on AI & Third-Party Services (Important)

ECHO includes an experimental feature called **"Related Search"**. This feature is **DISABLED by default**.

It operates **only if** you manually enable it in settings and provide **secondary confirmation**. When active:

- **Safety Filters**: Before any analysis, ECHO runs a strict local check. This feature AUTOMATICALLY STOPS and does nothing if the current page is:
  
  - A Local/Intranet Page (e.g., localhost, 192.168.x.x, 10.x.x.x). Your internal network data never leaves your computer.
  - A Sensitive Domain (e.g., .gov, .mil, .edu, .corp, .internal). We respect the privacy of government, military, education, and workplace environments by default.

- **Data Transmission**: Only if the page passes the safety filters, the extension extracts a short, non-sensitive text snippet from the active webpage (excluding input fields).

- **Service Provider**: The text snippet is sent to third-party AI service providers. The **primary** provider is **Pollinations.ai** (via HTTPS encrypted connection). If the primary service is unavailable, the extension falls back to an **Ollama public test server** (via unencrypted HTTP connection). Both services are called anonymously as described below.

- **Anonymity**: Regardless of which provider handles the request, this is a strictly **Anonymous Call**. The request does **NOT** contain any API Keys, Tokens, Cookies, or User/Device identifiers. Providers can only see the request IP (for basic network communication) and cannot identify you personally.

- **Purpose**: To analyze context and generate 4-6 relevant search keywords based on the content.

- **No Storage Policy**: Data is processed instantaneously. We do **NOT** store your original text or build user profiles. However, please be aware that due to the technical characteristics of AI services, the service provider may maintain **short-term request context** based on your IP address (e.g., for model inference optimization), which could occasionally cause minor content correlation between consecutive requests. This does **NOT** constitute persistent user tracking or profiling.

- **Closing Commitment**: This feature may be **fully closed** at any time unconditionally. It may also be **partially closed** for specific web pages or websites (domains). Neither your prior usage nor the way you previously used it will limit your ability to disable the feature, and disabling it will **NOT** affect any other functionality of this extension.

- **Service Availability Disclaimer**: The third-party AI service endpoints used by this feature are **publicly available community resources** that may become unavailable, experience outages, or return abnormal data at any time without notice. The extension and its developer assume **no responsibility** for the availability, accuracy, or reliability of these services.

- **Content Disclaimer**: The "safety filtering" described above refers exclusively to **domain-level filtering** (e.g., blocking .gov, .mil, .edu sites). It does **NOT** constitute any form of content review, moderation, or endorsement. The webpage content that passes domain filtering may contain **any type of content**, and consequently, the AI-generated search recommendations may also contain **any type of content**. Such recommendations are generated entirely by third-party AI models and do **NOT** represent the views, endorsement, or disapproval of the extension or its developer. The extension and its developer bear **no responsibility** for the nature, accuracy, or appropriateness of any AI-generated content.

### 4. Third-Party Data Sources for Trending Lists

The trending lists displayed in this extension are sourced from publicly available third-party APIs on the internet:

- **New Tab Page (NTP) Trending**: Data sourced from **Baidu Hot Search** (`top.baidu.com`) public API.
- **Floating Search Box (Ctrl+B) Trending**: Data sourced from **Toutiao Hot Board** (`toutiao.com`) public API.

This data is **NOT** proprietary to this extension, nor is it official data from Microsoft or Edge. These lists are provided for reference only, and their accuracy and availability depend on the respective third-party services. Additionally, the daily wallpaper displayed on the New Tab Page is sourced from **Bing's publicly available Daily Wallpaper API**. It is used solely for visual enhancement and does not involve any collection or upload of user data.

### 5. Search Redirection

Features that initiate searches (e.g., Floating Search Box, Super Drag Search) simply construct a standard URL (`bing.com/search?q=...`) and open it in a new tab. ECHO does not intercept or log your search queries.

### 6. Code Transparency Note

If you review the source code, for the sake of transparency, we explicitly clarify the status of certain "unused" or "high-risk appearing" code modules:

1. **Bookmark Bar Management Logic** (`getBookmarkBar`, etc.):
   
   * **Status**: **Fully Deprecated**.
   * **Explanation**: This is legacy code from an early attempt to implement a custom bookmark bar. Since the `bookmarks` permission has been removed from `manifest.json`, this code is physically unable to execute and is effectively dead code.

2. **AI Text Analysis Module** (`analyzeText`, `related-search.js`, etc.):
   
   * **Status**: **Opt-in Feature (Default OFF)**.
   * **Explanation**: This is the backend logic for the "Related Search" feature. This feature is **completely disabled by default**. The code is only activated if you explicitly enable it in the settings, at which point it strictly follows the data protection process described in Section 3 of this policy (anonymity, non-storage, sensitive domain filtering).
   * Until enabled, this code remains dormant and makes no network requests.

We retain this code to maintain the integrity of the functional architecture and to provide you with the option of choice.

### 7. Change Notification

If there are significant changes to our privacy policy (especially those involving data collection practices), we will notify you through the extension's update log or a pop-up notification.

### 8. Contact Us

If you have any questions regarding this privacy policy, please contact the developer at:

- Email: echoextension [at] hotmail [dot] com

---

# [中文版] ECHO 易可 插件隐私保护指引

**生效日期 (Effective Date)**：2026年2月1日

感谢您使用 ECHO 易可 - 让 Edge 更懂中国用户 (Edge Chinese Helper & Optimizer)。我们深知个人隐私的重要性，并承诺严格保护您的数据安全。本指引将详细说明我们如何处理您的数据。

**ECHO 是一个完全开源的项目。**全部源代码以 [GPL-3.0](LICENSE) 许可证公开托管于 [GitHub](https://github.com/echoextension/echo)。本隐私指引中的每一项承诺，均可通过审查源码加以验证。

### 1. 核心原则：数据不上传

ECHO 遵循 **"Local First"（本地优先）** 的开发原则。

- **本地运行**：除了下文第 3 条明确说明的 AI 实验功能外，ECHO 的所有核心功能（包括鼠标手势、超级拖拽、老板键、标签页管理等）均完全运行在您的浏览器本地。
- **不收集数据**：我们**不会**将您的浏览历史、书签内容、密码或任何表单输入数据上传至任何服务器。
- **配置保存**：您的插件设置选项仅保存在您浏览器的本地存储 (Local Storage) 或通过您的 Edge 账号进行加密同步 (Sync Storage)，开发者无法访问这些数据。

- **备份与恢复**：ECHO 提供可选的数据导出/导入功能，用于防止卸载扩展时数据丢失。导出的 JSON 文件**仅包含** ECHO 插件版本号、导出时间戳、功能开关设置和新标签页 (NTP) 壁纸收藏。**绝不包含**任何个人信息、浏览记录、收藏夹、密码或任何其他浏览器数据。

### 2. 权限使用说明

为了实现增强功能，ECHO 需要申请部分浏览器权限，用途如下：

- **读取和更改所有网站上的数据 (`*://*/*`)**：
  
  - *用途*：这是实现「鼠标手势」和「超级拖拽」的必要条件。插件需要在网页上注入脚本以识别鼠标轨迹。
  - *承诺*：我们只检测鼠标事件，**绝不**搜集网页内容（第 3 条所述功能除外）。

- **读取浏览历史 / 标签页 (`tabs`)**：
  
  - *用途*：用于控制标签页的关闭、切换、以及在特定位置打开新标签页。

- **下载 (`downloads`)**：
  
  - *用途*：用于「Alt+点击快速保存图片」功能，将网页图片直接保存到您指定的本地文件夹。
  - *承诺*：下载操作完全在本地执行，插件不记录下载内容或路径。

- **动态脚本注入 (`scripting`)**：
  
  - *用途*：用于在符合条件的网页上动态加载「关联搜索推荐」等功能模块。
  - *承诺*：仅注入本插件自身的功能脚本，不注入任何第三方或广告代码。

- **修改网络请求头 (`declarativeNetRequest`)**：
  - *用途*：仅用于移除发往第 3 条中所述的备用 AI 服务（Ollama 公共测试服务器）的请求中的 `Origin` 和 `Referer` 头，以解决跨域访问限制。
  - *影响范围*：该规则**仅**作用于发往上述特定 AI 备用服务端点的请求，**不会**影响您浏览器的任何其他网络请求。
  - *承诺*：不修改或拦截任何用户的浏览数据、Cookies 或身份验证信息。

### 3. 关于 AI 与第三方服务的特别说明 (重要)

ECHO 包含一个名为「关联搜索推荐 (Related Search)」的实验性功能。**该功能默认处于关闭状态。**

仅当您在设置页**主动开启**并完成**二次确认**后，该功能才会运行。运行时的数据处理逻辑如下：

- **安全过滤**：在进行任何分析前，ECHO 会执行严格的本地环境检查。如果当页网页属于以下类别，该功能将自动停止运行，不进行任何数据提取：
  
  - 本地/内网页面（例如 localhost, 192.168.x.x, 10.x.x.x）。您的内网数据绝不离开您的计算机。
  - 敏感域名（例如 .gov, .mil, .edu, .corp, .internal）。我们默认尊重政府、军事、教育及企业内部办公环境的数据隐私。

- **数据传输**：仅当网页通过安全过滤后，插件会截取当前网页的少量**非敏感文本摘要**（不包含输入框内容）。

- **服务提供商**：文本摘要将发送至第三方 AI 服务商。**主要服务商**为 **Pollinations.ai**（通过 HTTPS 加密连接）。当主服务商不可用时，将回退至 **Ollama 公共测试服务器**（通过未加密的 HTTP 连接）。无论使用哪个服务商，均采用下述的匿名调用方式。

- **完全匿名性**：无论接入何种服务，此处 API 调用都是完全匿名的 (Anonymous Call)。请求中**不包含**任何 API Key、Token、Cookies 或用户唯一标识符 (User ID/Device ID)。服务商仅能看到请求来源 IP（用于基础网络通信），无法识别您的个人身份。

- **数据用途**：仅用于由 AI 分析并生成 4-6 个相关的搜索关键词推荐。

- **无存储承诺**：数据仅用于瞬时处理。我们**不存储**您的原始网页文本，也**不建立**任何形式的用户画像。但请知悉，由于 AI 服务的技术特性，服务商可能基于您的 IP 地址维护**短期请求上下文**（例如用于模型推理优化），这可能偶尔导致连续请求之间出现轻微的内容关联。这**不构成**对用户的持久追踪或画像建立。

- **可关闭承诺**：在任何时候、并且没有任何条件，您可以**全部关闭**本功能；也可以基于特定网页或者特定网站（Domain）**部分关闭**此功能。曾经是否使用、如何使用不会影响您的关闭，并且关闭此功能也**不会**影响本插件的任何其他功能。

- **服务可用性免责**：本功能使用的第三方 AI 服务接口均为**公开可用的社区资源**，可能随时无预警地变得不可用、发生故障或返回异常数据。本插件及其开发者对这些服务的可用性、准确性或可靠性**不承担任何责任**。

- **内容免责**：上述「安全过滤」仅指**域名级别的过滤**（例如屏蔽 .gov、.mil、.edu 等域名），**不代表**对网页内容进行任何形式的审查、管控或认可。通过域名过滤的网页内容可能包含**任何类型的内容**，因此 AI 生成的搜索推荐结果也可能包含**任何类型的内容**。这些推荐内容完全由第三方 AI 模型生成，**不代表**本插件或其开发者的观点、认可或不认可。本插件及其开发者对 AI 生成内容的性质、准确性或适当性**不承担任何责任**。

### 4. 榜单数据来源说明

本插件中展示的热搜榜单数据来源于互联网上公开可用的第三方 API 接口，具体如下：

- **新标签页 (NTP) 热搜**：数据来源于**百度热搜** (`top.baidu.com`) 公开接口。
- **悬浮搜索框 (Ctrl+B) 热搜**：数据来源于**今日头条热榜** (`toutiao.com`) 公开接口。

这些数据**并非**本插件的自有数据，也**并非**微软或 Edge 官方提供的数据。榜单内容仅供参考，其准确性和可用性取决于相应的第三方服务。此外，新标签页展示的每日壁纸来源于 **Bing 每日壁纸**的公开接口，仅用于美化展示，不涉及任何用户数据的收集或上传。

### 5. 搜索重定向

ECHO 提供的「使用 Bing 搜索」功能（如悬浮搜索框、超级拖拽搜索）仅将您的搜索词拼接为标准 URL (`bing.com/search?q=...`) 并打开新标签页。这与您在地址栏直接搜索的行为一致，插件本身不拦截或记录搜索内容。

### 6. 代码透明度声明

如果您审查源代码，为了确保公开透明，我们对以下几个看似“未使用”或“风险”的代码模块进行特别说明：

1. **书签栏管理逻辑** (`getBookmarkBar` 等)：
   
   * **状态**：**已完全废弃 (Deprecated)**。
   * **说明**：这是早期尝试自定义书签栏的遗留代码。由于 `manifest.json` 中已移除 `bookmarks` 权限，这些代码在物理上无法执行，属于死代码。

2. **AI 文本分析模块** (`analyzeText`, `related-search.js` 等)：
   
   * **状态**：**默认关闭的功能 (Opt-in Feature)**。
   * **说明**：这是「关联搜索推荐」功能的后端逻辑。该功能默认**完全关闭**。仅当用户在设置中主动开启该实验功能时，代码才会被激活，并严格遵循本隐私指引第 3 条所述的数据保护流程（匿名、不存储、敏感域名过滤）。
   * 在此之前，它们处于休眠状态，不会进行任何网络请求。

我们保留这些代码是为了保持功能架构的完整性，并为您提供选择权。

### 7. 变更通知

如果我们的隐私策略发生重大变更（特别是涉及数据收集方式的变化），我们将通过插件更新日志或弹窗提示的方式通知您。

### 8. 联系我们

如果您对本隐私指引有任何疑问，请通过以下方式联系开发者：

- 电子邮件：echoextension [at] hotmail [dot] com
