/**
 * Consentimiento de cookies y carga diferida de terceros.
 *
 * La regla, que es legal y no de estilo: NINGÚN script de terceros hace una
 * sola petición de red antes de que el visitante acepte. Ni el píxel, ni la
 * analítica, ni los anuncios.
 *
 * Cómo funciona: los terceros no se cargan directamente. Se registran aquí
 * con `alConsentir()` y quedan en cola. Cuando el usuario acepta, se
 * ejecutan dentro de requestIdleCallback para no competir con el render.
 *
 * `npm run gate` (verificación 8) comprueba que no haya <script src> de
 * terceros directamente en el HTML, que es la forma de saltarse esto.
 */

export type Categoria = 'necesarias' | 'analitica' | 'marketing';

export interface Consentimiento {
  necesarias: true; // siempre; no son opcionales por definición
  analitica: boolean;
  marketing: boolean;
  fecha: string;
  version: number;
}

// Subir la versión invalida los consentimientos antiguos y vuelve a
// preguntar. Hazlo cuando cambien las categorías o los proveedores.
const VERSION = 1;
const CLAVE = 'consentimiento';

const cola: Array<{ categoria: Categoria; fn: () => void; nombre: string }> = [];
let estado: Consentimiento | null = null;

// ── Estado ────────────────────────────────────────────────────────────

function leer(): Consentimiento | null {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return null;
    const d = JSON.parse(crudo) as Consentimiento;
    return d.version === VERSION ? d : null;
  } catch {
    return null;
  }
}

function guardar(analitica: boolean, marketing: boolean): void {
  estado = {
    necesarias: true,
    analitica,
    marketing,
    fecha: new Date().toISOString(),
    version: VERSION,
  };
  try {
    localStorage.setItem(CLAVE, JSON.stringify(estado));
  } catch {
    // Modo privado con almacenamiento bloqueado: se respeta la decisión
    // durante esta sesión y se vuelve a preguntar en la siguiente.
  }
  aplicar();
}

export function consentimientoActual(): Consentimiento | null {
  return estado;
}

export function permitido(categoria: Categoria): boolean {
  if (categoria === 'necesarias') return true;
  return estado?.[categoria] === true;
}

// ── Cola de terceros ──────────────────────────────────────────────────

/**
 * Registra algo que solo puede ejecutarse con permiso.
 *
 *   alConsentir('marketing', 'Meta Pixel', () => cargarScript('https://...'));
 *
 * Si el consentimiento ya estaba dado, se ejecuta en cuanto el navegador
 * esté ocioso. Si no, espera.
 */
export function alConsentir(categoria: Categoria, nombre: string, fn: () => void): void {
  cola.push({ categoria, nombre, fn });
  if (estado) aplicar();
}

const enReposo = (fn: () => void): void => {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(fn, { timeout: 3000 });
  } else {
    setTimeout(fn, 1);
  }
};

function aplicar(): void {
  for (let i = cola.length - 1; i >= 0; i--) {
    const item = cola[i];
    if (!item) continue;
    if (permitido(item.categoria)) {
      cola.splice(i, 1);
      enReposo(() => {
        try {
          item.fn();
        } catch (e) {
          // Un tercero que revienta no puede tumbar la página.
          console.warn(`[consentimiento] "${item.nombre}" falló al cargar`, e);
        }
      });
    }
  }
  actualizarConsentModeV2();
}

/**
 * Consent Mode v2 de Google. Se declara ANTES de cargar gtag para que las
 * peticiones salgan ya con el estado correcto.
 */
declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

function gtagLocal(...args: unknown[]): void {
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push(args);
}

export function declararConsentModeInicial(): void {
  gtagLocal('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500,
  });
}

function actualizarConsentModeV2(): void {
  if (!estado) return;
  gtagLocal('consent', 'update', {
    ad_storage: estado.marketing ? 'granted' : 'denied',
    ad_user_data: estado.marketing ? 'granted' : 'denied',
    ad_personalization: estado.marketing ? 'granted' : 'denied',
    analytics_storage: estado.analitica ? 'granted' : 'denied',
  });
}

// ── Banner ────────────────────────────────────────────────────────────

function construirBanner(): HTMLElement {
  const banner = document.createElement('div');
  banner.id = 'consentimiento';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-modal', 'false');
  banner.setAttribute('aria-labelledby', 'consentimiento-titulo');
  banner.className = [
    'fixed inset-x-0 bottom-0 z-50',
    'border-t border-[var(--linea)] bg-[var(--elevado-fondo)]',
    'px-[var(--spacing-md)] py-[var(--spacing-md)]',
    'shadow-[0_-4px_24px_rgb(0_0_0/0.08)]',
    'animate-slide-in-bottom animate-duration-300',
  ].join(' ');

  const envoltorio = document.createElement('div');
  envoltorio.className =
    'mx-auto flex max-w-[var(--contenedor-max)] flex-col gap-[var(--spacing-md)] lg:flex-row lg:items-center lg:justify-between';

  const textoBloque = document.createElement('div');
  const titulo = document.createElement('p');
  titulo.id = 'consentimiento-titulo';
  titulo.className = 'font-semibold';
  titulo.textContent = 'Cookies';
  const cuerpo = document.createElement('p');
  cuerpo.className = 'mt-1 max-w-[60ch] text-sm text-[var(--texto-secundario)]';
  cuerpo.textContent =
    'Usamos cookies propias para que el sitio funcione, y de terceros para medir el tráfico y mostrar publicidad. Tú decides.';
  const enlace = document.createElement('a');
  enlace.href = '/privacidad';
  enlace.className = 'text-sm underline underline-offset-2';
  enlace.textContent = 'Política de privacidad';
  cuerpo.append(' ');
  cuerpo.append(enlace);
  textoBloque.append(titulo, cuerpo);

  const botones = document.createElement('div');
  botones.className = 'flex shrink-0 flex-wrap gap-[var(--spacing-2xs)]';

  const boton = (etiqueta: string, primario: boolean, alPulsar: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = etiqueta;
    b.className = [
      'min-h-[var(--boton-alto)] rounded-[var(--radius-md)] px-[var(--boton-padding-x)]',
      'text-sm font-semibold transition-colors duration-[var(--mov-rapido)]',
      primario
        ? 'bg-[var(--accion)] text-[var(--texto-sobre-accion)] hover:bg-[var(--accion-hover)]'
        : 'border border-[var(--linea)] text-[var(--texto-principal)] hover:bg-[var(--tarjeta-fondo)]',
    ].join(' ');
    b.addEventListener('click', alPulsar);
    return b;
  };

  botones.append(
    boton('Solo las necesarias', false, () => {
      guardar(false, false);
      cerrar(banner);
    }),
    boton('Aceptar todo', true, () => {
      guardar(true, true);
      cerrar(banner);
    }),
  );

  envoltorio.append(textoBloque, botones);
  banner.append(envoltorio);
  return banner;
}

function cerrar(banner: HTMLElement): void {
  banner.remove();
  // Devuelve el foco a algo sensato después de cerrar.
  document.querySelector<HTMLElement>('main')?.focus?.();
}

// ── Arranque ──────────────────────────────────────────────────────────

export function iniciarConsentimiento(): void {
  declararConsentModeInicial();

  estado = leer();
  if (estado) {
    aplicar();
    return;
  }

  // El banner se monta después del primer render para no competir con el
  // LCP. Va en position:fixed, así que no empuja el contenido: sin esto
  // sería una fuente clara de CLS.
  const montar = () => document.body.append(construirBanner());
  if (document.readyState === 'complete') enReposo(montar);
  else window.addEventListener('load', () => enReposo(montar), { once: true });
}

/** Permite reabrir el banner desde un enlace del pie. */
export function reabrirPreferencias(): void {
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    /* nada que hacer */
  }
  estado = null;
  document.getElementById('consentimiento')?.remove();
  document.body.append(construirBanner());
}
