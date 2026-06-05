import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, RouterProvider, createBrowserRouter } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { AdminGuard } from "./components/layout/AdminGuard";
import { DealDetailPage } from "./pages/DealDetailPage";
import { DealListPage } from "./pages/DealListPage";
import { LenderManagementPage } from "./pages/LenderManagementPage";
import { LenderPortalPage } from "./pages/LenderPortalPage";
import { AdminMessagesPage } from "./pages/AdminMessagesPage";
import { DashboardPage } from "./pages/DashboardPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PortCoMonitorPage } from "./pages/PortCoMonitorPage";
import { HrStakeholdersPage } from "./pages/HrStakeholdersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { getDeals } from "./api/airtable";
import "./styles.css";

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
      <div className="flex min-h-screen items-center justify-center bg-[#0A0A0B] text-slate-400">
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
      { index: true, element: <DashboardPage /> },
      { path: "deals", element: <DealListPage /> },
      { path: "deals/current", element: <CurrentDealRedirect /> },
      { path: "deals/:ref", element: <DealDetailPage /> },
      { path: "admin/lenders", element: <LenderManagementPage /> },
      { path: "admin/portco", element: <PortCoMonitorPage /> },
      { path: "admin/hr", element: <HrStakeholdersPage /> },
      { path: "admin/settings", element: <SettingsPage /> },
      { path: "admin/messages", element: <AdminMessagesPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    path: "portal/:portalSlug",
    element: <LenderPortalPage />,
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
