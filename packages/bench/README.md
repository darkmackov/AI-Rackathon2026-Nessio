# bench (stream B)

Scores every candidate model slot on every reference case → leaderboard. Used to pick the **one** model the app runs on (Q-M1). A second synthetic reference case (another diagnosis) is part of Phase 1 (Q-M4). Metrics are listed in `src/onko_bench/__init__.py`.

**Done when:** `uv run onko-bench` writes `bench-results/<time>/leaderboard.csv` over every reference case in `data/`. Done; the 16. 10. 2026 result and the chosen model are in open-questions.md (Q-M1).
