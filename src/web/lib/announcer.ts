import { useSyncExternalStore } from 'react';

export interface Announcement {
  /** Grows with every announcement, so the same text twice in a row is still a new message. */
  readonly id: number;
  readonly text: string;
}

export interface AnnouncerStore {
  get: () => Announcement;
  subscribe: (listener: () => void) => () => void;
  announce: (text: string) => void;
}

/** Holds the latest screen reader announcement outside any component, so it can be set from async code. */
function createAnnouncerStore(): AnnouncerStore {
  let current: Announcement = { id: 0, text: '' };
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    announce: (text) => {
      current = { id: current.id + 1, text };
      listeners.forEach((l) => {
        l();
      });
    },
  };
}

export const announcerStore: AnnouncerStore = createAnnouncerStore();

/** Announces the outcome of a successful action to screen readers (polite). */
export function announce(text: string): void {
  announcerStore.announce(text);
}

export function useAnnouncement(): Announcement {
  return useSyncExternalStore(announcerStore.subscribe, announcerStore.get, announcerStore.get);
}
