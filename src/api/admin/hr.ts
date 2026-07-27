/** Admin client — HR: team members, hiring briefs, stakeholders, shareholders. */
import { api, type Paginated } from "../http";
import { type Row, mapKeys } from "./_shared";

export async function fetchHrRegistry(): Promise<{
  team: any[];
  hires: any[];
  stakeholders: any[];
  shareholders: any[];
}> {
  const [team, hiring, stakeholders, shareholders] = await Promise.all([
    api.get<Paginated<Row>>("/api/team-members?limit=200"),
    api.get<Paginated<Row>>("/api/hiring-briefs?limit=200"),
    api.get<Paginated<Row>>("/api/stakeholders?limit=200"),
    api.get<Paginated<Row>>("/api/shareholders?limit=200").catch(() => ({ rows: [] as Row[] })),
  ]);
  return {
    team: team.rows.map((r) => ({
      id: r.id,
      initials: r.initials ?? "",
      name: r.name ?? "",
      role: r.role ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      loginLink: r.login_link ?? "",
      status: r.status ?? "active",
      createdAt: r.created_at ?? "",
      lastLogin: "",
      accessLevel: r.access_level ?? "",
      avatarTheme: r.avatar_theme ?? "",
    })),
    hires: hiring.rows.map((r) => ({
      id: r.id,
      role: r.role ?? "",
      company: r.company ?? "",
      status: r.status_text ?? "",
      statusText: r.status_text ?? "",
      accentColor: r.accent_color ?? "",
      createdAt: r.created_at ?? "",
    })),
    stakeholders: stakeholders.rows.map((r) => ({
      id: r.id,
      name: r.name ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      association: r.association ?? r.organization ?? "",
      type: r.type ?? "",
      accentColor: r.accent_color ?? "",
      description: r.description ?? "",
      status: r.status ?? "active",
      loginLink: r.login_link ?? "",
      createdAt: r.created_at ?? "",
      lastLogin: "",
    })),
    shareholders: (shareholders.rows ?? []).map((r) => ({
      id: r.id,
      name: r.name ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      notes: r.notes ?? "",
      status: r.status ?? "active",
      loginLink: "",
      createdAt: r.created_at ?? "",
      lastLogin: r.last_login_at ?? "",
    })),
  };
}

export async function addHiringBrief(data: { role: string; company?: string; statusText?: string; accentColor?: string }) {
  return api.post<Row>("/api/hiring-briefs", {
    role: data.role,
    company: data.company,
    status_text: data.statusText,
    accent_color: data.accentColor,
  });
}

export async function deleteHiringBrief(id: string) {
  return api.del<Row>(`/api/hiring-briefs/${encodeURIComponent(id)}`);
}

/** Legacy record-shaped team list ({ id, fields: {Name, …} }) for old pages. */
export async function fetchTeamMemberRecords(): Promise<Array<{ id: string; fields: Row }>> {
  const page = await api.get<Paginated<Row>>("/api/team-members?limit=200");
  return page.rows.map((r) => ({
    id: r.id,
    fields: {
      Name: r.name,
      Role: r.role,
      Status: (r.status ?? "active").toLowerCase() === "inactive" ? "Inactive" : "Active",
      Access_Level: r.access_level,
      Email: r.email,
      Initials: r.initials,
    },
  }));
}

export interface TeamMemberPayload {
  name: string;
  role?: string;
  accessLevel?: string;
  email?: string;
  phone?: string;
  status?: string;
}

export async function createTeamMember(data: TeamMemberPayload) {
  return api.post<Row>("/api/team-members", {
    name: data.name,
    role: data.role,
    access_level: data.accessLevel,
    email: data.email,
    phone: data.phone,
    status: (data.status ?? "active").toLowerCase(),
    initials: data.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
  });
}

export async function updateTeamMember(memberId: string, fields: Row) {
  const map: Record<string, string> = {
    Name: "name", Role: "role", Access_Level: "access_level", Email: "email",
    Phone: "phone", Status: "status", Initials: "initials", Avatar_Theme: "avatar_theme", Order: "sort_order",
  };
  return api.patch<Row>(`/api/team-members/${encodeURIComponent(memberId)}`, mapKeys(fields, map));
}

export interface StakeholderPayload {
  name: string;
  association?: string;
  description?: string;
  type?: string;
  email?: string;
  phone?: string;
  organization?: string;
  notes?: string;
  status?: string;
}

export async function createStakeholder(data: StakeholderPayload) {
  return api.post<Row>("/api/stakeholders", {
    name: data.name,
    association: data.association,
    description: data.description,
    type: data.type,
    email: data.email,
    phone: data.phone,
    organization: data.organization,
    notes: data.notes,
    status: (data.status ?? "active").toLowerCase(),
  });
}

export async function updateStakeholder(stakeholderId: string, fields: Row) {
  const map: Record<string, string> = {
    Name: "name", Association: "association", Description: "description", Type: "type", Email: "email",
    Phone: "phone", Organization: "organization", Notes: "notes", Status: "status", Accent_Color: "accent_color", Company: "company",
  };
  return api.patch<Row>(`/api/stakeholders/${encodeURIComponent(stakeholderId)}`, mapKeys(fields, map));
}
