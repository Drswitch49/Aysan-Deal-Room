# Router Integration Guide

## Add These Routes to `src/main.tsx`

Add the following imports at the top with the other lazy-loaded components:

```typescript
// Add these lines with the other lazy imports:
const CreateDealPage = lazy(() => import("./pages/CreateDealPage").then(m => ({ default: m.CreateDealPage })));
const EditDealPage = lazy(() => import("./pages/EditDealPage").then(m => ({ default: m.EditDealPage })));
const PortfolioManagementPage = lazy(() => import("./pages/PortfolioManagementPage").then(m => ({ default: m.PortfolioManagementPage })));
const TeamManagementPage = lazy(() => import("./pages/TeamManagementPage").then(m => ({ default: m.TeamManagementPage })));
const StakeholderManagementPage = lazy(() => import("./pages/StakeholderManagementPage").then(m => ({ default: m.StakeholderManagementPage })));
```

## Update the Routes Array

Add these routes to the children array in the main router (under the `/` path):

```typescript
// Add these routes to the children array:
{ path: "deals/create", element: withSuspense(CreateDealPage) },
{ path: "deals/:id/edit", element: withSuspense(EditDealPage) },
{ path: "admin/portfolio", element: withSuspense(PortfolioManagementPage) },
{ path: "admin/team", element: withSuspense(TeamManagementPage) },
{ path: "admin/stakeholders", element: withSuspense(StakeholderManagementPage) },
```

## Updated Router Structure

Your router should look like this:

```typescript
const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <AdminGuard>
        <AppLayout />
      </AdminGuard>
    ),
    children: [
      { index: true, element: withSuspense(DashboardPage) },
      { path: "deals", element: withSuspense(DealListPage) },
      { path: "deals/create", element: withSuspense(CreateDealPage) },           // NEW
      { path: "deals/current", element: <CurrentDealRedirect /> },
      { path: "deals/:ref", element: withSuspense(DealDetailPage) },
      { path: "deals/:id/edit", element: withSuspense(EditDealPage) },           // NEW
      { path: "admin/lenders", element: withSuspense(LenderManagementPage) },
      { path: "admin/portfolio", element: withSuspense(PortfolioManagementPage) }, // NEW
      { path: "admin/portco", element: withSuspense(PortCoMonitorPage) },
      { path: "admin/team", element: withSuspense(TeamManagementPage) },         // NEW
      { path: "admin/hr", element: withSuspense(HrStakeholdersPage) },
      { path: "admin/stakeholders", element: withSuspense(StakeholderManagementPage) }, // NEW
      { path: "admin/settings", element: withSuspense(SettingsPage) },
      { path: "admin/messages", element: withSuspense(AdminMessagesPage) },
      { path: "*", element: withSuspense(NotFoundPage) },
    ],
  },
  {
    path: "portal/:portalSlug",
    element: withSuspense(LenderPortalPage),
  },
  {
    path: "*",
    element: withSuspense(NotFoundPage),
  },
]);
```

## Navigation Links to Add

### In Navigation/Sidebar
Add links to the new management pages:

```typescript
// Portfolio Management
<Link to="/admin/portfolio">Portfolio Companies</Link>

// Team Management
<Link to="/admin/team">Team Members</Link>

// Stakeholder Management
<Link to="/admin/stakeholders">Stakeholders</Link>
```

### In Deal List Page
Add "Create Deal" button:

```typescript
<Link to="/deals/create" className="btn btn-primary">
  + Create Deal
</Link>
```

### In Deal Detail Page
Add "Edit Deal" button:

```typescript
<Link to={`/deals/${dealId}/edit`} className="btn btn-primary">
  Edit Deal
</Link>
```

## Optional: Schema Initialization

To ensure Airtable schema is created on app startup, add this to a useEffect in your main App component or AppLayout:

```typescript
import { ensureSchema } from "./lib/airtable/schema-manager";

useEffect(() => {
  // Optionally ensure schema on app load
  ensureSchema().catch(err => console.error("Schema initialization failed:", err));
}, []);
```

## Note on Route Parameters

- `/deals/create` - Create a new deal
- `/deals/:ref` - View deal (existing, uses deal reference)
- `/deals/:id/edit` - Edit deal (uses Airtable record ID)

The edit route accepts the Airtable record ID (not the deal reference).
