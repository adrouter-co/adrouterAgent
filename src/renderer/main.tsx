import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './monaco';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Unable to find the app root.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
