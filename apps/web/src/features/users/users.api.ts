import { linkDeliverySchema, userListSchema, type InvitationInput, type LinkDelivery } from "@gps_crm/shared";
import { apiGet, apiPost, apiSend } from "../../lib/api";

export const USERS_KEY = ["users"];

export function fetchUsersPage(cursor: string | null, signal: AbortSignal) {
  const query = cursor ? `?cursor=${cursor}` : "";
  return apiGet(`/users${query}`, userListSchema, signal);
}

export function inviteUser(input: InvitationInput): Promise<LinkDelivery> {
  return apiPost("/users/invitations", linkDeliverySchema, input);
}

export function reinviteUser(id: string, sendEmail: boolean): Promise<LinkDelivery> {
  return apiPost(`/users/${id}/reinvite`, linkDeliverySchema, { sendEmail });
}

export function createResetLink(id: string, sendEmail: boolean): Promise<LinkDelivery> {
  return apiPost(`/users/${id}/password-reset`, linkDeliverySchema, { sendEmail });
}

export function blockUser(id: string): Promise<void> {
  return apiSend("POST", `/users/${id}/block`);
}

export function unblockUser(id: string): Promise<void> {
  return apiSend("POST", `/users/${id}/unblock`);
}

export function resetTwoFactor(id: string, password: string): Promise<void> {
  return apiSend("POST", `/users/${id}/reset-2fa`, { password });
}
