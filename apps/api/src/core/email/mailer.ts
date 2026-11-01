import { createTransport } from "nodemailer";
import type { SmtpConfig } from "../config.js";

// A slow mail server must not hold a request: the caller falls back to a link (D12)
const CONNECT_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 15_000;
// The socket timeout measures silence, not the whole letter: a server that answers now and then would outlast it.
// Under the 100 s Cloudflare gives a request, with room for the database work around the letter.
const SEND_DEADLINE_MS = 30_000;
const SMTPS_PORT = 465;

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  isConfigured: boolean;
  send(message: MailMessage): Promise<void>;
}

const NO_MAIL: Mailer = {
  isConfigured: false,
  send: () => Promise.reject(new Error("mail is not configured")),
};

// Not retried: a letter that may have gone out must not go twice, and the person sees the link at once instead.
// requireTLS: with a login the password never travels over a plain connection.
function withDeadline<T>(work: Promise<T>, deadlineMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("the letter took too long")), deadlineMs);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export function createMailer(smtp: SmtpConfig | null): Mailer {
  if (!smtp) return NO_MAIL;
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === SMTPS_PORT,
    requireTLS: smtp.auth !== null && smtp.port !== SMTPS_PORT,
    auth: smtp.auth ?? undefined,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
  return {
    isConfigured: true,
    send: async (message) => {
      await withDeadline(transport.sendMail({ from: smtp.from, ...message }), SEND_DEADLINE_MS);
    },
  };
}
