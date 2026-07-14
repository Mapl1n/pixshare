/**
 * sw.js — Service Worker for PixShare PWA
 * Cache-first for app shell, offline support.
 */
'use strict';

var CACHE = 'pixshare-v1';
var SHELL = [
  './', './index.html', './css/style.css',
  './js/app.js', './js/utils.js', './js/file-handler.js',
  './js/ui-controller.js', './js/peer-manager.js', './js/image-viewer.js',
  './lib/peerjs.min.js', './manifest.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.allSettled(SHELL.map(function (url) {
        return cache.add(url).catch(function () {});
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var fetched = fetch(event.request).then(function (r) {
        if (r && r.status === 200) {
          caches.open(CACHE).then(function (c) { c.put(event.request, r.clone()); });
        }
        return r;
      }).catch(function () {
        if (event.request.mode === 'navigate') return caches.match('./index.html');
      });
      return cached || fetched;
    })
  );
});
