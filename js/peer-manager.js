/**
 * peer-manager.js — WebRTC P2P + MQTT 6-digit room relay
 *
 * Flow:
 *   1. Sender creates room → publishes offer → waits for join request
 *   2. Receiver joins room → sees offer → clicks "申请加入" → sends join-request
 *   3. Sender sees "有人申请加入" → clicks "确认" → sends confirm → SDP exchange
 *   4. P2P established → file transfer
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
  var _offerSDP = '';

  var ICE_SERVERS = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      // Free TURN for cross-network fallback (limited bandwidth)
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ]
  };
  var CHUNK_SIZE = 16 * 1024;

  // ---- Init ----
  function init() {
    document.getElementById('btn-share').addEventListener('click', function () {
      document.getElementById('sender-panel').classList.remove('hidden');
      document.getElementById('btn-share').classList.add('hidden');
    });
    document.getElementById('btn-create-room').addEventListener('click', senderCreateRoom);
    document.getElementById('btn-confirm-join').addEventListener('click', senderConfirmJoin);
    document.getElementById('btn-join-room').addEventListener('click', receiverJoinRoom);
    document.getElementById('btn-retry').addEventListener('click', function () { UI.resetAll(); });
  }

  // ---- Helpers ----
  function getSenderCode() { return document.getElementById('scode').value.replace(/\D/g, ''); }
  function getReceiverCode() { return document.getElementById('rcode').value.replace(/\D/g, ''); }
  function isValidCode(code) { return /^\d{6}$/.test(code); }

  // ================================================================
  //  SENDER: create room, wait for join request
  // ================================================================
function senderCreateRoom() {
    var files = PIX.FileHandler.getFiles();
    if (!files.length) { UI.toast('请先选择图片', 'warning'); return; }

    _code = getSenderCode();
    if (!isValidCode(_code)) { UI.toast('请输入完整的 6 位数字', 'warning'); return; }

    _isSender = true;
    _pendingFiles = files;
    _transferComplete = false;

    UI.showSenderWaiting(_code);
    UI.setConnStatus('connecting', '创建房间...');

    PIX.Relay.connect(_code).then(function () {
      PIX.Relay.listenJoinRequest(_onJoinRequest);
      UI.setConnStatus('connected', '等待好友申请加入...');
    }).catch(function (err) {
      console.error('Sender MQTT error (non-fatal):', err);
      // MQTT might auto-recover, don't show error unless P2P also fails
      UI.setConnStatus('connecting', '重连中...');
    });
  }

  function _onJoinRequest(msg) {
    UI.showSenderJoinRequest(_code);
    document.getElementById('btn-confirm-join').onclick = senderConfirmJoin;
  }

  // ---- SENDER: confirm → create offer → publish → wait for answer ----
  function senderConfirmJoin() {
    UI.showSenderJoined();
    UI.setConnStatus('connecting', '建立 P2P...');

    // Create WebRTC peer + offer NOW (after confirming)
    _pc = new RTCPeerConnection(ICE_SERVERS);
    _dc = _pc.createDataChannel('pixshare', { ordered: true });
    _setupDataChannel(_dc, _pendingFiles);
    _pc.onicecandidate = function (e) {};

    _pc.oniceconnectionstatechange = function () {
      var s = _pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') {
        PIX.Relay.disconnect(); // Kill MQTT, no longer needed
        UI.setConnStatus('connected', '已连接 ✅');
      }
    };

    _pc.createOffer()
      .then(function (o) { return _pc.setLocalDescription(o); })
      .then(function () { return _waitForIce(_pc, 2000); })
      .then(function () {
        _offerSDP = JSON.stringify({ sdp: _pc.localDescription.sdp, type: _pc.localDescription.type });
        // Publish confirm + offer to receiver
        return PIX.Relay.publishConfirm('accepted');
      })
      .then(function () {
        return PIX.Relay.publishOffer(_offerSDP);
      })
      .then(function () {
        // Listen for answer
        PIX.Relay.listenAnswer(function (answerText) {
          PIX.Relay.disconnect();
          try {
            var m = answerText.match(/\{[\s\S]*"type"\s*:\s*"answer"[\s\S]*\}/);
            if (m) answerText = m[0];
            var answer = JSON.parse(answerText);
            _pc.setRemoteDescription(new RTCSessionDescription(answer)).then(function () {
              UI.showSenderConnected();
              UI.setConnStatus('connected', 'P2P 已连接！正在传图...');
            }).catch(function (err) {
              UI.toast('连接失败: ' + err.message, 'error');
            });
          } catch (e) {
            UI.toast('收到无效的回复', 'error');
          }
        });
      })
      .catch(function (err) {
        if (!_transferComplete) {
          console.error('Confirm error:', err);
          UI.toast('连接失败，请重试', 'error');
        }
      });
  }

  // ================================================================
  //  RECEIVER: join room, send join request, wait for confirm
  // ================================================================
  function receiverJoinRoom() {
    _code = getReceiverCode();
    if (!isValidCode(_code)) { UI.toast('请输入完整的 6 位数字', 'warning'); return; }

    _isSender = false;
    _receivedImages = [];
    _transferComplete = false;

    UI.showReceiverJoining(_code);
    UI.setConnStatus('connecting', '加入房间...');

    PIX.Relay.connect(_code).then(function () {
      // Step 1: Send join request
      PIX.Relay.publishJoinRequest('apply').then(function () {
        UI.showReceiverWaitingConfirm(_code);
        UI.setConnStatus('connecting', '等待发送方确认...');

        // Step 2: Wait for sender to confirm, then read their offer
        PIX.Relay.listenConfirmAndOffer(function (confirmMsg, offerText) {
          _processReceivedOffer(offerText);
        });
      });
    }).catch(function (err) {
      if (!_pc || (_pc.iceConnectionState !== 'connected' && _pc.iceConnectionState !== 'completed')) {
        console.error('Receiver MQTT error:', err);
        UI.setConnStatus('connecting', '重连中...');
      }
    });
  }

  function _processReceivedOffer(offerText) {
    var m = offerText.match(/\{[\s\S]*"type"\s*:\s*"offer"[\s\S]*\}/);
    if (m) offerText = m[0];

    var offer;
    try { offer = JSON.parse(offerText); } catch (e) { UI.toast('收到无效的连接码', 'error'); return; }

    UI.showReceiverJoined();
    UI.setConnStatus('connecting', '连接中...');

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
        if (!_transferComplete) {
          console.error('Answer creation failed:', err);
          UI.toast('连接失败，请重试', 'error');
        }
      });

    _pc.oniceconnectionstatechange = function () {
      var s = _pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') {
        PIX.Relay.disconnect(); // Kill MQTT, no longer needed
        UI.setConnStatus('connected', 'P2P 已连接！等待接收...');
      }
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
