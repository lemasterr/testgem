import type { ManagedSession } from '../../shared/types';

export type Session = Omit<ManagedSession, 'status' | 'promptCount' | 'titleCount' | 'hasFiles'>;
