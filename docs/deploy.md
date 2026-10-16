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
- the Azure CLI (with the `containerapp` extension) and `az login` with Contributor on the resource group. The team has one, `rg-team82` in `swedencentral`, the same group and region as the IRIS container `aci-irishealth-team82`;
- a filled-in `.env` with the **Azure** IRIS values (Q-I2);
- the IRIS instance reachable from Azure Container Apps (firewall / allowed IPs);
- if IRIS requires TLS: an SSL configuration named in `ONKO_IRIS_SSL_CONFIG`, which the driver reads from the file `ISC_SSLconfigurations` points to. Not set up in the image yet; add it when we know the instance's TLS setup.

```bash
ONKO_AZ_RESOURCE_GROUP=rg-team82 ONKO_AZ_LOCATION=swedencentral ./scripts/deploy_azure.sh
```

The script:
- builds the `Dockerfile` in Azure (`az acr build` into the group's registry, created if there is none) and creates or updates the Container App (`ONKO_AZ_APP`, default `onko-koordinace`);
- lets the app pull with the registry's admin login: granting it AcrPull would be a role assignment, which team accounts can't make (that's also why it doesn't use `az containerapp up`);
- forwards every `ONKO_*` value from `.env`, storing passwords, API keys and connection strings as Container Apps secrets;
- pins the app to one replica (the demo clock and the job runner live in the process).

It prints the public URL; the API answers at `/api/health`. Re-run it to change settings; new versions ship through CD.

## Continuous deployment (Q-K10)

`.github/workflows/cd.yml` runs after *CI* passes on a push to `main`, or by hand (Actions → CD → Run workflow). It:
- builds the `Dockerfile` on the runner and pushes `<registry>/<app>:<commit sha>` to the registry the Container App already uses (the ACR `deploy_azure.sh` created);
- rolls out a new revision with that image. Settings and secrets stay on the Container App, so change them with `deploy_azure.sh`;
- fails unless `/api/health` answers within 5 minutes.

The IRIS instance isn't touched: it already runs in Azure.

One-time setup:
1. Deploy once with `deploy_azure.sh`, so the app and its registry exist.
2. Create a user-assigned managed identity for GitHub (`onko-github-cd` in `rg-team82`) and add a federated credential: issuer `https://token.actions.githubusercontent.com`, subject `repo:hackathon-green-snail-77/fits:environment:azure-demo`, audience `api://AzureADTokenExchange`. Contributor on the group is enough for this.
3. Give the identity **Contributor** on `rg-team82` (that covers pushing to the registry in the same group). Assigning roles needs Owner or User Access Administrator, which team accounts don't have: the subscription owner runs this step. The identity can then also change the IRIS container, which shares the group.
4. In GitHub → Settings → Environments, create `azure-demo` with the secrets `AZURE_CLIENT_ID` (the identity's client ID), `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` and the variable `ONKO_AZ_RESOURCE_GROUP` (and `ONKO_AZ_APP` if it isn't `onko-koordinace`). Add required reviewers there if a deploy should wait for approval.

Until step 3 is done, re-run `deploy_azure.sh` to ship a new version.
