# src/web map

| File | What it holds | Touch when |
| --- | --- | --- |
| `App.tsx` | Hash router (`hashchange`), theme state, logout; placeholder pages; unknown hash goes to Sync Dashboard | Adding pages or routes |
| `index.css` | Tailwind theme mapping and dark (default) / light palette variables keyed on `data-theme` | Changing colours |
| `components/AppShell.tsx` | Navbar: title, three tab links with `aria-current`, Refresh, theme toggle, Log out | Changing navigation or header actions |
| `components/HealthStatus.tsx` | `/api/health` indicator | |
| `components/ui/button.tsx` | Shadcn button | |
| `lib/theme.ts` | Pure theme helpers: read/write `walley-theme` in localStorage (dark on any failure), toggle, `applyTheme` | Theme storage |
| `lib/route.ts` | `parseRoute`, `TABS` | Adding tabs |
| `lib/api.ts` | `apiRequest` (sends `x-csrf-token` from the `walley_csrf` cookie on unsafe methods), `ApiError` | Calling the API |
| `lib/utils.ts` | `cn` | |

Router is an in-house hash router; the choice of a library is an open owner question.
