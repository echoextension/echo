// ECHO bili-tool SVG 资产（提取自 fre/fre-step1.html）
// 供 Dev 直接复用到 bili-tool.js 的 Shadow DOM 中

// ====== 1. 颜色段图标：双矩形交替填充动画 ======
const SVG_COLOR = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
  <rect x="1" y="3" width="10" height="18" rx="2" stroke="#fb7299" stroke-width="0.7">
    <animate attributeName="fill" values="#fb7299;white;#fb7299" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/>
  </rect>
  <rect x="13" y="3" width="10" height="18" rx="2" stroke="#fb7299" stroke-width="0.7">
    <animate attributeName="fill" values="white;#fb7299;white" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/>
  </rect>
</svg>`;

// ====== 2. 旋转段图标：文档框旋转动画 ======
const SVG_ROTATE = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="white" stroke="#fb7299" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round">
  <g>
    <animateTransform attributeName="transform" type="rotate" values="0 12 12;0 12 12;90 12 12;90 12 12;0 12 12" keyTimes="0;0.35;0.5;0.85;1" dur="3s" repeatCount="indefinite"/>
    <rect x="4" y="5" width="16" height="14" rx="2"/>
    <path d="M9 9l6 0"/>
    <path d="M9 13l3 0"/>
  </g>
</svg>`;

// ====== 3. 倍速段图标：双三角闪烁动画 ======
const SVG_SPEED = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="#fb7299" stroke="none">
  <polygon points="4,3 14,12 4,21">
    <animate attributeName="opacity" values="1;0.3;1" dur="3s" repeatCount="indefinite"/>
  </polygon>
  <polygon points="13,6 20,12 13,18">
    <animate attributeName="opacity" values="0.3;1;0.3" dur="3s" repeatCount="indefinite"/>
  </polygon>
</svg>`;

// ====== 4. 重置段图标：B站小电视眨眼 ======
const SVG_RESET = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fb7299" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="2" y="5" width="20" height="14" rx="3" fill="white"/>
  <path d="M8 2L10 5"/><path d="M16 2L14 5"/>
  <ellipse cx="9" cy="11" rx="1.5" ry="1.5" fill="#fb7299" stroke="none">
    <animate attributeName="ry" values="1.5;0.2;1.5" keyTimes="0;0.5;1" dur="3s" repeatCount="indefinite"/>
  </ellipse>
  <ellipse cx="15" cy="11" rx="1.5" ry="1.5" fill="#fb7299" stroke="none">
    <animate attributeName="ry" values="1.5;0.2;1.5" keyTimes="0;0.5;1" dur="3s" repeatCount="indefinite"/>
  </ellipse>
</svg>`;

// ====== 色板（B站粉色系） ======
// 主色：#fb7299（B站品牌粉）
// 胶囊背景（收起态）：rgba(251,114,153,0.12) 或 #2A1520（深色模式）
// 胶囊背景（hover）：rgba(251,114,153,0.20)
// 段高亮（有效果激活）：rgba(251,114,153,0.35)
// 面板背景：rgba(30,20,25,0.95)（深色）/ rgba(255,245,248,0.95)（浅色）
// 按钮默认：rgba(251,114,153,0.08)
// 按钮 hover：rgba(251,114,153,0.15)
// 按钮 active（功能开启）：#fb7299 文字白色
// 文字主色：#fb7299
// 文字副色：rgba(251,114,153,0.6)
// 分割线：rgba(251,114,153,0.15)
