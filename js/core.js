/*
 * Színolló — pixel core.
 * Pure functions + a message-driven processor. Loaded both by the page
 * (<script>) and by the Web Worker (importScripts), so it must not touch the DOM.
 *
 * Distances are CIE76 ΔE in CIELAB, stored as Uint16 in hundredths of a unit:
 *   0      → exactly the reference RGB
 *   1…     → ceil(ΔE × 100), so any non-identical colour is at least 1
 */
(function (root) {
  'use strict';

  var LIN = new Float64Array(256);
  for (var i = 0; i < 256; i++) {
    var c = i / 255;
    LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  var EPS = 216 / 24389;
  var KAP = 24389 / 27;
  var MAX_D = 65535;
  var FEATHER_MAX = 4000; // 40 ΔE at the softest setting

  function lab(r, g, b) {
    var lr = LIN[r], lg = LIN[g], lb = LIN[b];
    var x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
    var y = 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb;
    var z = (0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb) / 1.08883;
    x = x > EPS ? Math.cbrt(x) : (KAP * x + 16) / 116;
    y = y > EPS ? Math.cbrt(y) : (KAP * y + 16) / 116;
    z = z > EPS ? Math.cbrt(z) : (KAP * z + 16) / 116;
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  /**
   * Fill `out` with distances to `ref` for `count` pixels.
   * `pick(i)` is avoided for speed: when xMap/yMap are given the output grid is
   * sampled nearest-neighbour from the source (preview), otherwise 1:1 (full res).
   * Returns the largest distance among non-transparent pixels.
   */
  function distances(src, srcW, ref, out, outW, outH, xMap, yMap, onProgress) {
    var R = ref[0], G = ref[1], B = ref[2];
    var rl = lab(R, G, B), rL = rl[0], rA = rl[1], rB = rl[2];
    var keys = new Int32Array(65536).fill(-1);
    var vals = new Uint16Array(65536);
    var max = 1;
    var i = 0;
    var reportEvery = Math.max(1, (outH / 40) | 0);

    for (var y = 0; y < outH; y++) {
      var rowBase = yMap ? yMap[y] * srcW : y * srcW;
      for (var x = 0; x < outW; x++, i++) {
        var j = (rowBase + (xMap ? xMap[x] : x)) * 4;
        var r = src[j], g = src[j + 1], b = src[j + 2];
        var d;
        if (r === R && g === G && b === B) {
          d = 0;
        } else {
          var key = (r << 16) | (g << 8) | b;
          var h = Math.imul(key, 0x9E3779B1) >>> 16;
          if (keys[h] === key) {
            d = vals[h];
          } else {
            var lr = LIN[r], lg = LIN[g], lb = LIN[b];
            var fx = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
            var fy = 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb;
            var fz = (0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb) / 1.08883;
            fx = fx > EPS ? Math.cbrt(fx) : (KAP * fx + 16) / 116;
            fy = fy > EPS ? Math.cbrt(fy) : (KAP * fy + 16) / 116;
            fz = fz > EPS ? Math.cbrt(fz) : (KAP * fz + 16) / 116;
            var dL = 116 * fy - 16 - rL;
            var dA = 500 * (fx - fy) - rA;
            var dB = 200 * (fy - fz) - rB;
            d = Math.ceil(Math.sqrt(dL * dL + dA * dA + dB * dB) * 100);
            if (d < 1) d = 1;
            else if (d > MAX_D) d = MAX_D;
            keys[h] = key;
            vals[h] = d;
          }
        }
        out[i] = d;
        if (d > max && src[j + 3] !== 0) max = d;
      }
      if (onProgress && y % reportEvery === 0) onProgress(y / outH);
    }
    return max;
  }

  /** Slider position (0…1) → threshold in distance units. 1 means "everything". */
  function threshold(p, maxDist) {
    if (p >= 1) return MAX_D;
    return Math.round(maxDist * p);
  }

  /**
   * distance → alpha lookup table.
   * mode 'keep':   d ≤ T visible, d ≥ T+F hidden, linear ramp between.
   * mode 'remove': the inverse.
   */
  function buildLut(lut, p, soft, mode, maxDist) {
    var T = threshold(p, maxDist);
    var F = Math.round(soft * FEATHER_MAX);
    var invert = mode === 'remove';
    for (var d = 0; d <= MAX_D; d++) {
      var a;
      if (d <= T) a = 255;
      else if (F > 0 && d < T + F) a = Math.round(255 * (1 - (d - T) / F));
      else a = 0;
      lut[d] = invert ? 255 - a : a;
    }
    return lut;
  }

  /** Writes RGB from `rgba` and masked alpha into `out`. Returns visible share 0…1. */
  function applyMask(rgba, dist, lut, out, count) {
    var sum = 0;
    for (var i = 0, o = 0; i < count; i++, o += 4) {
      var m = lut[dist[i]];
      var sa = rgba[o + 3];
      var a = sa === 255 ? m : ((m * sa + 127) / 255) | 0;
      out[o] = rgba[o];
      out[o + 1] = rgba[o + 1];
      out[o + 2] = rgba[o + 2];
      out[o + 3] = a;
      sum += a;
    }
    return count ? sum / (255 * count) : 0;
  }

  function sameRef(a, b) {
    return !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  /**
   * Stateful processor. `post(message, transferList)` sends results back.
   * Messages in:
   *   init    { w, h, src, pw, ph, preview }        (ArrayBuffers)
   *   preview { seq, ref, p, soft, mode, buffer }   buffer is ping-ponged
   *   full    { seq, ref, p, soft, mode }
   */
  function createProcessor(post) {
    var W = 0, H = 0, src = null;
    var PW = 0, PH = 0, prev = null, xMap = null, yMap = null;
    var pDist = null, pRef = null, pMax = 1;
    var fDist = null, fRef = null, fMax = 1;
    var lut = new Uint8Array(MAX_D + 1);

    function init(m) {
      W = m.w; H = m.h; src = new Uint8ClampedArray(m.src);
      PW = m.pw; PH = m.ph; prev = new Uint8ClampedArray(m.preview);
      xMap = new Uint32Array(PW);
      yMap = new Uint32Array(PH);
      for (var x = 0; x < PW; x++) xMap[x] = Math.min(W - 1, Math.floor((x + 0.5) * W / PW));
      for (var y = 0; y < PH; y++) yMap[y] = Math.min(H - 1, Math.floor((y + 0.5) * H / PH));
      pDist = new Uint16Array(PW * PH); pRef = null;
      fDist = null; fRef = null;
      post({ type: 'ready-image', w: W, h: H });
    }

    function preview(m) {
      if (!src) return;
      var out = new Uint8ClampedArray(m.buffer);
      if (!sameRef(pRef, m.ref)) {
        pMax = distances(src, W, m.ref, pDist, PW, PH, xMap, yMap, null);
        pRef = m.ref.slice();
      }
      buildLut(lut, m.p, m.soft, m.mode, pMax);
      var visible = applyMask(prev, pDist, lut, out, PW * PH);
      post({ type: 'preview', seq: m.seq, buffer: out.buffer, visible: visible, maxDist: pMax }, [out.buffer]);
    }

    function full(m) {
      if (!src) return;
      if (!sameRef(fRef, m.ref)) {
        if (!fDist) fDist = new Uint16Array(W * H);
        fMax = distances(src, W, m.ref, fDist, W, H, null, null, function (v) {
          post({ type: 'progress', seq: m.seq, value: v * 0.85 });
        });
        fRef = m.ref.slice();
      }
      // The slider scale is defined on the preview so both views agree on T.
      buildLut(lut, m.p, m.soft, m.mode, pRef && sameRef(pRef, m.ref) ? pMax : fMax);
      var out = new Uint8ClampedArray(W * H * 4);
      applyMask(src, fDist, lut, out, W * H);
      post({ type: 'progress', seq: m.seq, value: 1 });
      post({ type: 'full', seq: m.seq, buffer: out.buffer, w: W, h: H }, [out.buffer]);
    }

    return function handle(m) {
      try {
        if (m.type === 'init') init(m);
        else if (m.type === 'preview') preview(m);
        else if (m.type === 'full') full(m);
      } catch (err) {
        post({ type: 'error', seq: m.seq, request: m.type, message: String(err && err.message || err), buffer: m.buffer }, m.buffer ? [m.buffer] : []);
      }
    };
  }

  root.SzCore = {
    lab: lab,
    distances: distances,
    threshold: threshold,
    buildLut: buildLut,
    applyMask: applyMask,
    createProcessor: createProcessor,
    MAX_D: MAX_D
  };
})(typeof self !== 'undefined' ? self : this);
