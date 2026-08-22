/**
 * Aparición al hacer scroll, con IntersectionObserver.
 *
 * Sin librería: son 40 líneas y una librería de scroll pesa 15-30 KB.
 * En una landing eso es más que todo el resto del JS junto.
 *
 * Uso en el HTML:
 *   <div data-revelar>              aparece al entrar en pantalla
 *   <div data-revelar="izquierda">  entra desde la izquierda
 *   <div data-revelar-retraso="2">  espera 2 escalones (120ms)
 *
 * Respeta prefers-reduced-motion: si el usuario lo pide, todo aparece
 * visible de golpe y no se observa nada.
 */

const ESCALON_MS = 60;

export function iniciarRevelado(): void {
  const elementos = document.querySelectorAll<HTMLElement>('[data-revelar]');
  if (elementos.length === 0) return;

  const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Sin IntersectionObserver (navegador muy antiguo) o con movimiento
  // reducido: se muestra todo. Nunca se deja contenido invisible por no
  // poder animarlo — eso sería perder contenido, no perder una animación.
  if (sinMovimiento || !('IntersectionObserver' in window)) {
    elementos.forEach((el) => el.classList.add('visible'));
    return;
  }

  const observador = new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        const el = entrada.target as HTMLElement;
        const retraso = Number(el.dataset.revelarRetraso ?? 0) * ESCALON_MS;
        window.setTimeout(() => el.classList.add('visible'), retraso);
        observador.unobserve(el); // una sola vez: no re-anima al volver a subir
      }
    },
    {
      // Se dispara un poco antes de entrar del todo, para que la animación
      // termine justo cuando el elemento está a la vista.
      rootMargin: '0px 0px -12% 0px',
      threshold: 0.1,
    },
  );

  elementos.forEach((el) => observador.observe(el));
}

/**
 * Contador que sube hasta su valor al entrar en pantalla.
 *   <span data-contador="38">0</span>
 */
export function iniciarContadores(): void {
  const contadores = document.querySelectorAll<HTMLElement>('[data-contador]');
  if (contadores.length === 0) return;

  const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pintar = (el: HTMLElement, v: number) => {
    el.textContent = String(v) + (el.dataset.contadorSufijo ?? '');
  };

  if (sinMovimiento || !('IntersectionObserver' in window)) {
    contadores.forEach((el) => pintar(el, Number(el.dataset.contador ?? 0)));
    return;
  }

  const observador = new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        const el = entrada.target as HTMLElement;
        observador.unobserve(el);

        const destino = Number(el.dataset.contador ?? 0);
        const duracion = 900;
        const inicio = performance.now();

        const paso = (ahora: number) => {
          const t = Math.min((ahora - inicio) / duracion, 1);
          // Desaceleración: arranca rápido y frena. Un contador lineal se
          // siente mecánico.
          const suave = 1 - Math.pow(1 - t, 3);
          pintar(el, Math.round(destino * suave));
          if (t < 1) requestAnimationFrame(paso);
        };
        requestAnimationFrame(paso);
      }
    },
    { threshold: 0.5 },
  );

  contadores.forEach((el) => observador.observe(el));
}
