'use client';

import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import type {Map as MapInstance} from 'maplibre-gl';
import type {Restroom} from '@/components/RestroomDetails';
import {apiFailureMessage} from '@/lib/user-messages';

const LOCATION_RESULTS_ERROR = apiFailureMessage(null, 'OpenFreeMap API');

type Coordinates = [longitude: number, latitude: number];
export type OpenFreeMapHandle = {
  focusMap: () => void;
  focus: (point: Coordinates, zoom: number) => void;
};
type Props = {
  center: Coordinates;
  zoom: number;
  overview: boolean;
  location: Coordinates | null;
  items: Restroom[];
  filter: string;
  onSelect: (restroom: Restroom) => void;
};

const OpenFreeMap = forwardRef<OpenFreeMapHandle, Props>(function OpenFreeMap(
  {center, zoom, overview, location, items, filter, onSelect}, ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const [map, setMap] = useState<MapInstance | null>(null);
  const [error, setError] = useState('');

  useImperativeHandle(ref, () => ({
    focusMap() {
      (mapRef.current?.getCanvas() ?? containerRef.current)?.focus({preventScroll: true});
    },
    focus(point, nextZoom) {
      mapRef.current?.flyTo({center: point, zoom: nextZoom});
    },
  }), []);

  useEffect(() => {
    let active = true;
    let instance: MapInstance | undefined;
    let observer: ResizeObserver | undefined;
    import('maplibre-gl').then(({Map, NavigationControl, setWorkerUrl}) => {
      if (!active || !containerRef.current) return;
      setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString());
      instance = new Map({
        container: containerRef.current,
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center,
        zoom,
        minZoom: 1,
        maxZoom: 19,
      });
      instance.addControl(new NavigationControl(), 'top-right');
      instance.getCanvas().setAttribute('aria-label', 'Interactive restroom map');
      instance.on('error', event => {
        console.error('Map resource failed to load:', event.error);
        if (active) setError(LOCATION_RESULTS_ERROR);
      });
      instance.on('idle', () => {
        if (active && instance?.areTilesLoaded()) setError('');
      });
      observer = new ResizeObserver(() => instance?.resize());
      observer.observe(containerRef.current);
      mapRef.current = instance;
      setMap(instance);
    }).catch((loadError: unknown) => {
      console.error('Map failed to load:', loadError);
      if (active) setError(LOCATION_RESULTS_ERROR);
    });
    return () => {
      active = false;
      observer?.disconnect();
      instance?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    const updateView = () => {
      if (overview) map.fitBounds([[-125, 24], [-66, 50]], {padding: 24, duration: 0});
      else map.flyTo({center, zoom});
    };
    updateView();
    if (overview) map.on('resize', updateView);
    return () => {map.off('resize', updateView);};
  }, [center, map, zoom, overview]);

  useEffect(() => {
    if (!map || !location) return;
    let active = true;
    let marker: import('maplibre-gl').Marker | undefined;
    import('maplibre-gl').then(({Marker}) => {
      if (!active) return;
      const point = document.createElement('div');
      point.setAttribute('role', 'img');
      point.setAttribute('aria-label', 'Your current location');
      point.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 0 0 5px #2563eb33';
      marker = new Marker({element: point}).setLngLat(location).addTo(map);
    }).catch((loadError: unknown) => {
      console.error('Location marker failed to load:', loadError);
      if (active) setError(LOCATION_RESULTS_ERROR);
    });
    return () => {active = false; marker?.remove();};
  }, [location, map]);

  useEffect(() => {
    if (!map) return;
    let active = true;
    const markers: import('maplibre-gl').Marker[] = [];
    const visibleItems = items.filter(item =>
      filter === 'all' ||
      (filter === 'accessible' && item.wheelchair === 'yes') ||
      (filter === 'free' && item.fee === 'no') ||
      (filter === 'always' && item.opening_hours === '24/7')
    );
    import('maplibre-gl').then(({Marker}) => {
      if (!active) return;
      visibleItems.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.category === 'fuel' ? '⛽' : item.category === 'supermarket' ? '🛒' : '🚻';
        button.setAttribute('aria-label', `View ${item.name}`);
        button.style.cssText = 'background:white;border:2px solid #0d9488;border-radius:50%;width:36px;height:36px;cursor:pointer';
        button.onclick = () => onSelect(item);
        markers.push(new Marker({element: button}).setLngLat([item.lon, item.lat]).addTo(map));
      });
    }).catch((loadError: unknown) => {
      console.error('Result markers failed to load:', loadError);
      if (active) setError(LOCATION_RESULTS_ERROR);
    });
    return () => {active = false; markers.forEach(marker => marker.remove());};
  }, [filter, items, map, onSelect]);

  return <div className="relative h-[420px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
    <div ref={containerRef} tabIndex={0} aria-label="Interactive restroom map" className="h-full w-full" />
    {error && <div role="alert" className="absolute left-3 right-3 top-14 rounded-xl bg-white p-3 text-center text-sm font-semibold text-slate-700 shadow">{error}</div>}
  </div>;
});

export default OpenFreeMap;
