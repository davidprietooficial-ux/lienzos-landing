/**
 * Formulario de cotización con los CUATRO estados.
 *
 *   éxito · carga · error · vacío
 *
 * El que casi siempre falta es "carga": se pulsa Enviar, no pasa nada
 * visible durante dos segundos, y el usuario vuelve a pulsar. Ahora hay dos
 * mensajes duplicados y un cliente convencido de que la web no funciona.
 *
 * Reglas de tiempo (de references/ux-estados.md):
 *   < 1 s   no se muestra nada — un spinner corto se siente MÁS lento
 *   2-5 s   spinner
 *   > 5 s   spinner con texto que cambia
 *   > 10 s  barra de progreso
 *
 * La validación de aquí es cortesía para el usuario. La de verdad está en
 * public/formulario.php, en el servidor, y se repite entera.
 *
 * ── Lo específico de este sitio ───────────────────────────────────────
 *
 * El formulario CALIFICA (ver califica()) y el final depende de eso:
 *
 *   califica     → correo (vía formulario.php) y salto a WhatsApp con el
 *                  mensaje armado con sus propias respuestas: quien recibe
 *                  ya tiene el resumen sin preguntar nada.
 *   no califica  → al instante, sin esperar al servidor, el aviso "todavía
 *                  no es el mejor momento". El correo se manda igual, por
 *                  detrás y marcado, para que no se pierda el registro.
 *
 * El salto a WhatsApp llega después de un `await`, cuando el navegador ya
 * puede no contarlo como gesto del usuario y bloquear la ventana. Por eso
 * irAWhatsapp() cae a navegar en la misma pestaña, y el botón "Abrir
 * WhatsApp con tu resumen" queda visible de respaldo al volver.
 */

import { permitido } from './consentimiento';

// 'aviso' es el final de quien no califica: ni éxito ni error.
type Estado = 'vacio' | 'cargando' | 'exito' | 'error' | 'aviso';

const RETRASO_SPINNER_MS = 900; // por debajo de esto no se muestra nada
const TIEMPO_MAXIMO_MS = 15_000;
const DURACION_CIERRE_MS = 350; // la de animate-dialog
const WHATSAPP = '573228539152';

// Lienzos produce para marcas que ya pautan cada mes. Menos de USD 3.000
// al mes, o todavía no pautar, no califica. "Prefiero hablarlo primero"
// (vacío) sí: la duda juega a favor del lead. El mismo criterio está en
// public/formulario.php, que lo usa para marcar el correo.
const INVERSION_QUE_NO_CALIFICA = ['Menos de USD 3.000 al mes', 'Todavia no pautamos'];

interface Campo {
  nombre: string;
  error: HTMLElement | null;
  /** Devuelve el texto del error, o null si el campo está bien. */
  validar: () => string | null;
  /** Dónde poner el foco cuando este campo falla. */
  foco: HTMLElement;
  /** Los que llevan aria-invalid. Un grupo de checkbox no lo lleva. */
  marcables: HTMLElement[];
  /** A quién se le engancha el blur/change. Puede no coincidir con
   *  `marcables`: un grupo de checkbox se escucha entero pero no se marca. */
  escuchar: HTMLElement[];
}

// ── Utilidades ────────────────────────────────────────────────────────

const valores = (form: HTMLFormElement, nombre: string): string[] =>
  new FormData(form)
    .getAll(nombre)
    .map((v) => String(v).trim())
    .filter(Boolean);

const valor = (form: HTMLFormElement, nombre: string): string =>
  String(new FormData(form).get(nombre) ?? '').trim();

const califica = (form: HTMLFormElement): boolean => {
  const inversion = valor(form, 'inversion');
  if (INVERSION_QUE_NO_CALIFICA.includes(inversion)) return false;
  // Sin cifra, pero lo único que marcó en plataformas es que aún no pauta.
  const plataformas = valores(form, 'plataformas[]');
  return !(inversion === '' && plataformas.length === 1 && plataformas[0] === 'Aún no pauto');
};

/**
 * En el móvil wa.me abre la app: navegar en la misma pestaña no deja una
 * pestaña en blanco detrás. En escritorio se abre aparte para que la
 * confirmación siga a la vista; si el navegador bloquea la ventana, se
 * navega aquí mismo. La ventana nace en blanco para poder cortarle el
 * opener antes de que cargue nada (lo que haría rel="noopener").
 *
 * Salir de la pestaña corta las peticiones en vuelo: el respiro de 300 ms
 * es para que la conversión alcance a llegar a la analítica.
 */
const RESPIRO_ANALITICA_MS = 300;

function irAWhatsapp(url: string): void {
  if (!window.matchMedia('(pointer: coarse)').matches) {
    const ventana = window.open('', '_blank');
    if (ventana) {
      ventana.opener = null;
      ventana.location.href = url;
      return;
    }
  }
  window.setTimeout(() => window.location.assign(url), RESPIRO_ANALITICA_MS);
}

// ── Montaje ───────────────────────────────────────────────────────────

export function iniciarFormulario(): void {
  const form = document.querySelector<HTMLFormElement>('[data-formulario]');
  if (!form) return;

  const boton = form.querySelector<HTMLButtonElement>('[data-enviar]');
  const zonaEstado = form.querySelector<HTMLElement>('[data-estado]');
  const salida = form.querySelector<HTMLAnchorElement>('[data-salida-whatsapp]');
  if (!boton || !zonaEstado) return;

  // El servidor descarta lo que llegue en menos de 3 s desde la carga.
  const marcaTiempo = form.querySelector<HTMLInputElement>('[data-marca-tiempo]');
  if (marcaTiempo) marcaTiempo.value = String(Math.floor(Date.now() / 1000));

  const buscar = <T extends HTMLElement>(nombre: string): T | null =>
    form.querySelector<T>(`[name="${nombre}"]`);

  const errorDe = (nombre: string): HTMLElement | null =>
    form.querySelector<HTMLElement>(`[data-error-de="${nombre}"]`);

  // ── Definición de los campos ────────────────────────────────────────

  const simple = (nombre: string, validar: (v: string) => string | null): Campo | null => {
    const input = buscar<HTMLInputElement>(nombre);
    if (!input) return null;
    return {
      nombre,
      error: errorDe(nombre),
      validar: () => validar(input.value),
      foco: input,
      marcables: [input],
      escuchar: [input],
    };
  };

  const campos: Campo[] = [];

  const agregar = (c: Campo | null): void => {
    if (c) campos.push(c);
  };

  agregar(
    simple('nombre', (v) => (v.trim() ? null : 'Tu nombre hace falta para poder responderte.')),
  );

  agregar(
    simple('mensaje', (v) =>
      v.trim() ? null : 'Con saber qué vas a pautar ya podemos proponerte algo.',
    ),
  );

  agregar(
    simple('email', (v) => {
      if (!v.trim()) return 'Necesitamos tu correo para responderte.';
      // Deliberadamente permisiva: rechazar correos válidos raros cuesta
      // clientes. El servidor vuelve a validar.
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())
        ? null
        : 'Revisa el correo: parece que falta algo.';
    }),
  );

  agregar(
    simple('telefono', (v) => {
      const limpio = v.replace(/[\s()\-.]/g, '');
      if (!limpio) return 'Sin WhatsApp no podemos seguir la conversación por ahí.';
      // Tolerante con el formato: con guiones, con espacios, con o sin +.
      return /^\+?\d{7,15}$/.test(limpio) ? null : 'Ese número no cuadra. ¿Lo revisas?';
    }),
  );

  agregar(
    simple('referencia', (v) => {
      if (!v.trim()) return null; // opcional
      try {
        const u = new URL(v.trim());
        return u.protocol === 'http:' || u.protocol === 'https:'
          ? null
          : 'El enlace tiene que empezar por http:// o https://';
      } catch {
        return 'Ese enlace no se entiende. Pégalo completo, con https://';
      }
    }),
  );

  // El paquete es lo que califica el lead: es el único campo "de negocio"
  // obligatorio, y va en el primer paso porque es de un solo toque.
  const paqueteInputs = Array.from(form.querySelectorAll<HTMLInputElement>('[name="paquete"]'));
  if (paqueteInputs.length) {
    campos.push({
      nombre: 'paquete',
      error: errorDe('paquete'),
      validar: () =>
        valor(form, 'paquete') ? null : 'Elige uno para saber por dónde empezar.',
      foco: paqueteInputs[0]!,
      marcables: [],
      escuchar: paqueteInputs,
    });
  }

  const datos = buscar<HTMLInputElement>('datos');
  if (datos) {
    campos.push({
      nombre: 'datos',
      error: errorDe('datos'),
      validar: () =>
        datos.checked ? null : 'Necesitamos tu autorización para poder responderte.',
      foco: datos,
      marcables: [datos],
      escuchar: [datos],
    });
  }

  // ── Estado visual ───────────────────────────────────────────────────

  let temporizadorSpinner: number | undefined;

  const ponerEstado = (estado: Estado, mensaje = ''): void => {
    zonaEstado.dataset.estado = estado;
    zonaEstado.textContent = mensaje;
    zonaEstado.hidden = estado === 'vacio';

    // role="alert" solo en error: en éxito interrumpiría al lector de
    // pantalla en mitad de la confirmación.
    zonaEstado.setAttribute('role', estado === 'error' ? 'alert' : 'status');

    const cargando = estado === 'cargando';
    boton.disabled = cargando;
    boton.setAttribute('aria-busy', String(cargando));
    form.setAttribute('aria-busy', String(cargando));

    // La salida a WhatsApp solo se enseña cuando sirve de algo: en éxito
    // (para continuar) o en error (para no perder el contacto).
    if (salida) salida.hidden = estado !== 'exito' && estado !== 'error';
  };

  const mostrarError = (c: Campo, texto: string | null): void => {
    for (const el of c.marcables) el.setAttribute('aria-invalid', texto ? 'true' : 'false');
    if (c.error) {
      c.error.textContent = texto ?? '';
      c.error.hidden = !texto;
    }
  };

  // ── Validación al salir del campo, no mientras escribe ──────────────

  for (const c of campos) {
    for (const el of c.escuchar) {
      el.addEventListener('blur', () => mostrarError(c, c.validar()));
      // Al corregir se limpia en vivo, pero no se marca error mientras
      // escribe: señalar un correo incompleto en la tercera letra es hostil.
      const alCambiar = (): void => {
        if (c.error && !c.error.hidden && !c.validar()) mostrarError(c, null);
      };
      el.addEventListener('input', alCambiar);
      el.addEventListener('change', alCambiar);
    }
  }

  // ── Navegación por pasos ────────────────────────────────────────────
  //
  // Cada campo ya sabe validarse; lo único que añade esto es EN QUÉ paso
  // vive, que se deduce del DOM en vez de mantenerse en una lista aparte
  // que se desincroniza en cuanto alguien mueve un campo de sitio.

  const paneles = Array.from(form.querySelectorAll<HTMLElement>('[data-paso]'));
  const btnAtras = form.querySelector<HTMLButtonElement>('[data-paso-atras]');
  const btnSiguiente = form.querySelector<HTMLButtonElement>('[data-paso-siguiente]');
  const tramos = Array.from(form.querySelectorAll<HTMLElement>('[data-tramo]'));
  const cuenta = form.querySelector<HTMLElement>('[data-pasos-cuenta]');
  const porPasos = paneles.length > 1;

  let actual = 0;

  const pasoDe = (c: Campo): number => {
    const panel = c.escuchar[0]?.closest<HTMLElement>('[data-paso]');
    return panel ? Number(panel.dataset.paso ?? 0) : 0;
  };

  const pintarPaso = (): void => {
    if (!porPasos) return;
    paneles.forEach((panel, i) => (panel.hidden = i !== actual));
    tramos.forEach((tramo, i) => tramo.toggleAttribute('data-hecho', i <= actual));
    if (cuenta) cuenta.textContent = `Paso ${actual + 1} de ${paneles.length}`;

    // Los indicadores de la columna lateral (solo escritorio) viven fuera
    // del <form>: se buscan en el documento, por su número de paso.
    document.querySelectorAll<HTMLElement>('[data-paso-indicador]').forEach((item) => {
      const i = Number(item.dataset.pasoIndicador);
      item.classList.toggle('paso-item--activo', i === actual);
      item.classList.toggle('paso-item--hecho', i < actual);
      if (i === actual) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });

    const ultimo = actual === paneles.length - 1;
    if (btnAtras) btnAtras.hidden = actual === 0;
    if (btnSiguiente) btnSiguiente.hidden = ultimo;
    boton.hidden = !ultimo;
  };

  // Valida SOLO los campos del paso que se está dejando. Marcar en rojo un
  // campo de un paso que la persona todavía no ha visto es incomprensible.
  const validarPaso = (indice: number): boolean => {
    let primerFallo: Campo | null = null;
    for (const c of campos) {
      if (pasoDe(c) !== indice) continue;
      const error = c.validar();
      mostrarError(c, error);
      if (error && !primerFallo) primerFallo = c;
    }
    if (primerFallo) {
      primerFallo.foco.focus();
      return false;
    }
    return true;
  };

  const irA = (indice: number): void => {
    actual = Math.max(0, Math.min(indice, paneles.length - 1));
    pintarPaso();
    // `nearest` y no `start`: en móvil el formulario ya está en pantalla y
    // un scroll brusco al cambiar de paso se siente como que algo falló.
    form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  btnSiguiente?.addEventListener('click', () => {
    if (!validarPaso(actual)) return;
    ponerEstado('vacio');
    irA(actual + 1);
  });

  btnAtras?.addEventListener('click', () => irA(actual - 1));

  // Enter dentro de un campo avanza de paso en vez de enviar a medias.
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const destino = e.target as HTMLElement;
    if (destino.tagName === 'TEXTAREA') return;
    if (porPasos && actual < paneles.length - 1) {
      e.preventDefault();
      btnSiguiente?.click();
    }
  });

  pintarPaso();

  // El envío ya se hizo: lo que queda es la confirmación, no el
  // formulario otra vez. Los tres pasos quedan como hechos.
  const dejarEnviado = (): void => {
    form.reset();
    campos.forEach((c) => mostrarError(c, null));
    paneles.forEach((panel) => (panel.hidden = true));
    tramos.forEach((tramo) => tramo.setAttribute('data-hecho', ''));
    if (cuenta) cuenta.textContent = '';
    document.querySelectorAll<HTMLElement>('[data-paso-indicador]').forEach((item) => {
      item.classList.remove('paso-item--activo');
      item.classList.add('paso-item--hecho');
      item.removeAttribute('aria-current');
    });
    if (btnSiguiente) btnSiguiente.hidden = true;
    if (btnAtras) btnAtras.hidden = true;
    boton.hidden = true;
    if (marcaTiempo) marcaTiempo.value = String(Math.floor(Date.now() / 1000));
  };

  // ── Aviso para quien no califica ────────────────────────────────────

  const aviso = document.querySelector<HTMLDialogElement>('[data-aviso-no-califica]');

  const cerrarAviso = (): void => {
    if (!aviso?.open || aviso.classList.contains('is-closing')) return;
    aviso.classList.add('is-closing');
    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(
      () => {
        aviso.classList.remove('is-closing');
        aviso.close();
        // El foco vuelve al mensaje que queda en el formulario: el botón
        // que se pulsó ya no existe.
        zonaEstado.focus();
      },
      quieto ? 0 : DURACION_CIERRE_MS,
    );
  };

  if (aviso) {
    aviso.querySelector('[data-aviso-cerrar]')?.addEventListener('click', cerrarAviso);
    // Esc: se intercepta para que también cierre con la animación.
    aviso.addEventListener('cancel', (e) => {
      e.preventDefault();
      cerrarAviso();
    });
    // Clic en el velo: el target es el propio <dialog>, no su tarjeta.
    aviso.addEventListener('click', (e) => {
      if (e.target === aviso) cerrarAviso();
    });
  }

  const terminarSinCalificar = (): void => {
    // Se registra igual (llega marcado "No califica"), pero la persona no
    // espera a eso: su respuesta ya es el aviso. keepalive para que salga
    // aunque cierre la pestaña; si falla, solo se entera la consola.
    fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      keepalive: true,
      headers: { Accept: 'application/json' },
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
      })
      .catch((e) => console.error('[formulario] No se pudo registrar', e));

    dejarEnviado();
    // Es también el respaldo si el navegador no tiene <dialog>.
    ponerEstado(
      'aviso',
      'Todavía no es el mejor momento para contratarnos. Cuando tu pauta crezca, aquí vamos a estar.',
    );
    if (aviso && typeof aviso.showModal === 'function') {
      aviso.classList.remove('is-closing');
      aviso.showModal();
    }
  };

  // ── El mensaje de WhatsApp, armado con las respuestas ───────────────

  const construirWhatsapp = (): string => {
    const nombre = valor(form, 'nombre');
    const marca = valor(form, 'marca');
    const paquete = valor(form, 'paquete');
    const plataformas = valores(form, 'plataformas[]').join(', ');
    const inversion = valor(form, 'inversion');
    const volumen = valor(form, 'volumen');
    const equipoInterno = valor(form, 'equipo_interno');
    const cuando = valor(form, 'cuando');
    const referencia = valor(form, 'referencia');
    const mensaje = valor(form, 'mensaje');

    const lineas = [
      `Hola Lienzos, soy ${nombre}${marca ? ` de ${marca}` : ''}.`,
      `Acabo de enviar el formulario de la web.`,
      '',
      paquete && `Modalidad: ${paquete}`,
      mensaje && `Pauto: ${mensaje}`,
      plataformas && `Plataformas: ${plataformas}`,
      inversion && `Invierto al mes en pauta: ${inversion}`,
      volumen && `Anuncios que necesito al mes: ${volumen}`,
      equipoInterno && `Equipo interno: ${equipoInterno}`,
      cuando && `Para: ${cuando}`,
      referencia && `Anuncio de referencia: ${referencia}`,
    ].filter(Boolean);

    return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(lineas.join('\n'))}`;
  };

  // ── Envío ───────────────────────────────────────────────────────────

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    let primerFallo: Campo | null = null;
    for (const c of campos) {
      const error = c.validar();
      mostrarError(c, error);
      if (error && !primerFallo) primerFallo = c;
    }
    if (primerFallo) {
      // Si el fallo está en un paso anterior, se vuelve a él: enseñar el
      // error en una pantalla que no se ve no sirve de nada.
      const paso = pasoDe(primerFallo);
      if (porPasos && paso !== actual) irA(paso);
      primerFallo.foco.focus();
      ponerEstado('error', 'Falta algo por revisar.');
      return;
    }

    if (!califica(form)) {
      terminarSinCalificar();
      return;
    }

    // Se arma ANTES de enviar: después el formulario se resetea y ya no
    // quedan respuestas de las que sacarlo.
    const urlWhatsapp = construirWhatsapp();

    // El spinner solo aparece si de verdad tarda.
    temporizadorSpinner = window.setTimeout(
      () => ponerEstado('cargando', 'Enviando…'),
      RETRASO_SPINNER_MS,
    );
    boton.disabled = true;

    const control = new AbortController();
    const corte = window.setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS);

    try {
      const respuesta = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        signal: control.signal,
        headers: { Accept: 'application/json' },
      });

      window.clearTimeout(temporizadorSpinner);
      window.clearTimeout(corte);

      if (!respuesta.ok) throw new Error(String(respuesta.status));

      if (salida) {
        salida.href = urlWhatsapp;
        salida.textContent = 'Abrir WhatsApp con tu resumen';
        salida.classList.remove('boton-secundario');
        salida.classList.add('boton-primario');
      }

      ponerEstado(
        'exito',
        '¡Recibido! Te llevamos a WhatsApp con tu resumen. Si no se abrió, usa el botón de abajo.',
      );
      dejarEnviado();

      // Se avisa a la analítica solo si hay permiso, y solo aquí: quien no
      // califica nunca cuenta como conversión, o la pauta aprendería a
      // traer más de lo que no sirve.
      if (permitido('marketing')) {
        document.dispatchEvent(
          new CustomEvent('conversion', { detail: { tipo: 'cotizacion_enviada' } }),
        );
      }

      // Lo último: en el móvil esto saca de la página.
      irAWhatsapp(urlWhatsapp);
    } catch (e) {
      window.clearTimeout(temporizadorSpinner);
      window.clearTimeout(corte);

      // El usuario ve un mensaje genérico y una salida alternativa. El
      // detalle no se enseña: cada línea de un error crudo es información
      // gratis para quien esté mirando.
      if (salida) salida.href = urlWhatsapp;

      const abortado = e instanceof DOMException && e.name === 'AbortError';
      ponerEstado(
        'error',
        abortado
          ? 'Está tardando demasiado. No pierdas el viaje: mándanoslo por WhatsApp con el botón de abajo, va con todo lo que escribiste.'
          : 'No hemos podido enviarlo. No pierdas el viaje: mándanoslo por WhatsApp con el botón de abajo, va con todo lo que escribiste.',
      );
      boton.disabled = false;
    }
  });

  ponerEstado('vacio');
}
