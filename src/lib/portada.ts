/**
 * Videos de la portada: el fondo a sangre y el reel de la tarjeta.
 *
 * Llegan sin src: mientras la página carga solo se ven los pósters, que
 * es lo que mide el LCP. Cuando la página ya cargó y el hilo principal
 * está libre, cada video recibe su archivo (mudo, en bucle) la primera vez
 * que está en pantalla. Así nunca compiten con lo que hace falta para
 * pintar la primera pantalla, y la tarjeta, que en móvil no se muestra,
 * no se descarga ahí.
 *
 * Con movimiento reducido o ahorro de datos se quedan los pósters. Fuera
 * de pantalla se pausan: nadie los ve y gastan batería.
 */

export function iniciarPortada(): void {
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video[data-reel]'));
  if (videos.length === 0) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const conexion = (navigator as Navigator & { connection?: { saveData?: boolean } })
    .connection;
  if (conexion?.saveData) return;

  const cargar = (video: HTMLVideoElement): void => {
    if (!video.getAttribute('src') && video.dataset.reel) video.src = video.dataset.reel;
    video.play().catch(() => {
      /* el navegador decidió no reproducir: se queda el póster */
    });
  };

  const arrancar = (): void => {
    if (!('IntersectionObserver' in window)) {
      videos.forEach(cargar);
      return;
    }
    // Un elemento con display:none nunca entra en pantalla: la tarjeta
    // del móvil no llega a pedir su archivo.
    const observador = new IntersectionObserver((entradas) => {
      for (const entrada of entradas) {
        const video = entrada.target as HTMLVideoElement;
        if (entrada.isIntersecting) cargar(video);
        else video.pause();
      }
    });
    videos.forEach((video) => observador.observe(video));
  };

  const cuandoEsteLibre = (): void => {
    // Safari no tiene requestIdleCallback: ahí, un respiro fijo tras la carga.
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(arrancar, { timeout: 2500 });
    } else {
      window.setTimeout(arrancar, 1200);
    }
  };

  if (document.readyState === 'complete') cuandoEsteLibre();
  else window.addEventListener('load', cuandoEsteLibre, { once: true });
}
