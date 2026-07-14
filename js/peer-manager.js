/**
 * peer-manager.js — Pure WebRTC + QR or text exchange
 *
 * Bidirectional: every QR has a prominent "or paste text" fallback.
 * Works for all scenarios: desktop↔desktop, desktop↔phone, phone↔phone.
 */
PIX.PeerManager = (function () {
  'use strict';
  var U = PIX.Utils, UI = PIX.UI;

  var _pc = null, _dc = null;
  var _isSender = false;
  var _pendingFiles = null;
  var _receivedImages = [];
  var _transferComplete = false;
  var _offerSDP = '';
  var _answerSDP = '';

  var ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  var CHUNK_SIZE = 16 * 1024;

  // ---- Init ----
  function init() {
    document.getElementById('btn-share').addEventListener('click', senderStart);
    document.getElementById('btn-copy-offer').addEventListener('click', function () {
      copyTextFallback('sender-offer-text');
    });
    document.getElementById('btn-paste-answer').addEventListener('click', senderProcessAnswer);
    document.getElementById('btn-recv-start').addEventListener('click', receiverStart);
    document.getElementById('btn-copy-answer').addEventListener('click', function () {
      copyTextFallback('recv-answer-text');
    });
    document.getElementById('btn-retry').addEventListener('click', function () { UI.resetAll(); });
  }

  // ================================================================
  //  SENDER
  // ================================================================
  function senderStart() {
    var files = PIX.FileHandler.getFiles();
    if (!files.length) { UI.toast('请先选择图片', 'warning'); return; }

    _isSender = true; _pendingFiles = files; _transferComplete = false;
    UI.showSenderStep1();

    _pc = new RTCPeerConnection(ICE_SERVERS);
    _dc = _pc.createDataChannel('pixshare', { ordered: true });
    _setupDataChannel(_dc, files);
    _pc.onicecandidate = function (e) {};

    _pc.createOffer()
      .then(function (o) { return _pc.setLocalDescription(o); })
      .then(function () { return _waitForIce(_pc, 2000); })
      .then(function () {
        _offerSDP = JSON.stringify({ sdp: _pc.localDescription.sdp, type: _pc.localDescription.type });
        var compressed = PIX.QR.compressSDP(_offerSDP);
        // Show QR
        UI.showOfferQR(compressed);
        // Also fill text area
        document.getElementById('sender-offer-text').value = compressed;
        UI.toast('📱 请好友扫码或复制下方文本', 'success');
        // Auto-copy for easy paste
        try { navigator.clipboard.writeText(compressed); } catch (e) {}
      }).catch(function (err) {
        console.error('Offer failed:', err);
        UI.toast('创建连接失败: ' + err.message, 'error');
      });

    _pc.oniceconnectionstatechange = function () {
      var s = _pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') UI.setConnStatus('connected', '已连接 ✅');
    };
  }

  function senderProcessAnswer() {
    var text = document.getElementById('sender-answer-input').value.trim();
    // Auto-detect from clipboard if empty
    if (!text && navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (t) {
        if (t) { document.getElementById('sender-answer-input').value = t; senderProcessAnswer(); }
      });
      return;
    }
    if (!text) { UI.toast('请复制好友的回复，然后点击此按钮', 'warning'); return; }

    // Extract JSON from text
    var m = text.match(/\{[\s\S]*"type"\s*:\s*"answer"[\s\S]*\}/);
    if (m) text = m[0];

    var answer;
    try { answer = JSON.parse(text); } catch (e) { UI.toast('回复格式不对，请确认完整复制', 'error'); return; }
    if (!_pc) { UI.toast('请重新生成二维码', 'warning'); return; }

    _pc.setRemoteDescription(new RTCSessionDescription(answer)).then(function () {
      UI.showSenderConnected();
      UI.setConnStatus('connected', 'P2P 已连接！正在传图...');
    }).catch(function (err) {
      UI.toast('连接失败，请确认文本完整。提示：长按消息→全选→复制', 'error');
    });
  }

  function copyTextFallback(targetId) {
    var ta = document.getElementById(targetId);
    ta.select(); ta.setSelectionRange(0, 99999);
    try { navigator.clipboard.writeText(ta.value); UI.toast('已复制！发给对方即可', 'success'); }
    catch (e) { UI.toast('请手动全选复制', 'warning'); }
  }

  // ================================================================
  //  RECEIVER
  // ================================================================
  function receiverStart() {
    var offerText = document.getElementById('recv-offer-input').value.trim();
    if (!offerText && navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (t) {
        if (t) { document.getElementById('recv-offer-input').value = t; receiverStart(); }
      });
      return;
    }
    if (!offerText) { UI.toast('请先让发送方生成二维码，然后复制连接码到此处', 'warning'); return; }

    // Extract JSON
    var m = offerText.match(/\{[\s\S]*"type"\s*:\s*"offer"[\s\S]*\}/);
    if (m) offerText = m[0];

    var offer;
    try { offer = JSON.parse(offerText); } catch (e) { UI.toast('连接码格式不对，请从 { 到 } 完整复制', 'error'); return; }

    _isSender = false; _receivedImages = []; _transferComplete = false;
    UI.showReceiverStep2();

    _pc = new RTCPeerConnection(ICE_SERVERS);
    _pc.ondatachannel = function (event) { _dc = event.channel; _setupReceiverChannel(_dc); };
    _pc.onicecandidate = function (e) {};

    _pc.setRemoteDescription(new RTCSessionDescription(offer))
      .then(function () { return _pc.createAnswer(); })
      .then(function (a) { return _pc.setLocalDescription(a); })
      .then(function () { return _waitForIce(_pc, 2000); })
      .then(function () {
        _answerSDP = JSON.stringify({ sdp: _pc.localDescription.sdp, type: _pc.localDescription.type });
        var compressed = PIX.QR.compressSDP(_answerSDP);
        // Show Answer QR
        UI.showAnswerQR(compressed);
        // Fill text
        document.getElementById('recv-answer-text').value = compressed;
        // Auto-copy
        try { navigator.clipboard.writeText(compressed); } catch (e) {}
        UI.toast('✅ 连接码已复制！请发给发送方，或让对方扫码', 'success');
      }).catch(function (err) {
        console.error('Receiver error:', err);
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
      if (!_transferComplete && _receivedImages.length > 0) { UI.showReceiverComplete(_receivedImages); UI.toast('连接关闭，已接收 ' + _receivedImages.length + ' 张', 'warning'); }
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
        function ck() {
          if (o >= sz) { dc.send(JSON.stringify({ type: 'file-end', index: idx })); sb += sz; UI.updateSendProgress(Math.round(sb / ts * 100)); idx++; setTimeout(sn, 30); return; }
          dc.send(b.slice(o, Math.min(o + CHUNK_SIZE, sz))); o += CHUNK_SIZE;
          if (dc.bufferedAmount > CHUNK_SIZE * 8) setTimeout(ck, 80); else ck();
        }
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
    senderStart: senderStart,
    receiverStart: receiverStart,
    getReceivedImages: function () { return _receivedImages.slice(); },
    saveAllImages: function () { if (!_receivedImages.length) { UI.toast('没有可保存的图片', 'warning'); return; } PIX.ImageViewer.downloadAll(_receivedImages); }
  };
})();
