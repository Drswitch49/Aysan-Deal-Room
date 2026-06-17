import { StrictMode, useEffect, useState, lazy, Suspense, ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, RouterProvider, createBrowserRouter } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { AdminGuard } from "./components/layout/AdminGuard";
import { getDeals } from "./api/airtable";
import { PipelineProvider } from "./context/PipelineContext";
import "./styles.css";

// Lazy-loaded route components
const DashboardPage = lazy(() => import("./pages/DashboardPage").then(m => ({ default: m.DashboardPage })));
const DealListPage = lazy(() => import("./pages/DealListPage").then(m => ({ default: m.DealListPage })));
const DealDetailPage = lazy(() => import("./pages/DealDetailPage").then(m => ({ default: m.DealDetailPage })));
const CreateDealPage = lazy(() => import("./pages/CreateDealPage").then(m => ({ default: m.CreateDealPage })));
const EditDealPage = lazy(() => import("./pages/EditDealPage").then(m => ({ default: m.EditDealPage })));
const LenderManagementPage = lazy(() => import("./pages/LenderManagementPage").then(m => ({ default: m.LenderManagementPage })));
const LenderPortalPage = lazy(() => import("./pages/LenderPortalPage").then(m => ({ default: m.LenderPortalPage })));
const PortCoMonitorPage = lazy(() => import("./pages/PortCoMonitorPage").then(m => ({ default: m.PortCoMonitorPage })));
const PortfolioManagementPage = lazy(() => import("./pages/PortfolioManagementPage").then(m => ({ default: m.PortfolioManagementPage })));
const HrStakeholdersPage = lazy(() => import("./pages/HrStakeholdersPage").then(m => ({ default: m.HrStakeholdersPage })));
const TeamManagementPage = lazy(() => import("./pages/TeamManagementPage").then(m => ({ default: m.TeamManagementPage })));
const StakeholderManagementPage = lazy(() => import("./pages/StakeholderManagementPage").then(m => ({ default: m.StakeholderManagementPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const AdminMessagesPage = lazy(() => import("./pages/AdminMessagesPage").then(m => ({ default: m.AdminMessagesPage })));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage").then(m => ({ default: m.NotFoundPage })));

const PageLoading = () => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center bg-[#0F1115]/50 text-slate-400">
    <div className="animate-pulse text-xs font-bold uppercase tracking-widest text-[#C6A66B]">
      Loading page...
    </div>
  </div>
);

function withSuspense(Component: ComponentType<any>) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Component />
    </Suspense>
  );
}

function CurrentDealRedirect() {
  const [redirectPath, setRedirectPath] = useState<string | null>(null);

  useEffect(() => {
    const lastRef = localStorage.getItem("admin_last_viewed_deal_ref");
    if (lastRef) {
      setRedirectPath(`/deals/${encodeURIComponent(lastRef)}`);
    } else {
      getDeals()
        .then((deals) => {
          if (deals.length > 0) {
            setRedirectPath(`/deals/${encodeURIComponent(deals[0].dealRef)}`);
          } else {
            setRedirectPath("/deals");
          }
        })
        .catch(() => {
          setRedirectPath("/deals");
        });
    }
  }, []);

  if (!redirectPath) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0F1115] text-slate-400">
        <div className="animate-pulse text-xs font-bold uppercase tracking-widest text-acp-bronze">
          Loading Active Deal...
        </div>
      </div>
    );
  }

  return <Navigate to={redirectPath} replace />;
}

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
      { path: "deals/create", element: withSuspense(CreateDealPage) },
      { path: "deals/current", element: <CurrentDealRedirect /> },
      { path: "deals/:ref", element: withSuspense(DealDetailPage) },
      { path: "deals/:id/edit", element: withSuspense(EditDealPage) },
      { path: "admin/lenders", element: withSuspense(LenderManagementPage) },
      { path: "admin/portfolio", element: withSuspense(PortfolioManagementPage) },
      { path: "admin/portco", element: withSuspense(PortCoMonitorPage) },
      { path: "admin/team", element: withSuspense(TeamManagementPage) },
      { path: "admin/hr", element: withSuspense(HrStakeholdersPage) },
      { path: "admin/stakeholders", element: withSuspense(StakeholderManagementPage) },
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PipelineProvider>
      <RouterProvider router={router} />
    </PipelineProvider>
  </StrictMode>,
);
