/** How long a simulated job stays queued and when it finishes, in ms since it was created. */
export interface JobDelays { running: number; done: number }

export const defaultJobDelays: JobDelays = { running: 1000, done: 3000 }
