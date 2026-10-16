# Deploy and IRIS setup

How the app runs against IRIS, locally and in Azure (slice S7, Q-I8). Storage design: [data-model.md](data-model.md); conventions: PER-* in [data.md](conventions/data.md).

## Which repository the API uses (Q-I13)

| `.env` | Repository | Seed |
|---|---|---|
| no `ONKO_IRIS_CONNECTION_STRING` | `InMemoryRepository` | reference case on every start |
| `ONKO_IRIS_CONNECTION_STRING` set | `IrisRepository`: app state in IRIS SQL (schema `ONKO_IRIS_SCHEMA`, default `onko`) | reference case only when IRIS holds no case yet, so restarts keep the demo state |
| + `ONKO_FHIR_BASE_URL` set | the same, plus the FHIR projection pushed on every save | |

`GET /health` reports `iris_configured` and `fhir_pending` (FHIR writes still in the outbox, D-14). API tests always use the in-memory fake (`apps/api/tests/conftest.py`), even when your `.env` points at IRIS.

## Testing against IRIS

The repository contract tests and the FHIR round trip run against the IRIS in your `.env` only on request (they're skipped otherwise):

```bash
ONKO_TEST_IRIS=1 uv run pytest packages/repository
```

In GitHub, the same tests run from the manual *IRIS tests* workflow (Actions → IRIS tests → Run workflow, `.github/workflows/iris.yml`). It needs the repository secrets `ONKO_IRIS_CONNECTION_STRING`, `ONKO_FHIR_BASE_URL`, `ONKO_FHIR_USERNAME` and `ONKO_FHIR_PASSWORD`, and the IRIS firewall must let GitHub-hosted runners in (TEST-12).

The contract tests write to a throwaway schema `test_<user>_<random>` and drop it afterwards. The FHIR round trip writes ids prefixed `test-` (PER-10).

## IG packages (Q-I6)

```bash
uv run python scripts/fhir_packages.py download
```

This downloads the packages from data-model.md › Packages into `fhir-packages/` (git-ignored). Loading them into the FHIR server is described in `scripts/fhir_packages.py`. If loading fails (the known `cz.terminology` 0.3.0 gap), resources keep declaring `meta.profile` without server-side validation (Q-I6, Q-I7).

## Azure (demo)

One container serves the API under `/api` and the built web app at `/` (`onko_api.serve`, the same layout as the Vite dev proxy). It runs on Azure Container Apps next to the shared IRIS.

You need:
- the Azure CLI and `az login` with rights to create a resource group and a Container App;
- a filled-in `.env` with the **Azure** IRIS values (Q-I2);
- the IRIS instance reachable from Azure Container Apps (firewall / allowed IPs);
- if IRIS requires TLS: an SSL configuration named in `ONKO_IRIS_SSL_CONFIG`, which the driver reads from the file `ISC_SSLconfigurations` points to. Not set up in the image yet; add it when we know the instance's TLS setup.

```bash
ONKO_AZ_RESOURCE_GROUP=onko-demo ./scripts/deploy_azure.sh
```

The script:
- builds the `Dockerfile` in Azure (ACR) and creates or updates the Container App (`ONKO_AZ_APP`, default `onko-koordinace`);
- forwards every `ONKO_*` value from `.env`, storing passwords, API keys and connection strings as Container Apps secrets;
- pins the app to one replica (the demo clock and the job runner live in the process).

It prints the public URL; the API answers at `/api/health`. Re-run it to deploy a new version.
