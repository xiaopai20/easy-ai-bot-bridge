# Contributing

Thanks for your interest in this project.

## Before you open a PR

- Keep changes small and focused.
- Use English and ASCII in source, docs, and commit messages.
- Run tests for the bridge you changed:

  ```bash
  cd relay/slack-webhook-relay
  npm ci && npm test
  ```

- Do not commit secrets, real Slack tokens, AWS account IDs, or production URLs.

## Scope

New bridges should live under `relay/<name>/` as self-contained CDK apps, with their own `package.json` and tests.

## License

By contributing, you agree that your contributions are licensed under the MIT License in [LICENSE](LICENSE).