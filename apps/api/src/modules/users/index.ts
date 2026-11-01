export { registerUsersRoutes } from "./users.routes.js";
export {
  claimTokenAttempt,
  consumeToken,
  createAuthToken,
  deleteDeadTokens,
  countUsers,
  findLiveToken,
  findUserByEmail,
  findUserById,
  lockUsers,
  revokeUserTokens,
  setPassword,
  touchLastLogin,
} from "./users.repository.js";
export type { AuthTokenType } from "./users.repository.js";
export { confirmPassword, deliverLink, ensureFirstAdmin, tooManyAttempts } from "./users.service.js";

export const OWNED_TABLES = ["users", "auth_tokens"];
