/**
 * ui-controller.js — DOM rendering for PixShare (manual SDP version)
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
    els.btnAdd       = document.getElementById('btn-add');
    els.btnClear     = document.getElementById('btn-clear');

    // Sender signal panels
    els.senderStep1  = document.getElementById('sender-step1');
    els.senderConnected = document.getElementById('sender-connected');
    els.transferProg = document.getElementById('transfer-progress');
    els.sendProgBar  = document.getElementById('send-progress-bar');
    els.sendProgText = document.getElementById('send-progress-text');
    els.sendFileName = document.getElementById('send-file-name');

    // Receiver signal panels
    els.recvArea     = document.getElementById('receiver-area');
    els.recvStep1    = document.getElementById('receiver-step1');
    els.recvStep2    = document.getElementById('receiver-step2');
    els.recvReceiving = document.getElementById('receiver-receiving');
    els.recvComplete = document.getElementById('receiver-complete');
    els.recvError    = document.getElementById('receiver-error');
    els.recvImgGrid  = document.getElementById('recv-image-grid');
    els.recvSummary  = document.getElementById('recv-summary');
    els.recvProgBar  = document.getElementById('recv-progress-bar');
    els.recvProgText = document.getElementById('recv-progress-text');
    els.recvFileName = document.getElementById('recv-file-name');
    els.recvErrorMsg = document.getElementById('recv-error-msg');
    els.btnRetry     = document.getElementById('btn-retry');
    els.btnSaveAll   = document.getElementById('btn-save-all');
    els.iosHint      = document.getElementById('ios-hint');

    // Header
    els.connText = document.getElementById('conn-text');
    els.connStatus = document.getElementById('connection-status');
    els.toastContainer = document.getElementById('toast-container');
  }

  function resetAll() {
    els.senderStep1.classList.add('hidden');
    els.senderConnected.classList.add('hidden');
    els.transferProg.classList.add('hidden');
    els.recvStep1.classList.remove('hidden');
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
          var url = URL.createObjectURL(file);
          var img = document.createElement('img');
          img.className = 'file-card-thumb'; img.alt = file.name; img.src = url;
          wrap.innerHTML = ''; wrap.appendChild(img);
        } catch (e) {}
      })(j, files[j].file);
    }

    els.fileGrid.querySelectorAll('.file-card-remove').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = parseInt(this.getAttribute('data-idx'), 10);
        document.dispatchEvent(new CustomEvent('pix:remove-file', { detail: idx }));
      });
    });

    els.btnShare.innerHTML = '📤 生成连接码，发给好友（' + files.length + ' 张）';
  }

  // ---- Sender Steps ----
  function showSenderStep1() {
    els.senderStep1.classList.remove('hidden');
    els.senderConnected.classList.add('hidden');
    els.transferProg.classList.add('hidden');
  }

  function showOfferText(sdp) {
    document.getElementById('sender-offer-text').value = sdp;
  }

  function showSenderConnected() {
    els.senderStep1.style.opacity = '0.4';
    els.senderConnected.classList.remove('hidden');
    els.transferProg.classList.remove('hidden');
  }

  // ---- Sender Progress ----
  function showSendProgress() { els.transferProg.classList.remove('hidden'); }
  function updateSendProgress(pct, fileName) {
    els.sendProgBar.style.width = pct + '%';
    els.sendProgText.textContent = pct + '%';
    if (fileName) els.sendFileName.textContent = fileName;
  }

  // ---- Receiver Steps ----
  function showReceiverStep2() {
    els.recvStep1.classList.add('hidden');
    els.recvStep2.classList.remove('hidden');
    els.recvReceiving.classList.add('hidden');
    els.recvComplete.classList.add('hidden');
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
        var idx = parseInt(this.getAttribute('data-idx'), 10);
        showLightbox(images[idx]);
      });
    });
    if (U.isIOS()) els.iosHint.classList.remove('hidden');
  }

  function showReceiverError(msg) {
    els.recvStep1.classList.add('hidden');
    els.recvStep2.classList.add('hidden');
    els.recvReceiving.classList.add('hidden');
    els.recvError.classList.remove('hidden');
    els.recvErrorMsg.textContent = msg;
  }

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
    init: init, resetAll: resetAll,
    setConnStatus: setConnStatus,
    renderFileGrid: renderFileGrid,
    showSenderStep1: showSenderStep1, showOfferText: showOfferText,
    showSenderConnected: showSenderConnected,
    showSendProgress: showSendProgress, updateSendProgress: updateSendProgress,
    showReceiverStep2: showReceiverStep2, showAnswerText: showAnswerText,
    showReceiverReceiving: showReceiverReceiving, updateRecvProgress: updateRecvProgress,
    showReceiverComplete: showReceiverComplete, showReceiverError: showReceiverError,
    showLightbox: showLightbox, toast: toast
  };
})();
