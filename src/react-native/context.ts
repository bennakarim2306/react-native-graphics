import { createContext } from 'react';
import type { Engine } from '../engine/engine';

/** The provider's engine, or null before the provider has mounted. */
export const GameFXContext = createContext<Engine | null | undefined>(undefined);
