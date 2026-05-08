import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  RouterProvider,
  createRouter,
  createMemoryHistory,
} from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

// Electron loads via file:// — use memory history so the router doesn't try to
// parse a file path as a URL, and skip the SSR shell (html/body wrapper).
const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
  context: {},
  scrollRestoration: true,
  defaultPreloadStaleTime: 0,
  defaultNotFoundComponent: () => (
    <div style={{ padding: 32 }}>
      <h1>404</h1>
      <a href="#" onClick={(e) => { e.preventDefault(); router.navigate({ to: "/" }); }}>
        Go home
      </a>
    </div>
  ),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
