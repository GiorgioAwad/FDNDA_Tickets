# Izipay IPN + Query Checklist

Estado actual en este repo:

- IPN/Webhook implementado en `src/app/api/payments/izipay/webhook/route.ts`
- Consulta `search_transaction` implementada en `src/lib/izipay.ts`
- Reconciliacion de pagos implementada en `src/lib/izipay-reconciliation.ts`
- Endpoint interno de consulta de estado expuesto en `src/app/api/payments/izipay/status/route.ts`
- Compatibilidad TLS 1.2 declarada en `Caddyfile`

## 1. Endpoint publico del IPN

URL esperada:

`https://ticketingfdnda.pe/api/payments/izipay/webhook`

Validaciones ya resueltas en codigo:

- No requiere login
- No pasa por la capa de proteccion de `src/proxy.ts` porque `/api/*` esta excluido
- Valida firma
- Usa locks distribuidos para evitar dobles confirmaciones
- Soporta `embedded IPN`, `web core notification` y `redirect webhook`

Prueba rapida:

```bash
curl -i https://ticketingfdnda.pe/api/payments/izipay/webhook
```

Respuesta esperada: `200 OK`

## 2. TLS

Se dejo Caddy con:

- minimo `tls1.2`
- maximo `tls1.3`

Esto es lo correcto para compatibilidad con Izipay:

- un cliente que solo soporta TLS 1.2 puede conectar
- no se degrada todo el sitio a TLS 1.2

Pruebas recomendadas:

```bash
openssl s_client -connect ticketingfdnda.pe:443 -tls1_2
openssl s_client -connect ticketingfdnda.pe:443 -tls1_3
```

Ambas deben negociar correctamente.

## 3. Firewall / allowlist

Este punto no se resuelve desde el repo. Debe revisarse en:

- Firewall del VPS
- Cloud Firewall de Vultr
- WAF o proxy adicional si existe

Regla requerida:

- permitir trafico HTTPS entrante al dominio
- no poner allowlist restrictiva que bloquee a Izipay

Nota importante:

Si Izipay te dio literalmente `192.168.110.51` y `192.168.110.52`, esas son IPs privadas RFC1918 y no enrutan por Internet publica. Si la notificacion va a llegar desde Internet a `ticketingfdnda.pe`, debes pedir confirmacion escrita de las IPs publicas reales o confirmar si existe una VPN/canal privado.

## 4. Variables requeridas para API de consultas

La consulta `search_transaction` usa:

- `IZIPAY_API_KEY`
- `IZIPAY_HASH_KEY`
- `IZIPAY_MERCHANT_CODE`
- `IZIPAY_ENDPOINT` o `IZIPAY_SEARCH_TRANSACTION_URL` / `IZIPAY_TOKEN_GENERATE_URL`
- `IZIPAY_QUERY_LANGUAGE` opcional
- `IZIPAY_QUERY_AUTH_SCHEME` opcional (vacio = token crudo en `Authorization`; `bearer` = prefijo `Bearer `)

### 4.1 Flujo de autenticacion (corregido 2026-06-10)

La API de consultas NO acepta el API key directo en `Authorization` (eso devolvia
HTTP 500). El flujo correcto, confirmado contra la spec oficial
(`https://developers.izipay.pe/yaml/api-v1-esp.yaml`):

1. `POST {IZIPAY_ENDPOINT}/security/v1/Token/Generate`
   - Header `transactionId`: id unico por consulta (5-40 chars). El MISMO id se
     reutiliza en el paso 2.
   - Body: `requestSource: "ECOMMERCE"`, `merchantCode`, `orderNumber`
     (= providerOrderNumber de la orden), `publicKey` (= `IZIPAY_API_KEY`,
     "Clave API Nuevo Boton de Pagos"), `amount: "0.00"` (valor que indica
     Izipay para operaciones que no son de pago).
   - Respuesta: `response.token` (vigencia 15 min, un solo uso).
2. `POST {IZIPAY_ENDPOINT}/orderinfo/v1/Transaction/Search`
   - Headers: `Authorization: <token crudo>` (sin `Bearer`, segun codigo de
     error P02 de Izipay; configurable con `IZIPAY_QUERY_AUTH_SCHEME=bearer`),
     `transactionId: <el mismo del paso 1>`.
   - Body: `{ "merchantCode": "...", "numberOrden": "<orderNumber>", "language": "ESP" }`.

cURL de referencia (los que pidio soporte Izipay):

```bash
TXN="$(date +%s%6N)"   # id unico de la consulta

TOKEN=$(curl -s -X POST "https://api-pw.izipay.pe/security/v1/Token/Generate" \
  -H "Content-Type: application/json" \
  -H "transactionId: ${TXN}" \
  -d '{
    "requestSource": "ECOMMERCE",
    "merchantCode": "4081197",
    "orderNumber": "00001k228pz1eb8",
    "publicKey": "<IZIPAY_API_KEY>",
    "amount": "0.00"
  }' | jq -r '.response.token')

curl -s -X POST "https://api-pw.izipay.pe/orderinfo/v1/Transaction/Search" \
  -H "Content-Type: application/json" \
  -H "Authorization: ${TOKEN}" \
  -H "transactionId: ${TXN}" \
  -d '{
    "merchantCode": "4081197",
    "numberOrden": "00001k228pz1eb8",
    "language": "ESP"
  }'
```

### 4.2 Estado al 2026-06-10

Con el token de sesion la autenticacion ya pasa (no mas HTTP 500), pero la
consulta devuelve `403` con `code: "MC"` / "Transaccion No Existe" incluso para
ordenes aprobadas (probado con `00001k228pz1eb8`, aprobada el 2026-06-10,
codeAuth 533258, uniqueId 0610165428770653, y con una orden del 2026-06-07).
Reportado a Izipay: falta que habiliten/expliquen la visibilidad de las
transacciones Web Core en `orderinfo` para el comercio 4081197. El
reconciliador reintenta y marca `paymentNeedsReview` tras 6 intentos, igual
que antes; en cuanto Izipay habilite la consulta, el auto-heal queda operativo
sin mas cambios.

Prueba de solo lectura (dentro del contenedor o local con env de prod):

```bash
npx tsx --tsconfig tsconfig.json scripts/izipay-query-check.ts <ORDEN|CODIGO>
```

## 5. Flujo de fallback ya implementado

Orden recomendado:

1. Izipay intenta confirmar por webhook/IPN
2. Si el webhook no llega o llega tarde, la web consulta `/api/payments/izipay/status`
3. El backend llama `search_transaction`
4. Si el pago esta confirmado, la orden se regulariza

## 6. Pruebas de produccion

Checklist minimo:

1. Crear una orden real o sandbox en Izipay
2. Confirmar que `urlIPN` apunte a `/api/payments/izipay/webhook`
3. Verificar que la orden pase a `PAID` por webhook
4. Simular ausencia de webhook y validar recuperacion por consulta
5. Revisar logs de `app` y `worker`
6. Verificar que no se duplique la orden al reenviar la misma notificacion

Comandos utiles en VPS:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs app --tail 100 -f
docker compose -f docker-compose.prod.yml --env-file .env.production logs worker --tail 100 -f
curl -s https://ticketingfdnda.pe/api/health
curl -i https://ticketingfdnda.pe/api/payments/izipay/webhook
```
