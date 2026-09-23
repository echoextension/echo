(function(root) {
  'use strict';

  const THUMB_WIDTH = 480;
  const THUMB_HEIGHT = 270;
  const DISPLAY_MAX_WIDTH = 3840;
  const DISPLAY_MAX_HEIGHT = 2160;
  const DISPLAY_QUALITY = 0.92;

  function create(options) {
    const documentApi = options.document;
    const ImageConstructor = options.Image;
    const urlApi = options.URL;

    function loadImage(file) {
      return new Promise((resolve, reject) => {
        const image = new ImageConstructor();
        const objectUrl = urlApi.createObjectURL(file);
        image.onload = () => {
          urlApi.revokeObjectURL(objectUrl);
          resolve(image);
        };
        image.onerror = () => {
          urlApi.revokeObjectURL(objectUrl);
          reject(new Error('图片读取失败'));
        };
        image.src = objectUrl;
      });
    }

    function canvasToBlob(canvas, quality, errorMessage) {
      return new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(errorMessage)), 'image/jpeg', quality);
      });
    }

    async function createThumbnail(file) {
      const image = await loadImage(file);
      const canvas = documentApi.createElement('canvas');
      canvas.width = THUMB_WIDTH;
      canvas.height = THUMB_HEIGHT;
      const context = canvas.getContext('2d');
      const sourceRatio = image.naturalWidth / image.naturalHeight;
      const targetRatio = THUMB_WIDTH / THUMB_HEIGHT;
      let sourceX = 0;
      let sourceY = 0;
      let sourceWidth = image.naturalWidth;
      let sourceHeight = image.naturalHeight;
      if (sourceRatio > targetRatio) {
        sourceWidth = image.naturalHeight * targetRatio;
        sourceX = (image.naturalWidth - sourceWidth) / 2;
      } else {
        sourceHeight = image.naturalWidth / targetRatio;
        sourceY = (image.naturalHeight - sourceHeight) / 2;
      }
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        THUMB_WIDTH,
        THUMB_HEIGHT
      );
      return canvasToBlob(canvas, 0.8, '缩略图生成失败');
    }

    function fitDisplaySize(width, height) {
      if (width <= DISPLAY_MAX_WIDTH && height <= DISPLAY_MAX_HEIGHT) return { width, height };
      const scale = Math.min(DISPLAY_MAX_WIDTH / width, DISPLAY_MAX_HEIGHT / height);
      return { width: Math.round(width * scale), height: Math.round(height * scale) };
    }

    function renderDisplayBlob(image) {
      const size = fitDisplaySize(image.naturalWidth, image.naturalHeight);
      const canvas = documentApi.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext('2d').drawImage(image, 0, 0, size.width, size.height);
      return canvasToBlob(canvas, DISPLAY_QUALITY, '壁纸压缩失败');
    }

    async function createDisplayImage(file) {
      return renderDisplayBlob(await loadImage(file));
    }

    return Object.freeze({ createDisplayImage, createThumbnail, fitDisplaySize, renderDisplayBlob });
  }

  root.EchoNtpWallpaperImageProcessor = Object.freeze({
    DISPLAY_MAX_HEIGHT,
    DISPLAY_MAX_WIDTH,
    DISPLAY_QUALITY,
    THUMB_HEIGHT,
    THUMB_WIDTH,
    create
  });
})(globalThis);