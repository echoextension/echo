# ECHO 发布流程与责任边界

> 状态：阶段 9 工程化流程
>
> 原则：自动化只生成并验证发布候选，不自动提交代码、不上传商店、不替代真实 Edge 人工验收。

## 1. 三层持续验证

### 1.1 Pull Request 快速门禁

PR 和受监控分支 push 执行：

1. `npm ci`；
2. `npm run check`；
3. 静态发布校验；
4. Vitest 逻辑、DOM fixture 和 Chrome API fake 测试。

该层不访问第三方站点，不安装浏览器，目标是快速、确定地发现仓库内回归。

### 1.2 主干 Chromium 门禁

只有 push 到 `main` 后执行：

1. 安装 Playwright 官方 Chromium；
2. 使用每测试独立 profile 加载 unpacked 扩展；
3. 执行 `npm run test:e2e`；
4. 失败时保存 trace、截图和 HTML 报告。

Chromium 自动化不等于 Edge 品牌浏览器验收。

### 1.3 第三方契约监控

每周二、周五定时检查：

- Bing 壁纸 API；
- 官网远程壁纸 JSON；
- 百度与头条热榜 JSON；
- B站公开首页核心卡片 selector；
- 知乎公开热榜内容 selector。

第三方检查使用 `continue-on-error`，始终上传报告。失败只表示兼容性信号，需要人工复核；不能直接判定 ECHO 产品代码有缺陷，也不能阻塞普通 PR。

## 2. 发布版本门禁

准备发布候选前，以下版本记录必须一致：

- `manifest.json` 的 `version`；
- `package.json` 的 `version`；
- `package-lock.json` 的顶层版本和根包版本；
- `CHANGELOG.md` 顶部最新语义版本标题。
- 设置页版本徽标；
- 官网结构化数据和下载入口版本标识。

`npm run validate` 会阻止上述机器可校验记录中的不一致版本进入发布流程。

历史基线文档中的旧版本号是审计快照，不随发布版本改写。

## 3. 权限变更门禁

`scripts/manifest-permissions-baseline.json` 是已审核权限基线。静态校验比较：

- `permissions`；
- `host_permissions`。
- `optional_permissions`；
- `optional_host_permissions`。

只有确认功能必要性、替代方案和用户影响后，才能与 Manifest 同时修改基线。禁止为了让 CI 通过而无说明地刷新基线。

## 4. 确定性发布包

`npm run release:package` 执行以下步骤：

1. 先运行完整静态发布校验；
2. 只读取 `scripts/extension-files.mjs` 的显式 allowlist；
3. 对路径排序并写入固定时间、固定权限和固定压缩级别的 ZIP；
4. 再解压到内存，逐文件与工作树比较；
5. 输出 ZIP、SHA-256 sidecar 和文件清单。

默认产物：

- `dist/echo-edge-extension-v<version>.zip`；
- 同名 `.sha256`；
- 同名 `.manifest.json`。

发布包明确排除 `.git`、`.github`、`.vscode`、`tests`、`scripts`、`crawler`、覆盖率、Playwright 报告和依赖目录。

相同提交的干净 checkout、相同 Node 及锁定依赖应产生相同 ZIP 字节和 SHA-256。打包器本身有小型临时 fixture 测试，验证两次归档字节完全一致。
仓库通过 `.gitattributes` 将文本 checkout 固定为 LF，并为常见媒体声明 binary；固定 fixture 另有已知 SHA-256，防止 Windows 与 Ubuntu 产生不同归档字节。

## 5. 已生成包验证

`npm run release:verify` 不信任工作树加载结果，而是：

1. 校验 SHA-256 sidecar；
2. 校验 ZIP 条目与 allowlist 完全一致；
3. 校验每个 ZIP 文件与当前工作树字节一致；
4. 解压到临时目录；
5. 使用独立临时 Chromium profile 加载解压后的发布包；
6. 验证 Service Worker、Manifest 版本和 Options 页面；
7. 清除临时目录和 profile。

任何一步失败都阻止发布候选 artifact 上传。

## 6. GitHub 发布候选工作流

`Release Candidate` 仅允许从 `main` 手动触发；工作流和 job 首步都会拒绝其他 ref。随后按顺序执行：

1. 快速门禁；
2. Chromium E2E；
3. 确定性打包；
4. 解压包 Chromium 验证；
5. 上传已验证 ZIP、哈希和清单 artifact。

工作流绑定 `release` environment，可在 GitHub 仓库设置中配置必要审核人。商店上传继续由人工完成。

## 7. Edge 人工发布 QA

自动化通过后仍必须在真实 Edge 完成：

- 商店包安装和旧版本升级；
- Ctrl+Q、Alt+M 等浏览器级快捷键；
- 多窗口焦点和真实标签体验；
- 真实下载目录与防盗链图片；
- B站登录态、播放器、DRM、全屏和灰度布局；
- 知乎登录态、官方黑名单同步、无限滚动和评论变体；
- 高 DPI、缩放、深浅主题与视觉质量。

真实站点问题遵循 fail-open 原则。当前知乎狗粮测试文档中仍标记的阻断项必须单独清零，不能被通用 Chromium 套件覆盖。

## 8. 发布签核记录

每个发布候选至少记录：

- Git commit SHA；
- Manifest/CHANGELOG 版本；
- 快速测试结果；
- Chromium E2E 结果；
- ZIP SHA-256；
- 权限 diff 是否为空；
- Edge 人工 QA 执行人、时间和结果；
- 已知但接受的风险；
- 商店上传批准人。

没有人工 Edge QA 和批准记录时，artifact 只能称为“发布候选”，不能称为“已发布”。
