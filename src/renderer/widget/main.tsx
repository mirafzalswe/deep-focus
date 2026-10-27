import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/theme.css';
import './widget.css';
import { SettingsProvider } from '../shared/settings';
import { WidgetApp } from './WidgetApp';

// Окно виджета прозрачное: фон рисует сам виджет с widget.backgroundOpacity (widget.css).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <WidgetApp />
    </SettingsProvider>
  </StrictMode>,
);
