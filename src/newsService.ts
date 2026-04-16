import type { NewsArticle, GuardianApiResponse, SourceKey } from './types';

const GUARDIAN_API_KEY = 'test';
const CORS_PROXY = 'https://api.allorigins.win/get?url=';

interface AllOriginsResponse {
  contents: string;
  status: { http_code: number };
}

interface RssFeed {
  url: string;
  source: string;
  sourceKey: SourceKey;
  filterKeywords?: string[];
  parseSourceFromTitle?: boolean;
}

const RSS_FEEDS: RssFeed[] = [
  {
    // Broad BBC Scotland feed — filter client-side for Dundee/Tayside mentions
    url: 'https://feeds.bbci.co.uk/news/scotland/rss.xml',
    source: 'BBC Scotland',
    sourceKey: 'bbc',
    filterKeywords: ['dundee', 'tayside', 'angus'],
  },
  {
    // Google News aggregates The Courier, STV, Herald, Evening Telegraph, etc.
    // Source name is parsed from each item's title suffix: "Headline - Source"
    url: 'https://news.google.com/rss/search?q=Dundee+Scotland&hl=en-GB&gl=GB&ceid=GB:en',
    source: 'Local News',
    sourceKey: 'dundeelive',
    parseSourceFromTitle: true,
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

function isWithin24Hours(date: Date): boolean {
  if (isNaN(date.getTime())) return false;
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

function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}

// Extract the URL from an RSS <link> element — DOMParser in XML mode
// sometimes puts the URL in a text node sibling rather than textContent.
function extractLinkUrl(item: Element): string {
  const linkEl = item.querySelector('link');
  if (!linkEl) return '';
  const direct = linkEl.textContent?.trim();
  if (direct) return direct;
  // Some parsers put it in the following text node
  const sibling = linkEl.nextSibling;
  if (sibling?.nodeType === Node.TEXT_NODE) {
    return sibling.textContent?.trim() ?? '';
  }
  return '';
}

async function fetchGuardianArticles(): Promise<NewsArticle[]> {
  try {
    // Use 3-day window so we always have results; isWithin24Hours filters display
    const from = new Date();
    from.setDate(from.getDate() - 3);
    const fromStr = from.toISOString().split('T')[0];

    const url = new URL('https://content.guardianapis.com/search');
    url.searchParams.set('q', 'Dundee');
    url.searchParams.set('api-key', GUARDIAN_API_KEY);
    url.searchParams.set('from-date', fromStr);
    url.searchParams.set('page-size', '20');
    url.searchParams.set('show-fields', 'thumbnail,trailText,byline');
    url.searchParams.set('order-by', 'newest');

    const res = await fetchWithTimeout(url.toString());
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
    const proxyUrl = `${CORS_PROXY}${encodeURIComponent(feed.url)}`;
    const res = await fetchWithTimeout(proxyUrl);
    if (!res.ok) return [];

    const data = await res.json() as AllOriginsResponse;
    if (data.status.http_code !== 200 || !data.contents) return [];

    const parser = new DOMParser();
    const doc = parser.parseFromString(data.contents, 'text/xml');

    // Bail if the feed itself returned an error document
    if (doc.querySelector('parsererror')) return [];

    const items = Array.from(doc.querySelectorAll('item'));

    return items
      .filter(item => {
        const pubDateStr = item.querySelector('pubDate')?.textContent ?? '';
        const pubDate = new Date(pubDateStr);
        if (!isWithin24Hours(pubDate)) return false;

        if (feed.filterKeywords) {
          const titleText = item.querySelector('title')?.textContent ?? '';
          const descText = item.querySelector('description')?.textContent ?? '';
          const text = (titleText + ' ' + descText).toLowerCase();
          return feed.filterKeywords.some(kw => text.includes(kw));
        }
        return true;
      })
      .map(item => {
        let title = stripHtml(item.querySelector('title')?.textContent ?? '');
        let source = feed.source;
        let sourceKey = feed.sourceKey;

        if (feed.parseSourceFromTitle) {
          // Google News format: "Headline - Source Name"
          // Prefer the explicit <source> element when present
          const sourceEl = item.querySelector('source');
          const extractedSource = sourceEl?.textContent?.trim();
          if (extractedSource) {
            source = extractedSource;
            sourceKey = guessSourceKey(source);
          }
          // Strip the trailing " - Source" from the title
          const lastDash = title.lastIndexOf(' - ');
          if (lastDash !== -1) title = title.slice(0, lastDash).trim();
        }

        const link = extractLinkUrl(item);
        const guid = item.querySelector('guid')?.textContent?.trim() ?? '';
        const url = link || guid;

        const descRaw = item.querySelector('description')?.textContent ?? '';
        const description = stripHtml(descRaw).slice(0, 200);

        const pubDateStr = item.querySelector('pubDate')?.textContent ?? '';

        const enclosureUrl = item.querySelector('enclosure')?.getAttribute('url');
        const mediaUrl = item.getElementsByTagNameNS('*', 'content')[0]?.getAttribute('url');
        const imageUrl = enclosureUrl || mediaUrl || extractFirstImage(descRaw) || undefined;

        return {
          id: `${sourceKey}-${btoa(encodeURIComponent(url || title)).slice(0, 16)}`,
          title,
          description: description ? description + '…' : '',
          url,
          imageUrl: imageUrl && imageUrl.startsWith('http') ? imageUrl : undefined,
          publishedAt: new Date(pubDateStr),
          source,
          sourceKey,
        };
      })
      .filter(a => a.title && a.url);
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

  // Prefer articles from the last 24h; fall back to all 3-day Guardian results
  const all = deduplicateArticles([guardianArticles, ...rssResults].flat());
  const recent = all.filter(a => isWithin24Hours(a.publishedAt));
  const pool = recent.length >= 3 ? recent : all;

  pool.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return shuffleArray(pool).slice(0, 5);
}
