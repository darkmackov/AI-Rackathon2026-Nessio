#!/usr/bin/env bash
# Deploy API + web (one container, see Dockerfile) to Azure Container Apps for the demo (Q-I8).
# Run it yourself after `az login`; it never prints secret values. Details: docs/deploy.md.
#
#   ONKO_AZ_RESOURCE_GROUP=onko-demo ONKO_AZ_LOCATION=westeurope ./scripts/deploy_azure.sh
#
# App settings come from .env (repo root): every ONKO_* variable is forwarded. Values whose name
# contains PASSWORD, API_KEY or CONNECTION_STRING become Container Apps secrets (Q-I2, PER-12).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ONKO_ENV_FILE:-$ROOT/.env}"
RG="${ONKO_AZ_RESOURCE_GROUP:?set ONKO_AZ_RESOURCE_GROUP}"
LOCATION="${ONKO_AZ_LOCATION:-westeurope}"
APP="${ONKO_AZ_APP:-onko-koordinace}"
ENVIRONMENT="${ONKO_AZ_ENVIRONMENT:-$APP-env}"

command -v az >/dev/null || { echo "Install the Azure CLI and run az login first" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE; copy .env.example and fill it in" >&2; exit 1; }

secrets=()
env_vars=()
while IFS= read -r line || [ -n "$line" ]; do
  [[ "$line" =~ ^(ONKO_[A-Z0-9_]+)=(.*)$ ]] || continue
  name="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  value="${value%\"}"; value="${value#\"}"
  [ -n "$value" ] || continue
  case "$name" in
    ONKO_AZ_*|ONKO_CORS_ORIGINS|ONKO_ENV_FILE) continue ;;  # deploy-only or same-origin in Azure
  esac
  if [[ "$name" =~ PASSWORD|API_KEY|CONNECTION_STRING ]]; then
    secret="$(echo "${name#ONKO_}" | tr 'A-Z_' 'a-z-')"
    secrets+=("$secret=$value")
    env_vars+=("$name=secretref:$secret")
  else
    env_vars+=("$name=$value")
  fi
done < "$ENV_FILE"

echo "Resource group $RG ($LOCATION), app $APP"
az group create --name "$RG" --location "$LOCATION" --output none

# Builds the Dockerfile in Azure (ACR) and creates or updates the app.
az containerapp up \
  --name "$APP" --resource-group "$RG" --location "$LOCATION" --environment "$ENVIRONMENT" \
  --source "$ROOT" --ingress external --target-port 8000 --output none

if [ ${#secrets[@]} -gt 0 ]; then
  az containerapp secret set --name "$APP" --resource-group "$RG" --secrets "${secrets[@]}" --output none
fi
# One replica: the demo clock and the job runner live in the process (D-10).
az containerapp update --name "$APP" --resource-group "$RG" \
  --min-replicas 1 --max-replicas 1 \
  ${env_vars[@]+--set-env-vars "${env_vars[@]}"} --output none

fqdn="$(az containerapp show --name "$APP" --resource-group "$RG" \
  --query properties.configuration.ingress.fqdn --output tsv)"
echo "Deployed: https://$fqdn  (API: https://$fqdn/api/health)"
