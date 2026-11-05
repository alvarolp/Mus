import type { Carta, Mano } from './tipos';
import { crearBaraja } from './baraja';
import {
  compararGrande, compararChica, analizarPares, compararPares,
  compararJuego, tieneJuego, suma, rango, mejorIndice,
} from './reglas';
import type { Accion, Equipo, Lance } from './ronda';

// Lo único que sabe la IA: sus cartas y lo que es público en la mesa (nunca ve las cartas de los demás)
export interface ContextoIA {
  asiento: number;
  mano: number;
  fase: 'mus' | 'descarte' | 'lance';
  lance: Lance | null;
  cartas: Mano;
  declaraciones: (boolean | null)[]; // quién ha dicho que tiene pares / juego en este lance
  participantes: number[];
  envite: { apostador: Equipo; cantidad: number | 'ordago' } | null;
  aceptado: number; // piedras ya aceptadas en el lance (antes del envite pendiente)
  puntos: [number, number];
  juegos: [number, number];
  vueltasMus: number; // cuántas rondas de descarte se han hecho ya
}

// ---------- Valor aproximado de una mano (para cortar y para descartar) ----------

const TABLA_JUEGO: Record<number, number> = {
  31: 4.5, 32: 3.2, 40: 2.6, 37: 2.1, 36: 1.7, 35: 1.3, 34: 1.0, 33: 0.8, 30: 0.6, 29: 0.35, 28: 0.15,
};

export function puntuarMano(m: Mano): number {
  let s = 0;
  const par = analizarPares(m);
  if (par.tipo === 'pares') s += 1.0 + 0.05 * par.alto;
  else if (par.tipo === 'medias') s += 2.2 + 0.07 * par.alto;
  else if (par.tipo === 'duples') s += 3.6 + 0.05 * (par.alto + par.bajo);

  s += TABLA_JUEGO[suma(m)] ?? 0;

  for (const c of m) {
    const r = rango(c);
    if (r === 12) s += 0.35;
    else if (r === 11) s += 0.2;
    else if (r === 10) s += 0.1;
    if (r === 1) s += 0.3;
    else if (r === 4) s += 0.15;
    else if (r === 5) s += 0.08;
  }
  return s;
}

// Con una mano que valga al menos esto se corta; si no, se pide mus
export const UMBRAL_CORTE = 4.0;

// ---------- Simulaciones ----------

const BARAJA = crearBaraja();
const clave = (c: Carta): string => `${c.palo}${c.valor}`;

function restantes(mias: Mano): Carta[] {
  const ks = new Set(mias.map(clave));
  return BARAJA.filter((c) => !ks.has(clave(c)));
}

function mezclarParcial(a: Carta[], n: number): void {
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function cumple(l: Lance, mano: Mano, declarado: boolean | null): boolean {
  if (declarado === null) return true;
  if (l === 'pares') return (analizarPares(mano).tipo !== 'ninguno') === declarado;
  if (l === 'juego') return tieneJuego(mano) === declarado;
  return true;
}

function ganadorDelLance(l: Lance, manos: Mano[], participantes: number[], mano: number): number {
  const orden = [0, 1, 2, 3].map((i) => (mano + i) % 4).filter((s) => participantes.includes(s));
  const cmp =
    l === 'grande' ? compararGrande
    : l === 'chica' ? compararChica
    : l === 'pares' ? (a: Mano, b: Mano) => compararPares(analizarPares(a), analizarPares(b))
    : compararJuego;
  return orden[mejorIndice(orden.map((s) => manos[s]), cmp)];
}

// Probabilidad de que mi pareja gane el lance, repartiendo al azar las cartas que no veo
// pero respetando lo que los demás han dicho (tengo / no tengo)
export function probabilidadGanar(ctx: ContextoIA, lance: Lance, muestras = 160): number {
  const resto = restantes(ctx.cartas);
  const miEquipo = ctx.asiento % 2;
  let aceptadas = 0;
  let gana = 0;

  for (let intento = 0; intento < muestras * 40 && aceptadas < muestras; intento++) {
    mezclarParcial(resto, 12);
    const manos: Mano[] = [[], [], [], []];
    let k = 0;
    let valida = true;
    for (let s = 0; s < 4; s++) {
      if (s === ctx.asiento) {
        manos[s] = ctx.cartas;
        continue;
      }
      manos[s] = resto.slice(k, k + 4);
      k += 4;
      if (!cumple(lance, manos[s], ctx.declaraciones[s])) {
        valida = false;
        break;
      }
    }
    if (!valida) continue;
    aceptadas++;
    const g = ganadorDelLance(lance, manos, ctx.participantes, ctx.mano);
    if (g % 2 === miEquipo) gana++;
  }
  return aceptadas < 10 ? 0.5 : gana / aceptadas;
}

// ---------- Descarte ----------

function elegirDescarte(ctx: ContextoIA): number[] {
  const resto = restantes(ctx.cartas);
  let mejor: number[] = [0];
  let mejorValor = -Infinity;

  for (let mascara = 1; mascara < 16; mascara++) {
    const indices = [0, 1, 2, 3].filter((i) => mascara & (1 << i));
    let total = 0;
    const muestras = 50;
    for (let n = 0; n < muestras; n++) {
      mezclarParcial(resto, indices.length);
      const nueva = [...ctx.cartas];
      indices.forEach((idx, k) => (nueva[idx] = resto[k]));
      total += puntuarMano(nueva);
    }
    const valor = total / muestras;
    if (valor > mejorValor) {
      mejorValor = valor;
      mejor = indices;
    }
  }
  return mejor;
}

// ---------- Apuestas ----------

function probabilidadBase(ctx: ContextoIA): number {
  const eq = ctx.asiento % 2;
  const dif = ctx.puntos[eq] - ctx.puntos[1 - eq];
  return Math.min(0.85, Math.max(0.15, 0.5 + dif / 70));
}

// Probabilidades de los faroles y de las "trampas" (pasar con muy buena mano)
export const FAROL = {
  apuesta: 0.12, // con mano floja, apostar 2 de farol
  apuestaGrande: 0.02, // farol grande (4), muy raro
  subida: 0.05, // subir de farol cuando le han hecho un envite
  trampa: 0.1, // con muy buena mano, pasar para que el rival se anime
  desesperado: 0.1, // órdago de farol cuando va muy por detrás
  corte: 0.03, // cortar el mus con mano floja
};

// Decide qué hacer en un lance sabiendo la probabilidad p de que gane mi pareja.
// Se separa de la simulación para poder probarla con probabilidades y "suerte" fijas.
export function decidirLanceConP(ctx: ContextoIA, p: number, azar: () => number): Accion {
  const eq = ctx.asiento % 2;
  const base = probabilidadBase(ctx);
  const dif = ctx.puntos[eq] - ctx.puntos[1 - eq];
  const e = ctx.envite;

  // Nadie ha apostado todavía
  if (!e) {
    if (p >= 0.985 && dif < 25) return { tipo: 'ordago' };
    const cantidad = p >= 0.9 ? 5 : p >= 0.8 ? 4 : p >= 0.7 ? 3 : p >= 0.6 ? 2 : 0;
    if (cantidad > 0) {
      if (p >= 0.85 && azar() < FAROL.trampa) return { tipo: 'paso' }; // trampa
      return { tipo: 'envido', cantidad };
    }
    // Mano floja: de vez en cuando, farol
    if (ctx.puntos[1 - eq] >= 32 && dif <= -12 && p >= 0.3 && azar() < FAROL.desesperado) return { tipo: 'ordago' };
    if (p >= 0.2 && azar() < FAROL.apuesta) return { tipo: 'envido', cantidad: 2 };
    if (p >= 0.25 && azar() < FAROL.apuestaGrande) return { tipo: 'envido', cantidad: 4 };
    return { tipo: 'paso' };
  }

  // Me han lanzado un órdago: solo se acepta con muy buena mano
  if (e.cantidad === 'ordago') {
    return p >= Math.max(0.62, base + 0.1) ? { tipo: 'quiero' } : { tipo: 'noquiero' };
  }

  // Me han hecho un envite: subir, aceptar o rechazar
  const total = ctx.aceptado + e.cantidad;
  const alRechazar = Math.max(1, ctx.aceptado);
  if (p >= 0.985 && total >= 6 && dif < 25) return { tipo: 'ordago' };
  if (p >= 0.8 && total < 10) return { tipo: 'envido', cantidad: p >= 0.92 ? 4 : 2 };
  const ventaja = (2 * p - 1) * total + alRechazar - 0.05 * total; // cuánto sale a cuenta aceptar
  if (ventaja > 0) return { tipo: 'quiero' };
  // No compensa aceptar: normalmente se rechaza, pero a veces se sube de farol
  if (total < 6 && p >= 0.2 && azar() < FAROL.subida) return { tipo: 'envido', cantidad: 2 };
  return { tipo: 'noquiero' };
}

// ---------- Decisión ----------

export function decidirIA(ctx: ContextoIA, azar: () => number = Math.random): Accion {
  if (ctx.fase === 'mus') {
    const umbral = UMBRAL_CORTE - 0.7 * ctx.vueltasMus;
    const valor = puntuarMano(ctx.cartas);
    if (valor >= umbral) return { tipo: 'corte' };
    return azar() < FAROL.corte ? { tipo: 'corte' } : { tipo: 'mus' }; // a veces corta de farol
  }
  if (ctx.fase === 'descarte') return { tipo: 'descartar', indices: elegirDescarte(ctx) };
  return decidirLanceConP(ctx, probabilidadGanar(ctx, ctx.lance!), azar);
}
