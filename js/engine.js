/*
 * Színolló — bridge between the UI and the pixel processor.
 * Prefers a Web Worker; if one cannot start (e.g. the page was opened via
 * file://) the same processor runs on the main thread.
 */
(function (root) {
  'use strict';

  var worker = null;
  var local = null;
  var ready = false;
  var queue = [];
  var listeners = [];
  var readyWaiters = [];

  function emit(msg) {
    for (var i = 0; i < listeners.length; i++) listeners[i](msg);
  }

  function markReady() {
    if (ready) return;
    ready = true;
    var q = queue; queue = [];
    q.forEach(function (item) { send(item[0], item[1]); });
    readyWaiters.splice(0).forEach(function (fn) { fn(); });
  }

  function useLocal() {
    if (local) return;
    if (worker) { try { worker.terminate(); } catch (e) {} worker = null; }
    local = root.SzCore.createProcessor(function (msg) {
      // Keep the async contract of a real worker.
      setTimeout(function () { emit(msg); }, 0);
    });
    markReady();
  }

  function start() {
    try {
      worker = new Worker('js/worker.js');
    } catch (e) {
      useLocal();
      return;
    }
    worker.onmessage = function (e) {
      if (e.data && e.data.type === 'ready') { markReady(); return; }
      emit(e.data);
    };
    worker.onerror = function () { if (!ready) useLocal(); };
    // A worker that never answers is as good as none.
    setTimeout(function () { if (!ready) useLocal(); }, 2500);
  }

  function send(msg, transfer) {
    if (!ready) { queue.push([msg, transfer]); return; }
    if (worker) worker.postMessage(msg, transfer || []);
    else local(msg);
  }

  root.SzEngine = {
    start: start,
    send: send,
    on: function (fn) { listeners.push(fn); },
    whenReady: function (fn) { if (ready) fn(); else readyWaiters.push(fn); },
    get usesWorker() { return !!worker; }
  };
})(window);
