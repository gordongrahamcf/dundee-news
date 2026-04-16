export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  publishedAt: Date;
  source: string;
  sourceKey: SourceKey;
  author?: string;
}

export type SourceKey = 'guardian' | 'bbc' | 'courier' | 'stv';

export interface SourceConfig {
  key: SourceKey;
  label: string;
  color: string;
  emoji: string;
}

export interface GuardianApiResponse {
  response: {
    status: string;
    results: GuardianResult[];
  };
}

export interface GuardianResult {
  id: string;
  webTitle: string;
  webUrl: string;
  webPublicationDate: string;
  sectionName: string;
  fields?: {
    thumbnail?: string;
    trailText?: string;
    byline?: string;
  };
}

export interface Rss2JsonResponse {
  status: string;
  feed: {
    title: string;
    link: string;
  };
  items: Rss2JsonItem[];
}

export interface Rss2JsonItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  thumbnail?: string;
  author?: string;
  enclosure?: {
    link?: string;
  };
}
