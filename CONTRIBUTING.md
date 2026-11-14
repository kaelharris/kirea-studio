# Contributing

Thanks for wanting to help. Kirea Studio is a small, deliberate desktop app; the best contributions are focused fixes and well-scoped features that respect its boundaries.

## Before you start

- Read [Architecture](docs/ARCHITECTURE.md) so you know where a change belongs.
- Follow [Development](docs/DEVELOPMENT.md) to get a working build and a green test suite.
- For anything larger than a bug fix, open an issue first and describe the behavior you want. It is cheaper than rewriting a pull request.

## Ground rules

- The renderer must not gain direct filesystem, database, or network access. New capabilities go through the typed IPC boundary (`ipc-channels.ts` → `api.ts` → Zod schema → handler → service).
- Database changes are new migrations. Never edit a migration that has already shipped.
- Model weights, runtimes, and Python environments are never committed and never downloaded by the app without an explicit user action.
- Do not add a dependency for something the platform or the existing stack already does.
- Keep existing functionality and compatibility intact. A change that removes a feature needs an issue and agreement first.
- Both themes are part of the design. Test dark and light, not just the one you use.

## Making a change

```powershell
git checkout -b fix/short-description
# ... edit ...
npm run typecheck
npm test
```

Commit messages follow the imperative mood with a short scope, for example:

```
Create: keep the empty prompt hint until a brief is written
Models: flag incomplete safetensors files
Docs: document the managed runtime layout
```

## Pull request checklist

- [ ] The change is limited to the problem described.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] New behavior has a test where the logic is testable without an engine.
- [ ] Any UI change was checked on a built app in dark and light themes.
- [ ] No secrets, API keys, local paths, model files, or build artifacts are included.
- [ ] `RELEASE_NOTES.md` is updated when the change is user-visible.

## Security

Never commit a Civitai API key, a certificate, or anything from `%APPDATA%`. API keys belong in Electron `safeStorage` at runtime. If you believe you have found a security issue, report it privately to the maintainer rather than opening a public issue with exploit details.

## License

By contributing, you agree that your work is released under the project's [MIT License](LICENSE), copyright kaellabsstudio.
