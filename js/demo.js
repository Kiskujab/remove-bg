/*
 * Színolló — the small working sample on the intro page.
 * A procedurally drawn orange in front of a green backdrop, run through the
 * exact same core as the editor.
 */
(function (root) {
  'use strict';

  var W = 440, H = 520;
  var REF_AT = { x: 262, y: 300 };

  function rand(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function paint(ctx) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#27B052');
    g.addColorStop(1, '#138A3D');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // cast shadow
    ctx.save();
    ctx.translate(232, 418);
    ctx.scale(1, 0.22);
    var sh = ctx.createRadialGradient(0, 0, 10, 0, 0, 150);
    sh.addColorStop(0, 'rgba(6,50,22,.75)');
    sh.addColorStop(1, 'rgba(6,50,22,0)');
    ctx.fillStyle = sh;
    ctx.beginPath(); ctx.arc(0, 0, 150, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // fruit
    var cx = 220, cy = 272, r = 132;
    var fg = ctx.createRadialGradient(cx - 52, cy - 58, 6, cx, cy, r + 6);
    fg.addColorStop(0, '#FFD2A8');
    fg.addColorStop(0.22, '#F59A55');
    fg.addColorStop(0.58, '#DE6429');
    fg.addColorStop(0.88, '#A93F16');
    fg.addColorStop(1, '#7C2C0E');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

    // stem + leaf
    ctx.strokeStyle = '#4A2C17';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(222, 150); ctx.quadraticCurveTo(226, 128, 240, 112); ctx.stroke();
    ctx.save();
    ctx.translate(268, 126);
    ctx.rotate(-0.5);
    ctx.fillStyle = '#2F5E24';
    ctx.beginPath(); ctx.ellipse(0, 0, 38, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // sensor-ish grain so the tolerance has something to chew on
    var img = ctx.getImageData(0, 0, W, H);
    var d = img.data, rnd = rand(7);
    for (var i = 0; i < d.length; i += 4) {
      var n = (rnd() - 0.5) * 10;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    return img;
  }

  function mount(opts) {
    var canvas = opts.canvas;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    var scratch = document.createElement('canvas');
    scratch.width = W; scratch.height = H;
    var src = paint(scratch.getContext('2d', { willReadFrequently: true }));

    var j = (REF_AT.y * W + REF_AT.x) * 4;
    var ref = [src.data[j], src.data[j + 1], src.data[j + 2]];
    var dist = new Uint16Array(W * H);
    var maxDist = root.SzCore.distances(src.data, W, ref, dist, W, H, null, null, null);
    var lut = new Uint8Array(root.SzCore.MAX_D + 1);
    var out = new ImageData(W, H);

    opts.marker.style.left = (REF_AT.x / W * 100) + '%';
    opts.marker.style.top = (REF_AT.y / H * 100) + '%';
    opts.refLabel.textContent = root.SzMedia.hex(ref[0], ref[1], ref[2]);
    opts.refSwatch.style.background = 'rgb(' + ref.join(',') + ')';

    function render(p) {
      root.SzCore.buildLut(lut, p, 0, 'keep', maxDist);
      var visible = root.SzCore.applyMask(src.data, dist, lut, out.data, W * H);
      ctx.putImageData(out, 0, 0);
      opts.valueLabel.textContent = Math.round(p * 100);
      opts.visibleLabel.textContent = Math.round(visible * 100) + '%';
      opts.slider.style.setProperty('--fill', (p * 100) + '%');
    }

    var slider = opts.slider;
    var touched = false;
    slider.addEventListener('input', function () {
      touched = true;
      render(slider.value / 1000);
    });
    render(0);

    return {
      /** One sweep so the page shows what the slider does before anyone touches it. */
      play: function () {
        if (touched) return;
        var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var target = 0.32;
        if (reduce) { slider.value = target * 1000; render(target); return; }
        var t0 = null, dur = 1600;
        function step(t) {
          if (touched) return;
          if (t0 === null) t0 = t;
          var k = Math.min(1, (t - t0) / dur);
          var e = 1 - Math.pow(1 - k, 3);
          var p = e * target;
          slider.value = Math.round(p * 1000);
          render(p);
          if (k < 1) requestAnimationFrame(step);
        }
        setTimeout(function () { requestAnimationFrame(step); }, 450);
      }
    };
  }

  root.SzDemo = { mount: mount };
})(window);
