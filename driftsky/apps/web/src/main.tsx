import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles.css';
import { Header, Footer, CookieBanner } from './components/Chrome';
import { Home } from './pages/Home';
import { Privacy, Refunds, Terms } from './pages/Legal';
import { LostKey, NotFound, Thanks } from './pages/Other';
import { scrollToHash, usePath } from './router';
import { initAnalytics } from './analytics';

const PAGES: Record<string, { el: () => JSX.Element; title: string }> = {
  '/': { el: Home, title: 'Driftsky: weather for your desktop' },
  '/terms': { el: Terms, title: 'Terms · Driftsky' },
  '/privacy': { el: Privacy, title: 'Privacy · Driftsky' },
  '/refunds': { el: Refunds, title: 'Refund policy · Driftsky' },
  '/thanks': { el: Thanks, title: 'Thank you · Driftsky' },
  '/lost-key': { el: LostKey, title: 'Lost your key · Driftsky' },
};

function App() {
  const path = usePath();
  const page = PAGES[path];
  useEffect(() => {
    document.title = page?.title ?? 'Not found · Driftsky';
    if (location.hash) scrollToHash(location.hash, false);
  }, [path, page]);
  const Page = page?.el ?? NotFound;
  return (
    <>
      <Header />
      <Page key={path} />
      <Footer />
      <CookieBanner />
    </>
  );
}

initAnalytics();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
