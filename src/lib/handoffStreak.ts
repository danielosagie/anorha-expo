export type HandoffAnswer = 'primary' | 'secondary';

export interface HandoffStreak<Reason = string> {
  reason: Reason;
  answer: HandoffAnswer;
  count: number;
  thumbnails: Array<string | null>;
}

export interface HandoffCardIdentity<Reason = string> {
  reason: Reason;
  kind: string;
}

export interface HandoffSelection<Card, Reason = string> {
  reason: Reason;
  answer: HandoffAnswer;
  cards: Card[];
  thumbnails: Array<string | null>;
}

export function advanceAnswerStreak<Reason>(
  previous: HandoffStreak<Reason> | null,
  card: HandoffCardIdentity<Reason>,
  answer: HandoffAnswer | 'unsure',
  thumbnail: string | null,
  eligible: boolean,
): HandoffStreak<Reason> | null {
  // Deferring one odd card says nothing about the seller's pattern on the
  // class — a "Later" leaves the streak exactly as it was. Only a real answer
  // that contradicts the streak (different answer, or one that cannot be
  // reused) resets it.
  if (answer === 'unsure') return previous;
  if (!eligible) return null;

  return previous && previous.reason === card.reason && previous.answer === answer
    ? {
        reason: card.reason,
        answer,
        count: previous.count + 1,
        thumbnails: [...previous.thumbnails, thumbnail].slice(-3),
      }
    : { reason: card.reason, answer, count: 1, thumbnails: [thumbnail] };
}

export function selectHandoffCards<Card extends HandoffCardIdentity<Reason>, Reason>(
  streak: HandoffStreak<Reason> | null,
  remainingCards: Card[],
  isEligible: (card: Card) => boolean,
): HandoffSelection<Card, Reason> | null {
  // Three consistent answers EARN the offer; more never un-earn it. Firing
  // only at exactly three was a one-shot window — an interleaved card or an
  // offer with nothing to absorb at that instant closed it forever, and run 6
  // paid ~18 one-by-one answers for it. Repeat offers are governed upstream
  // (an accepted offer clears the cards; "Keep showing me" suppresses the
  // reason+answer key).
  if (!streak || streak.count < 3) return null;
  const cards = remainingCards.filter(
    (card) => card.reason === streak.reason && isEligible(card),
  );
  if (cards.length === 0) return null;
  return {
    reason: streak.reason,
    answer: streak.answer,
    cards,
    thumbnails: streak.thumbnails,
  };
}
