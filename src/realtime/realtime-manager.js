// ============================================================
// GULLYGANG — CENTRAL REALTIME & PUSH SYNCHRONIZATION MANAGER
// ============================================================

export const RealtimeManager = (function () {
  let eventSource = null;
  let broadcastChannel = null;
  let connectionState = 'disconnected';
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

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        broadcastChannel = new BroadcastChannel('gullygang_sync');
        broadcastChannel.onmessage = (event) => {
          if (event?.data) handleIncomingEvent(event.data);
        };
      } catch (_) {}
    }

    window.addEventListener('storage', (e) => {
      if (e.key === 'gullygang_sync_event' && e.newValue) {
        try { handleIncomingEvent(JSON.parse(e.newValue)); } catch (_) {}
      }
    });

    connect();

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        if (connectionState !== 'connected') connect();
        else if (pendingVisibilityCatchup) {
          pendingVisibilityCatchup = false;
          reconcileAuthoritativeVersion();
        }
      }
    });

    window.addEventListener('focus', () => {
      if (connectionState !== 'connected') connect();
    });

    window.addEventListener('online', () => {
      retryCount = 0;
      setConnectionState('connecting');
      connect();
    });

    window.addEventListener('offline', () => setConnectionState('offline'));
  }

  function connect() {
    if (typeof EventSource === 'undefined') {
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
        try { handleIncomingEvent(JSON.parse(e.data)); } catch (_) {}
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
        setConnectionState(eventSource?.readyState === EventSource.CLOSED ? 'reconnecting' : 'offline');
        scheduleReconnectWithBackoff();
      };
    } catch (_) {
      setConnectionState('offline');
      scheduleReconnectWithBackoff();
    }
  }

  function scheduleReconnectWithBackoff() {
    if (reconnectTimer) return;
    const baseDelay = Math.min(1000 * Math.pow(2, retryCount++), 30000);
    const delay = Math.round(baseDelay + Math.random() * 800);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (connectionState !== 'connected') connect();
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

  function handleIncomingEvent(payload) {
    if (!payload) return;
    const type = payload.type || payload.last_event?.type;
    if (!type) return;

    const version = payload.version || payload.last_event?.version || 0;
    if (version > 0 && version <= lastProcessedVersion && type !== 'ping') return;

    if (version > lastProcessedVersion) {
      lastProcessedVersion = version;
      lastKnownVersion = Math.max(lastKnownVersion, version);
    }

    notifyListeners(type, payload);
    notifyListeners('*', payload);

    if (type.startsWith('blog.')) notifyListeners('blog.*', payload);
    if (type.startsWith('music.') || type.startsWith('playlist.')) notifyListeners('music.*', payload);
  }

  async function reconcileAuthoritativeVersion() {
    try {
      const res = await fetch('/api/public?type=events&poll=1');
      if (res.ok) {
        const data = await res.json();
        if (data && data.version > lastKnownVersion) {
          handleIncomingEvent(data);
        }
      }
    } catch (_) {}
  }

  function scheduleOfflineFallback() {
    if (offlineFallbackTimer) return;
    offlineFallbackTimer = setInterval(() => {
      if (connectionState !== 'connected') reconcileAuthoritativeVersion();
    }, 60000);
  }

  function stopOfflineFallback() {
    if (offlineFallbackTimer) {
      clearInterval(offlineFallbackTimer);
      offlineFallbackTimer = null;
    }
  }

  function on(pattern, callback) {
    if (typeof callback !== 'function') return () => {};
    if (!listeners.has(pattern)) listeners.set(pattern, new Set());
    listeners.get(pattern).add(callback);
    return () => off(pattern, callback);
  }

  function off(pattern, callback) {
    if (listeners.has(pattern)) {
      listeners.get(pattern).delete(callback);
      if (listeners.get(pattern).size === 0) listeners.delete(pattern);
    }
  }

  function notifyListeners(pattern, payload) {
    if (listeners.has(pattern)) {
      listeners.get(pattern).forEach(cb => {
        try { cb(payload); } catch (_) {}
      });
    }
  }

  const manager = {
    init,
    on,
    off,
    connect,
    reconcileAuthoritativeVersion,
    getConnectionState: () => connectionState,
    getLastKnownVersion: () => lastKnownVersion,
    isOnline: () => connectionState === 'connected'
  };

  if (typeof window !== 'undefined') window.RealtimeManager = manager;
  return manager;
})();
