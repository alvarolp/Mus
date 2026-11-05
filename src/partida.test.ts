import { describe, it, expect } from 'vitest';
import type { Mano, Valor } from './tipos';
import { Partida } from './partida';
import type { Ronda } from './ronda';

const m = (...v: number[]): Mano => v.map((valor) => ({ palo: 'oros' as const, valor: valor as Valor }));

// El asiento 0 tiene la mejor grande; sin pares
const MANOS = [m(12, 11, 10, 7), m(1, 4, 5, 6), m(11, 10, 7, 6), m(4, 5, 6, 7)];

function fijarManos(p: Partida): void {
  p.ronda.manos = MANOS.map((x) => [...x]);
}

function declaran(p: Partida): void {
  const r: Ronda = p.ronda;
  while (r.fase === 'lance' && r.declarando) {
    const s = r.turno;
    p.accion(s, { tipo: r.tieneEnLance(s) ? 'tengo' : 'notengo' });
  }
}

// Juega una ronda entera pasando siempre (lo normal tras fijar las manos)
function rondaTranquila(p: Partida): void {
  const mano = p.ronda.mano;
  p.accion(mano, { tipo: 'corte' });
  for (let lance = 0; lance < 2; lance++) {
    for (let i = 0; i < 4; i++) p.accion((mano + i) % 4, { tipo: 'paso' });
  }
  declaran(p);
}

describe('partida', () => {
  it('empieza en 0-0 con el asiento 0 de mano', () => {
    const p = new Partida();
    expect(p.puntos).toEqual([0, 0]);
    expect(p.juegos).toEqual([0, 0]);
    expect(p.mano).toBe(0);
    expect(p.ganador).toBeNull();
    expect(p.estado).toBe('jugando');
  });

  it('al acabar una ronda se queda en recuento hasta continuar', () => {
    const p = new Partida();
    fijarManos(p);
    rondaTranquila(p);
    expect(p.estado).toBe('recuento');
    expect(p.puntos).toEqual([5, 1]);
    expect(p.ronda.recuento).toHaveLength(3);
    expect(() => p.accion(0, { tipo: 'mus' })).toThrow();
  });

  it('al continuar se acumulan las piedras y la mano pasa al siguiente', () => {
    const p = new Partida();
    fijarManos(p);
    rondaTranquila(p);
    p.confirmar(0);
    expect(p.confirmados.has(0)).toBe(true);
    p.siguiente();
    expect(p.estado).toBe('jugando');
    expect(p.mano).toBe(1);
    expect(p.ronda.mano).toBe(1);
    expect(p.ronda.fase).toBe('mus');
    expect(p.ronda.puntos).toEqual([5, 1]);
  });

  it('ganar un juego suma 1 al equipo y reinicia las piedras al continuar', () => {
    const p = new Partida();
    fijarManos(p);
    p.accion(0, { tipo: 'corte' });
    p.accion(0, { tipo: 'ordago' });
    p.accion(1, { tipo: 'quiero' });
    expect(p.estado).toBe('recuento');
    expect(p.juegos).toEqual([1, 0]);
    expect(p.juegoGanadoPor).toBe(0);
    expect(p.puntos).toEqual([40, 0]);
    p.siguiente();
    expect(p.puntos).toEqual([0, 0]);
    expect(p.ronda.puntos).toEqual([0, 0]);
    expect(p.ganador).toBeNull();
  });

    it('con 3 juegos ganados se acaba la partida tras el último recuento', () => {
        const p = new Partida();
        fijarManos(p);
        p.accion(0, { tipo: 'corte' });
        p.accion(0, { tipo: 'ordago' });
        p.accion(1, { tipo: 'quiero' }); // 1-0
        p.siguiente();

        fijarManos(p); // mano: asiento 1
        p.accion(1, { tipo: 'corte' });
        p.accion(1, { tipo: 'ordago' });
        p.accion(2, { tipo: 'quiero' }); // 2-0
        expect(p.ganador).toBeNull();
        p.siguiente();

        fijarManos(p); // mano: asiento 2
        p.accion(2, { tipo: 'corte' });
        p.accion(2, { tipo: 'ordago' });
        p.accion(3, { tipo: 'quiero' }); // 3-0

        expect(p.juegos).toEqual([3, 0]);
        expect(p.ganador).toBe(0);
        expect(p.estado).toBe('recuento');
        p.siguiente();
        expect(p.estado).toBe('fin');
        expect(() => p.accion(0, { tipo: 'mus' })).toThrow();
    });
});
