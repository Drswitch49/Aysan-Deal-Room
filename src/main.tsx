import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, RouterProvider, createBrowserRouter } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { AdminGuard } from "./components/layout/AdminGuard";
import { DealDetailPage } from "./pages/DealDetailPage";
import { DealListPage } from "./pages/DealListPage";
import { LenderManagementPage } from "./pages/LenderManagementPage";
import { LenderPortalPage } from "./pages/LenderPortalPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <AdminGuard>
        <AppLayout />
      </AdminGuard>
    ),
    children: [
      { index: true, element: <Navigate to="/deals" replace /> },
      { path: "deals", element: <DealListPage /> },
      { path: "deals/:ref", element: <DealDetailPage /> },
      { path: "admin/lenders", element: <LenderManagementPage /> },
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
