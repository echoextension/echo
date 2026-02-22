/**
 * Low Poly Canvas 背景模块 - 共享版本
 * 
 * 支持页面：FRE、NTP、设置页等
 * 
 * 使用方法：
 * 1. 引入此脚本 <script src="../common/lowpoly-bg.js"></script>
 * 2. Canvas 会自动创建并插入到 body 最前面
 * 
 * 可选配置（在引入脚本前设置）：
 * window.LowPolyConfig = {
 *   autoInit: true,      // 是否自动初始化（默认 true）
 *   darkMode: 'auto',    // 深色模式：'auto'|'light'|'dark'
 *   cellSize: 320,       // 网格大小
 *   parallaxX: 30,       // X轴视差强度
 *   parallaxY: 20,       // Y轴视差强度
 * };
 */

(function() {
  'use strict';

  // 用户配置（可在引入脚本前通过 window.LowPolyConfig 覆盖）
  const userConfig = window.LowPolyConfig || {};

  // 默认配置
  const CONFIG = {
    canvasId: 'lowpolyCanvas',
    cellSize: userConfig.cellSize || 320,
    jitterRatio: userConfig.jitterRatio || 0.7,
    parallaxX: userConfig.parallaxX || 30,
    parallaxY: userConfig.parallaxY || 20,
    smoothFactor: userConfig.smoothFactor || 0.08,
    autoInit: userConfig.autoInit !== false,  // 默认自动初始化
    darkMode: userConfig.darkMode || 'auto',  // 'auto' | 'light' | 'dark'
  };

  // 浅色模式渐变配置
  const LIGHT_GRADIENT = {
    colors: [
      { stop: 0, color: '#ffffff' },
      { stop: 0.4, color: 'rgba(240, 245, 255, 0.5)' },
      { stop: 1, color: 'rgba(235, 238, 250, 0.5)' }
    ]
  };

  // 深色模式渐变配置
  const DARK_GRADIENT = {
    colors: [
      { stop: 0, color: '#1a1a2e' },
      { stop: 0.4, color: 'rgba(28, 32, 48, 1)' },
      { stop: 1, color: 'rgba(22, 25, 40, 1)' }
    ]
  };

  // 状态变量
  let canvas, ctx;
  let width, height;
  let triangles = [];
  let mouseX = 0, mouseY = 0;
  let targetX = 0, targetY = 0;
  let gradientAngle = 0;
  let animationId = null;
  let isInitialized = false;
  let isPaused = false;

  /**
   * 检测是否为深色模式
   */
  function isDarkMode() {
    if (CONFIG.darkMode === 'light') return false;
    if (CONFIG.darkMode === 'dark') return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /**
   * 获取当前渐变配置
   */
  function getGradientConfig() {
    return isDarkMode() ? DARK_GRADIENT : LIGHT_GRADIENT;
  }

  /**
   * 初始化 Canvas
   */
  function initCanvas() {
    canvas = document.getElementById(CONFIG.canvasId);
    
    // 如果 Canvas 不存在，自动创建
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = CONFIG.canvasId;
      document.body.insertBefore(canvas, document.body.firstChild);
    }

    // 设置 Canvas 样式
    canvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
      pointer-events: none;
    `;

    ctx = canvas.getContext('2d');
  }

  /**
   * 根据位置获取三角形颜色
   */
  function getColorAt(x, y) {
    const rad = gradientAngle * Math.PI / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const pos = ((x / width) * dx + (y / height) * dy + 1) / 2;
    
    const dark = isDarkMode();
    let r, g, b;
    
    if (dark) {
      // 深色模式：深蓝灰色调
      const colorVariant = Math.random();
      if (colorVariant < 0.3) {
        r = 35 + Math.random() * 15;
        g = 40 + Math.random() * 15;
        b = 60 + Math.random() * 20;
      } else if (colorVariant < 0.6) {
        r = 30 + Math.random() * 15;
        g = 35 + Math.random() * 15;
        b = 55 + Math.random() * 15;
      } else {
        r = 40 + Math.random() * 10;
        g = 42 + Math.random() * 10;
        b = 65 + Math.random() * 15;
      }
      // 深色模式透明度
      const baseAlpha = 0.5 + pos * 0.2;
      const alphaVariation = 0.2;
      const finalAlpha = Math.max(0.4, Math.min(0.8, baseAlpha + (Math.random() - 0.5) * alphaVariation));
      return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${finalAlpha})`;
    } else {
      // 浅色模式：白色/淡蓝色调
      const colorVariant = Math.random();
      if (colorVariant < 0.3) {
        r = 252 + Math.random() * 3;
        g = 253 + Math.random() * 2;
        b = 255;
      } else if (colorVariant < 0.6) {
        r = 252 + Math.random() * 3;
        g = 255;
        b = 254 + Math.random() * 1;
      } else {
        r = 253 + Math.random() * 2;
        g = 252 + Math.random() * 3;
        b = 255;
      }
      // 浅色模式透明度
      const baseAlpha = 0.4 + pos * 0.15;
      const alphaVariation = 0.25;
      const finalAlpha = Math.max(0.3, Math.min(0.7, baseAlpha + (Math.random() - 0.5) * alphaVariation));
      return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${finalAlpha})`;
    }
  }

  /**
   * 生成三角形网格
   */
  function generateTriangles() {
    triangles = [];
    
    const cellSize = CONFIG.cellSize;
    const cols = Math.ceil(width / cellSize) + 2;
    const rows = Math.ceil(height / cellSize) + 2;
    
    const points = [];
    const jitter = cellSize * CONFIG.jitterRatio;
    
    for (let row = -1; row <= rows; row++) {
      for (let col = -1; col <= cols; col++) {
        const x = col * cellSize + (Math.random() - 0.5) * jitter;
        const y = row * cellSize + (Math.random() - 0.5) * jitter;
        points.push({ x, y });
      }
    }
    
    const colCount = cols + 2;
    for (let row = 0; row < rows + 1; row++) {
      for (let col = 0; col < cols + 1; col++) {
        const i = row * colCount + col;
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + colCount];
        const p4 = points[i + colCount + 1];
        
        if (p1 && p2 && p3) {
          const cx1 = (p1.x + p2.x + p3.x) / 3;
          const cy1 = (p1.y + p2.y + p3.y) / 3;
          triangles.push({ points: [p1, p2, p3], color: getColorAt(cx1, cy1) });
        }
        
        if (p2 && p3 && p4) {
          const cx2 = (p2.x + p3.x + p4.x) / 3;
          const cy2 = (p2.y + p3.y + p4.y) / 3;
          triangles.push({ points: [p2, p4, p3], color: getColorAt(cx2, cy2) });
        }
      }
    }
  }

  /**
   * 绘制渐变背景
   */
  function drawGradientBackground() {
    const rad = (gradientAngle - 90) * Math.PI / 180;
    
    const cx = width / 2;
    const cy = height / 2;
    const len = Math.max(width, height);
    
    const x1 = cx - Math.cos(rad) * len;
    const y1 = cy - Math.sin(rad) * len;
    const x2 = cx + Math.cos(rad) * len;
    const y2 = cy + Math.sin(rad) * len;
    
    const gradientConfig = getGradientConfig();
    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    gradientConfig.colors.forEach(c => {
      gradient.addColorStop(c.stop, c.color);
    });
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * 绘制帧
   */
  function draw() {
    if (isPaused) {
      animationId = null;
      return;
    }

    drawGradientBackground();
    
    // 平滑跟随鼠标
    mouseX += (targetX - mouseX) * CONFIG.smoothFactor;
    mouseY += (targetY - mouseY) * CONFIG.smoothFactor;
    
    // 计算视差偏移
    const parallaxX = (mouseX - width / 2) / width * CONFIG.parallaxX;
    const parallaxY = (mouseY - height / 2) / height * CONFIG.parallaxY;
    
    // 绘制所有三角形
    triangles.forEach(tri => {
      ctx.beginPath();
      ctx.moveTo(tri.points[0].x + parallaxX, tri.points[0].y + parallaxY);
      ctx.lineTo(tri.points[1].x + parallaxX, tri.points[1].y + parallaxY);
      ctx.lineTo(tri.points[2].x + parallaxX, tri.points[2].y + parallaxY);
      ctx.closePath();
      
      ctx.fillStyle = tri.color;
      ctx.fill();
    });
    
    animationId = requestAnimationFrame(draw);
  }

  /**
   * 处理窗口大小变化
   */
  function handleResize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    generateTriangles();
  }

  /**
   * 初始化 Low Poly 背景
   */
  function init() {
    if (isInitialized) return;
    
    initCanvas();
    
    // 随机渐变角度
    gradientAngle = Math.random() * 360;
    
    // 设置 Canvas 尺寸
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    
    // 初始鼠标位置在中心
    mouseX = targetX = width / 2;
    mouseY = targetY = height / 2;
    
    // 生成三角形
    generateTriangles();
    
    // 绑定鼠标移动事件
    document.addEventListener('mousemove', (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
    });
    
    // 鼠标离开时回到中心
    document.addEventListener('mouseleave', () => {
      targetX = width / 2;
      targetY = height / 2;
    });
    
    // 窗口大小变化
    window.addEventListener('resize', handleResize);
    
    // 页面可见性变化时暂停/恢复动画
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        pause();
      } else {
        resume();
      }
    });
    
    // 监听深色模式变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (CONFIG.darkMode === 'auto') {
        generateTriangles();
      }
    });
    
    isInitialized = true;
    
    // 开始绘制
    draw();
  }

  /**
   * 暂停动画
   */
  function pause() {
    isPaused = true;
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  /**
   * 恢复动画
   */
  function resume() {
    if (!isInitialized) return;
    isPaused = false;
    if (!animationId) {
      draw();
    }
  }

  /**
   * 显示背景
   */
  function show() {
    if (canvas) {
      canvas.style.opacity = '1';
      canvas.style.transition = 'opacity 0.5s ease';
    }
    resume();
  }

  /**
   * 隐藏背景
   */
  function hide() {
    if (canvas) {
      canvas.style.opacity = '0';
      canvas.style.transition = 'opacity 0.3s ease';
    }
    // 隐藏后暂停动画以节省资源
    setTimeout(pause, 300);
  }

  /**
   * 销毁实例
   */
  function destroy() {
    pause();
    if (canvas && canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }
    canvas = null;
    ctx = null;
    triangles = [];
    isInitialized = false;
  }

  // 自动初始化
  if (CONFIG.autoInit) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  // 暴露到全局
  window.LowPolyBg = {
    init: init,
    regenerate: generateTriangles,
    show: show,
    hide: hide,
    pause: pause,
    resume: resume,
    destroy: destroy,
    config: CONFIG,
    get isInitialized() { return isInitialized; },
    get isPaused() { return isPaused; }
  };

})();
