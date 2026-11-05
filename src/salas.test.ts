import { describe, it, expect } from 'vitest';
import { Salas, Sala } from './salas';

// Sala sin temporizadores: las jugadas automáticas se disparan a mano con avanzarAuto()
function nuevaSala(): Sala {
  return new Salas().crear({ auto: false });
}

function salaLlena(): Sala {
  const sala = nuevaSala();
  ['Ana', 'Beto', 'Carla', 'Dani'].forEach((n) => sala.unirse(n));
  sala.empezar(0);
  return sala;
}

describe('salas y asientos', () => {
  it('crea salas con código de 4 letras y las encuentra sin importar mayúsculas', () => {
    const salas = new Salas();
    const sala = salas.crear({ auto: false });
    expect(sala.codigo).toMatch(/^[A-Z]{4}$/);
    expect(salas.obtener(sala.codigo.toLowerCase())).toBe(sala);
    expect(salas.obtener('ZZZZ')).toBeUndefined();
  });

  it('asigna asientos por orden y NO empieza sola: lo hace el anfitrión', () => {
    const sala = nuevaSala();
    expect(sala.unirse('Ana').asiento).toBe(0);
    sala.unirse('Beto');
    sala.unirse('Carla');
    expect(sala.unirse('Dani').asiento).toBe(3);
    expect(sala.vista(0).estado).toBe('esperando');
    expect(sala.vista(0).anfitrion).toBe(0);
    expect(() => sala.empezar(1)).toThrow('anfitrión');
    sala.empezar(0);
    expect(sala.vista(0).estado).toBe('jugando');
  });

  it('no deja entrar a un quinto jugador ni cuando ya ha empezado', () => {
    const sala = salaLlena();
    expect(() => sala.unirse('Eva')).toThrow();
  });

  it('no se puede empezar sin los 4 asientos ocupados', () => {
    const sala = nuevaSala();
    sala.unirse('Ana');
    expect(() => sala.empezar(0)).toThrow('Faltan');
  });

  it('limpia el nombre y pone uno por defecto si está vacío', () => {
    const sala = nuevaSala();
    sala.unirse('   ');
    sala.unirse('x'.repeat(50));
    expect(sala.jugadores[0]!.nombre).toBe('Jugador 1');
    expect(sala.jugadores[1]!.nombre).toHaveLength(16);
  });
});

describe('elegir pareja', () => {
  it('cada jugador puede moverse a un hueco libre', () => {
    const sala = nuevaSala();
    sala.unirse('Ana'); // asiento 0
    const { asiento } = sala.unirse('Beto'); // asiento 1
    sala.mover(asiento, 1, 2); // Beto se sienta enfrente de Ana: serán pareja
    expect(sala.jugadores[1]).toBeNull();
    expect(sala.jugadores[2]!.nombre).toBe('Beto');
    expect(sala.vista(2).jugadores[2]!.nombre).toBe('Beto');
  });

  it('un jugador no puede moverse a un sitio ocupado ni mover a otros', () => {
    const sala = nuevaSala();
    sala.unirse('Ana');
    sala.unirse('Beto');
    sala.unirse('Carla');
    expect(() => sala.mover(1, 1, 2)).toThrow('ocupado');
    expect(() => sala.mover(1, 2, 3)).toThrow('anfitrión');
  });

  it('el anfitrión puede intercambiar a dos jugadores', () => {
    const sala = nuevaSala();
    ['Ana', 'Beto', 'Carla', 'Dani'].forEach((n) => sala.unirse(n));
    sala.mover(0, 1, 2); // Beto <-> Carla: ahora Ana (0) y Carla... y Beto está enfrente de Ana
    expect(sala.jugadores[2]!.nombre).toBe('Beto');
    expect(sala.jugadores[1]!.nombre).toBe('Carla');
    expect(sala.vista(0).anfitrion).toBe(0);
  });

  it('el anfitrión sigue siéndolo aunque cambie de sitio', () => {
    const sala = nuevaSala();
    sala.unirse('Ana');
    sala.mover(0, 0, 3);
    expect(sala.vista(3).anfitrion).toBe(3);
  });

  it('si el anfitrión se va antes de empezar, pasa a otro jugador', () => {
    const sala = nuevaSala();
    sala.unirse('Ana');
    sala.unirse('Beto');
    sala.abandonar(0);
    expect(sala.jugadores[0]).toBeNull();
    expect(sala.vista(1).anfitrion).toBe(1);
  });
});

describe('jugar con IA', () => {
    it('el anfitrión puede añadir y quitar IA, y empezar con 1 humano + 3 IA', () => {
        const sala = nuevaSala();
        sala.unirse('Ana');
        expect(() => sala.anadirIA(1, 1)).toThrow('anfitrión');
        sala.anadirIA(0, 1);
        sala.anadirIA(0, 2);
        sala.anadirIA(0, 3);
        expect(sala.jugadores[1]!.ia).toBe(true);
        expect(sala.jugadores[1]!.nombre).toContain('(IA)');
        expect(() => sala.anadirIA(0, 1)).toThrow('ocupado');
        sala.quitarIA(0, 3);
        expect(sala.jugadores[3]).toBeNull();
        sala.anadirIA(0, 3);
        sala.empezar(0);
        expect(sala.vista(0).estado).toBe('jugando');
    });

    it('las IA y las declaraciones se juegan solas con avanzarAuto', () => {
        const sala = nuevaSala();
        sala.unirse('Ana');
        [1, 2, 3].forEach((s) => sala.anadirIA(0, s));
        sala.empezar(0);
        // Ana es mano (asiento 0): dice mus y luego juegan las IA
        sala.accion(0, { tipo: 'mus' });
        expect(sala.vista(0).turno).toBe(1);
        expect(sala.avanzarAuto()).toBe(true);
        expect(sala.vista(0).registro!.length).toBeGreaterThanOrEqual(2);
        // Cuando le toca a Ana, no se hace nada automático
        for (let i = 0; i < 40 && sala.vista(0).turno !== 0; i++) {
            sala.avanzarAuto();
        }
        expect(sala.vista(0).turno).toBe(0);
        expect(sala.avanzarAuto()).toBe(false);
    });

    it('cuatro IA con un humano que siempre pasa terminan partidas enteras sin atascarse', () => {
        for (let partida = 0; partida < 3; partida++) {
            const sala = nuevaSala();
            sala.unirse('Ana');
            [1, 2, 3].forEach((s) => sala.anadirIA(0, s));
            sala.empezar(0);
            let pasos = 0;
            while (sala.vista(0).estado !== 'fin' && pasos < 20000) {
                pasos++;
                const v = sala.vista(0);
                if (sala.avanzarAuto()) {
                    continue;
                }
                if (v.estado === 'recuento') {
                    sala.continuar(0);
                    continue;
                }
                // Turno del humano: juega lo más simple que sea válido
                if (v.fase === 'mus') {
                    sala.accion(0, { tipo: Math.random() < 0.5 ? 'mus' : 'corte' });
                } else if (v.fase === 'descarte') {
                    sala.accion(0, { tipo: 'descartar', indices: [0, 1] });
                } else if (v.envite) {
                    sala.accion(0, { tipo: Math.random() < 0.5 ? 'quiero' : 'noquiero' });
                } else {
                    sala.accion(0, { tipo: 'paso' });
                }
            }
            expect(sala.vista(0).estado).toBe('fin');
            const v = sala.vista(0);
            expect(Math.max(v.juegos![0], v.juegos![1])).toBe(3);
        }
    });
});

describe('lo que ve cada jugador', () => {
  it('cada jugador solo ve sus cartas hasta que acaba la ronda', () => {
    const sala = salaLlena();
    const v = sala.vista(1);
    expect(v.misCartas).toHaveLength(4);
    expect(v.misCartas).toEqual(sala.partida!.ronda.manos[1]);
    expect(v.manosReveladas).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain(JSON.stringify(sala.partida!.ronda.manos[2]));
  });

  it('solo actúa quien tiene el turno y se ignoran acciones raras', () => {
    const sala = salaLlena();
    expect(() => sala.accion(1, { tipo: 'mus' })).toThrow();
    expect(() => sala.accion(0, { tipo: 'trampa' })).toThrow();
    expect(() => sala.accion(0, null)).toThrow();
    expect(() => sala.accion(0, { tipo: 'envido' })).toThrow();
    sala.accion(0, { tipo: 'mus' });
    expect(sala.vista(2).turno).toBe(1);
    expect(sala.vista(2).registro).toEqual([{ asiento: 0, tipo: 'mus', lance: null }]);
  });

  it('al acabar una ronda se enseñan todas las cartas y se espera a continuar', () => {
    const sala = salaLlena();
    sala.accion(0, { tipo: 'corte' });
    sala.accion(0, { tipo: 'ordago' });
    sala.accion(1, { tipo: 'noquiero' });
    sala.accion(3, { tipo: 'noquiero' });
    // chica, pares y juego: todos pasan y se declara la verdad
    for (let i = 0; i < 200 && sala.vista(0).estado === 'jugando'; i++) {
      if (sala.avanzarAuto()) continue;
      const v = sala.vista(0);
      if (v.envite) sala.accion(v.turno!, { tipo: 'noquiero' });
      else sala.accion(v.turno!, { tipo: 'paso' });
    }
    const v = sala.vista(0);
    expect(v.estado).toBe('recuento');
    expect(v.manosReveladas).toHaveLength(4);
    expect(v.recuento).toBeDefined();
    expect(v.puntosAntes).toBeDefined();
    // Nadie ha continuado todavía: no avanza
    expect(sala.avanzarAuto()).toBe(false);
    [0, 1, 2, 3].forEach((s) => sala.continuar(s));
    expect(sala.avanzarAuto()).toBe(true);
    const despues = sala.vista(0);
    expect(despues.estado).toBe('jugando');
    expect(despues.registro).toEqual([]);
    expect(despues.manosReveladas).toBeUndefined();
  });

  it('permite reconectar con el token y rechaza tokens falsos', () => {
    const sala = nuevaSala();
    const { token } = sala.unirse('Ana');
    sala.marcarConectado(0, false);
    expect(sala.vista(0).jugadores[0]!.conectado).toBe(false);
    expect(sala.reconectar('falso')).toBeNull();
    expect(sala.reconectar(token)).toBe(0);
    expect(sala.vista(0).jugadores[0]!.conectado).toBe(true);
  });
});
