import { describe, it, expect } from 'vitest';
import type { Valor } from './tipos';
import { decidirIA, decidirLanceConP, type ContextoIA } from './ia';

const mano = (...v: number[]) => v.map((valor) => ({ palo: 'oros' as const, valor: valor as Valor }));

function contexto(cambios: Partial<ContextoIA> = {}): ContextoIA {
  return {
    asiento: 0, mano: 0, fase: 'lance', lance: 'grande', cartas: mano(4, 5, 6, 7),
    declaraciones: [null, null, null, null], participantes: [0, 1, 2, 3], envite: null,
    aceptado: 0, puntos: [0, 0], juegos: [0, 0], vueltasMus: 0, ...cambios,
  };
}

const siempre = (x: number) => () => x;

describe('IA: apuestas y faroles', () => {
  it('con buena mano apuesta', () => {
    expect(decidirLanceConP(contexto(), 0.75, siempre(0.99)).tipo).toBe('envido');
  });

  it('con mano floja normalmente pasa', () => {
    expect(decidirLanceConP(contexto(), 0.3, siempre(0.99)).tipo).toBe('paso');
  });

  it('con mano floja, si le sale, se tira un farol', () => {
    expect(decidirLanceConP(contexto(), 0.3, siempre(0))).toEqual({ tipo: 'envido', cantidad: 2 });
  });

  it('no se tira faroles con una mano perdida', () => {
    expect(decidirLanceConP(contexto(), 0.05, siempre(0)).tipo).toBe('paso');
  });

  it('con muy buena mano a veces pasa para tender una trampa', () => {
    expect(decidirLanceConP(contexto(), 0.9, siempre(0.05)).tipo).toBe('paso');
    expect(decidirLanceConP(contexto(), 0.9, siempre(0.5)).tipo).toBe('envido');
  });

  it('si le envidan y no compensa, rechaza... o sube de farol si le sale', () => {
    const c = contexto({ envite: { apostador: 1, cantidad: 2 } });
    expect(decidirLanceConP(c, 0.2, siempre(0.99)).tipo).toBe('noquiero');
    expect(decidirLanceConP(c, 0.2, siempre(0)).tipo).toBe('envido');
  });

  it('acepta un envite pequeño con una mano razonable', () => {
    const c = contexto({ envite: { apostador: 1, cantidad: 2 } });
    expect(decidirLanceConP(c, 0.5, siempre(0.99)).tipo).toBe('quiero');
  });

  it('ante un órdago no se tira faroles: solo acepta con muy buena mano', () => {
    const c = contexto({ envite: { apostador: 1, cantidad: 'ordago' } });
    expect(decidirLanceConP(c, 0.3, siempre(0)).tipo).toBe('noquiero');
    expect(decidirLanceConP(c, 0.9, siempre(0.99)).tipo).toBe('quiero');
  });

  it('desesperado (muy por detrás) puede lanzar un órdago de farol', () => {
    const c = contexto({ puntos: [10, 34] });
    expect(decidirLanceConP(c, 0.35, siempre(0)).tipo).toBe('ordago');
  });
});

describe('IA: mus y descarte', () => {
  it('con una mano muy buena corta el mus', () => {
    const c = contexto({ fase: 'mus', lance: null, cartas: mano(12, 12, 4, 4) });
    expect(decidirIA(c, siempre(0.99)).tipo).toBe('corte');
  });

  it('con una mano mala pide mus, y a veces corta de farol', () => {
    const c = contexto({ fase: 'mus', lance: null, cartas: mano(4, 5, 6, 7) });
    expect(decidirIA(c, siempre(0.99)).tipo).toBe('mus');
    expect(decidirIA(c, siempre(0)).tipo).toBe('corte');
  });

  it('en el descarte devuelve de 1 a 4 cartas válidas', () => {
    const c = contexto({ fase: 'descarte', lance: null, cartas: mano(12, 12, 4, 7) });
    const a = decidirIA(c);
    expect(a.tipo).toBe('descartar');
    if (a.tipo === 'descartar') {
      expect(a.indices.length).toBeGreaterThanOrEqual(1);
      expect(a.indices.every((i) => i >= 0 && i < 4)).toBe(true);
    }
  });
});
