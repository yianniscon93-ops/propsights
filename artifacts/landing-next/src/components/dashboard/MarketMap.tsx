"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { OccMetric, OccWindow, PointRow, PolygonCoords } from "@/lib/dashboard/types";
import { occOf } from "@/lib/dashboard/types";
import { occupancyColor } from "@/lib/dashboard/format";

const CYPRUS_CENTER: [number, number] = [34.98, 33.25];
const CYPRUS_ZOOM = 9;

function radiusForZoom(z: number): number {
  return z >= 13 ? 5 : z >= 11 ? 3.5 : 2.4;
}

/**
 * All listings as canvas-rendered dots (up to ~15k). Imperative Leaflet
 * layer — a React element per dot would be far too slow.
 */
function PointsLayer({
  points,
  metric,
  window_,
  drawing,
  onHover,
  onPick,
}: {
  points: PointRow[];
  metric: OccMetric;
  window_: OccWindow;
  drawing: boolean;
  onHover: (id: string | null) => void;
  onPick: (id: string) => void;
}) {
  const map = useMap();
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;

  useEffect(() => {
    const renderer = L.canvas({ padding: 0.3 });
    const group = L.layerGroup();
    const markers: L.CircleMarker[] = [];
    const baseRadius = radiusForZoom(map.getZoom());

    for (const p of points) {
      const m = L.circleMarker([p.lat, p.lng], {
        renderer,
        radius: baseRadius,
        weight: 0.7,
        color: "#FFFFFF",
        fillColor: occupancyColor(occOf(p, metric, window_)),
        fillOpacity: 0.85,
      });
      m.on("mouseover", () => {
        if (drawingRef.current) return;
        m.setStyle({ weight: 2, color: "#1F2A16" });
        onHover(p.id);
      });
      m.on("mouseout", () => {
        m.setStyle({ weight: 0.7, color: "#FFFFFF" });
        onHover(null);
      });
      m.on("click", (e) => {
        if (drawingRef.current) return;
        L.DomEvent.stopPropagation(e);
        onPick(p.id);
      });
      group.addLayer(m);
      markers.push(m);
    }

    const onZoom = () => {
      const r = radiusForZoom(map.getZoom());
      for (const m of markers) m.setRadius(r);
    };
    map.on("zoomend", onZoom);
    group.addTo(map);
    return () => {
      map.off("zoomend", onZoom);
      group.remove();
    };
  }, [map, points, metric, window_, onHover, onPick]);

  return null;
}

/** Click-to-add-vertex polygon drawing, styled like the hero draw overlay. */
function DrawLayer({
  onComplete,
  onCancel,
}: {
  onComplete: (poly: PolygonCoords) => void;
  onCancel: () => void;
}) {
  const [verts, setVerts] = useState<PolygonCoords>([]);
  const vertsRef = useRef(verts);
  vertsRef.current = verts;

  const map = useMapEvents({
    click(e) {
      setVerts((v) => [...v, [e.latlng.lat, e.latlng.lng]]);
    },
    dblclick(e) {
      L.DomEvent.stop(e.originalEvent);
      if (vertsRef.current.length >= 3) onComplete(vertsRef.current);
    },
  });

  useEffect(() => {
    map.getContainer().classList.add("ps-drawing");
    map.doubleClickZoom.disable();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && vertsRef.current.length >= 3) onComplete(vertsRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      map.getContainer().classList.remove("ps-drawing");
      map.doubleClickZoom.enable();
      window.removeEventListener("keydown", onKey);
    };
  }, [map, onCancel, onComplete]);

  return (
    <>
      {verts.length >= 2 && (
        <Polyline
          positions={verts}
          pathOptions={{ color: "#1F2A16", weight: 2.5, dashArray: "6 4" }}
        />
      )}
      {verts.map(([lat, lng], i) => (
        <CircleMarker
          key={i}
          center={[lat, lng]}
          radius={i === 0 ? 6 : 4}
          pathOptions={{ color: "#4A5E3A", weight: 2, fillColor: "#FFFFFF", fillOpacity: 1 }}
          eventHandlers={
            i === 0
              ? {
                  click: (e) => {
                    L.DomEvent.stopPropagation(e);
                    if (vertsRef.current.length >= 3) onComplete(vertsRef.current);
                  },
                }
              : undefined
          }
        />
      ))}
    </>
  );
}

function FitPolygon({
  polygon,
  focus,
}: {
  polygon: PolygonCoords | null;
  focus: { lat: number; lng: number; zoom: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(t);
  }, [map]);
  useEffect(() => {
    if (polygon) {
      map.fitBounds(L.latLngBounds(polygon.map(([a, b]) => L.latLng(a, b))), {
        padding: [60, 60],
        maxZoom: 14,
      });
    }
  }, [map, polygon]);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const target: [number, number] = focus ? [focus.lat, focus.lng] : CYPRUS_CENTER;
    const zoom = focus ? focus.zoom : CYPRUS_ZOOM;
    if (reduce) map.setView(target, zoom, { animate: false });
    else map.flyTo(target, zoom, { duration: 1.1, easeLinearity: 0.25 });
  }, [map, focus]);
  return null;
}

export default function MarketMap({
  points,
  metric,
  window_,
  drawing,
  polygon,
  focus,
  onHover,
  onPick,
  onPolygonComplete,
  onDrawCancel,
}: {
  points: PointRow[];
  metric: OccMetric;
  window_: OccWindow;
  drawing: boolean;
  polygon: PolygonCoords | null;
  focus: { lat: number; lng: number; zoom: number } | null;
  onHover: (id: string | null) => void;
  onPick: (id: string) => void;
  onPolygonComplete: (poly: PolygonCoords) => void;
  onDrawCancel: () => void;
}) {
  return (
    <MapContainer
      center={CYPRUS_CENTER}
      zoom={CYPRUS_ZOOM}
      zoomControl={false}
      attributionControl={true}
      scrollWheelZoom={true}
      style={{ width: "100%", height: "100%", background: "#E8EDE3" }}
    >
      {/* Light basemap only — dashboard chrome is dark, the map stays light. */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        attribution="&copy; OpenStreetMap &copy; CARTO"
        subdomains="abcd"
      />

      <PointsLayer
        points={points}
        metric={metric}
        window_={window_}
        drawing={drawing}
        onHover={onHover}
        onPick={onPick}
      />

      {polygon && (
        <Polygon
          positions={polygon}
          pathOptions={{
            color: "#1F2A16",
            weight: 2.5,
            fillColor: "#8FCC80",
            fillOpacity: 0.14,
          }}
        />
      )}

      {drawing && <DrawLayer onComplete={onPolygonComplete} onCancel={onDrawCancel} />}
      <FitPolygon polygon={polygon} focus={focus} />
    </MapContainer>
  );
}
