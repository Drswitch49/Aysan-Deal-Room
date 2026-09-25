/** Shared rules for the commitment screens (partner record and deal page). */

/** Statuses the portal shows. Pending commitments stay invisible to the partner. */
export const IN_PORTAL = new Set(["completed", "converted", "bought_back"]);

/**
 * How a deal is named on admin screens: the deal's own name, which is what the
 * team knows it by. The ACP ref goes underneath (see dealSubLabel), and the
 * partner-facing name is only what partners see.
 */
export const dealLabel = (
  d:
    | {
        partner_display_name?: string | null;
        company_name?: string | null;
        deal_name?: string | null;
        acp_ref_no?: string | null;
      }
    | null
    | undefined,
) => d?.deal_name || d?.company_name || d?.acp_ref_no || "Deal";

/** The line under dealLabel: the ACP ref, and the name partners see if one is set. */
export const dealSubLabel = (
  d: { partner_display_name?: string | null; acp_ref_no?: string | null } | null | undefined,
) =>
  [d?.acp_ref_no, d?.partner_display_name ? `Partners see “${d.partner_display_name}”` : null]
    .filter(Boolean)
    .join(" · ");
