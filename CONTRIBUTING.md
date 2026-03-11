# Contributing to Membase for OpenClaw

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/membase-ai/openclaw-membase.git
cd openclaw-membase
bun install
```

## Making Changes

1. Fork the repository and create a feature branch from `main`
2. Make your changes
3. Run type checks and linting:

```bash
bun run check-types
bun run lint
```

4. Commit with a clear message describing the change
5. Open a pull request against `main`

## Code Style

- TypeScript strict mode
- Formatting and linting via [Biome](https://biomejs.dev)
- Run `bun run lint` before submitting

## Reporting Bugs

Open an [issue](https://github.com/membase-ai/openclaw-membase/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- OpenClaw version and OS

## Feature Requests

Open an [issue](https://github.com/membase-ai/openclaw-membase/issues) describing:

- The problem you're trying to solve
- Your proposed solution (if any)
- Any alternatives you've considered

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
