import type { NewsArticle, SourceKey, SourceConfig } from './types';

const SOURCE_CONFIGS: Record<SourceKey, SourceConfig> = {
  guardian: {
    key: 'guardian',
    label: 'The Guardian',
    color: '#005689',
    emoji: '🔵',
  },
  bbc: {
    key: 'bbc',
    label: 'BBC Scotland',
    color: '#BB1919',
    emoji: '🔴',
  },
  courier: {
    key: 'courier',
    label: 'The Courier',
    color: '#e63946',
    emoji: '📰',
  },
  dundeelive: {
    key: 'dundeelive',
    label: 'Dundee Live',
    color: '#8338EC',
    emoji: '⚡',
  },
};

const GRADIENT_STYLES = [
  'linear-gradient(135deg, #0066cc 0%, #00bcd4 100%)',
  'linear-gradient(135deg, #7B1FA2 0%, #e91e8c 100%)',
  'linear-gradient(135deg, #FFB703 0%, #FB8500 100%)',
  'linear-gradient(135deg, #00ACC1 0%, #4CAF50 100%)',
  'linear-gradient(135deg, #e91e8c 0%, #f44336 100%)',
];

export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays} days ago`;
}

export function renderSkeleton(): string {
  return Array.from({ length: 5 })
    .map(
      (_, i) => `
    <article class="card skeleton" style="animation-delay: ${i * 0.1}s">
      <div class="card-image skeleton-block"></div>
      <div class="card-body">
        <div class="skeleton-line short"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line medium"></div>
      </div>
    </article>
  `
    )
    .join('');
}

export function renderArticleCard(article: NewsArticle, index: number): string {
  const config = SOURCE_CONFIGS[article.sourceKey] ?? {
    label: article.source,
    color: '#555',
    emoji: '📄',
  };

  const timeStr = formatRelativeTime(article.publishedAt);
  const gradient = GRADIENT_STYLES[index % GRADIENT_STYLES.length];

  const imageSection = article.imageUrl
    ? `<div class="card-image" style="background-image: url('${escapeAttr(article.imageUrl)}')">
        <div class="image-overlay"></div>
       </div>`
    : `<div class="card-image card-image--placeholder" style="background: ${gradient}">
        <span class="placeholder-emoji">${config.emoji}</span>
       </div>`;

  const authorSection = article.author
    ? `<span class="card-author">by ${escapeHtml(article.author)}</span>`
    : '';

  return `
    <article class="card" style="--source-color: ${config.color}; animation-delay: ${index * 0.08}s" data-index="${index}">
      ${imageSection}
      <div class="card-body">
        <div class="card-meta">
          <span class="source-badge" style="background: ${config.color}">${config.emoji} ${escapeHtml(article.source)}</span>
          <span class="card-time">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/>
            </svg>
            ${timeStr}
          </span>
        </div>
        <h2 class="card-title">${escapeHtml(article.title)}</h2>
        <p class="card-description">${escapeHtml(article.description)}</p>
        <div class="card-footer">
          ${authorSection}
          <a href="${escapeAttr(article.url)}" target="_blank" rel="noopener noreferrer" class="read-more">
            Read article
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/>
            </svg>
          </a>
        </div>
      </div>
    </article>
  `;
}

export function renderError(message: string): string {
  return `
    <div class="error-state">
      <div class="error-icon">⚠️</div>
      <h3>Couldn't fetch news</h3>
      <p>${escapeHtml(message)}</p>
      <p class="error-hint">Check your connection and try refreshing.</p>
    </div>
  `;
}

export function renderEmpty(): string {
  return `
    <div class="empty-state">
      <div class="empty-icon">🔍</div>
      <h3>No recent Dundee news found</h3>
      <p>Nothing from the past 24 hours — try refreshing or check back later.</p>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
