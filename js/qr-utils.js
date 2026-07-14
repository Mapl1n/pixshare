/**
 * qr-utils.js — QR code generation and scanning for PixShare
 * Depends on: qrcode-generator (global QRCode), jsQR (global jsQR)
 */
PIX.QR = (function () {
  'use strict';

  // ---- QR Generation ----
  function generateQRCode(text, container) {
    // Use qrcode-generator library
    var typeNumber = 0; // auto-detect
    var qr;
    try {
      qr = QRCode(typeNumber, 'M'); // M-level error correction
      qr.addData(text);
      qr.make();
    } catch (e) {
      // Try lower error correction or smaller size
      try {
        qr = QRCode(typeNumber, 'L');
        qr.addData(text);
        qr.make();
      } catch (e2) {
        console.error('QR generation failed:', e2);
        return false;
      }
    }

    var size = Math.min(280, Math.max(180, container.clientWidth - 32));
    var cellSize = Math.floor(size / qr.getModuleCount());
    var padding = 8;

    // Use canvas for rendering
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    var totalSize = cellSize * qr.getModuleCount() + padding * 2;
    canvas.width = totalSize;
    canvas.height = totalSize;
    canvas.style.width = '100%';
    canvas.style.maxWidth = '280px';
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto';

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalSize, totalSize);

    ctx.fillStyle = '#000000';
    for (var row = 0; row < qr.getModuleCount(); row++) {
      for (var col = 0; col < qr.getModuleCount(); col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(padding + col * cellSize, padding + row * cellSize, cellSize, cellSize);
        }
      }
    }

    container.innerHTML = '';
    container.appendChild(canvas);
    return true;
  }

  // ---- SDP Compression ----
  function compressSDP(fullSDP) {
    if (!fullSDP) return fullSDP;
    var lines = fullSDP.split('\r\n');
    var out = [];
    var inMedia = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // Skip empty
      if (!line) continue;
      // Keep essential lines
      if (line.startsWith('v=') || line.startsWith('o=') || line.startsWith('s=') ||
          line.startsWith('t=') || line.startsWith('a=group:') || line.startsWith('a=fingerprint:') ||
          line.startsWith('a=setup:') || line.startsWith('a=ice-pwd:') || line.startsWith('a=ice-ufrag:') ||
          line.startsWith('c=') || line.startsWith('m=')) {
        out.push(line);
        inMedia = line.startsWith('m=');
        continue;
      }
      // In media section, keep only key lines
      if (inMedia) {
        if (line.startsWith('a=mid:') || line.startsWith('a=sendrecv') ||
            line.startsWith('a=rtcp-mux') || line.indexOf('opus') > -1 ||
            line.indexOf('H264') > -1 || line.indexOf('VP8') > -1 ||
            line.indexOf('VP9') > -1 || line.indexOf('AV1') > -1) {
          out.push(line);
          continue;
        }
        // Keep a=candidate lines
        if (line.startsWith('a=candidate:')) {
          out.push(line);
          continue;
        }
      }
      // Keep ufrag/pwd candidates (for ICE)
      if (line.startsWith('a=ice-')) {
        out.push(line);
        continue;
      }
      // Keep fingerprint
      if (line.startsWith('a=fingerprint:')) {
        out.push(line);
        continue;
      }
    }
    return out.join('\r\n') + '\r\n';
  }

  // ---- QR Scanning ----
  function startScanner(onResult, onError) {
    // Try BarcodeDetector API first (Chrome 88+, Edge 88+)
    if (typeof BarcodeDetector !== 'undefined') {
      return _scanWithBarcodeDetector(onResult, onError);
    }
    // Fallback: camera + jsQR
    return _scanWithCamera(onResult, onError);
  }

  function _scanWithBarcodeDetector(onResult, onError) {
    var stream = null;
    var detector = new BarcodeDetector({ formats: ['qr_code'] });
    var video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    video.style.width = '100%';
    video.style.maxWidth = '400px';
    video.style.borderRadius = '8px';
    video.style.display = 'block';
    video.style.margin = '0 auto';

    var scanInterval = null;
    var stopped = false;

    function stop() {
      stopped = true;
      if (scanInterval) clearInterval(scanInterval);
      if (stream) {
        stream.getTracks().forEach(function (t) { t.stop(); });
      }
      video.srcObject = null;
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(function (s) {
        if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s;
        video.srcObject = s;
        video.play();

        scanInterval = setInterval(function () {
          if (stopped || video.readyState < 2) return;
          try {
            detector.detect(video).then(function (barcodes) {
              if (stopped) return;
              if (barcodes && barcodes.length > 0) {
                stop();
                onResult(barcodes[0].rawValue);
              }
            }).catch(function () {});
          } catch (e) {}
        }, 300);
      })
      .catch(function (err) {
        console.error('Camera error:', err);
        onError('摄像头不可用，请允许摄像头权限后重试');
      });

    return { element: video, stop: stop };
  }

  function _scanWithCamera(onResult, onError) {
    // Fallback: use file input to take a photo, then decode with jsQR
    var stopped = false;
    var container = document.createElement('div');
    container.style.textAlign = 'center';

    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';

    var btn = document.createElement('button');
    btn.className = 'btn btn-primary btn-large';
    btn.textContent = '📷 拍照扫码';
    btn.style.marginBottom = '12px';
    btn.addEventListener('click', function () { input.click(); });

    var hint = document.createElement('p');
    hint.style.fontSize = '0.8rem';
    hint.style.color = '#6b7280';
    hint.textContent = '点击拍照按钮，拍摄发送方屏幕上的二维码';
    hint.style.marginBottom = '12px';

    container.appendChild(hint);
    container.appendChild(btn);
    container.appendChild(input);

    input.addEventListener('change', function () {
      if (!input.files || !input.files[0]) return;
      var file = input.files[0];
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          var code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code) {
            stopped = true;
            onResult(code.data);
          } else {
            onError('未识别到二维码，请重新拍照。确保二维码完整清晰。');
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });

    function stop() { stopped = true; }

    return { element: container, stop: stop };
  }

  function stopScanner(scanner) {
    if (scanner && scanner.stop) scanner.stop();
  }

  // ---- Public ----
  return {
    generateQRCode: generateQRCode,
    compressSDP: compressSDP,
    startScanner: startScanner,
    stopScanner: stopScanner
  };
})();
