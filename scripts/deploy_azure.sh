#!/usr/bin/env bash
# Deploy API + web (one container, see Dockerfile) to Azure Container Apps for the demo (Q-I8).
# Run it yourself after `az login`; it never prints secret values. Details: docs/deploy.md.
#
#   ONKO_AZ_RESOURCE_GROUP=rg-team82 ONKO_AZ_LOCATION=swedencentral ./scripts/deploy_azure.sh
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

# Registry: the one in the group, or a new one. The app pulls with the registry's admin login, because
# granting it AcrPull is a role assignment, which team accounts can't make (`az containerapp up` tries).
REGISTRY="${ONKO_AZ_REGISTRY:-$(az acr list --resource-group "$RG" --query '[0].name' --output tsv)}"
if [ -z "$REGISTRY" ]; then
  REGISTRY="onko${RANDOM}${RANDOM}"
  az acr create --name "$REGISTRY" --resource-group "$RG" --location "$LOCATION" --sku Basic --output none
fi
az acr update --name "$REGISTRY" --admin-enabled true --output none
server="$(az acr show --name "$REGISTRY" --query loginServer --output tsv)"
registry_user="$(az acr credential show --name "$REGISTRY" --query username --output tsv)"
registry_password="$(az acr credential show --name "$REGISTRY" --query 'passwords[0].value' --output tsv)"

# Builds the Dockerfile in Azure (ACR Tasks) from the working tree.
tag="manual-$(date +%Y%m%d%H%M%S)"
az acr build --registry "$REGISTRY" --image "$APP:$tag" "$ROOT" --output none
image="$server/$APP:$tag"

if ! az containerapp env show --name "$ENVIRONMENT" --resource-group "$RG" --output none 2>/dev/null; then
  az containerapp env create --name "$ENVIRONMENT" --resource-group "$RG" --location "$LOCATION" \
    --output none
fi
if az containerapp show --name "$APP" --resource-group "$RG" --output none 2>/dev/null; then
  az containerapp registry set --name "$APP" --resource-group "$RG" --server "$server" \
    --username "$registry_user" --password "$registry_password" --output none
else
  az containerapp create --name "$APP" --resource-group "$RG" --environment "$ENVIRONMENT" \
    --image "$image" --registry-server "$server" \
    --registry-username "$registry_user" --registry-password "$registry_password" \
    --ingress external --target-port 8000 --output none
fi

if [ ${#secrets[@]} -gt 0 ]; then
  az containerapp secret set --name "$APP" --resource-group "$RG" --secrets "${secrets[@]}" --output none
fi
# ONKO_* variables the app has but .env no longer sets are removed, so an emptied value doesn't linger.
stale=()
for name in $(az containerapp show --name "$APP" --resource-group "$RG" \
    --query 'properties.template.containers[0].env[].name' --output tsv); do
  [[ "$name" == ONKO_* ]] || continue
  [[ " ${env_vars[*]-} " == *" $name="* ]] || stale+=("$name")
done
# One replica: the demo clock and the job runner live in the process (D-10). 3 GiB: the local
# embedding model (fastembed, Q-M2) runs in the process too.
az containerapp update --name "$APP" --resource-group "$RG" --image "$image" \
  --min-replicas 1 --max-replicas 1 --cpu 1.5 --memory 3.0Gi \
  ${env_vars[@]+--set-env-vars "${env_vars[@]}"} \
  ${stale[@]+--remove-env-vars "${stale[@]}"} --output none

fqdn="$(az containerapp show --name "$APP" --resource-group "$RG" \
  --query properties.configuration.ingress.fqdn --output tsv)"
echo "Deployed: https://$fqdn  (API: https://$fqdn/api/health)"
