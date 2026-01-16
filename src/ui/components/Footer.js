import React from 'react';
import { Box, Text, Newline } from 'ink';

export default function Footer({ complete, executing, status, operationsCount, duplicatesFound, filesFound, awaitingConfirm }) {
  if (!complete) return null;
  return (
    <Box flexDirection="column">
      <Newline />
      <Text color={executing ? 'yellow' : 'green'} bold>
        {executing ? '•' : '✓'} {status}
      </Text>
      <Text>Total operations: {operationsCount}</Text>
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
  );
}
