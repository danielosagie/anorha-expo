import React from 'react';
import { View, ViewStyle } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

export type AnorhaFaceProps = {
  /** Height in px; width auto-scales to the mark's 23×19 aspect. */
  size?: number;
  /**
   * Wrap the mark in a soft rounded backing so it stays legible on busy or
   * mid-tone surfaces. The mark itself is a white chip with slate (#555) strokes,
   * so on green/dark hero and plain white it already reads — pass `bordered`
   * only when it sits on a coloured/patterned wrapper that would swallow it.
   */
  bordered?: boolean;
  style?: ViewStyle;
};

/**
 * AnorhaFace — the Sprout agent's brand mark: a white chip with slate brows, a
 * nose and a smile, taken verbatim from the dashboard mockup ("home blurb"). This
 * is the single source of truth for Sprout's face; every Sprout-persona avatar in
 * the app imports it rather than re-drawing an Icon glyph. The path data is
 * load-bearing (it matches the mockup) — do not redraw it.
 */
export const AnorhaFace = ({ size = 20, bordered = false, style }: AnorhaFaceProps) => {
  const mark = (
    <Svg width={(size * 23) / 19} height={size} viewBox="0 0 23 19">
      <G transform="translate(1,1)">
        <Path
          d="M18.833 0C18.833 0 2.167 0 2.167 0C0.97 0 0 0.988 0 2.208L0 14.774C0 15.993 0.97 16.981 2.167 16.981L18.833 16.981C20.03 16.981 21 15.993 21 14.774L21 2.208C21 0.988 20.03 0 18.833 0Z"
          fill="#FFFFFF"
          stroke="#555555"
          strokeWidth={2.5}
        />
        <G transform="translate(12.833,4.415)">
          <Path
            d="M0 2.038C0.087 1.7 0.484 0.737 0.935 0.272C1.222 -0.023 1.592 0.001 2.097 0C2.376 0.024 2.855 0.082 3.265 0.111C3.674 0.141 3.999 0.141 4.333 0.141"
            fill="none"
            stroke="#555555"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        </G>
        <G transform="translate(9.75,4.491)">
          <Path
            d="M0 0.5C0 0.5 0 0 0 0C0 0 1.5 0 1.5 0C1.5 0 1.5 0.5 1.5 0.5C1.5 0.5 0.75 0.5 0.75 0.5C0.75 0.5 0 0.5 0 0.5ZM1.5 4.5C1.5 4.776 1.164 5 0.75 5C0.336 5 0 4.776 0 4.5C0 4.5 0.75 4.5 0.75 4.5C0.75 4.5 1.5 4.5 1.5 4.5ZM1.5 0.5C1.5 0.5 0.75 0.5 0.75 0.5C0.75 0.5 0 0.5 0 0.5C0 0.5 0 4.5 0 4.5C0 4.5 0.75 4.5 0.75 4.5C0.75 4.5 1.5 4.5 1.5 4.5C1.5 4.5 1.5 0.5 1.5 0.5Z"
            fill="#555555"
          />
        </G>
        <G transform="translate(3.5,4.415)">
          <Path
            d="M4.333 2.038C4.247 1.7 3.849 0.737 3.398 0.272C3.112 -0.023 2.741 0.001 2.237 0C1.958 0.024 1.478 0.082 1.068 0.111C0.659 0.141 0.334 0.141 0 0.141"
            fill="none"
            stroke="#555555"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        </G>
        <G transform="translate(5.833,11.887)">
          <Path
            d="M0 0C1.333 1.189 3.025 0.34 4.667 0.34C6.167 0.34 7.833 1.019 9.333 0"
            fill="none"
            stroke="#555555"
            strokeWidth={1.5}
            strokeLinecap="square"
          />
        </G>
      </G>
    </Svg>
  );

  if (!bordered) return mark;

  const pad = Math.max(3, Math.round(size * 0.22));
  return (
    <View
      style={[
        {
          padding: pad,
          backgroundColor: '#FFFFFF',
          borderRadius: pad + 5,
          borderWidth: 1,
          borderColor: 'rgba(0,0,0,0.06)',
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {mark}
    </View>
  );
};

export default AnorhaFace;
