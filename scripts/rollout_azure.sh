#!/usr/bin/env bash
# Roll out an image that CD pushed (main-<sha>) to the Azure Container App. Settings stay as they are;
# change them with deploy_azure.sh. Run it yourself after `az login`. Details: docs/deploy.md.
#
#   ./scripts/rollout_azure.sh              # newest main-* image
#   ./scripts/rollout_azure.sh main-<sha>   # a specific one
set -euo pipefail

RG="${ONKO_AZ_RESOURCE_GROUP:-rg-team82}"
APP="${ONKO_AZ_APP:-onko-koordinace}"

command -v az >/dev/null || { echo "Install the Azure CLI and run az login first" >&2; exit 1; }

server="$(az containerapp show --name "$APP" --resource-group "$RG" \
  --query 'properties.configuration.registries[0].server' --output tsv)"
[ -n "$server" ] || { echo "$APP has no registry; deploy it once with deploy_azure.sh" >&2; exit 1; }
registry="${server%%.*}"

tag="${1:-$(az acr repository show-tags --name "$registry" --repository "$APP" --orderby time_desc \
  --query "[?starts_with(@, 'main-')] | [0]" --output tsv)}"
[ -n "$tag" ] || { echo "No main-* image in $registry yet; run the CD workflow first" >&2; exit 1; }

echo "Rolling out $server/$APP:$tag"
az containerapp update --name "$APP" --resource-group "$RG" --image "$server/$APP:$tag" --output none

fqdn="$(az containerapp show --name "$APP" --resource-group "$RG" \
  --query properties.configuration.ingress.fqdn --output tsv)"
for _ in $(seq 30); do
  if curl --fail --silent "https://$fqdn/api/health" >/dev/null; then
    echo "Live: https://$fqdn"
    exit 0
  fi
  sleep 10
done
echo "https://$fqdn/api/health did not answer after 5 minutes" >&2
exit 1
