# api (stream E)

FastAPI, thin over the modules, models from `onko_contracts`. Runs with uvicorn; IRIS (Azure) is reached through `onko_repository`. Route function names become the generated client's function names (`generate_unique_id_function`), so name them well.

**Done when:** routes for every screen in docs/product.md (upload, validate, request, tasks, MDT snapshot, send, confirm), plus a role switcher for the demo.
