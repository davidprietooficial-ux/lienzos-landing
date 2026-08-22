/**
 * Helpers anti-XSS.
 *
 * La regla del proyecto: nada que venga del usuario o de la URL se pinta
 * con innerHTML. Se usa textContent, y si de verdad hace falta marcado,
 * se construye con createElement — nunca concatenando cadenas.
 *
 * `npm run gate` (verificación 6) busca innerHTML con variables y falla.
 */

/** Escapa los cinco caracteres que rompen el HTML. */
export function escapar(valor: unknown): string {
  const s = String(valor ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Pinta texto de forma segura. Es lo que se usa el 95% de las veces.
 * `elemento.textContent = valor` ya es seguro; esto solo añade el guardado
 * contra null y la conversión.
 */
export function texto(elemento: Element | null, valor: unknown): void {
  if (elemento) elemento.textContent = String(valor ?? '');
}

/**
 * Lee un parámetro de la URL validándolo contra una lista blanca.
 *
 * Nunca uses un parámetro de URL tal cual: es entrada de un tercero que
 * controla el enlace, y acaba en el DOM, en una petición o en un redirect.
 *
 *   const seccion = paramPermitido('ir', ['servicios', 'contacto'], 'servicios');
 */
export function paramPermitido<T extends string>(
  nombre: string,
  permitidos: readonly T[],
  porDefecto: T,
): T {
  const valor = new URLSearchParams(window.location.search).get(nombre);
  return permitidos.includes(valor as T) ? (valor as T) : porDefecto;
}

/**
 * Valida que una URL sea segura para poner en un href.
 *
 * Bloquea javascript:, data: y vbscript:, que son la vía clásica de XSS
 * a través de un enlace. Devuelve null si no es aceptable.
 */
export function urlSegura(valor: string): string | null {
  const limpio = valor.trim();
  if (/^(javascript|data|vbscript|file):/i.test(limpio)) return null;
  // Relativas y anclas siempre valen.
  if (/^(\/|#|\.)/.test(limpio)) return limpio;
  try {
    const u = new URL(limpio, window.location.origin);
    return u.protocol === 'https:' || u.protocol === 'mailto:' || u.protocol === 'tel:'
      ? u.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Construye un enlace externo con las protecciones puestas.
 * Sin rel="noopener", la pestaña que abres puede manipular la tuya.
 */
export function enlaceExterno(href: string, etiqueta: string): HTMLAnchorElement | null {
  const seguro = urlSegura(href);
  if (!seguro) return null;
  const a = document.createElement('a');
  a.href = seguro;
  a.textContent = etiqueta;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
