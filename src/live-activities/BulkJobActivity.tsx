import { createLiveActivity } from 'expo-widgets';
import { HStack, Text, VStack } from '@expo/ui/swift-ui';

export type BulkJobActivityProps = {
  title: string;
  titleShort: string;
  stage: string;
  current: number;
  total: number;
  progress: number; // 0..1
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const BulkJobActivity = (props: BulkJobActivityProps) => {
  'widget';
  const total = Math.max(1, props.total || 1);
  const current = clamp(props.current || 1, 1, total);
  const percent = clamp(Math.round((props.progress || 0) * 100), 0, 100);

  return {
    banner: (
      <VStack spacing={4}>
        <Text>{props.title}</Text>
        <Text>{props.stage}</Text>
        <HStack spacing={8}>
          <Text>{`Item ${current} of ${total}`}</Text>
          <Text>{`${percent}%`}</Text>
        </HStack>
      </VStack>
    ),
    compactLeading: <Text>{props.titleShort}</Text>,
    compactTrailing: <Text>{`${current}/${total}`}</Text>,
    minimal: <Text>{`${percent}%`}</Text>,
  };
};

export default createLiveActivity('BulkJobActivity', BulkJobActivity);
