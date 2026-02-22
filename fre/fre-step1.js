(function() {
  const cards = document.querySelectorAll('.static-feature-card');
  const iconBoxes = document.querySelectorAll('.feature-icon-box');
  if (iconBoxes.length === 0) return;
  
  let currentIndex = 0;
  let intervalId = null;
  let isHovering = false;
  let currentAnimation = null;
  const bounceInterval = 3500;
  
  // 弹跳关键帧数据：[时间比例, translateY, scaleX, scaleY]
  const keyframes = [
    [0, 0, 1, 1],
    [0.03, 2, 1.05, 0.95],
    [0.10, -18, 0.95, 1.08],
    [0.20, 0, 1.08, 0.92],
    [0.25, 0, 1, 1],
    [0.28, 1, 1.03, 0.97],
    [0.38, -10, 0.97, 1.05],
    [0.50, 0, 1.05, 0.95],
    [0.55, 0, 1, 1],
    [0.60, -5, 0.98, 1.02],
    [0.70, 0, 1.02, 0.98],
    [0.80, 0, 1, 1],
    [1, 0, 1, 1]
  ];
  
  // hover 用的更夸张的弹跳
  const hoverKeyframes = [
    [0, 0, 1, 1],
    [0.03, 3, 1.08, 0.92],
    [0.12, -24, 0.92, 1.12],
    [0.25, 0, 1.1, 0.9],
    [0.32, 0, 1, 1],
    [0.36, 2, 1.05, 0.95],
    [0.48, -14, 0.95, 1.08],
    [0.62, 0, 1.06, 0.94],
    [0.70, 0, 1, 1],
    [0.76, -6, 0.98, 1.03],
    [0.88, 0, 1.02, 0.98],
    [1, 0, 1, 1]
  ];
  
  function interpolate(kf, progress) {
    let i = 0;
    while (i < kf.length - 1 && kf[i + 1][0] <= progress) i++;
    if (i >= kf.length - 1) {
      const last = kf[kf.length - 1];
      return { y: last[1], sx: last[2], sy: last[3] };
    }
    const from = kf[i], to = kf[i + 1];
    const t = (progress - from[0]) / (to[0] - from[0]);
    return {
      y: from[1] + (to[1] - from[1]) * t,
      sx: from[2] + (to[2] - from[2]) * t,
      sy: from[3] + (to[3] - from[3]) * t
    };
  }
  
  function bounceIcon(iconBox, useHoverKeyframes = false) {
    const kf = useHoverKeyframes ? hoverKeyframes : keyframes;
    const duration = useHoverKeyframes ? 1400 : 1200;
    let startTime = null;
    let animationId = {};
    
    function animate(timestamp) {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const { y, sx, sy } = interpolate(kf, progress);
      iconBox.style.transform = `translateY(${y}px) scaleX(${sx}) scaleY(${sy})`;
      
      if (progress < 1) {
        animationId.id = requestAnimationFrame(animate);
      } else {
        iconBox.style.transform = '';
      }
    }
    
    animationId.id = requestAnimationFrame(animate);
    return animationId;
  }
  
  function bounceNext() {
    if (isHovering) return;
    bounceIcon(iconBoxes[currentIndex], false);
    currentIndex = (currentIndex + 1) % iconBoxes.length;
  }
  
  function startAutoPlay() {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(bounceNext, bounceInterval);
  }
  
  function stopAutoPlay() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
  
  // 绑定 hover 事件
  cards.forEach((card, index) => {
    card.addEventListener('mouseenter', () => {
      isHovering = true;
      // 清除所有 icon 的 transform
      iconBoxes.forEach(box => box.style.transform = '');
      // 弹跳当前 hover 的 icon（小跳）
      bounceIcon(iconBoxes[index], false);
    });
    
    card.addEventListener('mouseleave', () => {
      isHovering = false;
      // 自动轮播已移除
    });
  });
  
  // 初始加载：所有图标同时进行一次果冻跳
  setTimeout(() => {
    // 全体跳动 - 使用大跳 (true)，加入轻微错落感 (ripple effect)
    iconBoxes.forEach((box, index) => {
      setTimeout(() => {
        bounceIcon(box, true);
      }, index * 30); // 每个间隔 30ms，形成微波浪，避免太过整齐
    });
    // 自动轮播已移除，仅保留 hover 触发的果冻跳
  }, 500);
})();
