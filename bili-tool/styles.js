(function(root) {
  'use strict';

  const STYLES = `
    :host {
      all: initial;
      position: fixed !important;
      left: 0 !important;
      top: var(--echo-top, 50%) !important;
      transform: translateY(-50%);
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      pointer-events: auto;
    }

    .bili-tool-container {
      display: flex;
      flex-direction: column;
      position: relative;
    }

    /* ---- 胶囊轨道 ---- */
    .capsule-rail {
      display: flex;
      flex-direction: column;
      background: rgba(255, 255, 255, 0.96);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 0 12px 12px 0;
      border: 0.5px solid rgba(251,114,153,0.35);
      border-left: none;
      box-shadow: 2px 0 12px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
      overflow: hidden;
      padding: 2px 0;
    }

    /* ---- 拖拽手柄 ---- */
    .drag-handle {
      width: 40px;
      height: 12px;
      display: grid;
      grid-template-columns: repeat(3, 3px);
      grid-template-rows: repeat(2, 3px);
      gap: 2px;
      justify-content: center;
      align-content: center;
      padding-right: 4px;
      box-sizing: border-box;
      cursor: grab;
      user-select: none;
      background: rgba(251,114,153,0.03);
      transition: background 0.15s;
    }
    .drag-handle span {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: rgba(251,114,153,0.25);
      transition: background 0.15s;
    }
    .drag-handle:hover {
      background: rgba(251,114,153,0.06);
    }
    .drag-handle:hover span {
      background: rgba(251,114,153,0.5);
    }
    .drag-handle:active {
      cursor: grabbing;
    }
    .drag-handle:active span {
      background: rgba(251,114,153,0.7);
    }

    /* ---- 四段胶囊 ---- */
    .capsule-segment {
      width: 40px;
      height: 52px;
      background: rgba(251,114,153,0.03);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      padding-left: 4px;
      padding-right: 4px;
      box-sizing: border-box;
      cursor: pointer;
      user-select: none;
      transition: background 0.2s, color 0.2s;
    }

    .capsule-segment:hover {
      background: rgba(251,114,153,0.10);
    }

    .capsule-segment.active {
      background: rgba(251,114,153,0.30);
    }

    .capsule-segment.has-effect {
      background: #df497f;
    }
    .capsule-segment.has-effect .seg-label {
      color: #fff;
    }
    .capsule-segment.has-effect svg {
      filter: brightness(0) invert(1);
    }
    .capsule-segment.has-effect:hover {
      background: #c93d6e;
    }

    .capsule-segment .seg-icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }

    .capsule-segment .seg-label {
      font-size: 11px;
      color: #f30c5f;
      font-weight: 400;
      letter-spacing: 1px;
      line-height: 1;
    }

    .segment-divider {
      display: none;
    }

    /* ---- 弹出面板 ---- */
    .panel {
      display: none;
      position: absolute;
      left: 43px;
      flex-direction: column;
      gap: 8px;
      padding: 14px;
      background: rgba(255,255,255,0.96);
      border: 0.5px solid rgba(251,114,153,0.18);
      border-left: none;
      border-radius: 0 12px 12px 0;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      width: fit-content;
      box-shadow: 4px 2px 20px rgba(0,0,0,0.08);
      animation: slideRight 0.15s ease-out;
    }

    .panel-title {
      font-size: 12px;
      font-weight: 600;
      color: rgba(251,114,153,0.85);
      margin-bottom: 4px;
    }

    .panel.show {
      display: flex;
    }

    @keyframes slideRight {
      from { opacity: 0; transform: translateX(-8px); }
      to { opacity: 1; transform: translateX(0); }
    }

    /* ---- 按钮组 ---- */
    .btn-grid {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 8px;
    }

    .tool-btn {
      height: 34px;
      min-width: 92px;
      padding: 0 14px;
      border: 1px solid rgba(244,31,107,0.25);
      border-radius: 8px;
      background: rgba(251,114,153,0.06);
      color: #F41F6B;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      white-space: nowrap;
      transition: background 0.15s, color 0.15s;
    }

    .tool-btn:hover {
      background: rgba(251,114,153,0.13);
    }

    .tool-btn.active {
      background: #df497f;
      color: #fff;
    }

    .tool-btn.active:hover {
      background: #c93d6e;
    }

    .tool-btn.active svg {
      stroke: #fff;
    }
    .tool-btn.active svg path[fill]:not([fill="none"]),
    .tool-btn.active svg circle[fill]:not([fill="none"]) {
      fill: #fff;
    }

    /* 单通道反转：图标按通道染色，区分 R/G/B 状态 */
    .tool-btn.active[data-invert-mode="2"] svg { stroke: #FF3B30; }
    .tool-btn.active[data-invert-mode="2"] svg path[fill]:not([fill="none"]),
    .tool-btn.active[data-invert-mode="2"] svg circle[fill]:not([fill="none"]) { fill: #FF3B30; }
    .tool-btn.active[data-invert-mode="3"] svg { stroke: #34C759; }
    .tool-btn.active[data-invert-mode="3"] svg path[fill]:not([fill="none"]),
    .tool-btn.active[data-invert-mode="3"] svg circle[fill]:not([fill="none"]) { fill: #34C759; }
    .tool-btn.active[data-invert-mode="4"] svg { stroke: #4A8CFF; }
    .tool-btn.active[data-invert-mode="4"] svg path[fill]:not([fill="none"]),
    .tool-btn.active[data-invert-mode="4"] svg circle[fill]:not([fill="none"]) { fill: #4A8CFF; }

    .tool-btn.disabled {
      opacity: 0.3;
      cursor: default;
      pointer-events: none;
    }

    /* ---- 偏移 stepper（与 tool-btn 同高同风格的分段控件）---- */
    .offset-stepper {
      display: flex;
      align-items: stretch;
      height: 34px;
      border: 1px solid rgba(244,31,107,0.25);
      border-radius: 8px;
      background: rgba(251,114,153,0.06);
      overflow: hidden;
    }
    .offset-stepper.disabled {
      opacity: 0.3;
      pointer-events: none;
    }
    .offset-stepper-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      border: none;
      background: transparent;
      color: #F41F6B;
      cursor: pointer;
      padding: 0;
      transition: background 0.15s;
    }
    .offset-stepper-btn:hover:not(.disabled) {
      background: rgba(251,114,153,0.13);
    }
    .offset-stepper-btn.disabled {
      opacity: 0.35;
      cursor: default;
    }
    .offset-stepper-value {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 38px;
      padding: 0 4px;
      font-size: 12px;
      color: #F41F6B;
      font-family: inherit;
      border-left: 1px solid rgba(244,31,107,0.18);
      border-right: 1px solid rgba(244,31,107,0.18);
      user-select: none;
    }

    /* ---- 右键菜单 ---- */
    .context-menu {
      display: none;
      position: absolute;
      left: 42px;
      top: 0;
      flex-direction: column;
      background: rgba(255,255,255,0.96);
      border: 0.5px solid rgba(251,114,153,0.18);
      border-radius: 12px;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      box-shadow: 0 4px 20px rgba(0,0,0,0.12);
      padding: 4px;
      z-index: 10;
      min-width: 110px;
      animation: slideRight 0.12s ease-out;
    }
    .context-menu.show {
      display: flex;
    }
    .context-menu-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      font-size: 12px;
      color: #F41F6B;
      cursor: pointer;
      border-radius: 6px;
      white-space: nowrap;
      transition: background 0.12s;
      border: none;
      background: none;
      font-family: inherit;
    }
    .context-menu-item:hover {
      background: rgba(251,114,153,0.12);
    }
    .context-menu-item svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    /* ---- 深色模式 ---- */
    @media (prefers-color-scheme: dark) {
      .capsule-rail {
        background: rgba(30, 20, 25, 0.92);
        box-shadow: 2px 0 12px rgba(0, 0, 0, 0.3);
      }
      .drag-handle {
        background: rgba(251,114,153,0.02);
      }
      .drag-handle span {
        background: rgba(251,114,153,0.2);
      }
      .drag-handle:hover {
        background: rgba(251,114,153,0.05);
      }
      .drag-handle:hover span {
        background: rgba(251,114,153,0.4);
      }
      .capsule-segment {
        background: rgba(251,114,153,0.06);
      }
      .capsule-segment:hover {
        background: rgba(251,114,153,0.14);
      }
      .capsule-segment.active {
        background: rgba(251,114,153,0.25);
      }
      .capsule-segment .seg-label {
        color: rgba(251,114,153,0.85);
      }
      .panel {
        background: rgba(35, 25, 30, 0.95);
        border-color: rgba(251,114,153,0.10);
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35), 0 1px 4px rgba(0, 0, 0, 0.15);
      }
      .panel-title {
        color: rgba(251,114,153,0.55);
      }
      .tool-btn {
        background: rgba(251,114,153,0.06);
        color: rgba(251,114,153,0.5);
      }
      .tool-btn:hover {
        background: rgba(251,114,153,0.10);
      }
      .tool-btn.active {
        background: #fb7299;
        color: #fff;
      }
      .tool-btn.active:hover {
        background: #e5637f;
      }
      .offset-stepper {
        background: rgba(251,114,153,0.06);
        border-color: rgba(251,114,153,0.18);
      }
      .offset-stepper-btn {
        color: rgba(251,114,153,0.7);
      }
      .offset-stepper-btn:hover:not(.disabled) {
        background: rgba(251,114,153,0.10);
      }
      .offset-stepper-value {
        color: rgba(251,114,153,0.7);
        border-color: rgba(251,114,153,0.12);
      }
    }
  `;

  root.EchoBiliToolStyles = Object.freeze({
    getStyles: () => STYLES
  });
})(globalThis);