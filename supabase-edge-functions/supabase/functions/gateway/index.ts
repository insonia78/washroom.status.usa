import { withIpRateLimit } from "./ip-rate-limit.ts";
import { handleGatewayRequest } from "./handler.ts";
import { getConfiguredBackendsSummary, logGatewayEvent } from "./logging.ts";

console.log("Washroom Gateway init");
console.log("Washroom Gateway initialized");
logGatewayEvent("info", "function.initialized", getConfiguredBackendsSummary());

export default { fetch: withIpRateLimit(handleGatewayRequest) };
