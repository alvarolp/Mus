import { Ronda, type Accion, type Equipo } from './ronda';

// Partida fija: se juegan hasta 5 juegos de 40 piedras; gana quien consiga 3 juegos
export const JUEGOS_PARA_GANAR = 3;

// jugando: se está jugando una ronda
// recuento: la ronda ha terminado; se enseñan las cartas y se cuentan las piedras
// fin: ya hay un equipo ganador de la partida
export type EstadoPartida = 'jugando' | 'recuento' | 'fin';

export class Partida {
  juegos: [number, number] = [0, 0]; // juegos ganados por cada equipo
  puntos: [number, number] = [0, 0]; // piedras del juego en curso
  mano = 0;
  ronda: Ronda;
  estado: EstadoPartida = 'jugando';
  ganador: Equipo | null = null;
  juegoGanadoPor: Equipo | null = null; // equipo que ha ganado el juego en la ronda que acaba de terminar
  confirmados = new Set<number>(); // asientos que ya han pulsado "continuar" en el recuento

  private azar: () => number;

  constructor(azar: () => number = Math.random) {
    this.azar = azar;
    this.ronda = new Ronda(this.mano, this.puntos, azar);
  }

  accion(asiento: number, a: Accion): void {
    if (this.estado !== 'jugando') throw new Error('Ahora no se puede jugar');
    this.ronda.accion(asiento, a);
    if (this.ronda.fase === 'fin') this.cerrarRonda();
  }

  private cerrarRonda(): void {
    const r = this.ronda;
    this.puntos = [r.puntos[0], r.puntos[1]];
    this.juegoGanadoPor = r.ganadorJuego;
    if (r.ganadorJuego !== null) {
      this.juegos[r.ganadorJuego]++;
      if (this.juegos[r.ganadorJuego] >= JUEGOS_PARA_GANAR) this.ganador = r.ganadorJuego;
    }
    this.confirmados.clear();
    this.estado = 'recuento';
  }

  confirmar(asiento: number): void {
    if (this.estado !== 'recuento') throw new Error('No hay nada que continuar');
    this.confirmados.add(asiento);
  }

  // Pasa de la ronda recién contada a la siguiente (o al final de la partida)
  siguiente(): void {
    if (this.estado !== 'recuento') throw new Error('No hay nada que continuar');
    if (this.ganador !== null) {
      this.estado = 'fin';
      return;
    }
    if (this.juegoGanadoPor !== null) this.puntos = [0, 0]; // empieza un juego nuevo
    this.juegoGanadoPor = null;
    this.mano = (this.mano + 1) % 4; // la mano pasa al siguiente jugador
    this.ronda = new Ronda(this.mano, this.puntos, this.azar);
    this.estado = 'jugando';
  }
}
