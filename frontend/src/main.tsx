import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./index.css";
import { router } from "./router";
import { createQueryClient } from "./api/queryClient";
import { AuthGate } from "./components/AuthGate";

const queryClient = createQueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate><RouterProvider router={router} /></AuthGate>
    </QueryClientProvider>
  </StrictMode>,
);
