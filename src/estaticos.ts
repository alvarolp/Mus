import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../public/', import.meta.url));

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const SEGURIDAD = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
};

export async function servirEstaticos(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, SEGURIDAD);
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    let ruta = decodeURIComponent(url.pathname);
    if (ruta.endsWith('/')) ruta += 'index.html';

    const archivo = normalize(join(RAIZ, ruta));
    if (!archivo.startsWith(RAIZ)) throw new Error('fuera de la carpeta');

    const datos = await readFile(archivo);
    res.writeHead(200, {
      ...SEGURIDAD,
      'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : datos);
  } catch {
    res.writeHead(404, { ...SEGURIDAD, 'content-type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }
}
