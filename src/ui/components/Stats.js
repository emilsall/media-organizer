import React from 'react';
import { Box, Text, Newline } from 'ink';

export default function Stats({ filesFound, filesProcessed, duplicatesFound }) {
  return (
    <Box flexDirection="column">
      <Text>Files found: {filesFound}</Text>
      <Text>Files processed: {filesProcessed}/{filesFound}</Text>
      <Text color="yellow">Duplicates found: {duplicatesFound}</Text>
      <Newline />
    </Box>
  );
}
