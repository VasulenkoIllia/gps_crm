import { z } from "zod";
import { emailSchema } from "./auth.ts";
import { ACCESS_SCOPE, PERMISSION_KEYS, ROLE_KEYS, ROLES, type PermissionKey, type RoleKey } from "./permissions.ts";

const NAME_MAX_LENGTH = 200;
const USERS_PAGE_DEFAULT = 50;
const USERS_PAGE_MAX = 100;

export const USER_STATUS = { invited: "invited", active: "active", blocked: "blocked" } as const;

// One registry for every status of the system: label and tone here, the look of a tone in StatusTag (05-ui-standard.md)
export interface StatusMeta {
  label: string;
  tone: "good" | "pending" | "warning" | "critical" | "neutral";
}

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

export const USER_STATUS_META: Record<UserStatus, StatusMeta> = {
  invited: { label: "Запрошений", tone: "pending" },
  active: { label: "Активний", tone: "good" },
  blocked: { label: "Заблокований", tone: "critical" },
};

const permissionKeySchema = z.enum(PERMISSION_KEYS as [PermissionKey, ...PermissionKey[]]);
const roleKeySchema = z.enum(ROLE_KEYS as [RoleKey, ...RoleKey[]], { error: "Виберіть роль" });

export const fullNameSchema = z
  .string({ error: "Вкажіть ПІБ" })
  .trim()
  .min(1, "Вкажіть ПІБ")
  .max(NAME_MAX_LENGTH, "Занадто довге значення");

export const currentUserSchema = z.strictObject({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  roleKey: roleKeySchema,
  twoFactorEnabled: z.boolean(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

export const profileUpdateSchema = z.strictObject({ fullName: fullNameSchema });
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const permissionListSchema = z.strictObject({
  permissions: z.array(
    z.strictObject({ key: permissionKeySchema, scope: z.enum([ACCESS_SCOPE.all, ACCESS_SCOPE.own]) }),
  ),
});
export type PermissionList = z.infer<typeof permissionListSchema>;

export const userListItemSchema = z.strictObject({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  roleKey: roleKeySchema,
  status: z.enum([USER_STATUS.invited, USER_STATUS.active, USER_STATUS.blocked]),
  twoFactorEnabled: z.boolean(),
  lastLoginAt: z.string().nullable(),
});
export type UserListItem = z.infer<typeof userListItemSchema>;

export const userListSchema = z.strictObject({ items: z.array(userListItemSchema), nextCursor: z.string().nullable() });
export type UserList = z.infer<typeof userListSchema>;

export const userListQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(USERS_PAGE_MAX).default(USERS_PAGE_DEFAULT),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

export const invitationInputSchema = z.strictObject({
  email: emailSchema,
  fullName: fullNameSchema,
  roleKey: roleKeySchema,
});
export type InvitationInput = z.infer<typeof invitationInputSchema>;

export const reinviteInputSchema = z.strictObject({ sendEmail: z.boolean().default(true) });
export type ReinviteInput = z.infer<typeof reinviteInputSchema>;

export const LINK_DELIVERY = { email: "email", manual: "manual" } as const;

// `manual` carries the link: no SMTP yet, the letter failed, or the person asked to copy it (D12)
export const linkDeliverySchema = z.discriminatedUnion("delivery", [
  z.strictObject({ delivery: z.literal(LINK_DELIVERY.email) }),
  z.strictObject({ delivery: z.literal(LINK_DELIVERY.manual), link: z.string() }),
]);
export type LinkDelivery = z.infer<typeof linkDeliverySchema>;

export const idParamsSchema = z.strictObject({ id: z.uuid("Некоректний ідентифікатор") });

export function roleLabel(key: RoleKey): string {
  return ROLES[key].name;
}
