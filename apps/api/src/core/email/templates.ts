import { APP_TITLE } from "../deps.js";
import type { MailMessage } from "./mailer.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function letter(to: string, subject: string, lines: string[], link: string, action: string, note: string): MailMessage {
  const paragraphs = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  return {
    to,
    subject,
    text: [...lines, "", `${action}: ${link}`, "", note].join("\n"),
    html: `${paragraphs}<p><a href="${escapeHtml(link)}">${escapeHtml(action)}</a></p><p>${escapeHtml(note)}</p>`,
  };
}

export function invitationLetter(to: string, fullName: string, link: string): MailMessage {
  return letter(
    to,
    `Запрошення в ${APP_TITLE}`,
    [
      `${fullName}, вас запросили в систему ${APP_TITLE}.`,
      "Перейдіть за посиланням, задайте пароль і налаштуйте вхід з кодом.",
    ],
    link,
    "Прийняти запрошення",
    "Посилання діє 72 години.",
  );
}

export function passwordResetLetter(to: string, link: string): MailMessage {
  return letter(
    to,
    `Скидання пароля в ${APP_TITLE}`,
    ["Хтось попросив скинути пароль для цієї адреси.", "Якщо це були не ви, нічого робити не треба."],
    link,
    "Задати новий пароль",
    "Посилання діє 1 годину.",
  );
}
