import React from 'react';
import CommandCard from './CommandCard';

type Props = {
  subtitle?: string;
  onSubmit?: () => void;
  children?: React.ReactNode;
};

const ActionsCard: React.FC<Props> = ({ subtitle, onSubmit, children }) => (
  <CommandCard
    kind="actions"
    title="Actions"
    subtitle={subtitle}
    buttonLabel="Create Action"
    onButtonPress={onSubmit}
  >
    {children}
  </CommandCard>
);

export default ActionsCard;
