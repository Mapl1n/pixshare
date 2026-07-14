/**
 * peer-manager.js — WebRTC P2P via PeerJS with robust reconnect
 */
PIX.PeerManager = (function () {
  'use strict';
  var U = PIX.Utils, UI = PIX.UI;

  var _peer = null, _conn = null;
  var _isSender = false;
  var _sessionId = null;
  var _pendingFiles = null;
  var _receivedImages = [];
  var _transferComplete = false;
  var _cleanup = false;

  // Retry timers
  var _senderReconTimer = null;
  var _recvRetryTimer = null;
  var _recvRetryCount = 0;
  var MAX_RETRIES = 120; // ~4 min at 2s intervals
  var CHUNK_SIZE = 16 * 1024;

  // ---- Init ----
  function init() {
    document.getElementById('btn-share').addEventListener('click', startSharing);
    document.getElementById('btn-share-link').addEventListener('click', shareLink);
    document.getElementById('btn-copy-link').addEventListener('click', copyLink);
    document.getElementById('btn-manual-signal').addEventListener('click', startManualSignal);
    document.getElementById('btn-copy-offer').addEventListener('click', function () {
      var ta = document.getElementById('manual-offer');
      ta.select();
      try { navigator.clipboard.writeText(ta.value); UI.toast('Offer 已复制', 'success'); }
      catch (e) { UI.toast('请手动复制', 'warning'); }
    });
    document.getElementById('btn-submit-answer').addEventListener('click', submitManualAnswer);
    document.getElementById('btn-retry').addEventListener('click', function () {
      if (_sessionId) joinSession(_sessionId);
    });

    _setupVisibility();
    _setupUnload();
  }

  // ---- Visibility: sender re-registers on return ----
  function _setupVisibility() {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (_transferComplete) return;
      if (!_sessionId) return;

      console.log('visible: sender=' + _isSender + ' peerAlive=' + (_peer && !_peer.destroyed));

      if (_isSender) {
        _senderReconnect();
      } else {
        // Receiver: if not connected, restart retry loop
        if (_recvRetryTimer && _receivedImages.length === 0) {
          _recvRetry();
        }
      }
    });
  }

  function _setupUnload() {
    window.addEventListener('pagehide', function () { _cleanup = true; });
    window.addEventListener('beforeunload', function () { _cleanup = true; });
  }

  // ---- Robust sender reconnect ----
  function _senderReconnect() {
    if (!_sessionId || !_pendingFiles) return;
    clearTimeout(_senderReconTimer);

    function tryRecreate(attempt) {
      if (_cleanup) return;
      UI.setConnStatus('connecting', '重新上线中...');

      // Kill old peer
      _killPeer();

      _peer = new Peer(_sessionId, { debug: 0 });

      _peer.on('open', function () {
        clearTimeout(_senderReconTimer);
        console.log('Sender peer open:', _sessionId);
        UI.setConnStatus('connected', '等待好友连接');
        UI.showActiveShare(_sessionId);
      });

      _peer.on('connection', function (conn) {
        _conn = conn;
        _setupConnection(conn, _pendingFiles);
      });

      _peer.on('error', function (err) {
        console.warn('Sender error:', err.type, 'attempt', attempt);
        if (err.type === 'unavailable-id') {
          // Old ghost still registered — wait longer and retry
          _killPeer();
          if (attempt < 10) {
            UI.setConnStatus('connecting', '等待旧连接释放...(' + (attempt + 1) + '/10)');
            _senderReconTimer = setTimeout(function () { tryRecreate(attempt + 1); }, 3000);
          } else {
            // Give up on old ID, generate new one
            _sessionId = U.generateSessionId();
            _saveSession();
            UI.toast('会话已刷新，请重新分享链接给好友', 'warning');
            tryRecreate(0);
          }
          return;
        }
        // Other errors: retry
        if (attempt < 5) {
          _senderReconTimer = setTimeout(function () { tryRecreate(attempt + 1); }, 2000);
        } else {
          UI.setConnStatus('disconnected', '连接失败');
          UI.toast('连接失败，请刷新页面重试', 'error');
        }
      });

      _peer.on('disconnected', function () {
        if (!_transferComplete && !_cleanup) {
          UI.setConnStatus('disconnected', '断开（切回自动恢复）');
          _senderReconTimer = setTimeout(function () { tryRecreate(0); }, 2000);
        }
      });
    }

    tryRecreate(0);
  }

  function _killPeer() {
    try { if (_conn) { _conn.close(); } } catch (e) {}
    _conn = null;
    try { if (_peer && !_peer.destroyed) _peer.destroy(); } catch (e) {}
    _peer = null;
  }

  // ---- Share link persistence ----
  function _saveSession() {
    try {
      sessionStorage.setItem('pixshare_id', _sessionId);
      sessionStorage.setItem('pixshare_sender', _isSender ? '1' : '0');
    } catch (e) {}
  }

  function _loadSession() {
    try {
      var id = sessionStorage.getItem('pixshare_id');
      var sender = sessionStorage.getItem('pixshare_sender');
      return id ? { id: id, isSender: sender === '1' } : null;
    } catch (e) { return null; }
  }

  // ---- Share Link ----
  function shareLink() {
    if (!_sessionId) { UI.toast('请先生成链接', 'warning'); return; }
    var url = U.getShareUrl(_sessionId);
    var text = '📸 接收原图（画质无损）：' + url;
    if (navigator.share) {
      navigator.share({ title: 'PixShare 传图', text: text, url: url })
        .then(function () {
          UI.toast('已分享！等待好友打开链接...', 'success');
        })
        .catch(function (err) {
          if (err.name !== 'AbortError') copyLink();
        });
    } else {
      copyLink();
    }
  }

  function copyLink() {
    var inp = document.getElementById('share-link-input');
    try {
      inp.select(); inp.setSelectionRange(0, 99999);
      navigator.clipboard.writeText(inp.value);
      UI.toast('链接已复制！发到微信给好友 📋', 'success');
    } catch (e) {
      UI.toast('请手动长按复制链接发给好友', 'warning');
    }
  }

  // ---- Sender: Start Sharing ----
  function startSharing() {
    var files = PIX.FileHandler.getFiles();
    if (!files.length) { UI.toast('请先选择图片', 'warning'); return; }

    _isSender = true;
    _pendingFiles = files;
    _transferComplete = false;
    _cleanup = false;
    clearTimeout(_senderReconTimer);

    // Check for existing session (from page hide/show)
    var existing = _loadSession();
    if (existing && existing.isSender) {
      _sessionId = existing.id;
    } else {
      _sessionId = U.generateSessionId();
    }
    _saveSession();

    UI.setConnStatus('connecting', '连接中...');

    _peer = new Peer(_sessionId, { debug: 0 });

    _peer.on('open', function () {
      console.log('Sender open:', _sessionId);
      UI.setConnStatus('connected', '等待好友连接');
      UI.showActiveShare(_sessionId);
      // Auto-share on mobile
      if (U.isMobile() && navigator.share) {
        setTimeout(function () { shareLink(); }, 600);
      }
    });

    _peer.on('connection', function (conn) {
      console.log('Sender got connection');
      _conn = conn;
      _setupConnection(conn, files);
    });

    _peer.on('error', function (err) {
      console.error('Sender error:', err.type);
      if (err.type === 'unavailable-id') {
        // Retry with new ID
        _sessionId = U.generateSessionId();
        _saveSession();
        _killPeer();
        UI.toast('会话 ID 冲突，已自动刷新', 'warning');
        startSharing();
        return;
      }
      UI.setConnStatus('disconnected', '出错');
      UI.toast('连接出错: ' + err.type, 'error');
    });

    _peer.on('disconnected', function () {
      if (!_transferComplete && !_cleanup) {
        UI.setConnStatus('disconnected', '断开（切回自动恢复）');
      }
    });
  }

  function _setupConnection(conn, files) {
    conn.on('open', function () {
      console.log('Connection open, sending...');
      UI.setConnStatus('connected', '正在发送...');
      UI.showSendProgress();
      _sendFiles(conn, files);
    });

    conn.on('data', function (data) {
      if (data === 'received-all') {
        _transferComplete = true;
        UI.updateSendProgress(100, '全部发送完成！');
        UI.setConnStatus('connected', '发送完成 ✅');
        UI.toast('✅ 全部发送完成！', 'success');
      }
    });

    conn.on('close', function () {
      if (!_transferComplete && !_cleanup) {
        UI.setConnStatus('disconnected', '连接断开（对方重新进入即可恢复）');
      }
    });

    conn.on('error', function () {
      if (!_cleanup) UI.toast('传输出错，重试中...', 'warning');
    });
  }

  // ---- File Sending ----
  function _sendFiles(conn, files) {
    var totalSize = 0, sentBytes = 0;
    for (var i = 0; i < files.length; i++) totalSize += files[i].size;

    conn.send(JSON.stringify({
      type: 'metadata',
      files: files.map(function (f) { return { name: f.displayName, size: f.size, mime: f.type }; }),
      totalSize: totalSize, count: files.length
    }));

    var idx = 0;
    function sendNext() {
      if (idx >= files.length) {
        conn.send(JSON.stringify({ type: 'complete' }));
        _transferComplete = true;
        UI.updateSendProgress(100, '全部发送完成！');
        UI.setConnStatus('connected', '发送完成 ✅');
        return;
      }
      var f = files[idx];
      UI.updateSendProgress(0, f.displayName);
      f.file.arrayBuffer().then(function (buf) {
        var size = buf.byteLength;
        conn.send(JSON.stringify({ type: 'file-start', name: f.displayName, size: size, index: idx }));
        var off = 0;
        function chunk() {
          if (off >= size) {
            conn.send(JSON.stringify({ type: 'file-end', index: idx }));
            sentBytes += size;
            UI.updateSendProgress(Math.round(sentBytes / totalSize * 100));
            idx++; setTimeout(sendNext, 30);
            return;
          }
          conn.send(buf.slice(off, Math.min(off + CHUNK_SIZE, size)));
          off += CHUNK_SIZE;
          if (conn.bufferSize > CHUNK_SIZE * 4) setTimeout(chunk, 80);
          else chunk();
        }
        chunk();
      }).catch(function (e) {
        conn.send(JSON.stringify({ type: 'error', message: '读取失败: ' + f.displayName }));
      });
    }
    sendNext();
  }

  // ---- Receiver: Join Session ----
  function joinSession(peerId) {
    _isSender = false;
    _sessionId = peerId;
    _receivedImages = [];
    _transferComplete = false;
    _cleanup = false;
    _recvRetryCount = 0;
    clearTimeout(_recvRetryTimer);
    _killPeer();

    UI.showReceiverConnecting(peerId);
    UI.setConnStatus('connecting', '连接中...');
    _recvRetry();
  }

  function _recvRetry() {
    if (_cleanup || _transferComplete) return;
    if (_recvRetryCount >= MAX_RETRIES) {
      UI.showReceiverError('连接超时。请确认发送方已打开页面，然后点重试。');
      UI.setConnStatus('disconnected', '连接超时');
      return;
    }

    _recvRetryCount++;
    _killPeer();

    _peer = new Peer({ debug: 0 });

    _peer.on('open', function () {
      var conn = _peer.connect(_sessionId, { reliable: true });
      _conn = conn;
      _setupReceiver(conn);
    });

    _peer.on('error', function (err) {
      console.warn('Recv error:', err.type, 'try', _recvRetryCount);
      _killPeer();
      if (err.type === 'peer-unavailable') {
        UI.setConnStatus('connecting', '等待发送方上线 (' + _recvRetryCount + ')');
      } else {
        UI.setConnStatus('connecting', '重试中 (' + _recvRetryCount + ')');
      }
      _recvRetryTimer = setTimeout(_recvRetry, 2000);
    });

    _peer.on('disconnected', function () {
      if (!_transferComplete && !_cleanup && _receivedImages.length === 0) {
        _recvRetryTimer = setTimeout(_recvRetry, 1500);
      }
    });
  }

  function _setupReceiver(conn) {
    var cur = null, chunks = [], recvSize = 0;
    var fc = 0, ec = 0, totalRcvd = 0, totalExp = 0;

    conn.on('open', function () {
      console.log('Receiver connected!');
      clearTimeout(_recvRetryTimer);
      _recvRetryCount = 0;
      UI.setConnStatus('connected', '已连接，等待接收...');
    });

    conn.on('data', function (data) {
      if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        var a = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
        chunks.push(a); recvSize += a.byteLength; totalRcvd += a.byteLength;
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
          UI.updateRecvProgress(0, '准备接收 ' + msg.count + ' 张...');
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
          clearTimeout(_recvRetryTimer);
          UI.setConnStatus('connected', '接收完成 ✅');
          UI.showReceiverComplete(_receivedImages);
          try { conn.send('received-all'); } catch (e) {}
          break;
      }
    });

    conn.on('close', function () {
      if (!_transferComplete && _receivedImages.length > 0) {
        UI.showReceiverComplete(_receivedImages);
        UI.toast('连接关闭，已接收 ' + _receivedImages.length + ' 张', 'warning');
      } else if (!_transferComplete && _receivedImages.length === 0 && !_cleanup) {
        UI.setConnStatus('connecting', '重连中...');
        _recvRetryTimer = setTimeout(_recvRetry, 2000);
      }
    });

    conn.on('error', function () {
      if (_receivedImages.length === 0 && !_cleanup) {
        _recvRetryTimer = setTimeout(_recvRetry, 2000);
      }
    });
  }

  // ---- Manual ----
  function startManualSignal() {
    var files = PIX.FileHandler.getFiles();
    if (!files.length) return;
    _isSender = true; _pendingFiles = files; _cleanup = false;
    _sessionId = U.generateSessionId(); _saveSession();
    _peer = new Peer(_sessionId, { debug: 0 });
    _peer.on('open', function () { UI.showActiveShare(_sessionId); });
    _peer.on('connection', function (conn) { _conn = conn; _setupConnection(conn, files); });
  }

  function submitManualAnswer() {
    if (!UI.getAnswerText()) { UI.toast('请粘贴好友的 Answer', 'warning'); return; }
    UI.toast('请优先使用上面的自动连接链接', 'warning');
  }

  return {
    init: init,
    startSharing: startSharing,
    joinSession: joinSession,
    isSender: function () { return _isSender; },
    getReceivedImages: function () { return _receivedImages.slice(); },
    saveAllImages: function () {
      if (!_receivedImages.length) { UI.toast('没有可保存的图片', 'warning'); return; }
      PIX.ImageViewer.downloadAll(_receivedImages);
    }
  };
})();
