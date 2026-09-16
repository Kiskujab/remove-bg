/*
 * Színolló — UI and flow.
 * Loader → intro → upload → colour → background → rotate → download → done.
 */
(function () {
  'use strict';

  var M = window.SzMedia;
  var E = window.SzEngine;

  var STEPS = ['upload', 'color', 'bg', 'rotate', 'download'];
  var STEP_NAMES = { upload: 'Feltöltés', color: 'Szín', bg: 'Háttér', rotate: 'Forgatás', download: 'Letöltés' };
  var MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
  var IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|ico|svg|heic|heif|tiff?|jxl)$/i;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var coarse = window.matchMedia('(pointer: coarse)').matches;
  var narrow = window.matchMedia('(max-width: 900px)');
  var isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  /** rAF that still fires (via a timer) when the tab is hidden and frames are paused. */
  function onFrame(fn) {
    var done = false, raf = 0, timer = 0;
    function run() {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      fn(performance.now());
    }
    raf = requestAnimationFrame(run);
    timer = setTimeout(run, 80);
  }
  function nextFrame() { return new Promise(function (r) { onFrame(function () { r(); }); }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function normAngle(a) {
    var n = ((a + 180) % 360 + 360) % 360 - 180;
    return n === -180 ? 180 : n;
  }
  function rgbCss(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
  function dims(w, h) { return w + '\u00A0×\u00A0' + h + '\u00A0px'; }

  var el = {};
  [
    'loader', 'loaderFill', 'intro', 'app', 'startBtn', 'homeBtn', 'steps', 'stepsCompact', 'work', 'stage',
    'dropzone', 'dzPhase', 'dzPct', 'dzBar', 'dzFile', 'dzDoneInfo', 'dzErrorTitle', 'dzErrorText', 'dzRetry', 'dzAnother',
    'browseBtn', 'pasteHint', 'fileInput', 'viewer', 'frame', 'view', 'pickMarker', 'stageHint', 'stageHintText',
    'busy', 'busyText', 'busyPct', 'busyBar', 'panel', 'colorTitle', 'refBox', 'refSwatch', 'refHex', 'refHelp',
    'tolSlider', 'tolValue', 'tolEnd', 'visibleBar', 'visibleText', 'softSlider', 'softValue', 'holdOriginal',
    'colorThumb', 'imageThumb', 'hexInput', 'presets', 'bgDrop', 'bgBrowse', 'bgPct', 'bgPhase', 'bgBar', 'bgInfo',
    'bgReplace', 'bgError', 'bgRetry', 'bgInput', 'dial', 'dialTicks', 'dialHand', 'angleOut', 'resetAngle', 'rotSize',
    'webpNote', 'matteBox', 'matteCustom', 'qualityControl', 'qualitySlider', 'qualityValue', 'fileName', 'fileExt',
    'outSize', 'limitNote', 'backBtn', 'nextBtn', 'nextLabel', 'nextIcon', 'done', 'doneName', 'doneMeta',
    'newImageBtn', 'againBtn', 'doneCanvas', 'loupe', 'loupeCanvas', 'loupeLabel', 'dropVeil',
    'demoCanvas', 'demoSlider', 'demoMarker', 'demoRef', 'demoSwatch', 'demoValue', 'demoVisible'
  ].forEach(function (id) { el[id] = $(id); });

  var viewCtx = el.view.getContext('2d');
  var loupeCtx = el.loupeCanvas.getContext('2d');

  var S = {
    booted: false,
    step: 'upload',
    reached: 0,
    transitioning: false,
    loading: false,
    loadToken: 0,

    img: null,
    imgGen: 0,
    baseName: 'kep',

    ref: null,
    refPoint: null,
    mode: 'keep',
    p: 0,
    soft: 0,
    visible: 1,
    showOriginal: false,

    seq: 0,
    genSeq: 0,
    busy: false,
    pending: false,
    previewBuf: null,
    previewReady: false,
    previewCut: document.createElement('canvas'),
    idleWaiters: [],
    initWaiter: null,
    fullWaiter: null,
    fullCut: null,
    fullKey: '',

    bg: { kind: 'none', color: [255, 255, 255], image: null, iw: 0, ih: 0, preview: null },
    bgToken: 0,
    miniState: 'idle',

    angle: 0,
    tween: null,

    format: 'png',
    quality: 92,
    matte: '#FFFFFF',
    exporting: false,
    lastDownload: null,

    displayScale: 1,
    frameKey: '',
    drawQueued: false,
    picking: false
  };
  var previewCtx = S.previewCut.getContext('2d');

  /* ───────────────────────── progress counter ───────────────────────── */

  function Counter(numEl, barEl) {
    var shown = 0, target = 0, scheduled = false, gen = 0, waiters = [];
    function paint() {
      numEl.textContent = Math.floor(shown);
      if (barEl) barEl.style.width = shown + '%';
    }
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      var g = gen;
      onFrame(function () { scheduled = false; if (g === gen) tick(); });
    }
    function tick() {
      var diff = target - shown;
      shown = Math.abs(diff) < 0.5 ? target : shown + Math.max(diff * 0.2, 0.5);
      paint();
      waiters = waiters.filter(function (w) {
        if (shown >= w.v) { w.res(); return false; }
        return true;
      });
      if (shown < target) schedule();
    }
    return {
      set: function (v) {
        target = Math.max(target, clamp(v, 0, 100));
        if (reduceMotion.matches) { shown = target; paint(); tick(); return; }
        schedule();
      },
      reset: function () {
        gen++; scheduled = false; shown = 0; target = 0; waiters = []; paint();
      },
      reach: function (v) {
        return new Promise(function (res) {
          if (shown >= v) res();
          else { waiters.push({ v: v, res: res }); schedule(); }
        });
      }
    };
  }
  var dzCounter = Counter(el.dzPct, el.dzBar);
  var bgCounter = Counter(el.bgPct, el.bgBar);

  /* ───────────────────────── boot ───────────────────────── */

  function boot() {
    requestAnimationFrame(function () { el.loader.classList.add('is-set'); });
    el.loaderFill.style.width = '30%';
    E.start();

    var engineReady = new Promise(function (r) { E.whenReady(r); }).then(function () {
      el.loaderFill.style.width = '70%';
    });
    var fonts = document.fonts && document.fonts.load
      ? Promise.all([
        document.fonts.load('40px "Young Serif"', 'Színolló'),
        document.fonts.load('16px "Schibsted Grotesk"', 'őű'),
        document.fonts.load('13px "Martian Mono"', '0°')
      ]).catch(function () {})
      : Promise.resolve();

    el.pasteHint.textContent = coarse ? '' : 'vagy illeszd be: ' + (isMac ? 'Cmd+V' : 'Ctrl+V');
    if (coarse) {
      // Touch devices have no drag and drop: say what actually happens.
      document.querySelector('.dz-idle .dz-title').innerHTML = 'Válassz<br>egy képet.';
      el.browseBtn.textContent = 'Kép kiválasztása';
      document.querySelector('[data-step="upload"] .step-text').textContent = 'Koppints a mezőre, és válassz a galériából vagy a fájljaid közül. A kép a telefonodon marad, nem tölti fel semmi.';
      document.querySelector('.md-idle p').textContent = 'Válassz háttérképet';
      document.querySelector('.cta-note').hidden = true;
    }
    if (!M.supportsWebp()) el.webpNote.textContent = 'ez a böngésző nem tud WebP-t menteni';

    Promise.race([Promise.all([engineReady, fonts, wait(750)]), wait(3500)])
      .then(function () {
        el.loaderFill.style.width = '100%';
        return wait(reduceMotion.matches ? 0 : 280);
      })
      .then(function () {
        S.booted = true;
        showIntro();
        el.loader.classList.add('is-gone');
        setTimeout(function () { el.loader.hidden = true; }, 420);
      });
  }

  /* ───────────────────────── intro ───────────────────────── */

  var demo = null;
  function showIntro() {
    hideLoupe();
    el.app.hidden = true;
    el.intro.hidden = false;
    el.intro.classList.remove('is-leaving', 'is-in');
    void el.intro.offsetWidth;
    el.intro.classList.add('is-in');
    if (!demo) {
      demo = window.SzDemo.mount({
        canvas: el.demoCanvas, slider: el.demoSlider, marker: el.demoMarker,
        refLabel: el.demoRef, refSwatch: el.demoSwatch, valueLabel: el.demoValue, visibleLabel: el.demoVisible
      });
    }
    demo.play();
    window.scrollTo(0, 0);
  }

  function showApp() {
    if (!el.app.hidden) return;
    var go = function () {
      el.intro.hidden = true;
      el.intro.classList.remove('is-leaving', 'is-in');
      el.app.hidden = false;
      window.scrollTo(0, 0);
      enterStep(S.step, true);
    };
    if (reduceMotion.matches) { go(); return; }
    el.intro.classList.add('is-leaving');
    setTimeout(go, 240);
  }

  /* ───────────────────────── steps ───────────────────────── */

  function canEnter(name) {
    if (name === 'upload') return true;
    if (!S.img || S.loading) return false;
    if (name === 'color') return true;
    return !!S.ref;
  }

  function goStep(name) {
    if (S.transitioning || S.exporting) return Promise.resolve();
    if (name !== 'upload' && !canEnter(name)) return Promise.resolve();
    var needsCut = name === 'bg' || name === 'rotate' || name === 'download';
    if (!needsCut) { enterStep(name); return Promise.resolve(); }

    S.transitioning = true;
    updateActions();
    return previewIdle()
      .then(ensureFullCut)
      .then(function () {
        S.transitioning = false;
        enterStep(name);
      }, function (err) {
        S.transitioning = false;
        updateActions();
        flashStage('A teljes felbontású kivágás nem sikerült. Valószínűleg kevés a memória ehhez a képhez.');
        console.error(err);
      });
  }

  function enterStep(name, force) {
    finishTween();
    var prev = S.step;
    S.step = name;
    if (name !== 'done') S.reached = Math.max(S.reached, STEPS.indexOf(name));
    hideLoupe();

    var isDone = name === 'done';
    el.work.hidden = isDone;
    el.done.hidden = !isDone;
    if (isDone) {
      renderDone();
      updateStepper();
      window.scrollTo(0, 0);
      return;
    }

    $$('.step').forEach(function (s) {
      var on = s.dataset.step === name;
      s.hidden = !on;
      if (on && (force || prev !== name)) {
        s.classList.remove('is-entering');
        void s.offsetWidth;
        s.classList.add('is-entering');
      }
    });

    var upload = name === 'upload';
    el.dropzone.hidden = !upload;
    el.viewer.hidden = upload;
    el.stage.classList.toggle('is-upload', upload);
    el.frame.classList.toggle('is-picking', name === 'color');
    el.frame.classList.toggle('is-bare', name === 'rotate' || name === 'download');
    el.frame.classList.remove('is-checker');
    el.pickMarker.hidden = true;
    el.stageHint.hidden = true;

    if (upload) {
      if (S.loading) setDz('progress');
      else if (S.img) setDz('done');
      else if (el.dropzone.dataset.state !== 'error') setDz('idle');
    }
    if (name === 'color') refreshColorUI();
    if (name === 'bg') refreshBgUI();
    if (name === 'rotate') setAngle(S.angle);
    if (name === 'download') refreshDownloadUI();

    updateStepper();
    updateActions();
    S.frameKey = '';
    drawView();
    el.panel.scrollTop = 0;
    if (narrow.matches && prev !== name) window.scrollTo(0, 0);
  }

  function updateStepper() {
    var cur = STEPS.indexOf(S.step);
    $$('#steps button').forEach(function (b, i) {
      var reachable = i <= S.reached && canEnter(STEPS[i]);
      b.classList.toggle('is-reachable', reachable);
      b.disabled = !reachable || i === cur;
      if (i === cur) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
    el.stepsCompact.textContent = S.step === 'done'
      ? 'Kész'
      : pad2(cur + 1) + ' / 05 · ' + STEP_NAMES[S.step];
  }

  function updateActions() {
    var label = 'Tovább', enabled = false, icon = '#i-arrow-r';
    switch (S.step) {
      case 'upload': label = 'Tovább: szín'; enabled = !!S.img && !S.loading; break;
      case 'color': label = 'Tovább: háttér'; enabled = !!S.ref; break;
      case 'bg': label = 'Tovább: forgatás'; enabled = S.bg.kind !== 'image' || !!S.bg.image; break;
      case 'rotate': label = 'Tovább: letöltés'; enabled = true; break;
      case 'download':
        label = S.exporting ? 'Kódolás…' : 'Letöltés';
        enabled = !S.exporting;
        icon = '#i-download';
        break;
    }
    if (S.transitioning) enabled = false;
    el.nextLabel.textContent = label;
    el.nextBtn.disabled = !enabled;
    el.nextIcon.setAttribute('href', icon);
    el.backBtn.disabled = S.exporting || S.transitioning;
  }

  el.nextBtn.addEventListener('click', function () {
    if (S.step === 'download') { exportImage(); return; }
    var i = STEPS.indexOf(S.step);
    if (i >= 0 && i < STEPS.length - 1) goStep(STEPS[i + 1]);
  });
  el.backBtn.addEventListener('click', function () {
    var i = STEPS.indexOf(S.step);
    if (i <= 0) showIntro();
    else goStep(STEPS[i - 1]);
  });
  $$('#steps button').forEach(function (b) {
    b.addEventListener('click', function () { goStep(b.dataset.go); });
  });
  el.homeBtn.addEventListener('click', showIntro);
  el.startBtn.addEventListener('click', showApp);

  /* ───────────────────────── upload ───────────────────────── */

  function isImageFile(f) {
    return !!f && ((f.type && f.type.indexOf('image/') === 0) || IMAGE_EXT.test(f.name || ''));
  }

  function setDz(state) { el.dropzone.dataset.state = state; }

  function showDzError(title, text) {
    el.dzErrorTitle.textContent = title;
    el.dzErrorText.textContent = text;
    setDz('error');
  }

  function loadMain(file) {
    if (S.loading || S.exporting) return;
    if (S.step !== 'upload') enterStep('upload');

    if (!isImageFile(file)) {
      showDzError('Ez nem képfájl.', 'A Színolló képekkel dolgozik: JPG, PNG, WebP, AVIF vagy GIF. Ha a fájl mégis kép, lehet, hogy hiányzik a kiterjesztése.');
      return;
    }

    var token = ++S.loadToken;
    S.loading = true;
    resetImageState();
    updateActions();
    updateStepper();

    el.dzFile.textContent = file.name + ' · ' + M.formatBytes(file.size);
    el.dzPhase.textContent = 'Fájl beolvasása';
    dzCounter.reset();
    setDz('progress');

    var img;
    M.readWithProgress(file, function (v) { dzCounter.set(v * 70); })
      .then(function (blob) {
        el.dzPhase.textContent = 'Kép kibontása';
        dzCounter.set(74);
        return M.decode(blob).catch(function () {
          var heic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/.test(file.type);
          throw { title: 'Ezt nem tudtam megnyitni.', text: heic
            ? 'Ez HEIC fájl, amit a legtöbb böngésző nem tud kibontani. Mentsd el JPG-ként, vagy nyisd meg az oldalt Safariban.'
            : 'A böngésződ nem tudja kibontani ezt a fájlt. Lehet, hogy sérült, vagy olyan formátum, amit nem ismer.' };
        });
      })
      .then(function (decoded) {
        dzCounter.set(84);
        el.dzPhase.textContent = 'Pixelek előkészítése';
        return dzCounter.reach(76).then(nextFrame).then(function () {
          try {
            img = M.prepare(decoded);
          } catch (e) {
            throw { title: 'Ez a kép túl nagy ennek a böngészőnek.', text: 'Nem jutott elég memória a feldolgozáshoz. Zárj be néhány lapot, vagy próbáld kisebb felbontással.' };
          }
          dzCounter.set(94);
          return initEngine(img);
        });
      })
      .then(function () {
        dzCounter.set(100);
        return dzCounter.reach(100);
      })
      .then(function () {
        if (token !== S.loadToken) return;
        S.img = img;
        S.imgGen++;
        S.baseName = (file.name || 'kep').replace(/\.[^.]+$/, '') || 'kep';
        S.previewCut.width = img.pw;
        S.previewCut.height = img.ph;
        S.loading = false;
        S.reached = 1;
        el.fileName.value = '';

        var info = dims(img.width, img.height) + ' · ' + M.formatBytes(file.size);
        if (img.limited) info += ' — a böngésző vászonkorlátja miatt csökkentve (eredetileg ' + dims(img.originalWidth, img.originalHeight) + ')';
        el.dzDoneInfo.textContent = info;
        setDz('done');
        updateStepper();
        updateActions();
        return wait(img.limited ? 2600 : 850).then(function () {
          if (token === S.loadToken && S.step === 'upload' && S.img === img && !el.app.hidden) goStep('color');
        });
      })
      .catch(function (err) {
        if (token !== S.loadToken) return;
        S.loading = false;
        updateActions();
        updateStepper();
        if (err && err.title) showDzError(err.title, err.text);
        else {
          console.error(err);
          showDzError('Valami elakadt.', 'A kép beolvasása közben hiba történt. Próbáld újra, vagy válassz másik fájlt.');
        }
      });
  }

  function initEngine(img) {
    return new Promise(function (res, rej) {
      S.genSeq = ++S.seq;
      S.busy = false;
      S.pending = false;
      S.previewReady = false;
      S.previewBuf = new ArrayBuffer(img.pw * img.ph * 4);
      S.initWaiter = { res: res, rej: rej };
      var src = img.fullData.data.buffer;
      var prev = img.previewData.data.slice().buffer;
      img.fullData = null;
      E.send({ type: 'init', seq: S.genSeq, w: img.width, h: img.height, src: src, pw: img.pw, ph: img.ph, preview: prev }, [src, prev]);
    });
  }

  function resetImageState() {
    S.img = null;
    S.ref = null;
    S.refPoint = null;
    S.p = 0;
    S.soft = 0;
    S.visible = 1;
    S.previewReady = false;
    if (S.fullCut) { S.fullCut.width = 0; S.fullCut.height = 0; }
    S.fullCut = null;
    S.fullKey = '';
    S.angle = 0;
    S.reached = 0;
    S.lastDownload = null;
    el.tolSlider.value = 0;
    el.softSlider.value = 0;
  }

  el.dropzone.addEventListener('click', function (e) {
    if (el.dropzone.dataset.state === 'idle' && !e.target.closest('button')) el.fileInput.click();
  });
  el.browseBtn.addEventListener('click', function () { el.fileInput.click(); });
  el.dzRetry.addEventListener('click', function () { el.fileInput.click(); });
  el.dzAnother.addEventListener('click', function () { el.fileInput.click(); });
  el.fileInput.addEventListener('change', function () {
    var f = el.fileInput.files && el.fileInput.files[0];
    el.fileInput.value = '';
    if (f) loadMain(f);
  });

  /* ───────────────────────── engine messages ───────────────────────── */

  E.on(function (msg) {
    switch (msg.type) {
      case 'ready-image':
        if (S.initWaiter) { S.initWaiter.res(); S.initWaiter = null; }
        break;
      case 'preview':
        onPreview(msg);
        break;
      case 'progress':
        if (S.fullWaiter && msg.seq === S.fullWaiter.seq) setBusyProgress(msg.value);
        break;
      case 'full':
        if (S.fullWaiter && msg.seq === S.fullWaiter.seq) {
          var w = S.fullWaiter; S.fullWaiter = null; w.res(msg);
        }
        break;
      case 'error':
        if (msg.request === 'init' && S.initWaiter) {
          S.initWaiter.rej({ title: 'Ez a kép túl nagy ennek a böngészőnek.', text: 'A feldolgozó szál nem kapott elég memóriát (' + msg.message + ').' });
          S.initWaiter = null;
        } else if (msg.request === 'full' && S.fullWaiter && msg.seq === S.fullWaiter.seq) {
          var fw = S.fullWaiter; S.fullWaiter = null; fw.rej(new Error(msg.message));
        } else if (msg.request === 'preview') {
          if (msg.seq >= S.genSeq && msg.buffer && msg.buffer.byteLength) S.previewBuf = msg.buffer;
          S.busy = false;
          S.pending = false;
          S.idleWaiters.splice(0).forEach(function (f) { f(); });
          console.error(msg.message);
        }
        break;
    }
  });

  function requestPreview() {
    if (!S.img || !S.ref) return;
    if (S.busy || !S.previewBuf) { S.pending = true; return; }
    S.busy = true;
    S.pending = false;
    var buf = S.previewBuf;
    S.previewBuf = null;
    E.send({ type: 'preview', seq: ++S.seq, ref: S.ref, p: S.p, soft: S.soft, mode: S.mode, buffer: buf }, [buf]);
  }

  function onPreview(msg) {
    if (msg.seq < S.genSeq || !S.img) return;
    var pw = S.img.pw, ph = S.img.ph;
    if (msg.buffer.byteLength === pw * ph * 4) {
      previewCtx.putImageData(new ImageData(new Uint8ClampedArray(msg.buffer), pw, ph), 0, 0);
      S.previewBuf = msg.buffer;
    }
    S.previewReady = true;
    S.busy = false;
    setVisible(msg.visible);
    if (S.step === 'color') scheduleDraw();
    if (S.pending) requestPreview();
    else S.idleWaiters.splice(0).forEach(function (f) { f(); });
  }

  function previewIdle() {
    if (!S.busy && !S.pending) return Promise.resolve();
    return new Promise(function (res) { S.idleWaiters.push(res); });
  }

  function ensureFullCut() {
    var img = S.img;
    var key = [S.imgGen, S.ref.join(','), S.p, S.soft, S.mode].join('|');
    if (S.fullCut && S.fullKey === key) return Promise.resolve();

    showBusy('Kivágás teljes felbontásban');
    return new Promise(function (res, rej) {
      var seq = ++S.seq;
      S.fullWaiter = { seq: seq, res: res, rej: rej };
      E.send({ type: 'full', seq: seq, ref: S.ref, p: S.p, soft: S.soft, mode: S.mode });
    }).then(function (msg) {
      var c = S.fullCut || document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(msg.buffer), img.width, img.height), 0, 0);
      S.fullCut = c;
      S.fullKey = key;
      hideBusy();
    }, function (err) {
      hideBusy();
      throw err;
    });
  }

  var busyTimer = 0;
  function showBusy(text) {
    el.busyText.textContent = text;
    setBusyProgress(0);
    clearTimeout(busyTimer);
    busyTimer = setTimeout(function () { el.busy.hidden = false; }, 160);
  }
  function hideBusy() { clearTimeout(busyTimer); el.busy.hidden = true; }
  function setBusyProgress(v) {
    el.busyPct.textContent = Math.round(v * 100);
    el.busyBar.style.width = (v * 100) + '%';
  }

  var flashTimer = 0;
  function flashStage(text) {
    el.stageHintText.textContent = text;
    el.stageHint.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      if (S.step === 'color') refreshColorUI();
      else el.stageHint.hidden = true;
      scheduleDraw();
    }, 4200);
  }

  /* ───────────────────────── stage drawing ───────────────────────── */

  function scheduleDraw() {
    if (S.drawQueued) return;
    S.drawQueued = true;
    requestAnimationFrame(drawView);
  }

  function drawView() {
    S.drawQueued = false;
    if (!S.img || el.app.hidden || el.viewer.hidden) return;
    if (S.step === 'color') drawColor();
    else if (S.step === 'bg') drawBgStep();
    else if (S.step === 'rotate' || S.step === 'download') drawRotated();
  }

  function sizeView(w, h) {
    if (el.view.width !== w) el.view.width = w;
    if (el.view.height !== h) el.view.height = h;
    var key = w + 'x' + h + '@' + el.viewer.clientWidth + 'x' + el.viewer.clientHeight;
    if (key !== S.frameKey) { S.frameKey = key; fitFrame(w, h); }
  }

  function fitFrame(w, h) {
    var cs = getComputedStyle(el.viewer);
    var aw = el.viewer.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var ah = el.viewer.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    var s = Math.max(0.01, Math.min(aw / w, ah / h, 4));
    el.frame.style.width = Math.max(1, Math.floor(w * s)) + 'px';
    el.frame.style.height = Math.max(1, Math.floor(h * s)) + 'px';
    S.displayScale = s;
  }

  function drawColor() {
    var img = S.img;
    sizeView(img.pw, img.ph);
    el.frame.classList.add('is-checker');
    if (!S.ref || !S.previewReady || S.showOriginal) {
      viewCtx.putImageData(img.previewData, 0, 0);
    } else {
      viewCtx.clearRect(0, 0, img.pw, img.ph);
      viewCtx.drawImage(S.previewCut, 0, 0);
    }
    if (S.refPoint) {
      el.pickMarker.hidden = false;
      el.pickMarker.style.left = (S.refPoint.nx * 100) + '%';
      el.pickMarker.style.top = (S.refPoint.ny * 100) + '%';
    } else {
      el.pickMarker.hidden = true;
    }
  }

  function bgIsTransparent() {
    return S.bg.kind === 'none' || (S.bg.kind === 'image' && !S.bg.image);
  }

  function paintBg(ctx, w, h, checker) {
    var bg = S.bg;
    if (bg.kind === 'color') {
      ctx.fillStyle = rgbCss(bg.color);
      ctx.fillRect(0, 0, w, h);
    } else if (bg.kind === 'image' && bg.preview) {
      M.drawCover(ctx, bg.preview, bg.preview.width, bg.preview.height, w, h);
    } else if (S.step === 'download' && S.format === 'jpg') {
      ctx.fillStyle = S.matte;
      ctx.fillRect(0, 0, w, h);
    } else if (checker) {
      ctx.fillStyle = checkerPattern(ctx);
      ctx.fillRect(0, 0, w, h);
    }
  }

  var patternCache = { cell: 0, pattern: null };
  function checkerPattern(ctx) {
    var cell = Math.max(2, Math.round(8 / S.displayScale));
    if (patternCache.cell !== cell) {
      var c = document.createElement('canvas');
      c.width = c.height = cell * 2;
      var x = c.getContext('2d');
      x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, cell * 2, cell * 2);
      x.fillStyle = '#E3E0D8'; x.fillRect(0, 0, cell, cell); x.fillRect(cell, cell, cell, cell);
      patternCache = { cell: cell, pattern: ctx.createPattern(c, 'repeat') };
    }
    return patternCache.pattern;
  }

  function drawBgStep() {
    var img = S.img;
    sizeView(img.pw, img.ph);
    el.frame.classList.toggle('is-checker', bgIsTransparent());
    viewCtx.clearRect(0, 0, img.pw, img.ph);
    paintBg(viewCtx, img.pw, img.ph, false);
    viewCtx.drawImage(S.previewCut, 0, 0);
  }

  function drawRotated() {
    var img = S.img, pw = img.pw, ph = img.ph;
    var D = Math.ceil(Math.hypot(pw, ph));
    var pad = Math.round(D * 0.05) + 4;
    var size = D + pad * 2;
    sizeView(size, size);
    var ctx = viewCtx;
    var u = 1 / S.displayScale;
    ctx.clearRect(0, 0, size, size);

    var a = S.angle * Math.PI / 180;
    var c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    var bw = pw * c + ph * s, bh = pw * s + ph * c;
    var x0 = (size - bw) / 2, y0 = (size - bh) / 2;

    ctx.save();
    ctx.translate(x0, y0);
    ctx.beginPath(); ctx.rect(0, 0, bw, bh); ctx.clip();
    paintBg(ctx, bw, bh, true);
    ctx.restore();

    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(a);
    ctx.drawImage(S.previewCut, -pw / 2, -ph / 2);
    ctx.restore();

    // crop marks on the export bounds
    var L = 14 * u, g = 6 * u;
    ctx.save();
    ctx.strokeStyle = '#161614';
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    [[x0, y0, -1, -1], [x0 + bw, y0, 1, -1], [x0, y0 + bh, -1, 1], [x0 + bw, y0 + bh, 1, 1]].forEach(function (k) {
      ctx.moveTo(k[0] + k[2] * g, k[1]); ctx.lineTo(k[0] + k[2] * (g + L), k[1]);
      ctx.moveTo(k[0], k[1] + k[3] * g); ctx.lineTo(k[0], k[1] + k[3] * (g + L));
    });
    ctx.stroke();
    ctx.restore();
  }

  if (window.ResizeObserver) {
    new ResizeObserver(function () { S.frameKey = ''; scheduleDraw(); }).observe(el.viewer);
  } else {
    window.addEventListener('resize', function () { S.frameKey = ''; scheduleDraw(); });
  }

  /* ───────────────────────── colour step ───────────────────────── */

  function refreshColorUI() {
    var keep = S.mode === 'keep';
    $$('.seg button').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.mode === S.mode)); });
    el.colorTitle.textContent = (coarse ? 'Koppints a színre, ami ' : 'Kattints a színre, ami ') + (keep ? 'marad' : 'eltűnik');
    el.tolEnd.textContent = keep ? 'minden látszik' : 'minden eltűnik';
    el.stageHintText.textContent = (coarse
      ? 'Koppints a képen arra a színre, amelyik '
      : 'Kattints a képen arra a színre, amelyik ') + (keep ? 'maradjon' : 'tűnjön el');
    el.stageHint.hidden = !!S.ref;

    if (S.ref) {
      el.refBox.dataset.empty = 'false';
      el.refSwatch.style.background = rgbCss(S.ref);
      el.refHex.textContent = M.hex(S.ref[0], S.ref[1], S.ref[2]);
      el.refHelp.textContent = coarse ? 'Másik színhez koppints máshova a képen. Ha lenyomva tartod, nagyító segít célozni.' : 'Másik színhez kattints máshova a képen.';
    } else {
      el.refBox.dataset.empty = 'true';
      el.refSwatch.style.background = '';
      el.refHex.textContent = 'nincs kiválasztva';
      el.refHelp.textContent = coarse ? 'A pipetta a képen van: koppints egy pontra, vagy tartsd lenyomva és húzd a nagyítóval.' : 'A pipetta a képen van: kattints egy pontra.';
    }
    el.tolSlider.disabled = !S.ref;
    el.softSlider.disabled = !S.ref;
    el.holdOriginal.disabled = !S.ref;
    el.tolSlider.value = Math.round(S.p * 1000);
    el.softSlider.value = Math.round(S.soft * 100);
    paintTol();
    paintSoft();
    if (S.ref) setVisible(S.visible);
    else { el.visibleBar.style.width = '0%'; el.visibleText.textContent = 'Még nincs kiválasztott szín'; }
  }

  function paintTol() {
    el.tolValue.textContent = Math.round(S.p * 100);
    el.tolSlider.style.setProperty('--fill', (S.p * 100) + '%');
  }
  function paintSoft() {
    el.softValue.textContent = Math.round(S.soft * 100);
    el.softSlider.style.setProperty('--fill', (S.soft * 100) + '%');
  }

  function setVisible(v) {
    S.visible = v;
    var pct = v * 100;
    el.visibleBar.style.width = pct + '%';
    var text;
    if (pct <= 0) text = 'Semmi nem látszik a képből';
    else if (pct >= 99.95) text = 'A teljes kép látszik';
    else text = 'A kép ' + (pct < 1 ? '1% alatti része' : (pct > 99 ? '99' : Math.round(pct)) + '%-a') + ' látszik';
    el.visibleText.textContent = text;
  }

  function pointToImage(e) {
    var r = el.view.getBoundingClientRect();
    var nx = (e.clientX - r.left) / r.width;
    var ny = (e.clientY - r.top) / r.height;
    if (nx < 0 || ny < 0 || nx >= 1 || ny >= 1) return null;
    return {
      x: Math.min(S.img.width - 1, Math.floor(nx * S.img.width)),
      y: Math.min(S.img.height - 1, Math.floor(ny * S.img.height))
    };
  }

  function sample(x, y) {
    return S.img.fullCtx.getImageData(x, y, 1, 1).data;
  }

  function pick(pt) {
    var d = sample(pt.x, pt.y);
    if (d[3] === 0) {
      flashStage('Ez a pont teljesen átlátszó. Válassz egy látható színt.');
      return;
    }
    S.ref = [d[0], d[1], d[2]];
    S.refPoint = { nx: (pt.x + 0.5) / S.img.width, ny: (pt.y + 0.5) / S.img.height };
    el.pickMarker.classList.remove('is-new');
    void el.pickMarker.offsetWidth;
    el.pickMarker.classList.add('is-new');
    refreshColorUI();
    requestPreview();
    updateActions();
    updateStepper();
    scheduleDraw();
  }

  function updateLoupe(e) {
    var pt = S.img && pointToImage(e);
    if (!pt) { hideLoupe(); return; }
    var N = 11, cell = 12, half = 5;
    var W = S.img.width, H = S.img.height;
    loupeCtx.imageSmoothingEnabled = false;
    loupeCtx.fillStyle = '#FFFFFF';
    loupeCtx.fillRect(0, 0, 132, 132);
    loupeCtx.fillStyle = '#E3E0D8';
    for (var yy = 0; yy < N; yy++) for (var xx = 0; xx < N; xx++) {
      if ((xx + yy) % 2) loupeCtx.fillRect(xx * cell, yy * cell, cell / 2, cell / 2);
    }
    var sx = pt.x - half, sy = pt.y - half;
    var x1 = Math.max(0, sx), y1 = Math.max(0, sy);
    var x2 = Math.min(W, sx + N), y2 = Math.min(H, sy + N);
    if (x2 > x1 && y2 > y1) {
      loupeCtx.drawImage(S.img.fullCanvas, x1, y1, x2 - x1, y2 - y1, (x1 - sx) * cell, (y1 - sy) * cell, (x2 - x1) * cell, (y2 - y1) * cell);
    }
    loupeCtx.lineWidth = 3;
    loupeCtx.strokeStyle = '#161614';
    loupeCtx.strokeRect(half * cell - 1.5, half * cell - 1.5, cell + 3, cell + 3);
    loupeCtx.lineWidth = 1;
    loupeCtx.strokeStyle = '#F0EDE4';
    loupeCtx.strokeRect(half * cell - 0.5, half * cell - 0.5, cell + 1, cell + 1);

    var d = sample(pt.x, pt.y);
    el.loupeLabel.innerHTML = '';
    var chip = document.createElement('i');
    chip.style.background = 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
    el.loupeLabel.appendChild(chip);
    el.loupeLabel.appendChild(document.createTextNode(d[3] === 0 ? 'átlátszó' : M.hex(d[0], d[1], d[2])));

    el.loupe.hidden = false;
    var lw = el.loupe.offsetWidth, lh = el.loupe.offsetHeight;
    var x, y;
    if (e.pointerType === 'mouse') {
      x = e.clientX + 22; y = e.clientY + 22;
      if (x + lw > window.innerWidth - 8) x = e.clientX - 22 - lw;
      if (y + lh > window.innerHeight - 8) y = e.clientY - 22 - lh;
    } else {
      x = e.clientX - lw / 2;
      y = e.clientY - lh - 64;
      if (y < 8) y = e.clientY + 64;
    }
    x = clamp(x, 8, window.innerWidth - lw - 8);
    el.loupe.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }

  function hideLoupe() { el.loupe.hidden = true; }

  el.view.addEventListener('pointerdown', function (e) {
    if (S.step !== 'color' || !S.img || e.button > 0) return;
    e.preventDefault();
    try { el.view.setPointerCapture(e.pointerId); } catch (err) {}
    S.picking = true;
    updateLoupe(e);
  });
  el.view.addEventListener('pointermove', function (e) {
    if (S.step !== 'color' || !S.img) return;
    if (e.pointerType === 'mouse' || S.picking) updateLoupe(e);
  });
  el.view.addEventListener('pointerup', function (e) {
    if (!S.picking) return;
    S.picking = false;
    var pt = pointToImage(e);
    if (pt) pick(pt);
    if (e.pointerType !== 'mouse') hideLoupe();
    else updateLoupe(e);
  });
  el.view.addEventListener('pointercancel', function () { S.picking = false; hideLoupe(); });
  el.view.addEventListener('pointerleave', function (e) {
    if (e.pointerType === 'mouse' && !S.picking) hideLoupe();
  });

  $$('.seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (S.mode === b.dataset.mode) return;
      S.mode = b.dataset.mode;
      refreshColorUI();
      requestPreview();
    });
  });

  el.tolSlider.addEventListener('input', function () {
    S.p = el.tolSlider.value / 1000;
    paintTol();
    requestPreview();
  });
  el.softSlider.addEventListener('input', function () {
    S.soft = el.softSlider.value / 100;
    paintSoft();
    requestPreview();
  });

  function holdOn(e) {
    if (el.holdOriginal.disabled) return;
    if (e && e.preventDefault) e.preventDefault();
    S.showOriginal = true;
    el.holdOriginal.classList.add('is-held');
    scheduleDraw();
  }
  function holdOff() {
    if (!S.showOriginal) return;
    S.showOriginal = false;
    el.holdOriginal.classList.remove('is-held');
    scheduleDraw();
  }
  el.holdOriginal.addEventListener('pointerdown', holdOn);
  ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(function (t) { el.holdOriginal.addEventListener(t, holdOff); });
  el.holdOriginal.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) holdOn(e); });
  el.holdOriginal.addEventListener('keyup', holdOff);
  el.holdOriginal.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ───────────────────────── background step ───────────────────────── */

  var rgbRanges = $$('.rgb-range');

  function refreshBgUI() {
    $$('.choice').forEach(function (c) {
      var on = c.dataset.bg === S.bg.kind;
      c.setAttribute('aria-checked', String(on));
    });
    $$('.choice-detail').forEach(function (d) { d.hidden = d.dataset.for !== S.bg.kind; });
    setBgColor(S.bg.color, null);
    setMini(S.bg.image ? 'done' : (S.miniState === 'progress' ? 'progress' : 'idle'));
  }

  function selectBg(kind) {
    if (S.bg.kind === kind) return;
    S.bg.kind = kind;
    refreshBgUI();
    updateActions();
    scheduleDraw();
  }

  $$('.choice').forEach(function (c) {
    c.addEventListener('click', function () { selectBg(c.dataset.bg); });
    c.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectBg(c.dataset.bg); }
    });
  });

  function setBgColor(rgb, from) {
    S.bg.color = rgb;
    rgbRanges.forEach(function (r, i) {
      if (from !== r) r.value = rgb[i];
      r.nextElementSibling.textContent = rgb[i];
      var a = rgb.slice(), b = rgb.slice();
      a[i] = 0; b[i] = 255;
      r.style.setProperty('--track', 'linear-gradient(to right,' + rgbCss(a) + ',' + rgbCss(b) + ')');
    });
    if (from !== el.hexInput) {
      el.hexInput.value = M.hex(rgb[0], rgb[1], rgb[2]);
      el.hexInput.classList.remove('is-bad');
    }
    el.colorThumb.style.background = rgbCss(rgb);
    scheduleDraw();
  }

  rgbRanges.forEach(function (r) {
    r.addEventListener('input', function () {
      var c = S.bg.color.slice();
      c[+r.dataset.ch] = +r.value;
      setBgColor(c, r);
    });
  });
  el.hexInput.addEventListener('input', function () {
    var c = M.parseHex(el.hexInput.value);
    el.hexInput.classList.toggle('is-bad', !c);
    if (c) setBgColor(c, el.hexInput);
  });
  el.hexInput.addEventListener('blur', function () {
    el.hexInput.value = M.hex(S.bg.color[0], S.bg.color[1], S.bg.color[2]);
    el.hexInput.classList.remove('is-bad');
  });
  $$('#presets button').forEach(function (b) {
    b.addEventListener('click', function () { setBgColor(M.parseHex(b.dataset.hex), null); });
  });

  function setMini(state) {
    S.miniState = state;
    el.bgDrop.dataset.state = state;
  }

  function loadBg(file) {
    selectBg('image');
    if (!isImageFile(file)) {
      el.bgError.textContent = 'Ez nem képfájl.';
      setMini('error');
      return;
    }
    var token = ++S.bgToken;
    bgCounter.reset();
    el.bgPhase.textContent = 'beolvasás';
    setMini('progress');
    updateActions();

    M.readWithProgress(file, function (v) { bgCounter.set(v * 75); })
      .then(function (blob) {
        el.bgPhase.textContent = 'kibontás';
        bgCounter.set(85);
        return M.decode(blob);
      })
      .then(function (dec) {
        if (token !== S.bgToken) return;
        bgCounter.set(100);
        return bgCounter.reach(100).then(function () {
          if (S.bg.image && S.bg.image.close) S.bg.image.close();
          S.bg.image = dec.source;
          S.bg.iw = dec.width;
          S.bg.ih = dec.height;
          S.bg.preview = M.scaledCanvas(dec.source, dec.width, dec.height, 2048);
          var thumb = M.scaledCanvas(dec.source, dec.width, dec.height, 96);
          el.imageThumb.style.backgroundImage = 'url(' + thumb.toDataURL('image/png') + ')';
          el.imageThumb.classList.add('has-image');
          var name = file.name && file.name.length > 26 ? file.name.slice(0, 23) + '…' : (file.name || 'kép');
          el.bgInfo.textContent = name + ' · ' + dims(dec.width, dec.height);
          setMini('done');
          updateActions();
          scheduleDraw();
        });
      })
      .catch(function () {
        if (token !== S.bgToken) return;
        el.bgError.textContent = 'Ezt a fájlt nem tudtam megnyitni. Próbáld JPG-ként vagy PNG-ként.';
        setMini(S.bg.image ? 'done' : 'error');
        if (S.bg.image) flashStage('A háttérképet nem tudtam megnyitni, maradt az előző.');
        updateActions();
      });
  }

  [el.bgBrowse, el.bgReplace, el.bgRetry].forEach(function (b) {
    b.addEventListener('click', function () { el.bgInput.click(); });
  });
  el.bgInput.addEventListener('change', function () {
    var f = el.bgInput.files && el.bgInput.files[0];
    el.bgInput.value = '';
    if (f) loadBg(f);
  });

  /* ───────────────────────── rotate step ───────────────────────── */

  (function buildDial() {
    var NS = 'http://www.w3.org/2000/svg';
    var ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx', 100); ring.setAttribute('cy', 100); ring.setAttribute('r', 80);
    ring.setAttribute('class', 'dial-ring');
    el.dialTicks.appendChild(ring);
    for (var d = 0; d < 360; d += 5) {
      var len = d % 90 === 0 ? 13 : d % 45 === 0 ? 9 : d % 15 === 0 ? 6 : 3;
      var rad = (d - 90) * Math.PI / 180;
      var r1 = 85, r2 = 85 + len;
      var line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', (100 + r1 * Math.cos(rad)).toFixed(2));
      line.setAttribute('y1', (100 + r1 * Math.sin(rad)).toFixed(2));
      line.setAttribute('x2', (100 + r2 * Math.cos(rad)).toFixed(2));
      line.setAttribute('y2', (100 + r2 * Math.sin(rad)).toFixed(2));
      line.setAttribute('class', 'dial-tick' + (d % 90 === 0 ? ' major' : ''));
      el.dialTicks.appendChild(line);
    }
  })();

  function setAngle(v) {
    S.angle = v;
    var shown = normAngle(Math.round(v));
    el.angleOut.textContent = (shown < 0 ? '\u2212' + (-shown) : shown) + '°';
    el.dial.setAttribute('aria-valuenow', shown);
    el.dial.setAttribute('aria-valuetext', shown + ' fok');
    el.dialHand.setAttribute('transform', 'rotate(' + v.toFixed(2) + ' 100 100)');
    if (S.img) {
      var b = M.rotatedBounds(S.img.width, S.img.height, shown);
      el.rotSize.textContent = dims(b.w, b.h);
    }
    scheduleDraw();
  }

  function tweenAngle(to) {
    finishTween();
    var final = normAngle(Math.round(to));
    if (reduceMotion.matches) { setAngle(final); return; }
    var from = S.angle, t0 = performance.now(), dur = 260, id = {};
    S.tween = { id: id, to: final };
    function step(t) {
      if (!S.tween || S.tween.id !== id) return;
      var k = Math.min(1, (t - t0) / dur);
      if (k < 1) {
        setAngle(from + (to - from) * (1 - Math.pow(1 - k, 3)));
        onFrame(step);
      } else {
        S.tween = null;
        setAngle(final);
      }
    }
    onFrame(step);
  }

  /** Jumps an in-flight quarter-turn animation to its end, so nothing reads a half-way angle. */
  function finishTween() {
    if (!S.tween) return;
    var to = S.tween.to;
    S.tween = null;
    setAngle(to);
  }

  function dialPointerAngle(e) {
    var r = el.dial.getBoundingClientRect();
    var x = e.clientX - (r.left + r.width / 2);
    var y = e.clientY - (r.top + r.height / 2);
    return Math.atan2(x, -y) * 180 / Math.PI;
  }

  var drag = null;
  el.dial.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return;
    e.preventDefault();
    finishTween();
    try { el.dial.setPointerCapture(e.pointerId); } catch (err) {}
    el.dial.focus({ preventScroll: true });
    var a = dialPointerAngle(e);
    drag = { last: a, acc: 0, start: normAngle(Math.round(S.angle)) };
  });
  el.dial.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var a = dialPointerAngle(e);
    var delta = a - drag.last;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    drag.last = a;
    drag.acc += delta;
    var raw = drag.start + drag.acc;
    var snap = Math.round(raw / 90) * 90;
    if (Math.abs(raw - snap) <= 2.5) raw = snap;
    setAngle(normAngle(Math.round(raw)));
  });
  ['pointerup', 'pointercancel'].forEach(function (t) {
    el.dial.addEventListener(t, function () { drag = null; });
  });
  el.dial.addEventListener('keydown', function (e) {
    finishTween();
    var cur = normAngle(Math.round(S.angle));
    var step = e.shiftKey ? 15 : 1;
    var next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - step;
    else if (e.key === 'PageUp') next = cur + 90;
    else if (e.key === 'PageDown') next = cur - 90;
    else if (e.key === 'Home') next = 0;
    if (next === null) return;
    e.preventDefault();
    setAngle(normAngle(next));
  });

  $$('[data-quarter]').forEach(function (b) {
    b.addEventListener('click', function () {
      tweenAngle(normAngle(Math.round(S.angle)) + (+b.dataset.quarter));
    });
  });
  $$('[data-nudge]').forEach(function (b) {
    b.addEventListener('click', function () {
      finishTween();
      setAngle(normAngle(Math.round(S.angle) + (+b.dataset.nudge)));
    });
  });
  el.resetAngle.addEventListener('click', function () {
    var cur = normAngle(Math.round(S.angle));
    if (cur !== 0) tweenAngle(0);
  });

  /* ───────────────────────── download step ───────────────────────── */

  function refreshDownloadUI() {
    var webp = M.supportsWebp();
    $$('.format').forEach(function (b) {
      if (b.dataset.format === 'webp') b.disabled = !webp;
    });
    if (!webp && S.format === 'webp') S.format = 'png';
    $$('.format').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.format === S.format)); });

    el.matteBox.hidden = !(S.format === 'jpg' && bgIsTransparent());
    el.qualityControl.hidden = S.format === 'png';
    el.qualitySlider.value = S.quality;
    el.qualityValue.textContent = S.quality;
    el.qualitySlider.style.setProperty('--fill', ((S.quality - 50) / 50 * 100) + '%');
    el.fileExt.textContent = '.' + S.format;
    if (!el.fileName.value) el.fileName.value = S.baseName + '-szinollo';

    $$('.matte-opt[data-matte]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.matte.toUpperCase() === S.matte.toUpperCase()));
    });
    el.matteCustom.parentElement.classList.toggle('is-on', !$$('.matte-opt[data-matte]').some(function (b) {
      return b.dataset.matte.toUpperCase() === S.matte.toUpperCase();
    }));

    var img = S.img;
    if (img) {
      var ang = normAngle(Math.round(S.angle));
      var b = M.rotatedBounds(img.width, img.height, ang);
      var scale = M.fitScale(b.w, b.h);
      var ow = Math.round(b.w * scale), oh = Math.round(b.h * scale);
      el.outSize.textContent = dims(ow, oh) + ' · ' + S.format.toUpperCase();
      var notes = [];
      if (scale < 1) notes.push('A böngésződ ' + dims(b.w, b.h) + '-es vásznat nem tud kezelni, ezért ' + dims(ow, oh) + '-re kicsinyítjük.');
      if (img.limited) notes.push('A képet már betöltéskor csökkenteni kellett: eredetileg ' + dims(img.originalWidth, img.originalHeight) + ' volt.');
      el.limitNote.textContent = notes.join(' ');
      el.limitNote.hidden = !notes.length;
    }
    scheduleDraw();
  }

  $$('.format').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.disabled) return;
      S.format = b.dataset.format;
      refreshDownloadUI();
    });
  });
  el.qualitySlider.addEventListener('input', function () {
    S.quality = +el.qualitySlider.value;
    el.qualityValue.textContent = S.quality;
    el.qualitySlider.style.setProperty('--fill', ((S.quality - 50) / 50 * 100) + '%');
  });
  $$('.matte-opt[data-matte]').forEach(function (b) {
    b.addEventListener('click', function () { S.matte = b.dataset.matte; refreshDownloadUI(); });
  });
  el.matteCustom.addEventListener('input', function () { S.matte = el.matteCustom.value; refreshDownloadUI(); });

  function safeName(s) {
    var n = String(s || '').trim().replace(/[\\/:*?"<>| -]+/g, '-').replace(/[. ]+$/, '').slice(0, 120);
    return n || 'szinollo';
  }

  function exportImage() {
    if (S.exporting || !S.img) return;
    finishTween();
    S.exporting = true;
    updateActions();
    var img = S.img;
    var ang = normAngle(Math.round(S.angle));
    var fmt = S.format;

    nextFrame().then(nextFrame).then(ensureFullCut).then(function () {
      var b = M.rotatedBounds(img.width, img.height, ang);
      var scale = M.fitScale(b.w, b.h);
      var transparent = bgIsTransparent();
      var canvas, temp = false;
      if (ang === 0 && scale === 1 && transparent && fmt !== 'jpg') {
        canvas = S.fullCut;
      } else {
        canvas = M.compose({
          cut: S.fullCut, cw: img.width, ch: img.height, angle: ang, scale: scale,
          bg: { kind: transparent ? 'none' : S.bg.kind, color: rgbCss(S.bg.color), image: S.bg.image, iw: S.bg.iw, ih: S.bg.ih },
          matte: fmt === 'jpg' && transparent ? S.matte : null
        });
        temp = true;
      }
      return M.toBlob(canvas, MIME[fmt], fmt === 'png' ? undefined : S.quality / 100).then(function (blob) {
        var w = canvas.width, h = canvas.height;
        if (temp) { canvas.width = 0; canvas.height = 0; }
        var name = safeName(el.fileName.value) + '.' + fmt;
        M.saveBlob(blob, name);
        S.lastDownload = { name: name, size: blob.size, w: w, h: h, fmt: fmt };
        S.exporting = false;
        enterStep('done');
      });
    }).catch(function (err) {
      console.error(err);
      S.exporting = false;
      updateActions();
      el.limitNote.textContent = 'A mentés nem sikerült, valószínűleg kevés a memória ehhez a mérethez. Zárj be más lapokat, vagy próbáld kisebb elforgatással.';
      el.limitNote.hidden = false;
    });
  }

  /* ───────────────────────── done ───────────────────────── */

  function renderDone() {
    var d = S.lastDownload;
    if (!d || !S.img) return;
    el.doneName.textContent = d.name;
    el.doneMeta.textContent = '· ' + M.formatBytes(d.size).replace(' ', '\u00A0') + ' · ' + dims(d.w, d.h);
    var img = S.img;
    var transparent = bgIsTransparent();
    var c = M.compose({
      cut: S.previewCut, cw: img.pw, ch: img.ph, angle: normAngle(Math.round(S.angle)), scale: 1,
      bg: {
        kind: transparent ? 'none' : S.bg.kind, color: rgbCss(S.bg.color),
        image: S.bg.preview, iw: S.bg.preview ? S.bg.preview.width : 0, ih: S.bg.preview ? S.bg.preview.height : 0
      },
      matte: d.fmt === 'jpg' && transparent ? S.matte : null
    });
    el.doneCanvas.width = c.width;
    el.doneCanvas.height = c.height;
    el.doneCanvas.getContext('2d').drawImage(c, 0, 0);
    c.width = 0;
    el.doneCanvas.classList.toggle('checker', transparent && d.fmt !== 'jpg');
  }

  el.newImageBtn.addEventListener('click', function () {
    resetImageState();
    setDz('idle');
    enterStep('upload');
    el.fileInput.click();
  });
  el.againBtn.addEventListener('click', function () { enterStep('download'); });

  /* ───────────────────────── drag, drop, paste ───────────────────────── */

  var dragDepth = 0;
  var dzBefore = null;

  function hasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    return !!t && Array.prototype.indexOf.call(t, 'Files') !== -1;
  }

  function dropTarget() {
    if (!S.booted || S.exporting) return 'none';
    if (el.app.hidden) return 'veil';
    if (S.step === 'bg' && S.bg.kind === 'image') return 'mini';
    if (S.step === 'upload' && !S.loading) return 'zone';
    return 'veil';
  }

  function dragUI(on) {
    var t = dropTarget();
    if (on) {
      if (t === 'zone') {
        if (el.dropzone.dataset.state !== 'over') dzBefore = el.dropzone.dataset.state;
        setDz('over');
      } else if (t === 'mini') {
        if (S.miniState !== 'progress') el.bgDrop.dataset.state = 'over';
      } else if (t === 'veil') {
        el.dropVeil.hidden = false;
      }
    } else {
      el.dropVeil.hidden = true;
      if (el.dropzone.dataset.state === 'over') setDz(dzBefore || 'idle');
      if (el.bgDrop.dataset.state === 'over') el.bgDrop.dataset.state = S.miniState;
    }
  }

  function firstImage(list) {
    var files = Array.prototype.slice.call(list || []);
    return files.filter(isImageFile)[0] || files[0] || null;
  }

  function route(file) {
    if (!file || !S.booted || S.exporting) return;
    if (el.app.hidden) {
      showApp();
      loadMain(file);
      return;
    }
    if (S.step === 'bg' && S.bg.kind === 'image') { loadBg(file); return; }
    loadMain(file);
  }

  window.addEventListener('dragenter', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (dragDepth++ === 0) dragUI(true);
  });
  window.addEventListener('dragover', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dropTarget() === 'none' ? 'none' : 'copy';
  });
  window.addEventListener('dragleave', function (e) {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dragUI(false);
  });
  window.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dragUI(false);
    route(firstImage(e.dataTransfer.files));
  });
  document.addEventListener('paste', function (e) {
    var files = e.clipboardData && e.clipboardData.files;
    var f = files && files.length ? firstImage(files) : null;
    if (f && isImageFile(f)) {
      e.preventDefault();
      route(f);
    }
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hideLoupe();
  });

  boot();
})();
