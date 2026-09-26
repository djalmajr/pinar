# Extension releases

The browser extension has an independent version and release channel. Closed product tags use `vX.Y.Z` (production Worker + desktop Latest); prerelease product tags use `vX.Y.Z-rc.1` (staging Worker only); extension tags use `ext-vX.Y.Z`.

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
   bun run package:ext -- --expected-version X.Y.Z --unpacked
   ```

The first command rebuilds the extension and writes the Store-ready `extension/pinar-extension-X.Y.Z.zip`. The second writes `extension/pinar-extension-X.Y.Z-unpacked.zip` for manual Chrome testing. Both archives use the same validated runtime file set; packaging fails when versions differ, `manifest.json` is not at the archive root, a manifest reference is missing, or the package contains tests, declarations, source maps, or nested archives.

Use the Store-ready ZIP for Chrome Web Store submission. Its packaged manifest has no top-level `key`, leaving the extension ID to the Store. Use the `-unpacked.zip` only for pre-Store production testing with Chrome's **Load unpacked**: its manifest preserves the repository public key, so Chrome assigns the stable ID allowed by the Cloud production origin. Extract the ZIP and select that directory in Chrome. If an unpacked copy with the same ID is already loaded, update the files in the directory selected for that existing Chrome entry and click **Reload** on `chrome://extensions`. To run a parallel copy without replacing the existing entry or losing its local state, use a separate Chrome profile. Do not submit the key-preserving ZIP to the Store.

## Publish

After the release change reaches `main`, create and push the independent tag:

```sh
git tag -a ext-vX.Y.Z -m ext-vX.Y.Z
git push origin ext-vX.Y.Z
```

The `Release extension` workflow repeats typechecking and extension-focused tests, builds both ZIP assets, and creates `Pinar Extension X.Y.Z` with the versioned notes. It passes `--latest=false` so the Pinar.app update channel remains unchanged.

The GitHub Release and Chrome Web Store are separate publication surfaces. A GitHub Release is available immediately after the workflow succeeds; Store publication still requires its own privacy declarations, review submission, and Google approval.

## Verify the artifact

```sh
unzip -t extension/pinar-extension-X.Y.Z.zip
unzip -p extension/pinar-extension-X.Y.Z.zip manifest.json
unzip -Z1 extension/pinar-extension-X.Y.Z.zip
shasum -a 256 extension/pinar-extension-X.Y.Z.zip
unzip -t extension/pinar-extension-X.Y.Z-unpacked.zip
unzip -p extension/pinar-extension-X.Y.Z-unpacked.zip manifest.json
shasum -a 256 extension/pinar-extension-X.Y.Z-unpacked.zip
```

The inspected Store-ready manifest must not contain a top-level `key` field. The unpacked testing manifest must preserve the repository key.

Reload the unpacked extension after every source change before claiming browser behavior is active.
