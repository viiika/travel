#!/usr/bin/env bash
# Downloads the Natural Earth source files into data/raw.
set -euo pipefail
B=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
mkdir -p data/raw
for f in ne_10m_admin_0_countries_usa ne_10m_admin_1_states_provinces ne_10m_populated_places_simple; do
  curl -fsSL -o "data/raw/$f.geojson" "$B/$f.geojson"
done
# Airports (OurAirports, public domain)
curl -fsSL -o data/raw/airports.csv https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv
