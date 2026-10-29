import { readFile } from 'node:fs/promises';

// Read-only pre-deploy diagnostic, not a replacement for the strict game decoder.
try {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/audit-queen-control.mjs <server-database.json>');
  const database = JSON.parse(await readFile(process.argv[2], 'utf8'));
  if (!database || !Array.isArray(database.rooms)) throw new Error('Expected a server database with a rooms array.');
  const report = { roomsScanned: 0, skipped: 0, issues: [] };
  const factions = ['you', 'vesper', 'null', 'aether', 'umbra', 'orbit', 'prism', 'echo', 'nadir', 'zenith'];
  database.rooms.forEach((room, roomIndex) => {
    const game = room?.game;
    if (game?.version !== 2 || game.specialistVersion !== 1) { report.skipped++; return; }
    if (!Array.isArray(game.rocks) || !Array.isArray(game.fleets) || !Array.isArray(game.eliminated)) throw new Error(`Malformed specialist state in room ${roomIndex}.`);
    const players = game.rules?.players ?? ['you', 'vesper', 'null'];
    const mechanicsVersion = game.rules?.mechanicsVersion ?? 1;
    if (!Array.isArray(players) || players.some(faction => !factions.includes(faction)) || !Number.isSafeInteger(mechanicsVersion) || mechanicsVersion < 1) throw new Error(`Malformed rules in room ${roomIndex}.`);
    const queens = new Map();
    for (const asset of [...game.rocks, ...game.fleets]) {
      if (!Array.isArray(asset?.specialists)) throw new Error(`Malformed manifest in room ${roomIndex}.`);
      for (const unit of asset.specialists) if (unit?.kind === 'queen' && !unit.captive) queens.set(unit.owner, (queens.get(unit.owner) ?? 0) + 1);
    }
    report.roomsScanned++;
    players.filter(faction => !game.eliminated.includes(faction)).forEach(faction => {
      const activeQueens = queens.get(faction) ?? 0;
      if (activeQueens !== 1) report.issues.push({ roomIndex, mechanicsVersion, faction, activeQueens });
    });
  });
  console.log(JSON.stringify(report));
  process.exitCode = report.issues.length ? 1 : 0;
} catch (error) {
  // Parse failures can quote input; never print a room, credential, or malformed document.
  console.error(error instanceof SyntaxError ? 'Could not parse the server database JSON.' : error.message);
  process.exitCode = 2;
}
