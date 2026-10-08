/**
 * Portafolio en video.
 *
 * Dos capas sobre tarjetas que, sin JS, ya son enlaces al .mp4:
 *
 *  - Avances. Cada tarjeta trae un <video> mudo SIN src. Al acercarse a
 *    pantalla se le pone el avance de 6 s y corre en bucle; al salir se
 *    pausa. Con movimiento reducido o ahorro de datos se queda el póster:
 *    cuatro videos en bucle es justo lo que esa persona pidió no ver/gastar.
 *
 *  - Visor. Al pulsar, el anuncio completo se abre en un <dialog> con
 *    sonido. Los cuatro estados, en data-fase:
 *      nada      → reproduciendo (éxito) o recién abierto (< 1 s)
 *      cargando  → spinner a partir de 1 s sin imagen
 *      lento     → spinner y texto a partir de 5 s
 *      error     → mensaje genérico y "Reintentar"
 *    El vacío no aplica: sin archivo no hay tarjeta.
 */

const RETRASO_SPINNER_MS = 1000;
const RETRASO_TEXTO_MS = 5000;
const DURACION_CIERRE_MS = 350; // la de animate-dialog

function prefiereQuieto(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function ahorraDatos(): boolean {
  const conexion = (navigator as Navigator & { connection?: { saveData?: boolean } })
    .connection;
  return conexion?.saveData === true;
}

/**
 * Pósters diferidos.
 *
 * El atributo `poster` se descarga siempre, esté el video a la vista o no:
 * ocho pósters fuera de pantalla son ~260 KB peleando con la primera
 * pantalla por el mismo ancho de banda. Van en `data-poster` y se ponen
 * cuando la tarjeta se acerca. Esto corre siempre — también con movimiento
 * reducido o ahorro de datos, donde el póster es TODO lo que se ve.
 */
function iniciarPosters(): void {
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video[data-poster]'));
  if (videos.length === 0) return;

  const poner = (video: HTMLVideoElement): void => {
    if (video.dataset.poster) video.poster = video.dataset.poster;
    delete video.dataset.poster;
  };

  if (!('IntersectionObserver' in window)) {
    videos.forEach(poner);
    return;
  }

  const observador = new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        poner(entrada.target as HTMLVideoElement);
        observador.unobserve(entrada.target);
      }
    },
    // Margen amplio: el póster tiene que estar puesto ANTES de que la
    // tarjeta entre, no mientras entra.
    { rootMargin: '400px 0px' },
  );

  videos.forEach((video) => observador.observe(video));
}

function iniciarAvances(): void {
  const avances = document.querySelectorAll<HTMLVideoElement>('video[data-avance]');
  if (avances.length === 0) return;
  if (prefiereQuieto() || ahorraDatos() || !('IntersectionObserver' in window)) return;

  const observador = new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        const video = entrada.target as HTMLVideoElement;
        if (entrada.isIntersecting) {
          if (!video.getAttribute('src') && video.dataset.avance)
            video.src = video.dataset.avance;
          // play() rechaza si el navegador decide no reproducir (batería,
          // pestaña en segundo plano): se queda el póster, que es correcto.
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      }
    },
    { rootMargin: '120px 0px', threshold: 0 },
  );

  avances.forEach((video) => observador.observe(video));
}

function iniciarVisor(): void {
  const visor = document.querySelector<HTMLDialogElement>('[data-visor]');
  const video = visor?.querySelector<HTMLVideoElement>('[data-visor-video]');
  const estado = visor?.querySelector<HTMLElement>('[data-visor-estado]');
  const texto = visor?.querySelector<HTMLElement>('[data-visor-texto]');
  const reintentar = visor?.querySelector<HTMLButtonElement>('[data-visor-reintentar]');
  const cerrar = visor?.querySelector<HTMLButtonElement>('[data-visor-cerrar]');
  // Sin <dialog> nativo el enlace sigue abriendo el .mp4 en el navegador.
  if (!visor || !video || !estado || !texto || !reintentar || !cerrar) return;
  if (typeof visor.showModal !== 'function') return;

  let temporizadores: number[] = [];
  let origen: HTMLElement | null = null;
  // Los avances que corrían al abrir: se pausan detrás del visor (nadie los
  // ve y compiten por CPU con el anuncio) y se reanudan al cerrar.
  let avancesPausados: HTMLVideoElement[] = [];

  const cancelarTemporizadores = (): void => {
    temporizadores.forEach((t) => window.clearTimeout(t));
    temporizadores = [];
  };

  const pintar = (fase: 'nada' | 'cargando' | 'lento' | 'error'): void => {
    visor.dataset.fase = fase;
    estado.hidden = fase === 'nada';
    texto.textContent =
      fase === 'lento'
        ? 'Cargando el video…'
        : fase === 'error'
          ? 'No pudimos cargar el video.'
          : '';
    reintentar.hidden = fase !== 'error';
  };

  // Por debajo de 1 s no se muestra nada: un spinner que parpadea se
  // siente más lento que ninguno.
  const esperarImagen = (): void => {
    cancelarTemporizadores();
    pintar('nada');
    temporizadores.push(
      window.setTimeout(() => pintar('cargando'), RETRASO_SPINNER_MS),
      window.setTimeout(() => pintar('lento'), RETRASO_TEXTO_MS),
    );
  };

  const reproducir = (): void => {
    esperarImagen();
    video.play().catch(() => {
      // Sin permiso para sonar solo: quedan los controles nativos.
      cancelarTemporizadores();
      pintar('nada');
    });
  };

  video.addEventListener('waiting', esperarImagen);
  video.addEventListener('playing', () => {
    cancelarTemporizadores();
    pintar('nada');
  });
  video.addEventListener('error', () => {
    cancelarTemporizadores();
    pintar('error');
    // Al usuario, un mensaje genérico; el detalle, a la consola.
    console.error('[portafolio] No se pudo cargar', video.currentSrc, video.error);
  });

  const abrir = (src: string, etiqueta: string, desde: HTMLElement): void => {
    origen = desde;
    visor.setAttribute('aria-label', etiqueta);
    visor.classList.remove('is-closing');
    // El póster de la tarjeta, para que el visor no abra en negro.
    video.poster = desde.querySelector('video')?.getAttribute('poster') ?? '';
    video.src = src;
    avancesPausados = Array.from(
      document.querySelectorAll<HTMLVideoElement>('video[data-avance]'),
    ).filter((v) => !v.paused);
    avancesPausados.forEach((v) => v.pause());
    visor.showModal();
    reproducir();
  };

  const cerrarVisor = (): void => {
    if (!visor.open || visor.classList.contains('is-closing')) return;
    visor.classList.add('is-closing');
    video.pause();
    window.setTimeout(
      () => {
        visor.classList.remove('is-closing');
        visor.close();
        // Soltar el src corta la descarga: un anuncio de 40 MB no sigue
        // bajando por detrás cuando ya nadie lo ve.
        video.removeAttribute('src');
        video.removeAttribute('poster');
        video.load();
        cancelarTemporizadores();
        pintar('nada');
        avancesPausados.forEach((v) => v.play().catch(() => {}));
        avancesPausados = [];
        origen?.focus();
      },
      prefiereQuieto() ? 0 : DURACION_CIERRE_MS,
    );
  };

  document.querySelectorAll<HTMLAnchorElement>('a[data-pieza-video]').forEach((enlace) => {
    enlace.addEventListener('click', (evento) => {
      // Cmd/Ctrl/clic central siguen abriendo el archivo en otra pestaña.
      if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.button !== 0) return;
      evento.preventDefault();
      abrir(
        enlace.getAttribute('href') ?? '',
        enlace.getAttribute('aria-label') ?? 'Anuncio',
        enlace,
      );
    });
  });

  cerrar.addEventListener('click', cerrarVisor);
  // Esc: se intercepta para que también cierre con la animación.
  visor.addEventListener('cancel', (evento) => {
    evento.preventDefault();
    cerrarVisor();
  });
  // Clic en el velo: el target es el propio <dialog>, no su contenido.
  visor.addEventListener('click', (evento) => {
    if (evento.target === visor) cerrarVisor();
  });
  reintentar.addEventListener('click', () => {
    video.load();
    reproducir();
  });
}

/** Cada "Pedir cotización" de una modalidad la deja marcada en el formulario. */
function iniciarEleccionModalidad(): void {
  document.querySelectorAll<HTMLAnchorElement>('[data-elegir-modalidad]').forEach((enlace) => {
    enlace.addEventListener('click', () => {
      const valor = enlace.dataset.elegirModalidad;
      const opcion = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[name="paquete"]'),
      ).find((o) => o.value === valor);
      if (!opcion || opcion.checked) return;
      opcion.checked = true;
      // change para que la pista del formulario y su validación se enteren.
      opcion.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

export function iniciarPortafolio(): void {
  iniciarPosters();
  iniciarAvances();
  iniciarVisor();
  iniciarEleccionModalidad();
}
