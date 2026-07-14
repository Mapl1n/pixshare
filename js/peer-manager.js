/**
 * peer-manager.js — Pure WebRTC + QR code exchange
 * Offer SDP is encoded as a QR code. Answer SDP is encoded as a QR code.
 *
 * Flow: Sender shows QR → Receiver scans → processes Offer → shows Answer QR
 *       → Sender scans Answer QR → P2P established → files transfer
 */
PIX.PeerManager = (function () {
  'use strict';
  var U = PIX.Utils, UI = PIX.UI;

  var _pc = null, _dc = null;
  var _isSender = false;
  var _pendingFiles = null;
  var _receivedImages = [];
  var _transferComplete = false;

  var ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  var CHUNK_SIZE = 16 * 1024;

  // ---- Init ----
  function init() {
    // Sender buttons
    document.getElementById('btn-share').addEventListener('click', senderStart);
    document.getElementById('btn-copy-offer').addEventListener('click', copyOfferFallback);
    document.getElementById('btn-paste-answer').addEventListener('click', senderProcessAnswer);
    document.getElementById('btn-scan-answer').addEventListener('click', senderScanAnswer);

    // Receiver buttons
    document.getElementById('btn-recv-start').addEventListener('click', receiverStart);
    document.getElementById('btn-copy-answer').addEventListener('click', copyAnswerFallback);
    document.getElementById('btn-retry').addEventListener('click', function () { UI.resetAll(); });
  }

  // ================================================================
  //  SENDER
  // ================================================================
  function senderStart() {
    var files = PIX.FileHandler.getFiles();
    if (!files.length) { UI.toast('请先选择图片', 'warning'); return; }

    _isSender = true;
    _pendingFiles = files;
    _transferComplete = false;

    UI.showSenderStep1();

    _pc = new RTCPeerConnection(ICE_SERVERS);
    _dc = _pc.createDataChannel('pixshare', { ordered: true });
    _setupDataChannel(_dc, files);

    _pc.onicecandidate = function (e) {};

    _pc.createOffer().then(function (offer) {
      return _pc.setLocalDescription(offer);
    }).then(function () {
      return _waitForIce(_pc, 2500);
    }).then(function () {
      var fullSDP = JSON.stringify({ sdp: _pc.localDescription.sdp, type: _pc.localDescription.type });
      var compressed = PIX.QR.compressSDP(fullSDP);
      UI.showOfferQR(compressed);
      // Also store text fallback
      UI.showOfferText(compressed);
      UI.toast('📱 请好友用 PixShare 扫码连接', 'success');
    }).catch(function (err) {
      console.error('Create offer failed:', err);
      UI.toast('创建连接失败: ' + err.message, 'error');
    });

    _pc.oniceconnectionstatechange = function () {
      if (_pc.iceConnectionState === 'connected' || _pc.iceConnectionState === 'completed') {
        UI.setConnStatus('connected', '已连接 ✅');
      }
    };
  }

  function senderScanAnswer() {
    // Reuse QR scanner
    var container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '0'; container.style.left = '0';
    container.style.width = '100%'; container.style.height = '100%';
    container.style.background = 'rgba(0,0,0,0.95)';
    container.style.zIndex = '300';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.padding = '16px';
    container.style.gap = '12px';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-outline';
    cancelBtn.textContent = '✕ 取消';
    cancelBtn.style.color = '#fff';
    cancelBtn.style.borderColor = '#fff';
    container.appendChild(cancelBtn);

    document.body.appendChild(container);

    var scanner = PIX.QR.startScanner(
      function (result) {
        PIX.QR.stopScanner(scanner);
        document.body.removeChild(container);
        // Process scanned Answer
        _processAnswerText(result);
      },
      function (err) {
        PIX.QR.stopScanner(scanner);
        document.body.removeChild(container);
        UI.toast(err, 'error');
      }
    );

    container.insertBefore(scanner.element, cancelBtn);

    cancelBtn.addEventListener('click', function () {
      PIX.QR.stopScanner(scanner);
      document.body.removeChild(container);
    });
  }

  function _processAnswerText(text) {
    if (!text) { UI.toast('未识别到有效连接码', 'error'); return; }
    try {
      // Try to extract JSON from the text (in case it has extra chars)
      var m = text.match(/\{[\s\S]*"type"\s*:\s*"answer"[\s\S]*\}/);
      if (m) text = m[0];
      var answer = JSON.parse(text);
      if (answer.type !== 'answer' || !answer.sdp) throw new Error('Not an answer');
    } catch (e) {
      UI.toast('二维码内容不是有效的 Answer，请重新扫描', 'error');
      return;
    }

    document.getElementById('sender-answer-input').value = text;
    senderProcessAnswer();
  }

  function senderProcessAnswer() {
    var text = document.getElementById('sender-answer-input').value.trim();
    if (!text) { UI.toast('请先扫描或粘贴 Answer', 'warning'); return; }
    var answer;
    try { answer = JSON.parse(text); } catch (e) {
      UI.toast('Answer 格式不对', 'error');
      return;
    }
    if (!_pc) { UI.toast('请刷新页面重试', 'warning'); return; }

    _pc.setRemoteDescription(new RTCSessionDescription(answer)).then(function () {
      UI.showSenderConnected();
      UI.setConnStatus('connected', 'P2P 已连接！正在传图...');
    }).catch(function (err) {
      UI.toast('连接失败: ' + err.message, 'error');
    });
  }

  function copyOfferFallback() {
    var ta = document.getElementById('sender-offer-text');
    ta.select(); ta.setSelectionRange(0, 99999);
    try { navigator.clipboard.writeText(ta.value); UI.toast('已复制！', 'success'); }
    catch (e) { UI.toast('请手动复制', 'warning'); }
  }

  // ================================================================
  //  RECEIVER
  // ================================================================
  function receiverStart() {
    var offerText = document.getElementById('recv-offer-input').value.trim();
    if (!offerText) { UI.toast('请先扫描发送方的二维码或粘贴连接码', 'warning'); return; }

    // Extract JSON if embedded in other text
    var m = offerText.match(/\{[\s\S]*"type"\s*:\s*"offer"[\s\S]*\}/);
    if (m) offerText = m[0];

    var offer;
    try { offer = JSON.parse(offerText); } catch (e) {
      UI.toast('连接码格式不对', 'error');
      return;
    }

    _isSender = false;
    _receivedImages = [];
    _transferComplete = false;

    UI.showReceiverStep2();

    _pc = new RTCPeerConnection(ICE_SERVERS);
    _pc.ondatachannel = function (event) {
      _dc = event.channel;
      _setupReceiverChannel(_dc);
    };
    _pc.onicecandidate = function (e) {};

    _pc.setRemoteDescription(new RTCSessionDescription(offer)).then(function () {
      return _pc.createAnswer();
    }).then(function (answer) {
      return _pc.setLocalDescription(answer);
    }).then(function () {
      return _waitForIce(_pc, 2500);
    }).then(function () {
      var fullSDP = JSON.stringify({ sdp: _pc.localDescription.sdp, type: _pc.localDescription.type });
      var compressed = PIX.QR.compressSDP(fullSDP);
      // Show Answer QR
      UI.showAnswerQR(compressed);
      UI.showAnswerText(compressed);
      UI.toast('📱 请发送方扫描此 Answer QR 码', 'success');
      // Auto-copy as fallback
      try { navigator.clipboard.writeText(compressed); } catch (e) {}
    }).catch(function (err) {
      console.error('Receiver setup failed:', err);
      UI.toast('连接失败: ' + err.message, 'error');
    });

    _pc.oniceconnectionstatechange = function () {
      if (_pc.iceConnectionState === 'connected' || _pc.iceConnectionState === 'completed') {
        UI.setConnStatus('connected', 'P2P 已连接！等待接收...');
      }
    };
  }

  function copyAnswerFallback() {
    var ta = document.getElementById('recv-answer-text');
    ta.select(); ta.setSelectionRange(0, 99999);
    try { navigator.clipboard.writeText(ta.value); UI.toast('已复制！', 'success'); }
    catch (e) { UI.toast('请手动复制', 'warning'); }
  }

  // ================================================================
  //  DATA CHANNEL + FILE TRANSFER
  // ================================================================
  function _setupDataChannel(dc, files) {
    dc.onopen = function () { UI.setConnStatus('connected', '正在发送...'); UI.showSendProgress(); _sendFiles(dc, files); };
    dc.onclose = function () { if (!_transferComplete) UI.setConnStatus('disconnected', '连接关闭'); };
  }

  function _setupReceiverChannel(dc) {
    var cur = null, chunks = [], recvSize = 0;
    var fc = 0, ec = 0, totalRcvd = 0, totalExp = 0;

    dc.onopen = function () { UI.setConnStatus('connected', '已连接，等待接收...'); };

    dc.onmessage = function (event) {
      var data = event.data;
      if (data instanceof ArrayBuffer) {
        var arr = new Uint8Array(data);
        chunks.push(arr); recvSize += arr.byteLength; totalRcvd += arr.byteLength;
        if (cur && cur.size > 0) UI.updateRecvProgress(Math.round(recvSize / cur.size * 100), cur.name);
        if (totalExp > 0) UI.setConnStatus('connected', '接收中 ' + Math.round(totalRcvd / totalExp * 100) + '%');
        return;
      }
      if (typeof data !== 'string') return;
      var msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      switch (msg.type) {
        case 'metadata':
          totalExp = msg.totalSize; ec = msg.count;
          UI.showReceiverReceiving();
          UI.updateRecvProgress(0, '准备接收 ' + msg.count + ' 张...');
          break;
        case 'file-start':
          cur = msg; chunks = []; recvSize = 0;
          UI.updateRecvProgress(0, msg.name);
          break;
        case 'file-end':
          if (cur && chunks.length > 0) {
            _receivedImages.push({ name: cur.name, blob: new Blob(chunks, { type: cur.mime || 'application/octet-stream' }), size: cur.size });
            fc++; UI.setConnStatus('connected', '接收 ' + fc + '/' + ec);
          }
          cur = null; chunks = []; recvSize = 0;
          break;
        case 'complete':
          _transferComplete = true;
          UI.setConnStatus('connected', '接收完成 ✅');
          UI.showReceiverComplete(_receivedImages);
          break;
      }
    };

    dc.onclose = function () {
      if (!_transferComplete && _receivedImages.length > 0) {
        UI.showReceiverComplete(_receivedImages);
        UI.toast('连接关闭，已接收 ' + _receivedImages.length + ' 张', 'warning');
      }
    };
  }

  function _sendFiles(dc, files) {
    var totalSize = 0, sentBytes = 0;
    for (var i = 0; i < files.length; i++) totalSize += files[i].size;
    dc.send(JSON.stringify({ type: 'metadata', files: files.map(function (f) { return { name: f.displayName, size: f.size, mime: f.type }; }), totalSize: totalSize, count: files.length }));
    var idx = 0;
    function sendNext() {
      if (idx >= files.length) { dc.send(JSON.stringify({ type: 'complete' })); _transferComplete = true; UI.updateSendProgress(100, '全部发送完成！'); UI.setConnStatus('connected', '发送完成 ✅'); return; }
      var f = files[idx]; UI.updateSendProgress(0, f.displayName);
      f.file.arrayBuffer().then(function (buf) {
        var sz = buf.byteLength; dc.send(JSON.stringify({ type: 'file-start', name: f.displayName, size: sz, index: idx }));
        var off = 0;
        function chunk() {
          if (off >= sz) { dc.send(JSON.stringify({ type: 'file-end', index: idx })); sentBytes += sz; UI.updateSendProgress(Math.round(sentBytes / totalSize * 100)); idx++; setTimeout(sendNext, 30); return; }
          dc.send(buf.slice(off, Math.min(off + CHUNK_SIZE, sz))); off += CHUNK_SIZE;
          if (dc.bufferedAmount > CHUNK_SIZE * 8) setTimeout(chunk, 80); else chunk();
        }
        chunk();
      });
    }
    sendNext();
  }

  function _waitForIce(pc, timeout) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      var t = setTimeout(function () { resolve(); }, timeout);
      pc.onicegatheringstatechange = function () { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } };
    });
  }

  return {
    init: init,
    senderStart: senderStart,
    receiverStart: receiverStart,
    getReceivedImages: function () { return _receivedImages.slice(); },
    saveAllImages: function () { if (!_receivedImages.length) { UI.toast('没有可保存的图片', 'warning'); return; } PIX.ImageViewer.downloadAll(_receivedImages); }
  };
})();
