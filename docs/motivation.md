# Motivation

I'll be honest — I didn't really understand MCP.

Not what it was. Not the fuss. I'd seen the tweets, skimmed the spec, nodded along. But I didn't *get it*. And I wasn't going to pretend otherwise.

What I did understand was simpler: productivity is all that matters. I was building The Virgo — JadeIQ's flagship product — and my AI tools were making me slower, not faster. Hallucinations everywhere. Deprecated APIs confidently presented as current. And web search? Wildly unstable in practice. I once watched an agent make **fourteen tool calls** just to resolve a TanStack issue. Fourteen. That's not assistance. That's a tax.

So I built Diamond.

## What MCP Actually Is

Here's the short version, because I wish someone had given it to me this plainly.

MCP — Model Context Protocol — is a contract. That's it. It defines a standard way for an AI model to say "I need something" and for a server to say "here it is." Think of it like a USB port for context: the model plugs in, the server delivers data, and both sides agree on the shape of the handshake.

In practice? Most MCP servers are just a thin wrapper around whatever REST API someone already wrote. A docs site has an API. Someone wraps it in the MCP interface. Now your AI agent can call it. The protocol itself isn't magic — it's plumbing.

But the plumbing matters. A lot.

## Why Context Is the Whole Game

Here's what I learned the hard way, sitting in front of The Virgo codebase at 2am, correcting the same hallucinated import for the third time:

A bad LLM with good context will outperform a good LLM with bad context. Every time.

Without docs, your agent guesses. It reaches for deprecated APIs. It confuses v4 with v5. It writes code that *looks* right — compiles, even — but breaks in ways you won't catch until production. You end up in a ten-turn loop of "grep and fix," and the productivity promise evaporates.

Hand that same agent the actual documentation? It writes correct, modern code on the first try. The difference isn't incremental. It's the difference between a tool that works and a tool that wastes your afternoon.

Context is the fix. Not better models. Not more parameters. Better context.

## Why I Built This

I was inspired by pnpm. I love the registry model — a central, versioned, content-addressable store where the thing you need is always one command away. I wanted that for documentation.

I also love crawlers. My OSINT / Hyperglue days gave me a deep appreciation for what a well-built crawler can do — and JadeIQ still makes heavy use of them. So when I needed to pull documentation at scale, clean it, store it efficiently, and serve it to AI agents over MCP, the pieces were already in my head. I just had to assemble them.

Diamond is that assembly. A documentation registry that gives your AI agent the context it actually needs, fetched and stored locally, served over the protocol your tools already speak.

## Worth It

MCP is new. The ecosystem is young. But this — giving AI agents access to real, current, clean documentation — is worth building now.

I built Diamond because I needed it. I hope it helps you too.

If it does, [buy me a coffee](https://buymeacoffee.com/elmojones3).

Stan
