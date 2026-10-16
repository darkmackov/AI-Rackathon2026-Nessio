# llm-gateway (stream B)

One client for our OpenAI-compatible endpoints. Candidate slots come from env (`.env.example`); the app uses **one active model** picked with the bench (Q-M1) plus one embedding model (Q-M2). No rate limiting (Q-M3).

**Done when:**
- [ ] `complete()` with structured output in whatever mode the chosen model supports, plus validation
- [ ] `embed()`
- [ ] Timeouts, a cache keyed by prompt+model, a per-call log (tokens, latency)
