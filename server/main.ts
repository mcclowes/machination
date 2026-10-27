import { resolve } from 'node:path';
import { GameService } from './service';
import { createApi } from './http';
async function main() {
  const service = await GameService.open(resolve(process.env.MACHINATION_DATA ?? '.data/games.json'));
  const server = createApi(service, process.env.MACHINATION_ORIGINS?.split(',').map((s: string) => s.trim()));
  const host = process.env.MACHINATION_HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, host, () => console.log(`Machination service listening on ${host}:${port}`));
}
main().catch(e => { console.error('Cannot start game service:', e.message); process.exitCode = 1; });
