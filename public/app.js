'use strict';

(() => {
  const escena = document.getElementById('escena');
  const ANCHO = 1100;
  const ALTO = 540;

  const PALOS = ['oros', 'copas', 'espadas', 'bastos'];
  const FUERZA = { 12: 8, 11: 7, 10: 6, 7: 5, 6: 4, 5: 3, 4: 2, 1: 1 };
  const LANCES = ['grande', 'chica', 'pares', 'juego'];
  const NOMBRE_LANCE = { grande: 'Grande', chica: 'Chica', pares: 'Pares', juego: 'Juego', punto: 'Punto' };
  const COLORES_AVATAR = ['#7fb8e6', '#f0a56a', '#8fd0b0', '#e6a0b4'];
  const DURACION_BURBUJA = 2800; // ms que se queda cada bocadillo aunque cambie el lance

  // Para probar con varias pestañas en un mismo navegador: localhost:3000/?j=1, ?j=2...
  const sufijo = new URLSearchParams(location.search).get('j') || '';
  const CLAVE_SESION = 'mus_sesion' + sufijo;
  const CLAVE_NOMBRE = 'mus_nombre' + sufijo;

  // ---------- Estado de la app ----------
  let ws = null;
  let conectado = false;
  let sesion = leer(CLAVE_SESION);       // { codigo, token } para volver a la sala
  let nombre = leer(CLAVE_NOMBRE) || '';
  let codigoEscrito = '';
  let estado = null;                     // lo último que ha enviado el servidor
  let error = '';
  let seleccion = new Set();             // cartas marcadas para descartar (posición en la mano del servidor)
  let cantidad = 2;                      // cantidad del envite
  let sitioElegido = null;               // en la sala de espera: asiento marcado para moverlo
  let intentandoVolver = false;
  let transitorias = new Map();          // burbujas que duran un momento ("Nos llevamos 2")
  let recuentoClave = '';                // identifica el recuento que se está enseñando
  let recuentoMostrados = 0;             // cuántos lances del recuento se han enseñado ya
  let temporizadorError = 0;
  let temporizadorRecuento = 0;
  let temporizadorBurbujas = 0;

  // ---------- Almacenamiento (puede fallar en modo privado) ----------
  function leer(clave) {
    try { return JSON.parse(localStorage.getItem(clave)); } catch { return null; }
  }
  function guardar(clave, valor) {
    try {
      if (valor === null) localStorage.removeItem(clave);
      else localStorage.setItem(clave, JSON.stringify(valor));
    } catch { /* nada */ }
  }

  // ---------- Utilidades ----------
  function el(etiqueta, props, ...hijos) {
    const e = document.createElement(etiqueta);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (v === true) e.setAttribute(k, '');
        else e.setAttribute(k, v);
      }
    }
    for (const h of hijos.flat()) {
      if (h !== null && h !== undefined && h !== false) e.append(h); // los textos van como texto, nunca como HTML
    }
    return e;
  }

  function boton(texto, clase, alPulsar, desactivado) {
    return el('button', { type: 'button', class: `btn ${clase || ''}`, onclick: alPulsar, disabled: !!desactivado }, texto);
  }

  function botonMenu(texto, alPulsar, clase, desactivado) {
    return el('button', { type: 'button', class: `bm ${clase || ''}`, onclick: alPulsar, disabled: !!desactivado }, texto);
  }

  const rangoDe = (c) => (c.valor === 3 ? 12 : c.valor === 2 ? 1 : c.valor);
  const fuerzaDe = (c) => FUERZA[rangoDe(c)];

  function suma(mano) {
    return mano.reduce((s, c) => s + (c.valor >= 10 || c.valor === 3 ? 10 : c.valor === 2 ? 1 : c.valor), 0);
  }

  // Cartas de mayor a menor (las más grandes a la izquierda), guardando su posición original
  function ordenadas(cartas) {
    return cartas
      .map((c, i) => ({ c, i }))
      .sort((a, b) => fuerzaDe(b.c) - fuerzaDe(a.c) || PALOS.indexOf(a.c.palo) - PALOS.indexOf(b.c.palo));
  }

  const NOMBRE_VALOR = { 1: 'As', 10: 'Sota', 11: 'Caballo', 12: 'Rey' };
  function imgCarta(c) {
    return el('img', { class: 'carta-img', src: `cartas/${c.palo}_${c.valor}.webp`, alt: `${NOMBRE_VALOR[c.valor] || c.valor} de ${c.palo}`, draggable: 'false' });
  }
  function imgReverso() {
    return el('img', { class: 'carta-img', src: 'cartas/reverso.webp', alt: 'Carta tapada', draggable: 'false' });
  }

  // Cargamos todas las imágenes una vez para que no parpadeen al redibujar
  const precarga = [];
  for (const palo of PALOS) {
    for (const v of [1, 2, 3, 4, 5, 6, 7, 10, 11, 12]) {
      const i = new Image();
      i.src = `cartas/${palo}_${v}.webp`;
      precarga.push(i);
    }
  }
  const iReverso = new Image();
  iReverso.src = 'cartas/reverso.webp';
  precarga.push(iReverso);

  function avatarSvg(color) {
    const t = document.createElement('template');
    t.innerHTML =
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      `<rect width="100" height="100" fill="${color}"/>` +
      '<circle cx="50" cy="38" r="19" fill="rgba(0,0,0,.28)"/>' +
      '<path d="M14 96 C14 66 32 58 50 58 C68 58 86 66 86 96 Z" fill="rgba(0,0,0,.28)"/>' +
      '</svg>';
    return t.content.firstElementChild;
  }

  function nombreDe(s) {
    const j = estado && estado.jugadores[s];
    return j ? j.nombre : `Jugador ${s + 1}`;
  }

  // ---------- Pantalla completa y escala ----------
  function escalar() {
    const vv = window.visualViewport;
    const w = vv ? vv.width : window.innerWidth;
    const h = vv ? vv.height : window.innerHeight;
    const s = Math.min(w / ANCHO, h / ALTO);
    escena.style.transform = `translate(-50%, -50%) scale(${s})`;
  }
  window.addEventListener('resize', escalar);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', escalar);

  let pantallaCompletaIntentada = false;
  function intentarPantallaCompleta() {
    if (pantallaCompletaIntentada) return;
    pantallaCompletaIntentada = true;
    try {
      const raiz = document.documentElement;
      const pedir = raiz.requestFullscreen ? raiz.requestFullscreen() : null;
      if (pedir && pedir.then) {
        pedir.then(() => {
          if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        }).catch(() => {});
      }
    } catch { /* no todos los navegadores lo permiten */ }
  }
  document.addEventListener('click', intentarPantallaCompleta, { once: true });

  // ---------- Conexión ----------
  function enviar(mensaje) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      mostrarError('Sin conexión con el servidor');
      return false;
    }
    ws.send(JSON.stringify(mensaje));
    return true;
  }

  function conectar() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const protocolo = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocolo}://${location.host}`);
    const este = ws;

    este.onopen = () => {
      conectado = true;
      if (sesion) {
        intentandoVolver = true;
        este.send(JSON.stringify({ t: 'reconectar', codigo: sesion.codigo, token: sesion.token }));
      }
      render();
    };
    este.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      recibir(m);
    };
    este.onclose = () => {
      if (ws === este) ws = null;
      conectado = false;
      render();
      setTimeout(conectar, 2000);
    };
    este.onerror = () => { /* onclose se encarga */ };
  }

  function recibir(m) {
    if (m.t === 'unido') {
      sesion = { codigo: m.codigo, token: m.token };
      guardar(CLAVE_SESION, sesion);
      intentandoVolver = false;
    } else if (m.t === 'estado') {
      alLlegarEstado(m);
    } else if (m.t === 'error') {
      if (intentandoVolver) {
        // La sala ya no existe (por ejemplo, el servidor se reinició)
        intentandoVolver = false;
        sesion = null;
        estado = null;
        guardar(CLAVE_SESION, null);
      }
      mostrarError(m.mensaje);
    }
  }

  function alLlegarEstado(nuevo) {
    const antes = estado;
    estado = nuevo;

    // Burbujas que se enseñan un momento: "Nos llevamos N" cuando rechazan un envite
      // Cada acción nueva crea un bocadillo que dura un momento, aunque cambie el lance
      const reg = nuevo.registro || [];
      let regAntes = 0;
      if (antes === null) {
          regAntes = reg.length; // al reconectar no se repiten los bocadillos viejos
      } else if (antes.registro && reg.length >= antes.registro.length) {
          regAntes = antes.registro.length; // si el registro se ha vaciado (ronda nueva), se cuenta desde 0
      }
      if (reg.length > regAntes) {
          for (const ev of reg.slice(regAntes)) {
              const texto = textoEvento(ev);
              if (texto) {
                  transitorias.set(ev.asiento, { texto, hasta: Date.now() + DURACION_BURBUJA });
              }
          }
          programarBurbujas();
      }

    // Si ha cambiado la fase o el turno, se limpia lo marcado
    if (!antes || antes.fase !== nuevo.fase || antes.turno !== nuevo.turno) seleccion.clear();
    if (nuevo.estado !== 'esperando') sitioElegido = null;

    // ¿Ha empezado un recuento nuevo? Lo enseñamos lance a lance
    if (nuevo.estado === 'recuento' || nuevo.estado === 'fin') {
      const clave = JSON.stringify([nuevo.manosReveladas, nuevo.puntosAntes]);
      if (clave !== recuentoClave) {
        recuentoClave = clave;
        recuentoMostrados = antes === null ? (nuevo.recuento || []).length : 0; // al reconectar, todo de golpe
        programarRecuento();
      }
    } else {
      recuentoClave = '';
      clearTimeout(temporizadorRecuento);
    }
    render();
  }

  function programarRecuento() {
    clearTimeout(temporizadorRecuento);
    const total = estado && estado.recuento ? estado.recuento.length : 0;
    if (recuentoMostrados >= total) return;
    temporizadorRecuento = setTimeout(() => {
      recuentoMostrados++;
      render();
      programarRecuento();
    }, recuentoMostrados === 0 ? 1200 : 1400);
  }

  function programarBurbujas() {
    clearTimeout(temporizadorBurbujas);
    const ahora = Date.now();
    let proxima = Infinity;
    for (const [s, t] of transitorias) {
      if (t.hasta <= ahora) transitorias.delete(s);
      else proxima = Math.min(proxima, t.hasta);
    }
    if (proxima !== Infinity) {
      temporizadorBurbujas = setTimeout(() => {
        programarBurbujas();
        render();
      }, proxima - ahora + 30);
    }
  }

  function mostrarError(texto) {
    error = texto;
    clearTimeout(temporizadorError);
    temporizadorError = setTimeout(() => { error = ''; render(); }, 3500);
    render();
  }

  // ---------- Acciones del usuario ----------
  function crearSala() {
    guardar(CLAVE_NOMBRE, nombre);
    error = '';
    enviar({ t: 'crear', nombre });
  }

  function unirse() {
    guardar(CLAVE_NOMBRE, nombre);
    error = '';
    if (codigoEscrito.trim().length !== 4) return mostrarError('El código tiene 4 letras');
    enviar({ t: 'unirse', codigo: codigoEscrito, nombre });
  }

  function salir() {
    enviar({ t: 'salir' });
    sesion = null;
    estado = null;
    sitioElegido = null;
    guardar(CLAVE_SESION, null);
    render();
  }

  function accionar(accion) {
    error = '';
    seleccion.clear();
    cantidad = 2;
    enviar({ t: 'accion', accion });
  }

  async function compartir() {
    const texto = `Entra en mi sala de mus con el código ${estado.codigo}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Mus', text: texto, url: location.origin });
      else await navigator.clipboard.writeText(`${texto}: ${location.origin}`);
    } catch { /* el usuario canceló */ }
  }

  // ---------- Pantalla de inicio ----------
  function pantallaInicio() {
    const campoNombre = el('input', { type: 'text', maxlength: 16, placeholder: 'Tu nombre', autocomplete: 'nickname', 'aria-label': 'Tu nombre' });
    campoNombre.value = nombre;
    campoNombre.addEventListener('input', () => { nombre = campoNombre.value; });

    const campoCodigo = el('input', { type: 'text', maxlength: 4, placeholder: 'CÓDIGO', autocapitalize: 'characters', autocomplete: 'off', 'aria-label': 'Código de sala' });
    campoCodigo.value = codigoEscrito;
    campoCodigo.addEventListener('input', () => {
      codigoEscrito = campoCodigo.value.toUpperCase();
      campoCodigo.value = codigoEscrito;
    });

    return el('section', { class: 'inicio' },
      el('h1', null, 'MUS'),
      campoNombre,
      boton('Crear sala', 'principal', crearSala, !conectado),
      el('div', { class: 'o' }, 'o entra en la sala de un amigo'),
      campoCodigo,
      boton('Unirse', '', unirse, !conectado),
      !conectado ? el('p', { class: 'aviso' }, 'Conectando con el servidor…') : null);
  }

  // ---------- Sala de espera ----------
  function clickSitio(s) {
    const e = estado;
    const soyAnfitrion = e.anfitrion === e.asiento;
    const ocupante = e.jugadores[s];
    if (sitioElegido === null) {
      if (!ocupante || ocupante.ia) {
        enviar({ t: 'mover', origen: e.asiento, destino: s }); // me siento en un hueco (o cambio con una IA)
      } else if (s === e.asiento || soyAnfitrion) {
        sitioElegido = s; // lo marco para moverlo
        render();
      }
      return;
    }
    const origen = sitioElegido;
    sitioElegido = null;
    if (origen !== s) enviar({ t: 'mover', origen, destino: s });
    else render();
  }

  function pantallaEspera() {
    const e = estado;
    const soyAnfitrion = e.anfitrion === e.asiento;
    const completa = e.jugadores.every((j) => j !== null);

    const sitios = [0, 1, 2, 3].map((s) => {
      const j = e.jugadores[s];
      const azul = s % 2 === 0;
      const notas = [];
      if (j && s === e.asiento) notas.push('TÚ');
      if (j && e.anfitrion === s) notas.push('ANFITRIÓN');
      if (j && j.ia) notas.push('IA');
      const botones = [];
      if (soyAnfitrion && !j) {
        botones.push(el('button', { type: 'button', class: 'mini', onclick: (ev) => { ev.stopPropagation(); enviar({ t: 'anadirIA', asiento: s }); } }, '+ IA'));
      }
      if (soyAnfitrion && j && j.ia) {
        botones.push(el('button', { type: 'button', class: 'mini', onclick: (ev) => { ev.stopPropagation(); enviar({ t: 'quitarIA', asiento: s }); } }, 'Quitar IA'));
      }
      return el('div', {
        class: `sitio s${s} ${azul ? 'azul' : 'naranja'} ${j ? '' : 'vacio'} ${sitioElegido === s ? 'elegido' : ''}`,
        onclick: () => clickSitio(s),
      },
        el('div', { class: 'quien' }, j ? j.nombre : 'Libre'),
        el('div', { class: 'nota' }, notas.join(' · ') || (j ? '' : 'toca para sentarte')),
        botones);
    });

    const ayuda = soyAnfitrion
      ? 'Toca un sitio libre para sentarte. Los que están enfrente son pareja. Si tocas a otro jugador y luego otro sitio, los cambias.'
      : 'Toca un sitio libre para sentarte. Los que están enfrente son pareja.';

    return el('section', null,
      el('div', { class: 'lobby-izq' },
        el('div', { class: 'etiqueta' }, 'CÓDIGO DE SALA'),
        el('div', { class: 'codigo' }, e.codigo),
        boton('Compartir código', 'principal', compartir)),
      el('div', { class: 'lobby-ayuda' }, ayuda),
      el('div', { class: 'mesa-lobby' }, el('div', { class: 'mus-texto' }, 'Mus')),
      sitios,
      el('div', { class: 'lobby-der' },
        soyAnfitrion
          ? boton('Empezar partida', 'principal', () => enviar({ t: 'empezar' }), !completa)
          : el('p', { class: 'aviso' }, 'Esperando a que el anfitrión empiece…'),
        soyAnfitrion && !completa ? el('p', { class: 'aviso' }, 'Faltan jugadores: pon una IA en los sitios libres.') : null,
        boton('Salir', '', salir)));
  }

  // ---------- Mesa ----------
  function textoEvento(ev) {
    switch (ev.tipo) {
      case 'mus': return 'Mus';
      case 'corte': return 'No hay mus';
      case 'descartar': return `Descarto ${ev.cantidad}`;
      case 'tengo': return 'Tengo';
      case 'notengo': return 'No tengo';
      case 'paso': return 'Paso';
      case 'envido':
        if (ev.subida) return `${ev.cantidad} más`;
        return ev.cantidad === 2 ? 'Envido' : `Envido ${ev.cantidad}`;
      case 'ordago': return '¡Órdago!';
      case 'quiero': return 'Quiero';
      case 'noquiero': return 'No quiero';
      case 'llevan': return `Nos llevamos ${ev.cantidad}`;
      default: return '';
    }
  }

  // Lo último que ha dicho cada jugador en el momento actual
  function burbujasDeJuego() {
    const e = estado;
    const reg = e.registro || [];
    const porAsiento = new Map();
    let desde = 0;
    if (e.fase === 'mus') desde = reg.map((x) => x.tipo).lastIndexOf('descartar') + 1;
    else if (e.fase === 'descarte') desde = reg.map((x) => x.tipo).lastIndexOf('mus') + 1;

    reg.forEach((ev, i) => {
      if (i < desde || ev.tipo === 'llevan') return;
      if (e.fase === 'lance' && ev.lance !== e.lance) return;
      porAsiento.set(ev.asiento, [textoEvento(ev)]);
    });
    const ahora = Date.now();
    for (const [s, t] of transitorias) {
      if (t.hasta > ahora) porAsiento.set(s, [t.texto]);
    }
    return porAsiento;
  }

    function burbujasDeRecuento() {
        const porAsiento = new Map();
        (estado.recuento || []).slice(0, recuentoMostrados).forEach((it) => {
            const lineas = porAsiento.get(it.asiento) || [];
            lineas.unshift(`${it.piedras} de ${it.lance}`);
            porAsiento.set(it.asiento, lineas);
        });
        // Antes de que empiece el recuento, se siguen viendo las últimas jugadas (ej. "¡Órdago!" y "Quiero")
        if (recuentoMostrados === 0) {
            const ahora = Date.now();
            for (const [s, t] of transitorias) {
                if (t.hasta > ahora && !porAsiento.has(s)) {
                    porAsiento.set(s, [t.texto]);
                }
            }
        }
        return porAsiento;
    }

  function puntosMostrados() {
    const e = estado;
    if (e.estado === 'jugando' || !e.puntosAntes) return e.puntos;
    const p = [e.puntosAntes[0], e.puntosAntes[1]];
    (e.recuento || []).slice(0, recuentoMostrados).forEach((it) => { p[it.equipo] = Math.min(40, p[it.equipo] + it.piedras); });
    if (recuentoMostrados >= (e.recuento || []).length) return e.puntos; // ya está todo contado
    return p;
  }

  function nombreLanceActual(e) {
    if (e.fase !== 'lance' || !e.lance) return e.fase === 'descarte' ? 'Descarte' : '';
    if (e.lance === 'juego') return e.punto ? 'Punto' : 'Juego';
    return NOMBRE_LANCE[e.lance];
  }

  function cuadroLances(e) {
    const filas = LANCES.map((l) => {
      const esJuego = l === 'juego';
      const etiqueta = esJuego && e.lance === 'juego' && e.punto ? 'Punto' : NOMBRE_LANCE[l];
      const actual = e.fase === 'lance' && e.lance === l;
      let cant = null;
      if (actual && e.apuesta) {
        cant = e.apuesta.total === 'ordago'
          ? el('span', { class: 'cant' }, '¡Órdago!')
          : el('span', { class: 'cant' }, String(e.apuesta.total), ' ', el('small', null, `(${e.apuesta.alRechazar})`));
      } else if (e.aceptados && e.aceptados[l] > 0) {
        cant = el('span', { class: 'cant' }, String(e.aceptados[l]));
      }
      return el('div', { class: `fila ${actual ? 'actual' : ''}` }, el('span', null, etiqueta), cant);
    });
    return el('div', { class: 'cuadro-lances' }, filas);
  }

  function selectorEnvite(formato, alEnviar) {
    return el('div', { class: 'selector' },
      el('button', { type: 'button', class: 'flecha', 'aria-label': 'Menos', onclick: () => { cantidad = Math.max(2, cantidad - 1); render(); } }, '‹'),
      botonMenu(formato(cantidad), () => alEnviar(cantidad)),
      el('button', { type: 'button', class: 'flecha', 'aria-label': 'Más', onclick: () => { cantidad = Math.min(40, cantidad + 1); render(); } }, '›'));
  }

  function menuDeDecision() {
    const e = estado;
    if (e.estado !== 'jugando' || e.turno !== e.asiento) return null;

    if (e.fase === 'mus') {
      return el('div', { class: 'menu' },
        el('div', { class: 'fila' },
          botonMenu('No hay mus', () => accionar({ tipo: 'corte' })),
          botonMenu('Mus', () => accionar({ tipo: 'mus' }))));
    }
    if (e.fase === 'descarte') {
      const n = seleccion.size;
      return el('div', { class: 'menu' },
        el('p', { class: 'ayuda' }, 'Toca las cartas que quieres cambiar'),
        el('div', { class: 'fila' },
          botonMenu(n === 0 ? 'Descartar' : `Descartar ${n}`, () => {
            accionar({ tipo: 'descartar', indices: [...seleccion] });
          }, '', n === 0)));
    }
    if (e.fase === 'lance' && !e.declarando) {
      if (!e.envite) {
        return el('div', { class: 'menu' },
          el('div', { class: 'fila' },
            botonMenu('¡Órdago!', () => accionar({ tipo: 'ordago' }), 'rojo'),
            botonMenu('Pasar', () => accionar({ tipo: 'paso' }))),
          el('div', { class: 'fila' }, selectorEnvite((n) => `Enviar ${n}`, (n) => accionar({ tipo: 'envido', cantidad: n }))));
      }
      const filas = [];
      if (e.envite.cantidad === 'ordago') {
        filas.push(el('div', { class: 'fila' },
          botonMenu('Quiero', () => accionar({ tipo: 'quiero' })),
          botonMenu('No quiero', () => accionar({ tipo: 'noquiero' }))));
      } else {
        filas.push(el('div', { class: 'fila' },
          botonMenu('Quiero', () => accionar({ tipo: 'quiero' })),
          botonMenu('¡Órdago!', () => accionar({ tipo: 'ordago' }), 'rojo'),
          botonMenu('No quiero', () => accionar({ tipo: 'noquiero' }))));
        filas.push(el('div', { class: 'fila' }, selectorEnvite((n) => `${n} más`, (n) => accionar({ tipo: 'envido', cantidad: n }))));
      }
      return el('div', { class: 'menu' }, filas);
    }
    return null;
  }

  function pantallaMesa() {
    const e = estado;
    const yo = e.asiento;
    const miEquipo = yo % 2;
    const recontando = e.estado !== 'jugando';
    const rel = (r) => (yo + r) % 4;           // asiento que está en la posición r (0 yo, 1 derecha, 2 enfrente, 3 izquierda)
    const burbujas = recontando ? burbujasDeRecuento() : burbujasDeJuego();
    const pts = puntosMostrados();

    // --- Marcador y títulos ---
    const marcador = el('div', { class: 'marcador' },
      el('div', { class: 'fila' }, el('span', { class: 'num' }, String(pts[miEquipo])), el('span', { class: 'nom' }, 'Buenos'), el('span', { class: 'jg' }, String(e.juegos[miEquipo]))),
      el('div', { class: 'fila' }, el('span', { class: 'num' }, String(pts[1 - miEquipo])), el('span', { class: 'nom' }, 'Malos'), el('span', { class: 'jg' }, String(e.juegos[1 - miEquipo]))));

    const titulo = el('div', { class: 'titulo-lance' }, recontando ? '' : nombreLanceActual(e));

    // --- Jugadores: avatar, cartas y burbujas ---
    const partes = [];
    for (let r = 0; r < 4; r++) {
      const s = rel(r);
      const j = e.jugadores[s];
      const esMio = s % 2 === miEquipo;
      let fuera = false;
      if (!recontando && e.fase === 'lance' && (e.lance === 'pares' || e.lance === 'juego')) {
        fuera = e.declaraciones[s] === false && !(e.lance === 'juego' && e.punto);
      }
      const clases = ['avatar', `av-r${r}`];
      if (!recontando && e.turno === s) clases.push('turno');
      if (fuera) clases.push('fuera');
      if (j && !j.conectado) clases.push('off');
      partes.push(el('div', { class: clases.join(' ') },
        avatarSvg(COLORES_AVATAR[esMio ? (s === yo ? 0 : 2) : (r === 1 ? 1 : 3)]),
        e.mano === s ? el('span', { class: 'mano-marca' }, 'MANO') : null,
        j && j.ia ? el('span', { class: 'ia-marca' }, 'IA') : null,
        el('span', { class: 'nombre' }, nombreDe(s).replace(/ \(IA\)$/, ''))));

      const lineas = burbujas.get(s);
      if (lineas && lineas.length > 0) {
        partes.push(el('div', { class: `burbuja r${r} ${esMio ? 'buena' : 'mala'}` }, lineas.map((t) => el('div', null, t))));
      }
    }

    // --- Cartas de los demás (tapadas, o enseñadas al acabar la ronda) ---
    const manos = e.manosReveladas;
    const caras = (s) => (recontando && manos ? ordenadas(manos[s]).map((x) => x.c) : null);
    const arribaS = rel(2);
    const cArriba = caras(arribaS);
    partes.push(el('div', { class: 'arriba-cartas' },
      [0, 1, 2, 3].map((k) => el('div', { class: 'c' }, cArriba ? imgCarta(cArriba[k]) : imgReverso()))));
    for (const [r, lado] of [[3, 'izq'], [1, 'der']]) {
      const cs = caras(rel(r));
      partes.push(el('div', { class: `lado-cartas ${lado}` },
        [0, 1, 2, 3].map((k) => {
          const c = el('div', { class: 'c' }, cs ? imgCarta(cs[k]) : imgReverso());
          c.style.top = `${k * 50}px`;
          return c;
        })));
    }

    // --- Mis cartas, ordenadas de mayor a menor ---
    const puedeMarcar = e.estado === 'jugando' && e.fase === 'descarte' && e.turno === yo;
    const misCartas = el('div', { class: 'mis-cartas' },
      ordenadas(e.misCartas).map(({ c, i }) => {
        const marcada = seleccion.has(i);
        return el('div', {
          class: `c ${puedeMarcar ? 'elegible' : ''} ${marcada ? 'sel' : ''}`,
          onclick: puedeMarcar ? () => {
            if (seleccion.has(i)) seleccion.delete(i); else seleccion.add(i);
            render();
          } : null,
        }, imgCarta(c));
      }));

    // --- Mesa verde, mazo y menú ---
    const mazo = el('div', { class: 'mazo' }, imgReverso(), imgReverso(), imgReverso());
    const textoMus = el('div', { class: 'mus-texto en-mesa' }, 'Mus');

    const extras = [];
    if (recontando) {
      const yaConfirme = (e.confirmados || []).includes(yo);
      extras.push(el('button', { type: 'button', class: 'btn continuar', onclick: () => enviar({ t: 'continuar' }), disabled: yaConfirme },
        yaConfirme ? 'Esperando…' : 'CONTINUAR'));
      const total = (e.recuento || []).length;
      if (recuentoMostrados >= total) {
        let cartel = null;
        if (e.ganador !== null && e.ganador !== undefined && e.estado !== 'jugando') {
          cartel = `¡Partida para los ${e.ganador === miEquipo ? 'Buenos' : 'Malos'}!`;
        } else if (e.juegoGanadoPor !== null && e.juegoGanadoPor !== undefined) {
          cartel = `¡Juego para los ${e.juegoGanadoPor === miEquipo ? 'Buenos' : 'Malos'}!`;
        }
        if (cartel) extras.push(el('div', { class: 'cartel' }, cartel));
      }
    } else {
      const menu = menuDeDecision();
      if (menu) extras.push(menu);
    }

      const codigoSala = el('div', { class: 'codigo-sala' }, 'SALA ', el('b', null, e.codigo));

      return el('section', null,
          el('div', { class: 'tapete' }), mazo, textoMus,
          marcador, titulo, partes, misCartas, cuadroLances(e), extras, codigoSala);
  }

  function ventanaFin() {
    const e = estado;
    const miEquipo = e.asiento % 2;
    const gane = e.ganador === miEquipo;
    return el('div', { class: 'velo' },
      el('div', { class: 'modal' },
        el('p', { class: 'gran' }, gane ? '¡Habéis ganado!' : 'Habéis perdido'),
        el('p', { class: 'resultado' }, `Juegos: ${e.juegos[miEquipo]} – ${e.juegos[1 - miEquipo]}`),
        boton('Salir', 'principal', salir)));
  }

  // ---------- Dibujar ----------
  function render() {
    let pantalla;
    if (!estado) pantalla = pantallaInicio();
    else if (estado.estado === 'esperando') pantalla = pantallaEspera();
    else pantalla = pantallaMesa();

    const partes = [pantalla];
    if (estado && estado.estado === 'fin') partes.push(ventanaFin());
    if (error) partes.push(el('div', { class: 'toast' }, error));
    if (!conectado) partes.push(el('div', { class: 'banner-conexion' }, estado ? 'Reconectando…' : 'Conectando…'));
    escena.replaceChildren(...partes);
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) conectar(); });
  escalar();
  render();
  conectar();
})();
