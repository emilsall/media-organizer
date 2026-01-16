#!/usr/bin/env bun

import React, { useState, useEffect } from 'react';
import { render, Box, Text, Newline, useInput } from 'ink';
import { ScrollList } from 'ink-scroll-list';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { readFile, readdir, stat, unlink, mkdir, rename, rm } from 'fs/promises';
import { join, extname, basename, dirname, relative, resolve } from 'path';
import { createHash } from 'crypto';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.heic', '.heif', '.webp'];
const RAW_EXTENSIONS = ['.cr2', '.cr3', '.crw', '.raf', '.raw', '.dng', '.nef', '.arw', '.orf', '.rw2'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.m4v', '.wmv', '.flv', '.webm'];

async function getFileHash(filePath, size) {
  const buffer = await readFile(filePath);
  const hash = createHash('md5').update(buffer).digest('hex');
  return `${size}-${hash}`;
}

async function extractExifDate(buffer) {
  // Look for DateTimeOriginal in EXIF data
  // EXIF tag 0x9003 (36867) = DateTimeOriginal
  try {
    const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // Check for JPEG EXIF marker (0xFFE1) or TIFF header
    let offset = 0;
    let isLittleEndian = true;

    // For JPEG files, find EXIF marker
    if (dataView.getUint16(0, false) === 0xFFD8) {
      // JPEG file, look for APP1 EXIF marker
      offset = 2;
      while (offset < dataView.byteLength - 1) {
        const marker = dataView.getUint16(offset, false);
        const length = dataView.getUint16(offset + 2, false);

        if (marker === 0xFFE1) { // APP1 marker (EXIF)
          offset += 4; // Skip marker and length
          // Check for "Exif\0\0"
          if (dataView.getUint32(offset, false) === 0x45786966 &&
              dataView.getUint16(offset + 4, false) === 0x0000) {
            offset += 6;
            break;
          }
        }
        offset += 2 + length;
      }
    }

    // Check TIFF header
    const tiffHeader = dataView.getUint16(offset, false);
    if (tiffHeader === 0x4949) { // "II" - Intel (little-endian)
      isLittleEndian = true;
    } else if (tiffHeader === 0x4D4D) { // "MM" - Motorola (big-endian)
      isLittleEndian = false;
    } else {
      return null;
    }

    // Get IFD0 offset
    const ifd0Offset = dataView.getUint32(offset + 4, isLittleEndian);
    const ifd0Position = offset + ifd0Offset;

    // Read IFD entries
    const numEntries = dataView.getUint16(ifd0Position, isLittleEndian);

    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifd0Position + 2 + (i * 12);
      const tag = dataView.getUint16(entryOffset, isLittleEndian);

      if (tag === 0x9003) { // DateTimeOriginal
        const format = dataView.getUint16(entryOffset + 2, isLittleEndian);
        const count = dataView.getUint32(entryOffset + 4, isLittleEndian);

        if (format === 2) { // ASCII string
          let valueOffset = dataView.getUint32(entryOffset + 8, isLittleEndian);
          if (count <= 4) {
            valueOffset = entryOffset + 8;
          } else {
            valueOffset = offset + valueOffset;
          }

          let dateStr = '';
          for (let j = 0; j < count - 1; j++) {
            dateStr += String.fromCharCode(dataView.getUint8(valueOffset + j));
          }

          // Parse EXIF date format: "YYYY:MM:DD HH:MM:SS"
          const match = dateStr.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
          if (match) {
            const [, year, month, day, hour, minute, second] = match;
            return new Date(year, month - 1, day, hour, minute, second);
          }
        }
      }
    }

    // Check EXIF sub-IFD
    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifd0Position + 2 + (i * 12);
      const tag = dataView.getUint16(entryOffset, isLittleEndian);

      if (tag === 0x8769) { // EXIF IFD pointer
        const exifIFDOffset = dataView.getUint32(entryOffset + 8, isLittleEndian);
        const exifIFDPosition = offset + exifIFDOffset;
        const exifNumEntries = dataView.getUint16(exifIFDPosition, isLittleEndian);

        for (let j = 0; j < exifNumEntries; j++) {
          const exifEntryOffset = exifIFDPosition + 2 + (j * 12);
          const exifTag = dataView.getUint16(exifEntryOffset, isLittleEndian);

          if (exifTag === 0x9003) {
            const format = dataView.getUint16(exifEntryOffset + 2, isLittleEndian);
            const count = dataView.getUint32(exifEntryOffset + 4, isLittleEndian);

            if (format === 2) {
              let valueOffset = dataView.getUint32(exifEntryOffset + 8, isLittleEndian);
              if (count <= 4) {
                valueOffset = exifEntryOffset + 8;
              } else {
                valueOffset = offset + valueOffset;
              }

              let dateStr = '';
              for (let k = 0; k < count - 1; k++) {
                dateStr += String.fromCharCode(dataView.getUint8(valueOffset + k));
              }

              const match = dateStr.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
              if (match) {
                const [, year, month, day, hour, minute, second] = match;
                return new Date(year, month - 1, day, hour, minute, second);
              }
            }
          }
        }
      }
    }
  } catch (error) {
    // EXIF parsing failed
  }

  return null;
}

async function getExifDate(filePath) {
  try {
    const buffer = await readFile(filePath);
    return await extractExifDate(Buffer.from(buffer));
  } catch (error) {
    return null;
  }
}

async function getFileDate(filePath) {
  const exifDate = await getExifDate(filePath);
  if (exifDate) return exifDate;

  const stats = await stat(filePath);
  return stats.birthtime || stats.mtime;
}

function splitNameAndExt(filename) {
  const ext = extname(filename);
  const base = ext ? filename.slice(0, -ext.length) : filename;
  return { base, ext };
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch (_) {
    return false;
  }
}

async function resolveDestinationOperation(info, targetDir) {
  const originalName = basename(info.path);
  const { base, ext } = splitNameAndExt(originalName);

  let i = 0;
  while (true) {
    const candidateName = i === 0 ? `${base}${ext}` : `${base}-${i}${ext}`;
    const candidatePath = join(targetDir, candidateName);

    const exists = await pathExists(candidatePath);
    if (!exists) {
      return { kind: 'move', target: candidatePath, targetDir };
    }

    // If candidate exists, check if duplicate (size + hash)
    const candStats = await stat(candidatePath);
    const candHash = await getFileHash(candidatePath, candStats.size);
    if (candHash === info.hash) {
      return { kind: 'delete', duplicateOf: candidatePath };
    }

    // Not a duplicate, try next incremental name
    i += 1;
  }
}

function isInOrganizedPath(root, fullPath) {
  const rel = relative(root, fullPath);
  if (!rel || rel.startsWith('..')) return false;
  const parts = rel.split(/[\\/]/).filter(Boolean);
  if (parts.length < 2) return false;
  const [yearPart, dayPart] = parts;
  return /^\d{4}$/.test(yearPart) && /^\d{4}-\d{2}-\d{2}$/.test(dayPart);
}

async function findMediaFiles(dir, files = [], root = dir, dirSet) {
  // Track visited directory
  if (dirSet) dirSet.add(dir);
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Ignore folders already in YYYY/YYYY-MM-DD structure
      if (isInOrganizedPath(root, fullPath)) {
        continue;
      }
      if (dirSet) dirSet.add(fullPath);
      await findMediaFiles(fullPath, files, root, dirSet);
    } else {
      const ext = extname(entry.name).toLowerCase();
      if ([...IMAGE_EXTENSIONS, ...RAW_EXTENSIONS, ...VIDEO_EXTENSIONS].includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function MediaOrganizer({ dryRun = true, targetPath }) {
  const [status, setStatus] = useState('Scanning for media files...');
  const [filesFound, setFilesFound] = useState(0);
  const [duplicatesFound, setDuplicatesFound] = useState(0);
  const [filesProcessed, setFilesProcessed] = useState(0);
  const [operations, setOperations] = useState([]);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [overrides, setOverrides] = useState({}); // { [index]: { type: 'ignore'|'delete'|'rename', newPath?: string } }
  const [renameMode, setRenameMode] = useState(false);
  const [renameInput, setRenameInput] = useState('');

  useEffect(() => {
    async function organize() {
      try {
        // Find all media files
        setStatus(`Scanning directories in ${targetPath}...`);
        const visitedDirs = new Set();
        const files = await findMediaFiles(targetPath, [], targetPath, visitedDirs);
        setFilesFound(files.length);

        // Build file info with dates and sizes
        setStatus('Reading file metadata...');
        const fileInfos = [];
        const seenHashes = new Map();
        const duplicates = [];

        for (let i = 0; i < files.length; i++) {
          const filePath = files[i];
          const stats = await stat(filePath);
          const date = await getFileDate(filePath);
          const hash = await getFileHash(filePath, stats.size);

          const info = {
            path: filePath,
            size: stats.size,
            date,
            hash,
            isDuplicate: false
          };

          if (seenHashes.has(hash)) {
            info.isDuplicate = true;
            info.originalPath = seenHashes.get(hash);
            duplicates.push(info);
          } else {
            seenHashes.set(hash, filePath);
          }

          fileInfos.push(info);
          setFilesProcessed(i + 1);
        }

        setDuplicatesFound(duplicates.length);

        // Generate operations
        setStatus('Planning operations...');
        const ops = [];

        for (const info of fileInfos) {
          if (info.isDuplicate) {
            ops.push({
              type: 'delete',
              source: info.path,
              reason: `Duplicate of ${info.originalPath}`
            });
            continue;
          }

          const year = info.date.getFullYear();
          const month = String(info.date.getMonth() + 1).padStart(2, '0');
          const day = String(info.date.getDate()).padStart(2, '0');

          const targetDir = join(targetPath, String(year), `${year}-${month}-${day}`);
          const firstCandidatePath = join(targetDir, basename(info.path));

          // If the file is already at the first candidate location, skip
          if (info.path === firstCandidatePath) {
            continue;
          }

          const resolution = await resolveDestinationOperation(info, targetDir);
          if (resolution.kind === 'delete') {
            ops.push({
              type: 'delete',
              source: info.path,
              reason: `Duplicate of ${resolution.duplicateOf}`
            });
          } else {
            ops.push({
              type: 'move',
              source: info.path,
              target: resolution.target,
              targetDir: resolution.targetDir
            });
          }
        }

        setOperations(ops);

        // Execute operations if not dry run
        if (!dryRun) {
          setStatus('Executing operations...');
          setExecuting(true);

          // Execute ops and track source directories for cleanup
          const sourceDirs = new Set();
          for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            sourceDirs.add(dirname(op.source));
            if (op.type === 'delete') {
              await unlink(op.source);
            } else if (op.type === 'move') {
              await mkdir(op.targetDir, { recursive: true });
              await rename(op.source, op.target);
            }
          }

          // Cleanup empty directories (sources and any visited ones)
          const cleanupCandidates = new Set([...sourceDirs, ...visitedDirs]);
          await cleanupEmptyDirectories(Array.from(cleanupCandidates), targetPath);
          await pruneAllEmptyDirs(targetPath);

          setExecuting(false);
          setStatus('Organization complete!');
          setComplete(true);
          setTimeout(() => process.exit(0), 200);
        } else {
          // Dry run finished; prompt user for confirmation
          setStatus('Dry run complete! Use arrows to select; I=Ignore, D=Delete, R=Rename. Press Y/Enter to execute, N to cancel.');
          setComplete(true);
          setAwaitingConfirm(true);
        }

      } catch (err) {
        setError(err.message);
      }
    }

    organize();
  }, [dryRun, targetPath]);

  // Handle interactive selection & confirmation
  useInput((input, key) => {
    if (!awaitingConfirm || executing) return;

    // Navigation
    if (!renameMode) {
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(prev + 1, operations.length - 1));
        return;
      }
    }

    // Rename mode: capture text
    if (renameMode) {
      if (key.escape) {
        setRenameMode(false);
        return;
      }
      if (key.return) {
        const op = operations[selectedIndex];
        let newPath;
        if (op.type === 'move') {
          newPath = join(op.targetDir, renameInput);
        } else {
          // rename in place
          newPath = join(dirname(op.source), renameInput);
        }
        setOverrides((prev) => ({ ...prev, [selectedIndex]: { type: 'rename', newPath } }));
        setRenameMode(false);
        return;
      }
      // Let TextInput handle other chars
    } else {
      // Actions (togglable)
      if (input && input.toLowerCase() === 'i') {
        setOverrides((prev) => {
          const current = prev[selectedIndex];
          const next = { ...prev };
          if (current?.type === 'ignore') {
            delete next[selectedIndex];
          } else {
            next[selectedIndex] = { type: 'ignore' };
          }
          return next;
        });
        return;
      }
      if (input && input.toLowerCase() === 'd') {
        setOverrides((prev) => {
          const current = prev[selectedIndex];
          const next = { ...prev };
          if (current?.type === 'delete') {
            delete next[selectedIndex];
          } else {
            next[selectedIndex] = { type: 'delete' };
          }
          return next;
        });
        return;
      }
      if (input && input.toLowerCase() === 'r') {
        const current = overrides[selectedIndex];
        if (current?.type === 'rename') {
          // Toggle off rename override
          setOverrides((prev) => {
            const next = { ...prev };
            delete next[selectedIndex];
            return next;
          });
        } else {
          // Enter rename mode
          const op = operations[selectedIndex];
          const initialName = op.type === 'move' ? basename(op.target) : basename(op.source);
          setRenameInput(initialName);
          setRenameMode(true);
        }
        return;
      }
    }

    if (key.return || input.toLowerCase() === 'y') {
      (async () => {
        setAwaitingConfirm(false);
        setStatus('Executing operations...');
        setExecuting(true);

        try {
          const sourceDirs = new Set();
          for (let i = 0; i < operations.length; i++) {
            const op = operations[i];
            const override = overrides[i];
            if (override && override.type === 'ignore') {
              continue;
            }
            sourceDirs.add(dirname(op.source));

            if (override && override.type === 'delete') {
              await unlink(op.source);
            } else if (override && override.type === 'rename') {
              const finalTarget = override.newPath;
              await mkdir(dirname(finalTarget), { recursive: true });
              await rename(op.source, finalTarget);
            } else if (op.type === 'delete') {
              await unlink(op.source);
            } else if (op.type === 'move') {
              await mkdir(op.targetDir, { recursive: true });
              await rename(op.source, op.target);
            }
          }
          // Also consider any directories under root as cleanup candidates
          const visitedDirs = new Set();
          await findMediaFiles(targetPath, [], targetPath, visitedDirs);
          const cleanupCandidates = new Set([...sourceDirs, ...visitedDirs]);
          await cleanupEmptyDirectories(Array.from(cleanupCandidates), targetPath);
          await pruneAllEmptyDirs(targetPath);
          setStatus('Organization complete!');
        } catch (e) {
          setError(e.message);
        } finally {
          setExecuting(false);
          setTimeout(() => process.exit(0), 200);
        }
      })();
    } else if (input.toLowerCase() === 'n' || key.escape || input.toLowerCase() === 'q') {
      setAwaitingConfirm(false);
      setStatus('Canceled. No changes made.');
      // Exit shortly to end the TTY session
      setTimeout(() => process.exit(0), 150);
    }
  });

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan">Media File Organizer</Text>
        <Text> - {dryRun ? 'DRY RUN MODE' : 'EXECUTION MODE'}</Text>
      </Box>
      <Text color="gray">Path: {targetPath}</Text>
      <Newline />

      {!complete && (
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text> {status}</Text>
        </Box>
      )}

      <Newline />
      <Text>Files found: {filesFound}</Text>
      <Text>Files processed: {filesProcessed}/{filesFound}</Text>
      <Text color="yellow">Duplicates found: {duplicatesFound}</Text>
      <Newline />

      {operations.length > 0 && (
        <Box flexDirection="column">
          <Text bold underline>Operations to perform:</Text>
          <Newline />

          <Box borderStyle="round" height={12}>
            <ScrollList selectedIndex={selectedIndex} scrollAlignment="auto">
              {operations.map((op, i) => {
                const ovr = overrides[i];
                const tag = ovr?.type === 'ignore' ? '[IGNORED]'
                  : ovr?.type === 'delete' ? '[DELETE]'
                  : ovr?.type === 'rename' ? `[RENAME -> ${basename(ovr.newPath)}]`
                  : '';
                const isSelected = i === selectedIndex;
                const color = ovr?.type === 'ignore' ? 'gray' : (op.type === 'delete' ? 'red' : 'green');
                const line = op.type === 'delete'
                  ? `DELETE: ${op.source} ${op.reason ? 'Reason: ' + op.reason : ''}`
                  : `MOVE: ${op.source} -> ${op.target}`;
                const itemKey = `${op.type}:${op.source}:${op.type === 'move' ? op.target : ''}`;
                return (
                  <Box key={itemKey}>
                    <Text color={color}>
                      {isSelected ? '> ' : '  '}{line} {tag}
                    </Text>
                  </Box>
                );
              })}
            </ScrollList>
          </Box>

          {awaitingConfirm && (
            <>
              <Newline />
              {renameMode ? (
                <Box>
                  <Text>New name: </Text>
                  <TextInput value={renameInput} onChange={setRenameInput} />
                  <Text>  (Enter to apply, Esc to cancel)</Text>
                </Box>
              ) : (
                <>
                  <Text>Use arrows to select; I=Ignore, D=Delete, R=Rename.</Text>
                  <Text>Press Y or Enter to execute. Press N to cancel.</Text>
                </>
              )}
            </>
          )}
        </Box>
      )}

      {complete && (
        <Box flexDirection="column">
          <Newline />
          <Text color={executing ? 'yellow' : 'green'} bold>
            {executing ? '•' : '✓'} {status}
          </Text>
          <Text>Total operations: {operations.length}</Text>
          <Text>Duplicates removed: {duplicatesFound}</Text>
          <Text>Files organized: {filesFound - duplicatesFound}</Text>
          {awaitingConfirm && (
            <>
              <Newline />
              <Text bold>Execute now?</Text>
              <Text>Press Y or Enter to execute. Press N to cancel.</Text>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

const IGNORABLE_FILENAMES = new Set(['.DS_Store', 'Thumbs.db', '.localized']);
function isIgnorableFile(name) {
  return IGNORABLE_FILENAMES.has(name) || name.startsWith('._');
}

async function cleanupEmptyDirectories(dirs, stopAt) {
  // Deduplicate and sort by depth (deepest first)
  const unique = Array.from(new Set(dirs)).sort((a, b) => b.length - a.length);
  for (const dir of unique) {
    await removeEmptyUpwards(dir, stopAt);
  }
}

async function removeEmptyUpwards(startDir, stopAt) {
  let current = startDir;
  while (true) {
    // Stop at or outside root
    if (current === stopAt) break;
    const relToStop = relative(stopAt, current);
    if (relToStop.startsWith('..') || relToStop === '') break;

    const removed = await tryRemoveIfEffectivelyEmpty(current);
    if (removed) {
      current = dirname(current);
      continue;
    }
    break;
  }
}

async function tryRemoveIfEffectivelyEmpty(dir) {
  try {
    let entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      if (entry.isFile()) {
        if (isIgnorableFile(entry.name)) {
          try { await unlink(entryPath); } catch (_) {}
        }
      } else if (entry.isDirectory()) {
        await tryRemoveIfEffectivelyEmpty(entryPath);
      }
    }

    entries = await readdir(dir, { withFileTypes: true });
    const remaining = entries.filter(e => !(e.isFile() && isIgnorableFile(e.name)));
    if (remaining.length === 0) {
      await rm(dir, { recursive: true, force: true });
      return true;
    }
  } catch (_) {
    // Ignore errors (permissions, already removed, etc.)
  }
  return false;
}

async function pruneAllEmptyDirs(root) {
  // Depth-first traversal to attempt pruning all empty directories under root
  const stack = [root];
  const visited = new Set();
  while (stack.length) {
    const dir = stack.pop();
    if (visited.has(dir)) continue;
    visited.add(dir);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          stack.push(join(dir, entry.name));
        }
      }
    } catch (_) {}
  }
  // Sort deepest-first so children are attempted before parents
  const ordered = Array.from(visited).sort((a, b) => b.length - a.length);
  for (const dir of ordered) {
    if (dir === root) continue; // never remove the root itself
    await tryRemoveIfEffectivelyEmpty(dir);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

// Get path argument (filter out flags)
const pathArgs = args.filter(arg => !arg.startsWith('--'));
const targetPath = pathArgs.length > 0 ? pathArgs[0] : process.cwd();

if (args.includes('--help')) {
  console.log(`
Media File Organizer (Bun Edition)

Usage:
  bun run media-organizer.js [path] [options]

Arguments:
  path         Path to scan (default: current directory)

Options:
  --execute    Execute the operations (default is dry run)
  --help       Show this help message

Supported Formats:
  Images: JPG, PNG, GIF, BMP, TIFF, HEIC, HEIF, WebP
  RAW:    CR2, CR3, CRW (Canon), RAF (Fujifilm), DNG, NEF, ARW, ORF, RW2
  Video:  MP4, MOV, AVI, MKV, M4V, WMV, FLV, WebM

Description:
  Recursively scans the current directory for images, RAW files, and videos.
  Removes exact duplicates (same size + content hash).
  Organizes files into /YEAR/YYYY-MM-DD/ based on EXIF or file dates.

Examples:
  bun run media-organizer.js                        # Dry run in current directory
  bun run media-organizer.js /path/to/photos        # Dry run in specified path
  bun run media-organizer.js ~/Pictures --execute   # Organize files in ~/Pictures
  `);
  process.exit(0);
}

// Verify path exists
try {
  await stat(targetPath);
} catch (error) {
  console.error(`Error: Path "${targetPath}" does not exist or is not accessible.`);
  process.exit(1);
}

const targetPathAbs = resolve(targetPath);
render(<MediaOrganizer dryRun={dryRun} targetPath={targetPathAbs} />);
