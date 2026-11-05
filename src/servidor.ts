import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Salas, type Sala } from './salas';
import { servirEstaticos } from './estaticos';

const PUERTO = Number(process.env.PORT ?? 3000);
const salas = new Salas();

// Cada jugador se identifica por su token (el asiento puede cambiar en la sala de espera)
const sockets = new WeakMap<Sala, Map<string, WebSocket>>();
const conexiones = new Map<WebSocket, { sala: Sala; token: string }>();
const vivos = new Set<WebSocket>();

const http = createServer((req, res) => {
  void servirEstaticos(req, res);
});
const wss = new WebSocketServer({ server: http, maxPayload: 4096 });

function enviar(ws: WebSocket, mensaje: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(mensaje));
}

function enviarEstado(sala: Sala): void {
  const mapa = sockets.get(sala);
  if (!mapa) return;
  for (const [token, ws] of mapa) {
    const asiento = sala.asientoDe(token);
    if (asiento !== -1) enviar(ws, { t: 'estado', ...sala.vista(asiento) });
  }
}

function prepararSala(sala: Sala): void {
  sala.onCambio = () => enviarEstado(sala); // para las jugadas automáticas (IA, declaraciones...)
  sockets.set(sala, new Map());
}

function entrar(ws: WebSocket, sala: Sala, asiento: number, token: string): void {
  const mapa = sockets.get(sala)!;

  // Si ese jugador ya tenía una conexión (por ejemplo, el móvil cambió de red), se cierra la vieja
  const vieja = mapa.get(token);
  if (vieja && vieja !== ws) {
    conexiones.delete(vieja);
    vieja.close();
  }
  mapa.set(token, ws);
  conexiones.set(ws, { sala, token });
  sala.marcarConectado(asiento, true);
  enviar(ws, { t: 'unido', codigo: sala.codigo, asiento, token });
  enviarEstado(sala);
}

// Quita la conexión de su sala. Si la partida no ha empezado y se abandona, el sitio queda libre.
function desconectar(ws: WebSocket, abandonar: boolean): void {
  const c = conexiones.get(ws);
  if (!c) return;
  conexiones.delete(ws);
  const mapa = sockets.get(c.sala);
  if (mapa?.get(c.token) === ws) mapa.delete(c.token);
  const asiento = c.sala.asientoDe(c.token);
  if (asiento !== -1) {
    if (abandonar) c.sala.abandonar(asiento);
    else c.sala.marcarConectado(asiento, false);
  }
  enviarEstado(c.sala);
}

function manejar(ws: WebSocket, msg: unknown): void {
  if (typeof msg !== 'object' || msg === null) throw new Error('Mensaje no válido');
  const m = msg as Record<string, unknown>;

  // --- Entrar en una sala ---
  if (m.t === 'crear' || m.t === 'unirse' || m.t === 'reconectar') {
    if (conexiones.has(ws)) throw new Error('Ya estás en una sala');

    if (m.t === 'crear') {
      const sala = salas.crear();
      prepararSala(sala);
      const { asiento, token } = sala.unirse(m.nombre);
      entrar(ws, sala, asiento, token);
      return;
    }

    const sala = salas.obtener(String(m.codigo ?? ''));
    if (!sala) throw new Error('No existe esa sala');
    if (!sockets.has(sala)) prepararSala(sala);

    if (m.t === 'unirse') {
      const { asiento, token } = sala.unirse(m.nombre);
      entrar(ws, sala, asiento, token);
    } else {
      const token = String(m.token ?? '');
      const asiento = sala.reconectar(token);
      if (asiento === null) throw new Error('No se ha podido reconectar a la sala');
      entrar(ws, sala, asiento, token);
    }
    return;
  }

  // --- Ya dentro de una sala ---
  const c = conexiones.get(ws);
  if (!c) throw new Error('No estás en ninguna sala');
  const sala = c.sala;
  const asiento = sala.asientoDe(c.token);
  if (asiento === -1) throw new Error('Ya no estás en la sala');

  switch (m.t) {
    case 'salir':
      desconectar(ws, true);
      return;
    case 'mover':
      sala.mover(asiento, m.origen, m.destino);
      break;
    case 'anadirIA':
      sala.anadirIA(asiento, m.asiento);
      break;
    case 'quitarIA':
      sala.quitarIA(asiento, m.asiento);
      break;
    case 'empezar':
      sala.empezar(asiento);
      break;
    case 'accion':
      sala.accion(asiento, m.accion);
      break;
    case 'continuar':
      sala.continuar(asiento);
      break;
    default:
      throw new Error('Mensaje desconocido');
  }
  enviarEstado(sala);
}

wss.on('connection', (ws) => {
  vivos.add(ws);
  ws.on('pong', () => vivos.add(ws));

  ws.on('message', (datos) => {
    try {
      manejar(ws, JSON.parse(datos.toString()));
    } catch (e) {
      const raro = e instanceof SyntaxError || e instanceof TypeError || !(e instanceof Error);
      enviar(ws, { t: 'error', mensaje: raro ? 'Mensaje no válido' : (e as Error).message });
    }
  });

  ws.on('close', () => {
    vivos.delete(ws);
    desconectar(ws, false);
  });
});

// Cada 30 s se comprueba que las conexiones siguen vivas (los móviles se caen sin avisar)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!vivos.has(ws)) {
      ws.terminate();
      continue;
    }
    vivos.delete(ws);
    ws.ping();
  }
}, 30_000);

setInterval(() => salas.limpiar(), 5 * 60_000);

http.listen(PUERTO, () => console.log(`Servidor de mus escuchando en el puerto ${PUERTO}`));
