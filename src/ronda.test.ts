import { describe, it, expect } from 'vitest';
import type { Mano, Valor } from './tipos';
import { Ronda } from './ronda';

const m = (...v: number[]): Mano => v.map((valor) => ({ palo: 'oros' as const, valor: valor as Valor }));

// Manos de prueba: sin pares; los asientos 0 y 2 (equipo 0) tienen juego; asiento 1 gana la chica
const SIN_PARES = [m(12, 11, 10, 7), m(1, 4, 5, 6), m(11, 10, 7, 6), m(4, 5, 6, 7)];

function nueva(manos = SIN_PARES, puntos: [number, number] = [0, 0]): Ronda {
  const r = new Ronda(0, puntos);
  r.manos = manos.map((x) => [...x]);
  r.accion(0, { tipo: 'corte' });
  return r;
}

const pasan = (r: Ronda, asientos: number[]) => asientos.forEach((s) => r.accion(s, { tipo: 'paso' }));

// Todos declaran la verdad (como hace el servidor solo) hasta que toca apostar o acabar
function declaran(r: Ronda): void {
  while (r.fase === 'lance' && r.declarando) {
    const s = r.turno;
    r.accion(s, { tipo: r.tieneEnLance(s) ? 'tengo' : 'notengo' });
  }
}

describe('reparto y mus', () => {
  it('reparte 4 cartas a cada jugador y empieza mano', () => {
    const r = new Ronda(2);
    expect(r.manos.every((x) => x.length === 4)).toBe(true);
    expect(r.turno).toBe(2);
    expect(r.fase).toBe('mus');
  });

  it('corte lleva a los lances empezando por la grande', () => {
    const r = nueva();
    expect(r.fase).toBe('lance');
    expect(r.lance).toBe('grande');
    expect(r.turno).toBe(0);
  });

  it('cuatro mus llevan al descarte y luego otra vez a mus', () => {
    const r = new Ronda(0);
    [0, 1, 2, 3].forEach((s) => r.accion(s, { tipo: 'mus' }));
    expect(r.fase).toBe('descarte');
    [0, 1, 2, 3].forEach((s) => r.accion(s, { tipo: 'descartar', indices: [0, 1] }));
    expect(r.fase).toBe('mus');
    expect(r.descartesHechos).toBe(1);
    expect(r.manos.every((x) => x.length === 4)).toBe(true);
  });

  it('rechaza turnos y descartes inválidos', () => {
    const r = new Ronda(0);
    expect(() => r.accion(1, { tipo: 'mus' })).toThrow();
    [0, 1, 2, 3].forEach((s) => r.accion(s, { tipo: 'mus' }));
    expect(() => r.accion(0, { tipo: 'descartar', indices: [] })).toThrow();
    expect(() => r.accion(0, { tipo: 'descartar', indices: [5] })).toThrow();
  });

  it('el mazo nunca se agota aunque se descarte mucho', () => {
    const r = new Ronda(0);
    for (let vuelta = 0; vuelta < 6; vuelta++) {
      [0, 1, 2, 3].forEach((s) => r.accion(s, { tipo: 'mus' }));
      [0, 1, 2, 3].forEach((s) => r.accion(s, { tipo: 'descartar', indices: [0, 1, 2, 3] }));
    }
    expect(r.fase).toBe('mus');
  });
});

describe('declaraciones de pares y juego', () => {
  it('en pares y juego cada jugador dice si tiene, uno a uno desde mano', () => {
    const r = nueva();
    pasan(r, [0, 1, 2, 3]); // grande
    pasan(r, [0, 1, 2, 3]); // chica
    expect(r.lance).toBe('pares');
    expect(r.declarando).toBe(true);
    expect(r.turno).toBe(0);
    r.accion(0, { tipo: 'notengo' });
    expect(r.turno).toBe(1);
    expect(r.declaraciones).toEqual([false, null, null, null]);
  });

  it('no se puede mentir al declarar', () => {
    const r = nueva([m(12, 12, 4, 5), m(7, 7, 5, 1), m(1, 4, 5, 6), m(11, 10, 6, 4)]);
    pasan(r, [0, 1, 2, 3]);
    pasan(r, [0, 1, 2, 3]);
    expect(() => r.accion(0, { tipo: 'notengo' })).toThrow('verdad');
    r.accion(0, { tipo: 'tengo' });
    expect(() => r.accion(1, { tipo: 'paso' })).toThrow();
  });

  it('solo se apuesta si tienen pares jugadores de los dos equipos', () => {
    const r = nueva([m(12, 12, 4, 5), m(7, 7, 5, 1), m(1, 4, 5, 6), m(11, 10, 6, 4)]);
    pasan(r, [0, 1, 2, 3]);
    pasan(r, [0, 1, 2, 3]);
    declaran(r); // pares: solo 0 y 1 -> hay apuestas; el bucle se para al empezar a apostar
    expect(r.lance).toBe('pares');
    expect(r.declarando).toBe(false);
    expect(r.participantes).toEqual([0, 1]);
    pasan(r, [0, 1]);
    declaran(r); // juego: nadie tiene -> punto
    expect(r.lance).toBe('juego');
    expect(r.esPunto).toBe(true);
    expect(r.participantes).toHaveLength(4);
  });
});

describe('lances sin apuestas', () => {
  it('si todos pasan: grande 1, chica 1 y los puntos de juego', () => {
    const r = nueva();
    pasan(r, [0, 1, 2, 3]); // grande -> equipo 0
    pasan(r, [0, 1, 2, 3]); // chica -> equipo 1
    declaran(r); // pares: nadie. juego: solo el equipo 0 (37 y 33 -> 2+2), sin apuestas
    expect(r.fase).toBe('fin');
    expect(r.puntos).toEqual([5, 1]);
  });

  it('el recuento dice qué jugador ganó cada lance y cuántas piedras', () => {
    const r = nueva();
    pasan(r, [0, 1, 2, 3]);
    pasan(r, [0, 1, 2, 3]);
    declaran(r);
    expect(r.recuento).toEqual([
      { lance: 'grande', asiento: 0, equipo: 0, piedras: 1 },
      { lance: 'chica', asiento: 1, equipo: 1, piedras: 1 },
      { lance: 'juego', asiento: 0, equipo: 0, piedras: 4 },
    ]);
    expect(r.puntosAntesRecuento).toEqual([0, 0]);
  });
});

describe('envites', () => {
  it('envido aceptado suma lo apostado al ganador del lance', () => {
    const r = nueva();
    r.accion(0, { tipo: 'envido', cantidad: 2 });
    expect(r.turno).toBe(1);
    r.accion(1, { tipo: 'quiero' });
    pasan(r, [0, 1, 2, 3]); // chica
    declaran(r);
    expect(r.puntos).toEqual([6, 1]); // grande 2 + juego 4 | chica 1
  });

  it('si los dos rivales rechazan, el apostador gana 1 al momento', () => {
    const r = nueva();
    r.accion(0, { tipo: 'envido', cantidad: 2 });
    r.accion(1, { tipo: 'noquiero' });
    expect(r.turno).toBe(3); // decide el compañero
    r.accion(3, { tipo: 'noquiero' });
    expect(r.puntos).toEqual([1, 0]);
    expect(r.pagos).toEqual([{ lance: 'grande', asiento: 0, equipo: 0, piedras: 1 }]);
    expect(r.lance).toBe('chica');
    expect(r.turno).toBe(0);
  });

  it('subir acepta lo anterior; si lo rechazan, el que sube gana lo aceptado', () => {
    const r = nueva();
    r.accion(0, { tipo: 'envido', cantidad: 2 });
    r.accion(1, { tipo: 'envido', cantidad: 3 });
    expect(r.aceptadoParcial).toBe(2);
    expect(r.turno).toBe(2);
    r.accion(2, { tipo: 'noquiero' });
    r.accion(0, { tipo: 'noquiero' });
    expect(r.puntos).toEqual([0, 2]);
    expect(r.pagos[0].asiento).toBe(1);
  });

  it('un envite de menos de 2 no es válido', () => {
    const r = nueva();
    expect(() => r.accion(0, { tipo: 'envido', cantidad: 1 })).toThrow();
  });

  it('órdago aceptado: gana el juego quien gane el lance', () => {
    const r = nueva();
    r.accion(0, { tipo: 'ordago' });
    r.accion(1, { tipo: 'quiero' });
    expect(r.fase).toBe('fin');
    expect(r.ganadorJuego).toBe(0);
    expect(r.puntos).toEqual([40, 0]);
  });

  it('órdago rechazado: el que lo lanza gana 1', () => {
    const r = nueva();
    r.accion(0, { tipo: 'ordago' });
    r.accion(1, { tipo: 'noquiero' });
    r.accion(3, { tipo: 'noquiero' });
    expect(r.puntos).toEqual([1, 0]);
    expect(r.lance).toBe('chica');
  });

  it('no se puede subir sobre un órdago', () => {
    const r = nueva();
    r.accion(0, { tipo: 'ordago' });
    expect(() => r.accion(1, { tipo: 'envido', cantidad: 2 })).toThrow();
  });
});

describe('final de juego', () => {
  it('el juego termina al llegar a 40 piedras y no se sigue contando', () => {
    const r = nueva(SIN_PARES, [39, 0]);
    pasan(r, [0, 1, 2, 3]); // grande
    pasan(r, [0, 1, 2, 3]); // chica
    declaran(r); // -> recuento: la grande lleva al equipo 0 a 40
    expect(r.ganadorJuego).toBe(0);
    expect(r.fase).toBe('fin');
    expect(r.puntos).toEqual([40, 0]);
    expect(r.recuento).toHaveLength(1);
  });
});
