# QR corto para Zebra DS2278

Los QR generados ahora contienen `FQ1` y 40 caracteres hexadecimales en mayúsculas:
43 caracteres en total, frente a unos 300 del JSON anterior. No hay llaves,
comillas ni otros signos que dependan del teclado de Windows.

## Funcionamiento

- El token es una credencial opaca de 160 bits derivada con HMAC-SHA256 y
  `QR_SECRET`, con un contexto específico para esta versión.
- La tabla `ticket_qr_tokens` guarda el hash SHA256 del token y el JSON firmado
  original. Nunca se guarda el token en claro.
- El contexto incluye entrada, evento, usuario, código, fecha y turno. Se
  reutiliza el mismo token al actualizar una entrada para la misma fecha y turno,
  aunque cambie el nonce del JSON. Fechas o turnos distintos tienen tokens distintos.
- El validador resuelve el token, verifica la firma original y su vínculo con el
  token, y ejecuta las reglas existentes de ingreso. No se usa el endpoint manual.
- Los QR antiguos siguen entrando por la validación de JSON firmado (v1 y v2).
- PNG y SVG usan el nuevo formato; la página de entradas y los carnets que
  obtienen su QR desde la API de tickets lo reciben al generarse de nuevo.
- Las lecturas parciales se conservan durante las pausas del lector, con un
  límite de espera. Enter entrega la lectura inmediatamente; sin Enter se
  mantiene el cierre por inactividad de 180 ms.
- Un token desconocido o mal formado se rechaza. No se convierte a código manual.

## Activación

1. Mantener el `QR_SECRET` actual del entorno. La emisión corta exige un secreto
   configurado y rechaza el valor de ejemplo.
2. Aplicar la migración aditiva `20260910120000_short_qr_tokens` antes de arrancar
   la nueva versión, usando el procedimiento de despliegue del proyecto
   (`npx prisma migrate deploy` en el entorno de destino).
3. Desplegar el servidor y el cliente de esta versión. Recargar las páginas de
   escaneo abiertas en las laptops y celulares.
4. Abrir o regenerar una entrada y escanear su QR nuevo. Los impresos antiguos
   conservan su contenido largo: hay que reimprimirlos si se desea acortarlos.

Esta implementación no aplica migraciones ni despliega automáticamente.
La tabla de tokens forma parte de los datos que se deben conservar en las copias
de seguridad. No borrar sus filas mientras se necesiten esos QR.
Cambiar `QR_SECRET` invalida credenciales; no rotarlo como parte de esta activación.

## Verificación

Pruebas automatizadas cubren PNG real decodificado, SVG, referencia estable,
manipulación, contexto alterado, compatibilidad de firmas antiguas, pausas HID,
ingreso válido, segundo ingreso rechazado, cancelación, evento incorrecto,
fecha de piscina, autorización y límite de escaneos. Los servicios externos se
simulan en las pruebas integradas: no se consumen entradas reales.

La comprobación operativa pendiente es medir con el Zebra físico un QR nuevo
en Bloc de notas y en la página de escaneo. Deben aparecer 43 caracteres y Enter.
La reducción de caracteres no implica la misma reducción del tiempo total:
resolver el token añade una consulta indexada a la base de datos antes de las
validaciones habituales. Mantener inicialmente la configuración actual del
lector; los modos rápidos habían perdido caracteres en las pruebas anteriores.
