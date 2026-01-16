import React from 'react';
import { Box, Text } from 'ink';
import { ScrollList } from 'ink-scroll-list';
import { basename } from 'path';

export default function OperationsList({ operations, overrides, selectedIndex }) {
  return (
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
              <Text color={color}>{isSelected ? '> ' : '  '}{line} {tag}</Text>
            </Box>
          );
        })}
      </ScrollList>
    </Box>
  );
}
