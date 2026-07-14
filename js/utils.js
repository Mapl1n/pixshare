/**
 * utils.js — Utilities for PixShare
 */
var PIX = window.PIX || {};
window.PIX = PIX;

PIX.Utils = (function () {
  'use strict';

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    var k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return (i === 0 ? bytes : (bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  var ALLOWED_EXTS = ['.jpg','.jpeg','.png','.gif','.webp','.avif','.heic','.heif','.bmp','.tiff','.tif','.svg'];

  function isImageFile(file) {
    if (file.type && file.type.startsWith('image/')) return true;
    var n = file.name.toLowerCase();
    for (var i = 0; i < ALLOWED_EXTS.length; i++) { if (n.endsWith(ALLOWED_EXTS[i])) return true; }
    return false;
  }

  function sanitizeFilename(name) {
    return name.replace(/[\\\/:*?"<>|]/g, '_').trim();
  }

  function generatePeerId() {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var id = 'px-';
    for (var i = 0; i < 10; i++) { id += chars[Math.floor(Math.random() * chars.length)]; }
    return id;
  }

  function generateSessionId() {
    return generatePeerId();
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function getShareUrl(peerId) {
    return window.location.origin + window.location.pathname + '#' + peerId;
  }

  return {
    formatBytes: formatBytes,
    isImageFile: isImageFile,
    sanitizeFilename: sanitizeFilename,
    generatePeerId: generatePeerId,
    generateSessionId: generateSessionId,
    isIOS: isIOS,
    getShareUrl: getShareUrl
  };
})();
