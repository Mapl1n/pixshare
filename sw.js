/**
 * sw.js — Service Worker for PixShare PWA
 */
'use strict';
var CACHE = 'pixshare-v4';
var SHELL = [
  './', './index.html', './css/style.css',
  './js/app.js', './js/utils.js', './js/file-handler.js',
  './js/ui-controller.js', './js/peer-manager.js', './js/image-viewer.js',
  './manifest.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.allSettled(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      var fetched = fetch(e.request).then(function (r) {
        if (r && r.status === 200) caches.open(CACHE).then(function (c) { c.put(e.request, r.clone()); });
        return r;
      });
      return cached || fetched;
    })
  );
});
