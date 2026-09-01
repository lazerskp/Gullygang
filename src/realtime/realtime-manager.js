// ============================================================
// GULLYGANG — CENTRAL REALTIME & PUSH SYNCHRONIZATION MANAGER
// Zero aggressive polling — Native Server-Sent Events (SSE) & BroadcastChannel
// Idempotent processing, reconnect recovery, exponential backoff & tab optimization
// ============================================================

export const RealtimeManager = (function () {
  let eventSource = null;
  let broadcastChannel = null;
  let connectionState = 'disconnected'; // 'connected' | 'connecting' | 'reconnecting' | 'offline' | 'disconnected'
  let listeners = new Map();
  let reconnectTimer = null;
  let offlineFallbackTimer = null;
  let isInitialized = false;
  let retryCount = 0;
  let lastKnownVersion = 0;
  let lastProcessedVersion = 0;
  let pendingVisibilityCatchup = false;

  function init() {
    if (isInitialized) return;
    isInitialized = true;

    // 1. Inter-tab broadcast channel for 0ms instant cross-tab sync
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        broadcastChannel = new BroadcastChannel('gullygang_sync');
        broadcastChannel.onmessage = (event) => {
          if (event && event.data) {
            handleIncomingEvent(event.data);
          }
        };
      } catch (_) {}
    }

    // 2. Storage event fallback for older browser tabs
    window.addEventListener('storage', (e) => {
      if (e.key === 'gullygang_sync_event' && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          handleIncomingEvent(payload);
        } catch (_) {}
      }
    });

    // 3. Connect to native server push SSE stream
    connect();

    // 4. Visibility & Foreground Reconnection Manager
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        if (connectionState !== 'connected') {
          connect();
        } else if (pendingVisibilityCatchup) {
          pendingVisibilityCatchup = false;
          reconcileAuthoritativeVersion();
        }
      }
    });

    window.addEventListener('focus', () => {
      if (connectionState !== 'connected') {
        connect();
      }
    });

    window.addEventListener('online', () => {
      retryCount = 0;
      setConnectionState('connecting');
      connect();
    });

    window.addEventListener('offline', () => {
      setConnectionState('offline');
    });
  }

  function connect() {
    if (typeof EventSource === 'undefined') {
      console.warn('[RealtimeManager] EventSource not supported by browser, using fallback');
      scheduleOfflineFallback();
      return;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (eventSource) {
      try { eventSource.close(); } catch (_) {}
      eventSource = null;
    }

    setConnectionState('connecting');

    try {
      const connectUrl = lastKnownVersion > 0 
        ? `/api/public?type=events&since_version=${lastKnownVersion}`
        : '/api/public?type=events';

      eventSource = new EventSource(connectUrl);

      eventSource.addEventListener('init', (e) => {
        try {
          const data = JSON.parse(e.data);
          const ver = data.version || 0;
          if (ver > lastKnownVersion) {
            lastKnownVersion = ver;
            lastProcessedVersion = ver;
          }
          setConnectionState('connected');
          stopOfflineFallback();
          retryCount = 0;
        } catch (_) {}
      });

      eventSource.addEventListener('sync', (e) => {
        try {
          const payload = JSON.parse(e.data);
          handleIncomingEvent(payload);
        } catch (err) {
          console.warn('[RealtimeManager] Parse sync event error:', err);
        }
      });

      eventSource.addEventListener('ping', () => {
        if (connectionState !== 'connected') {
          setConnectionState('connected');
          stopOfflineFallback();
          retryCount = 0;
        }
      });

      eventSource.onopen = () => {
        setConnectionState('connected');
        stopOfflineFallback();
        retryCount = 0;
      };

      eventSource.onerror = () => {
        if (eventSource?.readyState === EventSource.CLOSED) {
          setConnectionState('reconnecting');
        } else {
          setConnectionState('offline');
        }
        scheduleReconnectWithBackoff();
      };
    } catch (err) {
      console.warn('[RealtimeManager] Failed to create EventSource:', err);
      setConnectionState('offline');
      scheduleReconnectWithBackoff();
    }
  }

  function scheduleReconnectWithBackoff() {
    if (reconnectTimer) return;
    // Exponential backoff with jitter: 1s, 2s, 4s, 8s, 16s, max 30s
    const baseDelay = Math.min(1000 * Math.pow(2, retryCount++), 30000);
    const jitter = Math.random() * 800;
    const delay = Math.round(baseDelay + jitter);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (connectionState !== 'connected') {
        connect();
      }
    }, delay);

    scheduleOfflineFallback();
  }

  function setConnectionState(newState) {
    if (connectionState === newState) return;
    connectionState = newState;

    notifyListeners('connection:state', { state: connectionState });

    const badge = document.getElementById('admin-realtime-badge') || document.querySelector('.admin-realtime-badge');
    if (badge) {
      badge.setAttribute('data-state', connectionState);
      const label = badge.querySelector('.admin-badge-label') || badge;
      if (connectionState === 'connected') {
        badge.className = 'admin-badge admin-badge-connected';
        if (label !== badge) label.textContent = 'Live Connected';
      } else if (connectionState === 'connecting' || connectionState === 'reconnecting') {
        badge.className = 'admin-badge admin-badge-reconnecting';
        if (label !== badge) label.textContent = 'Reconnecting...';
      } else {
        badge.className = 'admin-badge admin-badge-offline';
        if (label !== badge) label.textContent = 'Offline';
      }
    }
  }

  // Idempotent incoming event handler
  function handleIncomingEvent(payload) {
    if (!payload) return;
    const type = payload.type || payload.last_event?.type;
    if (!type) return;

    const ver = payload.version || payload.last_event?.timestamp || 0;

    // Idempotency: ignore duplicate or out-of-order versions from dual delivery (SSE + BroadcastChannel)
    if (ver && ver <= lastProcessedVersion) {
      return;
    }

    if (ver > lastProcessedVersion) {
      lastProcessedVersion = ver;
      lastKnownVersion = ver;
    }

    // If tab is currently hidden in background, mark for catchup when visible
    if (document.hidden) {
      pendingVisibilityCatchup = true;
    }

    // 1. Specific topic listeners (e.g. 'blog.*', 'playlist.*')
    notifyListeners(type, payload);

    // 2. Wildcard category listeners (e.g. 'blog', 'playlist')
    const prefix = type.split('.')[0];
    if (prefix && prefix !== type) {
      notifyListeners(`${prefix}.*`, payload);
      notifyListeners(prefix, payload);
    }

    // 3. Global wildcard listener
    notifyListeners('*', payload);
  }

  async function reconcileAuthoritativeVersion() {
    try {
      const res = await fetch(`/api/public?type=sync_version&_t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.version && data.version > lastProcessedVersion) {
          lastKnownVersion = data.version;
          if (data.last_event) {
            handleIncomingEvent(data.last_event);
          }
        }
      }
    } catch (_) {}
  }

  function on(topic, callback) {
    if (!listeners.has(topic)) {
      listeners.set(topic, new Set());
    }
    listeners.get(topic).add(callback);
    return () => off(topic, callback);
  }

  function off(topic, callback) {
    if (listeners.has(topic)) {
      listeners.get(topic).delete(callback);
    }
  }

  function notifyListeners(topic, payload) {
    if (listeners.has(topic)) {
      for (const cb of listeners.get(topic)) {
        try {
          cb(payload);
        } catch (err) {
          console.error(`[RealtimeManager] Error in listener callback for "${topic}":`, err);
        }
      }
    }
  }

  function broadcast(type, entityId = null, extra = {}) {
    const payload = {
      type,
      entityId,
      version: Date.now(),
      timestamp: Date.now(),
      ...extra
    };

    if (broadcastChannel) {
      try { broadcastChannel.postMessage(payload); } catch (_) {}
    }
    try {
      localStorage.setItem('gullygang_sync_event', JSON.stringify(payload));
    } catch (_) {}

    handleIncomingEvent(payload);
  }

  function scheduleOfflineFallback() {
    if (offlineFallbackTimer) return;
    const delay = Math.min(60000 * Math.pow(1.5, Math.min(retryCount, 4)), 120000);
    offlineFallbackTimer = setTimeout(async () => {
      offlineFallbackTimer = null;
      if (connectionState === 'connected') return;

      await reconcileAuthoritativeVersion();
      connect();
    }, delay);
  }

  function stopOfflineFallback() {
    if (offlineFallbackTimer) {
      clearTimeout(offlineFallbackTimer);
      offlineFallbackTimer = null;
    }
  }

  function disconnect() {
    stopOfflineFallback();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (eventSource) {
      try { eventSource.close(); } catch (_) {}
      eventSource = null;
    }
    setConnectionState('disconnected');
  }

  const manager = {
    init,
    connect,
    disconnect,
    on,
    off,
    broadcast,
    getState: () => connectionState,
    getVersion: () => lastKnownVersion
  };

  if (typeof window !== 'undefined') {
    window.RealtimeManager = manager;
  }

  return manager;
})();
