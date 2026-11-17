# Asociaciones ABIO de la preventa de verano 2027

Evento: `preventa-verano-2027-academia-fdnda` (Campo de Marte). Un solo plan por S/ 640 en total, enero y febrero de 2027, lunes/miércoles/viernes.

- Empresa: `001`.
- Sucursal: `01`, Campo de Marte.
- Indicador: `AC`.
- Servicio: `K14`, **PREVENTA 1 2027 - 3 VECES X SEMANA**.
- Disciplina: `00`, NATACION.
- Piscina: `01`, la misma de las membresías de natación de esta sede.
- Inicio del servicio: `2027-01-01`; periodo ABIO `2027`, mes `01`.

| Horario | Categoría | Código horario ABIO | Cupos |
| --- | --- | --- | --- |
| 06:00–07:00 | Adultos (18 años a más) | `000001` | 6 |
| 07:00–08:00 | Adultos (18 años a más) | `000002` | 6 |
| 08:00–09:00 | Niños (6 a 17 años) | `000003` | 6 |
| 09:00–10:00 | Niños (6 a 17 años) | `000004` | 6 |
| 10:00–11:00 | Niños (6 a 17 años) | `000005` | 7 |
| 11:00–12:00 | Niños (6 a 17 años) | `000006` | 7 |
| 12:00–13:00 | Niños (6 a 17 años) | `000007` | 6 |
| 13:00–14:00 | Niños (6 a 17 años) | `000008` | 8 |
| 14:00–15:00 | Niños (6 a 17 años) | `000009` | 8 |
| 15:00–16:00 | Niños (6 a 17 años) | `000010` | 8 |
| 16:00–17:00 | Niños (6 a 17 años) | `000011` | 7 |
| 17:00–18:00 | Niños (6 a 17 años) | `000012` | 7 |
| 18:00–19:00 | Niños (6 a 17 años) | `000013` | 6 |
| 19:00–20:00 | Adultos (18 años a más) | `000077` | 6 |
| 20:00–21:00 | Adultos (18 años a más) | `000148` | 6 |

Total: **100 cupos**. Cada código fue contrastado con el catálogo activo de ABIO para natación y con los días exactos lunes/miércoles/viernes. Cuando el catálogo ofrece varios códigos para la misma franja, se usa la serie estándar de horarios indicada en la tabla.

Las 15 asociaciones se guardan en `abio_catalog_bindings`. Como el comprador elige la hora dentro de un solo plan, la entrada guarda además el mapa en `servilexExtraConfig.membershipSchedules`; el servidor resuelve el código por alumno al construir el comprobante. Una compra familiar puede incluir alumnos con horas distintas y conserva un código distinto para cada uno.

La entrada no tiene un único `servilexScheduleCode` ni `servilexBindingId`: ambos quedan vacíos porque dependen del horario comprado. Si falta una asociación, el servidor rechaza la compra antes del pago y no usa otro horario como respaldo.

## Aplicación y despliegue

La configuración se verifica con:

```bash
node node_modules/tsx/dist/cli.mjs scripts/configure-summer-abio-2027.ts
```

`--apply` guarda las asociaciones en una transacción y crea una copia de la configuración anterior en `tmp/summer-abio-before-<timestamp>.json`. El script usa `.env.production`, exige que el evento siga en borrador y no tenga compras y verifica cada código contra el catálogo antes de modificar datos.

Despliega el código actualizado tanto en la web como en el worker antes de publicar la preventa. No requiere migraciones. La validación de los comprobantes se hizo con payloads de prueba locales; no se enviaron comprobantes ni se hicieron cobros reales a ABIO.
