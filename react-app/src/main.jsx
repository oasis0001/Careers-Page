import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// NOTE: intentionally NOT wrapped in <React.StrictMode>. The scenes own long-lived
// WebGL contexts, requestAnimationFrame loops and global event listeners that are
// set up imperatively in useEffect; StrictMode's double-invoke in development would
// spin up two renderers/RAF loops and is unnecessary for this single-mount app.
createRoot(document.getElementById('root')).render(<App />);
