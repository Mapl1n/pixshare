/**
 * mqtt-relay.js — 6-digit code room via public MQTT broker
 * Zero config. Uses broker.emqx.io (free public MQTT broker).
 *
 * Topic structure:
 *   pixshare/CODE/offer   — sender publishes offer SDP
 *   pixshare/CODE/answer  — receiver publishes answer SDP
 */
PIX.Relay = (function () {
  'use strict';
  var U = PIX.Utils, UI = PIX.UI;

  var _client = null;
  var _code = '';
  var _isConnected = false;
  var _onOffer = null;
  var _onAnswer = null;

  // MQTT broker (free, public, no account needed)
  var BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';

  function init() {
    // Nothing needed on init
  }

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
        if (done) return;
        done = true;
        _isConnected = true;

        // Subscribe to both offer and answer topics
        var offerTopic = 'pixshare/' + _code + '/offer';
        var answerTopic = 'pixshare/' + _code + '/answer';
        _client.subscribe([offerTopic, answerTopic], function (err) {
          if (err) {
            UI.toast('订阅失败', 'error');
            reject(err);
            return;
          }
          resolve();
        });
      });

      _client.on('message', function (topic, message) {
        var text = message.toString();
        if (topic.endsWith('/offer') && _onOffer) {
          _onOffer(text);
        } else if (topic.endsWith('/answer') && _onAnswer) {
          _onAnswer(text);
        }
      });

      _client.on('error', function (err) {
        if (!done) { done = true; reject(err); }
        else { console.warn('MQTT error:', err); }
      });

      _client.on('close', function () {
        _isConnected = false;
      });

      setTimeout(function () {
        if (!done) { done = true; reject(new Error('连接超时')); }
      }, 15000);
    });
  }

  // ---- Sender: publish offer, listen for answer ----
  function publishOffer(offerSDP, onAnswer) {
    _onAnswer = onAnswer;
    var topic = 'pixshare/' + _code + '/offer';
    return new Promise(function (resolve, reject) {
      _client.publish(topic, offerSDP, { qos: 1 }, function (err) {
        if (err) { reject(err); return; }
        resolve();
      });
    });
  }

  // ---- Receiver: read offer, then publish answer ----
  function waitForOffer(onOffer) {
    _onOffer = onOffer;
  }

  function publishAnswer(answerSDP) {
    var topic = 'pixshare/' + _code + '/answer';
    return new Promise(function (resolve, reject) {
      _client.publish(topic, answerSDP, { qos: 1 }, function (err) {
        if (err) { reject(err); return; }
        resolve();
      });
    });
  }

  // ---- Cleanup ----
  function disconnect() {
    _onOffer = null;
    _onAnswer = null;
    if (_client) {
      try { _client.end(true); } catch (e) {}
      _client = null;
    }
    _isConnected = false;
    _code = '';
  }

  function isConnected() { return _isConnected; }
  function getCode() { return _code; }

  return {
    init: init,
    connect: connect,
    publishOffer: publishOffer,
    waitForOffer: waitForOffer,
    publishAnswer: publishAnswer,
    disconnect: disconnect,
    isConnected: isConnected,
    getCode: getCode
  };
})();
