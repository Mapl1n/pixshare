/**
 * app.js — PixShare entry point
 * Routes between sender and receiver mode based on URL hash.
 */
(function () {
  'use strict';

  function init() {
    PIX.UI.init();
    PIX.FileHandler.init();
    PIX.PeerManager.init();
    PIX.ImageViewer.init();

    // Route based on URL hash
    var hash = window.location.hash.slice(1);
    if (hash && hash.startsWith('px-')) {
      // Receiver mode: hash contains the peer ID
      PIX.PeerManager.joinSession(hash);
    }
    // Otherwise stays in sender mode (default)

    // Register SW
    _registerSW();

    console.log('📸 PixShare ready');
    console.log('  - Mode: ' + (hash ? 'Receiver' : 'Sender'));
    console.log('  - Platform: ' + (PIX.Utils.isIOS() ? 'iOS' : 'Other'));
  }

  function _registerSW() {
    if (!('serviceWorker' in navigator)) return;
    var proto = window.location.protocol;
    if (proto === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
          .then(function (reg) { console.log('SW: registered'); })
          .catch(function () { /* ignore */ });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
