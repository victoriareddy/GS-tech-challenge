#!/usr/bin/env bash
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required."
  exit 1
fi

today="$(date +%F)"
if date -v-30d +%F >/dev/null 2>&1; then
  thirty_days_ago="$(date -v-30d +%F)"
  sixty_days_ago="$(date -v-60d +%F)"
else
  thirty_days_ago="$(date -d '30 days ago' +%F)"
  sixty_days_ago="$(date -d '60 days ago' +%F)"
fi

declare -a endpoints=(
  "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=${thirty_days_ago}&coed=${today}"
  "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=${sixty_days_ago}&coed=${today}"
  "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10"
)

if [[ -n "${FRED_API_KEY:-}" ]]; then
  endpoints+=("https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&sort_order=desc&limit=10&file_type=json&api_key=${FRED_API_KEY}")
fi

echo "Running FRED diagnostics at $(date)"

for endpoint in "${endpoints[@]}"; do
  echo
  echo "=== ${endpoint}"
  for ip_mode in "-4" "-6"; do
    echo "mode=${ip_mode}"
    headers_file="$(mktemp)"
    body_file="$(mktemp)"

    set +e
    curl ${ip_mode} --http1.1 -L --silent --show-error \
      --connect-timeout 10 --max-time 25 \
      -A "Mozilla/5.0" \
      -H "Accept: text/csv,*/*;q=0.9" \
      -D "${headers_file}" -o "${body_file}" \
      "${endpoint}"
    curl_exit=$?
    set -e

    if [[ ${curl_exit} -ne 0 ]]; then
      echo "curl failed with exit ${curl_exit}"
      rm -f "${headers_file}" "${body_file}"
      continue
    fi

    status_code="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "${headers_file}")"
    bytes_count="$(wc -c < "${body_file}" | tr -d ' ')"
    echo "status=${status_code} bytes=${bytes_count}"
    echo "-- first 3 lines --"
    sed -n '1,3p' "${body_file}"
    echo "-- last 3 lines --"
    tail -n 3 "${body_file}"

    rm -f "${headers_file}" "${body_file}"
  done
done
