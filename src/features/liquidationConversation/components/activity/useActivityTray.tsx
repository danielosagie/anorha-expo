// useActivityTray — owns the review-tray visibility + the active payload, lifted
// into ConversationList so ONE ActivityTraySheet instance serves the whole feed.
// (If each bubble owned its own sheet, FlashList recycling could unmount an open
// tray as the row scrolls off — this hoist avoids that entirely.)
import { useCallback, useState } from 'react';
import type { ActivityPayload } from '../../types';

export function useActivityTray() {
  const [payload, setPayload] = useState<ActivityPayload | null>(null);
  const [visible, setVisible] = useState(false);

  const openTray = useCallback((p: ActivityPayload) => {
    setPayload(p);
    setVisible(true);
  }, []);

  // Hide, but keep the payload mounted so the close animation can play out.
  const onClose = useCallback(() => setVisible(false), []);

  return {
    openTray,
    trayProps: { visible, payload, onClose },
  };
}
