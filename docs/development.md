# Development guide

[Back to README](../README.md) · [简体中文](development.zh-CN.md)

## Back up the current theme selection

Before the first installation, save the existing LuCI configuration and theme path. These commands preserve any earlier backup at the same location:

```sh
[ -s /root/luci-theme-before-unifi ] || \
  uci -q get luci.main.mediaurlbase > /root/luci-theme-before-unifi
[ -f /root/luci-config-before-unifi ] || \
  cp -p /etc/config/luci /root/luci-config-before-unifi
```

## Local preview

From the repository root, with Python **3.9 or later**:

```sh
python3 tools/preview_server.py
```

Open [the local preview](http://127.0.0.1:8765/). Use the page selector for the dashboard, client inventory, native overview, interfaces, theme settings, login, and components. The [login preview](http://127.0.0.1:8765/?page=login) is also directly accessible.

The server binds to `127.0.0.1` and uses the production theme assets with synthetic fixtures. It does not contact a router. Settings are simulated in browser storage, and the login preview prevents credential submission. Stop the server with Ctrl+C.

Use `?page=overview&lang=en`, `?page=clients&lang=en`, or `?page=login&lang=en` for English previews. With the preview server running and Google Chrome installed, `node tools/capture_screenshots.cjs` refreshes the Chinese and English README images at 1920×1080 using Chrome's native font rendering.

## Development

### Build a local IPK

With Python 3.9 or later, from the repository root:

```sh
python3 tools/build_package.py
```

Output is written to the ignored `artifacts/packages/` directory:

- `luci-theme-unifi_<version>-1_all.ipk` — installable package.

The local builder needs only the Python standard library. It packages static assets, LuCI JavaScript, and ucode source, with no host binaries. It does not replace validation against a matching OpenWrt SDK.

Build an APK for ImmortalWrt 25.12 with `python3 tools/build_apk.py --apk /path/to/immortalwrt-sdk/staging_dir/host/bin/apk`. This uses the same payload and hooks as the IPK and the Linux x86-64 `apk` tool from the ImmortalWrt 25.12.2 SDK.

### Build with an OpenWrt SDK or source tree

Place this repository at `package/luci-theme-unifi` inside an OpenWrt source tree or SDK with the LuCI feed configured at `feeds/luci`. Select `luci-theme-unifi` in the build configuration, then run from the SDK or source tree root:

```sh
make package/luci-theme-unifi/compile V=s
```

On an ImmortalWrt 25.12 SDK, LuCI's build rules produce `luci-theme-unifi-<version>.apk`; install it in a test environment with `apk add --allow-untrusted`. The SDK build does not accept this project’s default development version, so for an untagged or dirty tree pass a release-form `PKG_VERSION`, for example `make package/luci-theme-unifi/compile PKG_VERSION=1.0.2 V=s`.

### Router container checks

Compatibility is also checked against ImmortalWrt x86-64 rootfs images under OrbStack. Import the rootfs tarball, start it with `/sbin/init` and `--privileged`, and assign the container address directly to `eth0` instead of the firmware's default bridged `192.168.1.1`; otherwise the published HTTP port has no route. Point the package feeds at a reachable mirror, install the package, set `luci.main.mediaurlbase=/luci-static/unifi`, then run an authenticated Playwright check against the published port.

### Run tests

The unit tests use Node.js's built-in test runner and require no npm dependencies. Node.js **22** is the version used for local validation:

```sh
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

With the OpenWrt `ucode` interpreter available, verify the background history store:

```sh
ucode tests/activity-store.uc
```

Browser checks use a pinned Playwright version. Install the dependencies and Chromium:

```sh
npm ci
npx playwright install chromium
```

Run `python3 tools/preview_server.py` in another terminal, then execute every browser suite:

```sh
UCODE_BIN=/path/to/ucode npm run test:browser
```

`UCODE_BIN` selects a host OpenWrt ucode interpreter; the default is `vendor/ucode/build/ucode`. CI builds a pinned interpreter and checks the history store and template compilation too.

Optional overrides are `UNIFI_PREVIEW_URL` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Reports and screenshots go to `artifacts/`. No router credentials are needed.

### Update vendor data

`tools/generate_brands.py` compiles three committed, offline LuCI modules:

| Module | Contents |
| --- | --- |
| `vendor-data.js` | All IEEE MA-L, MA-M, MA-S and legacy IAB assignments, packed sorted indexes and the original organization names in one snapshot |
| `brand-map.js` | Confirmed mappings and unique exact directory matches used to select icons; names in the vendor column remain the original IEEE names |
| `icon-data.js` | Validated SVG path strings, not external image URLs or Base64-encoded images |

The browser searches compact byte arrays from the longest prefix to the shortest (36, 28, 24 bits), without creating an object for every assignment. The vendor names and their numeric references always live in the same module. All three modules include a snapshot identifier. Hostname hints are used when no registry assignment is available. QEMU's conventional `52:54:00` prefix remains a separate virtual NIC hint; other local MACs are not looked up as IEEE assignments. Vendor search also accepts the associated brand name, while table cells, details and CSV retain the original registered organization.

```sh
python3 tools/generate_brands.py
python3 tools/generate_brands.py --check
python3 tools/generate_brands.py --refresh --audit-nmap
python3 tools/generate_brands.py --refresh --update-icons --audit-nmap
```

Normal generation uses the ignored `vendor/brand-data/` cache and checks the source SHA-256 hashes in `tools/brand-data-sources.json`; missing inputs are downloaded. `--check` never downloads. Only `--refresh` accepts changed sources. `--update-icons` additionally chooses the latest stable Simple Icons release and updates `tools/brand-data-config.json` after validation. Runtime assignments never depend on Nmap or OUI-Master-Database.

Brand definitions are in `tools/brand-definitions.json`. The generator uses the pinned Simple Icons metadata and selfh.st's index to find candidates. Confirmed patterns take priority; only a unique normalized exact title or declared Simple Icons alias can create an automatic icon mapping. Partial names and ambiguous matches are reported without changing the mapping or original organization name. Generic company words are excluded from candidate search. selfh.st provides supplemental candidates; only Simple Icons paths are automatically embedded by the current path-only renderer. To adopt a candidate, add a reviewed organization pattern and an available Simple Icons slug to the definitions, then regenerate.

`artifacts/brand-data/` contains complete candidate JSON, an HTML preview of the first 200 candidate organizations, unavailable configured icons, registry conflicts, an optional Nmap comparison, and an update summary. The HTML preview contacts the listed upstream image hosts when opened; these preview URLs are never installed on routers. Nmap label differences often reflect abbreviations and are not treated as conflicting registrations. Duplicate IEEE assignments retain the last row within a registry; MA-S takes precedence over legacy IAB for identical prefixes. All such conflicts are reported. Source row validation, minimum sizes and a 5% shrink guard prevent incomplete downloads from replacing a snapshot. A reviewed reduction can be regenerated with `--allow-shrink`.

The monthly `Update vendor and icon data` workflow runs on the 2nd at 03:23 UTC (11:23 China time), and can also be run manually. It refreshes the sources, generates candidate and Nmap reports, checks reproducibility, runs unit/packaging and client browser tests, then creates or updates `automation/update-brand-data` as a pull request. It does not merge automatically or update deployed routers. Report artifacts are retained for 30 days. The repository must allow Actions to create pull requests. An optional `BRAND_DATA_TOKEN` can be supplied when a project requires the generated PR to trigger other workflows; otherwise the workflow uses `GITHUB_TOKEN` and runs its own checks before opening the PR.

Generated asset checksums and coverage counts are in `tools/brand-data-summary.json`. Per-icon upstream references and available license metadata, the library license and disclaimer are included in `root/usr/share/licenses/luci-theme-unifi/`. Some manufacturers have no available logo; their original names remain fully searchable and visible with a generic icon.

### Source layout and release hygiene

| Path | Purpose |
| --- | --- |
| `htdocs/` | Installed CSS, JavaScript, fonts, and artwork |
| `ucode/` | LuCI header, footer, and authentication templates |
| `root/` | Theme registration, configuration, menus, ACLs, and license files |
| `preview/` | Local demo harness and synthetic fixtures |
| `tests/` | Unit/browser checks and visual baselines in `fixtures/reference/` |
| `tools/` | Preview, packaging, version resolution, and vendor source checksums |
| `docs/` | User and developer documentation and preview screenshots |
| `research/` | Ignored local research captures and internal notes |

Only `htdocs/`, `ucode/`, and `root/` supply router payload files. Downloaded tools, generated packages, raw reference captures, device backups, deployment evidence, and historical local notes are excluded by [`.gitignore`](../.gitignore). Keep real hostnames, addresses, credentials, and session data out of contributions and screenshots.

After committing the intended release, create a source archive with:

```sh
python3 tools/bundle_release.py
```

This archives the committed Git tree and writes a separate source checksum file. Ignored local captures and build outputs are excluded. Distribute the generated IPK separately from the source archive.

## Contributing and bug reports

For a bug report, provide your OpenWrt firmware version, describe the behavior, and include screenshots if applicable.

Keep changes focused and run the relevant checks. Changes to shared controls or layout should be checked in light and dark modes at desktop and mobile widths. Compatibility reports are welcome; please distinguish local preview results from tests on an actual router.

## Download build artifacts

CI produces an IPK and an APK in the Actions artifact ZIP, retained for 30 days. Future releases include both; older releases may only contain an IPK. APK development and prerelease versions are encoded to satisfy apk version syntax; use release builds for upgrades.

Development package versions sort below tagged releases. To replace an installed release with a development build, remove the existing Unifi package before installing the development IPK. Removal selects Bootstrap if Unifi is active. With 1.0.1 or earlier, switch to another theme manually before removing the package.

## Versions and releases

Git tags are the source of release versions; source files do not repeat the current version number:

- `v0.9.0` → IPK version `0.9.0-1`.
- `v0.9.0-rc.1` → IPK version `0.9.0~rc.1-1`, published as a GitHub prerelease.
- Untagged commits → `0~git<commit-time>.<commit>-1`, with `+dirty` added for local changes.
- Source copies without Git metadata → `0~dev-1`; use `python3 tools/build_package.py --version 0.9.0` to set a version explicitly. SDK builds accept `PKG_VERSION=0.9.0`.

`PKG_RELEASE` is the package revision only. Builds write the version into IPK metadata, filenames, and template cache identifiers. Templates use LuCI's native `PKG_VERSION` comment marker, supported by both the local builder and SDK.

CI runs unit, packaging, ucode, and all browser checks on branch pushes and pull requests, then uploads the IPK artifact. Version tag pushes reuse those checks and publish the verified artifact to GitHub Releases.

For example, to release `v0.9.0` (replace this with the intended version):

1. Move the pending changes in `CHANGELOG.md` into `## [0.9.0] - YYYY-MM-DD`, using the actual release date.
2. Commit and push the changes, and confirm CI passes.
3. Create and push the tag:

```sh
git tag -a v0.9.0 -m "Release v0.9.0"
git push origin v0.9.0
```

The Release workflow validates the tag format, its commit, and a nonempty matching changelog section before running tests. The changelog section must be present in the tagged commit; changing only the default branch cannot repair the source of an existing tag. Release attachments contain only the installable IPK. If the GitHub Release already exists, the workflow uploads the verified assets and preserves any existing release notes.

## Restore or uninstall

Select your previous theme in LuCI, or restore the saved selection over SSH:

```sh
UNIFI_PREVIOUS_THEME="$(cat /root/luci-theme-before-unifi)" &&
  [ -n "$UNIFI_PREVIOUS_THEME" ] &&
  uci set "luci.main.mediaurlbase=$UNIFI_PREVIOUS_THEME" &&
  uci commit luci
rm -f /tmp/luci-indexcache.*
```

If the backup is unavailable, Bootstrap is an installed dependency and can be selected directly:

```sh
uci set luci.main.mediaurlbase='/luci-static/bootstrap'
uci commit luci
```

To uninstall, run the following command. Removal automatically selects Bootstrap if Unifi is active, and preserves any other selected theme:

```sh
opkg remove luci-theme-unifi
```

Upgrades preserve the active theme. Versions 1.0.1 and earlier have an installed removal script that blocks both upgrades and removals while Unifi is active; switch themes manually once before replacing those versions. A router or network restart is not required for theme switching.

## Theme settings

| Setting | Values | Default |
| --- | --- | --- |
| Appearance | System, light, dark | System |
| Clients per page | 10, 25, 50, 100 | 50 |
| Client refresh interval | 5, 10, 30, 60 seconds | 10 seconds |
| Dashboard information refresh interval | 1, 2, 5, 10, 30, 60 seconds | 1 second |
| Expand navigation by default | On, off | Off |
| Always sample network activity | On, off | On |

These preferences are stored in `/etc/config/unifi` and apply across browsers. Client column choices remain browser preferences. The login page uses its own fixed dark background.

Network activity is sampled every second. The curve scrolls continuously and progressively reveals measured line segments with a one-second display buffer. Pausing updates, hiding the page, or enabling reduced motion stops the animation. **Always sample network activity** is enabled by default under System → Unifi Theme Settings and collects continuously, including while the web interface is closed. The collector retains the last hour per interface in process memory; opening or refreshing the dashboard restores that history, then reads new samples incrementally. No traffic history is written to flash. Disabling the option stops the collector and releases its history; router or collector restarts also clear it. With the option off, only the open dashboard collects samples. System information, interface status and DHCP leases use the dashboard information refresh interval, which defaults to one second.

Dashboard and client collection are read-only. The theme settings permission allows writes only to the `unifi` configuration; native LuCI configuration pages retain their existing write permissions.
