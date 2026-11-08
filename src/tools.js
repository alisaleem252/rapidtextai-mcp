import { buildBody } from './seo-tools.js';
import { toMarkdown } from './report.js';

const SOURCE = {
  url: { type: 'string', description: 'Public page URL (http/https).' },
  html: { type: 'string', description: 'Raw HTML of the content (instead of a URL).' },
  text: { type: 'string', description: 'Plain text of the content (instead of a URL).' },
};
const MODEL = { type: 'string', description: 'Optional model id (see list_models). Omit to use the default.' };

/** Each tool: MCP name, description for the model, JSON schema, and how to run it. */
export const TOOLS = [
  {
    name: 'generate_article', units: 6, readOnly: false,
    description: 'Write a researched, SEO-ready article with live web research, FAQ and cited sources. Takes 1-3 minutes. Costs 6 request units. Returns the article in Markdown plus its title, meta description, tags and quality score.',
    inputSchema: {
      type: 'object', required: ['topic'],
      properties: {
        topic: { type: 'string', description: 'What the article is about.' },
        keyword: { type: 'string', description: 'Primary SEO keyword (defaults to the topic).' },
        word_count: { type: 'integer', minimum: 300, maximum: 4000, description: 'Target length.' },
        tone: { type: 'string' }, language: { type: 'string' }, audience: { type: 'string' },
        article_type: { type: 'string', enum: ['guide', 'how-to', 'listicle', 'comparison', 'review', 'pillar', 'news'] },
        outline_hint: { type: 'array', items: { type: 'string' }, maxItems: 12, description: 'H2 headings to use, in order (for example from competitor_gap).' },
        cta: { type: 'string', description: 'Call to action to finish with.' },
        brand_id: { type: 'integer', description: 'Id of a brand saved in the RapidTextAI account.' },
        research: { type: 'boolean', description: 'Use live web research (default true).' },
        include_faq: { type: 'boolean' }, include_sources: { type: 'boolean' }, model: MODEL,
      },
    },
    path: { article: true },
  },
  {
    name: 'competitor_gap', units: 5, readOnly: true, seo: 'competitor-gap',
    description: 'Read the top-ranking pages for a keyword and plan an outline that covers what readers expect plus what competitors miss. Returns the outline, target word count and gaps. Costs 5 request units.',
    inputSchema: { type: 'object', required: ['keyword'], properties: { keyword: { type: 'string', description: 'Target keyword.' }, model: MODEL } },
  },
  {
    name: 'content_refresh', units: 6, readOnly: true, seo: 'content-refresh',
    description: 'Find outdated statements in a published post and propose updated sentences with a cited source. Provide url or html. Costs 6 request units.',
    inputSchema: { type: 'object', properties: { url: SOURCE.url, html: SOURCE.html, model: MODEL } },
  },
  {
    name: 'fact_check', units: 6, readOnly: true, seo: 'fact-check',
    description: 'Extract up to 10 checkable claims from a page or text and verify each against live search evidence. Returns a 0-100 score and a verdict (supported, partly, contradicted, unverified) with a quoted source per claim. Provide url, html or text. Costs 6 request units.',
    inputSchema: { type: 'object', properties: { ...SOURCE, model: MODEL } },
  },
  {
    name: 'originality_check', units: 3, readOnly: true, seo: 'originality',
    description: 'Spot-check distinctive sentences as exact phrases and flag 8+ word overlaps with existing pages. Returns a 0-100 score and the matches. A spot check, not a plagiarism guarantee. Provide url, html or text. Costs 3 request units.',
    inputSchema: { type: 'object', properties: SOURCE },
  },
  {
    name: 'brand_from_url', units: 2, readOnly: true, seo: 'brand-from-url',
    description: 'Read a website and suggest a brand profile (voice, tone, audience, CTA, facts). Not saved anywhere. Costs 2 request units.',
    inputSchema: { type: 'object', required: ['url'], properties: { url: SOURCE.url, model: MODEL } },
  },
  {
    name: 'find_embeds', units: 1, readOnly: true, seo: 'embeds',
    description: 'Find verified tweets and YouTube/Vimeo videos to embed in an article, each tied to the heading it belongs after. Costs 1 request unit.',
    inputSchema: {
      type: 'object', required: ['headings'],
      properties: {
        topic: { type: 'string' }, keyword: { type: 'string' },
        headings: { type: 'array', items: { type: 'string' }, description: 'Article headings to place embeds after.' },
        tweets: { type: 'boolean' }, videos: { type: 'boolean' },
        tweet_count: { type: 'integer', minimum: 1, maximum: 2 }, video_count: { type: 'integer', minimum: 1, maximum: 2 },
      },
    },
  },
  {
    name: 'list_models', units: 0, readOnly: true, description: 'List the model ids available to this API key. Free.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'check_capabilities', units: 0, readOnly: true,
    description: 'Report which article and SEO features the RapidTextAI server has enabled (for example web search, images, videos). Free.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const ARTICLE_KEYS = ['topic', 'keyword', 'word_count', 'tone', 'language', 'audience', 'article_type', 'outline_hint', 'cta', 'brand_id', 'research', 'include_faq', 'include_sources', 'model'];

export function articleToText(a) {
  const head = [`# ${a.title}`, '', `*Meta description:* ${a.meta_description || ''}`, `*Words:* ${a.word_count ?? '?'} · *Quality score:* ${a.quality?.score ?? 'n/a'}${a.tags?.length ? ` · *Tags:* ${a.tags.join(', ')}` : ''}`, ''];
  const body = [a.body_markdown || ''];
  if (a.faq?.length) body.push('', '## FAQ', '', ...a.faq.flatMap((f) => [`### ${f.q}`, '', f.a, '']));
  if (a.sources?.length) body.push('', '## Sources', '', ...a.sources.map((s) => `- [${s.title || s.url}](${s.url})`));
  if (a.warnings?.length) body.push('', `_Warnings: ${a.warnings.map((w) => (typeof w === 'string' ? w : JSON.stringify(w))).join('; ')}_`);
  return [...head, ...body].join('\n');
}

/** Execute a tool call. Returns the text to show the model. Throws Error for bad input or API errors. */
export async function callTool(name, args, client, ctx = {}) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`Unknown tool: ${name}`);
  args = args || {};
  if (name === 'list_models') {
    const m = await client.models();
    const ids = (m.data || m.models || m || []).map((x) => (typeof x === 'string' ? x : x.id)).filter(Boolean);
    return ids.length ? ids.join('\n') : JSON.stringify(m, null, 2);
  }
  if (name === 'check_capabilities') {
    const [article, seo] = await Promise.allSettled([client.capabilities(), client.seoCapabilities()]);
    return JSON.stringify({ article: article.value ?? { error: article.reason?.message }, seo: seo.value ?? { error: seo.reason?.message } }, null, 2);
  }
  if (name === 'generate_article') {
    if (!String(args.topic || '').trim()) throw new Error('topic is required.');
    const params = {};
    for (const k of ARTICLE_KEYS) if (args[k] !== undefined && args[k] !== '') params[k] = args[k];
    return articleToText(await client.article(params, ctx));
  }
  // SEO tools: translate MCP argument names to the API shape and validate before spending units.
  if (t.seo === 'embeds' && args.tweets === undefined && args.videos === undefined) args = { ...args, tweets: true, videos: true };
  const body = buildBody(t.seo, args);
  return toMarkdown(t.seo, await client.seo(t.seo, body, ctx));
}
