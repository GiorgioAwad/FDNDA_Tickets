# Documentos de registro y comprobante

El registro (página y modal) y los checkouts de entradas y merch permiten elegir DNI, RUC, carnet de extranjería y pasaporte. La factura requiere RUC; C.E. y PAS se permiten únicamente en boleta. La selección se conserva en el carrito, en la orden y en el perfil de comprobante cuando el usuario marca «recordar mis datos».

Los códigos siguen `cabecera.entidad.tipoDocumento`, sección 4.5.3, página 5 de **FPDN - SX002088 - API Documentación-3.pdf**: `1` DNI, `6` RUC, `4` C.E. y `7` PAS. El número se guarda como texto para conservar ceros iniciales y letras del pasaporte. Se mantiene el campo histórico `User.dni` como número de documento; `User.identityDocType` identifica su tipo.

Validación compartida entre formularios y servidor:

| Documento | Formato |
| --- | --- |
| DNI | 8 dígitos |
| RUC | 11 dígitos |
| C.E. | 9 a 12 dígitos |
| PAS | 8 a 12 letras o números, sin espacios ni guiones |

ABIO admite hasta 15 caracteres en el número de la entidad. Estos formularios usan los límites compatibles con la pasarela Izipay ya integrada (`src/lib/izipay-config.ts`) para que un documento aceptado pueda completar el pago. El tipo explícito prevalece sobre inferencias por longitud: un pasaporte numérico de 8 caracteres sigue siendo PAS.

El bloque `cabecera.alumno` de Academia conserva sus reglas existentes: la sección 4.5.4, página 6 del PDF, especifica DNI de 8 dígitos para el alumno. La incorporación de C.E. y PAS corresponde al registro y al comprador del comprobante.

## Despliegue

Aplicar la migración antes de activar la nueva versión:

```sh
npx prisma migrate deploy
npx prisma generate
```

`20261005120000_add_identity_document_types` añade `users.identityDocType` y `user_billing_profiles.buyerDocType`. Los usuarios existentes conservan DNI y los perfiles existentes de factura se inicializan con RUC. Las órdenes anteriores no se modifican.
