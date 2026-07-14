/**
 * app.js — PixShare entry point (manual SDP, no PeerJS, no URL hash)
 */
(function () {
  'use strict';

  function init() {
    PIX.UI.init();
    PIX.FileHandler.init();
    PIX.PeerManager.init();
    PIX.ImageViewer.init();

    // Register SW
    if ('serviceWorker' in navigator) {
      var proto = window.location.protocol;
      if (proto === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        window.addEventListener('load', function () {
          navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {});
        });
      }
    }

    console.log('📸 PixShare ready (pure WebRTC, no signaling server)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
