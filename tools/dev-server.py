#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
本地开发服务器（替代 python -m http.server）

python -m http.server 会把 .mjs / .wasm 当成 text/plain 或 octet-stream，
浏览器据此拒绝加载 ES module 和 WebAssembly，页面直接白屏。
这里补上正确的 MIME，并禁用缓存，方便边改边刷。

用法：python tools/dev-server.py [端口]
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

EXTRA_TYPES = {
    ".mjs": "text/javascript; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".wasm": "application/wasm",
    ".bcmap": "application/octet-stream",
    ".pfb": "application/octet-stream",
    ".gz": "application/gzip",
    ".traineddata": "application/octet-stream",
}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, **EXTRA_TYPES}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8898
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"serving {root} at http://127.0.0.1:{port}/")
    srv.serve_forever()


if __name__ == "__main__":
    main()
