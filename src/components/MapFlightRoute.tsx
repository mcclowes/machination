/** Render the exact frozen course used by fleet motion and ETA calculation. */
import React from 'react';
import { Line, Path } from 'react-native-svg';
import type { FlightRoute } from '../game/flight-route';
export function MapFlightRoute({ route, sx, sy, ...props }: { route: FlightRoute; sx: number; sy: number; stroke: string; opacity?: number; strokeWidth?: number; strokeDasharray?: string }) {
  return route.course
    ? <Path testID="gravity-flight-route" d={route.course.map((p, i) => `${i ? 'L' : 'M'} ${p.x * sx} ${p.y * sy}`).join(' ')} fill="none" {...props} />
    : <Line x1={route.from.x * sx} y1={route.from.y * sy} x2={route.to.x * sx} y2={route.to.y * sy} {...props} />;
}
