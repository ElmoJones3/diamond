# Model Context Protocol (MCP)

The Model Context Protocol (MCP) is an open standard that enables developers to build secure, two-way connections between their data sources and AI models. It addresses the "last mile" problem of AI: giving models the specific, real-time context they need to be truly useful.

## 1. What is MCP?
MCP is to AI what **HTTP** is to the web or **USB** is to hardware. 

Before MCP, if you wanted to connect a tool (like a database or a documentation crawler) to an AI, you had to write custom code for every single AI client (Claude Desktop, Gemini CLI, etc.). MCP provides a common language so that:
- **Servers** (your data/tools) only need to be written once.
- **Clients** (the AI interfaces) can connect to any MCP server instantly.

## 2. Core Architecture
The MCP ecosystem consists of three main roles:

### A. The Host (The AI Interface)
The application the user actually interacts with (e.g., Claude Desktop, Gemini CLI, an IDE). It manages the lifecycle of the connection and provides the UI for the AI.

### B. The Client
A component within the Host that initiates the connection to an MCP Server. It handles the protocol-level communication (sending requests, receiving responses).

### C. The Server
The provider of data or functionality. It exposes:
- **Resources:** Data (like files, database rows, or API responses).
- **Tools:** Executable functions (like "search the web" or "run a shell command").
- **Prompts:** Pre-defined templates for interacting with the model.

## 3. The Three Primitives

### Resources (Read-Only Data)
Resources are like "files" that the AI can read. They are identified by URIs (e.g., `docs://react-docs/getting-started`).
- **Use Case:** Feeding a specific documentation page to the model.

### Tools (Actionable Functions)
Tools allow the model to *do* things. They have a name, a description, and a JSON Schema for their arguments.
- **Use Case:** `crawl_url(url: string)` or `search_github(query: string)`.

### Prompts (Structured Interaction)
Prompts are reusable templates that help the user or the model structure their queries.
- **Use Case:** A "Review Code" prompt that automatically pulls in relevant context.

## 4. Transport Mechanisms
MCP is transport-agnostic, but currently uses two primary methods:
- **stdio:** Communication via standard input/output. Common for local servers running on the same machine as the client.
- **SSE (Server-Sent Events):** Communication over HTTP. Ideal for remote servers or web-based clients.

## 5. Why it Matters: The "N x M" Problem
Without MCP:
- If there are 10 AI Clients and 10 Data Sources, you need **100** custom integrations.

With MCP:
- You write **10** MCP Clients and **10** MCP Servers. Everything works together.

---

### Next Step: How to Build
To build our **Documentation Crawler**, we will likely create an **MCP Server** that exposes:
1. **Tools** to trigger a crawl.
2. **Resources** to expose the crawled markdown content to the AI.
