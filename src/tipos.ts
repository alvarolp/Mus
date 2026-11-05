export type Palo = 'oros' | 'copas' | 'espadas' | 'bastos';
export type Valor = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 10 | 11 | 12;

export interface Carta {
  palo: Palo;
  valor: Valor;
}

export type Mano = Carta[];
