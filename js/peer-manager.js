/**
 * peer-manager.js — WebRTC P2P connection and file transfer via PeerJS
 * The core of PixShare.
 */
PIX.PeerManager = (function () {
  'use strict';
  var U = PIX.Utils, UI = PIX.UI;

  var _peer = null;
  var _conn = null;
  var _isSender = false;
  var _sessionId = null;
  var _pendingFiles = null;        // Saved for reconnect after background
  var _receivedImages = [];
  var _totalRecvSize = 0;
  var _totalRecvExpected = 0;
  var _transferComplete = false;
  var _reconnectTimer = null;

  var CHUNK_SIZE = 16 * 1024;

  // ---- Init ----
  function init() {
    document.getElementById('btn-share').addEventListener('click', startSharing);

    // Share button (uses Web Share API)
    document.getElementById('btn-share-link').addEventListener('click', shareLink);

    // Copy button (fallback)
    document.getElementById('btn-copy-link').addEventListener('click', function () {
      var inp = document.getElementById('share-link-input');
      inp.select(); inp.setSelectionRange(0, 99999);
      try { navigator.clipboard.writeText(inp.value); UI.toast('链接已复制！发送给好友', 'success'); }
      catch (e) { UI.toast('请手动复制链接', 'warning'); }
    });

    document.getElementById('btn-manual-signal').addEventListener('click', startManualSignal);
    document.getElementById('btn-copy-offer').addEventListener('click', function () {
      var ta = document.getElementById('manual-offer');
      ta.select();
      try { navigator.clipboard.writeText(ta.value); UI.toast('Offer 已复制！发给好友', 'success'); }
      catch (e) { UI.toast('请手动复制', 'warning'); }
    });
    document.getElementById('btn-submit-answer').addEventListener('click', submitManualAnswer);
    document.getElementById('btn-retry').addEventListener('click', function () {
      var peerId = _sessionId;
      if (peerId) joinSession(peerId);
    });

    // Auto-reconnect when page becomes visible again
    _setupVisibilityHandler();
  }

  // ---- Page visibility: auto-restore connection after switching apps ----
  function _setupVisibilityHandler() {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return; // Going to background — do nothing

      // Coming back to foreground
      console.log('PixShare: page visible again, sender=' + _isSender + ', peer=' + !!_peer + ', conn=' + !!_conn);
      if (!_isSender) return; // Only sender needs to re-establish listener
      if (_transferComplete) return; // Already done

      // If peer is destroyed/disconnected, re-create it
      if (_peer && !_peer.destroyed && (_peer.disconnected || !_conn)) {
        console.log('PixShare: peer disconnected, re-creating...');
        UI.setConnStatus('connecting', '重新连接中...');
        _recreatePeer();
        return;
      }

      // If peer was destroyed (e.g. idle timeout), recreate
      if (!_peer || _peer.destroyed) {
        console.log('PixShare: peer destroyed, re-creating...');
        UI.setConnStatus('connecting', '重新连接中...');
        _recreatePeer();
        return;
      }
    });
  }

  function _recreatePeer() {
    if (!_sessionId || !_pendingFiles) return;
    // Destroy old peer if exists
    try { if (_peer && !_peer.destroyed) _peer.destroy(); } catch (e) {}
    _peer = null;

    _peer = new Peer(_sessionId, { debug: 0 });

    _peer.on('open', function () {
      UI.setConnStatus('connected', '等待好友连接');
      UI.showActiveShare(_sessionId);
    });

    _peer.on('connection', function (conn) {
      _conn = conn;
      _setupConnection(conn, _pendingFiles);
    });

    _peer.on('error', function (err) {
      console.error('Peer error:', err);
      UI.setConnStatus('disconnected', '连接失败');
    });

    _peer.on('disconnected', function () {
      UI.setConnStatus('disconnected', '连接断开（切回本页面自动恢复）');
    });
  }

  // ---- Share Link via Web Share API (no need to leave browser) ----
  function shareLink() {
    if (!_sessionId) { UI.toast('请先生成链接', 'warning'); return; }
    var url = U.getShareUrl(_sessionId);
    var text = '📸 用 PixShare 接收原图，画质无损！打开：' + url;
    if (navigator.share) {
      navigator.share({ title: 'PixShare 传图', text: text, url: url })
        .then(function () { UI.toast('已分享！等待好友打开链接...', 'success'); })
        .catch(function (err) {
          if (err.name !== 'AbortError') {
            // Fallback to copy
            _fallbackCopy(url);
          }
        });
    } else {
      _fallbackCopy(url);
    }
  }

  function _fallbackCopy(url) {
    try {
      navigator.clipboard.writeText(url);
      UI.toast('链接已复制！请切换到微信粘贴发给好友', 'success');
    } catch (e) {
      UI.toast('请手动复制链接发给好友', 'warning');
    }
  }

  // ---- Sender: Start Sharing ----
  function startSharing() {
    var files = PIX.FileHandler.getFiles();
    if (!files.length) { UI.toast('请先选择图片', 'warning'); return; }

    _isSender = true;
    _pendingFiles = files;
    _transferComplete = false;
    _sessionId = U.generateSessionId();
    UI.setConnStatus('connecting', '连接中...');

    _peer = new Peer(_sessionId, { debug: 0 });

    _peer.on('open', function () {
      UI.setConnStatus('connected', '等待好友连接');
      UI.showActiveShare(_sessionId);
      // Auto-trigger share on mobile
      if (U.isMobile() && navigator.share) {
        setTimeout(function () { shareLink(); }, 500);
      }
    });

    _peer.on('connection', function (conn) {
      _conn = conn;
      _setupConnection(conn, files);
    });

    _peer.on('error', function (err) {
      console.error('Peer error:', err);
      UI.setConnStatus('disconnected', '出错');
      UI.toast('连接出错: ' + (err.message || err.type), 'error');
    });

    _peer.on('disconnected', function () {
      UI.setConnStatus('disconnected', '连接断开（切回本页面自动恢复）');
    });
  }

  function _setupConnection(conn, files) {
    conn.on('open', function () {
      UI.setConnStatus('connected', '已连接，正在发送...');
      UI.showSendProgress();
      _sendFiles(conn, files);
    });

    conn.on('data', function (data) {
      if (data === 'received-all') {
        _transferComplete = true;
        UI.updateSendProgress(100, '全部发送完成！');
        UI.setConnStatus('connected', '发送完成');
        UI.toast('✅ 全部发送完成！', 'success');
        setTimeout(function () { UI.hideSendProgress(); }, 2000);
      }
    });

    conn.on('close', function () {
      if (!_transferComplete) {
        UI.setConnStatus('disconnected', '连接关闭（切回本页面自动恢复）');
      }
    });

    conn.on('error', function (err) {
      console.error('Connection error:', err);
      UI.toast('传输出错', 'error');
    });
  }

  // ---- File Sending Protocol ----
  function _sendFiles(conn, files) {
    var totalSize = 0;
    for (var i = 0; i < files.length; i++) totalSize += files[i].size;
    var sentBytes = 0;

    conn.send(JSON.stringify({
      type: 'metadata',
      files: files.map(function (f) { return { name: f.displayName, size: f.size, mime: f.type }; }),
      totalSize: totalSize,
      count: files.length
    }));

    var currentIdx = 0;
    function sendNext() {
      if (currentIdx >= files.length) {
        conn.send(JSON.stringify({ type: 'complete' }));
        _transferComplete = true;
        UI.updateSendProgress(100, '全部发送完成！');
        UI.setConnStatus('connected', '发送完成');
        UI.toast('✅ ' + files.length + ' 张图片发送完成！', 'success');
        return;
      }
      var f = files[currentIdx];
      UI.updateSendProgress(0, f.displayName);

      f.file.arrayBuffer().then(function (buffer) {
        var size = buffer.byteLength;
        conn.send(JSON.stringify({ type: 'file-start', name: f.displayName, size: size, index: currentIdx }));

        var offset = 0;
        function sendChunk() {
          if (offset >= size) {
            conn.send(JSON.stringify({ type: 'file-end', index: currentIdx }));
            sentBytes += size;
            var pct = Math.round(sentBytes / totalSize * 100);
            UI.updateSendProgress(pct);
            currentIdx++;
            setTimeout(sendNext, 50);
            return;
          }
          var end = Math.min(offset + CHUNK_SIZE, size);
          conn.send(buffer.slice(offset, end));
          offset = end;
          if (conn.bufferSize > CHUNK_SIZE * 4) {
            setTimeout(sendChunk, 100);
          } else {
            sendChunk();
          }
        }
        sendChunk();
      }).catch(function (err) {
        console.error('Read error:', err);
        conn.send(JSON.stringify({ type: 'error', message: '无法读取: ' + f.displayName }));
      });
    }
    sendNext();
  }

  // ---- Receiver: Join Session ----
  function joinSession(peerId) {
    _isSender = false;
    _sessionId = peerId;
    _receivedImages = [];
    _totalRecvSize = 0;
    _totalRecvExpected = 0;

    UI.showReceiverConnecting(peerId);
    UI.setConnStatus('connecting', '连接中...');

    _peer = new Peer({ debug: 0 });

    _peer.on('open', function () {
      UI.setConnStatus('connecting', '正在加入...');
      var conn = _peer.connect(peerId, { reliable: true });
      _conn = conn;
      _setupReceiverConnection(conn);
    });

    _peer.on('error', function (err) {
      console.error('Receiver peer error:', err);
      UI.setConnStatus('disconnected', '连接失败');
      if (err.type === 'peer-unavailable') {
        UI.showReceiverError('发送方暂不在线。可能对方切到了微信，请对方切回浏览器即可自动恢复。');
      } else {
        UI.showReceiverError('连接失败: ' + (err.message || err.type));
      }
    });
  }

  function _setupReceiverConnection(conn) {
    var currentFile = null, chunks = [], receivedSize = 0;
    var fileCount = 0, expectedCount = 0;
    var totalReceived = 0, totalExpected = 0;

    conn.on('open', function () {
      UI.setConnStatus('connected', '已连接，等待接收...');
    });

    conn.on('data', function (data) {
      if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        var arr = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
        chunks.push(arr);
        receivedSize += arr.byteLength;
        totalReceived += arr.byteLength;
        if (currentFile && currentFile.size > 0) {
          var pct = Math.round(receivedSize / currentFile.size * 100);
          UI.updateRecvProgress(pct, currentFile.name);
          if (totalExpected > 0) {
            UI.setConnStatus('connected', '接收中 ' + Math.round(totalReceived / totalExpected * 100) + '%');
          }
        }
        return;
      }

      if (typeof data === 'string') {
        try { var msg = JSON.parse(data); } catch (e) { return; }

        switch (msg.type) {
          case 'metadata':
            _totalRecvExpected = msg.totalSize;
            totalExpected = msg.totalSize;
            expectedCount = msg.count;
            UI.showReceiverReceiving();
            UI.updateRecvProgress(0, '准备接收 ' + msg.count + ' 张...');
            break;

          case 'file-start':
            currentFile = msg;
            chunks = [];
            receivedSize = 0;
            UI.updateRecvProgress(0, msg.name);
            break;

          case 'file-end':
            if (currentFile && chunks.length > 0) {
              var blob = new Blob(chunks, { type: currentFile.mime || 'application/octet-stream' });
              _receivedImages.push({ name: currentFile.name, blob: blob, size: blob.size });
              fileCount++;
              UI.setConnStatus('connected', '接收中 (' + fileCount + '/' + expectedCount + ')');
            }
            currentFile = null;
            chunks = [];
            receivedSize = 0;
            break;

          case 'complete':
            UI.setConnStatus('connected', '接收完成');
            UI.showReceiverComplete(_receivedImages);
            UI.toast('✅ 收到 ' + _receivedImages.length + ' 张原图！', 'success');
            try { conn.send('received-all'); } catch (e) {}
            break;

          case 'error':
            UI.toast('发送方出错: ' + msg.message, 'error');
            break;
        }
      }
    });

    conn.on('close', function () {
      UI.setConnStatus('disconnected', '连接关闭');
      if (_receivedImages.length > 0 && !document.getElementById('receiver-complete').classList.contains('hidden')) {
        // Already completed
      } else if (_receivedImages.length > 0) {
        UI.showReceiverComplete(_receivedImages);
        UI.toast('连接已关闭，但已接收 ' + _receivedImages.length + ' 张图片', 'warning');
      }
    });

    conn.on('error', function (err) {
      console.error('Receiver conn error:', err);
      if (_receivedImages.length === 0) UI.showReceiverError('传输中断');
    });
  }

  // ---- Manual Signaling ----
  function startManualSignal() {
    var files = PIX.FileHandler.getFiles();
    if (!files.length) return;
    _isSender = true;
    _pendingFiles = files;
    _sessionId = U.generateSessionId();
    _peer = new Peer(_sessionId, { debug: 0 });

    _peer.on('open', function () {
      UI.showActiveShare(_sessionId);
    });

    _peer.on('connection', function (conn) {
      _conn = conn;
      _setupConnection(conn, files);
    });

    UI.showManualSignal('等待好友连接... 自动连接失败请用上面的链接。');
  }

  function submitManualAnswer() {
    var answerText = UI.getAnswerText();
    if (!answerText) { UI.toast('请粘贴好友的 Answer', 'warning'); return; }
    UI.toast('请优先使用自动连接模式', 'warning');
  }

  function saveAllImages() {
    if (!_receivedImages.length) { UI.toast('没有可保存的图片', 'warning'); return; }
    PIX.ImageViewer.downloadAll(_receivedImages);
  }

  // ---- Public ----
  function isSender() { return _isSender; }
  function getReceivedImages() { return _receivedImages.slice(); }

  return {
    init: init,
    startSharing: startSharing,
    joinSession: joinSession,
    isSender: isSender,
    getReceivedImages: getReceivedImages,
    saveAllImages: saveAllImages
  };
})();
