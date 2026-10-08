/**
 * Pistas de las opciones del formulario.
 *
 * Cada opción apunta con aria-describedby a su explicación, que vive en
 * el HTML oculta: el lector de pantalla la lee al llegar al foco, con o
 * sin JS. Esto solo la hace visible debajo del grupo — al pasar el ratón,
 * al enfocar con teclado y al tocar en móvil, donde el hover no existe.
 *
 * Todo con textContent: el texto sale del propio HTML, pero la regla es
 * la misma para todo lo que se escribe en la página.
 */

export function iniciarPistas(): void {
  const conHover = window.matchMedia('(hover: hover)').matches;

  document.querySelectorAll<HTMLElement>('[data-pistas]').forEach((grupo) => {
    const salida = grupo.querySelector<HTMLElement>('[data-pistas-salida]');
    const opciones = Array.from(
      grupo.querySelectorAll<HTMLInputElement>('.chip input[aria-describedby]'),
    );
    if (!salida || opciones.length === 0) return;

    const porDefecto = conHover
      ? 'Pasa el cursor por cada opción para ver qué incluye.'
      : 'Toca una opción para ver qué incluye.';

    const textoDe = (opcion: HTMLInputElement): string => {
      const id = opcion.getAttribute('aria-describedby');
      return (id && document.getElementById(id)?.textContent?.trim()) || '';
    };

    const mostrar = (texto: string, activa: boolean): void => {
      salida.textContent = texto;
      salida.classList.toggle('chips__pista--activa', activa);
    };

    // Al salir del hover o del foco vuelve la de la opción marcada, que es
    // la que la persona necesita recordar; si no hay ninguna, la instrucción.
    const reponer = (): void => {
      const marcada = opciones.find((o) => o.checked);
      if (marcada) mostrar(textoDe(marcada), true);
      else mostrar(porDefecto, false);
    };

    opciones.forEach((opcion) => {
      const chip = opcion.closest<HTMLElement>('.chip');
      chip?.addEventListener('pointerenter', () => mostrar(textoDe(opcion), true));
      chip?.addEventListener('pointerleave', reponer);
      opcion.addEventListener('focus', () => mostrar(textoDe(opcion), true));
      opcion.addEventListener('blur', reponer);
      opcion.addEventListener('change', reponer);
    });

    // El formulario se resetea tras un envío correcto: sin esto la pista
    // de la opción que ya no está marcada se quedaría escrita.
    grupo.closest('form')?.addEventListener('reset', () => setTimeout(reponer));

    salida.hidden = false;
    reponer();
  });
}
