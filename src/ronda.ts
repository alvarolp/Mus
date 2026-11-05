import type { Carta, Mano } from './tipos';
import { crearBaraja, barajar } from './baraja';
import {
  compararGrande, compararChica, analizarPares, compararPares, puntosPares,
  compararJuego, tieneJuego, puntosJuego, mejorIndice,
} from './reglas';

export type Equipo = 0 | 1;
export const equipoDe = (asiento: number): Equipo => (asiento % 2) as Equipo;

export type Lance = 'grande' | 'chica' | 'pares' | 'juego'; // 'juego' incluye el punto
export type Fase = 'mus' | 'descarte' | 'lance' | 'fin';

export type Accion =
  | { tipo: 'mus' }
  | { tipo: 'corte' }
  | { tipo: 'descartar'; indices: number[] }
  | { tipo: 'tengo' }
  | { tipo: 'notengo' }
  | { tipo: 'paso' }
  | { tipo: 'envido'; cantidad: number }
  | { tipo: 'ordago' }
  | { tipo: 'quiero' }
  | { tipo: 'noquiero' };

export interface Envite {
  apostador: Equipo;
  asiento: number; // quién hizo el último envite
  cantidad: number | 'ordago';
  rechazos: number[]; // asientos rivales que ya han dicho "no quiero"
}

// Piedras que gana un equipo en un lance al contar la ronda (el punto va aparte)
export interface ItemRecuento {
  lance: Lance | 'punto';
  asiento: number; // jugador con la mejor mano de ese lance
  equipo: Equipo;
  piedras: number;
}

// Piedras que se lleva un equipo en el momento porque le rechazan un envite
export interface Pago {
  lance: Lance;
  asiento: number;
  equipo: Equipo;
  piedras: number;
}

const LANCES: Lance[] = ['grande', 'chica', 'pares', 'juego'];
const PIEDRAS_JUEGO = 40;

export class Ronda {
  readonly mano: number;
  puntos: [number, number];
  puntosAntesRecuento: [number, number];
  manos: Mano[] = [[], [], [], []];
  fase: Fase = 'mus';
  turno: number;
  ganadorJuego: Equipo | null = null;
  descartesHechos = 0; // vueltas de descarte que se han dado en esta ronda

  // Estado de los lances
  lance: Lance | null = null;
  declarando = false; // en Pares y Juego, cada jugador dice primero si tiene
  declaraciones: (boolean | null)[] = [null, null, null, null];
  participantes: number[] = [];
  envite: Envite | null = null;
  aceptadoParcial = 0;
  aceptado: Record<Lance, number> = { grande: 0, chica: 0, pares: 0, juego: 0 };
  rechazado: Record<Lance, boolean> = { grande: false, chica: false, pares: false, juego: false };
  recuento: ItemRecuento[] = [];
  pagos: Pago[] = [];

  private azar: () => number;
  private mazo: Carta[];
  private descartes: Carta[] = [];
  private dijeronMus: number[] = [];
  private descartaron: number[] = [];
  private pasaron: number[] = [];

  constructor(mano: number, puntos: [number, number] = [0, 0], azar: () => number = Math.random) {
    this.mano = mano;
    this.puntos = [puntos[0], puntos[1]];
    this.puntosAntesRecuento = [puntos[0], puntos[1]];
    this.azar = azar;
    this.mazo = barajar(crearBaraja(), azar);
    for (let ronda = 0; ronda < 4; ronda++) {
      for (let i = 0; i < 4; i++) this.manos[(mano + i) % 4].push(this.mazo.pop()!);
    }
    this.turno = mano;
  }

  // ¿Se está jugando al punto? (nadie tiene juego)
  get esPunto(): boolean {
    return this.lance === 'juego' && !this.declarando && this.declaraciones.every((d) => d === false);
  }

  // Lo que debería decir un jugador al declarar (siempre se dice la verdad)
  tieneEnLance(asiento: number): boolean {
    if (this.lance === 'pares') return analizarPares(this.manos[asiento]).tipo !== 'ninguno';
    if (this.lance === 'juego') return tieneJuego(this.manos[asiento]);
    return false;
  }

  // ---------- Entrada principal ----------

  accion(asiento: number, a: Accion): void {
    if (this.fase === 'fin') throw new Error('La ronda ha terminado');
    if (asiento !== this.turno) throw new Error('No es tu turno');
    if (this.fase === 'mus') return this.accionMus(asiento, a);
    if (this.fase === 'descarte') return this.accionDescarte(asiento, a);
    if (this.declarando) return this.accionDeclaracion(asiento, a);
    return this.accionLance(asiento, a);
  }

  // ---------- Mus y descarte ----------

  private accionMus(asiento: number, a: Accion): void {
    if (a.tipo === 'corte') {
      this.dijeronMus = [];
      this.fase = 'lance';
      this.lance = null;
      this.siguienteLance();
      return;
    }
    if (a.tipo !== 'mus') throw new Error('Ahora toca decir mus o corte');
    this.dijeronMus.push(asiento);
    if (this.dijeronMus.length === 4) {
      this.dijeronMus = [];
      this.descartaron = [];
      this.fase = 'descarte';
      this.turno = this.mano;
    } else {
      this.turno = (asiento + 1) % 4;
    }
  }

  private accionDescarte(asiento: number, a: Accion): void {
    if (a.tipo !== 'descartar') throw new Error('Ahora toca descartar');
    const indices = [...new Set(a.indices)];
    if (indices.length < 1 || indices.some((i) => !Number.isInteger(i) || i < 0 || i > 3)) {
      throw new Error('Descarte inválido: elige de 1 a 4 cartas');
    }
    const mano = this.manos[asiento];
    const quitadas = indices.map((i) => mano[i]);
    const nuevas = this.robar(indices.length);
    indices.forEach((i, k) => (mano[i] = nuevas[k]));
    this.descartes.push(...quitadas);

    this.descartaron.push(asiento);
    if (this.descartaron.length === 4) {
      this.descartaron = [];
      this.descartesHechos++;
      this.fase = 'mus';
      this.turno = this.mano;
    } else {
      this.turno = (asiento + 1) % 4;
    }
  }

  private robar(n: number): Carta[] {
    const r: Carta[] = [];
    for (let i = 0; i < n; i++) {
      if (this.mazo.length === 0) {
        this.mazo = barajar(this.descartes, this.azar);
        this.descartes = [];
      }
      const c = this.mazo.pop();
      if (!c) throw new Error('No quedan cartas');
      r.push(c);
    }
    return r;
  }

  // ---------- Lances ----------

  private ordenDesdeMano(): number[] {
    return [0, 1, 2, 3].map((i) => (this.mano + i) % 4);
  }

  // Quién juega cada lance según las cartas reales (se usa al contar)
  private participantesDe(l: Lance): number[] {
    const orden = this.ordenDesdeMano();
    if (l === 'grande' || l === 'chica') return orden;
    if (l === 'pares') return orden.filter((a) => analizarPares(this.manos[a]).tipo !== 'ninguno');
    const conJuego = orden.filter((a) => tieneJuego(this.manos[a]));
    return conJuego.length > 0 ? conJuego : orden; // si nadie tiene juego, se juega al punto
  }

  private siguienteLance(): void {
    const desde = this.lance ? LANCES.indexOf(this.lance) + 1 : 0;
    if (desde >= LANCES.length) {
      this.lance = null;
      this.declarando = false;
      this.contar();
      return;
    }
    const l = LANCES[desde];
    this.lance = l;
    this.envite = null;
    this.pasaron = [];
    this.aceptadoParcial = 0;
    this.participantes = [];
    this.declaraciones = [null, null, null, null];

    if (l === 'grande' || l === 'chica') {
      this.declarando = false;
      this.empezarApuestas(this.ordenDesdeMano());
    } else {
      // Pares y Juego: primero cada jugador, empezando por mano, dice si tiene
      this.declarando = true;
      this.turno = this.mano;
    }
  }

  private empezarApuestas(p: number[]): void {
    this.participantes = p;
    this.turno = p[0];
  }

  private accionDeclaracion(asiento: number, a: Accion): void {
    if (a.tipo !== 'tengo' && a.tipo !== 'notengo') throw new Error('Ahora toca decir si tienes o no');
    const tiene = this.tieneEnLance(asiento);
    if ((a.tipo === 'tengo') !== tiene) throw new Error('Hay que decir la verdad');
    this.declaraciones[asiento] = tiene;

    const orden = this.ordenDesdeMano();
    const siguiente = orden.find((s) => this.declaraciones[s] === null);
    if (siguiente !== undefined) {
      this.turno = siguiente;
      return;
    }

    // Han hablado los cuatro
    this.declarando = false;
    const conTener = orden.filter((s) => this.declaraciones[s] === true);
    const p = this.lance === 'juego' && conTener.length === 0 ? orden : conTener;
    const hayEquipo0 = p.some((s) => equipoDe(s) === 0);
    const hayEquipo1 = p.some((s) => equipoDe(s) === 1);
    if (hayEquipo0 && hayEquipo1) this.empezarApuestas(p); // se puede apostar
    else this.cerrarLance(0); // solo un equipo: no hay apuestas
  }

  private cerrarLance(aceptado: number): void {
    this.aceptado[this.lance!] = aceptado;
    this.envite = null;
    this.siguienteLance();
  }

  private rivalesPendientes(apostador: Equipo, desde: number, rechazos: number[]): number[] {
    const r: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const s = (desde + i) % 4;
      if (this.participantes.includes(s) && equipoDe(s) !== apostador && !rechazos.includes(s)) r.push(s);
    }
    return r;
  }

  private validarCantidad(n: number): void {
    if (!Number.isInteger(n) || n < 2 || n > PIEDRAS_JUEGO) {
      throw new Error('El envite debe ser un número entero entre 2 y 40');
    }
  }

  private accionLance(asiento: number, a: Accion): void {
    const eq = equipoDe(asiento);
    const e = this.envite;

    // --- Aún no hay envite: paso o primera apuesta ---
    if (e === null) {
      if (a.tipo === 'paso') {
        this.pasaron.push(asiento);
        if (this.pasaron.length === this.participantes.length) {
          this.cerrarLance(0);
        } else {
          const i = this.participantes.indexOf(asiento);
          this.turno = this.participantes[i + 1];
        }
        return;
      }
      if (a.tipo === 'envido') {
        this.validarCantidad(a.cantidad);
        this.lanzarEnvite(asiento, eq, a.cantidad);
        return;
      }
      if (a.tipo === 'ordago') {
        this.lanzarEnvite(asiento, eq, 'ordago');
        return;
      }
      throw new Error('Ahora toca paso, envido u órdago');
    }

    // --- Hay un envite pendiente: responden los rivales ---
    if (a.tipo === 'quiero') {
      if (e.cantidad === 'ordago') return this.resolverOrdago();
      this.cerrarLance(this.aceptadoParcial + e.cantidad);
      return;
    }
    if (a.tipo === 'noquiero') {
      e.rechazos.push(asiento);
      const quedan = this.rivalesPendientes(e.apostador, asiento, e.rechazos);
      if (quedan.length > 0) {
        this.turno = quedan[0];
        return;
      }
      // Rechazado por todos: el apostador se lleva lo ya aceptado (mínimo 1)
      const lance = this.lance!;
      const piedras = this.aceptadoParcial > 0 ? this.aceptadoParcial : 1;
      this.rechazado[lance] = true;
      this.pagos.push({ lance, asiento: e.asiento, equipo: e.apostador, piedras });
      this.sumar(e.apostador, piedras);
      if (this.ganadorJuego !== null) return;
      this.cerrarLance(0);
      return;
    }
    if (e.cantidad === 'ordago') throw new Error('Un órdago solo se puede aceptar o rechazar');
    if (a.tipo === 'envido') {
      this.validarCantidad(a.cantidad);
      this.aceptadoParcial += e.cantidad; // al subir, se acepta lo anterior
      this.lanzarEnvite(asiento, eq, a.cantidad);
      return;
    }
    if (a.tipo === 'ordago') {
      this.aceptadoParcial += e.cantidad;
      this.lanzarEnvite(asiento, eq, 'ordago');
      return;
    }
    throw new Error('Ahora toca quiero, no quiero, subir u órdago');
  }

  private lanzarEnvite(asiento: number, eq: Equipo, cantidad: number | 'ordago'): void {
    this.envite = { apostador: eq, asiento, cantidad, rechazos: [] };
    this.turno = this.rivalesPendientes(eq, asiento, [])[0];
  }

  private resolverOrdago(): void {
    this.puntosAntesRecuento = [this.puntos[0], this.puntos[1]];
    const ganador = equipoDe(this.ganadorDelLance(this.lance!, this.participantes));
    this.puntos[ganador] = PIEDRAS_JUEGO;
    this.ganadorJuego = ganador;
    this.fase = 'fin';
  }

  // ---------- Recuento ----------

  private ganadorDelLance(l: Lance, jugadores: number[]): number {
    const cmp =
      l === 'grande' ? compararGrande
      : l === 'chica' ? compararChica
      : l === 'pares' ? (a: Mano, b: Mano) => compararPares(analizarPares(a), analizarPares(b))
      : compararJuego;
    const i = mejorIndice(jugadores.map((s) => this.manos[s]), cmp);
    return jugadores[i]; // en empate gana el más cercano a mano
  }

  private sumar(eq: Equipo, n: number): void {
    if (this.ganadorJuego !== null || n <= 0) return;
    this.puntos[eq] = Math.min(PIEDRAS_JUEGO, this.puntos[eq] + n);
    if (this.puntos[eq] >= PIEDRAS_JUEGO) {
      this.ganadorJuego = eq;
      this.fase = 'fin';
    }
  }

  private contar(): void {
    this.puntosAntesRecuento = [this.puntos[0], this.puntos[1]];
    for (const l of LANCES) {
      if (this.ganadorJuego !== null) break;
      const p = this.participantesDe(l);
      if (p.length === 0) continue; // nadie tiene pares
      const asiento = this.ganadorDelLance(l, p);
      const ganador = equipoDe(asiento);
      let piedras = this.rechazado[l] ? 0 : this.aceptado[l];
      let nombre: ItemRecuento['lance'] = l;

      if (l === 'grande' || l === 'chica') {
        if (!this.rechazado[l] && piedras === 0) piedras = 1; // todos pasaron
      } else if (l === 'pares') {
        for (const s of p) {
          if (equipoDe(s) === ganador) piedras += puntosPares(analizarPares(this.manos[s]));
        }
      } else if (p.some((s) => tieneJuego(this.manos[s]))) {
        for (const s of p) {
          if (equipoDe(s) === ganador) piedras += puntosJuego(this.manos[s]);
        }
      } else {
        piedras += 1; // punto
        nombre = 'punto';
      }
      if (piedras > 0) this.recuento.push({ lance: nombre, asiento, equipo: ganador, piedras });
      this.sumar(ganador, piedras);
    }
    this.fase = 'fin';
  }
}
