(function(root) {
  'use strict';

  const SVG_COLOR = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
  <rect x="1" y="3" width="10" height="18" rx="2" stroke="#f30c5f" stroke-width="1.2">
    <animate attributeName="fill" values="#f30c5f;white;#f30c5f" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/>
  </rect>
  <rect x="13" y="3" width="10" height="18" rx="2" stroke="#f30c5f" stroke-width="1.2">
    <animate attributeName="fill" values="white;#f30c5f;white" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/>
  </rect>
</svg>`;

  const SVG_ROTATE = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="white" stroke="#f30c5f" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <g>
    <animateTransform attributeName="transform" type="rotate" values="0 12 12;0 12 12;90 12 12;90 12 12;0 12 12" keyTimes="0;0.35;0.5;0.85;1" dur="3s" repeatCount="indefinite"/>
    <rect x="4" y="5" width="16" height="14" rx="2"/>
    <path d="M9 9l6 0"/>
    <path d="M9 13l3 0"/>
  </g>
</svg>`;

  const SVG_SPEED = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="#f30c5f" stroke="none">
  <polygon points="4,3 14,12 4,21">
    <animate attributeName="opacity" values="1;0.3;1" dur="3s" repeatCount="indefinite"/>
  </polygon>
  <polygon points="13,6 20,12 13,18">
    <animate attributeName="opacity" values="0.3;1;0.3" dur="3s" repeatCount="indefinite"/>
  </polygon>
</svg>`;

  const SVG_RESET = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f30c5f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="2" y="5" width="20" height="14" rx="3" fill="white"/>
  <path d="M8 2L10 5"/><path d="M16 2L14 5"/>
  <ellipse cx="9" cy="11" rx="1.5" ry="1.5" fill="#f30c5f" stroke="none">
    <animate attributeName="ry" values="1.5;0.2;1.5" keyTimes="0;0.5;1" dur="3s" repeatCount="indefinite"/>
  </ellipse>
  <ellipse cx="15" cy="11" rx="1.5" ry="1.5" fill="#f30c5f" stroke="none">
    <animate attributeName="ry" values="1.5;0.2;1.5" keyTimes="0;0.5;1" dur="3s" repeatCount="indefinite"/>
  </ellipse>
</svg>`;

  const CHANNEL_SWAPS = Object.freeze([
    { id: 1, label: '红↔绿', title: '红↔绿 通道交换', rows: [0, 1], colors: ['#FF0000', '#00CC00'] },
    { id: 2, label: '绿↔蓝', title: '绿↔蓝 通道交换', rows: [1, 2], colors: ['#00CC00', '#4488FF'] },
    { id: 3, label: '蓝↔红', title: '蓝↔红 通道交换', rows: [2, 0], colors: ['#4488FF', '#FF0000'] }
  ]);

  root.EchoBiliToolAssets = Object.freeze({
    CHANNEL_SWAPS,
    SVG_COLOR,
    SVG_RESET,
    SVG_ROTATE,
    SVG_SPEED
  });
})(globalThis);
