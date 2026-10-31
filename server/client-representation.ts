/** Negotiate the response understood by the caller without changing authoritative rules. @format */
import {
  CURRENT_CLIENT_MECHANICS_VERSION,
  CURRENT_CLIENT_MEDIA_TYPE,
  LEGACY_CLIENT_MECHANICS_VERSION,
  type ClientMechanicsVersion,
} from '../src/contracts/representation';
import type { GameRules } from '../src/game/rules';
import { Failure } from './failure';
import { MIMEType } from 'node:util';

type Representation = {
  contentType: string;
  mechanicsVersion: ClientMechanicsVersion;
  includeColors: boolean;
};
const legacy: Representation = {
  contentType: 'application/json',
  mechanicsVersion: LEGACY_CLIENT_MECHANICS_VERSION,
  includeColors: false,
};
const current: Representation = {
  contentType: CURRENT_CLIENT_MEDIA_TYPE,
  mechanicsVersion: CURRENT_CLIENT_MECHANICS_VERSION,
  includeColors: true,
};

export function clientRepresentation(accept: string | undefined): Representation {
  const qualities = new Map<string, number>();
  for (const range of accept?.split(',') ?? []) {
    try {
      const mime = new MIMEType(range.trim());
      const raw = mime.params.get('q') ?? '1';
      if (!/^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/.test(raw)) continue;
      qualities.set(mime.essence, Math.max(qualities.get(mime.essence) ?? 0, Number(raw)));
    } catch {
      // Ignore malformed ranges rather than infer a newer decoder from them.
    }
  }
  const jsonQuality = qualities.get('application/json') ?? qualities.get('application/*') ?? qualities.get('*/*') ?? 0;
  const currentQuality = qualities.get(CURRENT_CLIENT_MEDIA_TYPE) ?? 0;
  return currentQuality > 0 && currentQuality >= jsonQuality ? current : legacy;
}

export function responseJson(payload: unknown, representation: Representation): string {
  if (representation.includeColors) return JSON.stringify(payload);
  return JSON.stringify(payload, (key, value: unknown) => {
    if (key !== 'rules' || !value || typeof value !== 'object' || Array.isArray(value)) return value;
    const { colors: _colors, ...rules } = value as Record<string, unknown>;
    return rules;
  });
}

export function assertClientRules(rules: Pick<GameRules, 'mechanicsVersion'> | undefined, supported: ClientMechanicsVersion): void {
  if ((rules?.mechanicsVersion ?? 1) > supported)
    // Released clients delete pending recovery secrets after definitive 4xx failures.
    throw new Failure(503, 'client.unavailable.upgrade', 'Update Machination to continue this operation.');
}
