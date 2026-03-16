import React from 'react';
import CommandCard from './CommandCard';

type Props = {
  subtitle?: string;
  onSubmit?: () => void;
  children?: React.ReactNode;
};

const SummarizeCard: React.FC<Props> = ({ subtitle, onSubmit, children }) => (
  <CommandCard
    kind="summarize"
    title="Summarize"
    subtitle={subtitle}
    buttonLabel="Summarize"
    onButtonPress={onSubmit}
  >
    {children}
  </CommandCard>
);

export default SummarizeCard;
