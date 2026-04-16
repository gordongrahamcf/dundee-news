import './style.css';
import { fetchArticlePool, pickArticles, ACTIVE_SOURCES } from './newsService';
import type { ArticlePool } from './newsService';
import type { NewsArticle } from './types';
import { renderArticleCard, renderSkeleton, renderError, renderEmpty, formatRelativeTime } from './ui';

const app = document.getElementById('app')!;
const CACHE_KEY = 'dundee-news-cache';

// --- Cache helpers ---

interface SerializedPool {
  articles: Array<Omit<NewsArticle, 'publishedAt'> & { publishedAt: string }>;
  fetchedAt: string;
}

/** Returns the most recent 6am (local time) — the daily cache refresh boundary. */
function getLastRefreshCutoff(): Date {
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0, 0, 0);
  if (now < cutoff) cutoff.setDate(cutoff.getDate() - 1);
  return cutoff;
}

function savePool(pool: ArticlePool): void {
  try {
    const serialized: SerializedPool = {
      articles: pool.articles.map(a => ({ ...a, publishedAt: a.publishedAt.toISOString() })),
      fetchedAt: pool.fetchedAt.toISOString(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(serialized));
  } catch { /* storage full or unavailable */ }
}

function loadPool(): ArticlePool | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const serialized: SerializedPool = JSON.parse(raw);
    const fetchedAt = new Date(serialized.fetchedAt);
    if (fetchedAt < getLastRefreshCutoff()) return null; // stale — past 6am boundary
    const articles = serialized.articles.map(a => ({ ...a, publishedAt: new Date(a.publishedAt) }));
    return { articles, fetchedAt };
  } catch {
    return null;
  }
}

// --- Shell ---

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
          <div class="producer-block">
            <img
              class="producer-avatar"
              src="https://ca.slack-edge.com/T0269F16S-U02S05HNB-28534f5b8723-512"
              alt="Gordon Graham"
            />
            <div class="producer-text">
              <span class="producer-label">A James Malcolm Production</span>
              <span class="producer-credit">brought to you by Gordon Graham</span>
            </div>
          </div>
        </div>
        <button class="refresh-btn" id="refreshBtn" aria-label="Shuffle articles">
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
      <p>Sources: ${ACTIVE_SOURCES.join(' · ')}</p>
      <p class="footer-sub" id="footerSub">Refreshes daily at 6am · Built with TypeScript</p>
    </footer>
  `;
}

function spawnParticles(): void {
  const container = document.getElementById('particles');
  if (!container) return;
  for (let i = 0; i < 30; i++) {
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

// --- News loading ---

let currentPool: ArticlePool | null = null;

async function loadNews(forceRefresh = false): Promise<void> {
  const grid = document.getElementById('grid')!;
  const label = document.getElementById('articlesLabel')!;
  const footerSub = document.getElementById('footerSub')!;
  const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
  const refreshIcon = document.getElementById('refreshIcon')!;

  refreshBtn.disabled = true;
  refreshIcon.classList.add('spinning');

  // Only show skeleton on first load or forced refresh, not on shuffle
  const isFirstLoad = !currentPool;
  if (isFirstLoad || forceRefresh) {
    grid.innerHTML = renderSkeleton();
    label.textContent = 'Fetching latest news…';
  }

  try {
    // Use cached pool if available and fresh; shuffle re-picks from same pool
    if (!forceRefresh) {
      currentPool = currentPool ?? loadPool();
    }

    if (!currentPool) {
      currentPool = await fetchArticlePool();
      savePool(currentPool);
    }

    const articles = pickArticles(currentPool.articles);

    if (articles.length === 0) {
      grid.innerHTML = renderEmpty();
      label.textContent = 'No recent articles found';
    } else {
      grid.innerHTML = articles.map((a, i) => renderArticleCard(a, i)).join('');

      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const hasOlderArticles = articles.some(a => a.publishedAt < cutoff24h);
      const windowLabel = hasOlderArticles ? 'past 7 days' : 'past 24 hours';
      label.textContent = `${articles.length} articles · ${windowLabel}`;

      const fetchedAgo = formatRelativeTime(currentPool.fetchedAt);
      footerSub.textContent = `Last fetched ${fetchedAgo} · Refreshes daily at 6am · Built with TypeScript`;

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
  if (btn) loadNews(); // shuffles from cached pool — no network call
});
