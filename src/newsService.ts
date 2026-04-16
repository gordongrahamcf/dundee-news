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
    filterKeywords: ['dundee', 'tayside', 'angus', 'fife'],
  },
  {
    url: 'https://www.dundeelive.co.uk/news/feed/',
    source: 'Dundee Live',
    sourceKey: 'dundeelive',
  },
];

function getYesterdayDateString(): string {
  const d = new Date();
  d.setHours(d.getHours() - 24);
  return d.toISOString().split('T')[0];
}

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

function isWithin24Hours(date: Date): boolean {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - 24);
  return date >= cutoff;
}

async function fetchGuardianArticles(): Promise<NewsArticle[]> {
  try {
    const yesterday = getYesterdayDateString();
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
      .filter(r => isWithin24Hours(new Date(r.webPublicationDate)))
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

async function fetchRssFeed(feed: RssFeed): Promise<NewsArticle[]> {
  try {
    const url = `${RSS2JSON_BASE}?rss_url=${encodeURIComponent(feed.url)}&count=30`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data: Rss2JsonResponse = await res.json();
    if (data.status !== 'ok') return [];

    return data.items
      .filter(item => {
        const pubDate = new Date(item.pubDate);
        if (!isWithin24Hours(pubDate)) return false;
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

  if (allArticles.length >= 5) {
    return { articles: shuffleArray(allArticles).slice(0, 5), expandedWindow: false };
  }

  // Not enough in 24h — expand to 7 days by relaxing the date filter
  const expanded = await fetchExpanded();
  const combined = deduplicateArticles([...allArticles, ...expanded]);
  combined.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  return {
    articles: shuffleArray(combined).slice(0, Math.min(5, combined.length)),
    expandedWindow: true,
  };
}

async function fetchExpanded(): Promise<NewsArticle[]> {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateStr = sevenDaysAgo.toISOString().split('T')[0];

    const url = new URL('https://content.guardianapis.com/search');
    url.searchParams.set('q', 'Dundee Scotland');
    url.searchParams.set('api-key', GUARDIAN_API_KEY);
    url.searchParams.set('from-date', dateStr);
    url.searchParams.set('page-size', '20');
    url.searchParams.set('show-fields', 'thumbnail,trailText,byline');
    url.searchParams.set('order-by', 'newest');

    const res = await fetch(url.toString());
    if (!res.ok) return [];

    const data: GuardianApiResponse = await res.json();
    if (data.response.status !== 'ok') return [];

    return data.response.results.map(r => ({
      id: `guardian-expanded-${r.id}`,
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
