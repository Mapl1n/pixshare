/**
 * sw.js — PixShare Service Worker
 * Strategy: cache JS/CSS/libs aggressively, but NEVER cache HTML (always network-first)
 */
'use strict';
var VERSION = 'v5-' + Date.now();
var CACHE_NAME = 'pixshare-' + VERSION;

// Resources safe to cache (static assets, not HTML)
var PRECACHE = [
  './css/style.css',
  './js/utils.js',
  './js/ui-controller.js',
  './js/file-handler.js',
  './js/peer-manager.js',
  './js/mqtt-relay.js',
  './js/image-viewer.js',
  './js/app.js',
  './lib/mqtt.min.js',
  './manifest.json'
];

// Install: cache static assets
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.allSettled(PRECACHE.map(function (u) {
        return fetch(u, { cache: 'no-cache' }).then(function (r) {
          if (r.ok) return cache.put(u, r);
        }).catch(function () {});
      }));
    })
  );
  self.skipWaiting();
});

// Activate: kill all old caches
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// Fetch: HTML always from network, assets cache-first
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;

  // NEVER cache HTML — always fetch from network to ensure latest version
  if (e.request.mode === 'navigate' || e.request.headers.get('accept') && e.request.headers.get('accept').indexOf('text/html') !== -1) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(e.request, clone); });
        }
        return response;
      });
    })
  );
});
