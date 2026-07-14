/**
 * peer-manager.js — WebRTC P2P + MQTT 6-digit room relay
 *
 * Sender: enters 6-digit code → publishes SDP offer → waits for answer → P2P
 * Receiver: enters same 6-digit code → reads offer → publishes answer → P2P
 */
PIX.PeerManager = (function () {
  'use strict';
  var U = PIX.Utils, UI = PIX.UI;

  var _pc = null, _dc = null;
  var _isSender = false;
  var _pendingFiles = null;
  var _receivedImages = [];
  var _transferComplete = false;
  var _code = '';

  var ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  var CHUNK_SIZE = 16 * 1024;

  // ---- Init ----
  function init() {
    // Sender flow: show digit panel when "开始发送" clicked
    document.getElementById('btn-share').addEventListener('click', function () {
      document.getElementById('sender-panel').classList.remove('hidden');
      document.getElementById('btn-share').classList.add('hidden');
    });
    document.getElementById('btn-create-room').addEventListener('click', senderStart);
    document.getElementById('btn-join-room').addEventListener('click', receiverStart);
    document.getElementById('btn-retry').addEventListener('click', function () { UI.resetAll(); });
  }

  // ================================================================
  //  CODE INPUT HELPERS
  // ================================================================
  function getDigitCode(prefix) {
    var digits = '';
    for (var i = 1; i <= 6; i++) {
      var el = document.getElementById(prefix + i);
      if (el) digits += el.value;
    }
    return digits;
  }

  function setDigitCode(prefix, code) {
    for (var i = 1; i <= 6; i++) {
      var el = document.getElementById(prefix + i);
      if (el) el.value = code[i - 1] || '';
    }
  }

  function isValidCode(code) {
    return /^\d{6}$/.test(code);
  }

  // ================================================================
  //  SENDER
  // ================================================================
  function senderStart() {
    var files = PIX.FileHandler.getFiles();
    if (!files.length) { UI.toast('请先选择图片', 'warning'); return; }

    _code = getDigitCode('sdigit');
    if (!isValidCode(_code)) { UI.toast('请输入 6 位数字连接码', 'warning'); return; }

    _isSender = true;
    _pendingFiles = files;
    _transferComplete = false;

    UI.showSenderWaiting(_code);

    // Connect to MQTT
    PIX.Relay.connect(_code).then(function () {
      // Create WebRTC offer
      return _createOffer();
    }).then(function (offerSDP) {
      // Publish offer via MQTT
      return PIX.Relay.publishOffer(offerSDP, _onAnswerReceived);
    }).then(function () {
      UI.setConnStatus('connecting', '等待好友输入 ' + _code + '...');
    }).catch(function (err) {
      console.error('Sender error:', err);
      UI.toast('连接失败: ' + err.message, 'error');
      UI.setConnStatus('disconnected', '连接失败');
    });
  }

  function _createOffer() {
    return new Promise(function (resolve, reject) {
      _pc = new RTCPeerConnection(ICE_SERVERS);
      _dc = _pc.createDataChannel('pixshare', { ordered: true });
      _setupDataChannel(_dc, _pendingFiles);
      _pc.onicecandidate = function (e) {};

      _pc.createOffer()
        .then(function (o) { return _pc.setLocalDescription(o); })
        .then(function () { return _waitForIce(_pc, 2000); })
        .then(function () {
          var sdp = JSON.stringify({ sdp: _pc.localDescription.sdp, type: _pc.localDescription.type });
          resolve(sdp);
        })
        .catch(reject);

      _pc.oniceconnectionstatechange = function () {
        var s = _pc.iceConnectionState;
        if (s === 'connected' || s === 'completed') UI.setConnStatus('connected', '已连接 ✅');
      };
    });
  }

  function _onAnswerReceived(answerText) {
    PIX.Relay.disconnect(); // No longer need MQTT
    try {
      var m = answerText.match(/\{[\s\S]*"type"\s*:\s*"answer"[\s\S]*\}/);
      if (m) answerText = m[0];
      var answer = JSON.parse(answerText);
    } catch (e) {
      UI.toast('收到无效的回复', 'error');
      return;
    }

    _pc.setRemoteDescription(new RTCSessionDescription(answer)).then(function () {
      UI.showSenderConnected();
      UI.setConnStatus('connected', 'P2P 已连接！正在传图...');
    }).catch(function (err) {
      UI.toast('连接失败: ' + err.message, 'error');
    });
  }

  // ================================================================
  //  RECEIVER
  // ================================================================
  function receiverStart() {
    _code = getDigitCode('rdigit');
    if (!isValidCode(_code)) { UI.toast('请输入 6 位数字连接码', 'warning'); return; }

    _isSender = false;
    _receivedImages = [];
    _transferComplete = false;

    UI.showReceiverWaiting(_code);

    PIX.Relay.connect(_code).then(function () {
      // Wait for offer from sender
      PIX.Relay.waitForOffer(_onOfferReceived);
      UI.setConnStatus('connecting', '已加入 ' + _code + '，等待发送方...');
    }).catch(function (err) {
      console.error('Receiver error:', err);
      UI.toast('连接失败: ' + err.message, 'error');
      UI.setConnStatus('disconnected', '连接失败');
    });
  }

  function _onOfferReceived(offerText) {
    // Extract JSON
    var m = offerText.match(/\{[\s\S]*"type"\s*:\s*"offer"[\s\S]*\}/);
    if (m) offerText = m[0];

    var offer;
    try { offer = JSON.parse(offerText); } catch (e) { UI.toast('收到无效的 Offer', 'error'); return; }

    UI.setConnStatus('connecting', '已收到连接码，正在回复...');

    // Create peer and answer
    _pc = new RTCPeerConnection(ICE_SERVERS);
    _pc.ondatachannel = function (event) { _dc = event.channel; _setupReceiverChannel(_dc); };
    _pc.onicecandidate = function (e) {};

    _pc.setRemoteDescription(new RTCSessionDescription(offer))
      .then(function () { return _pc.createAnswer(); })
      .then(function (a) { return _pc.setLocalDescription(a); })
      .then(function () { return _waitForIce(_pc, 2000); })
      .then(function () {
        var sdp = JSON.stringify({ sdp: _pc.localDescription.sdp, type: _pc.localDescription.type });
        return PIX.Relay.publishAnswer(sdp);
      })
      .then(function () {
        PIX.Relay.disconnect();
        UI.setConnStatus('connecting', '等待 P2P 连接...');
      })
      .catch(function (err) {
        console.error('Answer creation failed:', err);
        UI.toast('连接失败: ' + err.message, 'error');
      });

    _pc.oniceconnectionstatechange = function () {
      var s = _pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') UI.setConnStatus('connected', 'P2P 已连接！等待接收...');
    };
  }

  // ================================================================
  //  DATA CHANNEL + FILES
  // ================================================================
  function _setupDataChannel(dc, files) {
    dc.onopen = function () { UI.setConnStatus('connected', '正在发送...'); UI.showSendProgress(); _sendFiles(dc, files); };
    dc.onclose = function () { if (!_transferComplete) UI.setConnStatus('disconnected', '连接关闭'); };
  }

  function _setupReceiverChannel(dc) {
    var cur = null, chunks = [], rs = 0, fc = 0, ec = 0, tr = 0, te = 0;

    dc.onopen = function () { UI.setConnStatus('connected', '已连接，等待接收...'); };

    dc.onmessage = function (e) {
      var d = e.data;
      if (d instanceof ArrayBuffer) {
        var a = new Uint8Array(d); chunks.push(a); rs += a.byteLength; tr += a.byteLength;
        if (cur && cur.size > 0) UI.updateRecvProgress(Math.round(rs / cur.size * 100), cur.name);
        if (te > 0) UI.setConnStatus('connected', '接收中 ' + Math.round(tr / te * 100) + '%');
        return;
      }
      if (typeof d !== 'string') return;
      var m;
      try { m = JSON.parse(d); } catch (_) { return; }
      switch (m.type) {
        case 'metadata': te = m.totalSize; ec = m.count; UI.showReceiverReceiving(); UI.updateRecvProgress(0, '准备接收 ' + m.count + ' 张...'); break;
        case 'file-start': cur = m; chunks = []; rs = 0; UI.updateRecvProgress(0, m.name); break;
        case 'file-end': if (cur && chunks.length) { _receivedImages.push({ name: cur.name, blob: new Blob(chunks, { type: cur.mime || 'application/octet-stream' }), size: cur.size }); fc++; UI.setConnStatus('connected', '接收 ' + fc + '/' + ec); } cur = null; chunks = []; rs = 0; break;
        case 'complete': _transferComplete = true; UI.setConnStatus('connected', '接收完成 ✅'); UI.showReceiverComplete(_receivedImages); break;
      }
    };

    dc.onclose = function () {
      if (!_transferComplete && _receivedImages.length > 0) { UI.showReceiverComplete(_receivedImages); UI.toast('连接已关闭，已接收 ' + _receivedImages.length + ' 张', 'warning'); }
    };
  }

  function _sendFiles(dc, files) {
    var ts = 0, sb = 0;
    for (var i = 0; i < files.length; i++) ts += files[i].size;
    dc.send(JSON.stringify({ type: 'metadata', files: files.map(function (f) { return { name: f.displayName, size: f.size, mime: f.type }; }), totalSize: ts, count: files.length }));
    var idx = 0;
    function sn() {
      if (idx >= files.length) { dc.send(JSON.stringify({ type: 'complete' })); _transferComplete = true; UI.updateSendProgress(100, '全部发送完成！'); UI.setConnStatus('connected', '发送完成 ✅'); return; }
      var f = files[idx]; UI.updateSendProgress(0, f.displayName);
      f.file.arrayBuffer().then(function (b) {
        var sz = b.byteLength; dc.send(JSON.stringify({ type: 'file-start', name: f.displayName, size: sz, index: idx }));
        var o = 0;
        function ck() { if (o >= sz) { dc.send(JSON.stringify({ type: 'file-end', index: idx })); sb += sz; UI.updateSendProgress(Math.round(sb / ts * 100)); idx++; setTimeout(sn, 30); return; } dc.send(b.slice(o, Math.min(o + CHUNK_SIZE, sz))); o += CHUNK_SIZE; if (dc.bufferedAmount > CHUNK_SIZE * 8) setTimeout(ck, 80); else ck(); }
        ck();
      });
    }
    sn();
  }

  function _waitForIce(pc, t) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      var to = setTimeout(function () { resolve(); }, t);
      pc.onicegatheringstatechange = function () { if (pc.iceGatheringState === 'complete') { clearTimeout(to); resolve(); } };
    });
  }

  return {
    init: init,
    getReceivedImages: function () { return _receivedImages.slice(); },
    saveAllImages: function () { if (!_receivedImages.length) { UI.toast('No images', 'warning'); return; } PIX.ImageViewer.downloadAll(_receivedImages); }
  };
})();
