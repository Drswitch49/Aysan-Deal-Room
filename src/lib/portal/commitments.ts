/** Shared rules for the commitment screens (partner record and deal page). */

/** Statuses the portal shows. Pending commitments stay invisible to the partner. */
export const IN_PORTAL = new Set(["completed", "converted", "bought_back"]);

/** How a deal is named on admin screens: the partner-facing name first. */
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
) => d?.partner_display_name || d?.company_name || d?.deal_name || d?.acp_ref_no || "Deal";
