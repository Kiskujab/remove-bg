/*
 * Színolló — files, decoding, canvas limits and export.
 */
(function (root) {
  'use strict';

  var PREVIEW_LONG = 2000;
  var PREVIEW_AREA = 2400000;

  /** Reads a File into a Blob while reporting 0…1. */
  function readWithProgress(file, onProgress) {
    if (file.stream && typeof ReadableStream !== 'undefined') {
      var reader = file.stream().getReader();
      var chunks = [];
      var loaded = 0;
      var total = file.size || 1;
      return (function pump() {
        return reader.read().then(function (res) {
          if (res.done) {
            onProgress(1);
            return new Blob(chunks, { type: file.type });
          }
          chunks.push(res.value);
          loaded += res.value.byteLength;
          onProgress(Math.min(1, loaded / total));
          return pump();
        });
      })();
    }
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      fr.onerror = function () { reject(fr.error); };
      fr.onload = function () { onProgress(1); resolve(new Blob([fr.result], { type: file.type })); };
      fr.readAsArrayBuffer(file);
    });
  }

  /** Decodes to something drawable with width/height, honouring EXIF orientation. */
  function decode(blob) {
    var viaElement = function () {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
          URL.revokeObjectURL(url);
          if (!img.naturalWidth) { reject(new Error('empty')); return; }
          resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
        img.src = url;
      });
    };
    if (typeof createImageBitmap === 'function' && blob.type !== 'image/svg+xml') {
      return createImageBitmap(blob, { imageOrientation: 'from-image' })
        .then(function (bmp) { return { source: bmp, width: bmp.width, height: bmp.height }; })
        .catch(viaElement);
    }
    return viaElement();
  }

  var fitCache = {};
  /** True when the browser can actually back a canvas of this size. */
  function canvasFits(w, h) {
    var key = w + 'x' + h;
    if (key in fitCache) return fitCache[key];
    var ok = false;
    try {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000';
        ctx.fillRect(w - 1, h - 1, 1, 1);
        ok = ctx.getImageData(w - 1, h - 1, 1, 1).data[3] === 255;
      }
      c.width = 0; c.height = 0;
    } catch (e) { ok = false; }
    fitCache[key] = ok;
    return ok;
  }

  /** Largest scale ≤ 1 at which w×h fits the browser's canvas limits. */
  function fitScale(w, h) {
    if (canvasFits(w, h)) return 1;
    var candidates = [];
    // Known ceilings: iOS/Safari 16 777 216 px², most desktops 268 435 456 px², 32 767 px per side.
    [16777216, 268435456].forEach(function (area) {
      candidates.push(Math.sqrt(area / (w * h)) * 0.999);
    });
    candidates.push(32767 / Math.max(w, h));
    candidates.sort(function (a, b) { return b - a; });
    for (var i = 0; i < candidates.length; i++) {
      var s = candidates[i];
      if (s >= 1) continue;
      if (canvasFits(Math.floor(w * s), Math.floor(h * s))) return s;
    }
    var t = 0.5;
    while (t > 0.05) {
      if (canvasFits(Math.floor(w * t), Math.floor(h * t))) return t;
      t *= 0.75;
    }
    return 0.05;
  }

  function previewSize(w, h) {
    var s = Math.min(1, PREVIEW_LONG / Math.max(w, h), Math.sqrt(PREVIEW_AREA / (w * h)));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scale: s };
  }

  /**
   * Turns a decoded image into the working set:
   *  - full-resolution canvas (for exact colour picking and the loupe)
   *  - full RGBA buffer (goes to the worker)
   *  - smoothly downscaled preview RGBA
   */
  function prepare(decoded) {
    var w = decoded.width, h = decoded.height;
    var s = fitScale(w, h);
    var limited = s < 1;
    if (limited) { w = Math.floor(w * s); h = Math.floor(h * s); }

    var full = document.createElement('canvas');
    full.width = w; full.height = h;
    var fctx = full.getContext('2d', { willReadFrequently: true });
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(decoded.source, 0, 0, w, h);
    var fullData = fctx.getImageData(0, 0, w, h);

    var ps = previewSize(w, h);
    var previewData;
    if (ps.w === w && ps.h === h) {
      previewData = new ImageData(new Uint8ClampedArray(fullData.data), w, h);
    } else {
      var pc = document.createElement('canvas');
      pc.width = ps.w; pc.height = ps.h;
      var pctx = pc.getContext('2d');
      pctx.imageSmoothingQuality = 'high';
      pctx.drawImage(full, 0, 0, ps.w, ps.h);
      previewData = pctx.getImageData(0, 0, ps.w, ps.h);
    }

    if (decoded.source.close) decoded.source.close();

    return {
      width: w, height: h,
      originalWidth: decoded.width, originalHeight: decoded.height,
      limited: limited,
      fullCanvas: full,
      fullCtx: fctx,
      fullData: fullData,
      pw: ps.w, ph: ps.h,
      previewData: previewData
    };
  }

  /** Downscaled copy of a background image, used for live previews. */
  function scaledCanvas(source, sw, sh, long) {
    var s = Math.min(1, long / Math.max(sw, sh));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * s));
    c.height = Math.max(1, Math.round(sh * s));
    var ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  /** Axis-aligned bounds of a w×h rectangle rotated by `deg`. */
  function rotatedBounds(w, h, deg) {
    var n = ((deg % 360) + 360) % 360;
    if (n === 0 || n === 180) return { w: w, h: h };
    if (n === 90 || n === 270) return { w: h, h: w };
    var r = deg * Math.PI / 180;
    var c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
    return { w: Math.ceil(w * c + h * s - 1e-6), h: Math.ceil(w * s + h * c - 1e-6) };
  }

  /** Draws `img` so it covers dw×dh completely, centred. */
  function drawCover(ctx, img, iw, ih, dw, dh) {
    var s = Math.max(dw / iw, dh / ih);
    var sw = dw / s, sh = dh / s;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, dw, dh);
  }

  /**
   * Composes background + rotated cut-out on a new canvas.
   * opts: { cut, cw, ch, angle, bg: {kind, color, image, iw, ih}, matte, scale }
   */
  function compose(opts) {
    var b = rotatedBounds(opts.cw, opts.ch, opts.angle);
    var scale = opts.scale || 1;
    var W = Math.max(1, Math.round(b.w * scale));
    var H = Math.max(1, Math.round(b.h * scale));
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';

    if (opts.bg.kind === 'color') {
      ctx.fillStyle = opts.bg.color;
      ctx.fillRect(0, 0, W, H);
    } else if (opts.bg.kind === 'image' && opts.bg.image) {
      drawCover(ctx, opts.bg.image, opts.bg.iw, opts.bg.ih, W, H);
    } else if (opts.matte) {
      ctx.fillStyle = opts.matte;
      ctx.fillRect(0, 0, W, H);
    }

    var right = opts.angle % 90 === 0;
    ctx.imageSmoothingEnabled = !(right && scale === 1);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    if (right) {
      // Exact matrix so quarter turns stay pixel-for-pixel.
      var q = ((opts.angle / 90) % 4 + 4) % 4;
      var cs = [1, 0, -1, 0][q], sn = [0, 1, 0, -1][q];
      ctx.transform(cs, sn, -sn, cs, 0, 0);
    } else {
      ctx.rotate(opts.angle * Math.PI / 180);
    }
    ctx.scale(scale, scale);
    ctx.drawImage(opts.cut, -opts.cw / 2, -opts.ch / 2);
    ctx.restore();
    return c;
  }

  var webpOk = null;
  function supportsWebp() {
    if (webpOk === null) {
      try {
        var c = document.createElement('canvas');
        c.width = c.height = 1;
        webpOk = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
      } catch (e) { webpOk = false; }
    }
    return webpOk;
  }

  function toBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob); else reject(new Error('encode'));
      }, type, quality);
    });
  }

  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
  }

  function hex(r, g, b) {
    return '#' + [r, g, b].map(function (v) { return (v | 0).toString(16).padStart(2, '0'); }).join('').toUpperCase();
  }

  function parseHex(s) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s).trim());
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  root.SzMedia = {
    readWithProgress: readWithProgress,
    decode: decode,
    prepare: prepare,
    fitScale: fitScale,
    scaledCanvas: scaledCanvas,
    rotatedBounds: rotatedBounds,
    drawCover: drawCover,
    compose: compose,
    supportsWebp: supportsWebp,
    toBlob: toBlob,
    saveBlob: saveBlob,
    formatBytes: formatBytes,
    hex: hex,
    parseHex: parseHex
  };
})(window);
