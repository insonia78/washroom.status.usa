import {
  CONTAINER_HOSTNAME,
  frontendApiUrl,
  FUNCTION_PATH_PREFIXES,
  jwtRevokeUrl,
  placesApiUrl,
  registrationApiUrl,
} from "./config.ts";
import { SERVICES } from "./models.ts";
import { supportedRoutes } from "./supported-routes.ts";

// Removes the gateway function prefix to obtain the downstream route path.
export function extractProxyPath(pathname: string) {
  for (const prefix of FUNCTION_PATH_PREFIXES) {
    if (!pathname.startsWith(prefix)) {
      continue;
    }

    const remainder = pathname.slice(prefix.length);
    return remainder.length > 0 ? remainder : "/";
  }

  return pathname;
}

// Finds the configured route definition matching a request path.
export function matchRoute(pathname: string) {
  return supportedRoutes.find((route) => route.pattern.test(pathname));
}

// Maps an exposed proxy path to the service that should receive it.
export function inferService(proxyPath: string): SERVICES | null {
  if (proxyPath.startsWith(`/${SERVICES.FRONTEND}/`)) {
    return SERVICES.FRONTEND;
  }
  if (proxyPath.startsWith(`/${SERVICES.ACCOUNTS}`)) {
    return SERVICES.ACCOUNTS;
  }

  if (proxyPath.startsWith(`/${SERVICES.ADMIN}`)) {
    return SERVICES.ADMIN;
  }

  if (proxyPath.startsWith(`/${SERVICES.PLACES}`)) {
    return SERVICES.PLACES;
  }

  if (proxyPath.startsWith(`/${SERVICES.AUTH}`)) {
    return SERVICES.AUTH;
  }

  return null;
}

// Selects the configured backend URL for the matched service.
export function resolveBackendUrl(service: SERVICES | null): string | null {
  if (service === SERVICES.FRONTEND) {
    return frontendApiUrl ?? null;
  }
  if (service === SERVICES.ACCOUNTS || service === SERVICES.ADMIN) {
    return registrationApiUrl ?? null;
  }

  if (service === SERVICES.PLACES) {
    return placesApiUrl ?? null;
  }

  if (service === SERVICES.AUTH) {
    return jwtRevokeUrl ?? null;
  }

  return registrationApiUrl ?? null;
}

// Combines the backend base path, proxy route, and query string into the target URL.
export function buildTargetUrl(
  baseUrl: string,
  proxyPath: string,
  search: string,
  service: SERVICES | null,
) {
  if (service === SERVICES.AUTH) {
    const targetUrl = new URL(baseUrl);
    targetUrl.search = search;
    return targetUrl;
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const parsedBaseUrl = new URL(normalizedBaseUrl);
  const baseSegments = parsedBaseUrl.pathname.split("/").filter(Boolean);
  const proxySegments = proxyPath.split("/").filter(Boolean);

  // Edge APIs serve routes at their root, without the gateway service prefix.
  if (
    (service === SERVICES.PLACES || service === SERVICES.FRONTEND) &&
    proxySegments[0] === service
  ) {
    proxySegments.shift();
  }

  const normalizedProxyPath = baseSegments.length > 0 &&
      proxySegments.length > 0 &&
      baseSegments[baseSegments.length - 1] === proxySegments[0]
    ? proxySegments.slice(1).join("/")
    : proxySegments.join("/");

  const targetUrl = new URL(normalizedProxyPath, normalizedBaseUrl);
  targetUrl.search = search;
  return targetUrl;
}

// Rewrites local hostnames to the Docker host when a backend is container-local.
export function buildContainerReachableBackendUrl(baseUrl: string) {
  const parsedUrl = new URL(baseUrl);
  if (
    parsedUrl.hostname !== "127.0.0.1" && parsedUrl.hostname !== "localhost"
  ) {
    return null;
  }

  parsedUrl.hostname = CONTAINER_HOSTNAME;
  return parsedUrl.toString();
}

// Identifies the administrator login route for specialized gateway handling.
export function isAdminLoginPath(proxyPath: string) {
  return proxyPath === "/admin/login";
}

// Identifies the administrator access-check route.
export function isAdminAccessPath(proxyPath: string) {
  return proxyPath === "/admin/access";
}

// Identifies the administrator password-setup route.
export function isAdminCreatePasswordPath(proxyPath: string) {
  return proxyPath === "/admin/create-password";
}

// Identifies the account deactivation route.
export function isAccountDeactivatePath(proxyPath: string) {
  return proxyPath === "/accounts/deactivate";
}

// Identifies unauthenticated place-search routes.
export function isPublicPlacesPath(proxyPath: string) {
  return /^\/places\/bathrooms\/?$/.test(proxyPath);
}

// Identifies the account login route.
export function isAccountLoginPath(proxyPath: string) {
  return proxyPath === "/accounts/login";
}
