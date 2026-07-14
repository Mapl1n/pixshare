/**
 * app.js — PixShare entry point
 */
(function () {
  'use strict';

  var APP_VERSION = '3.0';

  function init() {
    PIX.UI.init();
    PIX.FileHandler.init();
    PIX.PeerManager.init();
    PIX.ImageViewer.init();
    PIX.Relay.init();

    _registerSW();
    console.log('📸 PixShare v' + APP_VERSION + ' ready (6-digit code)');
  }

  function _registerSW() {
    if (!('serviceWorker' in navigator)) return;

    // FIRST: unregister ALL old service workers immediately
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) {
        reg.unregister().then(function () {
          console.log('Old SW killed:', reg.scope);
        });
      });
    });

    // Only register on https or localhost
    var proto = window.location.protocol;
    if (proto !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return;

    // Wait a moment for unregistration, then register fresh
    setTimeout(function () {
      navigator.serviceWorker.register('./sw.js?v=' + APP_VERSION, { scope: './' })
        .then(function (reg) {
          console.log('SW registered v' + APP_VERSION);

          // If there's a waiting worker (update found), tell user
          reg.addEventListener('updatefound', function () {
            var newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', function () {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New version available — force refresh
                  newWorker.postMessage({ type: 'SKIP_WAITING' });
                  window.location.reload();
                }
              });
            }
          });
        })
        .catch(function (err) {
          console.log('SW register failed (expected on file://):', err.message);
        });
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
