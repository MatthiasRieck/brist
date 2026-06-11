import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import App from "./App";
import { RepoPage } from "./pages/RepoPage";
import { HeaderProvider } from "./contexts/HeaderContext";
import { SyncProvider } from "./contexts/SyncContext";

function RootComponent() {
  return (
      <HeaderProvider>
        <SyncProvider>
          <App />
        </SyncProvider>
      </HeaderProvider>
  );
}

const rootRoute = createRootRoute({ component: RootComponent });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => null,
});

export const repoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repo",
  validateSearch: (search: Record<string, unknown>) => ({
    path: (search.path as string) ?? "",
  }),
  component: RepoPage,
});

export const routeTree = rootRoute.addChildren([indexRoute, repoRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
