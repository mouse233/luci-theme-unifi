# Changelog

## [Unreleased]

## [1.1.0] - 2026-11-14

### Added

- Add optional background client online detection using validated ARP replies and recent network activity, with conservative offline thresholds and last-confirmed timestamps.

### Changed

- Replace client record-source labels in the status column with online, offline, or unavailable status.

## [1.0.1] - 2026-11-14

### Added

- Monthly and manual vendor-data updates that test generated snapshots, create update pull requests, and retain icon candidate previews and Nmap comparison reports.
- Automatic icon discovery from unique exact directory matches, with ambiguous and partial matches left as reviewable candidates.
- Bundled SVG path text for 193 brand icons, including MSI, Proxmox, and QEMU, with source checksums and per-icon notices.
- A concise English bug report form with firmware version, behavior, and screenshots.

### Changed

- Include all IEEE MA-L, MA-M, MA-S, and legacy IAB assignments: 59,041 prefixes and 34,050 distinct registered organization names in this snapshot.
- Preserve original IEEE organization names in client tables, details, and CSV exports; retain brand names for icon associations and search.
- Split vendor data, brand mappings, and SVG text into separate offline modules and use compact indexes with longest-prefix lookup.
- Use Nmap only to report differences; do not merge its assignments into the runtime database.
- Build and publish only the installable IPK, removing separate payload archives, manifests, and checksum files from release assets.

### Fixed

- Stop filtering registered manufacturers through the brand-icon list and recognize uppercase organization names such as XIAOMI.
- Identify Proxmox registrations and QEMU's conventional virtual NIC prefix while excluding other locally administered addresses from IEEE lookups.
- Validate release notes before starting the full test suite.
- Upload validated build assets to an existing GitHub Release, preserving any release notes already supplied by the maintainer.

## [1.0.0] - 2026-11-14

### Added

- GitHub Actions checks for JavaScript, packaging, ucode storage, templates, and browser behavior.
- Automatic IPK artifacts after successful CI runs and GitHub Releases when a version tag passes all checks.
- Tag-derived package versions, build provenance, SHA-256 checksums, and release notes extracted from this file.
- Installation instructions for release packages and CI artifacts.
- Reproducible 1920×1080 English and Chinese documentation screenshots captured with Google Chrome.

### Changed

- Move vendor source checksums to `tools/` and visual reference data to `tests/fixtures/reference/`.
- Reserve `research/` for ignored local captures and internal notes.
- Put README navigation above the introduction and display localized screenshots in separate rows under Preview.
- Use ImmortalWrt as the preview hostname and document 23.05 testing with newer versions pending validation.
- Replace repeated theme version literals with build-time version substitution for cache invalidation.
- Verify the visible containing surface when a client table has a transparent background.
- Increase the local preview server's connection queue for concurrent browser asset requests.

The initial source snapshot is commit `7ec35877a1fe`. No tagged release predates this changelog.
