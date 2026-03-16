import React from 'react';
import CommandCard from './CommandCard';

type Props = {
  subtitle?: string;
  onSubmit?: () => void;
  children?: React.ReactNode;
};

const AskCard: React.FC<Props> = ({ subtitle, onSubmit, children }) => (
  <CommandCard
    kind="ask"
    title="Ask"
    subtitle={subtitle}
    buttonLabel="Ask"
    onButtonPress={onSubmit}
  >
    {children}
  </CommandCard>
);

export default AskCard;
