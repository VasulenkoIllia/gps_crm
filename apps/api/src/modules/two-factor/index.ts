export { base32Decode, hotp, stepAt } from "./totp.js";
export { registerTwoFactorRoutes } from "./two-factor.routes.js";
export { completeChallenge, startChallenge } from "./two-factor.service.js";

export const OWNED_TABLES = ["two_factor_credentials", "two_factor_recovery_codes"];
