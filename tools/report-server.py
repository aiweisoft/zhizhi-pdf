#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
自测结果收集器

浏览器里的测试页面把结果 POST 到 /result，这里落到 tests/last-result.json，
方便在没有 Playwright 的情况下从命令行读到断言结果。

用法：python tools/report-server.py [端口]
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "last-result.json")


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            data = {"raw": raw.decode("utf-8", "replace")}

        with open(OUT, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def do_GET(self):
        # /reset 用于清掉上一轮结果
        if self.path.startswith("/reset"):
            if os.path.exists(OUT):
                os.remove(OUT)
            self.send_response(200)
            self._cors()
            self.end_headers()
            self.wfile.write(b"reset")
            return
        self.send_response(404)
        self._cors()
        self.end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"report server on http://127.0.0.1:{port}/result -> {OUT}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
