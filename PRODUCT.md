# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

El equipo administrativo de FDNDA opera ventas, membresías, horarios, cupos, asistencia y eventos desde un panel interno. En los cambios de horario necesita ubicar a una persona concreta y corregir su asignación sin alterar las condiciones económicas de su compra.

## Product Purpose

La plataforma publica eventos y academias, vende entradas o membresías y mantiene el acceso asociado a cada asistente. El panel administrativo permite corregir datos operativos manteniendo consistentes el carnet, la orden, el inventario y el historial.

## Operating Context

En Academia VMT cada combinación de días y hora es un tipo de entrada distinto. Cambiar el horario de un asistente implica mover su carnet al tipo de entrada destino, liberar el cupo de origen y ocupar el cupo de destino dentro de una sola operación.

## Capabilities and Constraints

- Los cambios se hacen por asistente y pueden modificar la hora o los días dentro de las alternativas equivalentes a la frecuencia comprada.
- Un destino equivalente conserva precio, duración, cantidad de clases, modalidad y plan aplicable.
- El panel debe mostrar ocupación, cupo y disponibilidad antes de confirmar.
- Un administrador puede autorizar un sobrecupo como excepción explícita; requiere motivo y debe quedar en el historial.
- El cambio mantiene sincronizados el carnet, el item de la orden y los contadores de vendidos.
- Las compras familiares o estados inconsistentes que no permiten identificar un único item continúan bloqueadas para revisión manual.

## Brand Commitments

Se conserva la identidad FDNDA y el lenguaje visual existente del panel: azul institucional, acentos coral y aqua, componentes administrativos claros y redacción directa en español.

## Evidence on Hand

- Panel administrativo y sistema visual existentes en `src/app/admin`, `src/components/admin` y `src/app/globals.css`.
- Flujo transaccional e historial de cambios en `src/lib/membership-transfer.ts` y `src/lib/membership-change-apply.ts`.
- Casos operativos anteriores documentados en `scripts/change-academia-schedule.ts` y scripts específicos de Academia VMT.

## Product Principles

- Proteger primero la compra original y su frecuencia.
- Mostrar capacidad real antes de tomar una decisión.
- Hacer visibles y auditables todas las excepciones.
- Aplicar correcciones de forma atómica: todo cambia o nada cambia.
- Llevar las operaciones frecuentes al panel y reservar los scripts para anomalías.
