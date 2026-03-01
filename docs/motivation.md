# Motivation: Why Build a Docs Registry?

The Model Context Protocol (MCP) has solved the "how" of connecting AI to data, but for developers using AI to write code, the "what" remains a bottleneck.

## 1. The Stale Knowledge Problem
Large Language Models (LLMs) are frozen in time. Their training data for libraries like `Lexical React`, `Drizzle ORM`, or `Effect` is often 6-12 months old. In a world where libraries release breaking changes every few months, "hallucination" isn't a bug—it's a logical consequence of stale data.

## 2. The Context Observation
An AI agent's performance shifts dramatically based on context:
- **Without Docs:** It guesses, uses deprecated APIs, and requires 10+ turns of "grep and fix" to work.
- **With Docs (e.g., Playwright):** It writes correct, modern code in the first turn.

The difference in developer velocity is 10x.

## 3. The Vision: "Brew for Documentation"
We are building a **Global Documentation Registry** that functions like `homebrew` or `pnpm` for documentation.

- **Automated:** One command (`sync_docs`) to fetch and update any library.
- **High-Signal:** Noise-removal via Readability.js ensures the model only sees the meat of the documentation.
- **Efficient:** CAS-based storage (Content-Addressable) ensures that tracking 100 versions of a library doesn't bloat your disk.
- **Registry-First:** It's not just a crawler; it's a managed local repository that allows agents to "search" and "read" documentation with the same ease that they read local files.

By making documentation "instantly available" to any MCP-compatible AI, we bridge the gap between a model's training data and the reality of modern software development.
