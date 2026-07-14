/**
 * ui-controller.js — DOM rendering for PixShare (6-digit code edition)
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
    els.senderPanel  = document.getElementById('sender-panel');
    els.senderConnected = document.getElementById('sender-connected');
    els.transferProg = document.getElementById('transfer-progress');
    els.sendProgBar  = document.getElementById('send-progress-bar');
    els.sendProgText = document.getElementById('send-progress-text');
    els.sendFileName = document.getElementById('send-file-name');
    els.senderWait   = document.getElementById('sender-waiting');
    els.senderJoined = document.getElementById('sender-joined');

    // Receiver
    els.recvPanel    = document.getElementById('receiver-panel');
    els.recvWait     = document.getElementById('receiver-waiting');
    els.recvJoined   = document.getElementById('receiver-joined');
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

    // Header
    els.connText = document.getElementById('conn-text');
    els.connStatus = document.getElementById('connection-status');
    els.toastContainer = document.getElementById('toast-container');

  }

  function resetAll() {
    els.senderPanel.classList.add('hidden');
    els.senderWait.classList.add('hidden');
    els.senderJoined.classList.add('hidden');
    els.senderConnected.classList.add('hidden');
    els.transferProg.classList.add('hidden');
    els.recvPanel.classList.remove('hidden');
    els.recvWait.classList.add('hidden');
    els.recvJoined.classList.add('hidden');
    els.recvReceiving.classList.add('hidden');
    els.recvComplete.classList.add('hidden');
    els.recvError.classList.add('hidden');
    setConnStatus('disconnected', '未连接');
    // Clear code inputs
    var sc = document.getElementById('scode'), rc = document.getElementById('rcode');
    if (sc) sc.value = '';
    if (rc) rc.value = '';
  }

  function setConnStatus(state, text) {
    els.connStatus.className = 'conn-status ' + state;
    els.connText.textContent = text;
  }

  // ---- File Grid ----
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

    els.btnShare.textContent = '开始发送（' + files.length + ' 张）';
  }

  // ---- Sender ----
  function showSenderWaiting(code) {
    els.senderPanel.classList.add('hidden');
    els.senderWait.classList.remove('hidden');
    els.senderWait.querySelector('.code-display').textContent = code;
  }

  function showSenderJoined() {
    els.senderWait.classList.add('hidden');
    els.senderJoined.classList.remove('hidden');
  }

  function showSenderConnected() {
    els.senderWait.classList.add('hidden');
    els.senderJoined.classList.add('hidden');
    els.senderConnected.classList.remove('hidden');
    els.transferProg.classList.remove('hidden');
  }

  function showSendProgress() { els.transferProg.classList.remove('hidden'); }
  function updateSendProgress(pct, fn) {
    els.sendProgBar.style.width = pct + '%';
    els.sendProgText.textContent = pct + '%';
    if (fn) els.sendFileName.textContent = fn;
  }

  // ---- Receiver ----
  function showReceiverWaiting(code) {
    els.recvPanel.classList.add('hidden');
    els.recvWait.classList.remove('hidden');
    els.recvJoined.classList.add('hidden');
    els.recvWait.querySelector('.code-display').textContent = code;
  }

  function showReceiverJoined() {
    els.recvWait.classList.add('hidden');
    els.recvJoined.classList.remove('hidden');
  }

  function showReceiverReceiving() {
    els.recvWait.classList.add('hidden');
    els.recvReceiving.classList.remove('hidden');
    els.recvComplete.classList.add('hidden');
  }

  function updateRecvProgress(pct, fn) {
    els.recvProgBar.style.width = pct + '%';
    els.recvProgText.textContent = pct + '%';
    if (fn) els.recvFileName.textContent = fn;
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
      html += '<div class="recv-image-card" data-idx="' + i + '">'
        + '<img src="' + URL.createObjectURL(img.blob) + '" alt="' + name + '" loading="lazy">'
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
    els.recvWait.classList.add('hidden');
    els.recvReceiving.classList.add('hidden');
    els.recvError.classList.remove('hidden');
    els.recvErrorMsg.textContent = msg;
  }

  function showLightbox(img) {
    var lb = document.createElement('div'); lb.className = 'lightbox';
    lb.appendChild(document.createElement('img')).src = URL.createObjectURL(img.blob);
    var btn = document.createElement('button'); btn.className = 'lightbox-close'; btn.textContent = '✕';
    btn.onclick = function () { document.body.removeChild(lb); };
    lb.appendChild(btn);
    lb.onclick = function (e) { if (e.target === lb) document.body.removeChild(lb); };
    document.body.appendChild(lb);
  }

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
    showSenderWaiting: showSenderWaiting, showSenderJoined: showSenderJoined,
    showSenderConnected: showSenderConnected,
    showSendProgress: showSendProgress, updateSendProgress: updateSendProgress,
    showReceiverWaiting: showReceiverWaiting, showReceiverJoined: showReceiverJoined,
    showReceiverReceiving: showReceiverReceiving,
    updateRecvProgress: updateRecvProgress, showReceiverComplete: showReceiverComplete,
    showReceiverError: showReceiverError, showLightbox: showLightbox, toast: toast
  };
})();
