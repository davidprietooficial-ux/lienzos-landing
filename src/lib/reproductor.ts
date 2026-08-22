/**
 * Reproductor de video a medida (patrón VSL / "estilo Vturb"): botón grande
 * de play/pausa, barra de progreso puramente visual (sin scrub), retomar
 * desde localStorage, banner de cierre al terminar.
 *
 * Fail-open: el <video> del HTML arranca con `controls` puesto. Si este
 * script no llega a correr, el navegador muestra sus controles nativos en
 * vez de dejar el video sin forma de reproducirse — `controls` se quita
 * recién al final de `iniciarReproductor()`, cuando el botón y la barra ya
 * están enganchados. Ver references/reproductor-video.md para el HTML y el
 * porqué de cada decisión.
 */

const CLAVE_PROGRESO = 'reproductor-progreso';
const UMBRAL_RETOMAR_SEG = 5; // menos que esto no vale la pena preguntar

function leerProgresoGuardado(id: string): number | null {
  try {
    const crudo = window.localStorage.getItem(`${CLAVE_PROGRESO}:${id}`);
    if (!crudo) return null;
    const segundos = Number(crudo);
    return Number.isFinite(segundos) && segundos > 0 ? segundos : null;
  } catch {
    return null; // privado/incógnito o localStorage bloqueado
  }
}

function guardarProgreso(id: string, segundos: number): void {
  try {
    window.localStorage.setItem(`${CLAVE_PROGRESO}:${id}`, String(Math.floor(segundos)));
  } catch {
    /* localStorage bloqueado — el video se sigue viendo, solo no retoma */
  }
}

function borrarProgreso(id: string): void {
  try {
    window.localStorage.removeItem(`${CLAVE_PROGRESO}:${id}`);
  } catch {
    /* nada que hacer */
  }
}

function iniciarUnReproductor(contenedor: HTMLElement): void {
  const video = contenedor.querySelector<HTMLVideoElement>('[data-reproductor-video]');
  const boton = contenedor.querySelector<HTMLButtonElement>('[data-reproductor-boton]');
  const iconoPlay = contenedor.querySelector<HTMLElement>('[data-icono-play]');
  const iconoPausa = contenedor.querySelector<HTMLElement>('[data-icono-pausa]');
  const barra = contenedor.querySelector<HTMLElement>('[data-reproductor-barra]');
  const relleno = contenedor.querySelector<HTMLElement>('[data-reproductor-relleno]');
  const resumen = contenedor.querySelector<HTMLElement>('[data-reproductor-resumen]');
  const botonContinuar = contenedor.querySelector<HTMLButtonElement>('[data-reproductor-continuar]');
  const botonReiniciar = contenedor.querySelector<HTMLButtonElement>('[data-reproductor-reiniciar]');
  const final = contenedor.querySelector<HTMLElement>('[data-reproductor-final]');

  if (!video || !boton || !iconoPlay || !iconoPausa || !barra || !relleno) return;

  const id = contenedor.dataset.reproductor ?? 'video';
  let ultimoTiempoValido = 0;
  let saltoPermitido = false;
  let ultimoSegundoGuardado = -1;

  const actualizarBoton = (): void => {
    iconoPlay.style.display = video.paused ? '' : 'none';
    iconoPausa.style.display = video.paused ? 'none' : '';
    boton.setAttribute('aria-label', video.paused ? 'Reproducir video' : 'Pausar video');
    contenedor.classList.toggle('reproductor--reproduciendo', !video.paused);
  };

  const alternarReproduccion = (): void => {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };

  // Un solo listener delegado: cubre clic en el botón y en cualquier otra
  // parte del video, sin duplicar el toggle.
  contenedor.addEventListener('click', () => {
    if (resumen && !resumen.hidden) return; // el diálogo de retomar manda mientras está abierto
    if (final && !final.hidden) return; // terminado: solo el enlace del banner manda
    alternarReproduccion();
  });

  video.addEventListener('play', actualizarBoton);
  video.addEventListener('pause', actualizarBoton);

  video.addEventListener('timeupdate', () => {
    ultimoTiempoValido = video.currentTime;
    if (!video.duration) return;

    const porcentaje = (video.currentTime / video.duration) * 100;
    relleno.style.width = `${porcentaje}%`;
    barra.setAttribute('aria-valuenow', String(Math.round(porcentaje)));

    const segundoActual = Math.floor(video.currentTime);
    if (segundoActual !== ultimoSegundoGuardado) {
      ultimoSegundoGuardado = segundoActual;
      guardarProgreso(id, video.currentTime);
    }
  });

  // Sin scrub real: cualquier salto de tiempo que no venga de nuestro
  // propio salto al retomar se revierte (cubre pantalla completa, clic
  // derecho → avanzar, atajos de teclado, etc.).
  video.addEventListener('seeking', () => {
    if (saltoPermitido) {
      saltoPermitido = false;
      return;
    }
    if (Math.abs(video.currentTime - ultimoTiempoValido) > 0.5) {
      video.currentTime = ultimoTiempoValido;
    }
  });

  video.addEventListener('ended', () => {
    borrarProgreso(id);
    if (final) final.hidden = false;
  });

  const progresoGuardado = leerProgresoGuardado(id);
  if (progresoGuardado && progresoGuardado > UMBRAL_RETOMAR_SEG && resumen && botonContinuar && botonReiniciar) {
    resumen.hidden = false;

    botonContinuar.addEventListener('click', (evento) => {
      evento.stopPropagation();
      resumen.hidden = true;
      video.addEventListener(
        'loadedmetadata',
        () => {
          saltoPermitido = true;
          video.currentTime = progresoGuardado;
          ultimoTiempoValido = progresoGuardado;
        },
        { once: true }
      );
      video.play().catch(() => {});
    });

    botonReiniciar.addEventListener('click', (evento) => {
      evento.stopPropagation();
      resumen.hidden = true;
      borrarProgreso(id);
      video.play().catch(() => {});
    });
  }

  actualizarBoton();
  video.removeAttribute('controls'); // recién ahora: botón y barra ya están enganchados
}

/** Engancha todos los `[data-reproductor]` de la página — puede haber más de uno
 *  (p. ej. una grilla de video-testimonials); cada uno necesita su propio
 *  `data-reproductor="<id-único>"` porque es la clave de localStorage. */
export function iniciarReproductores(): void {
  document.querySelectorAll<HTMLElement>('[data-reproductor]').forEach(iniciarUnReproductor);
}
