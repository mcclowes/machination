import { pulseConfig } from '../game/pulse';
import { sitePosition } from '../game/drift';
import type { ReplayScene } from './presentation';

/** Evaluate only disclosed motion; membership and garrisons remain those of the recorded span. */
export function moveReplayScene(scene: ReplayScene, hour: number): ReplayScene {
  const dt = hour - scene.hour, config = pulseConfig(scene);
  const rate = (owner: string, type: string) => (scene.pulse?.modifiers ?? []).filter(m => m.factionId === owner && m.type === type && m.expiresAt > scene.hour).reduce((r, m) => r * m.multiplier, 1);
  return { ...scene, hour,
    ...(scene.pulse ? { pulse: { ...scene.pulse,
      kings: scene.pulse.kings.map(k => k.state === 'charging' ? { ...k, chargeProgress: k.chargeProgress + dt * rate(k.factionId, 'charge_rate') } : k),
      pulses: scene.pulse.pulses.map(p => ({ ...p, radius: p.radius + dt * config.propagationSpeed * rate(p.factionId, 'pulse_speed') })),
      shields: Object.fromEntries(Object.entries(scene.pulse.shields).map(([id, shield]) => {
        const owner = scene.rocks.find(r => r.id === id)?.owner;
        const disabled = scene.rocks.find(r => r.id === id)?.shieldsDisabled;
        const delta = shield.exposed ? disabled ? 0 : -shield.exposed * config.shieldDrainPerHour * rate(owner ?? '', 'shield_drain') : shield.energy >= config.shieldMaxEnergy ? 0 : config.shieldRechargePerHour;
        return [id, { ...shield, energy: shield.energy + dt * delta }];
      })) } } : {}),
    rocks: scene.rocks.map(r => r.drift ? { ...r, ...sitePosition(scene, r, hour) } : r),
    coverage: scene.coverage.map(s => s.drift ? { ...s, ...sitePosition(scene, s, hour) } : s),
  };
}
