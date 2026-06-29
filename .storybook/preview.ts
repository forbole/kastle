import type { Preview } from '@storybook/react';
import '../ui/globals.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: 'fullscreen',
    viewport: {
      viewports: {
        extension: {
          name: 'Extension',
          styles: { width: '375px', height: '600px' },
          type: 'mobile',
        },
        fullscreen: {
          name: 'Fullscreen',
          styles: { width: '1280px', height: '800px' },
          type: 'desktop',
        },
      },
      defaultViewport: 'extension',
    },
  },
};

export default preview;
