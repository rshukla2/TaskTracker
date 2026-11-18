import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (Capacitor.isNativePlatform()) {
  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  if (Capacitor.getPlatform() === 'android') {
    StatusBar.setBackgroundColor({ color: '#ffffff' }).catch(() => {});
  }
}

createRoot(document.getElementById('root')!).render(<App />);
