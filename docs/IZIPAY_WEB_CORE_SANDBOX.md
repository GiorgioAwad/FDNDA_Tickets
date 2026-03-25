# Izipay Web Core Sandbox

Integracion nativa para el checkout web usando el SDK oficial de Izipay Web Core.

## Variables obligatorias

Coloca estas variables en tu `.env` para sandbox:

```env
PAYMENTS_MODE="izipay"
NEXT_PUBLIC_PAYMENTS_MODE="izipay"

IZIPAY_MERCHANT_CODE="..."
IZIPAY_API_KEY="..."
IZIPAY_HASH_KEY="..."
IZIPAY_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
IZIPAY_ENDPOINT="https://sandbox-api.izipay.pe"
NEXT_PUBLIC_IZIPAY_SCRIPT_URL="https://sandbox-checkout.izipay.pe/payments/v1/js/index.js"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

## Que entrega Izipay

Debes tomar estas credenciales desde el Back Office / panel de desarrolladores de Izipay:

- `IZIPAY_MERCHANT_CODE`: codigo de comercio.
- `IZIPAY_API_KEY`: clave API del nuevo boton de pagos.
- `IZIPAY_HASH_KEY`: clave Hash para firma HMAC-SHA256.
- `IZIPAY_PUBLIC_KEY`: `keyRSA` o llave publica mostrada en el panel.

## Variables heredadas

Estas variables quedaron por compatibilidad con una integracion anterior y no son necesarias para el flujo Web Core pop-up:

- `IZIPAY_MODE`
- `NEXT_PUBLIC_IZIPAY_MODE`
- `NEXT_PUBLIC_IZIPAY_PUBLIC_KEY`
- `IZIPAY_CHECKOUT_URL`
- `IZIPAY_EMBEDDED_USERNAME`
- `IZIPAY_EMBEDDED_PASSWORD`
- `IZIPAY_HMAC_SHA256_KEY`
- `IZIPAY_EMBEDDED_ENDPOINT`

## Flujo implementado

1. El frontend crea la orden local.
2. `/api/payments/izipay/session` pide el token de sesion y arma el `config` del SDK.
3. El checkout carga el SDK oficial de Izipay y abre el `pop-up`.
4. El callback del SDK se valida en `/api/payments/izipay/validate`.
5. Izipay puede confirmar el resultado final en `/api/payments/izipay/webhook`.

## Validacion de firma

La respuesta del SDK y la notificacion usan `payloadHttp` + `signature`. La firma se valida con HMAC-SHA256 en base64 usando `IZIPAY_HASH_KEY`.

## Antes de probar

- Verifica que `NEXT_PUBLIC_APP_URL` sea accesible desde el sandbox si vas a usar webhook.
- Si estabas en OpenPay, cambia `PAYMENTS_MODE` y `NEXT_PUBLIC_PAYMENTS_MODE` a `izipay`.
- Reinicia el servidor despues de editar el `.env`.
