import { useEffect, useRef, useState } from 'react';
import type { HostEvent } from '../../shared/wire';

// One WebSocket for host events. Call this once, from App: every call opens its own socket.
export function useHostEvents(onEvent: (event: HostEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/events`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        retry = setTimeout(connect, 1000);
      };
      ws.onmessage = (msg) => handler.current(JSON.parse(msg.data));
    };
    connect();
    return () => {
      clearTimeout(retry);
      ws.onclose = null;
      ws.close();
    };
  }, []);
  return connected;
}
