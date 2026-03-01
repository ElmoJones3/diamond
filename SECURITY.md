# Security Policy

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Instead, open a [GitHub Security Advisory](https://github.com/elmojones3/diamond/security/advisories/new) to report privately. Include as much detail as you can: what the vulnerability is, how to reproduce it, and what the potential impact might be.

You'll receive a response within a few days. If the issue is confirmed, a fix will be prioritized and a patched release will be made before public disclosure.

## Scope

Diamond runs locally on your machine and communicates only with sites you explicitly tell it to crawl. It does not expose any network services by default. The primary security concern is the `sync_docs` MCP tool, which allows an AI assistant to trigger a crawl of an arbitrary URL — only run Diamond with AI hosts you trust.
