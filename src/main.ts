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

// --- Konami code easter egg ---

const KONAMI = [
  'ArrowUp','ArrowUp','ArrowDown','ArrowDown',
  'ArrowLeft','ArrowRight','ArrowLeft','ArrowRight',
  'b','a','Enter',
];
let konamiProgress = 0;

function openPuzzleModal(): void {
  const IMG = 'https://ca.slack-edge.com/T0269F16S-U02S05HNB-28534f5b8723-512';
  const N = 3;
  let tiles: number[] = [];
  let moves = 0;
  let animating = false;

  function adjacent(idx: number): number[] {
    const r = Math.floor(idx / N), c = idx % N;
    const result: number[] = [];
    if (r > 0)   result.push(idx - N);
    if (r < N-1) result.push(idx + N);
    if (c > 0)   result.push(idx - 1);
    if (c < N-1) result.push(idx + 1);
    return result;
  }

  function newGame(): void {
    tiles = [1,2,3,4,5,6,7,8,0];
    let emptyIdx = 8, lastEmpty = -1;
    for (let i = 0; i < 300; i++) {
      const opts = adjacent(emptyIdx).filter(a => a !== lastEmpty);
      const pick = opts[Math.floor(Math.random() * opts.length)];
      [tiles[emptyIdx], tiles[pick]] = [tiles[pick], tiles[emptyIdx]];
      lastEmpty = emptyIdx;
      emptyIdx = pick;
    }
    moves = 0;
    animating = false;
  }

  function isSolved(): boolean {
    return tiles.every((v, i) => i === N * N - 1 ? v === 0 : v === i + 1);
  }

  function render(wrap: HTMLElement): void {
    const grid = wrap.querySelector<HTMLElement>('.puzzle-grid')!;
    const movesEl = wrap.querySelector<HTMLElement>('.puzzle-moves')!;
    const winEl = wrap.querySelector<HTMLElement>('.puzzle-win')!;
    const solved = isSolved() && moves > 0;
    movesEl.textContent = `Moves: ${moves}`;
    winEl.classList.toggle('puzzle-win--visible', solved);
    if (solved) grid.classList.add('puzzle-grid--solved');

    grid.innerHTML = '';
    const emptyIdx = tiles.indexOf(0);

    tiles.forEach((value, idx) => {
      const tile = document.createElement('button');
      tile.className = 'puzzle-tile';
      tile.type = 'button';

      if (value === 0) {
        tile.classList.add('puzzle-tile--empty');
        tile.setAttribute('aria-hidden', 'true');
      } else {
        const origRow = Math.floor((value - 1) / N);
        const origCol = (value - 1) % N;
        tile.style.backgroundImage = `url(${IMG})`;
        tile.style.backgroundSize = '300% 300%';
        tile.style.backgroundPosition =
          `${(origCol / (N - 1)) * 100}% ${(origRow / (N - 1)) * 100}%`;
        tile.setAttribute('aria-label', `Tile ${value}`);

        if (!animating && !solved && adjacent(emptyIdx).includes(idx)) {
          tile.classList.add('puzzle-tile--movable');
          tile.addEventListener('click', () => moveTile(idx, wrap));
        }
      }

      grid.appendChild(tile);
    });
  }

  function moveTile(tileIdx: number, wrap: HTMLElement): void {
    if (animating) return;
    const emptyIdx = tiles.indexOf(0);
    if (!adjacent(emptyIdx).includes(tileIdx)) return;

    const grid = wrap.querySelector<HTMLElement>('.puzzle-grid')!;
    const tileBtns = grid.querySelectorAll<HTMLElement>('.puzzle-tile');
    const tileEl  = tileBtns[tileIdx];
    const emptyEl = tileBtns[emptyIdx];

    const tileRect  = tileEl.getBoundingClientRect();
    const emptyRect = emptyEl.getBoundingClientRect();
    const dx = emptyRect.left - tileRect.left;
    const dy = emptyRect.top  - tileRect.top;

    animating = true;
    grid.style.pointerEvents = 'none';
    tileEl.style.transition = 'transform 0.14s ease';
    tileEl.style.transform  = `translate(${dx}px,${dy}px)`;
    tileEl.style.zIndex     = '2';

    setTimeout(() => {
      [tiles[emptyIdx], tiles[tileIdx]] = [tiles[tileIdx], tiles[emptyIdx]];
      moves++;
      tileEl.style.transition = '';
      tileEl.style.transform  = '';
      tileEl.style.zIndex     = '';
      grid.style.pointerEvents = '';
      animating = false;
      render(wrap);
    }, 150);
  }

  // Build modal DOM
  const modal = document.createElement('div');
  modal.className = 'puzzle-overlay';
  modal.innerHTML = `
    <div class="puzzle-box" role="dialog" aria-modal="true" aria-label="Sliding Puzzle">
      <button class="puzzle-close" aria-label="Close">✕</button>
      <div class="puzzle-header">
        <h2 class="puzzle-title">Slide the Face</h2>
        <p class="puzzle-subtitle">Restore James to his former glory</p>
      </div>
      <div class="puzzle-meta">
        <span class="puzzle-moves">Moves: 0</span>
        <button class="puzzle-new-btn" type="button">New Game</button>
      </div>
      <div class="puzzle-grid"></div>
      <div class="puzzle-win">🎉 Solved! Nice one.</div>
    </div>
  `;

  document.body.appendChild(modal);
  newGame();
  render(modal);
  requestAnimationFrame(() => modal.classList.add('puzzle-overlay--visible'));

  const close = () => {
    modal.classList.remove('puzzle-overlay--visible');
    modal.addEventListener('transitionend', () => modal.remove(), { once: true });
  };

  modal.querySelector('.puzzle-close')!.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
  });

  modal.querySelector('.puzzle-new-btn')!.addEventListener('click', () => {
    modal.querySelector('.puzzle-grid')?.classList.remove('puzzle-grid--solved');
    newGame();
    render(modal);
  });
}

document.addEventListener('keydown', e => {
  if (e.key === KONAMI[konamiProgress]) {
    konamiProgress++;
    if (konamiProgress === KONAMI.length) {
      konamiProgress = 0;
      openPuzzleModal();
    }
  } else {
    konamiProgress = e.key === KONAMI[0] ? 1 : 0;
  }
});

buildShell();
spawnParticles();
loadNews();

document.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest('#refreshBtn');
  if (btn) loadNews(); // shuffles from cached pool — no network call
});
