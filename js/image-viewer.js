/**
 * image-viewer.js — Download/save received images
 */
PIX.ImageViewer = (function () {
  'use strict';
  var U = PIX.Utils, UI = PIX.UI;

  function init() {
    document.getElementById('btn-save-all').addEventListener('click', function () {
      var images = PIX.PeerManager.getReceivedImages();
      if (images.length) downloadAll(images);
    });
  }

  function downloadAll(images) {
    if (images.length === 1) {
      downloadSingle(images[0]);
      return;
    }
    if (U.isIOS()) {
      // iOS: download one by one with instructions
      UI.toast('iOS: 请逐张长按照片保存', 'warning');
      for (var i = 0; i < images.length; i++) {
        (function (img) { downloadSingle(img); })(images[i]);
      }
    } else {
      // Android/Desktop: sequential download
      downloadSequentially(images, 0);
    }
  }

  function downloadSingle(image) {
    var url = URL.createObjectURL(image.blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = image.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function downloadSequentially(images, idx) {
    if (idx >= images.length) {
      UI.toast('✅ 全部保存完成！', 'success');
      return;
    }
    downloadSingle(images[idx]);
    setTimeout(function () {
      downloadSequentially(images, idx + 1);
    }, 500);
  }

  return { init: init, downloadAll: downloadAll, downloadSingle: downloadSingle };
})();
