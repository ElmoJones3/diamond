# How MCP Works (Under the Hood)

The Model Context Protocol (MCP) is built on top of **JSON-RPC 2.0**. This means all communication is structured as a series of messages: **Requests**, **Responses**, and **Notifications**.

## 1. The Handshake (Initialization)
When a Client connects to an MCP Server, the first thing they do is "introduce" themselves. This is called the `initialize` request.

- **Client sends:** Its version, its capabilities (what it can do), and any metadata.
- **Server responds:** Its version, its capabilities (which resources/tools it has), and its metadata.

This ensures both sides know what to expect before any real work happens.

## 2. Capability Discovery
Once initialized, the Client can "browse" what the Server has to offer using standard requests:

- `listResources()`: The Server returns a list of available URIs and descriptions.
- `listTools()`: The Server returns a list of available functions, their names, descriptions, and expected parameters.
- `listPrompts()`: The Server returns a list of available prompt templates.

## 3. Communication Flow (Resources)
When the AI wants to read a resource (e.g., a documentation page):
1. **Host** asks the **Client** to fetch `docs://react/hooks`.
2. **Client** sends a `readResource(uri)` request to the **Server**.
3. **Server** fetches the data (from a database, file, or API) and returns it as a list of `content` objects (text, images, etc.).

## 4. Communication Flow (Tools)
When the AI wants to perform an action (e.g., "Crawl this URL"):
1. **AI** decides it needs a tool and generates the arguments based on the Tool's JSON Schema.
2. **Host** asks the **Client** to call the tool.
3. **Client** sends a `callTool(name, arguments)` request to the **Server**.
4. **Server** executes the code (e.g., launches Playwright to crawl the URL).
5. **Server** returns the result (e.g., "Successfully crawled 10 pages") to the Client.

## 5. Transport Specifics

### A. stdio (Local)
The Host spawns the Server as a subprocess.
- **Host STDOUT** -> **Server STDIN**
- **Server STDOUT** -> **Host STDIN**
- Error logs go to **Server STDERR**.

### B. SSE (Remote)
- The Client connects to an HTTP endpoint on the Server.
- The Server keeps the connection open and pushes updates (JSON-RPC messages) to the Client.
- The Client sends its requests back to the Server via standard `POST` requests.

## 6. Security model
MCP is designed with a **Client-Controlled Security** model.
- The **Server** only sees what the **Client** explicitly asks for.
- The **Host** (AI application) is responsible for asking the user for permission before calling "dangerous" tools (like writing to the filesystem or making network requests).

---

### Key Takeaway for our project:
For our **Documentation Crawler**, our Server will primarily be an **MCP Server** that:
1. Responds to a `callTool("crawl")` request by running a crawler.
2. Exposes the results via `listResources()` and `readResource()`.
