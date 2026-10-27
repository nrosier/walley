import { useSyncExternalStore } from 'react';

/** Which message a dashboard notice shows; the text comes from the create-modal catalogue. */
export type NoticeKind = 'payeeCreated' | 'categoryError';

export interface Notice {
  readonly id: number;
  readonly kind: NoticeKind;
}

export interface NoticeStore {
  getNotices: () => readonly Notice[];
  subscribe: (listener: () => void) => () => void;
  push: (kinds: readonly NoticeKind[]) => void;
  dismiss: (id: number) => void;
}

/** Holds notices outside any component, so they outlive the create modal and the row that opened it. */
export function createNoticeStore(): NoticeStore {
  let notices: readonly Notice[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const set = (next: readonly Notice[]) => {
    notices = next;
    listeners.forEach((l) => {
      l();
    });
  };
  return {
    getNotices: () => notices,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    push: (kinds) => {
      if (kinds.length === 0) return;
      set([...notices, ...kinds.map((kind) => ({ id: nextId++, kind }))]);
    },
    dismiss: (id) => {
      set(notices.filter((n) => n.id !== id));
    },
  };
}

export const noticeStore: NoticeStore = createNoticeStore();

export function useNotices(store: NoticeStore = noticeStore): readonly Notice[] {
  return useSyncExternalStore(store.subscribe, store.getNotices);
}

/** The notices a successful Actual create reports: a payee was created, the category could not be set. */
export function createNoticeKinds(result: { payeeCreated: boolean; categoryError?: boolean }): NoticeKind[] {
  const kinds: NoticeKind[] = [];
  if (result.payeeCreated) kinds.push('payeeCreated');
  if (result.categoryError === true) kinds.push('categoryError');
  return kinds;
}
