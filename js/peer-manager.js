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
  var _receivedImages = []; // { name, blob, size }
  var _totalRecvSize = 0;
  var _totalRecvExpected = 0;

  var CHUNK_SIZE = 16 * 1024; // 16KB per data channel message

  // ---- Init ----
  function init() {
    document.getElementById('btn-share').addEventListener('click', startSharing);
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
  }

  // ---- Sender: Start Sharing ----
  function startSharing() {
    var files = PIX.FileHandler.getFiles();
    if (!files.length) { UI.toast('请先选择图片', 'warning'); return; }

    _isSender = true;
    _sessionId = U.generateSessionId();
    UI.setConnStatus('connecting', '连接中...');

    _peer = new Peer(_sessionId, {
      debug: 0
      // PeerJS uses 0.peerjs.com signaling server by default
    });

    _peer.on('open', function () {
      UI.setConnStatus('connected', '等待好友连接');
      UI.showActiveShare(_sessionId);
    });

    _peer.on('connection', function (conn) {
      _conn = conn;
      _setupConnection(conn, files);
    });

    _peer.on('error', function (err) {
      console.error('Peer error:', err);
      UI.setConnStatus('disconnected', '连接失败');
      UI.toast('连接失败: ' + (err.message || err.type), 'error');
    });

    _peer.on('disconnected', function () {
      UI.setConnStatus('disconnected', '已断开');
    });
  }

  function _setupConnection(conn, files) {
    conn.on('open', function () {
      UI.setConnStatus('connected', '已连接，正在发送...');
      UI.showSendProgress();
      _sendFiles(conn, files);
    });

    conn.on('data', function (data) {
      // Sender might receive ack or status from receiver
      if (data === 'received-all') {
        UI.updateSendProgress(100, '全部发送完成！');
        UI.toast('✅ 全部发送完成！', 'success');
        setTimeout(function () { UI.hideSendProgress(); }, 2000);
      }
    });

    conn.on('close', function () {
      UI.setConnStatus('disconnected', '连接已关闭');
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

    // Send metadata first
    conn.send(JSON.stringify({
      type: 'metadata',
      files: files.map(function (f) { return { name: f.displayName, size: f.size, mime: f.type }; }),
      totalSize: totalSize,
      count: files.length
    }));

    // Send files one by one
    var currentIdx = 0;
    function sendNext() {
      if (currentIdx >= files.length) {
        conn.send(JSON.stringify({ type: 'complete' }));
        UI.updateSendProgress(100, '全部发送完成！');
        UI.toast('✅ ' + files.length + ' 张图片发送完成！', 'success');
        return;
      }
      var f = files[currentIdx];
      UI.updateSendProgress(0, f.displayName);

      // Read file as ArrayBuffer
      f.file.arrayBuffer().then(function (buffer) {
        var size = buffer.byteLength;
        // Send file-start
        conn.send(JSON.stringify({ type: 'file-start', name: f.displayName, size: size, index: currentIdx }));

        // Send chunks
        var offset = 0;
        function sendChunk() {
          if (offset >= size) {
            conn.send(JSON.stringify({ type: 'file-end', index: currentIdx }));
            sentBytes += size;
            var pct = Math.round(sentBytes / totalSize * 100);
            UI.updateSendProgress(pct);
            currentIdx++;
            // Small delay to avoid flooding the data channel
            setTimeout(sendNext, 50);
            return;
          }
          var end = Math.min(offset + CHUNK_SIZE, size);
          var chunk = buffer.slice(offset, end);
          conn.send(chunk);
          offset = end;
          // Respect backpressure
          if (conn.bufferSize > CHUNK_SIZE * 4) {
            setTimeout(sendChunk, 100);
          } else {
            sendChunk();
          }
        }
        sendChunk();
      }).catch(function (err) {
        console.error('Read error:', err);
        conn.send(JSON.stringify({ type: 'error', message: 'Failed to read file: ' + f.displayName }));
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
        UI.showReceiverError('发送方不在线（可能已关闭页面）。请确认发送方还在等待，然后重试。');
      } else {
        UI.showReceiverError('连接失败: ' + (err.message || err.type));
      }
    });
  }

  function _setupReceiverConnection(conn) {
    var currentFile = null, chunks = [], receivedSize = 0;
    var fileCount = 0, expectedCount = 0;
    var totalReceived = 0, totalExpected = 0;
    var buffer = new Uint8Array(0);

    conn.on('open', function () {
      UI.setConnStatus('connected', '已连接，等待接收...');
    });

    conn.on('data', function (data) {
      // Binary data = file chunk
      if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        var arr = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
        chunks.push(arr);
        receivedSize += arr.byteLength;
        totalReceived += arr.byteLength;
        if (currentFile && currentFile.size > 0) {
          var pct = Math.round(receivedSize / currentFile.size * 100);
          UI.updateRecvProgress(pct, currentFile.name);
          if (totalExpected > 0) {
            var overall = Math.round(totalReceived / totalExpected * 100);
            UI.setConnStatus('connected', '接收中 ' + overall + '%');
          }
        }
        return;
      }

      // String data = JSON message
      if (typeof data === 'string') {
        try { var msg = JSON.parse(data); } catch (e) { return; }

        switch (msg.type) {
          case 'metadata':
            _totalRecvExpected = msg.totalSize;
            totalExpected = msg.totalSize;
            expectedCount = msg.count;
            UI.showReceiverReceiving();
            UI.updateRecvProgress(0, '准备接收 ' + msg.count + ' 张图片...');
            break;

          case 'file-start':
            currentFile = msg;
            chunks = [];
            receivedSize = 0;
            UI.updateRecvProgress(0, msg.name);
            break;

          case 'file-end':
            if (currentFile && chunks.length > 0) {
              // Combine chunks
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
            conn.send('received-all');
            break;

          case 'error':
            UI.toast('发送方出错: ' + msg.message, 'error');
            break;
        }
      }
    });

    conn.on('close', function () {
      UI.setConnStatus('disconnected', '连接已关闭');
      if (_receivedImages.length > 0 && !document.getElementById('receiver-complete').classList.contains('hidden')) {
        // Already completed, do nothing
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

    // Create a peer with manual connection
    _sessionId = U.generateSessionId();
    _peer = new Peer(_sessionId, { debug: 0 });

    _peer.on('open', function () {
      UI.showActiveShare(_sessionId);
    });

    _peer.on('connection', function (conn) {
      _conn = conn;
      _setupConnection(conn, files);
    });

    UI.showManualSignal('等待好友连接... 如果自动连接失败，请使用上面的链接。');
  }

  function submitManualAnswer() {
    var answerText = UI.getAnswerText();
    if (!answerText) { UI.toast('请粘贴好友的 Answer', 'warning'); return; }
    UI.toast('Manual answer submitted (not fully implemented, use auto mode)');
  }

  // ---- Save All (Receiver) ----
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
