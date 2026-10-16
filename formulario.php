<?php
/**
 * formulario.php — endpoint del formulario de contacto.
 *
 * Cinco capas, en este orden. Si dos fallan, quedan tres de pie:
 *   1. Honeypot        campo oculto que un humano nunca rellena
 *   2. Tiempo mínimo   un envío en menos de 3 s no lo hizo una persona
 *   3. Límite de tasa  5 envíos por IP y hora
 *   4. Validación      se repite ENTERA aquí; la del navegador es cortesía
 *   5. Escape          todo lo que sale va escapado
 *
 * Lo que NO hace, a propósito: no devuelve nunca el detalle del error. El
 * usuario ve "no pudimos enviarlo"; el detalle va al log. Cada línea de un
 * error crudo es información gratis para quien esté buscando por dónde entrar.
 *
 * ── Antes de subirlo ─────────────────────────────────────────────────
 *
 * 1. DESTINO ya apunta a lienzosprod@gmail.com — confírmalo con el cliente
 *    antes de subir; es el correo público de su portafolio, no
 *    necesariamente el que quieren para los leads.
 * 2. Crea la carpeta de datos FUERA de public_html y ponla en 0700:
 *
 *      mkdir -p ~/datos-formulario && chmod 700 ~/datos-formulario
 *
 *    Si se deja dentro de public_html, cualquiera puede leer las IPs de
 *    quien envió el formulario. Eso es una fuga de datos personales.
 * 3. Crea el archivo de credenciales de Meta, TAMBIÉN fuera de public_html,
 *    en el mismo nivel que la carpeta de datos:
 *
 *      <?php return [
 *          'pixel_id'        => '1480522530601725',
 *          'token'           => 'EAAG...',   // System User, permiso ads_management
 *          'test_event_code' => '',          // solo para "Probar eventos"
 *      ];
 *
 *    chmod 600. Sin este archivo el formulario funciona igual: simplemente
 *    no manda la conversión. El token NUNCA va al repositorio ni al bundle.
 */

declare(strict_types=1);

// ── Configuración ────────────────────────────────────────────────────

const DESTINO       = 'lienzosprod@gmail.com';
const ASUNTO_BASE   = 'Cotización desde la web';
const MAX_POR_HORA  = 5;
const SEGUNDOS_MIN  = 3;

// Fuera de la raíz web. Ajusta la ruta a tu cuenta de Hostinger.
$DIR_DATOS = dirname($_SERVER['DOCUMENT_ROOT']) . '/datos-formulario';

// Credenciales de la Conversions API de Meta. Un .php dentro de public_html
// es un archivo que cualquiera puede pedir por URL, así que este vive fuera
// y no está en el repositorio. Si no existe, no se manda la conversión y el
// formulario sigue funcionando igual.
$RUTA_META = dirname($_SERVER['DOCUMENT_ROOT']) . '/meta-capi.php';

// ── Respuestas ───────────────────────────────────────────────────────

/**
 * Responde y termina. El mensaje al usuario es SIEMPRE genérico; el motivo
 * real solo va al log del servidor.
 */
function responder(int $codigo, string $publico, string $interno = ''): never {
    if ($interno !== '') {
        error_log('[formulario] ' . $interno);
    }
    http_response_code($codigo);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode(['mensaje' => $publico], JSON_UNESCAPED_UNICODE);
    exit;
}

// Al robot se le responde 200 y "gracias". Si le devolvemos un error,
// aprende qué le delató y vuelve corregido.
function fingirExito(string $motivo): never {
    error_log('[formulario] descartado: ' . $motivo);
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['mensaje' => 'Recibido'], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Método ───────────────────────────────────────────────────────────

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    responder(405, 'Método no permitido.');
}

// ── Capa 1 · Honeypot ────────────────────────────────────────────────

if (trim((string)($_POST['web'] ?? '')) !== '') {
    fingirExito('honeypot relleno');
}

// ── Capa 2 · Tiempo mínimo ───────────────────────────────────────────
//
// El formulario manda cuándo se cargó la página. Rellenar cuatro campos en
// menos de 3 segundos no lo hace una persona.

$marca = (int)($_POST['t'] ?? 0);
if ($marca > 0 && (time() - $marca) < SEGUNDOS_MIN) {
    fingirExito('enviado en menos de ' . SEGUNDOS_MIN . 's');
}

// ── Capa 3 · Límite de tasa por IP ───────────────────────────────────

function ipCliente(): string {
    // Con Cloudflare delante, la IP real viene en CF-Connecting-IP.
    // REMOTE_ADDR sería la de Cloudflare y limitaría a todo el mundo junto.
    foreach (['HTTP_CF_CONNECTING_IP', 'REMOTE_ADDR'] as $clave) {
        $valor = $_SERVER[$clave] ?? '';
        if (filter_var($valor, FILTER_VALIDATE_IP)) {
            return $valor;
        }
    }
    return '0.0.0.0';
}

function limiteSuperado(string $dir, string $ip): bool {
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
        // Sin carpeta no hay límite de tasa. Se registra y se deja pasar:
        // bloquear todos los envíos por un problema de permisos sería peor.
        error_log('[formulario] no puedo crear ' . $dir . ' — sin límite de tasa');
        return false;
    }

    // Se guarda el hash de la IP, no la IP. Si el archivo se filtrara, no
    // habría datos personales dentro.
    $archivo = $dir . '/' . hash('sha256', $ip) . '.txt';
    $ahora   = time();

    $marcas = is_file($archivo)
        ? array_filter(array_map('intval', explode("\n", (string)@file_get_contents($archivo))))
        : [];

    $recientes = array_values(array_filter($marcas, fn(int $t): bool => $ahora - $t < 3600));

    if (count($recientes) >= MAX_POR_HORA) {
        return true;
    }

    $recientes[] = $ahora;
    @file_put_contents($archivo, implode("\n", $recientes), LOCK_EX);
    @chmod($archivo, 0600);

    // Limpieza ocasional para que la carpeta no crezca sin fin.
    if (random_int(1, 50) === 1) {
        foreach (glob($dir . '/*.txt') ?: [] as $viejo) {
            if (filemtime($viejo) < $ahora - 86400) {
                @unlink($viejo);
            }
        }
    }
    return false;
}

if (limiteSuperado($DIR_DATOS, ipCliente())) {
    responder(429, 'Has enviado varios mensajes seguidos. Prueba dentro de un rato.');
}

// ── Capa 4 · Validación en servidor ──────────────────────────────────
//
// Se repite entera. Lo que valida el navegador es una cortesía para el
// usuario, no una medida de seguridad: con curl se salta en un segundo.

function limpiar(string $clave, int $max): string {
    $valor = (string)($_POST[$clave] ?? '');
    // Se quitan los caracteres de control, que es como se inyectan
    // cabeceras extra en un correo.
    $valor = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $valor) ?? '';
    return mb_substr(trim($valor), 0, $max);
}

/**
 * Los checkbox llegan como array. Se limpia cada valor igual que un campo
 * de texto y se descarta lo que no esté en la lista blanca: un valor que
 * no salió de esta página no tiene por qué acabar en el correo.
 */
function limpiarLista(string $clave, array $permitidos, int $maxItems = 8): array {
    $crudo = $_POST[$clave] ?? [];
    if (!is_array($crudo)) { $crudo = [$crudo]; }
    $salida = [];
    foreach (array_slice($crudo, 0, $maxItems) as $v) {
        if (!is_string($v)) { continue; }
        $v = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', $v) ?? '');
        if ($v !== '' && in_array($v, $permitidos, true)) { $salida[] = $v; }
    }
    return array_values(array_unique($salida));
}

const PAQUETES    = ['Lote inicial', 'Producción mensual', 'Producción dedicada', 'Aún no sé'];
const PLATAFORMAS = ['Meta', 'TikTok', 'YouTube', 'Aún no pauto'];
// Se pregunta por la inversión en pauta del cliente, NO por lo que puede
// pagarle a Lienzos: califica igual de bien y no ancla el precio propio.
const INVERSIONES = [
    'Menos de USD 3.000 al mes',
    'USD 3.000 a 10.000 al mes',
    'USD 10.000 a 30.000 al mes',
    'Mas de USD 30.000 al mes',
    'Todavia no pautamos',
];
const VOLUMENES   = ['1 a 3 al mes', '4 a 8 al mes', '9 o mas al mes'];
const EQUIPOS     = ['Si, equipo propio', 'Parcial, con freelances', 'No'];
const PLAZOS      = ['Este mes', 'En 2 o 3 meses', 'Solo estoy explorando'];

$nombre      = limpiar('nombre', 100);
$email       = limpiar('email', 200);
$telefono    = limpiar('telefono', 40);
$marca       = limpiar('marca', 120);
$referencia  = limpiar('referencia', 500);
$mensaje     = limpiar('mensaje', 4000);
$plataformas = limpiarLista('plataformas', PLATAFORMAS);

// Identificador del envío, generado en el navegador. Es lo que permite que
// Meta una este aviso con el del píxel y cuente UNA conversión. Si no llega
// o viene con cualquier cosa, se descarta y no se manda nada: un id falso
// rompería la deduplicación, que es peor que no mandar.
$eventoId = limpiar('evento_id', 64);
if (!preg_match('/^[A-Za-z0-9._-]{8,64}$/', $eventoId)) { $eventoId = ''; }

// El paquete es un radio, no una lista: se valida contra su propia lista
// blanca igual que los select.
$paquete = limpiar('paquete', 40);
if ($paquete !== '' && !in_array($paquete, PAQUETES, true)) { $paquete = ''; }

// Los select se validan contra su lista: vacío es una opción legítima
// ("prefiero no decirlo"), pero un valor inventado no.
$inversion = limpiar('inversion', 60);
$volumen   = limpiar('volumen', 40);
$equipo    = limpiar('equipo_interno', 40);
$cuando    = limpiar('cuando', 60);
if ($inversion !== '' && !in_array($inversion, INVERSIONES, true)) { $inversion = ''; }
if ($volumen   !== '' && !in_array($volumen, VOLUMENES, true))     { $volumen = ''; }
if ($equipo    !== '' && !in_array($equipo, EQUIPOS, true))        { $equipo = ''; }
if ($cuando    !== '' && !in_array($cuando, PLAZOS, true))         { $cuando = ''; }

$errores = [];
if ($nombre === '')   { $errores[] = 'nombre vacío'; }
if ($telefono === '') { $errores[] = 'teléfono vacío'; }
if ($paquete === '')  { $errores[] = 'sin paquete seleccionado'; }
if ($mensaje === '')  { $errores[] = 'sin decir qué pauta'; }
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { $errores[] = 'email inválido'; }
if ($telefono !== '' && !preg_match('/^\+?[\d\s().-]{7,20}$/', $telefono)) {
    $errores[] = 'teléfono inválido';
}
// La autorización de datos (ley 1581) es obligatoria y se comprueba aquí
// también: sin ella no hay base legal para guardar el contacto.
if (($_POST['datos'] ?? '') === '') { $errores[] = 'sin autorización de datos'; }
// El enlace de referencia es opcional, pero si viene tiene que ser una URL
// http(s) de verdad — no un javascript: ni un data: colado en el correo.
if ($referencia !== '') {
    $esquema = strtolower((string)parse_url($referencia, PHP_URL_SCHEME));
    if (!filter_var($referencia, FILTER_VALIDATE_URL) || !in_array($esquema, ['http', 'https'], true)) {
        $errores[] = 'referencia inválida';
    }
}
// Un salto de línea en el nombre o el correo es intento de inyección de
// cabeceras. No hay caso legítimo.
if (preg_match('/[\r\n]/', $nombre . $email)) {
    fingirExito('intento de inyección de cabeceras');
}

if ($errores !== []) {
    responder(422, 'Revisa los datos e inténtalo otra vez.', 'validación: ' . implode(', ', $errores));
}

// ── Calificación ─────────────────────────────────────────────────────
// Mismo criterio que califica() en src/lib/formulario.ts. La web ya le
// enseñó a la persona el aviso "todavía no es el mejor momento"; aquí solo
// se marca el correo para poder filtrarlo. Ojo: el valor sale del
// formulario, así que sirve para ordenar la bandeja, no como control.
const INVERSIONES_QUE_NO_CALIFICAN = ['Menos de USD 3.000 al mes', 'Todavia no pautamos'];
$califica = !in_array($inversion, INVERSIONES_QUE_NO_CALIFICAN, true)
         && !($inversion === '' && $plataformas === ['Aún no pauto']);

// ── Conversions API de Meta ──────────────────────────────────────────
//
// Por qué existe: el píxel del navegador se pierde. Lo bloquean las
// extensiones, lo recorta Safari y no existe para quien no acepta cookies.
// Un lead que no llega a Meta es un lead del que la campaña no aprende.
//
// Este aviso sale del servidor, así que no depende del navegador. Lo que
// viaja es el correo y el teléfono convertidos en SHA-256 irreversible,
// nunca en claro. Meta no recibe el mensaje, ni el presupuesto, ni la
// marca: solo que esta persona completó una solicitud. Es la finalidad que
// se autoriza en la casilla del formulario.
//
// Y solo de quien califica: si la pauta aprende de los leads que no
// sirven, traerá más de los que no sirven.

/** SHA-256 normalizado como lo pide Meta: sin espacios y en minúsculas. */
function hashMeta(string $valor): string {
    $valor = trim($valor);
    $valor = function_exists('mb_strtolower') ? mb_strtolower($valor, 'UTF-8') : strtolower($valor);
    return hash('sha256', $valor);
}

/**
 * Teléfono a solo dígitos y con indicativo, que es el formato que Meta
 * empareja. Diez cifras que empiezan por 3 son un móvil colombiano sin
 * indicativo: se le antepone el 57.
 */
function telefonoMeta(string $tel): string {
    $digitos = preg_replace('/\D/', '', $tel) ?? '';
    if (strlen($digitos) === 10 && str_starts_with($digitos, '3')) {
        $digitos = '57' . $digitos;
    }
    return $digitos;
}

/**
 * Manda el Lead. No devuelve nada y no lanza: si Meta falla, el lead ya
 * está en la bandeja del cliente. Esto es telemetría, no puede tumbar el
 * formulario ni retrasar la respuesta más de unos segundos.
 */
function enviarConversionMeta(array $cfg, array $datos): void {
    if (!function_exists('curl_init')) {
        error_log('[capi] cURL no disponible; la conversión no se manda');
        return;
    }

    $nombre = function_exists('mb_strtolower')
        ? mb_strtolower(trim($datos['nombre']), 'UTF-8')
        : strtolower(trim($datos['nombre']));
    $partes   = preg_split('/\s+/', $nombre) ?: [];
    $pila     = (string)($partes[0] ?? '');
    $apellido = count($partes) > 1 ? (string)end($partes) : '';
    $telefono = telefonoMeta($datos['telefono']);

    $usuario = ['em' => [hashMeta($datos['email'])]];
    if ($telefono !== '') { $usuario['ph'] = [hash('sha256', $telefono)]; }
    if ($pila     !== '') { $usuario['fn'] = [hashMeta($pila)]; }
    if ($apellido !== '') { $usuario['ln'] = [hashMeta($apellido)]; }
    $usuario['client_ip_address'] = $datos['ip'];
    $usuario['client_user_agent'] = $datos['ua'];
    // Las cookies del píxel solo existen si aceptó cookies. Cuando están,
    // el emparejamiento mejora mucho; cuando no, se omiten y ya.
    if (!empty($_COOKIE['_fbp'])) { $usuario['fbp'] = substr((string)$_COOKIE['_fbp'], 0, 200); }
    if (!empty($_COOKIE['_fbc'])) { $usuario['fbc'] = substr((string)$_COOKIE['_fbc'], 0, 200); }

    $carga = [
        'data' => [[
            'event_name'       => 'Lead',
            'event_time'       => time(),
            'event_id'         => $datos['evento_id'],
            'event_source_url' => $datos['url'],
            'action_source'    => 'website',
            'user_data'        => $usuario,
            'custom_data'      => ['content_name' => $datos['paquete']],
        ]],
        'access_token' => $cfg['token'],
    ];
    if (($cfg['test_event_code'] ?? '') !== '') {
        $carga['test_event_code'] = $cfg['test_event_code'];
    }

    $ch = curl_init('https://graph.facebook.com/v21.0/' . rawurlencode((string)$cfg['pixel_id']) . '/events');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($carga, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_TIMEOUT        => 4,
    ]);
    $respuesta = curl_exec($ch);
    $codigo    = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $fallo     = curl_error($ch);
    curl_close($ch);

    // El token no se registra nunca, ni siquiera recortado.
    if ($codigo !== 200) {
        error_log('[capi] Meta respondió ' . $codigo . ' ' . substr((string)$respuesta, 0, 300)
                . ($fallo !== '' ? ' | curl: ' . $fallo : ''));
    }
}

// ── Capa 5 · Envío con salida escapada ───────────────────────────────

$sinDato = '(no indicado)';

$cuerpo = implode("\n", [
    'COTIZACIÓN DESDE LA WEB',
    $califica ? 'Califica: sí (la web lo llevó a WhatsApp)' : 'Califica: NO (vio el aviso "todavía no es el mejor momento")',
    '',
    'Nombre:         ' . $nombre,
    'Marca:          ' . ($marca !== '' ? $marca : $sinDato),
    'Correo:         ' . $email,
    'WhatsApp:       ' . $telefono,
    '',
    'Modalidad:      ' . $paquete,
    'Qué pauta:      ' . $mensaje,
    'Plataformas:    ' . ($plataformas !== [] ? implode(', ', $plataformas) : $sinDato),
    'Inversión/mes:  ' . ($inversion !== '' ? $inversion : $sinDato),
    'Anuncios/mes:   ' . ($volumen !== '' ? $volumen : $sinDato),
    'Equipo interno: ' . ($equipo !== '' ? $equipo : $sinDato),
    'Para cuándo:    ' . ($cuando !== '' ? $cuando : $sinDato),
    'Referencia:     ' . ($referencia !== '' ? $referencia : $sinDato),
    '',
    '---',
    'Responder por WhatsApp: https://wa.me/' . preg_replace('/\D/', '', $telefono),
    'Enviado: ' . date('Y-m-d H:i:s'),
    'Origen:  ' . ($_SERVER['HTTP_REFERER'] ?? 'desconocido'),
]);

// El asunto lleva el dato que decide si se abre ahora o después. Se limpia
// de saltos de línea aparte: en el asunto también se inyectan cabeceras.
$asunto = ($califica ? '' : '[No califica] ')
        . ASUNTO_BASE . ' · ' . $nombre . ' · ' . $paquete
        . ($inversion !== '' ? ' · pauta ' . $inversion : '');
$asunto = trim(preg_replace('/[\r\n]+/', ' ', $asunto) ?? ASUNTO_BASE);

// El From es del propio dominio: poner el correo del visitante hace que
// SPF y DKIM fallen y el mensaje acabe en spam. El Reply-To sí es suyo,
// que es lo que hace que responder funcione.
$dominio = preg_replace('/[^a-z0-9.\-]/i', '', $_SERVER['HTTP_HOST'] ?? 'localhost') ?: 'localhost';

$cabeceras = implode("\r\n", [
    'From: Formulario web <no-responder@' . $dominio . '>',
    'Reply-To: ' . $email,
    'Content-Type: text/plain; charset=UTF-8',
    'X-Mailer: PHP/' . phpversion(),
]);

$enviado = @mail(DESTINO, $asunto, $cuerpo, $cabeceras, '-f no-responder@' . $dominio);

if (!$enviado) {
    // Se guarda una copia para no perder el contacto si el correo falla.
    @file_put_contents(
        $DIR_DATOS . '/pendientes.log',
        date('c') . ' ' . json_encode(compact('nombre', 'email', 'telefono', 'mensaje'), JSON_UNESCAPED_UNICODE) . "\n",
        FILE_APPEND | LOCK_EX
    );
    responder(500, 'No he podido enviarlo. Escríbeme por WhatsApp y lo vemos.', 'mail() devolvió false');
}

// ── Conversión a Meta ────────────────────────────────────────────────
// Después del correo y nunca antes: si Meta está caído o tarda, el lead ya
// está a salvo en la bandeja del cliente.
if ($califica && $eventoId !== '') {
    $META = is_readable($RUTA_META) ? @include $RUTA_META : null;
    if (is_array($META) && ($META['token'] ?? '') !== '' && ($META['pixel_id'] ?? '') !== '') {
        $origen = (string)($_SERVER['HTTP_REFERER'] ?? '');
        if (!filter_var($origen, FILTER_VALIDATE_URL)) { $origen = 'https://' . $dominio . '/'; }
        enviarConversionMeta($META, [
            'evento_id' => $eventoId,
            'email'     => $email,
            'telefono'  => $telefono,
            'nombre'    => $nombre,
            'paquete'   => $paquete,
            'ip'        => ipCliente(),
            'ua'        => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 500),
            'url'       => $origen,
        ]);
    }
}

responder(200, 'Recibido');
