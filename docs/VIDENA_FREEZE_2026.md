# Congelamiento de Videna: noviembre y diciembre de 2026

La base de producción ya tiene el cierre del evento `cmqtpjkzl003g01qex3xwhgfl`
desde el 1 de noviembre de 2026 hasta antes del 1 de enero de 2027 y una
extensión de dos meses. Los tickets y los congelamientos individuales se
conservan. Un congelamiento individual de noviembre se cuenta dentro del
cierre general; no añade un tercer mes. Las membresías que empiezan después
del cierre, o que ya habían vencido antes, no reciben esta extensión.

Enero de 2027 se habilita excepcionalmente para este evento mediante
`membershipBlackoutExceptions`. Esto no reduce las fechas de vencimiento que
ya compensaban enero y febrero. Febrero y otros eventos mantienen sus reglas.

## Despliegue en el VPS

Usar las imágenes `app` y `tools` del mismo commit publicado por el workflow
`Publish Docker Images`. Con los nombres de imagen configurados en el entorno
del VPS, ejecutar desde la carpeta del proyecto:

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production pull app worker migrate
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate
docker compose -f docker-compose.prod.yml --env-file .env.production up -d app worker
docker exec fdnda_app wget -qO- http://127.0.0.1:3000/api/health
```

La primera migración admite las columnas de cierre ya creadas manualmente. La
segunda añade las excepciones mensuales y habilita `2027-01` únicamente si el
evento de Videna mantiene el cierre aprobado. Aplicar las migraciones antes de
reiniciar la aplicación: el nuevo cliente Prisma consulta la nueva columna.

## Verificación

- En el detalle de una membresía vigente debe aparecer el cierre de noviembre
  y diciembre y el vencimiento extendido.
- Una membresía que ya congeló noviembre recibe solo un mes adicional respecto
  de su vencimiento anterior; las demás reciben dos.
- Las dos membresías con inicio en 2027 conservan su vencimiento original y no
  muestran este cierre como un congelamiento propio.
- El escáner y el carnet deben bloquear el acceso en noviembre y diciembre.
- En una prueba con fecha controlada, el 1 de enero de 2027 permite acceso sujeto
  al horario y al cupo habituales; febrero permanece restringido.
- No registrar asistencias reales para probar fechas futuras.
