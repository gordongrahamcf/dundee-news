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
      'dundee', 'tayside', 'angus', 'fife',
      'forfar', 'arbroath', 'montrose', 'carnoustie',
      'kirriemuir', 'brechin', 'broughty ferry',
      'perthshire', 'blairgowrie', 'pitlochry',
    ],
  },
  {
    url: 'https://news.stv.tv/feed',
    source: 'STV News',
    sourceKey: 'stv',
    filterKeywords: [
      'dundee', 'tayside', 'angus', 'fife',
      'forfar', 'arbroath', 'montrose', 'carnoustie',
      'kirriemuir', 'brechin', 'broughty ferry',
      'perthshire', 'blairgowrie', 'pitlochry', 'perth',
    ],
  },
];

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

async function fetchGuardianArticles(): Promise<NewsArticle[]> {
  try {
    const yesterday = (() => { const d = new Date(); d.setHours(d.getHours() - 24); return d.toISOString().split('T')[0]; })();
    const url = new URL('https://content.guardianapis.com/search');
    url.searchParams.set('q', 'Dundee');
    url.searchParams.set('api-key', GUARDIAN_API_KEY);
    url.searchParams.set('from-date', yesterday);
    url.searchParams.set('page-size', '20');
    url.searchParams.set('show-fields', 'thumbnail,trailText,byline');
    url.searchParams.set('order-by', 'newest');

    const res = await fetch(url.toString());
    if (!res.ok) return [];

    const data: GuardianApiResponse = await res.json();
    if (data.response.status !== 'ok') return [];

    return data.response.results
      .filter(r => isWithinHours(new Date(r.webPublicationDate), 24))
      .map(r => ({
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

async function fetchRssFeed(feed: RssFeed, maxAgeHours = 24): Promise<NewsArticle[]> {
  try {
    const url = `${RSS2JSON_BASE}?rss_url=${encodeURIComponent(feed.url)}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data: Rss2JsonResponse = await res.json();
    if (data.status !== 'ok') return [];

    return data.items
      .filter(item => {
        const pubDate = new Date(item.pubDate);
        if (!isWithinHours(pubDate, maxAgeHours)) return false;
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

/**
 * Round-robin pick across sources, hard-capped at maxPerSource per outlet.
 * Groups articles by source, shuffles within each group, then interleaves
 * one per source per round until `total` is reached or the cap is hit.
 */
function diversifyArticles(articles: NewsArticle[], total = 5, maxPerSource = 2): NewsArticle[] {
  const bySource = new Map<string, NewsArticle[]>();
  for (const article of articles) {
    if (!bySource.has(article.sourceKey)) bySource.set(article.sourceKey, []);
    bySource.get(article.sourceKey)!.push(article);
  }

  // Shuffle within each source group and randomise source order
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
  return result;
}

export const ACTIVE_SOURCES = ['The Guardian', ...RSS_FEEDS.map(f => f.source)];

export async function fetchDundeeNews(): Promise<{
  articles: NewsArticle[];
  expandedWindow: boolean;
}> {
  const [guardianArticles, ...rssResults] = await Promise.all([
    fetchGuardianArticles(),
    ...RSS_FEEDS.map(f => fetchRssFeed(f)),
  ]);

  const allArticles = deduplicateArticles([guardianArticles, ...rssResults].flat());
  allArticles.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  // Diversity-cap first: if one source dominates the 24h pool we still need to expand
  const primary = diversifyArticles(allArticles);
  if (primary.length >= 5) {
    return { articles: primary, expandedWindow: false };
  }

  // Not enough diverse articles in 24h — expand all sources to 7 days
  const expanded = await fetchExpanded();
  const combined = deduplicateArticles([...allArticles, ...expanded]);
  combined.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  return {
    articles: diversifyArticles(combined, Math.min(5, combined.length)),
    expandedWindow: true,
  };
}

async function fetchExpanded(): Promise<NewsArticle[]> {
  const HOURS_7D = 7 * 24;

  // Guardian 7-day
  const guardianUrl = new URL('https://content.guardianapis.com/search');
  guardianUrl.searchParams.set('q', 'Dundee Scotland');
  guardianUrl.searchParams.set('api-key', GUARDIAN_API_KEY);
  guardianUrl.searchParams.set('from-date', (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  })());
  guardianUrl.searchParams.set('page-size', '20');
  guardianUrl.searchParams.set('show-fields', 'thumbnail,trailText,byline');
  guardianUrl.searchParams.set('order-by', 'newest');

  const [guardianRes, ...rssExpanded] = await Promise.all([
    fetch(guardianUrl.toString()).catch(() => null),
    ...RSS_FEEDS.map(f => fetchRssFeed(f, HOURS_7D)),
  ]);

  const guardianArticles: NewsArticle[] = [];
  if (guardianRes?.ok) {
    try {
      const data: GuardianApiResponse = await guardianRes.json();
      if (data.response.status === 'ok') {
        guardianArticles.push(...data.response.results.map(r => ({
          id: `guardian-expanded-${r.id}`,
          title: r.webTitle,
          description: stripHtml(r.fields?.trailText ?? r.sectionName),
          url: r.webUrl,
          imageUrl: r.fields?.thumbnail,
          publishedAt: new Date(r.webPublicationDate),
          source: 'The Guardian',
          sourceKey: 'guardian' as SourceKey,
          author: r.fields?.byline,
        })));
      }
    } catch { /* ignore */ }
  }

  return [...guardianArticles, ...rssExpanded.flat()];
}
