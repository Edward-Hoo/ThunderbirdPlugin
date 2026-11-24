# Static file server for the headless-Chrome tests. /__sleep?ms=N answers after N ms,
# which lets a test page hold its load event open while real-time work (WebCrypto) runs.
import sys, time, http.server, urllib.parse

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == '/__sleep':
            ms = int(urllib.parse.parse_qs(u.query).get('ms', ['1000'])[0])
            time.sleep(min(ms, 30000) / 1000)
            self.send_response(200)
            self.send_header('Content-Type', 'image/gif')
            self.end_headers()
            self.wfile.write(b'GIF89a\x01\x00\x01\x00\x00\x00\x00;')
            return
        return super().do_GET()

http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()
