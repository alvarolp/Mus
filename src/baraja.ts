import type { Carta, Palo, Valor } from './tipos';

const PALOS: Palo[] = ['oros', 'copas', 'espadas', 'bastos'];
const VALORES: Valor[] = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];

export function crearBaraja(): Carta[] {
  return PALOS.flatMap((palo) => VALORES.map((valor) => ({ palo, valor })));
}

export function barajar(cartas: Carta[], azar: () => number = Math.random): Carta[] {
  const r = [...cartas];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
