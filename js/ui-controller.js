/**
 * ui-controller.js — DOM rendering for PixShare
 */
PIX.UI = (function () {
  'use strict';
  var U = PIX.Utils;
  var els = {};

  function init() {
    els.dropZone     = document.getElementById('drop-zone');
    els.fileGrid     = document.getElementById('file-grid');
    els.fileToolbar  = document.getElementById('file-toolbar');
    els.shareArea    = document.getElementById('share-area');
    els.btnShare     = document.getElementById('btn-share');
    els.activeShare  = document.getElementById('active-share');
    els.shareLinkInput = document.getElementById('share-link-input');
    els.btnCopyLink  = document.getElementById('btn-copy-link');
    els.manualPanel  = document.getElementById('manual-signal-panel');
    els.btnManual    = document.getElementById('btn-manual-signal');
    els.manualOffer  = document.getElementById('manual-offer');
    els.manualAnswer = document.getElementById('manual-answer');
    els.transferProg = document.getElementById('transfer-progress');
    els.sendProgBar  = document.getElementById('send-progress-bar');
    els.sendProgText = document.getElementById('send-progress-text');
    els.sendFileName = document.getElementById('send-file-name');
    els.btnAdd       = document.getElementById('btn-add');
    els.btnClear     = document.getElementById('btn-clear');
    // Receiver
    els.recvConnecting = document.getElementById('receiver-connecting');
    els.recvReceiving  = document.getElementById('receiver-receiving');
    els.recvComplete   = document.getElementById('receiver-complete');
    els.recvError      = document.getElementById('receiver-error');
    els.recvImgGrid    = document.getElementById('recv-image-grid');
    els.recvSummary    = document.getElementById('recv-summary');
    els.recvProgBar    = document.getElementById('recv-progress-bar');
    els.recvProgText   = document.getElementById('recv-progress-text');
    els.recvFileName   = document.getElementById('recv-file-name');
    els.connectingId   = document.getElementById('connecting-peer-id');
    els.btnSaveAll     = document.getElementById('btn-save-all');
    els.btnRetry       = document.getElementById('btn-retry');
    els.recvErrorMsg   = document.getElementById('recv-error-msg');
    els.iosHint        = document.getElementById('ios-hint');
    // Header
    els.connText = document.getElementById('conn-text');
    els.connStatus = document.getElementById('connection-status');
    els.toastContainer = document.getElementById('toast-container');
    // Modes
    els.senderMode = document.getElementById('sender-mode');
    els.recvMode = document.getElementById('receiver-mode');
  }

  // ---- Connection Status ----
  function setConnStatus(state, text) {
    els.connStatus.className = 'conn-status ' + state;
    els.connText.textContent = text;
  }

  // ---- Sender: File List ----
  function renderFileGrid(files) {
    if (!files.length) {
      els.dropZone.classList.remove('hidden');
      els.fileGrid.classList.add('hidden');
      els.fileToolbar.classList.add('hidden');
      els.shareArea.classList.add('hidden');
      els.fileGrid.innerHTML = '';
      return;
    }
    els.dropZone.classList.add('hidden');
    els.fileGrid.classList.remove('hidden');
    els.fileToolbar.classList.remove('hidden');
    els.shareArea.classList.remove('hidden');
    els.btnShare.disabled = false;

    var html = '';
    for (var i = 0; i < files.length; i++) {
      var f = files[i], name = escapeHtml(f.displayName || f.file.name);
      html += '<div class="file-card" data-idx="' + i + '">'
        + '<div class="file-card-thumb-wrap" id="thumb-' + i + '">'
        + '<div class="file-card-placeholder">🖼</div></div>'
        + '<button class="file-card-remove" data-idx="' + i + '">✕</button>'
        + '<div class="file-card-info"><div class="file-card-name" title="' + name + '">' + name + '</div>'
        + '<div class="file-card-size">' + U.formatBytes(f.size) + '</div></div></div>';
    }
    els.fileGrid.innerHTML = html;

    // Thumbnails
    for (var j = 0; j < files.length; j++) {
      (function (idx, file) {
        var wrap = document.getElementById('thumb-' + idx);
        if (!wrap) return;
        try {
          var url = URL.createObjectURL(file);
          var img = document.createElement('img');
          img.className = 'file-card-thumb'; img.alt = file.name; img.src = url;
          img.onerror = function () { /* keep placeholder */ };
          wrap.innerHTML = ''; wrap.appendChild(img);
        } catch (e) {}
      })(j, files[j].file);
    }

    // Remove buttons
    els.fileGrid.querySelectorAll('.file-card-remove').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = parseInt(this.getAttribute('data-idx'), 10);
        var evt = new CustomEvent('pix:remove-file', { detail: idx });
        document.dispatchEvent(evt);
      });
    });

    els.btnShare.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> 开始分享（' + files.length + ' 张，' + U.formatBytes(totalSize(files)) + '）';
  }

  function totalSize(files) { var s = 0; for (var i = 0; i < files.length; i++) s += files[i].size; return s; }

  function showActiveShare(peerId) {
    els.btnShare.classList.add('hidden');
    els.activeShare.classList.remove('hidden');
    els.shareLinkInput.value = U.getShareUrl(peerId);
  }

  function showManualSignal(offerText) {
    els.manualPanel.classList.remove('hidden');
    els.manualOffer.value = offerText;
  }

  function getAnswerText() { return els.manualAnswer.value.trim(); }

  // ---- Sender: Progress ----
  function showSendProgress() { els.transferProg.classList.remove('hidden'); }
  function updateSendProgress(pct, fileName) {
    els.sendProgBar.style.width = pct + '%';
    els.sendProgText.textContent = pct + '%';
    if (fileName) els.sendFileName.textContent = fileName;
  }
  function hideSendProgress() { els.transferProg.classList.add('hidden'); }

  // ---- Receiver: States ----
  function showReceiverConnecting(peerId) {
    els.senderMode.classList.add('hidden');
    els.recvMode.classList.remove('hidden');
    els.recvConnecting.classList.remove('hidden');
    els.recvReceiving.classList.add('hidden');
    els.recvComplete.classList.add('hidden');
    els.recvError.classList.add('hidden');
    els.connectingId.textContent = 'Session: ' + peerId;
  }
  function showReceiverReceiving() {
    els.recvConnecting.classList.add('hidden');
    els.recvReceiving.classList.remove('hidden');
  }
  function updateRecvProgress(pct, fileName) {
    els.recvProgBar.style.width = pct + '%';
    els.recvProgText.textContent = pct + '%';
    if (fileName) els.recvFileName.textContent = fileName;
  }
  function showReceiverComplete(images) {
    els.recvReceiving.classList.add('hidden');
    els.recvComplete.classList.remove('hidden');
    els.recvSummary.textContent = '收到 ' + images.length + ' 张图片 · ' + U.formatBytes(totalSize(images));
    // Render grid
    var html = '';
    for (var i = 0; i < images.length; i++) {
      var img = images[i], name = escapeHtml(img.name);
      var url = URL.createObjectURL(img.blob);
      html += '<div class="recv-image-card" data-idx="' + i + '">'
        + '<img src="' + url + '" alt="' + name + '" loading="lazy">'
        + '<div class="card-label">' + name + '</div></div>';
    }
    els.recvImgGrid.innerHTML = html;
    // Click to lightbox
    els.recvImgGrid.querySelectorAll('.recv-image-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var idx = parseInt(this.getAttribute('data-idx'), 10);
        showLightbox(images[idx]);
      });
    });
    if (U.isIOS()) els.iosHint.classList.remove('hidden');
  }
  function showReceiverError(msg) {
    els.recvConnecting.classList.add('hidden');
    els.recvReceiving.classList.add('hidden');
    els.recvError.classList.remove('hidden');
    els.recvErrorMsg.textContent = msg;
  }

  // ---- Lightbox ----
  function showLightbox(img) {
    var lb = document.createElement('div'); lb.className = 'lightbox';
    var el = document.createElement('img'); el.src = URL.createObjectURL(img.blob);
    var btn = document.createElement('button'); btn.className = 'lightbox-close'; btn.textContent = '✕';
    btn.addEventListener('click', function () { document.body.removeChild(lb); });
    lb.appendChild(el); lb.appendChild(btn);
    lb.addEventListener('click', function (e) { if (e.target === lb) document.body.removeChild(lb); });
    document.body.appendChild(lb);
  }

  // ---- Toast ----
  function toast(msg, type) {
    var t = document.createElement('div'); t.className = 'toast ' + (type || '');
    t.textContent = msg; t.setAttribute('role', 'alert');
    els.toastContainer.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }

  // ---- Get received blobs ----
  function getReceivedBlobs() {
    var cards = els.recvImgGrid.querySelectorAll('.recv-image-card');
    var blobs = [];
    cards.forEach(function (c) {
      var img = c.querySelector('img');
      if (img && img.src) {
        var idx = parseInt(c.getAttribute('data-idx'), 10);
        blobs.push({ url: img.src, name: c.querySelector('.card-label').textContent, idx: idx });
      }
    });
    return blobs;
  }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  return {
    init: init,
    setConnStatus: setConnStatus,
    renderFileGrid: renderFileGrid,
    showActiveShare: showActiveShare,
    showManualSignal: showManualSignal,
    getAnswerText: getAnswerText,
    showSendProgress: showSendProgress,
    updateSendProgress: updateSendProgress,
    hideSendProgress: hideSendProgress,
    showReceiverConnecting: showReceiverConnecting,
    showReceiverReceiving: showReceiverReceiving,
    updateRecvProgress: updateRecvProgress,
    showReceiverComplete: showReceiverComplete,
    showReceiverError: showReceiverError,
    showLightbox: showLightbox,
    toast: toast,
    getReceivedBlobs: getReceivedBlobs
  };
})();
