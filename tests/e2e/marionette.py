"""Minimal Marionette client (Thunderbird's built-in automation protocol).

Frames are "<length>:<json>". Commands are [0, id, name, params];
replies are [1, id, error, result].
"""
import json, socket, time


class Marionette:
    def __init__(self, port, host='127.0.0.1', timeout=60):
        deadline = time.time() + timeout
        while True:
            try:
                self.sock = socket.create_connection((host, port), timeout=120)
                break
            except OSError:
                if time.time() > deadline:
                    raise
                time.sleep(0.5)
        self.buf = b''
        self.next_id = 1
        self.hello = self._read()

    def _read(self):
        while b':' not in self.buf:
            self.buf += self._recv()
        n, rest = self.buf.split(b':', 1)
        n = int(n)
        while len(rest) < n:
            rest += self._recv()
        self.buf = rest[n:]
        return json.loads(rest[:n])

    def _recv(self):
        chunk = self.sock.recv(65536)
        if not chunk:
            raise ConnectionError('marionette closed the connection')
        return chunk

    def send(self, name, params=None):
        mid = self.next_id
        self.next_id += 1
        data = json.dumps([0, mid, name, params or {}]).encode()
        self.sock.sendall(str(len(data)).encode() + b':' + data)
        while True:
            msg = self._read()
            if msg[0] == 1 and msg[1] == mid:
                if msg[2]:
                    raise RuntimeError(f"{name}: {msg[2].get('error')}: {msg[2].get('message')}\n{msg[2].get('stacktrace', '')[:1500]}")
                return msg[3]

    def chrome(self):
        self.send('Marionette:SetContext', {'value': 'chrome'})

    def run(self, script, args=None, timeout_ms=120000):
        """Run async chrome JS. The script's body should `return` a value or a Promise."""
        wrapped = ('const __done = arguments[arguments.length - 1];'
                   '(async () => {' + script + '})().then(v => __done({ok: v}), e => __done({err: String(e) + "\\n" + (e && e.stack || "")}));')
        r = self.send('WebDriver:ExecuteAsyncScript', {'script': wrapped, 'args': args or [], 'scriptTimeout': timeout_ms,
                                                       'newSandbox': False})
        v = r.get('value') if isinstance(r, dict) else r
        if isinstance(v, dict) and 'err' in v:
            raise RuntimeError(v['err'])
        return v.get('ok') if isinstance(v, dict) else v
