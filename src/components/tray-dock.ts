/**
 * ---
 * purpose: Lets the operation shell shrink the time tray to one line while a phone sheet is open.
 * ---
 */
import { createContext } from 'react';

export type TrayDock = { docked: boolean; undock: () => void };
export const TrayDockContext = createContext<TrayDock>({ docked: false, undock: () => {} });
