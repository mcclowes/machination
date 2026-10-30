import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { FIELD_MANUAL_SECTIONS } from '../../src/content/field-manual.ts';
import { SPECIALISTS, hireAmount, promotion } from '../../src/game/specialist-catalog.ts';

const website = fileURLToPath(new URL('../', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));

export function headingId(title) {
  return title.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function generateReference(destination = website) {
  const reference = join(destination, 'docs/reference');
  const images = join(destination, 'static/img');
  await mkdir(reference, { recursive: true });
  await mkdir(images, { recursive: true });

  const rules = [
    '---\ntitle: Rules\nslug: /rules\ndescription: The current Machination field manual, shared with the game.\n---',
    'The same rules appear in the game’s **Manual**. New operations use the rules below; existing operations keep their saved rules. Check the mode in your operation before planning.',
    '[Start with your first 10 minutes](../learn/first-ten-minutes.md), or use the contents to look up a rule.',
    ...FIELD_MANUAL_SECTIONS.map(([title, body]) => `## ${title} {#${headingId(title)}}\n\n${body}`),
  ].join('\n\n');

  const specialists = [
    '---\ntitle: Specialist reference\nslug: /specialists\ndescription: Every Machination specialist, its abilities, hiring amount, and promotion.\n---',
    'Names, abilities, and promotions come from the game’s specialist catalog. Load specialists explicitly when planning a transfer. Captives have no active abilities.',
    'In King’s Pulse, your **Intelligence core** is your King. The **Overclock** is a different specialist; its Subterfuge counterpart is called King. Fallback cores cannot replace your King in pulse mode.',
    'Core hiring takes four normal-rate hours for the first credit, then 18 per credit. Opening acceleration changes that timing. Check the operation’s displayed cargo cost before hiring. Offers and eligibility depend on the operation; Disruptors are available in new pulse operations. See [the rules](rules.md#units-and-interception).',
    ...Object.entries(SPECIALISTS).map(([kind, definition]) => {
      const next = promotion(kind);
      return [
        `## ${definition.name} {#${kind}}`,
        definition.description,
        `**Role:** ${definition.category === 'promotion' ? 'Promoted specialist' : definition.category === 'core' ? 'Intelligence core' : definition.category}. **Subterfuge counterpart:** ${definition.reference}.`,
        definition.category !== 'core' && definition.category !== 'promotion' ? `**Per hiring credit:** ${hireAmount(kind)}.` : '',
        next ? `**Promotes to:** [${SPECIALISTS[next].name}](#${next}).` : '',
        'priority' in definition ? `**Local combat priority:** ${definition.priority}. Lower numbers act first; equal priorities act together.` : '',
      ].filter(Boolean).join('\n\n');
    }),
  ].join('\n\n');

  await writeFile(join(reference, 'rules.md'), `${rules}\n`);
  await writeFile(join(reference, 'specialists.md'), `${specialists}\n`);
  await copyFile(join(root, 'assets/brand/mark.svg'), join(images, 'mark.svg'));
  await copyFile(join(root, 'assets/artwork/display/asteroid-frontier.png'), join(images, 'asteroid-frontier.png'));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await generateReference();
