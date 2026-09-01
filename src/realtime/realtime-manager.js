// ============================================================
// GULLYGANG — CENTRAL REALTIME & PUSH SYNCHRONIZATION MANAGER
// Zero aggressive polling — Native Server-Sent Events (SSE) & BroadcastChannel
// ============================================================

export const RealtimeManager = (function () {
  let eventSource = null;
  let broadcastChannel = null;
  let connectionState = 'disconnected'; // 'connected' | 'connecting' | 'reconnecting' | 'offline' | 'disconnected'
  let listeners = new Map();
  let offlineFallbackTimer = null;
  let isInitialized = false;
  let retryCount = 0;
  let lastKnownVersion = 0;

  function init() {
    if (isInitialized) return;
    isInitialized = true;

    // 1. Inter-tab broadcast channel for 0ms cross-tab push
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

    // 4. Foreground / focus recovery
    window.addEventListener('focus', () => {
      if (connectionState !== 'connected') {
        connect();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && connectionState !== 'connected') {
        connect();
      }
    });

    window.addEventListener('online', () => {
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

    if (eventSource) {
      try { eventSource.close(); } catch (_) {}
      eventSource = null;
    }

    setConnectionState('connecting');

    try {
      eventSource = new EventSource('/api/public?type=events');

      eventSource.addEventListener('init', (e) => {
        try {
          const data = JSON.parse(e.data);
          lastKnownVersion = data.version || 0;
          setConnectionState('connected');
          stopOfflineFallback();
          retryCount = 0;
        } catch (_) {}
      });

      eventSource.addEventListener('sync', (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload && payload.version) {
            lastKnownVersion = payload.version;
          }
          handleIncomingEvent(payload);
        } catch (err) {
          console.warn('[RealtimeManager] Parse sync event error:', err);
        }
      });

      eventSource.addEventListener('ping', () => {
        if (connectionState !== 'connected') {
          setConnectionState('connected');
          stopOfflineFallback();
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
        scheduleOfflineFallback();
      };
    } catch (err) {
      console.warn('[RealtimeManager] Failed to create EventSource:', err);
      setConnectionState('offline');
      scheduleOfflineFallback();
    }
  }

  function setConnectionState(newState) {
    if (connectionState === newState) return;
    connectionState = newState;

    // Dispatch connection state change event
    notifyListeners('connection:state', { state: connectionState });

    // Update admin connection badge if present
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

  function handleIncomingEvent(payload) {
    if (!payload) return;
    const type = payload.type || payload.last_event?.type;
    if (!type) return;

    // 1. Notify specific topic listeners (e.g. 'blog.*', 'playlist.*')
    notifyListeners(type, payload);

    // 2. Notify wildcard category listeners (e.g. 'blog', 'playlist')
    const prefix = type.split('.')[0];
    if (prefix && prefix !== type) {
      notifyListeners(`${prefix}.*`, payload);
      notifyListeners(prefix, payload);
    }

    // 3. Notify global sync listener
    notifyListeners('*', payload);
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

  // Conservative offline fallback (60s–120s ONLY when disconnected)
  function scheduleOfflineFallback() {
    if (offlineFallbackTimer) return;
    const delay = Math.min(60000 * Math.pow(1.5, retryCount++), 120000);
    offlineFallbackTimer = setTimeout(async () => {
      offlineFallbackTimer = null;
      if (connectionState === 'connected') return;

      try {
        const res = await fetch(`/api/public?type=sync_version&_t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.version && data.version > lastKnownVersion) {
            lastKnownVersion = data.version;
            if (data.last_event) {
              handleIncomingEvent(data.last_event);
            }
          }
        }
      } catch (_) {}

      // Attempt SSE reconnection
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
