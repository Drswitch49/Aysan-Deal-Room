# ACP Deal OS — Full CRUD Deployment Guide

## What's New

This update transforms ACP Deal OS from a read-only display interface into a fully operational transaction management platform with:

- ✅ **Complete CRUD Operations**: Create, read, update, delete for all entities
- ✅ **Automatic Airtable Schema Management**: Tables and fields created automatically
- ✅ **Immutable Audit Logging**: Every action logged for compliance
- ✅ **Server-Side RBAC**: Real role-based access control (not cosmetic)
- ✅ **8 Complete Phases**: Deal creation through audit logging
- ✅ **Premium Dark Theme UI**: Institutional-grade interface

## Quick Start

### 1. Deploy the Code
```bash
npm run build
vercel deploy
```

### 2. Enable New Routes
The routes are already configured in `src/main.tsx`, but if you need to customize them, see `ROUTER_INTEGRATION.md`.

### 3. First Run
When any user accesses the app for the first time:
1. Airtable schema is automatically validated
2. Missing tables are created (Deals, Portfolio_Companies, etc.)
3. Missing fields are created with correct types
4. System is ready to use

No manual Airtable configuration needed.

## New Pages & URLs

### Deal Management
- `/deals` - Pipeline view (existing)
- `/deals/create` - **NEW** Create deal form
- `/deals/:ref` - Deal detail (existing)
- `/deals/:id/edit` - **NEW** Edit deal form

### Portfolio Management
- `/admin/portfolio` - **NEW** Portfolio company CRUD

### Team Management
- `/admin/team` - **NEW** Team member CRUD

### Stakeholder Management
- `/admin/stakeholders` - **NEW** Stakeholder CRUD

## API Endpoints

All new endpoints are in the `api/` directory:

```
/api/deals-crud              - Deal operations
/api/deals-stages            - Stage management
/api/portfolio-companies-crud - Portfolio management
/api/team-members-crud       - Team member operations
/api/stakeholders-crud       - Stakeholder operations
/api/im-documents-crud       - Document management
/api/audit-logs              - Audit log viewing
```

### Authentication

All endpoints require Bearer token in Authorization header:
```
Authorization: Bearer {jwt_token}
```

The token payload should include:
```json
{
  "sub": "user_id",
  "email": "user@example.com",
  "name": "User Name",
  "role": "Managing Partner",
  "status": "Active"
}
```

### Roles & Permissions

**Roles**:
- Managing Partner: Full access to all operations
- Partner: Deal CRUD, portfolio management, stakeholder management
- Analyst: Deal CRUD, stage changes, document uploads
- Admin: Full access to all operations
- Read Only: View-only access

**Permission Checks** are enforced server-side. Users without permission receive 403 Forbidden.

## Airtable Tables Auto-Created

These tables are created automatically on first use:

1. **Deals** - Main deal records
2. **Portfolio_Companies** - Portfolio holdings
3. **ACP_Team** - Team members
4. **External_Stakeholders** - Advisors, lawyers, brokers, etc.
5. **Deal_Stage_History** - Deal progression timeline
6. **Audit_Logs** - Immutable action log
7. **IM_Review_Documents** - Investment memoranda

All tables include:
- Proper Airtable field types
- Required and optional fields
- Timestamps for created/updated tracking

## Important Changes

### ❌ REMOVED
- Manual Airtable data entry (all operations through UI)
- Multiple "Add Deal" entry points (only one on pipeline page)

### ✅ ADDED
- Deal creation form (8 sections, all required fields)
- Deal editing capability (full fields editable)
- Portfolio company management (add, edit, archive)
- Team member management (add, edit, activate/deactivate)
- Stakeholder management (add, edit, archive)
- Stage management (track stage changes with history)
- IM document tracking (upload, delete, track)
- Complete audit trail (all operations logged)

### 🔄 UNCHANGED
- Existing deal detail page (still works)
- Lender management (still works)
- Existing navigation and layout

## User Workflows

### Create a Deal
1. Click "+ Create Deal" button on pipeline page
2. Fill in 8 sections of deal form
3. Submit to create deal
4. System generates deal reference (e.g., ACP-2026-001)
5. Deal appears in pipeline at "Inbound" stage

### Edit a Deal
1. Open deal detail page
2. Click "Edit Deal" button
3. Update any fields
4. Submit changes
5. Changes saved to Airtable
6. Audit log created

### Change Deal Stage
1. Open deal detail page
2. Click on current stage
3. Select new stage from list
4. Stage history created
5. Audit event recorded

### Manage Portfolio
1. Go to `/admin/portfolio`
2. View all portfolio companies
3. Click "+ Add Company" to create
4. Click edit icon to modify
5. Click archive icon to archive
6. Active/All filter available

### Manage Team
1. Go to `/admin/team`
2. View all team members in table
3. Click "+ Add Member" to invite
4. Click edit icon to update role/status
5. Click power icon to activate/deactivate

### Manage Stakeholders
1. Go to `/admin/stakeholders`
2. View stakeholders by type (filter available)
3. Click "+ Add Stakeholder"
4. Click edit icon to modify
5. Click archive icon to archive

## Security Notes

✅ **Authentication Required**
- JWT token in Authorization header
- User info extracted from token

✅ **Server-Side Authorization**
- Permissions checked on every request
- 403 Forbidden returned if user lacks permission
- Not cosmetic, actual access control

✅ **Audit Logging**
- All operations logged to Audit_Logs table
- Cannot be deleted (immutable)
- Captures: user, timestamp, IP, action, changes

✅ **Field Validation**
- Required fields enforced on create
- Email validation on contact fields
- File type validation on uploads (PDF, DOCX, XLSX)

## Environment Variables

Required (already configured):
- `AIRTABLE_API_KEY` or `VITE_AIRTABLE_API_KEY`
- `AIRTABLE_BASE_ID` or `VITE_AIRTABLE_BASE_ID`

Optional:
- `ENABLE_SCHEMA_AUTO_CREATE` (default: true)

## Troubleshooting

### "Authentication required"
- Check Authorization header is present
- Verify JWT token format: Bearer {token}
- Ensure token is not expired

### "Permission denied"
- Check user role in JWT token
- Verify user status is "Active"
- Consult RBAC permissions table

### Airtable table errors
- Check Airtable API key has write permissions
- Verify base ID is correct
- Check API key scopes include table/field creation

### Schema not auto-creating
- Check API key permissions include metadata access
- Verify base exists and is accessible
- Check Airtable API rate limits (120 req/min)

## Support

For issues or questions:
1. Check IMPLEMENTATION_SUMMARY.md for complete feature list
2. Check ROUTER_INTEGRATION.md for route configuration
3. Review API endpoint specifications in IMPLEMENTATION_SUMMARY.md
4. Check Airtable API documentation for metadata operations

## Production Checklist

Before going live:

- [ ] Environment variables configured
- [ ] Vercel deployment successful
- [ ] TypeScript build passes (`npm run build`)
- [ ] Test all new pages load correctly
- [ ] Test CRUD operations with test user
- [ ] Verify audit logs are created
- [ ] Check RBAC enforcement (test as different roles)
- [ ] Verify Airtable schema created correctly
- [ ] Test stage changes create history
- [ ] Verify documents upload/delete
- [ ] Check error messages are helpful
- [ ] Mobile-responsive testing
- [ ] Performance testing on slow connections

## Rollback Plan

If issues arise:
1. Revert to previous Vercel deployment
2. No data loss (Airtable remains intact)
3. Previous read-only functionality still works

## Next Steps

1. **Navigation Integration**: Add links to new pages in main navigation
2. **Testing**: Manual QA of all CRUD workflows
3. **Training**: Ensure team understands new workflows
4. **Monitoring**: Watch audit logs for unusual patterns
5. **Optimization**: Based on usage patterns, optimize queries

## Support Contact

For technical support or questions about the implementation:
- Review IMPLEMENTATION_SUMMARY.md for complete feature documentation
- Check API endpoint specifications
- Review RBAC roles and permissions

---

**Status**: ✅ Implementation Complete
**TypeScript Build**: ✅ Passing  
**Routes**: ✅ Configured
**Ready for Deployment**: ✅ Yes
