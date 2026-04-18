import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import LampifierApp from './LampifierApp.jsx'
import GcodeEditorApp from './GcodeEditorApp.jsx'

function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  if (hash.startsWith('#/lampifier'))   return <LampifierApp />;
  if (hash.startsWith('#/gcode-editor')) return <GcodeEditorApp />;
  return <App />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
