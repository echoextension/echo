/**
 * ECHO Background Service Worker
 * 仅负责加载、装配和注册后台领域服务。
 */

importScripts(
  'core/settings.js',
  'core/messages.js',
  'background/settings-service.js',
  'background/command-service.js',
  'background/image-service.js',
  'background/bili-session-service.js',
  'background/network-service.js',
  'background/zhihu-sync-service.js',
  'background/tab-coordinator.js',
  'background/message-router.js'
);

const settingsService = EchoBackgroundSettingsService.create(chrome, EchoSettings);
const commandService = EchoBackgroundCommandService.create(chrome, settingsService.getSetting);
const imageService = EchoBackgroundImageService.create(chrome);
const biliSessionService = EchoBackgroundBiliSessionService.create(chrome, EchoSettings);
const networkService = EchoBackgroundNetworkService.create();
const zhihuSyncService = EchoBackgroundZhihuSyncService.create(chrome, EchoMessages.PORTS);
const tabCoordinator = EchoBackgroundTabCoordinator.create(chrome, {
  settingsSchema: EchoSettings,
  getSetting: settingsService.getSetting,
  messages: EchoMessages,
  onTabRemoved: tabId => biliSessionService.clearTab(tabId)
});
const messageRouter = EchoBackgroundMessageRouter.create(chrome, {
  messages: EchoMessages,
  tabs: tabCoordinator,
  images: imageService,
  network: networkService,
  biliSession: biliSessionService
});

settingsService.register();
commandService.register();
biliSessionService.register();
zhihuSyncService.register();
tabCoordinator.register();
messageRouter.register();