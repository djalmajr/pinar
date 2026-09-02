# Extension releases

The browser extension has an independent version and release channel. Product tags use `vX.Y.Z`; extension tags use `extension-vX.Y.Z`.

Extension releases are intentionally not marked as GitHub's global **Latest** release. Pinar.app resolves its update files through `/releases/latest/download`, so only a product release may own that channel.

## Prepare a release

1. Update the same version in:
   - `extension/manifest.json`
   - `apps/extension/package.json`
   - the explicit version assertion in `extension/context-menu.test.js`
2. Add `extension/releases/X.Y.Z.md`.
3. Run:

   ```sh
   bun run typecheck
   bun run test
   bun run package:ext -- --expected-version X.Y.Z
   ```

The package command rebuilds the extension and writes `extension/pinar-extension-X.Y.Z.zip`. It fails when versions differ, `manifest.json` is not at the archive root, a manifest reference is missing, or the package contains tests, declarations, source maps, or nested archives.

## Publish

After the release change reaches `main`, create and push the independent tag:

```sh
git tag -a extension-vX.Y.Z -m extension-vX.Y.Z
git push origin extension-vX.Y.Z
```

The `Release extension` workflow repeats typechecking and extension-focused tests, builds the ZIP, and creates `Pinar Extension X.Y.Z` with the versioned notes. It passes `--latest=false` so the Pinar.app update channel remains unchanged.

The GitHub Release and Chrome Web Store are separate publication surfaces. A GitHub Release is available immediately after the workflow succeeds; Store publication still requires its own privacy declarations, review submission, and Google approval.

## Verify the artifact

```sh
unzip -t extension/pinar-extension-X.Y.Z.zip
unzip -p extension/pinar-extension-X.Y.Z.zip manifest.json
unzip -Z1 extension/pinar-extension-X.Y.Z.zip
shasum -a 256 extension/pinar-extension-X.Y.Z.zip
```

Reload the unpacked extension after every source change before claiming browser behavior is active.
