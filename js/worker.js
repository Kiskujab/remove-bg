/* Színolló — background thread for pixel work. */
importScripts('core.js');

var handle = self.SzCore.createProcessor(function (message, transfer) {
  self.postMessage(message, transfer || []);
});

self.onmessage = function (e) { handle(e.data); };
self.postMessage({ type: 'ready' });
