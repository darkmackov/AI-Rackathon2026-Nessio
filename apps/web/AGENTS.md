# AI rules: web (`apps/web`)

Root rules: [AGENTS.md](../../AGENTS.md). Conventions: [docs/conventions/](../../docs/conventions).

**Owns:** The React app: the screens from docs/product.md.

**May depend on:** the API over HTTP, only through the generated client in `src/client`.

**Rules:**
- Read [web.md](../../docs/conventions/web.md) and [ui-ux.md](../../docs/conventions/ui-ux.md) before any change.
- **Use the existing API models.** Before touching API data, read `src/client/types.gen.ts` and the endpoint in [api.md](../../docs/api.md). Type all API data with the generated types (`Case`, `Handover`, `CaseUpdate`, …), and never redeclare, copy or cast them (WEB-2, WEB-3).
- Call the API only through `src/client/@tanstack/react-query.gen.ts` (`useQuery(xxxOptions())`, `useMutation(xxxMutation())`). No `fetch`, no raw SDK calls in components (WEB-1).
- Data a screen needs but no API model has → change the contract in the backend and regenerate. Never fake it in a screen. Q-W6 permits contract-shaped MSW fixtures at the HTTP boundary for the explicitly labelled S0 demo; Q-W14 extends this to S4, Q-W16 to S6, Q-W17 to S8 and Q-W18 to S9 (WEB-4). Business rules belong in MSW, never in screens.
- Slow AI work returns a `Job`: poll it with `useQuery` + `refetchInterval`, never timers or effects (WEB-19). Send `X-Actor-Id` as api.md requires (WEB-20).
- **No `useEffect`**, `useLayoutEffect` or `useInsertionEffect` (WEB-10). Use the replacement table in web.md, and ask if none fits.
- Function components only. Use Mantine components, forms and theming for everything they offer (Q-W1, WEB-9).
- No business rules in the browser (WEB-6). Server state only in TanStack Query (WEB-11).
- UI/UX: show `Sourced` status and origin, label AI proposals, cover all four data states, follow the product.md action names, meet WCAG 2.2 AA (UX-*, A11Y-*).
- Never edit `src/client/**`. Before finishing, `npm test`, `npm run build` and `npm run lint` pass.
