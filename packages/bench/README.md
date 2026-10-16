# bench (stream B)

Scores every candidate model slot on every reference case → leaderboard. Used to pick the **one** model the app runs on (Q-M1). A second synthetic reference case (another diagnosis) is part of Phase 1 (Q-M4). Metrics are listed in `src/onko_bench/__init__.py`.

**Done when:** `uv run onko-bench` writes `bench-results/leaderboard.csv` for the VZP reference case.
