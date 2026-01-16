import { render } from 'ink';
import { stat } from 'fs/promises';
import { resolve } from 'path';
import MediaOrganizer from './ui/MediaOrganizer.js';
import { printHelp } from './helpText.js';

export async function run() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const pathArgs = args.filter(arg => !arg.startsWith('--'));
  const targetPath = pathArgs.length > 0 ? pathArgs[0] : process.cwd();

  if (args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  try {
    await stat(targetPath);
  } catch (error) {
    console.error(`Error: Path "${targetPath}" does not exist or is not accessible.`);
    process.exit(1);
  }

  const targetPathAbs = resolve(targetPath);
  render(<MediaOrganizer dryRun={dryRun} targetPath={targetPathAbs} />);
}
