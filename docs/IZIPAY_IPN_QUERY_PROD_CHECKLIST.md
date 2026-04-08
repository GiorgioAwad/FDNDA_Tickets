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
- `IZIPAY_ENDPOINT` o `IZIPAY_SEARCH_TRANSACTION_URL`
- `IZIPAY_QUERY_LANGUAGE` opcional

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
