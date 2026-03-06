import { useEffect, useRef, useCallback, useState } from "react";

let ws = null;
let wsReady = false;
const messageHandlers = new Map(); // threadId -> Set<handler>
const pendingMessages = [];
let reconnectTimer = null;
let reconnectDelay = 1000;

function getWs() {
  if (ws && ws.readyState <= 1) return ws;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.onopen = () => {
    wsReady = true;
    reconnectDelay = 1000;
    // Re-subscribe all active threads
    for (const threadId of messageHandlers.keys()) {
      ws.send(JSON.stringify({ type: "subscribe", threadId }));
    }
    // Flush pending
    while (pendingMessages.length > 0) {
      ws.send(pendingMessages.shift());
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      const threadId = msg.threadId;
      if (threadId && messageHandlers.has(threadId)) {
        for (const handler of messageHandlers.get(threadId)) {
          handler(msg);
        }
      }
      // Also broadcast to global handlers
      if (messageHandlers.has("*")) {
        for (const handler of messageHandlers.get("*")) {
          handler(msg);
        }
      }
    } catch {}
  };

  ws.onclose = () => {
    wsReady = false;
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      getWs();
    }, reconnectDelay);
  };

  ws.onerror = () => {};

  return ws;
}

function wsSend(msg) {
  const payload = JSON.stringify(msg);
  const socket = getWs();
  if (socket.readyState === 1) {
    socket.send(payload);
  } else {
    pendingMessages.push(payload);
  }
}

export function useWebSocket(threadId, onMessage) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!threadId) return;

    getWs(); // ensure connected

    const handler = (msg) => handlerRef.current?.(msg);

    if (!messageHandlers.has(threadId)) {
      messageHandlers.set(threadId, new Set());
    }
    messageHandlers.get(threadId).add(handler);

    // Subscribe
    wsSend({ type: "subscribe", threadId });

    return () => {
      const handlers = messageHandlers.get(threadId);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          messageHandlers.delete(threadId);
          wsSend({ type: "unsubscribe", threadId });
        }
      }
    };
  }, [threadId]);
}

export function sendMessage(threadId, content, options = {}) {
  wsSend({ type: "send_message", threadId, content, options });
}

export function abortThread(threadId) {
  wsSend({ type: "abort", threadId });
}
