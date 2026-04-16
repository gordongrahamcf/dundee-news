import './style.css';
import { fetchDundeeNews } from './newsService';
import { renderArticleCard, renderSkeleton, renderError, renderEmpty } from './ui';

const app = document.getElementById('app')!;

function buildShell(): void {
  app.innerHTML = `
    <div class="bg-particles" aria-hidden="true" id="particles"></div>

    <header class="header">
      <div class="header-inner">
        <div class="logo-block">
          <div class="logo-icon">🏴󠁧󠁢󠁳󠁣󠁴󠁿</div>
          <div class="logo-text">
            <h1 class="logo-title">Dundee News</h1>
            <p class="logo-subtitle">City of Discovery · Live Updates</p>
          </div>
        </div>
        <button class="refresh-btn" id="refreshBtn" aria-label="Refresh news">
          <svg class="refresh-icon" id="refreshIcon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          <span>Shuffle</span>
        </button>
      </div>
    </header>

    <main class="main">
      <div class="articles-header">
        <div class="live-dot" aria-label="Live updates"></div>
        <span id="articlesLabel">Fetching latest news…</span>
      </div>
      <div class="grid" id="grid">
        ${renderSkeleton()}
      </div>
    </main>

    <footer class="footer">
      <p>Sources: The Guardian · BBC Scotland · The Courier · Dundee Live</p>
      <p class="footer-sub">Showing articles from the past 24 hours · Built with TypeScript</p>
    </footer>
  `;
}

function spawnParticles(): void {
  const container = document.getElementById('particles');
  if (!container) return;
  const count = 30;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = `${Math.random() * 100}%`;
    p.style.top = `${Math.random() * 100}%`;
    p.style.animationDelay = `${Math.random() * 8}s`;
    p.style.animationDuration = `${6 + Math.random() * 8}s`;
    p.style.width = p.style.height = `${2 + Math.random() * 4}px`;
    p.style.opacity = `${0.1 + Math.random() * 0.4}`;
    container.appendChild(p);
  }
}

async function loadNews(): Promise<void> {
  const grid = document.getElementById('grid')!;
  const label = document.getElementById('articlesLabel')!;
  const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
  const refreshIcon = document.getElementById('refreshIcon')!;

  refreshBtn.disabled = true;
  refreshIcon.classList.add('spinning');
  grid.innerHTML = renderSkeleton();
  label.textContent = 'Fetching latest news…';

  try {
    const { articles, expandedWindow } = await fetchDundeeNews();

    if (articles.length === 0) {
      grid.innerHTML = renderEmpty();
      label.textContent = 'No recent articles found';
    } else {
      grid.innerHTML = articles.map((a, i) => renderArticleCard(a, i)).join('');

      const count = articles.length;
      const windowLabel = expandedWindow ? 'past 7 days' : 'past 24 hours';
      label.textContent = `${count} article${count !== 1 ? 's' : ''} · ${windowLabel}`;

      // Trigger enter animation
      requestAnimationFrame(() => {
        grid.querySelectorAll<HTMLElement>('.card').forEach(card => {
          card.classList.add('card--visible');
        });
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    grid.innerHTML = renderError(msg);
    label.textContent = 'Failed to load news';
  } finally {
    refreshBtn.disabled = false;
    refreshIcon.classList.remove('spinning');
  }
}

buildShell();
spawnParticles();
loadNews();

document.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest('#refreshBtn');
  if (btn) loadNews();
});
