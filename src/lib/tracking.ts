/**
 * Píxeles y analítica. Todo en cola hasta el consentimiento.
 *
 * Si un ID está vacío, ese proveedor sencillamente no se registra: no se
 * carga un script "por si acaso".
 */

import { alConsentir, alDecidir, consentimientoActual } from './consentimiento';

// Vacío = no se carga.
export const IDS = {
  metaPixel: '1480522530601725',
  ga4: '',
  gtm: '',
  googleAds: '',
  tiktokPixel: '',
} as const;

/**
 * Carga un script externo de forma diferida.
 * Se marca async y se añade al final: nunca bloquea el render.
 */
function cargarScript(src: string, atributos: Record<string, string> = {}): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    for (const [k, v] of Object.entries(atributos)) s.setAttribute(k, v);
    s.onload = () => resolver();
    s.onerror = () => rechazar(new Error(`No se pudo cargar ${src}`));
    document.head.append(s);
  });
}

interface FbqStub {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: unknown;
  loaded: boolean;
  version: string;
}

declare global {
  interface Window {
    fbq?: FbqStub;
    _fbq?: FbqStub;
    gtag?: (...args: unknown[]) => void;
    ttq?: { load: (id: string) => void; page: () => void };
  }
}

/**
 * La cola de fbq, tal cual la define el fragmento oficial de Meta.
 *
 * fbevents.js espera encontrarse `fbq` ya creado y vacía su `queue` al
 * cargar. Crearlo aquí es lo que permite llamar a `track` sin depender de
 * si el archivo externo terminó de descargarse.
 */
function prepararFbq(): void {
  if (window.fbq) return;
  const n = function (...args: unknown[]): void {
    if (n.callMethod) n.callMethod.apply(n, args);
    else n.queue.push(args);
  } as FbqStub;
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  n.queue = [];
  window.fbq = n;
  window._fbq = n;
}

/**
 * Meta Pixel.
 *
 * DECISIÓN DEL CLIENTE, 16 de octubre de 2026: el píxel arranca con la
 * página, sin esperar al banner. Si la persona elige "Solo las
 * necesarias" se le manda fbq('consent', 'revoke') —el interruptor
 * oficial de Meta— y a partir de ahí no sale un evento más; además se
 * borran las cookies que alcanzó a poner y en las siguientes visitas ni
 * siquiera se descarga el archivo.
 *
 * Esto se aparta de la regla 6 del contrato ("ni una petición de red
 * antes del consentimiento"). Queda escrito aquí y no disimulado: se
 * decidió a sabiendas, con el riesgo de la ley 1581 de 2012 y de los
 * Términos de Herramientas Empresariales de Meta sobre la mesa.
 *
 * El <noscript><img> del fragmento oficial sigue fuera: sin JS no hay
 * forma de apagarlo después, así que sería un disparo sin vuelta atrás.
 */
function iniciarMetaPixel(): void {
  // Quien ya dijo que no en una visita anterior: no se carga nada.
  if (consentimientoActual()?.marketing === false) return;

  prepararFbq();
  // init y track van ANTES de que el archivo esté: quedan en la cola de
  // fbq y salen en cuanto carga. Es el orden del fragmento de Meta, y es
  // lo que hace que el PageView no dependa de la latencia de la descarga.
  window.fbq?.('init', IDS.metaPixel);
  window.fbq?.('track', 'PageView');
  cargarScript('https://connect.facebook.net/en_US/fbevents.js').catch((e) =>
    console.warn('[tracking] el Meta Pixel no cargó', e),
  );

  alDecidir((decision) => {
    window.fbq?.('consent', decision.marketing ? 'grant' : 'revoke');
    if (!decision.marketing) olvidarCookiesDeMeta();
  });
}

/**
 * Borra _fbp y _fbc. fbq('consent','revoke') corta los envíos, pero las
 * cookies que el píxel alcanzó a poner se quedan; quien dice que no
 * espera que no quede nada, no solo que deje de mandarse.
 */
function olvidarCookiesDeMeta(): void {
  const host = location.hostname;
  // El dominio con punto cubre el caso de que se hubiera puesto en el
  // dominio padre; sin él solo se borraría la del host exacto.
  for (const nombre of ['_fbp', '_fbc']) {
    document.cookie = `${nombre}=; max-age=0; path=/`;
    document.cookie = `${nombre}=; max-age=0; path=/; domain=${host}`;
    document.cookie = `${nombre}=; max-age=0; path=/; domain=.${host}`;
  }
}

export function iniciarTracking(): void {
  // ── Google Analytics 4 · categoría analítica ────────────────────────
  if (IDS.ga4) {
    alConsentir('analitica', 'Google Analytics 4', async () => {
      await cargarScript(`https://www.googletagmanager.com/gtag/js?id=${IDS.ga4}`);
      window.dataLayer = window.dataLayer ?? [];
      const gtag = (...args: unknown[]): void => {
        window.dataLayer!.push(args);
      };
      window.gtag = gtag;
      gtag('js', new Date());
      gtag('config', IDS.ga4, { anonymize_ip: true });
    });
  }

  // ── Google Tag Manager · analítica ──────────────────────────────────
  if (IDS.gtm) {
    alConsentir('analitica', 'Google Tag Manager', async () => {
      window.dataLayer = window.dataLayer ?? [];
      window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      await cargarScript(`https://www.googletagmanager.com/gtm.js?id=${IDS.gtm}`);
    });
  }

  // ── Meta Pixel · marketing ──────────────────────────────────────────
  if (IDS.metaPixel) iniciarMetaPixel();

  // ── TikTok · marketing ──────────────────────────────────────────────
  if (IDS.tiktokPixel) {
    alConsentir('marketing', 'TikTok Pixel', async () => {
      await cargarScript('https://analytics.tiktok.com/i18n/pixel/events.js');
      window.ttq?.load(IDS.tiktokPixel);
      window.ttq?.page();
    });
  }
}

/**
 * Conversiones. Se disparan desde la interfaz (clic en WhatsApp, envío de
 * formulario) y solo llegan a los proveedores que tengan permiso.
 */
export function registrarConversiones(): void {
  const enviar = (nombre: string, datos: Record<string, unknown> = {}): void => {
    window.gtag?.('event', nombre, datos);
    window.fbq?.('trackCustom', nombre, datos);
  };

  document.addEventListener('conversion', (e) => {
    const detalle = (e as CustomEvent<{ tipo: string; eventoId?: string }>).detail;
    const tipo = detalle?.tipo ?? 'desconocido';
    window.gtag?.('event', 'conversion', { tipo });

    // Para Meta va como Lead, que es el evento estándar que entienden sus
    // campañas. El eventID es el mismo que formulario.php manda por la
    // Conversions API: Meta une los dos y cuenta una sola conversión.
    if (detalle?.eventoId) {
      window.fbq?.('track', 'Lead', { content_name: tipo }, { eventID: detalle.eventoId });
    } else {
      window.fbq?.('trackCustom', 'conversion', { tipo });
    }
  });

  // Clic en WhatsApp: es la conversión principal en la mayoría de landings
  // de servicio, y la que más se olvida de medir.
  document
    .querySelectorAll<HTMLAnchorElement>('a[href*="wa.me"], a[href^="https://api.whatsapp"]')
    .forEach((a) => {
      a.addEventListener('click', () => enviar('clic_whatsapp', { destino: a.href }));
    });

  document.querySelectorAll<HTMLAnchorElement>('a[href^="tel:"]').forEach((a) => {
    a.addEventListener('click', () => enviar('clic_telefono'));
  });
}
