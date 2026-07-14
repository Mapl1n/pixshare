/**
 * ui-controller.js — DOM rendering for PixShare (QR edition)
 */
PIX.UI = (function () {
  'use strict';
  var U = PIX.Utils;
  var els = {};

  function init() {
    els.dropZone     = document.getElementById('drop-zone');
    els.fileGrid     = document.getElementById('file-grid');
    els.fileToolbar  = document.getElementById('file-toolbar');
    els.btnShare     = document.getElementById('btn-share');

    // Sender
    els.senderStep1  = document.getElementById('sender-step1');
    els.qrContainer  = document.getElementById('qr-container');
    els.senderConnected = document.getElementById('sender-connected');
    els.transferProg = document.getElementById('transfer-progress');
    els.sendProgBar  = document.getElementById('send-progress-bar');
    els.sendProgText = document.getElementById('send-progress-text');
    els.sendFileName = document.getElementById('send-file-name');

    // Receiver
    els.recvStep1    = document.getElementById('receiver-step1');
    els.recvScanArea = document.getElementById('recv-scan-area');
    els.recvStep2    = document.getElementById('receiver-step2');
    els.recvAnswerQR = document.getElementById('recv-answer-qr');
    els.recvReceiving = document.getElementById('receiver-receiving');
    els.recvComplete = document.getElementById('receiver-complete');
    els.recvError    = document.getElementById('receiver-error');
    els.recvErrorMsg = document.getElementById('recv-error-msg');
    els.recvImgGrid  = document.getElementById('recv-image-grid');
    els.recvSummary  = document.getElementById('recv-summary');
    els.recvProgBar  = document.getElementById('recv-progress-bar');
    els.recvProgText = document.getElementById('recv-progress-text');
    els.recvFileName = document.getElementById('recv-file-name');
    els.iosHint      = document.getElementById('ios-hint');

    // Header / toast
    els.connText = document.getElementById('conn-text');
    els.connStatus = document.getElementById('connection-status');
    els.toastContainer = document.getElementById('toast-container');

    // Init scan area
    _initScanArea();
  }

  function _initScanArea() {
    document.getElementById('btn-start-scan').addEventListener('click', function () {
      showScannerArea();
    });
  }

  function resetAll() {
    els.senderStep1.classList.add('hidden');
    els.senderConnected.classList.add('hidden');
    els.transferProg.classList.add('hidden');
    els.recvStep1.classList.remove('hidden');
    els.recvScanArea.classList.add('hidden');
    els.recvStep2.classList.add('hidden');
    els.recvReceiving.classList.add('hidden');
    els.recvComplete.classList.add('hidden');
    els.recvError.classList.add('hidden');
    setConnStatus('disconnected', '未连接');
  }

  // ---- Connection Status ----
  function setConnStatus(state, text) {
    els.connStatus.className = 'conn-status ' + state;
    els.connText.textContent = text;
  }

  // ---- Sender: File Grid ----
  function renderFileGrid(files) {
    if (!files.length) {
      els.dropZone.classList.remove('hidden');
      els.fileGrid.classList.add('hidden');
      els.fileToolbar.classList.add('hidden');
      els.btnShare.classList.add('hidden');
      els.fileGrid.innerHTML = '';
      return;
    }
    els.dropZone.classList.add('hidden');
    els.fileGrid.classList.remove('hidden');
    els.fileToolbar.classList.remove('hidden');
    els.btnShare.classList.remove('hidden');

    var html = '';
    for (var i = 0; i < files.length; i++) {
      var f = files[i], name = escapeHtml(f.displayName || f.file.name);
      html += '<div class="file-card" data-idx="' + i + '">'
        + '<div id="thumb-' + i + '"><div class="file-card-placeholder">🖼</div></div>'
        + '<button class="file-card-remove" data-idx="' + i + '">✕</button>'
        + '<div class="file-card-info"><div class="file-card-name" title="' + name + '">' + name + '</div>'
        + '<div class="file-card-size">' + U.formatBytes(f.size) + '</div></div></div>';
    }
    els.fileGrid.innerHTML = html;

    for (var j = 0; j < files.length; j++) {
      (function (idx, file) {
        var wrap = document.getElementById('thumb-' + idx);
        if (!wrap) return;
        try {
          var img = document.createElement('img');
          img.className = 'file-card-thumb'; img.alt = file.name;
          img.src = URL.createObjectURL(file);
          wrap.innerHTML = ''; wrap.appendChild(img);
        } catch (e) {}
      })(j, files[j].file);
    }

    els.fileGrid.querySelectorAll('.file-card-remove').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('pix:remove-file', { detail: parseInt(this.getAttribute('data-idx'), 10) }));
      });
    });

    els.btnShare.textContent = '📤 生成二维码（' + files.length + ' 张）';
  }

  // ---- Sender: Show QR Code ----
  function showSenderStep1() {
    els.senderStep1.classList.remove('hidden');
    els.senderConnected.classList.add('hidden');
    els.transferProg.classList.add('hidden');
  }

  function showOfferQR(sdp) {
    els.qrContainer.innerHTML = '';
    var ok = PIX.QR.generateQRCode(sdp, els.qrContainer);
    if (!ok) {
      // QR too big — text fallback already visible
      els.qrContainer.innerHTML = '<p style="color:#92400e;text-align:center;padding:16px">QR 码生成失败，请用下方文本连接码</p>';
      document.getElementById('sender-offer-text').value = sdp;
    }
  }

  function showOfferText(sdp) {
    document.getElementById('sender-offer-text').value = sdp;
  }

  function showSenderConnected() {
    els.senderStep1.style.opacity = '0.5';
    els.senderConnected.classList.remove('hidden');
    els.transferProg.classList.remove('hidden');
  }

  // ---- Receiver: Scan ----
  var _scanner = null;

  function showScannerArea() {
    els.recvStep1.classList.add('hidden');
    els.recvScanArea.classList.remove('hidden');
    els.qrContainer.innerHTML = '';

    var container = document.getElementById('scan-container');
    container.innerHTML = '<p style="text-align:center;padding:20px;color:#6b7280">正在启动摄像头...</p>';

    _scanner = PIX.QR.startScanner(
      function (result) {
        // QR detected!
        PIX.QR.stopScanner(_scanner);
        els.recvScanArea.classList.add('hidden');
        // Trigger PeerManager with the scanned SDP
        document.getElementById('recv-offer-input').value = result;
        PIX.PeerManager.receiverStart();
      },
      function (err) {
        PIX.QR.stopScanner(_scanner);
        els.recvScanArea.classList.add('hidden');
        els.recvStep1.classList.remove('hidden');
        toast(err, 'error');
      }
    );

    container.innerHTML = '';
    container.appendChild(_scanner.element);
  }

  // ---- Receiver Steps ----
  function showReceiverStep2() {
    els.recvStep1.classList.add('hidden');
    els.recvScanArea.classList.add('hidden');
    els.recvStep2.classList.remove('hidden');
    els.recvReceiving.classList.add('hidden');
    els.recvComplete.classList.add('hidden');
  }

  function showAnswerQR(sdp) {
    els.recvAnswerQR.innerHTML = '';
    PIX.QR.generateQRCode(sdp, els.recvAnswerQR);
  }

  function showAnswerText(sdp) {
    document.getElementById('recv-answer-text').value = sdp;
  }

  function showReceiverReceiving() {
    els.recvStep2.classList.add('hidden');
    els.recvReceiving.classList.remove('hidden');
    els.recvComplete.classList.add('hidden');
  }

  function updateRecvProgress(pct, fileName) {
    els.recvProgBar.style.width = pct + '%';
    els.recvProgText.textContent = pct + '%';
    if (fileName) els.recvFileName.textContent = fileName;
  }

  function showReceiverComplete(images) {
    els.recvReceiving.classList.add('hidden');
    els.recvComplete.classList.remove('hidden');
    var total = 0;
    for (var i = 0; i < images.length; i++) total += images[i].size;
    els.recvSummary.textContent = '收到 ' + images.length + ' 张图片 · ' + U.formatBytes(total);

    var html = '';
    for (var i = 0; i < images.length; i++) {
      var img = images[i], name = escapeHtml(img.name);
      var url = URL.createObjectURL(img.blob);
      html += '<div class="recv-image-card" data-idx="' + i + '">'
        + '<img src="' + url + '" alt="' + name + '" loading="lazy">'
        + '<div class="card-label">' + name + '</div></div>';
    }
    els.recvImgGrid.innerHTML = html;
    els.recvImgGrid.querySelectorAll('.recv-image-card').forEach(function (card) {
      card.addEventListener('click', function () {
        showLightbox(images[parseInt(this.getAttribute('data-idx'), 10)]);
      });
    });
    if (U.isIOS()) els.iosHint.classList.remove('hidden');
  }

  function showReceiverError(msg) {
    els.recvStep1.classList.add('hidden');
    els.recvScanArea.classList.add('hidden');
    els.recvStep2.classList.add('hidden');
    els.recvReceiving.classList.add('hidden');
    els.recvError.classList.remove('hidden');
    els.recvErrorMsg.textContent = msg;
  }

  // ---- Sender Progress ----
  function showSendProgress() { els.transferProg.classList.remove('hidden'); }
  function updateSendProgress(pct, fileName) {
    els.sendProgBar.style.width = pct + '%';
    els.sendProgText.textContent = pct + '%';
    if (fileName) els.sendFileName.textContent = fileName;
  }

  // ---- Lightbox ----
  function showLightbox(img) {
    var lb = document.createElement('div'); lb.className = 'lightbox';
    var el = document.createElement('img'); el.src = URL.createObjectURL(img.blob);
    var btn = document.createElement('button'); btn.className = 'lightbox-close'; btn.textContent = '✕';
    btn.onclick = function () { document.body.removeChild(lb); };
    lb.appendChild(el); lb.appendChild(btn);
    lb.onclick = function (e) { if (e.target === lb) document.body.removeChild(lb); };
    document.body.appendChild(lb);
  }

  // ---- Toast ----
  function toast(msg, type) {
    var t = document.createElement('div'); t.className = 'toast ' + (type || '');
    t.textContent = msg; t.setAttribute('role', 'alert');
    els.toastContainer.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  return {
    init: init, resetAll: resetAll, setConnStatus: setConnStatus,
    renderFileGrid: renderFileGrid,
    showSenderStep1: showSenderStep1, showOfferQR: showOfferQR, showOfferText: showOfferText,
    showSenderConnected: showSenderConnected,
    showSendProgress: showSendProgress, updateSendProgress: updateSendProgress,
    showScannerArea: showScannerArea,
    showReceiverStep2: showReceiverStep2, showAnswerQR: showAnswerQR, showAnswerText: showAnswerText,
    showReceiverReceiving: showReceiverReceiving, updateRecvProgress: updateRecvProgress,
    showReceiverComplete: showReceiverComplete, showReceiverError: showReceiverError,
    showLightbox: showLightbox, toast: toast
  };
})();
