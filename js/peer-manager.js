/**
 * peer-manager.js — Pure WebRTC with auto-share, zero copy-paste
 *
 * Flow (2 taps per side):
 *   Sender:   select images → tap "分享给好友" → system share sheet → pick WeChat → send
 *   Receiver: tap received msg → copy → open pixshare → auto-detects → tap "回复好友" → system share → send
 *   Sender:   tap received reply → copy → open pixshare → auto-detects → connected
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
  var _myOfferSDP = '';    // Cache my offer to re-share if needed
  var _myAnswerSDP = '';   // Cache my answer

  // ---- Init ----
  function init() {
    // Sender
    document.getElementById('btn-share').addEventListener('click', senderStart);
    document.getElementById('btn-share-offer').addEventListener('click', shareOfferViaSystem);
    document.getElementById('btn-copy-offer').addEventListener('click', copyOfferFallback);
    document.getElementById('btn-paste-answer').addEventListener('click', senderProcessAnswer);

    // Receiver
    document.getElementById('btn-recv-start').addEventListener('click', receiverStart);
    document.getElementById('btn-share-answer').addEventListener('click', shareAnswerViaSystem);
    document.getElementById('btn-copy-answer').addEventListener('click', copyAnswerFallback);

    document.getElementById('btn-retry').addEventListener('click', function () { UI.resetAll(); });

    // Sender: auto-detect Answer in clipboard on focus
    _setupClipboardDetection();
  }

  // ================================================================
  //  CLIPBOARD AUTO-DETECT: when user comes back from WeChat,
  //  check if they have an Answer copied
  // ================================================================
  function _setupClipboardDetection() {
    var checkTimer = null;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (_transferComplete) return;
      if (!_isSender) return;
      if (!_pc) return;
      // Check clipboard for Answer
      if (_pc.signalingState === 'have-local-offer' || _pc.signalingState === 'have-local-pranswer') {
        UI.setConnStatus('connecting', '检测剪贴板...');
        clearTimeout(checkTimer);
        checkTimer = setTimeout(function () {
          _tryClipboardAnswer();
        }, 500);
      }
      if (_pc.iceConnectionState === 'connected' || _pc.iceConnectionState === 'completed') {
        UI.setConnStatus('connected', '已连接 ✅');
      }
    });
  }

  function _tryClipboardAnswer() {
    if (!navigator.clipboard || !navigator.clipboard.readText) return;
    navigator.clipboard.readText().then(function (text) {
      if (!text || text.length < 20) return;
      var answer;
      try { answer = JSON.parse(text.trim()); } catch (e) { return; }
      if (answer.type === 'answer' && answer.sdp) {
        UI.toast('检测到 Answer！自动连接中...', 'success');
        document.getElementById('sender-answer-input').value = text.trim();
        senderProcessAnswer();
      }
    }).catch(function () {});
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

    _pc.onicecandidate = function (e) { /* collected in setLocalDescription */ };

    _pc.createOffer().then(function (offer) {
      return _pc.setLocalDescription(offer);
    }).then(function () {
      // Fast ICE gathering — 2s max
      return _waitForIce(_pc, 2500);
    }).then(function () {
      _myOfferSDP = JSON.stringify({
        sdp: _pc.localDescription.sdp,
        type: _pc.localDescription.type
      });
      UI.showOfferText(_myOfferSDP);
      // Auto-trigger system share on mobile
      if (U.isMobile()) {
        setTimeout(function () { shareOfferViaSystem(); }, 300);
      }
    }).catch(function (err) {
      console.error('Create offer failed:', err);
      UI.toast('创建连接失败: ' + err.message, 'error');
    });

    _pc.oniceconnectionstatechange = function () {
      if (_pc.iceConnectionState === 'connected' || _pc.iceConnectionState === 'completed') {
        UI.setConnStatus('connected', '已连接 ✅');
      } else if (_pc.iceConnectionState === 'disconnected') {
        UI.setConnStatus('disconnected', '断开');
      } else if (_pc.iceConnectionState === 'failed') {
        UI.setConnStatus('disconnected', '连接失败');
      }
    };

    // Also copy to clipboard so user can paste manually
    setTimeout(function () {
      try { navigator.clipboard.writeText(_myOfferSDP); } catch (e) {}
    }, 800);
  }

  function shareOfferViaSystem() {
    if (!_myOfferSDP) return;
    // Prefix with marker so receiver can detect it
    var text = '📸 PixShare 连接码：\n' + _myOfferSDP + '\n\n👉 复制全部 → 打开 pixshare 粘贴 → 自动连接';
    if (navigator.share) {
      navigator.share({ title: 'PixShare 传图', text: text }).then(function () {
        UI.toast('已分享！等待好友回复 Answer...', 'success');
        UI.setConnStatus('connected', '等待好友回复...');
      }).catch(function (err) {
        if (err.name !== 'AbortError') { copyOfferFallback(); }
      });
    } else {
      copyOfferFallback();
    }
  }

  function copyOfferFallback() {
    var ta = document.getElementById('sender-offer-text');
    ta.select(); ta.setSelectionRange(0, 99999);
    try { navigator.clipboard.writeText(ta.value); UI.toast('已复制！到微信粘贴发给好友', 'success'); }
    catch (e) { UI.toast('请手动复制上方文本到微信', 'warning'); }
  }

  function senderProcessAnswer() {
    var text = document.getElementById('sender-answer-input').value.trim();
    if (!text) {
      // Try clipboard as fallback
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (t) {
          if (t) {
            document.getElementById('sender-answer-input').value = t.trim();
            senderProcessAnswer();
          } else {
            UI.toast('请先粘贴好友回复的连接码', 'warning');
          }
        });
        return;
      }
      UI.toast('请先粘贴好友回复的连接码', 'warning');
      return;
    }

    var answer;
    try { answer = JSON.parse(text); } catch (e) {
      UI.toast('连接码格式不对，请确认完整复制了全部文字', 'error');
      return;
    }

    if (!_pc) { UI.toast('请刷新页面重试', 'warning'); return; }

    _pc.setRemoteDescription(new RTCSessionDescription(answer)).then(function () {
      UI.showSenderConnected();
      UI.setConnStatus('connected', 'P2P 已连接！正在传图...');
    }).catch(function (err) {
      console.error('Set remote failed:', err);
      UI.toast('连接失败，请确认文本完整复制', 'error');
    });
  }

  // ================================================================
  //  RECEIVER
  // ================================================================
  function receiverStart() {
    var offerText = document.getElementById('recv-offer-input').value.trim();
    // Auto-detect from clipboard if input is empty
    if (!offerText && navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (t) {
        if (t) {
          document.getElementById('recv-offer-input').value = t.trim();
          receiverStart();
        } else {
          UI.toast('请先复制发送方的连接码', 'warning');
        }
      });
      return;
    }
    if (!offerText) { UI.toast('请先复制发送方的连接码到上方输入框', 'warning'); return; }

    // Try to extract SDP from chat text (in case user copied the whole message with prefix)
    var sdpMatch = offerText.match(/\{[\s\S]*"type"\s*:\s*"offer"[\s\S]*\}/);
    if (sdpMatch) { offerText = sdpMatch[0]; }

    var offer;
    try { offer = JSON.parse(offerText); } catch (e) {
      UI.toast('连接码不完整，请从 "{" 到 "}" 完整复制', 'error');
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
      _myAnswerSDP = JSON.stringify({
        sdp: _pc.localDescription.sdp,
        type: _pc.localDescription.type
      });
      UI.showAnswerText(_myAnswerSDP);
      // Auto-copy to clipboard
      try { navigator.clipboard.writeText(_myAnswerSDP); } catch (e) {}
      // Auto-trigger share on mobile
      if (U.isMobile()) {
        setTimeout(function () { shareAnswerViaSystem(); }, 300);
      }
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

  function shareAnswerViaSystem() {
    if (!_myAnswerSDP) return;
    var text = '📸 PixShare 回复：\n' + _myAnswerSDP + '\n\n👉 复制全部发回给发送方即可';
    if (navigator.share) {
      navigator.share({ title: 'PixShare 回复', text: text }).then(function () {
        UI.toast('已回复！等待 P2P 连接...', 'success');
        UI.setConnStatus('connecting', '等待连接...');
      }).catch(function (err) {
        if (err.name !== 'AbortError') { copyAnswerFallback(); }
      });
    } else {
      copyAnswerFallback();
    }
  }

  function copyAnswerFallback() {
    var ta = document.getElementById('recv-answer-text');
    ta.select(); ta.setSelectionRange(0, 99999);
    try { navigator.clipboard.writeText(ta.value); UI.toast('已复制！到微信发回给发送方', 'success'); }
    catch (e) { UI.toast('请手动复制上方文本', 'warning'); }
  }

  // ================================================================
  //  DATA CHANNEL + FILE TRANSFER
  // ================================================================
  function _setupDataChannel(dc, files) {
    dc.onopen = function () {
      UI.setConnStatus('connected', '正在发送...');
      UI.showSendProgress();
      _sendFiles(dc, files);
    };
    dc.onclose = function () {
      if (!_transferComplete) UI.setConnStatus('disconnected', '连接关闭');
    };
  }

  function _setupReceiverChannel(dc) {
    var cur = null, chunks = [], recvSize = 0;
    var fc = 0, ec = 0, totalRcvd = 0, totalExp = 0;

    dc.onopen = function () {
      UI.setConnStatus('connected', '已连接，等待接收...');
    };

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

  // ---- ICE helper ----
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
