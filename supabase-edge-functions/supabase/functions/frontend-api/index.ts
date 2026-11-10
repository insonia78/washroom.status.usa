import { authorizeGatewayRequest } from "../_shared/gateway-auth.ts";
import { json, ApiError, isRecord } from "./api-utils.ts";
import { toiletSubmissions } from "./toilet-submissions.ts";
import { moderateToilets, moderation } from "./moderation.ts";
import { reviews } from "./reviews.ts";
import { ownerResponses } from "./owner-responses.ts";
import { adminReviews } from "./admin-reviews.ts";
import { adminToilets } from "./admin-toilets.ts";
import { adminReviewReplies } from "./admin-review-replies.ts";
import { adminOwnerInvites } from "./admin-owner-invites.ts";
import { ownerReplyStage, ownerReplies } from "./owner-replies.ts";
import { ownerReviews } from "./owner-reviews.ts";
import { ownerReviewPhotos } from "./owner-review-photos.ts";
import { auth } from "./auth.ts";
import { geocodeZipCode } from "../places-api/services/geocoding.ts";
import { upstream } from "./database.ts";
import { RequestError } from "../places-api/utils/errors.ts";

export default {
  // Authorizes gateway traffic and dispatches review, auth, geocoding, and map requests.
  async fetch(req: Request): Promise<Response> {
    const denied = authorizeGatewayRequest(req, json, "frontend-api");
    if (denied) return denied;
    const path = new URL(req.url).pathname.replace(/^\/(?:functions\/v1\/)?frontend-api(?=\/|$)/, "").replace(/\/$/, "") || "/";
    try {
      if (path === "/toilet-submissions") return await toiletSubmissions(req);
      if (path === "/moderation/toilets") return await moderateToilets(req);
      if (path === "/reviews") return await reviews(req);
      if (path === "/moderation/reviews") return await moderation(req);
      if (path === "/admin/owner-responses") return await ownerResponses(req, true);
      if (path === "/admin/reviews") return await adminReviews(req);
      if (path === "/admin/toilets") return await adminToilets(req);
      if (path === "/admin/review-replies") return await adminReviewReplies(req);
      if (path === "/admin/owner-invites") return await adminOwnerInvites(req);
      if (path === "/admin/owner-replies") return await ownerReplyStage(req, "publish");
      if (path === "/moderation/owner-replies") return await ownerReplyStage(req, "moderate");
      if (path === "/owner/reviews") return await ownerReviews(req);
      if (path === "/owner/review-photos") return await ownerReviewPhotos(req);
      if (path === "/owner/replies") return await ownerReplies(req);
      if (path === "/owner-responses") return await ownerResponses(req, false);
      if (path.startsWith("/auth/")) return await auth(req, path);
      if (req.method !== "GET") throw new ApiError(405, "Method not allowed");
      // Resolves ZIP codes or geocodes a US address, returning coordinates or suggestions.
      if (path === "/geocode") {
        const suggest = new URL(req.url).searchParams.get("suggest") === "1";
        const zip = new URL(req.url).searchParams.get("zip");
        if (zip !== null) {
          const origin = await geocodeZipCode(zip.trim());
          if (!origin) throw new ApiError(404, "No matching US ZIP code found.");
          if (suggest) return json(200, { suggestions: [{
            label: `ZIP ${origin.zipCode}, USA`, latitude: origin.latitude, longitude: origin.longitude,
          }] });
          return json(200, { latitude: origin.latitude, longitude: origin.longitude, zipCode: origin.zipCode });
        }
        const query = new URL(req.url).searchParams.get("q")?.trim();
        if (!query || query.length > 200) throw new ApiError(400, "Provide a US city or address (up to 200 characters).");
        const url = new URL("https://photon.komoot.io/api/");
        url.search = new URLSearchParams({ limit: suggest ? "5" : "1", countrycode: "US", lang: "en", q: query }).toString();
        const response = await upstream(url, { headers: { "User-Agent": "WashroomStatusUSA/1.0" } });
        if (!response.ok) {
          console.error("City geocoder failed", { status: response.status });
          throw new ApiError(502, `City or address lookup is unavailable (provider HTTP ${response.status})`);
        }
        const results: unknown = await response.json();
        if (!isRecord(results) || !Array.isArray(results.features)) throw new ApiError(502, "Invalid geocoding response");
        if (!results.features.length && !suggest) throw new ApiError(404, "No matching US city or address found.");
        const suggestions = results.features.slice(0, suggest ? 5 : 1).map((first: unknown) => {
          if (!isRecord(first) || !isRecord(first.geometry) ||
            first.geometry.type !== "Point" || !Array.isArray(first.geometry.coordinates) ||
            !isRecord(first.properties) || String(first.properties.countrycode).toUpperCase() !== "US") {
            throw new ApiError(502, "Invalid US geocoding result");
          }
          const [longitude, latitude] = first.geometry.coordinates;
          if (typeof latitude !== "number" || typeof longitude !== "number" ||
            !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new ApiError(502, "Invalid geocoding coordinates");
          const properties = first.properties;
          const street = [properties.housenumber, properties.street]
            .filter(value => typeof value === "string" && value.trim()).join(" ");
          const parts = [properties.name, street, properties.city || properties.town || properties.village,
            properties.state, properties.postcode, "USA"]
            .filter((value): value is string => typeof value === "string" && !!value.trim());
          return { latitude, longitude, label: [...new Set(parts)].join(", ") };
        });
        if (suggest) return json(200, { suggestions });
        const { latitude, longitude } = suggestions[0];
        return json(200, { latitude, longitude });
      }
      // Retrieves and validates the US boundary feature used to frame the map.
      if (path === "/map-boundary") {
        const response = await upstream("https://raw.githubusercontent.com/johan/world.geo.json/master/countries/USA.geo.json");
        if (!response.ok) throw new ApiError(502, "US boundary unavailable");
        const data: unknown = await response.json();
        const feature: unknown = isRecord(data) && data.type === "FeatureCollection" &&
          Array.isArray(data.features) ? data.features[0] : data;
        if (!isRecord(feature) || !isRecord(feature.geometry) ||
          !["Polygon", "MultiPolygon"].includes(String(feature.geometry.type)) ||
          !Array.isArray(feature.geometry.coordinates)) throw new ApiError(502, "Invalid US boundary response");
        return json(200, feature);
      }
      throw new ApiError(404, "Route not found");
    } catch (error) {
      console.error("frontend-api request failed", { path, error: error instanceof Error ? error.message : String(error) });
      const status = error instanceof ApiError || error instanceof RequestError ? error.status :
        error instanceof Error && error.name === "TimeoutError" ? 504 : 502;
      return json(status, { error: error instanceof ApiError || error instanceof RequestError ? error.message : "Application backend is temporarily unavailable" });
    }
  },
};
