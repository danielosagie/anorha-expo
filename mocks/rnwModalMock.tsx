/**
 * Web mock for react-native-web's Modal (design-export only).
 * The real Modal renders a viewport-fixed portal, which escapes the device-frame
 * tiles in the export gallery. This renders modal content INLINE (absolute-fill
 * within the nearest positioned ancestor) so sheets/modals appear inside their tile.
 * Respects `visible`.
 */
import React from 'react';

export default function Modal(props: any) {
  const { visible = true, children } = props || {};
  if (visible === false) return null;
  return React.createElement(
    'div',
    {
      style: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 50,
      },
    },
    children
  );
}
