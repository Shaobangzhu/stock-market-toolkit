// Logs accept only allowlisted operational metadata, never Error/config/request objects.
export interface LogEntry {
  event: 'server_started' | 'server_start_failed' | 'server_stopping' | 'server_stop_failed'
    | 'configuration_invalid' | 'request_failed';
  host?: '127.0.0.1';
  port?: number;
  fields?: readonly string[];
  requestId?: string;
  status?: number;
  code?: string;
}

export interface Logger {
  info(entry: LogEntry): void;
  error(entry: LogEntry): void;
}

function write(level: 'info' | 'error', entry: LogEntry) {
  const line = JSON.stringify({
    level, event: entry.event,
    ...(entry.host ? { host: entry.host } : {}),
    ...(entry.port !== undefined ? { port: entry.port } : {}),
    ...(entry.fields ? { fields: entry.fields } : {}),
    ...(entry.requestId ? { requestId: entry.requestId } : {}),
    ...(entry.status !== undefined ? { status: entry.status } : {}),
    ...(entry.code ? { code: entry.code } : {}),
  });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger: Logger = {
  info: (entry) => write('info', entry),
  error: (entry) => write('error', entry),
};
