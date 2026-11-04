'use client';

import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {Map as MapInstance} from 'maplibre-gl';
import type {Restroom} from '@/components/RestroomDetails';
import {apiFailureMessage} from '@/lib/user-messages';
import MapRestroomPreview from '@/components/MapRestroomPreview';

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
  const [interactive, setInteractive] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{restroom:Restroom;host:HTMLDivElement;close:()=>void;position:()=>void}|null>(null);

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
      instance.dragPan.disable();
      instance.scrollZoom.disable();
      instance.boxZoom.disable();
      instance.keyboard.disable();
      instance.doubleClickZoom.disable();
      instance.dragRotate.disable();
      instance.touchZoomRotate.disable();
      instance.touchPitch.disable();
      instance.getCanvas().setAttribute('tabindex', '-1');
      instance.getCanvas().setAttribute('aria-label', 'Restroom map. Interaction is disabled.');
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
    const handlers = [
      map.dragPan,
      map.scrollZoom,
      map.boxZoom,
      map.keyboard,
      map.doubleClickZoom,
      map.dragRotate,
      map.touchZoomRotate,
      map.touchPitch,
    ];
    handlers.forEach(handler => interactive ? handler.enable() : handler.disable());
    map.getCanvas().setAttribute('tabindex', interactive ? '0' : '-1');
    map.getCanvas().setAttribute(
      'aria-label',
      interactive ? 'Interactive restroom map' : 'Restroom map. Interaction is disabled.',
    );
  }, [interactive, map]);

  useEffect(() => {
    if (!map || !interactive) return;
    let active = true;
    let control: import('maplibre-gl').IControl | undefined;
    import('maplibre-gl').then(({NavigationControl}) => {
      if (!active) return;
      control = new NavigationControl();
      map.addControl(control, 'top-right');
    }).catch((loadError: unknown) => {
      console.error('Map navigation controls failed to load:', loadError);
      if (active) setError(LOCATION_RESULTS_ERROR);
    });
    return () => {
      active = false;
      if (control) map.removeControl(control);
    };
  }, [interactive, map]);

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
    let popup: import('maplibre-gl').Popup | null = null;
    let previewButton: HTMLButtonElement | null = null;
    let previewHost: HTMLDivElement | null = null;
    let previewObserver: ResizeObserver | null = null;
    let positionPreview: (()=>void) | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelClose = () => {clearTimeout(closeTimer);};
    const closePreview = () => {
      cancelClose();
      const restoreFocus = previewHost?.contains(document.activeElement);
      previewButton?.setAttribute('aria-expanded', 'false');
      previewObserver?.disconnect();
      previewObserver = null;
      if (positionPreview) {map.off('move', positionPreview);map.off('resize', positionPreview);}
      positionPreview = null;
      popup?.remove();
      popup = null;
      previewHost = null;
      setPreview(null);
      if (restoreFocus && previewButton?.isConnected) previewButton.focus({preventScroll:true});
      previewButton = null;
    };
    const scheduleClose = () => {
      cancelClose();
      closeTimer = setTimeout(() => {
        if (previewHost?.contains(document.activeElement) || document.activeElement === previewButton) return;
        closePreview();
      }, 200);
    };
    const visibleItems = items.filter(item =>
      filter === 'all' ||
      (filter === 'accessible' && item.wheelchair === 'yes') ||
      (filter === 'free' && item.fee === 'no') ||
      (filter === 'always' && item.opening_hours === '24/7')
    );
    import('maplibre-gl').then(({Marker, Popup}) => {
      if (!active) return;
      visibleItems.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'map-restroom-marker';
        button.textContent = item.category === 'fuel' ? '⛽' : item.category === 'supermarket' ? '🛒' : '🚻';
        button.setAttribute('aria-label', `View ${item.name}`);
        button.setAttribute('aria-expanded', 'false');
        button.disabled = !interactive;
        button.style.cssText = 'background:white;border:2px solid #0d9488;border-radius:50%;width:36px;height:36px;cursor:pointer';
        const showPreview = () => {
          cancelClose();
          if (previewButton === button) return;
          closePreview();
          map.resize();
          previewButton = button;
          button.setAttribute('aria-expanded', 'true');
          const host = document.createElement('div');
          host.tabIndex = -1;
          previewHost = host;
          host.onmouseenter = cancelClose;
          host.onmouseleave = scheduleClose;
          host.addEventListener('focusin', cancelClose);
          host.addEventListener('focusout', scheduleClose);
          host.onkeydown = event => {
            if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();closePreview();}
          };
          popup = new Popup({closeButton:false,closeOnClick:false,focusAfterOpen:false,anchor:'center',maxWidth:'280px'})
            .setLngLat([item.lon,item.lat]).setDOMContent(host).addTo(map);
          positionPreview = () => {
            if (!popup) return;
            const point = map.project([item.lon,item.lat]);
            const element = popup.getElement();
            const bounds = map.getContainer();
            const halfWidth = element.offsetWidth / 2;
            const halfHeight = element.offsetHeight / 2;
            const x = Math.max(halfWidth + 8, Math.min(bounds.clientWidth - halfWidth - 8, point.x));
            const y = Math.max(halfHeight + 8, Math.min(bounds.clientHeight - halfHeight - 8, point.y));
            popup.setOffset([x - point.x,y - point.y]);
          };
          previewObserver = new ResizeObserver(positionPreview);
          previewObserver.observe(host);
          map.on('move', positionPreview);
          map.on('resize', positionPreview);
          positionPreview();
          setPreview({restroom:item,host,close:closePreview,position:positionPreview});
        };
        if (interactive) {
          button.onmouseenter = showPreview;
          button.onmouseleave = scheduleClose;
          button.onfocus = showPreview;
          button.onblur = scheduleClose;
          button.onkeydown = event => {
            if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();closePreview();}
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              showPreview();
              (previewHost?.querySelector<HTMLButtonElement>('button') ?? previewHost)?.focus({preventScroll:true});
            }
          };
          button.onclick = () => {showPreview();onSelect(item);};
        }
        markers.push(new Marker({element: button}).setLngLat([item.lon,item.lat]).addTo(map));
      });
    }).catch((loadError: unknown) => {
      console.error('Result markers failed to load:', loadError);
      if (active) setError(LOCATION_RESULTS_ERROR);
    });
    return () => {
      active = false;
      cancelClose();
      previewObserver?.disconnect();
      if (positionPreview) {map.off('move', positionPreview);map.off('resize', positionPreview);}
      popup?.remove();
      setPreview(null);
      markers.forEach(marker => marker.remove());
    };
  }, [filter, interactive, items, map, onSelect]);

  return <div className="relative h-[420px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
    <div ref={containerRef} tabIndex={interactive ? 0 : -1} aria-label={interactive ? 'Interactive restroom map' : 'Restroom map. Interaction is disabled.'} className="h-full w-full" />
    <button
      type="button"
      aria-pressed={interactive}
      aria-label={interactive ? 'Disable map interaction' : 'Enable map interaction'}
      onClick={() => setInteractive(enabled => !enabled)}
      className="absolute left-3 top-3 z-10 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow"
    >
      {interactive ? 'Disable map interaction' : 'Enable map interaction'}
    </button>
    {preview&&createPortal(<MapRestroomPreview restroom={preview.restroom} onSelect={()=>onSelect(preview.restroom)} onClose={preview.close} onLayout={preview.position}/>,preview.host)}
    {error && <div role="alert" className="absolute left-3 right-3 top-14 rounded-xl bg-white p-3 text-center text-sm font-semibold text-slate-700 shadow">{error}</div>}
  </div>;
});

export default OpenFreeMap;
