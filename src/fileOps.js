import { readFile, readdir, stat, rm } from 'fs/promises';
import { join, extname, basename, dirname, relative } from 'path';
import { createHash } from 'crypto';
import { IMAGE_EXTENSIONS, RAW_EXTENSIONS, VIDEO_EXTENSIONS, isIgnorableFile } from './constants.js';

export async function getFileHash(filePath, size) {
  const buffer = await readFile(filePath);
  const hash = createHash('md5').update(buffer).digest('hex');
  return `${size}-${hash}`;
}

export async function extractExifDate(buffer) {
  try {
    const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    let offset = 0;
    let isLittleEndian = true;

    if (dataView.getUint16(0, false) === 0xFFD8) {
      offset = 2;
      while (offset < dataView.byteLength - 1) {
        const marker = dataView.getUint16(offset, false);
        const length = dataView.getUint16(offset + 2, false);
        if (marker === 0xFFE1) {
          offset += 4;
          if (dataView.getUint32(offset, false) === 0x45786966 && dataView.getUint16(offset + 4, false) === 0x0000) {
            offset += 6;
            break;
          }
        }
        offset += 2 + length;
      }
    }

    const tiffHeader = dataView.getUint16(offset, false);
    if (tiffHeader === 0x4949) {
      isLittleEndian = true;
    } else if (tiffHeader === 0x4D4D) {
      isLittleEndian = false;
    } else {
      return null;
    }

    const ifd0Offset = dataView.getUint32(offset + 4, isLittleEndian);
    const ifd0Position = offset + ifd0Offset;
    const numEntries = dataView.getUint16(ifd0Position, isLittleEndian);

    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifd0Position + 2 + (i * 12);
      const tag = dataView.getUint16(entryOffset, isLittleEndian);
      if (tag === 0x9003) {
        const format = dataView.getUint16(entryOffset + 2, isLittleEndian);
        const count = dataView.getUint32(entryOffset + 4, isLittleEndian);
        if (format === 2) {
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
          const match = dateStr.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
          if (match) {
            const [, year, month, day, hour, minute, second] = match;
            return new Date(year, month - 1, day, hour, minute, second);
          }
        }
      }
    }

    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifd0Position + 2 + (i * 12);
      const tag = dataView.getUint16(entryOffset, isLittleEndian);
      if (tag === 0x8769) {
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
  } catch (_) {}
  return null;
}

export async function getExifDate(filePath) {
  try {
    const buffer = await readFile(filePath);
    return await extractExifDate(Buffer.from(buffer));
  } catch (_) {
    return null;
  }
}

export async function getFileDate(filePath) {
  const exifDate = await getExifDate(filePath);
  if (exifDate) return exifDate;
  const stats = await stat(filePath);
  return stats.birthtime || stats.mtime;
}

export function splitNameAndExt(filename) {
  const ext = extname(filename);
  const base = ext ? filename.slice(0, -ext.length) : filename;
  return { base, ext };
}

export async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch (_) {
    return false;
  }
}

export async function resolveDestinationOperation(info, targetDir) {
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
    const candStats = await stat(candidatePath);
    const candHash = await getFileHash(candidatePath, candStats.size);
    if (candHash === info.hash) {
      return { kind: 'delete', duplicateOf: candidatePath };
    }
    i += 1;
  }
}

export function isInOrganizedPath(root, fullPath) {
  const rel = relative(root, fullPath);
  if (!rel || rel.startsWith('..')) return false;
  const parts = rel.split(/[\\\/]/).filter(Boolean);
  if (parts.length < 2) return false;
  const [yearPart, dayPart] = parts;
  return /^\d{4}$/.test(yearPart) && /^\d{4}-\d{2}-\d{2}$/.test(dayPart);
}

export async function findMediaFiles(dir, files = [], root = dir, dirSet) {
  if (dirSet) dirSet.add(dir);
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isInOrganizedPath(root, fullPath)) continue;
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

export async function tryRemoveIfEffectivelyEmpty(dir) {
  try {
    let entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      if (entry.isFile()) {
        if (isIgnorableFile(entry.name)) {
          try { await rm(entryPath, { force: true }); } catch (_) {}
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
  } catch (_) {}
  return false;
}

export async function removeEmptyUpwards(startDir, stopAt) {
  let current = startDir;
  while (true) {
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

export async function cleanupEmptyDirectories(dirs, stopAt) {
  const unique = Array.from(new Set(dirs)).sort((a, b) => b.length - a.length);
  for (const dir of unique) {
    await removeEmptyUpwards(dir, stopAt);
  }
}

export async function pruneAllEmptyDirs(root) {
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
  const ordered = Array.from(visited).sort((a, b) => b.length - a.length);
  for (const dir of ordered) {
    if (dir === root) continue;
    await tryRemoveIfEffectivelyEmpty(dir);
  }
}
