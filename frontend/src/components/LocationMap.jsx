// src/components/LocationMap.jsx
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { useEffect, useRef } from 'react';
import L from 'leaflet';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});
// ── Offset duplicate markers at same location ─────────────
const offsetDuplicates = (markers) => {
  const seen = {};
  return markers.map((marker) => {
    const key = `${marker.latitude?.toFixed(4)}_${marker.longitude?.toFixed(4)}`;
    if (!seen[key]) seen[key] = 0;
    seen[key]++;
    const offset = 0.0003 * (seen[key] - 1);
    return {
      ...marker,
      latitude:  marker.latitude  + offset,
      longitude: marker.longitude + offset,
    };
  });
};

// ── Flies the map to + opens the popup for whichever marker matches focusKey ──
const FlyToMarker = ({ focusKey, markerRefs, markersByKey }) => {
  const map = useMap();

  useEffect(() => {
    if (!focusKey) return;
    const marker = markersByKey[focusKey];
    if (!marker) return;

    map.flyTo([marker.latitude, marker.longitude], 16, { duration: 0.8 });

    // slight delay so the popup opens after the fly animation starts
    const t = setTimeout(() => {
      markerRefs.current[focusKey]?.openPopup();
    }, 400);

    return () => clearTimeout(t);
  }, [focusKey, map, markerRefs, markersByKey]);

  return null;
};

const LocationMap = ({ markers = [], height = '350px', focusKey = null }) => {
  const valid       = markers.filter((m) => m.latitude && m.longitude);
  const markerRefs  = useRef({});

  if (valid.length === 0) {
    return (
      <div className="flex items-center justify-center bg-slate-800 rounded-xl text-slate-500 text-sm"
        style={{ height }}>
        📍 No location data available
      </div>
    );
  }

  const offsetMarkers = offsetDuplicates(valid);
  const center        = [offsetMarkers[0].latitude, offsetMarkers[0].longitude];

  const markersByKey = {};
  offsetMarkers.forEach((m, i) => {
    markersByKey[m.id ?? m.email ?? i] = m;
  });

  const formatTime = (date) =>
    date ? new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    }) : '';

  return (
    <MapContainer
      center={center}
      zoom={13}
      style={{ height, width: '100%', borderRadius: '12px', zIndex: 0 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FlyToMarker focusKey={focusKey} markerRefs={markerRefs} markersByKey={markersByKey} />
      {offsetMarkers.map((marker, i) => {
        const key = marker.id ?? marker.email ?? i;
        return (
          <Marker key={i} position={[marker.latitude, marker.longitude]}
            ref={(el) => { if (el) markerRefs.current[key] = el; }}>
            <Popup>
              <div style={{ minWidth: '180px' }}>
                <p style={{ fontWeight: 'bold', marginBottom: '4px' }}>{marker.name}</p>
                <p style={{ color: '#666', fontSize: '12px' }}>{marker.email}</p>
                {marker.clockIn && (
                  <p style={{ fontSize: '12px', marginTop: '4px' }}>
                    🕐 Clocked in: {formatTime(marker.clockIn)}
                  </p>
                )}
                {marker.location && (
                  <p style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                    📍 {marker.location}
                  </p>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
};
export default LocationMap;
