import React, { useState, useEffect } from 'react';
import { Box, Text, Newline, useInput } from 'ink';
import { unlink, mkdir, rename, stat, readdir } from 'fs/promises';
import { join, basename, dirname } from 'path';
import {
  findMediaFiles,
  getFileDate,
  getFileHash,
  resolveDestinationOperation,
  cleanupEmptyDirectories,
  pruneAllEmptyDirs
} from '../fileOps.js';

import Header from './components/Header.js';
import Stats from './components/Stats.js';
import OperationsList from './components/OperationsList.js';
import ActionBar from './components/ActionBar.js';
import Footer from './components/Footer.js';

export default function MediaOrganizer({ dryRun = true, targetPath }) {
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
  const [overrides, setOverrides] = useState({});
  const [renameMode, setRenameMode] = useState(false);
  const [renameInput, setRenameInput] = useState('');

  useEffect(() => {
    async function organize() {
      try {
        setStatus(`Scanning directories in ${targetPath}...`);
        const visitedDirs = new Set();
        const files = await findMediaFiles(targetPath, [], targetPath, visitedDirs);
        setFilesFound(files.length);

        setStatus('Reading file metadata...');
        const fileInfos = [];
        const seenHashes = new Map();
        const duplicates = [];

        for (let i = 0; i < files.length; i++) {
          const filePath = files[i];
          const stats = await stat(filePath);
          const date = await getFileDate(filePath);
          const hash = await getFileHash(filePath, stats.size);

          const info = { path: filePath, size: stats.size, date, hash, isDuplicate: false };
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

        setStatus('Planning operations...');
        const ops = [];
        for (const info of fileInfos) {
          if (info.isDuplicate) {
            ops.push({ type: 'delete', source: info.path, reason: `Duplicate of ${info.originalPath}` });
            continue;
          }
          const year = info.date.getFullYear();
          const month = String(info.date.getMonth() + 1).padStart(2, '0');
          const day = String(info.date.getDate()).padStart(2, '0');
          const targetDir = join(targetPath, String(year), `${year}-${month}-${day}`);
          const firstCandidatePath = join(targetDir, basename(info.path));
          if (info.path === firstCandidatePath) continue;
          const resolution = await resolveDestinationOperation(info, targetDir);
          if (resolution.kind === 'delete') {
            ops.push({ type: 'delete', source: info.path, reason: `Duplicate of ${resolution.duplicateOf}` });
          } else {
            ops.push({ type: 'move', source: info.path, target: resolution.target, targetDir: resolution.targetDir });
          }
        }

        setOperations(ops);

        if (!dryRun) {
          setStatus('Executing operations...');
          setExecuting(true);
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
          const cleanupCandidates = new Set([...sourceDirs, ...visitedDirs]);
          await cleanupEmptyDirectories(Array.from(cleanupCandidates), targetPath);
          await pruneAllEmptyDirs(targetPath);
          setExecuting(false);
          setStatus('Organization complete!');
          setComplete(true);
          setTimeout(() => process.exit(0), 200);
        } else {
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

  useInput((input, key) => {
    if (!awaitingConfirm || executing) return;
    if (!renameMode) {
      if (key.upArrow) { setSelectedIndex((p) => Math.max(p - 1, 0)); return; }
      if (key.downArrow) { setSelectedIndex((p) => Math.min(p + 1, operations.length - 1)); return; }
    }
    if (renameMode) {
      if (key.escape) { setRenameMode(false); return; }
      if (key.return) {
        const op = operations[selectedIndex];
        const newPath = op.type === 'move' ? join(op.targetDir, renameInput) : join(dirname(op.source), renameInput);
        setOverrides((prev) => ({ ...prev, [selectedIndex]: { type: 'rename', newPath } }));
        setRenameMode(false);
        return;
      }
    } else {
      if (input && input.toLowerCase() === 'i') {
        setOverrides((prev) => {
          const current = prev[selectedIndex];
          const next = { ...prev };
          if (current?.type === 'ignore') delete next[selectedIndex]; else next[selectedIndex] = { type: 'ignore' };
          return next;
        });
        return;
      }
      if (input && input.toLowerCase() === 'd') {
        setOverrides((prev) => {
          const current = prev[selectedIndex];
          const next = { ...prev };
          if (current?.type === 'delete') delete next[selectedIndex]; else next[selectedIndex] = { type: 'delete' };
          return next;
        });
        return;
      }
      if (input && input.toLowerCase() === 'r') {
        const current = overrides[selectedIndex];
        if (current?.type === 'rename') {
          setOverrides((prev) => { const next = { ...prev }; delete next[selectedIndex]; return next; });
        } else {
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
            if (override && override.type === 'ignore') continue;
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
      <Header dryRun={dryRun} targetPath={targetPath} status={status} complete={complete} />
      <Stats filesFound={filesFound} filesProcessed={filesProcessed} duplicatesFound={duplicatesFound} />
      {operations.length > 0 && (
        <Box flexDirection="column">
          <Text bold underline>Operations to perform:</Text>
          <Newline />
          <OperationsList operations={operations} overrides={overrides} selectedIndex={selectedIndex} />
          <ActionBar awaitingConfirm={awaitingConfirm} renameMode={renameMode} renameInput={renameInput} setRenameInput={setRenameInput} />
        </Box>
      )}
      <Footer complete={complete} executing={executing} status={status} operationsCount={operations.length} duplicatesFound={duplicatesFound} filesFound={filesFound} awaitingConfirm={awaitingConfirm} />
    </Box>
  );
}
