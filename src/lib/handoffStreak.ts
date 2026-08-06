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
  if (answer === 'unsure' || !eligible) return null;

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
  if (!streak || streak.count !== 3) return null;
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
