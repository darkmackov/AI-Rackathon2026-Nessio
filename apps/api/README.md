# api (stream E)

FastAPI, thin over the modules, models from `onko_contracts`. Runs with uvicorn; IRIS (Azure) is reached through `onko_repository`. Route function names become the generated client's function names (`generate_unique_id_function`), so name them well.

**Done when:** routes for every screen in docs/product.md (GP upload + validate, coordinator upload, request tasks, task sets, on hold, patient notice, MDT snapshot, conclusion, send, confirm, time to treatment), plus a role switcher for the demo.

## MCP server (S10)

A read-only MCP server for agents is mounted in the same app: `http://localhost:8000/mcp` locally, `https://<host>/api/mcp` on Azure (streamable HTTP). Every tool call needs the `X-Actor-Id` header, like the REST API. Tools: `search_cases`, `get_case`, `get_time_to_treatment`, `case_overview`, `list_findings`, `get_handover`, `ask_case`.

Claude Desktop, through the `mcp-remote` bridge (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "onko-koordinace": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8000/mcp", "--header", "X-Actor-Id:koordinator"]
    }
  }
}
```
