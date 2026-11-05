import { describe, it, expect } from 'vitest';
import type { Mano, Valor } from './tipos';
import { crearBaraja, barajar } from './baraja';
import {
  compararGrande, compararChica, analizarPares, compararPares,
  puntosPares, compararJuego, puntosJuego, mejorIndice,
} from './reglas';

const m = (...v: number[]): Mano => v.map((valor) => ({ palo: 'oros' as const, valor: valor as Valor }));

describe('baraja', () => {
  it('tiene 40 cartas y al barajar no se pierde ninguna', () => {
    expect(crearBaraja()).toHaveLength(40);
    expect(barajar(crearBaraja())).toHaveLength(40);
  });
});

describe('grande y chica', () => {
  it('el 3 vale como rey', () => {
    expect(compararGrande(m(3, 3, 3, 3), m(12, 12, 12, 12))).toBe(0);
  });
  it('grande: gana la mejor carta, luego desempata por la siguiente', () => {
    expect(compararGrande(m(12, 12, 1, 4), m(12, 11, 11, 11))).toBeGreaterThan(0);
    expect(compararGrande(m(12, 11, 7, 4), m(12, 11, 7, 1))).toBeGreaterThan(0);
  });
  it('chica: gana la mano más baja', () => {
    expect(compararChica(m(1, 2, 4, 5), m(1, 4, 5, 6))).toBeGreaterThan(0);
  });
});

describe('pares', () => {
  it('detecta pares, medias y duples', () => {
    expect(analizarPares(m(12, 12, 4, 5)).tipo).toBe('pares');
    expect(analizarPares(m(3, 12, 12, 5)).tipo).toBe('medias');
    expect(analizarPares(m(3, 12, 4, 4)).tipo).toBe('duples');
    expect(analizarPares(m(7, 7, 7, 7)).tipo).toBe('duples');
    expect(analizarPares(m(1, 4, 5, 6)).tipo).toBe('ninguno');
  });
  it('duples > medias > pares > nada', () => {
    const d = analizarPares(m(4, 4, 5, 5));
    const me = analizarPares(m(12, 12, 12, 5));
    const p = analizarPares(m(12, 12, 4, 5));
    const n = analizarPares(m(1, 4, 5, 6));
    expect(compararPares(d, me)).toBeGreaterThan(0);
    expect(compararPares(me, p)).toBeGreaterThan(0);
    expect(compararPares(p, n)).toBeGreaterThan(0);
  });
  it('puntos: pares 1, medias 2, duples 3', () => {
    expect(puntosPares(analizarPares(m(12, 12, 4, 5)))).toBe(1);
    expect(puntosPares(analizarPares(m(12, 12, 12, 5)))).toBe(2);
    expect(puntosPares(analizarPares(m(4, 4, 5, 5)))).toBe(3);
  });
});

describe('juego y punto', () => {
  it('31 > 32 > 40', () => {
    expect(compararJuego(m(12, 11, 10, 1), m(12, 11, 10, 10))).toBeGreaterThan(0);
    expect(compararJuego(m(10, 11, 6, 6), m(12, 11, 10, 10))).toBeGreaterThan(0);
  });
  it('juego gana a punto, y en punto gana la suma más alta', () => {
    expect(compararJuego(m(12, 11, 10, 1), m(7, 7, 7, 7))).toBeGreaterThan(0);
    expect(compararJuego(m(7, 7, 7, 7), m(1, 4, 5, 6))).toBeGreaterThan(0);
  });
  it('puntos: 31 = 3, otro juego = 2, punto = 1', () => {
    expect(puntosJuego(m(12, 11, 10, 1))).toBe(3);
    expect(puntosJuego(m(10, 11, 6, 6))).toBe(2);
    expect(puntosJuego(m(1, 4, 5, 6))).toBe(1);
  });
});

describe('empates', () => {
  it('en empate gana el jugador más cercano a mano (el primero)', () => {
    expect(mejorIndice([m(12, 11, 7, 4), m(3, 10, 6, 5)], compararGrande)).toBe(0);
  });
});
