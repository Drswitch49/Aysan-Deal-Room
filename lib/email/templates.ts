/**
 * Partner email templates (Build Pack Section 18.3).
 *
 * Rules these encode, so they cannot drift:
 *  - R8: no figures in email bodies, except the capital call and distribution
 *    templates where the spec allows them. Everything else says "in the portal".
 *  - No marketing content, no deal names, no seller, no lender.
 *  - UK English, dates as "12 Aug 2026", money as "£250,000".
 *  - Every footer carries the fraud line. Capital call fraud by spoofed email
 *    is the most likely real-world loss in this system, so it is not optional
 *    and not a per-template choice.
 */

export type TemplateName =
  | "invite"
  | "credentials"
  | "password_reset"
  | "access_changed"
  | "call_issued"
  | "call_settled"
  | "distribution"
  | "report_published";

export interface RenderedEmail {
  subject: string;
  /** Plain text body. Kept alongside HTML so a text-only client reads cleanly. */
  text: string;
  html: string;
}

const FRAUD_LINE =
  "We will never ask you to send money or bank details by email. If an email appears to, call us on the number you hold for us before acting.";

const FOOTER =
  "Private and confidential. Capital at risk. Figures are actuals; ACP publishes no forecasts.";

const CONTACT = "partnerships@aysancapital.com";

/** "12 Aug 2026" — the house date format, en-GB, no dash pauses. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

/**
 * "£250,000" — pence in, en-GB out, pence shown only when non-zero and then
 * always as two digits. Mirrors gbp() in src/lib/portal/format.ts: a figure
 * must read the same in the email as it does on the screen it points at.
 */
export function formatMoney(pence: number | bigint | null | undefined): string {
  const whole = Number(pence ?? 0);
  const digits = whole % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(whole / 100);
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Wrap body paragraphs in the ACP shell. Deliberately plain: a partner email
 * that looks like a marketing campaign is the one most likely to be reported
 * as phishing, and this one carries a login link.
 */
function shell(heading: string, paragraphs: string[], cta?: { label: string; url: string }): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1a1a1a;">${p}</p>`)
    .join("");
  const button = cta
    ? `<p style="margin:0 0 24px;"><a href="${escape(cta.url)}" style="display:inline-block;background:#c9a257;color:#0e1420;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:4px;">${escape(cta.label)}</a></p>`
    : "";
  return `<!doctype html>
<html lang="en-GB"><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:6px;">
    <tr><td style="padding:28px 32px 8px;">
      <p style="margin:0 0 24px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8a6d2f;font-weight:700;">Aysan Capital Partners</p>
      <h1 style="margin:0 0 20px;font-size:20px;line-height:1.3;color:#0e1420;font-weight:600;">${escape(heading)}</h1>
      ${body}
      ${button}
    </td></tr>
    <tr><td style="padding:0 32px 28px;border-top:1px solid #e4e4e7;">
      <p style="margin:16px 0 8px;font-size:12px;line-height:1.5;color:#52525b;">${escape(FRAUD_LINE)}</p>
      <p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#52525b;">${escape(FOOTER)}</p>
      <p style="margin:0;font-size:12px;color:#52525b;">${escape(CONTACT)}</p>
    </td></tr>
  </table>
</body></html>`;
}

function plain(heading: string, lines: string[], cta?: { label: string; url: string }): string {
  return [
    "AYSAN CAPITAL PARTNERS",
    "",
    heading,
    "",
    ...lines,
    ...(cta ? ["", `${cta.label}: ${cta.url}`] : []),
    "",
    "—",
    FRAUD_LINE,
    FOOTER,
    CONTACT,
  ].join("\n");
}

type Payload = Record<string, any>;

/**
 * Render a queued message. Unknown template names throw rather than sending a
 * blank email — a silent empty send to a capital partner is worse than a failed
 * queue row an admin can see.
 */
export function render(template: TemplateName | string, payload: Payload): RenderedEmail {
  const name = String(payload.name ?? "").trim();
  const greeting = name ? `Dear ${escape(name)},` : "Dear partner,";
  const signIn = String(payload.portalUrl ?? "");

  switch (template) {
    case "invite": {
      const heading = "Your Aysan Capital Partners portal access";
      const lines = [
        greeting,
        "Your access to the Aysan Capital Partners portal is ready. Use the link below to set your password and sign in.",
        `The link expires in ${payload.expiresInHours ?? 24} hours.`,
        `If you were not expecting this, reply to this email and we will disable it.`,
      ];
      return {
        subject: heading,
        text: plain(heading, lines, { label: "Set up access", url: String(payload.link ?? "") }),
        html: shell(heading, lines, { label: "Set up access", url: String(payload.link ?? "") }),
      };
    }

    case "credentials": {
      // The temporary password travels in this email by explicit instruction.
      // It is single use in practice: the portal asks for a new password on
      // first sign-in, and the account is bound to this address only.
      const heading = "Your Aysan Capital Partners portal access";
      const lines = [
        greeting,
        "Your access to the Aysan Capital Partners portal is ready.",
        `Sign in at <strong>${escape(signIn)}</strong> with this email address and the temporary password below.`,
        `Temporary password: <strong style="font-family:monospace;letter-spacing:.05em;">${escape(String(payload.password ?? ""))}</strong>`,
        "You will be asked to choose your own password when you first sign in. Please do not reuse a password you hold elsewhere.",
        "If you were not expecting this, reply to this email and we will disable it.",
      ];
      const textLines = [
        name ? `Dear ${name},` : "Dear partner,",
        "Your access to the Aysan Capital Partners portal is ready.",
        `Sign in at ${signIn} with this email address and the temporary password below.`,
        `Temporary password: ${payload.password ?? ""}`,
        "You will be asked to choose your own password when you first sign in.",
        "If you were not expecting this, reply to this email and we will disable it.",
      ];
      return {
        subject: heading,
        text: plain(heading, textLines, signIn ? { label: "Sign in", url: signIn } : undefined),
        html: shell(heading, lines, signIn ? { label: "Sign in", url: signIn } : undefined),
      };
    }

    case "password_reset": {
      const heading = "Reset your portal password";
      const lines = [
        greeting,
        "We received a request to reset your portal password. Use the link below to choose a new one. It expires in one hour.",
        "If you did not ask for this, you can ignore this email and your password stays as it is.",
      ];
      return {
        subject: heading,
        text: plain(heading, lines, { label: "Choose a new password", url: String(payload.link ?? "") }),
        html: shell(heading, lines, { label: "Choose a new password", url: String(payload.link ?? "") }),
      };
    }

    case "access_changed": {
      const heading = "Your portal access has changed";
      const lines = [
        greeting,
        String(payload.message ?? "Your access to the Aysan Capital Partners portal has been updated."),
        `If this is unexpected, contact us at ${CONTACT}.`,
      ];
      return { subject: heading, text: plain(heading, lines), html: shell(heading, lines) };
    }

    case "call_issued": {
      // Figures permitted here by the spec. Bank details never are.
      const heading = "Capital call: action required";
      const lines = [
        greeting,
        `A capital call has been issued for ${formatMoney(payload.amount_pence)}, due ${formatDate(payload.due_date)}.`,
        "Payment details are in the portal. We will never send bank details by email.",
      ];
      return {
        subject: heading,
        text: plain(heading, lines, signIn ? { label: "Sign in", url: signIn } : undefined),
        html: shell(heading, lines, signIn ? { label: "Sign in", url: signIn } : undefined),
      };
    }

    case "call_settled": {
      const heading = "Capital call received";
      const lines = [greeting, "Thank you. Your payment has been received and recorded."];
      return {
        subject: heading,
        text: plain(heading, lines, signIn ? { label: "Sign in", url: signIn } : undefined),
        html: shell(heading, lines, signIn ? { label: "Sign in", url: signIn } : undefined),
      };
    }

    case "distribution": {
      const heading = "Distribution declared";
      const lines = [
        greeting,
        "A distribution has been declared on your holding. The amount and date are in the portal.",
      ];
      return {
        subject: heading,
        text: plain(heading, lines, signIn ? { label: "Sign in", url: signIn } : undefined),
        html: shell(heading, lines, signIn ? { label: "Sign in", url: signIn } : undefined),
      };
    }

    case "report_published": {
      const period = String(payload.period_label ?? "").trim();
      const heading = period ? `Your ${period} report is available` : "Your quarterly report is available";
      const lines = [greeting, "Your quarterly report is available in the portal."];
      return {
        subject: heading,
        text: plain(heading, lines, signIn ? { label: "Sign in", url: signIn } : undefined),
        html: shell(heading, lines, signIn ? { label: "Sign in", url: signIn } : undefined),
      };
    }

    default:
      throw new Error(`Unknown email template: ${template}`);
  }
}
