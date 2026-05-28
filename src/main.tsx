import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, RouterProvider, createBrowserRouter } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { DealDetailPage } from "./pages/DealDetailPage";
import { DealListPage } from "./pages/DealListPage";
import { LenderDealPage } from "./pages/LenderDealPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/deals" replace /> },
      { path: "deals", element: <DealListPage /> },
      { path: "deals/:ref", element: <DealDetailPage /> },
      { path: "lender/:ref", element: <LenderDealPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
