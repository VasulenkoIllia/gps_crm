import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 10;
// Hashing is the expensive step of a sign-in, so a megabyte of password must not reach it
export const PASSWORD_MAX_LENGTH = 200;

const EMAIL_MAX_LENGTH = 254;
const CODE_MAX_LENGTH = 32;
const TOKEN_MAX_LENGTH = 128;
const REQUIRED = "Заповніть це поле";

// П3: the email is the login and is unique regardless of case
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = z
  .string({ error: REQUIRED })
  .trim()
  .max(EMAIL_MAX_LENGTH, "Занадто довгий email")
  .pipe(z.email("Введіть коректний email"))
  .transform(normalizeEmail);

const currentPasswordSchema = z.string({ error: REQUIRED }).min(1, REQUIRED).max(PASSWORD_MAX_LENGTH);

export const newPasswordSchema = z
  .string({ error: REQUIRED })
  .min(PASSWORD_MIN_LENGTH, `Пароль має містити щонайменше ${PASSWORD_MIN_LENGTH} символів`)
  .max(PASSWORD_MAX_LENGTH, "Занадто довгий пароль");

const tokenSchema = z.string({ error: REQUIRED }).min(1, REQUIRED).max(TOKEN_MAX_LENGTH);
const codeSchema = z.string({ error: REQUIRED }).trim().min(1, REQUIRED).max(CODE_MAX_LENGTH);

export const loginInputSchema = z.strictObject({ email: emailSchema, password: currentPasswordSchema });
export type LoginInput = z.infer<typeof loginInputSchema>;

export const twoFactorLoginInputSchema = z.strictObject({ challenge: tokenSchema, code: codeSchema });
export type TwoFactorLoginInput = z.infer<typeof twoFactorLoginInputSchema>;

export const LOGIN_STATUS = {
  signedIn: "signed_in",
  twoFactorRequired: "two_factor_required",
  twoFactorSetupRequired: "two_factor_setup_required",
} as const;

// The password alone never opens the data: either a code is owed, or the account has to set up 2FA first (К2)
export const loginResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal(LOGIN_STATUS.signedIn) }),
  z.strictObject({ status: z.literal(LOGIN_STATUS.twoFactorRequired), challenge: z.string() }),
  z.strictObject({ status: z.literal(LOGIN_STATUS.twoFactorSetupRequired) }),
]);
export type LoginResult = z.infer<typeof loginResultSchema>;

export const passwordResetRequestSchema = z.strictObject({ email: emailSchema });
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.strictObject({ token: tokenSchema, password: newPasswordSchema });
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>;

export const invitationAcceptSchema = z.strictObject({ token: tokenSchema, password: newPasswordSchema });
export type InvitationAccept = z.infer<typeof invitationAcceptSchema>;

export const passwordChangeSchema = z.strictObject({
  currentPassword: currentPasswordSchema,
  newPassword: newPasswordSchema,
});
export type PasswordChange = z.infer<typeof passwordChangeSchema>;

export const passwordConfirmSchema = z.strictObject({ password: currentPasswordSchema });
export type PasswordConfirm = z.infer<typeof passwordConfirmSchema>;

export const twoFactorConfirmSchema = z.strictObject({ code: codeSchema });
export type TwoFactorConfirm = z.infer<typeof twoFactorConfirmSchema>;

export const twoFactorSetupSchema = z.strictObject({ qrDataUrl: z.string(), secret: z.string() });
export type TwoFactorSetup = z.infer<typeof twoFactorSetupSchema>;

export const recoveryCodesSchema = z.strictObject({ recoveryCodes: z.array(z.string()) });
export type RecoveryCodes = z.infer<typeof recoveryCodesSchema>;

export const sessionViewSchema = z.strictObject({
  id: z.string(),
  isCurrent: z.boolean(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type SessionView = z.infer<typeof sessionViewSchema>;

export const sessionListSchema = z.strictObject({ items: z.array(sessionViewSchema) });
export type SessionList = z.infer<typeof sessionListSchema>;
