import React from 'react';
import CommandCard from './CommandCard';

type Props = {
  subtitle?: string;
  onSubmit?: () => void;
  children?: React.ReactNode;
};

const DiscussCard: React.FC<Props> = ({ subtitle, onSubmit, children }) => (
  <CommandCard
    kind="discuss"
    title="Discuss"
    subtitle={subtitle}
    buttonLabel="Discuss"
    onButtonPress={onSubmit}
  >
    {children}
  </CommandCard>
);

export default DiscussCard;
