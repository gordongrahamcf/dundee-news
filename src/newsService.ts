import type { NewsArticle, GuardianApiResponse, Rss2JsonResponse, SourceKey } from './types';

const GUARDIAN_API_KEY = 'test';
const RSS2JSON_BASE = 'https://api.rss2json.com/v1/api.json';

interface RssFeed {
  url: string;
  source: string;
  sourceKey: SourceKey;
  filterKeywords?: string[];
  parseSourceFromTitle?: boolean;
}

const RSS_FEEDS: RssFeed[] = [
  {
    // Dundee's main local paper
    url: 'https://www.thecourier.co.uk/feed/',
    source: 'The Courier',
    sourceKey: 'courier',
  },
  {
    // BBC's Tayside & Central Scotland feed — no keyword filter needed
    url: 'https://feeds.bbci.co.uk/news/scotland/tayside/rss.xml',
    source: 'BBC Scotland',
    sourceKey: 'bbc',
  },
  {
    // Google News aggregates multiple Scottish outlets for Dundee stories;
    // source name is parsed from each item's title suffix ("Headline - Source")
    url: 'https://news.google.com/rss/search?q=Dundee+Scotland&hl=en-GB&gl=GB&ceid=GB:en',
    source: 'Local News',
    sourceKey: 'dundeelive',
    parseSourceFromTitle: true,
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

function guessSourceKey(sourceName: string): SourceKey {
  const lower = sourceName.toLowerCase();
  if (lower.includes('guardian')) return 'guardian';
  if (lower.includes('bbc')) return 'bbc';
  if (lower.includes('courier')) return 'courier';
  return 'dundeelive';
}

function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
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

    const res = await fetchWithTimeout(url.toString());
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
    const res = await fetchWithTimeout(url);
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
        // Google News embeds "Headline - Source Name" in the title
        let title = stripHtml(item.title);
        let source = feed.source;
        let sourceKey = feed.sourceKey;

        if (feed.parseSourceFromTitle) {
          const lastDash = title.lastIndexOf(' - ');
          if (lastDash !== -1) {
            source = title.slice(lastDash + 3).trim();
            title = title.slice(0, lastDash).trim();
            sourceKey = guessSourceKey(source);
          }
        }

        const imageUrl =
          item.thumbnail ||
          item.enclosure?.link ||
          extractFirstImage(item.description);

        return {
          id: `${sourceKey}-${btoa(encodeURIComponent(item.link)).slice(0, 16)}`,
          title,
          description: stripHtml(item.description).slice(0, 200) + '…',
          url: item.link,
          imageUrl: imageUrl && imageUrl.startsWith('http') ? imageUrl : undefined,
          publishedAt: new Date(item.pubDate),
          source,
          sourceKey,
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

export async function fetchDundeeNews(): Promise<NewsArticle[]> {
  const [guardianArticles, ...rssResults] = await Promise.all([
    fetchGuardianArticles(),
    ...RSS_FEEDS.map(f => fetchRssFeed(f)),
  ]);

  const allArticles = deduplicateArticles([guardianArticles, ...rssResults].flat());
  allArticles.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  return shuffleArray(allArticles).slice(0, 5);
}
