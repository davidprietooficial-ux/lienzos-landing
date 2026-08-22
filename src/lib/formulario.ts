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
 * El envío tiene DOS destinos: el correo (vía formulario.php) y WhatsApp,
 * que es donde el cliente cierra. El mensaje de WhatsApp se arma con las
 * propias respuestas del formulario, así que quien recibe ya tiene el
 * resumen sin tener que preguntar nada.
 *
 * Por qué WhatsApp se abre con un BOTÓN y no solo: `window.open` después de
 * un `await` ya no cuenta como gesto del usuario y los navegadores lo
 * bloquean como popup. Un botón que el usuario pulsa siempre funciona; una
 * apertura automática funciona a veces. Se intenta igualmente, y el botón
 * queda de respaldo visible.
 */

import { permitido } from './consentimiento';

type Estado = 'vacio' | 'cargando' | 'exito' | 'error';

const RETRASO_SPINNER_MS = 900; // por debajo de esto no se muestra nada
const TIEMPO_MAXIMO_MS = 15_000;
const WHATSAPP = '573057190936';

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

  const simple = (
    nombre: string,
    validar: (v: string) => string | null,
  ): Campo | null => {
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
    simple('nombre', (v) =>
      v.trim() ? null : 'Tu nombre hace falta para poder responderte.',
    ),
  );

  agregar(
    simple('mensaje', (v) =>
      v.trim() ? null : 'Con saber qué vendes ya podemos proponerte algo.',
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
  const paqueteInputs = Array.from(
    form.querySelectorAll<HTMLInputElement>('[name="paquete"]'),
  );
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

  // ── El mensaje de WhatsApp, armado con las respuestas ───────────────

  const construirWhatsapp = (): string => {
    const nombre = valor(form, 'nombre');
    const marca = valor(form, 'marca');
    const paquete = valor(form, 'paquete');
    const plataformas = valores(form, 'plataformas[]').join(', ');
    const presupuesto = valor(form, 'presupuesto');
    const cuando = valor(form, 'cuando');
    const referencia = valor(form, 'referencia');
    const mensaje = valor(form, 'mensaje');

    const lineas = [
      `Hola Lienzos, soy ${nombre}${marca ? ` de ${marca}` : ''}.`,
      `Acabo de enviar el formulario de la web.`,
      '',
      paquete && `Paquete: ${paquete}`,
      plataformas && `Voy a pautar en: ${plataformas}`,
      presupuesto && `Presupuesto: ${presupuesto}`,
      cuando && `Para: ${cuando}`,
      referencia && `Anuncio de referencia: ${referencia}`,
      mensaje && `Vendo: ${mensaje}`,
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
        '¡Recibido! Ya tenemos tus datos. Sigue la conversación por WhatsApp para cerrar detalles.',
      );
      form.reset();
      campos.forEach((c) => mostrarError(c, null));
      actual = 0;
      pintarPaso();
      // El envío ya se hizo: lo que queda es la confirmación, no el
      // formulario otra vez.
      paneles.forEach((panel) => (panel.hidden = true));
      if (btnSiguiente) btnSiguiente.hidden = true;
      if (btnAtras) btnAtras.hidden = true;
      boton.hidden = true;
      if (marcaTiempo) marcaTiempo.value = String(Math.floor(Date.now() / 1000));

      // Se intenta abrir solo. Si el navegador lo bloquea por venir después
      // de un await, el botón de arriba sigue ahí — por eso no se comprueba
      // el resultado ni se avisa de nada.
      window.open(urlWhatsapp, '_blank', 'noopener,noreferrer');

      // Se avisa a la analítica solo si hay permiso.
      if (permitido('marketing')) {
        document.dispatchEvent(
          new CustomEvent('conversion', { detail: { tipo: 'cotizacion_enviada' } }),
        );
      }
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
