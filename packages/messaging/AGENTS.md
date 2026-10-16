# AI rules: messaging (`onko_messaging`)

Root rules: [AGENTS.md](../../AGENTS.md). Conventions: [docs/conventions/](../../docs/conventions).

**Owns:** MDT result delivery to the GP's in-app inbox, receipts, in-app notifications, simulated patient notices. Request/reply flows are Phase 2 (Q-F23); in the MVP a request is a `Task` in `cases`.

**May depend on:** contracts, repository (port only). Import other modules only through their package root (MOD-2).

**Public API:** only what `src/*/__init__.py` lists in `__all__`. Layout: `models.py` · `ports.py` · `service.py` · `adapters/` (implementation.md › Module layout).

**Rules:**
- Each channel is an adapter in `adapters/` implementing `ports.ChannelAdapter`.
- Patient notices are recorded with `simulated=True` and never actually delivered (Q-F16).
