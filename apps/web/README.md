# web (stream E)

React + Vite + TypeScript, Czech + English UI (Q-F20). Screens per [docs/product.md](../../docs/product.md). `/api` is proxied to FastAPI on :8000. The API client in `src/client` (API types + TanStack Query options) is generated (`npm run gen:api`); don't edit it by hand. Data loads through TanStack Query, never `useEffect`. Rules: [web.md](../../docs/conventions/web.md), [ui-ux.md](../../docs/conventions/ui-ux.md).

Today: a placeholder coordinator kanban (`src/screens/CoordinatorDashboard.tsx`) fed by the seeded reference case.
