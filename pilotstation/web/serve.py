"""Dev server with no-cache headers and aviation weather proxy for CORS."""
import http.server
import os
import urllib.request
import urllib.error

os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Allowed proxy targets (aviationweather.gov endpoints)
PROXY_ROUTES = {
    '/api/windtemp': 'https://aviationweather.gov/api/data/windtemp',
}


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_GET(self):
        # Check if this is a proxy request
        path = self.path.split('?')[0]
        if path in PROXY_ROUTES:
            self._proxy_request()
            return
        # Otherwise serve static files
        super().do_GET()

    def _proxy_request(self):
        path_parts = self.path.split('?', 1)
        base_path = path_parts[0]
        query = path_parts[1] if len(path_parts) > 1 else ''

        target = PROXY_ROUTES.get(base_path)
        if not target:
            self.send_error(404)
            return

        url = f'{target}?{query}' if query else target
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'PilotStation/1.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = resp.read()
                content_type = resp.headers.get('Content-Type', 'text/plain')

            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            msg = str(e).encode()
            self.send_response(502)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)


http.server.HTTPServer(('0.0.0.0', 8080), DevHandler).serve_forever()
