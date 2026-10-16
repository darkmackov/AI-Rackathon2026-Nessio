# AI rules: web (`apps/web`)

Root rules: [AGENTS.md](../../AGENTS.md). Conventions: [docs/conventions/](../../docs/conventions).

**Owns:** The React app: the screens from docs/product.md.

**May depend on:** the API over HTTP, only through the generated client in `src/client`.

**Rules:**
- Read [web.md](../../docs/conventions/web.md) and [ui-ux.md](../../docs/conventions/ui-ux.md) before any change.
- **Use the existing DTOs.** Before touching API data, read `src/client/types.gen.ts`. Type all API data with the generated `XxxDto` types, and never redeclare, copy or cast them (WEB-2, WEB-3).
- Call the API only through `src/client/@tanstack/react-query.gen.ts` (`useQuery(xxxOptions())`, `useMutation(xxxMutation())`). No `fetch`, no raw SDK calls in components (WEB-1).
- Data a screen needs but no DTO has → extend the backend DTO and regenerate. Never fake it (WEB-4).
- **No `useEffect`**, `useLayoutEffect` or `useInsertionEffect` (WEB-10). Use the replacement table in web.md, and ask if none fits.
- Function components only. Use UI-library components for everything they offer. Until one is chosen (Q-W1), use semantic HTML and add no UI library (WEB-9).
- No business rules in the browser (WEB-6). Server state only in TanStack Query (WEB-11).
- UI/UX: show `SourcedDto` status, label AI proposals, cover all four data states, follow the product.md action names, meet WCAG 2.2 AA (UX-*, A11Y-*).
- Never edit `src/client/**`. Before finishing, `npm run build` and `npm run lint` pass.
