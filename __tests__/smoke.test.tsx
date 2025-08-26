import React from 'react';
import { render } from '@testing-library/react-native';
import App from '../App';

describe('App smoke', () => {
  it('renders without crashing', () => {
    const tree = render(<App />);
    expect(tree).toBeTruthy();
  });
});





