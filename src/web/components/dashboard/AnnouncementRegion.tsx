import { useState } from 'react';
import { announcerStore, useAnnouncement } from '@/lib/announcer';

/**
 * Hidden polite status region for the outcome of row actions. Always mounted, so assistive technology
 * registers it before the first message. The text sits in an element keyed by the message id, so the same
 * text announced twice in a row replaces the node and is read again. The store outlives the page, so the
 * region remembers the id at mount and shows only messages announced after it.
 */
export function AnnouncementRegion() {
  const [mountId] = useState(() => announcerStore.get().id);
  const { id, text } = useAnnouncement();
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-slot="announcement-region">
      {id > mountId && text !== '' ? <span key={id}>{text}</span> : null}
    </div>
  );
}
