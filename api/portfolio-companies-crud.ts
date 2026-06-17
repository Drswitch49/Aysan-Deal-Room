/**
 * API endpoint for Portfolio Company CRUD operations
 * POST /api/portfolio-companies - Create company
 * GET /api/portfolio-companies - List all companies
 * GET /api/portfolio-companies?status=Active - Filter by status
 * GET /api/portfolio-companies/:id - Get company by ID
 * PATCH /api/portfolio-companies/:id - Update company
 */

import {
  createPortfolioCompany,
  getPortfolioCompany,
  updatePortfolioCompany,
  getAllPortfolioCompanies,
  getActivePortfolioCompanies
} from "../src/lib/crud.js";
import {
  extractUserFromRequest,
  requirePermission
} from "../src/lib/rbac.js";
import {
  auditPortfolioCompanyCreated,
  auditPortfolioCompanyUpdated,
  auditPortfolioCompanyArchived
} from "../src/lib/audit.js";
import type { CreatePortfolioCompanyInput } from "../src/types/entities.js";

export default async function handler(req: any, res: any) {
  const user = extractUserFromRequest(req);
  const ipAddress = req.headers["x-forwarded-for"] || req.connection?.remoteAddress;

  try {
    // GET /api/portfolio-companies - List all or filter by status
    if (req.method === "GET") {
      const { id, status } = req.query;

      if (id) {
        // Get single company
        const company = await getPortfolioCompany(id);
        if (!company) {
          return res.status(404).json({ error: "Portfolio company not found" });
        }
        return res.status(200).json(company);
      }

      if (status === "Active") {
        // Get active companies
        const companies = await getActivePortfolioCompanies();
        return res.status(200).json(companies);
      }

      // Get all companies
      const companies = await getAllPortfolioCompanies();
      return res.status(200).json(companies);
    }

    // POST /api/portfolio-companies - Create company
    if (req.method === "POST") {
      requirePermission(user, "manage_portfolio", "You don't have permission to manage portfolio companies");

      const body: CreatePortfolioCompanyInput = req.body;

      // Validate required fields
      if (!body.companyName || !body.industry || !body.location || !body.status) {
        return res.status(400).json({
          error: "Missing required fields: companyName, industry, location, status"
        });
      }

      const company = await createPortfolioCompany(body);

      // Log audit event
      if (user) {
        await auditPortfolioCompanyCreated(company.id, company.companyName, user.id, ipAddress);
      }

      return res.status(201).json(company);
    }

    // PATCH /api/portfolio-companies/:id - Update company
    if (req.method === "PATCH") {
      const { id } = req.query;
      requirePermission(user, "manage_portfolio", "You don't have permission to manage portfolio companies");

      if (!id) {
        return res.status(400).json({ error: "Company ID is required" });
      }

      const body: Partial<CreatePortfolioCompanyInput> = req.body;
      const company = await updatePortfolioCompany(id, body);

      // Log audit event
      if (user) {
        // Check if archiving
        if (body.status === "Archived") {
          await auditPortfolioCompanyArchived(company.id, company.companyName, user.id, ipAddress);
        } else {
          await auditPortfolioCompanyUpdated(company.id, company.companyName, user.id, body, ipAddress);
        }
      }

      return res.status(200).json(company);
    }

    // Method not allowed
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error("[API] Error:", error);

    if (error.message.includes("Authentication required")) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (error.message.includes("Permission denied")) {
      return res.status(403).json({ error: error.message });
    }

    return res.status(500).json({
      error: error.message || "Internal server error"
    });
  }
}
