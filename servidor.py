"""Servidor local de PianoFlow (lo usa PianoFlow.vbs, en segundo plano y sin ventana).

Sirve esta carpeta en http://localhost:8085 solo para esta PC.
Si ya hay uno andando en ese puerto, este se cierra solo.
"""
import functools
import http.server
import os
import sys

PORT = 8085
HERE = os.path.dirname(os.path.abspath(__file__))

# Con pythonw no hay consola: los registros irían a ningún lado y harían fallar cada pedido.
if sys.stdout is None or sys.stderr is None:
    sys.stdout = sys.stderr = open(os.devnull, 'w')


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.webmanifest': 'application/manifest+json',
        '.js': 'text/javascript',
    }

    def end_headers(self):
        # Siempre la versión más nueva de la app (sin internet la sirve el service worker)
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *args):
        pass


class Server(http.server.ThreadingHTTPServer):
    # En Windows, "reusar la dirección" dejaría abrir dos servidores en el mismo puerto
    allow_reuse_address = False
    daemon_threads = True


def main():
    handler = functools.partial(Handler, directory=HERE)
    try:
        server = Server(('127.0.0.1', PORT), handler)
    except OSError:
        return  # ya está andando
    server.serve_forever()


if __name__ == '__main__':
    main()
