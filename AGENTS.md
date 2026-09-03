@README.md

## Development

### Setup

```sh
mise install
cp -n .env.example .env
pnpm install
pnpm run lint
pnpm run build
```

### Release

Consumers reference the action by tag: `@v1` (moving major tag) or `@v1.x.y`. The `dist/` bundle is committed and rebuilt by the Build workflow on every push to `main`, so make sure CI is green on `main` before tagging.

1. Bump `version` in `package.json`, commit and push to `main`. Wait for all workflows to pass.
2. Tag the release and move the major tag to the same commit:
   ```sh
   git tag v1.x.y
   git tag -f v1
   git push origin v1.x.y
   git push -f origin v1
   ```
3. Create the GitHub release from the tag: `gh release create v1.x.y --generate-notes`.
