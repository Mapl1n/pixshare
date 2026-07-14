/**
 * peer-manager.js — Pure WebRTC with manual SDP exchange
 * No signaling server. No PeerJS. No disconnects.
 *
 * Flow:
 *   Sender:   select files → createOffer → copy SDP → send via WeChat
 *   Receiver: paste SDP → createAnswer → copy SDP → send back via WeChat
 *   Sender:   paste Answer → P2P connection established → transfer files
 */
PIX.PeerManager = (function () {
  'use strict';
  var U = PIX.Utils, UI = PIX.UI;

  var _pc = null;           // RTCPeerConnection
  var _dc = null;           // DataChannel (sender side)
  var _isSender = false;
  var _pendingFiles = null;
  var _receivedImages = [];
  var _transferComplete = false;

  // STUN servers (Google free public — only used to discover public IP, no data passes through)
  var ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  var CHUNK_SIZE = 16 * 1024;

  // ---- Init ----
  function init() {
    // Sender buttons
    document.getElementById('btn-share').addEventListener('click', senderStart);
    document.getElementById('btn-copy-offer').addEventListener('click', copyOffer);
    document.getElementById('btn-paste-answer').addEventListener('click', senderPasteAnswer);

    // Receiver buttons
    document.getElementById('btn-recv-start').addEventListener('click', receiverStart);
    document.getElementById('btn-copy-answer').addEventListener('click', copyAnswer);

    // Retry
    document.getElementById('btn-retry').addEventListener('click', function () {
      UI.resetAll();
    });

    // Add files
    document.getElementById('btn-add').addEventListener('click', function () {
      document.getElementById('file-input').click();
    });
    document.getElementById('btn-clear').addEventListener('click', function () {
      PIX.FileHandler.clearAll();
    });
  }

  // ================================================================
  //  SENDER SIDE
  // ================================================================

  function senderStart() {
    var files = PIX.FileHandler.getFiles();
    if (!files.length) { UI.toast('请先选择图片', 'warning'); return; }

    _isSender = true;
    _pendingFiles = files;
    _transferComplete = false;

    UI.showSenderStep1();

    _pc = new RTCPeerConnection(ICE_SERVERS);

    // Create data channel (sender initiates)
    _dc = _pc.createDataChannel('pixshare', { ordered: true });
    _setupDataChannel(_dc, files);

    // Collect ICE candidates
    var iceCandidates = [];
    _pc.onicecandidate = function (e) {
      if (e.candidate) {
        iceCandidates.push(e.candidate);
      }
    };

    _pc.createOffer().then(function (offer) {
      return _pc.setLocalDescription(offer);
    }).then(function () {
      // Wait for ICE gathering to complete
      _waitForIce(_pc).then(function () {
        var sdp = JSON.stringify({
          sdp: _pc.localDescription.sdp,
          type: _pc.localDescription.type
        });
        UI.showOfferText(sdp);
        UI.toast('✅ 请复制 Offer 发给好友', 'success');
      });
    }).catch(function (err) {
      console.error('Create offer failed:', err);
      UI.toast('创建连接失败: ' + err.message, 'error');
    });

    // Monitor connection
    _pc.oniceconnectionstatechange = function () {
      console.log('ICE state:', _pc.iceConnectionState);
      if (_pc.iceConnectionState === 'connected' || _pc.iceConnectionState === 'completed') {
        UI.setConnStatus('connected', '已连接 ✅');
      } else if (_pc.iceConnectionState === 'disconnected') {
        UI.setConnStatus('disconnected', '连接断开');
      } else if (_pc.iceConnectionState === 'failed') {
        UI.setConnStatus('disconnected', '连接失败');
      }
    };
  }

  function senderPasteAnswer() {
    var text = document.getElementById('sender-answer-input').value.trim();
    if (!text) { UI.toast('请先粘贴好友发回的 Answer', 'warning'); return; }

    var answer;
    try { answer = JSON.parse(text); } catch (e) {
      UI.toast('Answer 格式不对，请确认完整复制', 'error');
      return;
    }

    if (!_pc) {
      UI.toast('请先点"开始分享"', 'warning');
      return;
    }

    _pc.setRemoteDescription(new RTCSessionDescription(answer)).then(function () {
      UI.showSenderConnected();
      UI.setConnStatus('connected', 'P2P 连接建立，等待传输...');
      UI.toast('✅ 连接成功！等待好友连接...', 'success');
    }).catch(function (err) {
      console.error('Set remote failed:', err);
      UI.toast('连接失败: ' + err.message + '，请确认文本完整', 'error');
    });
  }

  function copyOffer() {
    var ta = document.getElementById('sender-offer-text');
    ta.select(); ta.setSelectionRange(0, 99999);
    try {
      navigator.clipboard.writeText(ta.value);
      UI.toast('Offer 已复制！去微信发给好友 📋', 'success');
    } catch (e) {
      UI.toast('请手动全选复制上方文本', 'warning');
    }
  }

  function _setupDataChannel(dc, files) {
    dc.onopen = function () {
      console.log('DataChannel open, sending files...');
      UI.setConnStatus('connected', '正在发送...');
      UI.showSendProgress();
      _sendFiles(dc, files);
    };

    dc.onclose = function () {
      if (!_transferComplete) {
        UI.setConnStatus('disconnected', '连接关闭');
      }
    };
  }

  function _sendFiles(dc, files) {
    var totalSize = 0, sentBytes = 0;
    for (var i = 0; i < files.length; i++) totalSize += files[i].size;

    dc.send(JSON.stringify({
      type: 'metadata',
      files: files.map(function (f) { return { name: f.displayName, size: f.size, mime: f.type }; }),
      totalSize: totalSize, count: files.length
    }));

    var idx = 0;
    var buffer = null;
    var bufSize = 0;
    var bufOffset = 0;

    function sendNext() {
      if (idx >= files.length) {
        if (dc.readyState === 'open') {
          dc.send(JSON.stringify({ type: 'complete' }));
        }
        _transferComplete = true;
        UI.updateSendProgress(100, '全部发送完成！');
        UI.setConnStatus('connected', '发送完成 ✅');
        UI.toast('✅ 全部发送完成！', 'success');
        return;
      }
      var f = files[idx];
      UI.updateSendProgress(0, f.displayName);
      f.file.arrayBuffer().then(function (buf) {
        buffer = new Uint8Array(buf);
        bufSize = buffer.byteLength;
        bufOffset = 0;
        dc.send(JSON.stringify({ type: 'file-start', name: f.displayName, size: bufSize, index: idx }));
        sendChunk();
      }).catch(function (e) {
        console.error('Read error:', e);
        dc.send(JSON.stringify({ type: 'error', message: '读取失败: ' + f.displayName }));
      });
    }

    function sendChunk() {
      if (bufOffset >= bufSize) {
        dc.send(JSON.stringify({ type: 'file-end', index: idx }));
        sentBytes += bufSize;
        UI.updateSendProgress(Math.round(sentBytes / totalSize * 100));
        idx++;
        setTimeout(sendNext, 30);
        return;
      }
      var end = Math.min(bufOffset + CHUNK_SIZE, bufSize);
      dc.send(buffer.slice(bufOffset, end).buffer);
      bufOffset = end;
      // Check buffer
      if (dc.bufferedAmount > CHUNK_SIZE * 8) {
        setTimeout(sendChunk, 100);
      } else {
        sendChunk();
      }
    }

    sendNext();
  }

  // ================================================================
  //  RECEIVER SIDE
  // ================================================================

  function receiverStart() {
    var offerText = document.getElementById('recv-offer-input').value.trim();
    if (!offerText) { UI.toast('请先粘贴发送方的 Offer', 'warning'); return; }

    var offer;
    try { offer = JSON.parse(offerText); } catch (e) {
      UI.toast('Offer 格式不对，请确认完整粘贴', 'error');
      return;
    }

    _isSender = false;
    _receivedImages = [];
    _transferComplete = false;

    UI.showReceiverStep2();

    _pc = new RTCPeerConnection(ICE_SERVERS);

    // Receiver listens for data channel
    _pc.ondatachannel = function (event) {
      _dc = event.channel;
      _setupReceiverChannel(_dc);
    };

    // Collect ICE
    _pc.onicecandidate = function (e) { /* collected in SDP */ };

    _pc.setRemoteDescription(new RTCSessionDescription(offer)).then(function () {
      return _pc.createAnswer();
    }).then(function (answer) {
      return _pc.setLocalDescription(answer);
    }).then(function () {
      return _waitForIce(_pc);
    }).then(function () {
      var sdp = JSON.stringify({
        sdp: _pc.localDescription.sdp,
        type: _pc.localDescription.type
      });
      UI.showAnswerText(sdp);
      UI.toast('✅ 请复制 Answer 发回给发送方', 'success');
    }).catch(function (err) {
      console.error('Receiver setup failed:', err);
      UI.toast('连接失败: ' + err.message, 'error');
    });

    _pc.oniceconnectionstatechange = function () {
      console.log('Recv ICE:', _pc.iceConnectionState);
      if (_pc.iceConnectionState === 'connected' || _pc.iceConnectionState === 'completed') {
        UI.setConnStatus('connected', 'P2P 已连接！等待接收...');
      }
    };
  }

  function copyAnswer() {
    var ta = document.getElementById('recv-answer-text');
    ta.select(); ta.setSelectionRange(0, 99999);
    try {
      navigator.clipboard.writeText(ta.value);
      UI.toast('Answer 已复制！去微信发回给发送方 📋', 'success');
    } catch (e) {
      UI.toast('请手动全选复制上方文本', 'warning');
    }
  }

  function _setupReceiverChannel(dc) {
    var cur = null, chunks = [], recvSize = 0;
    var fc = 0, ec = 0, totalRcvd = 0, totalExp = 0;

    dc.onopen = function () {
      UI.setConnStatus('connected', '已连接，等待接收文件...');
    };

    dc.onmessage = function (event) {
      var data = event.data;

      if (data instanceof ArrayBuffer) {
        var arr = new Uint8Array(data);
        chunks.push(arr);
        recvSize += arr.byteLength;
        totalRcvd += arr.byteLength;
        if (cur && cur.size > 0) {
          UI.updateRecvProgress(Math.round(recvSize / cur.size * 100), cur.name);
        }
        if (totalExp > 0) {
          UI.setConnStatus('connected', '接收中 ' + Math.round(totalRcvd / totalExp * 100) + '%');
        }
        return;
      }

      if (typeof data !== 'string') return;
      var msg;
      try { msg = JSON.parse(data); } catch (e) { return; }

      switch (msg.type) {
        case 'metadata':
          totalExp = msg.totalSize; ec = msg.count;
          UI.showReceiverReceiving();
          UI.updateRecvProgress(0, '准备接收 ' + msg.count + ' 张图片...');
          break;
        case 'file-start':
          cur = msg; chunks = []; recvSize = 0;
          UI.updateRecvProgress(0, msg.name);
          break;
        case 'file-end':
          if (cur && chunks.length > 0) {
            _receivedImages.push({
              name: cur.name,
              blob: new Blob(chunks, { type: cur.mime || 'application/octet-stream' }),
              size: cur.size
            });
            fc++;
            UI.setConnStatus('connected', '接收 ' + fc + '/' + ec);
          }
          cur = null; chunks = []; recvSize = 0;
          break;
        case 'complete':
          _transferComplete = true;
          UI.setConnStatus('connected', '接收完成 ✅');
          UI.showReceiverComplete(_receivedImages);
          UI.toast('✅ 收到 ' + _receivedImages.length + ' 张原图！', 'success');
          break;
        case 'error':
          UI.toast('发送方出错: ' + msg.message, 'error');
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

  // ================================================================
  //  HELPERS
  // ================================================================

  function _waitForIce(pc) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }

      var timeout = setTimeout(function () {
        console.log('ICE gathering timeout, using collected candidates');
        resolve();
      }, 4000);

      pc.onicegatheringstatechange = function () {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          resolve();
        }
      };
    });
  }

  return {
    init: init,
    senderStart: senderStart,
    receiverStart: receiverStart,
    getReceivedImages: function () { return _receivedImages.slice(); },
    saveAllImages: function () {
      if (!_receivedImages.length) { UI.toast('没有可保存的图片', 'warning'); return; }
      PIX.ImageViewer.downloadAll(_receivedImages);
    }
  };
})();
