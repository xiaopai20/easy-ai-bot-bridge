# Contributing

Thanks for your interest in this project.

## Before you open a PR

- Keep changes small and focused.
- Use English and ASCII in source, docs, and commit messages.
- Run tests for the area you touched:

  ```bash
  cd relay/slack-webhook-relay && npm test
  # and/or at repo root:
  npm test
  ```

- Do not commit secrets, real Slack tokens, AWS account IDs, or production URLs.

## Scope

**Supported:** bridges under `relay/` (starting with `slack-webhook-relay`).

**Experimental / unsupported:** the multi-tenant stack at the repo root (`lib/`, `src/`). Fixes are welcome but there is no commitment to maintain or deploy it.

## License

By contributing, you agree that your contributions are licensed under the MIT License in [LICENSE](LICENSE).