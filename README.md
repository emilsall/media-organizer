# Media Organizer (CLI)

Organize your photos, RAW files, and videos by date, remove duplicates, and optionally rename or delete items — all from a friendly, interactive terminal UI.

## Why
- Consolidate messy camera dumps into a clean year/day structure.
- Remove exact duplicates safely with a dry run preview.
- Quickly ignore, rename, or delete individual files before applying changes.

## Features
- Dry run by default: review planned operations before executing.
- Date-based organization: moves files into `YEAR/YYYY-MM-DD/` folders.
- Duplicate detection: size + MD5 content hash.
- Interactive review: selectable list using `ink-scroll-list`.
- Per-item actions: Ignore, Rename, Delete.
- Smart cleanup: prunes effectively empty folders (handles `.DS_Store`, `._` files).
- EXIF date extraction with fallback to file timestamps.

## Supported Formats
- Images: JPG, JPEG, PNG, GIF, BMP, TIFF, HEIC, HEIF, WebP
- RAW: CR2, CR3, CRW (Canon), RAF (Fujifilm), DNG, NEF, ARW, ORF, RW2
- Video: MP4, MOV, AVI, MKV, M4V, WMV, FLV, WebM

## Requirements
- Bun (recommended): https://bun.sh
- macOS, Linux, or Windows (terminal with Node/Bun support)

## Quick Start
Clone the repo and install dependencies:

```bash
git clone https://github.com/yourname/media-organizer.git
cd media-organizer
bun install
```

Run a dry run (recommended):

```bash
bun run media-organizer.js /path/to/media
```

Execute immediately (skips the prompt):

```bash
bun run media-organizer.js /path/to/media --execute
```

Build a standalone binary:

```bash
bun run build
# Produces ./media-organizer
```

## Interactive Review & Actions
When run without `--execute`, you get a scrollable list of planned operations.

Keyboard shortcuts:
- Up/Down: move selection
- I: ignore this file (no changes applied to it)
- D: delete this file (removes source instead of moving)
- R: rename this file
  - For move items: changes the destination filename.
  - For delete items: renames the file in-place (converts delete → rename).
- Enter or Y: execute all actions
- N: cancel

The list annotates your choices:
- `[IGNORED]` — item will be skipped
- `[DELETE OVERRIDE]` — item will be deleted
- `[RENAME -> newname.ext]` — item will be renamed to `newname.ext`

## Behavior Details
- Date source: Attempts EXIF `DateTimeOriginal`; if missing, falls back to file creation/modification time.
- Duplicates: Any two files with identical size and MD5 hash — one becomes a delete operation.
- Organized folders: Existing `YEAR/YYYY-MM-DD/` trees are not reprocessed.
- Cleanup: After execution, the tool removes empty directories up to the selected root, treating folders with only ignorable files as empty.
- Safety: Dry run is the default; explicit confirmation is required to make changes (or pass `--execute`).

## Examples
Dry run on current directory:

```bash
bun run media-organizer.js
```

Dry run on `~/Pictures`:

```bash
bun run media-organizer.js ~/Pictures
```

Execute on `~/Pictures`:

```bash
bun run media-organizer.js ~/Pictures --execute
```

## Tech Stack
- Bun + Node APIs: file system operations, hashing
- Ink + React: terminal UI components
- ink-scroll-list: fast, controlled list with selection
- ink-text-input: inline text input for renaming

## Binaries & Downloads
- Get the latest prebuilt binaries: https://github.com/emilsall/media-organizer/releases
- Included for each release:
  - Self-contained binaries built with Bun’s compiler
  - `SHA256SUMS.txt` for checksum verification

Choose the right file for your system:
- macOS (Apple Silicon): media-organizer-macos-arm64
- macOS (Intel/x64): media-organizer-macos-x64
- Linux (x64): media-organizer-linux-x64
- Linux (arm64): media-organizer-linux-arm64
- Windows (x64): media-organizer-windows-x64.exe

### Build Locally (optional)
```bash
bun run build
# Output placed in dist/media-organizer-<platform>-<arch>
```

Utilities
- Clean dist: `bun run dist:clean`
- CI: see .github/workflows/release.yml (builds all platforms on tag and publishes artifacts)

### macOS: First-Run Notes (Gatekeeper)
Files downloaded from the internet may be quarantined. If you see a "file is damaged" or it’s immediately killed, remove the quarantine and make it executable:
```bash
# Optional: remove quarantine on the ZIP before extracting
xattr -d com.apple.quarantine ~/Downloads/media-organizer-macos-arm64.zip

# Remove quarantine on the binary
xattr -r -d com.apple.quarantine ./media-organizer-macos-arm64

# Ensure it’s executable
chmod +x ./media-organizer-macos-arm64

# Optional: ad-hoc codesign to satisfy Gatekeeper
codesign --force --sign - ./media-organizer-macos-arm64

# Check Gatekeeper assessment (optional)
spctl --assess --type execute -vv ./media-organizer-macos-arm64
```
Then run:
```bash
./media-organizer-macos-arm64 --help
```

### Windows: First-Run Notes (SmartScreen)
Windows may warn because the binary isn’t signed yet.
- If SmartScreen appears, click "More info" → "Run anyway".
- Or right-click the `.exe` → Properties → check "Unblock" → Apply.
- If Windows Defender quarantines the file, allow the app in Defender settings.

Run:
```powershell
./media-organizer-windows-x64.exe --help
```

### Linux: First-Run Notes
Mark the binary executable and run. If you see "permission denied", ensure the folder isn’t mounted with `noexec`.
```bash
chmod +x ./media-organizer-linux-x64
./media-organizer-linux-x64 --help

# If permission denied, check mount options
mount | grep noexec
```

### Checksums
Verify downloaded binaries against the release checksums:
```bash
cd dist
sha256sum -c SHA256SUMS.txt
```

## Notes & Limitations
- EXIF parsing is lightweight and covers common JPEG/TIFF paths; for HEIC/RAW variations, fallback to filesystem dates may occur.
- On Windows, `.Thumbs.db` and similar ignorable files are cleaned during folder pruning.
- Large directories are handled incrementally; performance depends on disk I/O.

## License
MIT
