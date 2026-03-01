# Contributing to Diamond

Thanks for your interest. Diamond is an early-stage project and contributions of all kinds are welcome — bug reports, docs improvements, and code.

## Getting Started

```bash
git clone https://github.com/elmojones3/diamond.git
cd diamond
pnpm install
pnpm build
```

To use your local build as the `diamond` CLI:
```bash
npm link
```

## Development Workflow

```bash
pnpm watch    # TypeScript in watch mode
pnpm lint     # Biome lint check
pnpm format   # Biome auto-format
```

The source lives in `src/`. The compiled output goes to `dist/` (gitignored). See `docs/internal/architecture.md` for a map of how the code is structured.

## Submitting a PR

1. Fork the repo and create a branch from `main`.
2. Make your changes. Keep commits focused — one logical change per commit.
3. Run `pnpm lint` before pushing.
4. Open a pull request against `main` with a short description of what changed and why.

There are no automated tests yet — manual testing is fine for now. Describe what you tested in the PR description.

## Reporting a Bug

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). The most useful thing you can include is the exact command you ran and the full error output.

## Project Principles

- **Offline by default.** After a sync, everything works without a network connection.
- **No unnecessary abstractions.** The code should be readable by someone unfamiliar with the project.
- **Minimal footprint.** No servers, no databases, no daemons. Files on disk and a stdio process.

## Questions

Open a [discussion](https://github.com/elmojones3/diamond/discussions) or an issue — either is fine.
