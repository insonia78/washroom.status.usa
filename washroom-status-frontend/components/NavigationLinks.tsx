import {googleMapsDirectionsUrl} from '@/lib/navigation';

export default function NavigationLinks({latitude, longitude, name}: {
  latitude: number;
  longitude: number;
  name: string;
}) {
  return <div className="mt-3">
    <div className="flex flex-wrap gap-2">
      <a href={googleMapsDirectionsUrl(latitude, longitude)} target="_blank" rel="noopener noreferrer"
        aria-label={`Google Maps directions to ${name} (opens in a new tab)`}
        className="inline-flex min-h-11 items-center rounded-xl border border-teal-700 px-4 py-2 text-sm font-bold text-teal-800">Google Maps directions</a>
    </div>
    <p className="mt-2 text-xs text-slate-500">Driving directions do not guarantee restroom access.</p>
  </div>;
}
