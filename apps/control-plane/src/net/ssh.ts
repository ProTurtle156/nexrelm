/**
 * Shared SSH layer used by the Directory shell and the VM module.
 *  - `openSshShell` bridges an interactive PTY to data/close callbacks so a
 *    WebSocket route can wire a browser terminal straight to the remote prompt.
 *  - `runSshCommand` runs a one-shot command and returns its captured output,
 *    used to collect VM telemetry.
 * Credentials are passed per-call and never persisted here.
 */
import { Client, type ClientChannel } from 'ssh2';

export interface ShellTarget {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface ShellBridge {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  end(): void;
}

function connectHint(e: Error & { level?: string }): string {
  if (e.level === 'client-authentication') return ' (authentication failed — check the saved username/password)';
  if (/ECONNREFUSED/i.test(e.message)) return ' (nothing listening on the SSH port — is sshd running / the port open?)';
  if (/ETIMEDOUT|timed out/i.test(e.message)) return ' (timed out — host unreachable or the firewall is blocking the SSH port)';
  if (/ENOTFOUND|EAI_AGAIN/i.test(e.message)) return ' (host not found — check the address)';
  return '';
}

export function openSshShell(target: ShellTarget, onData: (chunk: string) => void, onClose: (reason?: string) => void, cols = 120, rows = 32): ShellBridge {
  const conn = new Client();
  let stream: ClientChannel | null = null;
  let closed = false;

  const close = (reason?: string): void => {
    if (closed) return;
    closed = true;
    try {
      conn.end();
    } catch {
      /* already gone */
    }
    onClose(reason);
  };

  conn.on('ready', () => {
    conn.shell({ term: 'xterm-256color', cols, rows }, (err, s) => {
      if (err) {
        onData(`\r\n[nexrelm] could not open shell: ${err.message}\r\n`);
        close(err.message);
        return;
      }
      stream = s;
      s.on('data', (d: Buffer) => onData(d.toString('utf8')));
      s.stderr.on('data', (d: Buffer) => onData(d.toString('utf8')));
      s.on('close', () => close());
    });
  });

  conn.on('keyboard-interactive', (_name, _instr, _lang, _prompts, finish) => finish([target.password]));
  conn.on('error', (e: Error & { level?: string }) => {
    onData(`\r\n[nexrelm] connection failed: ${e.message}${connectHint(e)}\r\n`);
    close(e.message);
  });
  conn.on('end', () => close());
  conn.on('close', () => close());

  conn.connect({ host: target.host, port: target.port, username: target.username, password: target.password, tryKeyboard: true, readyTimeout: 12_000 });

  return {
    write: (data) => {
      if (stream) stream.write(data);
    },
    resize: (c, r) => {
      if (stream) stream.setWindow(r, c, 0, 0);
    },
    end: () => close(),
  };
}

export interface SshResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run a single command over SSH and resolve its captured output. */
export function runSshCommand(target: ShellTarget, command: string, timeoutMs = 12_000): Promise<SshResult> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const fail = (e: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        conn.end();
      } catch {
        /* noop */
      }
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    const ok = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        conn.end();
      } catch {
        /* noop */
      }
      resolve({ code, stdout, stderr });
    };
    const timer = setTimeout(() => fail(new Error('ssh command timed out')), timeoutMs);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) return fail(err);
        stream
          .on('close', (code: number | null) => ok(code))
          .on('data', (d: Buffer) => (stdout += d.toString('utf8')))
          .stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
      });
    });
    conn.on('keyboard-interactive', (_n, _i, _l, _p, finish) => finish([target.password]));
    conn.on('error', (e) => fail(e));
    conn.connect({ host: target.host, port: target.port, username: target.username, password: target.password, tryKeyboard: true, readyTimeout: Math.min(timeoutMs, 10_000) });
  });
}
