import * as path from 'path';

import { main } from '@/study/cli';

main(path.resolve(__dirname, '..'), process.argv.slice(2)).catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
