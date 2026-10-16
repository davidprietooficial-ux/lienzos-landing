/**
 * Píxeles y analítica. Todo en cola hasta el consentimiento.
 *
 * Si un ID está vacío, ese proveedor sencillamente no se registra: no se
 * carga un script "por si acaso".
 */

import { alConsentir } from './consentimiento';

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
  //
  // Mismo pixel que da Meta (ID 1480522530601725), pero el <script> no vive
  // en el HTML: se inyecta aquí, y solo cuando hay permiso de marketing.
  // El <noscript><img> del fragmento oficial se queda fuera a propósito —
  // sin JS tampoco hay banner, así que dispararía sin consentimiento.
  if (IDS.metaPixel) {
    alConsentir('marketing', 'Meta Pixel', async () => {
      prepararFbq();
      await cargarScript('https://connect.facebook.net/en_US/fbevents.js');
      window.fbq?.('init', IDS.metaPixel);
      window.fbq?.('track', 'PageView');
    });
  }

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
