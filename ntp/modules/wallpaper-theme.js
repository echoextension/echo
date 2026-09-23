(function(root) {
  'use strict';

  function brightness(red, green, blue) {
    return 0.299 * red + 0.587 * green + 0.114 * blue;
  }

  function create(options) {
    const documentApi = options.document;
    const windowApi = options.window;

    function createSample(image, source, width, height) {
      const canvas = documentApi.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.drawImage(
        image,
        source.x,
        source.y,
        source.width,
        source.height,
        0,
        0,
        width,
        height
      );
      return context.getImageData(0, 0, width, height).data;
    }

    function applyInfoTheme(image) {
      if (!documentApi.getElementById('wallpaperInfoWrapper')) return;
      try {
        const scaleX = image.naturalWidth / windowApi.innerWidth;
        const scaleY = image.naturalHeight / windowApi.innerHeight;
        const data = createSample(image, {
          x: 20 * scaleX,
          y: 50 * scaleY,
          width: 300 * scaleX,
          height: 150 * scaleY
        }, 60, 30);
        let totalRed = 0;
        let totalGreen = 0;
        let totalBlue = 0;
        let totalBrightness = 0;
        const buckets = new Map();
        const pixelCount = data.length / 4;
        for (let index = 0; index < data.length; index += 4) {
          const red = data[index];
          const green = data[index + 1];
          const blue = data[index + 2];
          totalRed += red;
          totalGreen += green;
          totalBlue += blue;
          totalBrightness += brightness(red, green, blue);
          const key = `${Math.floor(red / 32)},${Math.floor(green / 32)},${Math.floor(blue / 32)}`;
          const bucket = buckets.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
          bucket.count += 1;
          bucket.red += red;
          bucket.green += green;
          bucket.blue += blue;
          buckets.set(key, bucket);
        }
        const averageBrightness = totalBrightness / pixelCount;
        let accent = {
          red: Math.round(totalRed / pixelCount),
          green: Math.round(totalGreen / pixelCount),
          blue: Math.round(totalBlue / pixelCount)
        };
        const dominant = [...buckets.values()].sort((left, right) => right.count - left.count)[0];
        if (dominant) {
          accent = {
            red: Math.round(dominant.red / dominant.count),
            green: Math.round(dominant.green / dominant.count),
            blue: Math.round(dominant.blue / dominant.count)
          };
        }
        const maximum = Math.max(accent.red, accent.green, accent.blue);
        const boost = maximum > 0 ? 200 / maximum : 1;
        const red = Math.min(255, Math.round(accent.red * boost * 0.8));
        const green = Math.min(255, Math.round(accent.green * boost * 0.8));
        const blue = Math.min(255, Math.round(accent.blue * boost * 0.8));
        const style = documentApi.documentElement.style;
        style.setProperty('--info-accent', `rgb(${red}, ${green}, ${blue})`);
        style.setProperty('--info-accent-glow', `rgba(${red}, ${green}, ${blue}, 0.6)`);
        const backgroundOpacity = averageBrightness > 140 ? 0.6 : 0.45;
        const accentOpacity = averageBrightness > 140 ? 0.25 : 0.2;
        style.setProperty('--info-bg-gradient', `linear-gradient(to right, rgba(${red}, ${green}, ${blue}, ${accentOpacity}) 0%, rgba(0, 0, 0, ${backgroundOpacity}) 40%, rgba(0, 0, 0, ${backgroundOpacity}) 100%)`);
        style.setProperty('--info-text', 'rgba(255, 255, 255, 0.95)');
        style.setProperty('--info-text-secondary', 'rgba(255, 255, 255, 0.7)');
        if (averageBrightness > 140) {
          style.setProperty('--dot-bg-base', `rgba(${red}, ${green}, ${blue}, 0.5)`);
          style.setProperty('--dot-border', 'rgba(255, 255, 255, 0.6)');
          style.setProperty('--dot-icon', 'rgba(255, 255, 255, 0.85)');
        } else {
          style.setProperty('--dot-bg-base', `rgba(${red}, ${green}, ${blue}, 0.4)`);
          style.setProperty('--dot-border', 'rgba(0, 0, 0, 0.3)');
          style.setProperty('--dot-icon', 'rgba(255, 255, 255, 0.8)');
        }
      } catch (error) {
        console.warn('[ECHO NTP] 无法提取壁纸主题:', error);
      }
    }

    function applyTextTheme(image) {
      const section = documentApi.getElementById('trendingSection');
      if (!section) return;
      try {
        const rectangle = section.getBoundingClientRect();
        const scaleX = image.naturalWidth / windowApi.innerWidth;
        const scaleY = image.naturalHeight / windowApi.innerHeight;
        const data = createSample(image, {
          x: rectangle.left * scaleX,
          y: rectangle.top * scaleY,
          width: rectangle.width * scaleX,
          height: rectangle.height * scaleY
        }, 50, 30);
        let total = 0;
        for (let index = 0; index < data.length; index += 4) {
          total += brightness(data[index], data[index + 1], data[index + 2]);
        }
        const average = total / (data.length / 4);
        documentApi.body.classList.remove('text-dark', 'text-light', 'text-gray');
        documentApi.body.classList.add(average > 170 ? 'text-dark' : average < 85 ? 'text-light' : 'text-gray');
      } catch (error) {
        console.warn('[ECHO NTP] 无法计算壁纸亮度:', error);
        documentApi.body.classList.add('text-dark');
      }
    }

    return Object.freeze({ applyInfoTheme, applyTextTheme });
  }

  root.EchoNtpWallpaperTheme = Object.freeze({ brightness, create });
})(globalThis);
