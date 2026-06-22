export interface AreaStats {
  rate: number;
  occupancy: number;
  listings: number;
  revenue: number;
  lat: number;
  lng: number;
}

export const AREA_DATA: Record<string, AreaStats> = {
  Limassol:             { rate: 142, occupancy: 74, listings: 521, revenue: 3210, lat: 34.6786, lng: 33.0413 },
  Paphos:               { rate: 118, occupancy: 68, listings: 389, revenue: 2540, lat: 34.7754, lng: 32.4217 },
  "Ayia Napa":          { rate: 165, occupancy: 81, listings: 287, revenue: 4010, lat: 34.9919, lng: 34.0000 },
  Protaras:             { rate: 158, occupancy: 79, listings: 203, revenue: 3780, lat: 35.0119, lng: 34.0559 },
  Larnaca:              { rate: 94,  occupancy: 63, listings: 312, revenue: 1890, lat: 34.9229, lng: 33.6233 },
  Nicosia:              { rate: 78,  occupancy: 55, listings: 198, revenue: 1360, lat: 35.1856, lng: 33.3823 },
  Polis:                { rate: 105, occupancy: 66, listings: 87,  revenue: 2200, lat: 35.0365, lng: 32.4257 },
  Latchi:               { rate: 112, occupancy: 70, listings: 63,  revenue: 2490, lat: 35.0456, lng: 32.3905 },
  Pissouri:             { rate: 131, occupancy: 72, listings: 45,  revenue: 2990, lat: 34.6670, lng: 32.7060 },
  Troodos:              { rate: 88,  occupancy: 58, listings: 72,  revenue: 1620, lat: 34.9198, lng: 32.8785 },
  Kokkinochoria:        { rate: 97,  occupancy: 64, listings: 118, revenue: 1970, lat: 34.9666, lng: 33.8025 },
  "Famagusta District": { rate: 109, occupancy: 67, listings: 156, revenue: 2310, lat: 35.0346, lng: 33.9753 },
};

export const AREAS = Object.keys(AREA_DATA);
