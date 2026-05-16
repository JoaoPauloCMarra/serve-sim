import { useEffect, useRef, useState } from "react";
import {
  buildLogsEndpoint,
  parseDeviceLogEntry,
  type DeviceLogEntry,
  type DeviceLogStreamLevel,
} from "../utils/logs";

export type DeviceLogStatus = "idle" | "connecting" | "live" | "error";

const MAX_LOG_ROWS = 1_500;

export function useDeviceLogs({
  endpoint,
  enabled,
  streamLevel,
}: {
  endpoint: string | null | undefined;
  enabled: boolean;
  streamLevel: DeviceLogStreamLevel;
}) {
  const [entries, setEntries] = useState<DeviceLogEntry[]>([]);
  const [status, setStatus] = useState<DeviceLogStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const pendingEntries = useRef<DeviceLogEntry[]>([]);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!endpoint || !enabled) {
      setStatus("idle");
      return;
    }

    const flush = () => {
      frame.current = null;
      const pending = pendingEntries.current;
      if (pending.length === 0) return;
      pendingEntries.current = [];
      setEntries((prev) => {
        const next = prev.concat(pending);
        return next.length > MAX_LOG_ROWS ? next.slice(next.length - MAX_LOG_ROWS) : next;
      });
    };

    const enqueue = (entry: DeviceLogEntry) => {
      pendingEntries.current.push(entry);
      if (frame.current != null) return;
      frame.current = window.requestAnimationFrame(flush);
    };

    setStatus("connecting");
    setError(null);
    const eventSource = new EventSource(buildLogsEndpoint(endpoint, streamLevel));

    eventSource.onopen = () => {
      setStatus("live");
      setError(null);
    };

    eventSource.onmessage = (event) => {
      let value: unknown;
      try {
        value = JSON.parse(event.data);
      } catch {
        return;
      }
      const entry = parseDeviceLogEntry(value, nextId.current++);
      if (!entry) return;
      enqueue(entry);
    };

    eventSource.onerror = () => {
      setStatus("error");
      setError("Log stream disconnected. serve-sim will retry while the tool stays open.");
    };

    return () => {
      eventSource.close();
      if (frame.current != null) {
        window.cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      pendingEntries.current = [];
    };
  }, [endpoint, enabled, streamLevel]);

  return {
    entries,
    status,
    error,
    clear: () => {
      nextId.current = 1;
      pendingEntries.current = [];
      if (frame.current != null) {
        window.cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      setEntries([]);
    },
  };
}
