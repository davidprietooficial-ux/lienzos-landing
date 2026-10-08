/**
 * Menú lateral de secciones.
 *
 * La hamburguesa lo abre y, convertida en X, lo cierra: la cabecera sube
 * por encima del panel mientras está abierto (CSS: body.menu-abierto).
 * También cierran el velo, cualquier enlace del panel y Esc.
 *
 * Mientras está abierto, todo lo de detrás queda inert: sin eso, el
 * tabulador se escaparía del panel a la página que está debajo del velo.
 * Al abrir, el foco pasa al primer enlace; al cerrar con Esc, vuelve a
 * la hamburguesa.
 */

export function iniciarMenu(): void {
  const boton = document.querySelector<HTMLButtonElement>('[data-menu-boton]');
  const menu = document.getElementById('menu');
  if (!boton || !menu) return;

  const detras = Array.from(
    document.querySelectorAll<HTMLElement>('main, footer, .sticky-cta'),
  );
  let abierto = false;

  const fijar = (siguiente: boolean): void => {
    if (siguiente === abierto) return;
    abierto = siguiente;

    menu.classList.toggle('abierto', abierto);
    boton.classList.toggle('activa', abierto);
    document.body.classList.toggle('menu-abierto', abierto);
    boton.setAttribute('aria-expanded', String(abierto));
    boton.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
    menu.inert = !abierto;
    detras.forEach((el) => (el.inert = abierto));

    if (abierto)
      menu.querySelector<HTMLAnchorElement>('.menu__enlace')?.focus({ preventScroll: true });
  };

  boton.addEventListener('click', () => fijar(!abierto));

  // El velo lleva data-menu-cerrar; los enlaces cierran y dejan que el
  // ancla haga su trabajo (el scroll suave lo pone el CSS).
  menu.addEventListener('click', (evento) => {
    const objetivo = evento.target as HTMLElement;
    if (objetivo.closest('[data-menu-cerrar]') || objetivo.closest('a')) fijar(false);
  });

  document.addEventListener('keydown', (evento) => {
    if (!abierto || (evento.key !== 'Escape' && evento.key !== 'Esc')) return;
    fijar(false);
    boton.focus();
  });
}
