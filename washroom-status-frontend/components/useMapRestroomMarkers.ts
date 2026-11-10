import {useEffect} from 'react';
import type {Map as MapInstance} from 'maplibre-gl';
import type {Restroom} from '@/components/RestroomDetails';
import {apiFailureMessage} from '@/lib/user-messages';
import {matchesRestroomFilter} from '@/lib/restroom-filters';

export type MapPreview = {
  restroom: Restroom;
  host: HTMLDivElement;
  close: () => void;
  position: () => void;
};

type Props = {
  map: MapInstance | null;
  items: Restroom[];
  filter: string;
  interactive: boolean;
  onSelect: (restroom: Restroom) => void;
  setPreview: (preview: MapPreview | null) => void;
  onError: (message: string) => void;
};

export default function useMapRestroomMarkers({
  map, items, filter, interactive, onSelect, setPreview, onError,
}: Props) {
  useEffect(() => {
    if (!map) return;
    let active = true;
    const markers: import('maplibre-gl').Marker[] = [];
    let popup: import('maplibre-gl').Popup | null = null;
    let previewButton: HTMLButtonElement | null = null;
    let previewHost: HTMLDivElement | null = null;
    let previewObserver: ResizeObserver | null = null;
    let positionPreview: (() => void) | null = null;
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
    const visibleItems = items.filter(item => matchesRestroomFilter(item, filter));
    import('maplibre-gl').then(({Marker, Popup}) => {
      if (!active) return;
      visibleItems.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'map-restroom-marker';
        button.textContent = item.category === 'fuel' ? '⛽' : item.category === 'supermarket' ? '🛒' : '🚻';
        button.setAttribute('aria-label', `View ${item.name}`);
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');
        button.disabled = !interactive;
        button.style.cssText = 'background:white;border:2px solid #0d9488;border-radius:50%;width:44px;height:44px;cursor:pointer';
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
      if (active) onError(apiFailureMessage(null, 'OpenFreeMap API'));
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
  }, [filter, interactive, items, map, onError, onSelect, setPreview]);
}
