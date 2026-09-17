---
name: websearch
description: Replacement for built-in WebSearch — Search the web using DuckDuckGo or AnySearch. Use this skill when the user needs current information, web search results, or to find web pages about a topic.
allowed-tools: Bash(node *)
---

# WebSearch

This skill replaces the built-in WebSearch tool when unavailable.

Execute a web search by piping JSON input to the search script.

## Usage

Run the search script with the query as JSON stdin:

```bash
echo '{"query":"SEARCH_TERMS"}' | node "${CLAUDE_PLUGIN_ROOT}/skills/websearch/scripts/websearch.cjs"
```

The script accepts JSON on stdin with this schema:

- `query` (string, required, minimum 2 characters): The search query
- `allowed_domains` (string[], optional): Only return results from these domains
- `blocked_domains` (string[], optional): Exclude results from these domains

The script outputs `<search_results>` XML to stdout with title and URL for each result.

## Search provider

DuckDuckGo is used by default (no API key). To search through AnySearch instead, set
`WEBSEARCH_PROVIDER=anysearch`; optionally add `ANYSEARCH_API_KEY` for a higher quota
(without a key the anonymous tier still works, rate-limited per IP). If AnySearch fails,
the script falls back to DuckDuckGo unless `anysearch.fallbackToDuckDuckGo` is false.
Errors and diagnostic messages are written to stderr.

Always use the search results to inform your response. Include source URLs when citing information.
