import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// FAQPage en JSON-LD, sacado de los <details name="faq"> del propio HTML.
// Así las respuestas viven en un solo sitio: si se edita una pregunta, el
// dato estructurado cambia con ella. Las que aún llevan .pendiente se
// saltan — marcar como respuesta un hueco sin contenido es peor que nada.
function faqJsonLd(): Plugin {
  const limpiar = (html: string) =>
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  return {
    name: 'faq-json-ld',
    transformIndexHtml(html) {
      const bloques = html.matchAll(
        /<details name="faq">\s*<summary>([\s\S]*?)<\/summary>\s*<div>([\s\S]*?)<\/div>\s*<\/details>/g,
      );
      const preguntas = Array.from(bloques)
        .filter(([, , respuesta]) => !respuesta.includes('class="pendiente"'))
        .map(([, pregunta, respuesta]) => ({
          '@type': 'Question',
          name: limpiar(pregunta),
          acceptedAnswer: { '@type': 'Answer', text: limpiar(respuesta) },
        }));
      if (preguntas.length === 0) return html;

      // < para que ningún texto pueda cerrar el <script> antes de tiempo.
      const json = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: preguntas,
      }).replace(/</g, '\\u003c');

      return {
        html,
        tags: [
          {
            tag: 'script',
            attrs: { type: 'application/ld+json' },
            children: json,
            injectTo: 'head',
          },
        ],
      };
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), faqJsonLd()],

  // En el hosting definitivo el sitio vive en la raíz del dominio, así que
  // el valor por defecto es '/'. Para una vista previa servida en subruta
  // (github.io/<repo>/) se compila con BASE_PATH=/<repo>/ y todas las rutas
  // de assets salen relativas a esa carpeta.
  base: process.env.BASE_PATH || '/',

  build: {
    // Sin sourcemaps en producción: publican el código fuente completo.
    // Es la verificación 6 del gate.
    sourcemap: false,

    // Hostinger sirve estáticos sin problema con nombres con hash, y el hash
    // es lo que permite cachear un año con seguridad (ver public/.htaccess).
    assetsDir: 'assets',

    // Un solo bundle: en una landing de una página, partirlo añade peticiones
    // sin ahorrar nada. Las dos páginas legales comparten ese mismo bundle,
    // así que entran en la caché del visitante ya calientes.
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        privacidad: resolve(__dirname, 'privacidad.html'),
        cookies: resolve(__dirname, 'cookies.html'),
        terminos: resolve(__dirname, 'terminos.html'),
        'tratamiento-datos': resolve(__dirname, 'tratamiento-datos.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },

    // Aviso si el JS crece más de la cuenta. Una landing no debería pasar de
    // ~25 KB de JS propio; si lo hace, algo se está haciendo con librería.
    chunkSizeWarningLimit: 40,
  },

  server: {
    port: 5173,
    open: true,
  },
});
