import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tasktracker.app',
  appName: 'Task Tracker',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'LIGHT',
      backgroundColor: '#ffffff',
    },
  },
};

export default config;
