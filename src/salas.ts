import { randomUUID } from 'node:crypto';
import { Partida, type EstadoPartida } from './partida';
import type { Accion, Equipo, Fase, ItemRecuento, Lance, Ronda } from './ronda';
import type { Mano } from './tipos';
import { decidirIA, type ContextoIA } from './ia';

const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin la I ni la O, para no confundir
const MAX_SALAS = 200;
const NOMBRES_IA = ['Antonio', 'Carmen', 'Pepe', 'Lola', 'Manolo', 'Rosa'];
const ESPERA_RECUENTO = 60_000; // si alguien no pulsa "continuar", la partida sigue sola pasado este tiempo

export interface Jugador {
  nombre: string;
  token: string;
  conectado: boolean;
  ia: boolean;
}

export interface Evento {
  asiento: number;
  tipo: Accion['tipo'] | 'llevan';
  lance: Lance | null;
  cantidad?: number;
  subida?: boolean; // un envite que sube sobre otro ("2 más")
}

export interface Vista {
  codigo: string;
  asiento: number;
  anfitrion: number | null;
  jugadores: ({ nombre: string; conectado: boolean; ia: boolean } | null)[];
  estado: 'esperando' | EstadoPartida;
  // A partir de aquí, solo cuando ha empezado la partida
  ganador?: Equipo | null;
  juegos?: [number, number];
  puntos?: [number, number];
  puntosAntes?: [number, number];
  mano?: number;
  turno?: number | null;
  fase?: Fase;
  lance?: Lance | null;
  punto?: boolean;
  declarando?: boolean;
  declaraciones?: (boolean | null)[];
  participantes?: number[];
  envite?: { apostador: Equipo; asiento: number; cantidad: number | 'ordago' } | null;
  apuesta?: { total: number | 'ordago'; alRechazar: number } | null;
  aceptados?: Record<Lance, number>;
  misCartas?: Mano;
  registro?: Evento[];
  // Solo cuando la ronda ha terminado
  manosReveladas?: Mano[];
  recuento?: ItemRecuento[];
  juegoGanadoPor?: Equipo | null;
  confirmados?: number[];
}

export interface OpcionesSala {
  auto?: boolean; // false: no se programan las jugadas automáticas (para los tests)
  retardos?: { declarar: number; ia: number; recuento: number };
}

function validarAccion(x: unknown): Accion {
  if (typeof x !== 'object' || x === null) throw new Error('Acción no válida');
  const a = x as Record<string, unknown>;
  switch (a.tipo) {
    case 'mus':
    case 'corte':
    case 'tengo':
    case 'notengo':
    case 'paso':
    case 'ordago':
    case 'quiero':
    case 'noquiero':
      return { tipo: a.tipo };
    case 'envido':
      if (typeof a.cantidad !== 'number') throw new Error('Falta la cantidad del envite');
      return { tipo: 'envido', cantidad: a.cantidad };
    case 'descartar':
      if (!Array.isArray(a.indices) || a.indices.length > 4 || !a.indices.every((i) => typeof i === 'number')) {
        throw new Error('Descarte no válido');
      }
      return { tipo: 'descartar', indices: a.indices as number[] };
    default:
      throw new Error('Acción desconocida');
  }
}

const asientoValido = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 4;

export class Sala {
  readonly codigo: string;
  jugadores: (Jugador | null)[] = [null, null, null, null];
  partida: Partida | null = null;
  ultimaActividad = Date.now();
  onCambio: (() => void) | null = null; // se llama cuando la sala cambia sola (jugadas automáticas)

  private anfitrionToken: string | null = null;
  private registro: Evento[] = [];
  private recuentoDesde = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private auto: boolean;
  private retardos: { declarar: number; ia: number; recuento: number };

  constructor(codigo: string, opciones: OpcionesSala = {}) {
    this.codigo = codigo;
    this.auto = opciones.auto ?? true;
    this.retardos = opciones.retardos ?? { declarar: 700, ia: 900, recuento: 400 };
  }

  // ---------- Sala de espera ----------

  asientoDe(token: string): number {
    return this.jugadores.findIndex((j) => j !== null && j.token === token);
  }

  asientoAnfitrion(): number | null {
    if (this.anfitrionToken === null) return null;
    const a = this.asientoDe(this.anfitrionToken);
    return a === -1 ? null : a;
  }

  private exigirAnfitrion(quien: number): void {
    if (this.asientoAnfitrion() !== quien) throw new Error('Solo el anfitrión puede hacer eso');
  }

  private exigirEspera(): void {
    if (this.partida) throw new Error('La partida ya ha empezado');
  }

    unirse(nombre: unknown): { asiento: number; token: string } {
        // Partida ya empezada: solo se puede volver a coger el sitio de un humano desconectado
        if (this.partida) {
            const libre = this.jugadores.findIndex((j) => j !== null && !j.ia && !j.conectado);
            if (libre === -1) {
                throw new Error('La partida ya ha empezado');
            }
            const jugador = this.jugadores[libre]!;
            const tokenNuevo = randomUUID();
            if (this.anfitrionToken === jugador.token) {
                this.anfitrionToken = tokenNuevo;
            }
            jugador.token = tokenNuevo;
            jugador.conectado = true;
            this.ultimaActividad = Date.now();
            this.programar();
            return { asiento: libre, token: tokenNuevo };
        }

        const asiento = this.jugadores.findIndex((j) => j === null);
        if (asiento === -1) {
            throw new Error('La sala está llena');
        }

        let limpio = typeof nombre === 'string' ? nombre.trim().slice(0, 16) : '';
        if (limpio === '') {
            limpio = `Jugador ${asiento + 1}`;
        }

        const token = randomUUID();
        this.jugadores[asiento] = { nombre: limpio, token, conectado: true, ia: false };
        if (this.anfitrionToken === null) {
            this.anfitrionToken = token;
        }
        this.ultimaActividad = Date.now();
        return { asiento, token };
    }

  // Cambiar de sitio. Cada uno puede moverse a un hueco (o al sitio de una IA);
  // el anfitrión puede además cambiar de sitio a cualquier jugador.
  mover(quien: number, origen: unknown, destino: unknown): void {
    this.exigirEspera();
    if (!asientoValido(origen) || !asientoValido(destino)) throw new Error('Asiento no válido');
    const j = this.jugadores[origen];
    if (!j) throw new Error('No hay nadie en ese sitio');
    const esAnfitrion = this.asientoAnfitrion() === quien;
    if (origen !== quien && !esAnfitrion) throw new Error('Solo el anfitrión puede mover a otros');
    if (origen === destino) return;
    const otro = this.jugadores[destino];
    if (otro && !otro.ia && !esAnfitrion) throw new Error('Ese sitio está ocupado');
    this.jugadores[origen] = otro;
    this.jugadores[destino] = j;
    this.ultimaActividad = Date.now();
  }

  anadirIA(quien: number, asiento: unknown): void {
    this.exigirEspera();
    this.exigirAnfitrion(quien);
    if (!asientoValido(asiento)) throw new Error('Asiento no válido');
    if (this.jugadores[asiento]) throw new Error('Ese sitio ya está ocupado');
    const usados = new Set(this.jugadores.filter((j) => j?.ia).map((j) => j!.nombre));
    const nombre = NOMBRES_IA.find((n) => !usados.has(`${n} (IA)`)) ?? 'Bot';
    this.jugadores[asiento] = { nombre: `${nombre} (IA)`, token: randomUUID(), conectado: true, ia: true };
    this.ultimaActividad = Date.now();
  }

  quitarIA(quien: number, asiento: unknown): void {
    this.exigirEspera();
    this.exigirAnfitrion(quien);
    if (!asientoValido(asiento)) throw new Error('Asiento no válido');
    if (!this.jugadores[asiento]?.ia) throw new Error('Ahí no hay ninguna IA');
    this.jugadores[asiento] = null;
    this.ultimaActividad = Date.now();
  }

  empezar(quien: number): void {
    this.exigirEspera();
    this.exigirAnfitrion(quien);
    if (!this.jugadores.every((j) => j !== null)) throw new Error('Faltan jugadores (puedes añadir una IA)');
    this.partida = new Partida();
    this.registro = [];
    this.ultimaActividad = Date.now();
    this.programar();
  }

  // Salirse de la sala. Antes de empezar se libera el sitio; ya empezada, solo se desconecta.
  abandonar(asiento: number): void {
    const j = this.jugadores[asiento];
    if (!j) return;
    if (this.partida) {
      j.conectado = false;
    } else {
      this.jugadores[asiento] = null;
      if (this.anfitrionToken === j.token) {
        this.anfitrionToken = this.jugadores.find((x) => x !== null && !x.ia)?.token ?? null;
      }
    }
    this.ultimaActividad = Date.now();
    this.programar();
  }

  reconectar(token: string): number | null {
    const asiento = this.asientoDe(token);
    if (asiento === -1) return null;
    this.jugadores[asiento]!.conectado = true;
    this.ultimaActividad = Date.now();
    this.programar();
    return asiento;
  }

  marcarConectado(asiento: number, conectado: boolean): void {
    const j = this.jugadores[asiento];
    if (j) j.conectado = conectado;
    this.ultimaActividad = Date.now();
    this.programar();
  }

  private hayHumanoConectado(): boolean {
    return this.jugadores.some((j) => j !== null && !j.ia && j.conectado);
  }

  todosDesconectados(): boolean {
    return !this.hayHumanoConectado();
  }

  // ---------- Jugar ----------

  // Lo que hace un jugador (humano) en su turno
  accion(asiento: number, a: unknown): void {
    const p = this.partida;
    if (!p) throw new Error('La partida aún no ha empezado');
    this.ejecutar(asiento, validarAccion(a));
    this.programar();
  }

  // Pulsar "continuar" al acabar una ronda
  continuar(asiento: number): void {
    const p = this.partida;
    if (!p) throw new Error('La partida aún no ha empezado');
    p.confirmar(asiento);
    this.ultimaActividad = Date.now();
    this.programar();
  }

  private ejecutar(asiento: number, accion: Accion): void {
    const p = this.partida!;
    const ronda: Ronda = p.ronda;
    const lance = ronda.lance;
    const pagosAntes = ronda.pagos.length;
    const habiaEnvite = ronda.envite !== null;

    p.accion(asiento, accion); // lanza un error si la jugada no es válida

    const evento: Evento = { asiento, tipo: accion.tipo, lance };
    if (accion.tipo === 'envido') {
      evento.cantidad = accion.cantidad;
      if (habiaEnvite) evento.subida = true;
    }
    if (accion.tipo === 'descartar') evento.cantidad = new Set(accion.indices).size;
    this.registro.push(evento);
    // Si rechazan un envite, quien lo hizo se lleva las piedras al momento
    for (const pago of ronda.pagos.slice(pagosAntes)) {
      this.registro.push({ asiento: pago.asiento, tipo: 'llevan', lance: pago.lance, cantidad: pago.piedras });
    }
    if (p.estado === 'recuento') this.recuentoDesde = Date.now();
    this.ultimaActividad = Date.now();
  }

  // ---------- Jugadas automáticas: declaraciones, IA y pasar de ronda ----------

  private todosConfirmados(): boolean {
    const p = this.partida;
    if (!p) return false;
    return this.jugadores.every((j, s) => j === null || j.ia || !j.conectado || p.confirmados.has(s));
  }

  private pendienteAuto(): 'declarar' | 'ia' | 'recuento' | null {
    const p = this.partida;
    if (!p || !this.hayHumanoConectado()) return null; // si no hay nadie delante, la partida espera
    if (p.estado === 'recuento') return 'recuento';
    if (p.estado !== 'jugando') return null;
    const r = p.ronda;
    if (r.fase === 'lance' && r.declarando) return 'declarar'; // se dice siempre la verdad
    if (this.jugadores[r.turno]?.ia) return 'ia';
    return null;
  }

  private contextoIA(asiento: number): ContextoIA {
    const p = this.partida!;
    const r = p.ronda;
    return {
      asiento,
      mano: r.mano,
      fase: r.fase === 'fin' ? 'mus' : r.fase,
      lance: r.lance,
      cartas: r.manos[asiento].map((c) => ({ ...c })),
      declaraciones: [...r.declaraciones],
      participantes: [...r.participantes],
      envite: r.envite ? { apostador: r.envite.apostador, cantidad: r.envite.cantidad } : null,
      aceptado: r.aceptadoParcial,
      puntos: [r.puntos[0], r.puntos[1]],
      juegos: [p.juegos[0], p.juegos[1]],
      vueltasMus: r.descartesHechos,
    };
  }

  private accionSegura(): Accion {
    const r = this.partida!.ronda;
    if (r.fase === 'mus') return { tipo: 'mus' };
    if (r.fase === 'descarte') return { tipo: 'descartar', indices: [0] };
    return r.envite ? { tipo: 'noquiero' } : { tipo: 'paso' };
  }

  // Hace una jugada automática si toca. Devuelve true si ha hecho algo.
  avanzarAuto(): boolean {
    const k = this.pendienteAuto();
    if (!k) return false;
    const p = this.partida!;

    if (k === 'declarar') {
      const s = p.ronda.turno;
      this.ejecutar(s, { tipo: p.ronda.tieneEnLance(s) ? 'tengo' : 'notengo' });
    } else if (k === 'ia') {
      const s = p.ronda.turno;
      try {
        this.ejecutar(s, decidirIA(this.contextoIA(s)));
      } catch {
        this.ejecutar(s, this.accionSegura()); // por si la IA se equivocara, nunca se queda atascada
      }
    } else {
      if (!this.todosConfirmados() && Date.now() - this.recuentoDesde < ESPERA_RECUENTO) return false;
      p.siguiente();
      this.registro = [];
    }
    this.ultimaActividad = Date.now();
    return true;
  }

  private programar(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = null;
    if (!this.auto) return;
    const k = this.pendienteAuto();
    if (!k) return;

    let espera: number;
    if (k === 'declarar') espera = this.retardos.declarar;
    else if (k === 'ia') espera = this.retardos.ia + Math.random() * 250;
    else if (this.todosConfirmados()) espera = this.retardos.recuento;
    else espera = Math.max(50, this.recuentoDesde + ESPERA_RECUENTO - Date.now());

    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      if (this.avanzarAuto()) this.onCambio?.();
      this.programar();
    }, espera);
  }

  detener(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = null;
    this.auto = false;
  }

  // ---------- Lo que ve cada jugador ----------

  // Solo ve sus cartas; las de los demás se enseñan al acabar la ronda
  vista(asiento: number): Vista {
    const base = {
      codigo: this.codigo,
      asiento,
      anfitrion: this.asientoAnfitrion(),
      jugadores: this.jugadores.map((j) => (j ? { nombre: j.nombre, conectado: j.conectado, ia: j.ia } : null)),
    };
    const p = this.partida;
    if (!p) return { ...base, estado: 'esperando' };

    const r = p.ronda;
    const jugando = p.estado === 'jugando';
    const vista: Vista = {
      ...base,
      estado: p.estado,
      ganador: p.ganador,
      juegos: [p.juegos[0], p.juegos[1]],
      puntos: jugando ? [r.puntos[0], r.puntos[1]] : [p.puntos[0], p.puntos[1]],
      mano: r.mano,
      turno: jugando ? r.turno : null,
      fase: r.fase,
      lance: r.lance,
      punto: r.esPunto,
      declarando: r.declarando,
      declaraciones: [...r.declaraciones],
      participantes: r.fase === 'lance' && !r.declarando ? [...r.participantes] : [],
      envite: r.envite ? { apostador: r.envite.apostador, asiento: r.envite.asiento, cantidad: r.envite.cantidad } : null,
      apuesta: r.envite
        ? {
            total: r.envite.cantidad === 'ordago' ? 'ordago' : r.aceptadoParcial + r.envite.cantidad,
            alRechazar: Math.max(1, r.aceptadoParcial),
          }
        : null,
      aceptados: { ...r.aceptado },
      misCartas: r.manos[asiento].map((c) => ({ ...c })),
      registro: [...this.registro],
    };
    if (!jugando) {
      vista.puntosAntes = [r.puntosAntesRecuento[0], r.puntosAntesRecuento[1]];
      vista.manosReveladas = r.manos.map((m) => m.map((c) => ({ ...c })));
      vista.recuento = r.recuento.map((i) => ({ ...i }));
      vista.juegoGanadoPor = p.juegoGanadoPor;
      vista.confirmados = [...p.confirmados];
    }
    return vista;
  }
}

export class Salas {
  private salas = new Map<string, Sala>();

  crear(opciones: OpcionesSala = {}): Sala {
    if (this.salas.size >= MAX_SALAS) throw new Error('El servidor está lleno, prueba más tarde');
    let codigo = '';
    do {
      codigo = Array.from({ length: 4 }, () => LETRAS[Math.floor(Math.random() * LETRAS.length)]).join('');
    } while (this.salas.has(codigo));
    const sala = new Sala(codigo, opciones);
    this.salas.set(codigo, sala);
    return sala;
  }

  obtener(codigo: string): Sala | undefined {
    return this.salas.get(codigo.trim().toUpperCase());
  }

  // Borra las salas vacías y sin actividad
  limpiar(maxInactividadMs = 30 * 60 * 1000): void {
    const ahora = Date.now();
    for (const [codigo, sala] of this.salas) {
      if (sala.todosDesconectados() && ahora - sala.ultimaActividad > maxInactividadMs) {
        sala.detener();
        this.salas.delete(codigo);
      }
    }
  }
}
