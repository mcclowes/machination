/** @format */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const within = (file, directory) => file === directory || file.startsWith(directory + sep);
async function sources(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return (
    await Promise.all(
      entries.map((entry) => {
        const file = resolve(directory, entry.name);
        return entry.isDirectory()
          ? sources(file)
          : /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')
            ? [file]
            : [];
      }),
    )
  ).flat();
}

/** Enforce dependency direction without prescribing how cohesive modules are split. */
export async function checkArchitecture(root) {
  const boundaries = [
    ['src/game', ['src/game']],
    ['src/contracts', ['src/contracts', 'src/game']],
    ['server', ['server', 'src/game', 'src/replay', 'src/contracts']],
  ];
  const failures = [];
  for (const [source, allowed] of boundaries) {
    for (const file of await sources(resolve(root, source))) {
      const { importedFiles } = ts.preProcessFile(await readFile(file, 'utf8'), true, true);
      for (const { fileName: specifier } of importedFiles) {
        if (!specifier.startsWith('.')) {
          if (source !== 'server')
            failures.push(`${relative(root, file)} imports external module ${specifier}`);
          continue;
        }
        const dependency = resolve(dirname(file), specifier);
        if (!allowed.some((directory) => within(dependency, resolve(root, directory)))) {
          failures.push(`${relative(root, file)} crosses its boundary with ${specifier}`);
        }
      }
    }
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = await checkArchitecture(resolve(process.argv[2] ?? '.'));
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log('Engine, contracts, and server dependency boundaries pass.');
}
