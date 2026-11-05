import type { Carta, Mano } from './tipos';

export function rango(c: Carta): number {
  return c.valor === 3 ? 12 : c.valor === 2 ? 1 : c.valor;
}

const FUERZA: Record<number, number> = { 12: 8, 11: 7, 10: 6, 7: 5, 6: 4, 5: 3, 4: 2, 1: 1 };
const fuerza = (c: Carta): number => FUERZA[rango(c)];

export function valorPuntos(c: Carta): number {
  if (c.valor >= 10 || c.valor === 3) return 10;
  if (c.valor === 2) return 1;
  return c.valor;
}

function compararLista(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function compararGrande(a: Mano, b: Mano): number {
  const fa = a.map(fuerza).sort((x, y) => y - x);
  const fb = b.map(fuerza).sort((x, y) => y - x);
  return compararLista(fa, fb);
}

export function compararChica(a: Mano, b: Mano): number {
  const fa = a.map(fuerza).sort((x, y) => x - y);
  const fb = b.map(fuerza).sort((x, y) => x - y);
  return compararLista(fb, fa);
}

export type Pares =
  | { tipo: 'ninguno' }
  | { tipo: 'pares'; alto: number }
  | { tipo: 'medias'; alto: number }
  | { tipo: 'duples'; alto: number; bajo: number };

export function analizarPares(m: Mano): Pares {
  const cuentas = new Map<number, number>();
  for (const c of m) cuentas.set(fuerza(c), (cuentas.get(fuerza(c)) ?? 0) + 1);

  const grupos = [...cuentas.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[0] - a[0]);

  if (grupos.length === 0) return { tipo: 'ninguno' };
  if (grupos.length === 2) return { tipo: 'duples', alto: grupos[0][0], bajo: grupos[1][0] };

  const [f, n] = grupos[0];
  if (n === 4) return { tipo: 'duples', alto: f, bajo: f };
  if (n === 3) return { tipo: 'medias', alto: f };
  return { tipo: 'pares', alto: f };
}

const NIVEL_PARES = { ninguno: 0, pares: 1, medias: 2, duples: 3 };

export function compararPares(a: Pares, b: Pares): number {
  const na = NIVEL_PARES[a.tipo];
  const nb = NIVEL_PARES[b.tipo];
  if (na !== nb) return na - nb;
  if (a.tipo === 'ninguno' || b.tipo === 'ninguno') return 0;
  if (a.tipo === 'duples' && b.tipo === 'duples') return a.alto - b.alto || a.bajo - b.bajo;
  return a.alto - b.alto;
}

export function puntosPares(p: Pares): number {
  return NIVEL_PARES[p.tipo];
}

export function suma(m: Mano): number {
  return m.reduce((s, c) => s + valorPuntos(c), 0);
}

export function tieneJuego(m: Mano): boolean {
  return suma(m) >= 31;
}

const FUERZA_JUEGO: Record<number, number> = { 31: 8, 32: 7, 40: 6, 37: 5, 36: 4, 35: 3, 34: 2, 33: 1 };

export function compararJuego(a: Mano, b: Mano): number {
  const sa = suma(a);
  const sb = suma(b);
  const ja = sa >= 31;
  const jb = sb >= 31;
  if (ja && jb) return FUERZA_JUEGO[sa] - FUERZA_JUEGO[sb];
  if (ja !== jb) return ja ? 1 : -1;
  return sa - sb;
}

export function puntosJuego(m: Mano): number {
  const s = suma(m);
  if (s === 31) return 3;
  if (s > 31) return 2;
  return 1;
}

export function mejorIndice<T>(items: T[], comparar: (a: T, b: T) => number): number {
  let mejor = 0;
  for (let i = 1; i < items.length; i++) {
    if (comparar(items[i], items[mejor]) > 0) mejor = i;
  }
  return mejor;
}
