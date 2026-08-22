/**
 * VSL del hero: bucle mudo hasta que lo piden.
 *
 * El video arranca en bucle y sin sonido — hay movimiento desde el primer
 * segundo, que es lo que hace que alguien se quede, pero no invade a nadie
 * con audio que no pidió. Al pulsar play vuelve al inicio, se desmutea y
 * pasa a los controles nativos del navegador.
 *
 * Por qué controles nativos y no un reproductor propio: aquí el visitante
 * SÍ quiere poder pausar, retroceder y ver cuánto queda. `reproductor.ts`
 * existe para el caso contrario (VSL de venta larga donde se bloquea el
 * adelantado a propósito) y no es lo que queremos en el hero.
 *
 * Fail-open: si este módulo no llega a ejecutarse, el bucle mudo se sigue
 * viendo y el botón sigue siendo un botón — no se rompe nada, solo no hay
 * audio. Por eso el <video> NO lleva `controls` en el HTML: los añade este
 * script, y sin él el loop decorativo se comporta como un loop decorativo.
 */

export function iniciarVsl(): void {
  const cajas = document.querySelectorAll<HTMLElement>('[data-vsl]');

  for (const caja of cajas) {
    const video = caja.querySelector<HTMLVideoElement>('[data-vsl-video]');
    const boton = caja.querySelector<HTMLButtonElement>('[data-vsl-boton]');
    if (!video || !boton) continue;

    boton.addEventListener('click', () => {
      caja.classList.add('vsl--reproduciendo');
      video.loop = false;
      video.muted = false;
      video.controls = true;
      video.currentTime = 0;
      // Si el navegador rechaza la reproducción con sonido, se vuelve al
      // estado anterior en vez de dejar un botón invisible y un video quieto.
      void video.play().catch(() => {
        caja.classList.remove('vsl--reproduciendo');
        video.muted = true;
        video.loop = true;
        video.controls = false;
      });
    });

    // Al terminar vuelve al bucle mudo: el hero no se queda con un
    // fotograma congelado y el botón está otra vez donde se espera.
    video.addEventListener('ended', () => {
      caja.classList.remove('vsl--reproduciendo');
      video.controls = false;
      video.muted = true;
      video.loop = true;
      void video.play().catch(() => {});
    });
  }
}
