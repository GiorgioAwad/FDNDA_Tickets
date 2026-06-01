#!/usr/bin/env bash
# Stress test de COMPRA MASIVA contra el ORIGIN DIRECTO (bypass Cloudflare).
#
# Mide el camino real y no-cacheable de un on-sale: POST /api/orders
# (reserva atomica de stock). Usa N usuarios de prueba autenticados para
# esquivar el rate-limit de 10 ordenes/min por usuario.
#
# Bypassa CF con `curl --resolve dominio:443:IP_ORIGIN` (TLS/SNI siguen validos
# porque Caddy sirve el cert del dominio).
#
# Uso:
#   EVENT_ID=xxx TICKET_TYPE_ID=yyy N_USERS=300 ./run-purchase-stress.sh
#
# Variables:
#   ORIGIN_IP   (def 149.28.98.133)   HOST (def ticketingfdnda.pe)
#   N_USERS     (def 300)             PASSWORD (def StressTest123!)
#   LEVELS      (def "10 25 50 75 100")  ORDERS_PER_LEVEL (def 200)
set -u

ORIGIN_IP="${ORIGIN_IP:-149.28.98.133}"
HOST="${HOST:-ticketingfdnda.pe}"
BASE="https://${HOST}"
RESOLVE="${HOST}:443:${ORIGIN_IP}"
N_USERS="${N_USERS:-300}"
PASSWORD="${PASSWORD:-StressTest123!}"
LEVELS="${LEVELS:-10 25 50 75 100}"
ORDERS_PER_LEVEL="${ORDERS_PER_LEVEL:-200}"
EVENT_ID="${EVENT_ID:?Falta EVENT_ID}"
TICKET_TYPE_ID="${TICKET_TYPE_ID:?Falta TICKET_TYPE_ID}"

JARDIR="$(mktemp -d)"
RESDIR="$(mktemp -d)"
trap 'rm -rf "$JARDIR" "$RESDIR"' EXIT

CURLB=(curl -s --resolve "$RESOLVE" --max-time 40)

order_body() {
  cat <<JSON
{"eventId":"$EVENT_ID","items":[{"ticketTypeId":"$TICKET_TYPE_ID","quantity":1}],"billing":{"documentType":"BOLETA","buyerDocNumber":"12345678","buyerName":"Stress Tester","buyerFirstName":"Stress","buyerLastNamePaternal":"Test","buyerLastNameMaternal":"Carga","buyerAddress":"Calle Falsa 123","buyerEmail":"stress@loadtest.local","buyerPhone":"987654321","buyerUbigeo":"150101"}}
JSON
}

login() {
  local i="$1"; local email="stress+${i}@loadtest.local"; local jar="$JARDIR/u$i.jar"
  local csrf
  csrf=$("${CURLB[@]}" -c "$jar" "$BASE/api/auth/csrf" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')
  [ -z "$csrf" ] && return 1
  "${CURLB[@]}" -b "$jar" -c "$jar" -o /dev/null \
    --data-urlencode "csrfToken=$csrf" --data-urlencode "email=$email" \
    --data-urlencode "password=$PASSWORD" --data-urlencode "callbackUrl=$BASE/" \
    "$BASE/api/auth/callback/credentials"
  "${CURLB[@]}" -b "$jar" "$BASE/api/auth/session" | grep -q '"user"' || return 1
  return 0
}
export -f login order_body
export JARDIR BASE RESOLVE PASSWORD EVENT_ID TICKET_TYPE_ID

echo "=== FASE 1: login de $N_USERS usuarios (origin-directo, no medido) ==="
seq 0 $((N_USERS-1)) | xargs -P 30 -I{} bash -c 'login "$@" && echo ok || echo FAIL{}' _ {} \
  | sort | uniq -c
OKJARS=$(ls "$JARDIR"/*.jar 2>/dev/null | wc -l)
echo "cookie jars validos: $OKJARS / $N_USERS"
[ "$OKJARS" -lt 1 ] && { echo "ABORT: ningun login funciono"; exit 1; }

# una orden (toma indice de usuario, registra 'codigo tiempo')
oneorder() {
  local i="$1"; local jar="$JARDIR/u$((i % N_USERS)).jar"
  [ -f "$jar" ] || jar="$(ls "$JARDIR"/*.jar | head -1)"
  order_body | "${CURLB[@]}" -b "$jar" -H "Content-Type: application/json" \
    -o /dev/null -w "%{http_code} %{time_total}\n" -d @- "$BASE/api/orders"
}
export -f oneorder
export N_USERS

run_level() {
  local C="$1"; local TOTAL="$2"; local out="$RESDIR/lvl$C.txt"
  local t0 t1
  t0=$(date +%s.%N)
  seq 1 "$TOTAL" | xargs -P "$C" -I{} bash -c 'oneorder {}' > "$out"
  t1=$(date +%s.%N)
  local wall; wall=$(awk "BEGIN{print $t1-$t0}")
  local ok; ok=$(grep -c '^200' "$out")
  local rl; rl=$(grep -c '^429' "$out")
  local e4; e4=$(grep -cE '^4(0|1)' "$out")
  local e5; e5=$(grep -cE '^5|^000' "$out")
  local rps; rps=$(awk "BEGIN{printf \"%.1f\", $ok/$wall}")
  local p=$(awk '{print $2}' "$out" | sort -n)
  local n=$(echo "$p" | wc -l)
  local p50 p95
  p50=$(echo "$p" | sed -n "$((n/2>0?n/2:1))p")
  p95=$(echo "$p" | sed -n "$((n*95/100>0?n*95/100:1))p")
  printf "conc=%-4s total=%-4s wall=%5.1fs  OK=%-4s 429=%-3s 4xx=%-3s 5xx/err=%-3s  throughput=%5s ord/s  p50=%ss p95=%ss\n" \
    "$C" "$TOTAL" "$wall" "$ok" "$rl" "$e4" "$e5" "$rps" "$p50" "$p95"
}

echo
echo "=== FASE 2: rampa de POST /api/orders (origin-directo) ==="
for C in $LEVELS; do
  run_level "$C" "$ORDERS_PER_LEVEL"
done
echo
echo "Nota: 429 = rate-limit por usuario (subir N_USERS si aparece mucho)."
echo "      'agotado' como 4xx = se acabo el stock (subir STRESS_STOCK en el seed)."
