/**
 * Punto de entrada.
 *
 * El orden importa y no es arbitrario:
 *   1. Estilos, para que no haya destello sin estilar.
 *   2. Consentimiento, porque todo lo demás depende de él.
 *   3. Interfaz (navegación, revelado, formulario): funciona sin permisos.
 *   4. Tracking, que queda en cola hasta que haya consentimiento.
 *
 * Todo el JS de este archivo es de mejora progresiva: si falla, la página
 * sigue leyéndose y los enlaces siguen funcionando.
 */

import './estilos/tokens.css';
import './estilos/sitio.css';

import { iniciarConsentimiento } from './lib/consentimiento';
import { iniciarRevelado, iniciarContadores } from './lib/revelar';
import { iniciarFormulario } from './lib/formulario';
import { iniciarReproductores } from './lib/reproductor';
import { iniciarVsl } from './lib/vsl';
import { iniciarTracking, registrarConversiones } from './lib/tracking';

// ── Barra de marca ────────────────────────────────────────────────────
//
// Esto NO es una navegación y no debe volver a serlo: en una landing de
// campaña, cada enlace de sección es una salida que compite con el CTA.
// Aquí solo hay logo + "Cotizar", y el "Cotizar" ni siquiera aparece hasta
// que el CTA del hero se ha ido de pantalla — dos botones idénticos a la
// vez es ruido, no insistencia.

function iniciarMarcaFlotante(): void {
  const barra = document.querySelector<HTMLElement>('[data-marca-flotante]');
  if (!barra) return;

  // Se observa el bloque de botones del hero, no un centinela en el top:
  // así el CTA de arriba entra exactamente cuando el de abajo se pierde.
  const anclaHero = document.querySelector<HTMLElement>('[data-ancla-cta]');

  if (!anclaHero || !('IntersectionObserver' in window)) {
    barra.classList.add('compacta');
    return;
  }

  new IntersectionObserver(
    ([entrada]) => barra.classList.toggle('compacta', !entrada?.isIntersecting),
    { threshold: 0 },
  ).observe(anclaHero);
}

// ── Preguntas frecuentes ──────────────────────────────────────────────

function iniciarFaq(): void {
  // Se usa <details>, que ya es accesible y funciona sin JS. Esto solo
  // añade el cierre de las demás al abrir una.
  const grupo = document.querySelectorAll<HTMLDetailsElement>('[data-faq] details');
  grupo.forEach((d) => {
    d.addEventListener('toggle', () => {
      if (!d.open) return;
      grupo.forEach((otra) => {
        if (otra !== d) otra.open = false;
      });
    });
  });
}

// ── Aviso de vista previa ─────────────────────────────────────────────
//
// En la vista previa estática no hay PHP, así que el formulario no puede
// mandar el correo: falla y cae en su salida de WhatsApp, que sí funciona.
// Sin este aviso, quien esté revisando el boceto lo lee como un error del
// sitio en vez de como una limitación del alojamiento de la vista previa.

function avisarVistaPrevia(): void {
  if (!/github\.io$/.test(location.hostname)) return;

  const form = document.querySelector('[data-formulario]');
  if (!form) return;

  const aviso = document.createElement('p');
  aviso.className = 'copy-pendiente';
  aviso.style.marginBottom = 'var(--spacing-2xs)';
  const titulo = document.createElement('strong');
  titulo.textContent = 'Vista previa';
  aviso.append(
    titulo,
    'Esta versión está alojada como archivos estáticos, así que el envío por correo no ' +
      'funciona todavía. El formulario y el resumen que arma para WhatsApp sí: pruébalos.',
  );
  form.prepend(aviso);
}

// ── Año del pie ───────────────────────────────────────────────────────

function actualizarAno(): void {
  const el = document.querySelector('[data-ano]');
  if (el) el.textContent = String(new Date().getFullYear());
}

// ── Arranque ──────────────────────────────────────────────────────────

function iniciar(): void {
  // El <html> viene con class="no-js" y el CSS lo usa para mostrar todo el
  // contenido sin animaciones. Se quita solo cuando este archivo llega a
  // ejecutarse: si el JS falla o lo bloquean, la página se lee entera.
  document.documentElement.classList.remove('no-js');

  iniciarConsentimiento();

  iniciarMarcaFlotante();
  iniciarRevelado();
  iniciarContadores();
  iniciarFaq();
  iniciarFormulario();
  iniciarReproductores();
  iniciarVsl();
  avisarVistaPrevia();
  actualizarAno();

  iniciarTracking();
  registrarConversiones();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar, { once: true });
} else {
  iniciar();
}
