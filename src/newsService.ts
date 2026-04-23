import type { NewsArticle, GuardianApiResponse, Rss2JsonResponse, SourceKey } from './types';

const GUARDIAN_API_KEY = 'test';
const RSS2JSON_BASE = 'https://api.rss2json.com/v1/api.json';

interface RssFeed {
  url: string;
  source: string;
  sourceKey: SourceKey;
  filterKeywords?: string[];
}

const RSS_FEEDS: RssFeed[] = [
  {
    url: 'https://www.thecourier.co.uk/feed/',
    source: 'The Courier',
    sourceKey: 'courier',
  },
  {
    url: 'https://feeds.bbci.co.uk/news/scotland/rss.xml',
    source: 'BBC Scotland',
    sourceKey: 'bbc',
    filterKeywords: [
      'dundee', 'tayside', 'angus',
      'forfar', 'arbroath', 'montrose', 'carnoustie',
      'kirriemuir', 'brechin', 'broughty ferry',
    ],
  },
  {
    url: 'https://news.stv.tv/feed',
    source: 'STV News',
    sourceKey: 'stv',
    filterKeywords: [
      'dundee', 'tayside', 'angus',
      'forfar', 'arbroath', 'montrose', 'carnoustie',
      'kirriemuir', 'brechin', 'broughty ferry',
    ],
  },
];

export const ACTIVE_SOURCES = ['The Guardian', ...RSS_FEEDS.map(f => f.source), 'L&C Dundee'];

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function isWithinHours(date: Date, hours: number): boolean {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hours);
  return date >= cutoff;
}

// Guardian is always fetched with a 7-day window so it always contributes
// to the pool even on days with no Dundee breaking news.
async function fetchGuardianArticles(): Promise<NewsArticle[]> {
  try {
    const fromDate = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return d.toISOString().split('T')[0];
    })();

    const url = new URL('https://content.guardianapis.com/search');
    url.searchParams.set('q', 'Dundee');
    url.searchParams.set('api-key', GUARDIAN_API_KEY);
    url.searchParams.set('from-date', fromDate);
    url.searchParams.set('page-size', '20');
    url.searchParams.set('show-fields', 'thumbnail,trailText,byline');
    url.searchParams.set('order-by', 'newest');

    const res = await fetch(url.toString());
    if (!res.ok) return [];

    const data: GuardianApiResponse = await res.json();
    if (data.response.status !== 'ok') return [];

    return data.response.results.map(r => ({
      id: `guardian-${r.id}`,
      title: r.webTitle,
      description: stripHtml(r.fields?.trailText ?? r.sectionName),
      url: r.webUrl,
      imageUrl: r.fields?.thumbnail,
      publishedAt: new Date(r.webPublicationDate),
      source: 'The Guardian',
      sourceKey: 'guardian' as SourceKey,
      author: r.fields?.byline,
    }));
  } catch {
    return [];
  }
}

async function fetchRssFeed(feed: RssFeed): Promise<NewsArticle[]> {
  try {
    const url = `${RSS2JSON_BASE}?rss_url=${encodeURIComponent(feed.url)}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data: Rss2JsonResponse = await res.json();
    if (data.status !== 'ok') return [];

    return data.items
      .filter(item => {
        const pubDate = new Date(item.pubDate);
        if (!isWithinHours(pubDate, 24)) return false;
        if (feed.filterKeywords) {
          const text = (item.title + ' ' + item.description).toLowerCase();
          return feed.filterKeywords.some(kw => text.includes(kw));
        }
        return true;
      })
      .map(item => {
        const imageUrl =
          item.thumbnail ||
          item.enclosure?.link ||
          extractFirstImage(item.description);

        return {
          id: `${feed.sourceKey}-${btoa(item.link).slice(0, 16)}`,
          title: stripHtml(item.title),
          description: stripHtml(item.description).slice(0, 200) + '…',
          url: item.link,
          imageUrl: imageUrl && imageUrl.startsWith('http') ? imageUrl : undefined,
          publishedAt: new Date(item.pubDate),
          source: feed.source,
          sourceKey: feed.sourceKey,
          author: item.author || undefined,
        };
      });
  } catch {
    return [];
  }
}

const LCD_BASE = 'https://www.leisureandculturedundee.com';
const LCD_PROXY = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(LCD_BASE + '/news')}`;

async function fetchLeisureCulture(): Promise<NewsArticle[]> {
  try {
    const res = await fetch(LCD_PROXY);
    if (!res.ok) return [];

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const now = new Date();
    const articles: NewsArticle[] = [];

    doc.querySelectorAll('.views-field-title').forEach((titleEl, idx) => {
      const link = titleEl.querySelector('a');
      if (!link) return;

      const title = link.textContent?.trim();
      const href = link.getAttribute('href');
      if (!title || !href) return;

      const row = titleEl.closest('.views-row') ?? titleEl.parentElement;
      const descText = row?.querySelector('.views-field-body')?.textContent?.trim() ?? '';
      const description = descText.length > 200 ? descText.slice(0, 200) + '…' : descText;

      const rawSrc = row?.querySelector('img')?.getAttribute('src') ?? '';
      const imageUrl = rawSrc
        ? (rawSrc.startsWith('http') ? rawSrc : LCD_BASE + rawSrc)
        : undefined;

      articles.push({
        id: `lcdundee-${href.replace(/[^a-z0-9]/gi, '-').slice(0, 28)}`,
        title,
        description,
        url: href.startsWith('http') ? href : LCD_BASE + href,
        imageUrl,
        publishedAt: new Date(now.getTime() - idx * 90 * 60 * 1000), // stagger 90m apart
        source: 'L&C Dundee',
        sourceKey: 'lcdundee',
      });
    });

    return articles.slice(0, 15);
  } catch {
    return [];
  }
}

function extractFirstImage(html: string): string | undefined {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1];
}

function deduplicateArticles(articles: NewsArticle[]): NewsArticle[] {
  const seen = new Set<string>();
  return articles.filter(a => {
    const key = a.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Sports articles are deprioritised — they fill remaining slots only after
// local/general news has been picked. Patterns are checked against title only
// to avoid false positives (e.g. "Forfar Golf Club" in a road crash story).
const SPORTS_PATTERNS = [
  /\bfc\b/i,
  /\bpremiership\b/i,
  /scottish cup/i,
  /league cup/i,
  /champions league/i,
  /europa league/i,
  /\bhampden\b/i,
  /\btannadice\b/i,
  /dens park/i,
  /\bibrox\b/i,
  /\bparkhead\b/i,
  /\bfootball\b/i,
  /\brugby\b/i,
  /\bcricket\b/i,
  /\btennis\b/i,
  /\bboxing\b/i,
  /\bathletics\b/i,
  /\bcycling\b/i,
  /\bsnooker\b/i,
  /\bpromotion\b.*\bfc\b/i,
  /\brelegation\b/i,
  /\btransfer\b.*\bfc\b/i,
];

function isSportsArticle(article: NewsArticle): boolean {
  // Guardian URL path is the most reliable signal for that source
  if (article.sourceKey === 'guardian' && article.url.includes('/sport/')) return true;
  return SPORTS_PATTERNS.some(p => p.test(article.title));
}

/** Round-robin with source diversity cap, falls back to uncapped fill if short. */
function roundRobinPick(pool: NewsArticle[], total: number, maxPerSource: number): NewsArticle[] {
  const bySource = new Map<string, NewsArticle[]>();
  for (const article of pool) {
    if (!bySource.has(article.sourceKey)) bySource.set(article.sourceKey, []);
    bySource.get(article.sourceKey)!.push(article);
  }

  const groups = shuffleArray(
    Array.from(bySource.values()).map(g => shuffleArray(g))
  );

  const result: NewsArticle[] = [];

  for (let round = 0; round < maxPerSource && result.length < total; round++) {
    for (const group of groups) {
      if (result.length >= total) break;
      if (round < group.length) result.push(group[round]);
    }
  }

  if (result.length < total) {
    for (let round = maxPerSource; result.length < total; round++) {
      let added = false;
      for (const group of groups) {
        if (result.length >= total) break;
        if (round < group.length) { result.push(group[round]); added = true; }
      }
      if (!added) break;
    }
  }

  return result;
}

/**
 * Pick articles with source diversity, deprioritising sports content.
 * Non-sport articles fill slots first; sports only appear to top up remaining slots.
 */
export function pickArticles(pool: NewsArticle[], total = 5, maxPerSource = 2): NewsArticle[] {
  const nonSport = pool.filter(a => !isSportsArticle(a));
  const sport    = pool.filter(a =>  isSportsArticle(a));

  const primary = roundRobinPick(nonSport, total, maxPerSource);
  if (primary.length >= total) return primary;

  const pickedIds = new Set(primary.map(a => a.id));
  const sportFill = roundRobinPick(
    sport.filter(a => !pickedIds.has(a.id)),
    total - primary.length,
    maxPerSource,
  );

  return [...primary, ...sportFill];
}

export interface ArticlePool {
  articles: NewsArticle[];
  fetchedAt: Date;
}

/**
 * Fetches the full article pool: Guardian (7-day) + all RSS feeds (24h).
 * Guardian always uses a 7-day window so it contributes even on quiet news days.
 * Returns the deduplicated, date-sorted pool — caller decides what to display.
 */
export async function fetchArticlePool(): Promise<ArticlePool> {
  const [guardianArticles, lcDundeeArticles, ...rssResults] = await Promise.all([
    fetchGuardianArticles(),
    fetchLeisureCulture(),
    ...RSS_FEEDS.map(f => fetchRssFeed(f)),
  ]);

  const articles = deduplicateArticles([guardianArticles, lcDundeeArticles, ...rssResults].flat());
  articles.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  return { articles, fetchedAt: new Date() };
}
