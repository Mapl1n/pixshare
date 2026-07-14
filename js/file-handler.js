/**
 * file-handler.js — File selection (drag/drop/click/paste)
 */
PIX.FileHandler = (function () {
  'use strict';
  var U = PIX.Utils, UI = PIX.UI;
  var _files = [];

  function init() {
    _setupDropZone();
    _setupFileInput();
    _setupPaste();
    _setupButtons();
  }

  function _setupDropZone() {
    var zone = document.getElementById('drop-zone');
    var input = document.getElementById('file-input');
    zone.addEventListener('click', function () { input.click(); });
    zone.setAttribute('tabindex', '0'); zone.setAttribute('role', 'button');
    zone.addEventListener('keydown', function (e) { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); input.click(); } });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', function (e) { e.preventDefault(); zone.classList.remove('drag-over'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  }

  function _setupFileInput() {
    var input = document.getElementById('file-input');
    input.addEventListener('change', function () { if (input.files.length) { addFiles(input.files); input.value = ''; } });
  }

  function _setupPaste() {
    document.addEventListener('paste', function (e) {
      if (!e.clipboardData || !e.clipboardData.items) return;
      var files = [];
      for (var i = 0; i < e.clipboardData.items.length; i++) {
        var f = e.clipboardData.items[i].getAsFile();
        if (f) files.push(f);
      }
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
  }

  function _setupButtons() {
    document.getElementById('btn-add').addEventListener('click', function () { document.getElementById('file-input').click(); });
    document.getElementById('btn-clear').addEventListener('click', function () { clearAll(); });
    document.addEventListener('pix:remove-file', function (e) { removeFile(e.detail); });
  }

  function addFiles(fileList) {
    var added = [];
    for (var i = 0; i < fileList.length; i++) {
      if (U.isImageFile(fileList[i])) {
        _files.push({
          file: fileList[i],
          displayName: U.sanitizeFilename(fileList[i].name),
          size: fileList[i].size,
          type: fileList[i].type
        });
        added.push(fileList[i].name);
      }
    }
    if (added.length < fileList.length) UI.toast('已跳过 ' + (fileList.length - added.length) + ' 个非图片文件', 'warning');
    UI.renderFileGrid(_files);
  }

  function removeFile(idx) {
    if (idx >= 0 && idx < _files.length) { _files.splice(idx, 1); UI.renderFileGrid(_files); }
  }

  function clearAll() { _files = []; UI.renderFileGrid(_files); UI.toast('已清空', 'success'); }

  function getFiles() { return _files.slice(); }

  return { init: init, getFiles: getFiles, clearAll: clearAll };
})();
