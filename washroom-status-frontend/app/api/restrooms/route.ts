import { NextRequest, NextResponse } from 'next/server.js';
import type { Restroom } from '@/components/RestroomDetails';
import { gatewayFetch, GatewayConfigurationError } from '../../../lib/gateway.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRestroom(value: unknown): Restroom {
  if (!isRecord(value) || !Number.isSafeInteger(value.id) ||
      (value.osmType !== 'node' && value.osmType !== 'way' && value.osmType !== 'relation') ||
      !isRecord(value.coordinates)) {
    throw new Error('Invalid restroom in gateway response.');
  }
  const { latitude, longitude } = value.coordinates;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Invalid restroom coordinates in gateway response.');
  }
  return {
    id: Number(value.id),
    osm_type: value.osmType,
    lat: latitude,
    lon: longitude,
    name: typeof value.name === 'string' && value.name ? value.name : 'Public restroom',
    wheelchair: typeof value.wheelchair === 'string' ? value.wheelchair : undefined,
    fee: typeof value.fee === 'string' ? value.fee : undefined,
    opening_hours: typeof value.openingHours === 'string' ? value.openingHours : undefined,
  };
}

export async function GET(req: NextRequest) {
  const zipParam = req.nextUrl.searchParams.get('zip');
  const zip = zipParam?.trim();
  const latParam = req.nextUrl.searchParams.get('lat');
  const lonParam = req.nextUrl.searchParams.get('lon');
  const lat = latParam?.trim() ? Number(latParam) : NaN;
  const lon = lonParam?.trim() ? Number(lonParam) : NaN;
  if (zipParam !== null && (!zip || !/^\d{5}$/.test(zip))) {
    return NextResponse.json({ error: 'Provide a five-digit US ZIP code.' }, { status: 400 });
  }
  if (zip && (latParam !== null || lonParam !== null)) {
    return NextResponse.json({ error: 'Provide either a ZIP code or latitude and longitude, not both.' }, { status: 400 });
  }
  if (!zip && (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)) {
    return NextResponse.json({ error: 'Provide valid latitude and longitude.' }, { status: 400 });
  }
  try {
    const url = new URL('http://gateway/places/bathrooms');
    if (zip) {
      url.searchParams.set('zip', zip);
      url.searchParams.set('countryCode', 'us');
    } else {
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lon));
    }
    url.searchParams.set('radius', '1609.344');
    const response = await gatewayFetch(url.pathname + url.search, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      console.error('Restroom gateway returned an error:', response.status);
      const error = response.status === 504
        ? 'The restroom data source timed out. Please retry shortly.'
        : 'The restroom service could not load locations. Please retry.';
      return NextResponse.json({ error }, { status: response.status });
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.data)) {
      throw new Error('Invalid restroom gateway response.');
    }
    const restrooms = payload.data.map(toRestroom);
    let searchOrigin: { latitude: number; longitude: number; zipCode: string } | undefined;
    if (zip) {
      const origin = payload.searchOrigin;
      if (!isRecord(origin) || typeof origin.latitude !== 'number' ||
          typeof origin.longitude !== 'number' || !Number.isFinite(origin.latitude) ||
          !Number.isFinite(origin.longitude) || Math.abs(origin.latitude) > 90 ||
          Math.abs(origin.longitude) > 180) {
        throw new Error('Invalid ZIP coordinates in gateway response.');
      }
      searchOrigin = { latitude: origin.latitude, longitude: origin.longitude, zipCode: zip };
    }
    return NextResponse.json({ restrooms, source: 'Gateway · Places API · OpenStreetMap', count: restrooms.length, ...(searchOrigin ? { searchOrigin } : {}) },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  } catch (err) {
    console.error('Restroom gateway lookup failed:', err);
    if (err instanceof GatewayConfigurationError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    return NextResponse.json({ error: timedOut ? 'The restroom gateway timed out. Please retry.' : 'Could not load restroom locations from the gateway. Please retry.' }, { status: timedOut ? 504 : 502 });
  }
}
