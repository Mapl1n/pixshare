/**
 * mqtt-relay.js — 6-digit code room via public MQTT broker
 *
 * Topics:
 *   pixshare/CODE/offer        — sender publishes offer SDP
 *   pixshare/CODE/join-request — receiver publishes "apply" when wants to join
 *   pixshare/CODE/confirm      — sender publishes "accepted" to confirm
 *   pixshare/CODE/answer       — receiver publishes answer SDP after confirmed
 */
PIX.Relay = (function () {
  'use strict';
  var U = PIX.Utils, UI = PIX.UI;

  var _client = null;
  var _code = '';
  var _isConnected = false;

  var BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';

  function connect(code) {
    _code = code;
    try {
      _client = mqtt.connect(BROKER_URL, {
        clientId: 'pix_' + Math.random().toString(36).slice(2, 10),
        clean: true,
        connectTimeout: 10000,
        reconnectPeriod: 3000
      });
    } catch (e) {
      UI.toast('连接服务器失败: ' + e.message, 'error');
      return Promise.reject(e);
    }

    return new Promise(function (resolve, reject) {
      var done = false;
      _client.on('connect', function () {
        if (done) return; done = true; _isConnected = true;
        // Subscribe to all room topics
        _client.subscribe('pixshare/' + _code + '/#', function (err) {
          if (err) { reject(err); return; }
          resolve();
        });
      });
      _client.on('error', function (err) { if (!done) { done = true; reject(err); } });
      _client.on('close', function () { _isConnected = false; });
      setTimeout(function () { if (!done) { done = true; reject(new Error('连接超时')); } }, 15000);
    });
  }

  // ---- Publish helpers ----
  function publishOffer(sdp, unused) {
    return _pub('offer', sdp);
  }

  function publishJoinRequest(msg) {
    return _pub('join-request', msg);
  }

  function publishConfirm(msg) {
    return _pub('confirm', msg);
  }

  function publishAnswer(sdp) {
    return _pub('answer', sdp);
  }

  function _pub(topic, payload) {
    return new Promise(function (resolve, reject) {
      _client.publish('pixshare/' + _code + '/' + topic, payload, { qos: 1 }, function (err) {
        if (err) { reject(err); return; }
        resolve();
      });
    });
  }

  // ---- Listen helpers ----
  function readOffer(cb) {
    _onceMessage('/offer', cb);
  }

  function listenJoinRequest(cb) {
    _onMessage('/join-request', cb);
  }

  function listenConfirm(cb) {
    _onceMessage('/confirm', cb);
  }

  function listenAnswer(cb) {
    _onceMessage('/answer', cb);
  }

  // Combined: wait for confirm, then read offer
  function listenConfirmAndOffer(cb) {
    _onceMessage('/confirm', function (confirmMsg) {
      _onceMessage('/offer', function (offerText) {
        cb(confirmMsg, offerText);
      });
    });
  }

  // ---- Internal: message routing ----
  var _handlers = {};

  function _onMessage(suffix, cb) {
    _handlers[_code + suffix] = cb;
    _client.on('message', _router);
  }

  function _onceMessage(suffix, cb) {
    _handlers[_code + suffix] = function (data) {
      cb(data);
      delete _handlers[_code + suffix];
    };
    _client.on('message', _router);
  }

  function _router(topic, message) {
    var key = topic.replace('pixshare/', '');
    var h = _handlers[key];
    if (h) {
      h(message.toString());
    }
  }

  // ---- Cleanup ----
  function disconnect() {
    _handlers = {};
    if (_client) { try { _client.end(true); } catch (e) {}; _client = null; }
    _isConnected = false;
    _code = '';
  }

  return {
    connect: connect,
    publishOffer: publishOffer,
    publishJoinRequest: publishJoinRequest,
    publishConfirm: publishConfirm,
    publishAnswer: publishAnswer,
    listenJoinRequest: listenJoinRequest,
    listenConfirmAndOffer: listenConfirmAndOffer,
    listenAnswer: listenAnswer,
    disconnect: disconnect
  };
})();
