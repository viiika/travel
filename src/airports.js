import airportRows from "../data/build/airports.json";

// Airports with IATA codes (OurAirports), used to place imported flights on the map.
export const airports = new Map(
  airportRows.map(([iata, name, city, cc, lon, lat, large]) => [iata, { iata, name, city, cc, lon, lat, large: !!large }])
);
