// Talk to ERBOT — floating voice widget for saveonbusinessenergy.com
// No build step: plain script, loaded with <script src="/tex.js" defer></script>.
// The @spekoai/client SDK is loaded on demand from esm.sh (pinned 0.0.17)
// only when the visitor taps the button.
// The browser never sees SPEKO_API_KEY: /api/tex-session mints the session.
(function () {
  'use strict';

  var SESSION_URL = '/api/tex-session';
  var SDK_URL = 'https://esm.sh/@spekoai/client@0.0.17';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---- Build the UI -------------------------------------------------------
  var root = el('div', 'tex-widget');
  root.setAttribute('aria-label', 'Talk to ERBOT');

  var button = el('button', 'tex-fab', null);
  button.type = 'button';
  button.setAttribute('aria-label', 'Talk to ERBOT, free Texas energy help');
  button.innerHTML =
    '<span class="tex-fab-title">Talk to ERBOT \uD83E\uDD20</span>' +
    '<span class="tex-fab-sub">Free Texas energy help</span>';

  var panel = el('div', 'tex-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Conversation with ERBOT');
  panel.hidden = true;

  var head = el('div', 'tex-head');
  var titleWrap = el('div', 'tex-title-wrap');
  titleWrap.appendChild(el('div', 'tex-title', 'ERBOT'));
  titleWrap.appendChild(el('div', 'tex-sub', 'Texas energy expert \u00B7 free'));
  var statePill = el('div', 'tex-state', 'Ready');
  statePill.setAttribute('role', 'status');
  head.appendChild(titleWrap);
  head.appendChild(statePill);

  var log = el('div', 'tex-log');
  log.setAttribute('aria-live', 'polite');

  var controls = el('div', 'tex-controls');
  var muteBtn = el('button', 'tex-btn tex-mute', 'Mute');
  muteBtn.type = 'button';
  var endBtn = el('button', 'tex-btn tex-end', 'End call');
  endBtn.type = 'button';
  controls.appendChild(muteBtn);
  controls.appendChild(endBtn);

  var hint = el('div', 'tex-hint', 'Tap the button and just talk. ERBOT can check your rate, your contract, and what you could save.');
  panel.appendChild(head);
  panel.appendChild(log);
  panel.appendChild(controls);
  panel.appendChild(hint);

  root.appendChild(panel);
  root.appendChild(button);
  document.body.appendChild(root);

  // ---- Keep the button (and panel) off the review form --------------------
  // While the #review section is on screen, the floating button hides and an
  // open panel collapses to a compact bar at the top, so neither can ever
  // cover the review form's submit button.
  var review = document.getElementById('review');
  if (review && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(
      function (entries) {
        var inView = entries[0].isIntersecting;
        root.classList.toggle('tex-review-in-view', inView);
      },
      { rootMargin: '0px 0px -10% 0px' }
    );
    io.observe(review);
  }

  // ---- Call state ---------------------------------------------------------
  var conversation = null;
  var starting = false;
  var muted = false;
  var segments = new Map(); // segmentId -> { source, text, isFinal }

  function setState(text, mode) {
    statePill.textContent = text;
    statePill.dataset.mode = mode || '';
  }

  function renderLog() {
    log.innerHTML = '';
    segments.forEach(function (seg) {
      var line = el('div', 'tex-line tex-' + (seg.source === 'user' ? 'user' : 'agent'));
      var who = el('span', 'tex-who', seg.source === 'user' ? 'You' : 'ERBOT');
      var body = el('span', 'tex-text' + (seg.isFinal === false ? ' tex-interim' : ''), seg.text);
      line.appendChild(who);
      line.appendChild(body);
      log.appendChild(line);
    });
    log.scrollTop = log.scrollHeight;
  }

  function addMessage(m) {
    if (!m) return;
    var id = m.segmentId || m.id || ('m' + segments.size);
    var source = m.source || m.role || (m.speaker === 'user' ? 'user' : 'agent');
    var text = m.text || m.content || m.message || '';
    if (!text) return;
    var prev = segments.get(id) || { source: source, text: '', isFinal: false };
    prev.source = source;
    prev.text = text;
    prev.isFinal = m.isFinal !== false;
    segments.set(id, prev);
    renderLog();
  }

  function showError(message) {
    log.innerHTML = '';
    var line = el('div', 'tex-line tex-error');
    line.appendChild(el('span', 'tex-text', message));
    log.appendChild(line);
    setState('Could not start', 'error');
  }

  function openPanel() {
    panel.hidden = false;
    button.hidden = true;
  }

  function closePanel() {
    panel.hidden = true;
    button.hidden = false;
    setState('Ready', '');
  }

  async function startCall() {
    if (starting || conversation) return;
    starting = true;
    openPanel();
    setState('Asking for the mic…', 'connecting');
    log.innerHTML = '';

    // 1. Request the mic first, so the permission prompt comes from the tap.
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(function (t) { t.stop(); });
    } catch (err) {
      showError('Microphone blocked. Allow microphone access in your browser and tap the button again.');
      starting = false;
      return;
    }

    // 2. Mint a session on the server (the API key stays server-side).
    var session;
    try {
      setState('Connecting…', 'connecting');
      var r = await fetch(SESSION_URL, { method: 'POST' });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(data.error || ('Server error ' + r.status));
      session = data;
    } catch (err) {
      showError('ERBOT is not switched on yet. ' + (err.message || 'Please try again in a minute.'));
      starting = false;
      return;
    }

    // 3. Load the Speko client and start the call.
    try {
      var mod = await import(SDK_URL);
      var VoiceConversation = mod.VoiceConversation;
      if (!VoiceConversation) throw new Error('Voice SDK did not load.');
      conversation = await VoiceConversation.create({
        transport: session.transport,
        transportToken: session.transportToken,
        transportUrl: session.transportUrl,
        onConnect: function () { setState('Listening…', 'listening'); },
        onDisconnect: function () { endCallUI('Call ended'); },
        onMessage: function (m) { addMessage(m); },
        onModeChange: function (mode) {
          if (mode === 'speaking') setState('ERBOT is speaking…', 'speaking');
          else setState('Listening…', 'listening');
        },
        onStatusChange: function (status) {
          if (status === 'connecting') setState('Connecting…', 'connecting');
          if (status === 'disconnecting') setState('Ending…', 'connecting');
        },
        onError: function (err) {
          showError('Something went wrong with the call. ' + (err && err.message ? err.message : 'Please try again.'));
        },
      });
      setState('Listening…', 'listening');
    } catch (err) {
      showError('Could not start the call. ' + (err.message || 'Please try again.'));
      conversation = null;
    }
    starting = false;
  }

  function endCallUI(message) {
    if (conversation) {
      try { conversation.endSession(); } catch (e) { /* already ended */ }
      conversation = null;
    }
    muted = false;
    muteBtn.textContent = 'Mute';
    setState(message || 'Call ended', 'ended');
    var again = el('button', 'tex-btn tex-again', 'Talk again');
    again.type = 'button';
    again.addEventListener('click', function () {
      segments.clear();
      log.innerHTML = '';
      startCall();
    });
    controls.appendChild(again);
    setTimeout(function () {
      if (!conversation) {
        again.remove();
        closePanel();
      }
    }, 6000);
  }

  button.addEventListener('click', startCall);

  endBtn.addEventListener('click', function () {
    if (conversation) endCallUI('Call ended');
    else closePanel();
  });

  muteBtn.addEventListener('click', function () {
    if (!conversation) return;
    muted = !muted;
    try {
      if (typeof conversation.setMicMuted === 'function') conversation.setMicMuted(muted);
    } catch (e) { /* ignore */ }
    muteBtn.textContent = muted ? 'Unmute' : 'Mute';
  });

  // If the visitor leaves mid-call, end it cleanly.
  window.addEventListener('pagehide', function () {
    if (conversation) {
      try { conversation.endSession(); } catch (e) { /* ignore */ }
    }
  });
})();
