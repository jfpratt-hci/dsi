// Cloudflare Worker for dandystrength.com.
// The app: every path that is not a real file serves index.html and the app routes it (assets, single page application).
// Gym websites: one template (site/gs/template.html) for every gym, filled from Dandy data with site_public(key).
//   dandystrength.com/site/<key>     any gym by its slug or subdomain
//   <key>.dandystrength.com          a gym's subdomain (needs the wildcard DNS record and route)
//   the gym's own domain             gym_sites.custom_domain, set by the DSI team (Cloudflare for SaaS hostname)
// The Worker puts the gym's title, description, Google business details, brand colors and data into the page,
// so search engines read real content and the page draws without a second request. Data is cached 60 seconds.

const SB = 'https://fairfhgyrosjqualmhwu.supabase.co';
const KEY = 'sb_publishable_1qg2GRUgxGxVMhOaoGGGFw_lm0j_j4h';
const APP_HOST = /^(www\.)?(dandystrength\.com|dandy\.fit|dandystrengthindex\.com)$|\.workers\.dev$|^localhost$|^127\.0\.0\.1$/;
const TTL = 60;

const rpc = async (fn, args) => {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) return null;
  return r.json();
};

// Cache an RPC answer at the edge (the Cache API, since POST responses are not cached on their own).
async function cached(ctx, id, ttl, load) {
  const cache = caches.default, k = new Request(`https://site-cache.internal/${encodeURIComponent(id)}`);
  const hit = await cache.match(k);
  if (hit) return hit.json();
  const val = await load();
  ctx.waitUntil(cache.put(k, new Response(JSON.stringify(val), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` } })));
  return val;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// Same rules as brandCss() in site/gs/site.js.
function brandCss(brand) {
  const b = brand || {}, ok = (v) => typeof v === 'string' && /^#[0-9a-f]{3,8}$|^rgb|^color-mix/i.test(v.trim());
  const dark = { ...(b.bg ? { '--bg': b.bg, '--panel': `color-mix(in srgb, ${b.bg} 90%, #fff)`, '--panel2': `color-mix(in srgb, ${b.bg} 84%, #fff)`, '--line': `color-mix(in srgb, ${b.bg} 74%, #fff)` } : {}),
    ...(b.accent ? { '--accent': b.accent, '--cta': b.accent } : {}), ...(b.primary ? { '--brand-blue': b.primary } : {}), ...(b.vars || {}) };
  const light = { ...(b.primary ? { '--accent': b.primary, '--brand-blue': b.primary } : {}), ...(b.accent ? { '--cta': b.accent } : {}), ...(b.vars_light || {}) };
  const decl = (o) => Object.entries(o).filter(([k, v]) => /^--[a-z0-9-]+$/.test(k) && ok(String(v))).map(([k, v]) => `${k}:${v}`).join(';');
  const d = decl(dark), l = decl(light);
  return `:root{${d}}` + (l ? `@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){${l}}}:root[data-theme="light"]{${l}}` : '');
}

function headTags(D, url) {
  if (!D || !D.gym) return '<title>Gym website</title><meta name="robots" content="noindex, nofollow">';
  const g = D.gym, s = D.site || {}, seo = s.seo || {}, b = s.brand || {}, soc = s.social || {}, links = s.links || {};
  const name = b.name || g.name, title = seo.title || name;
  const desc = seo.description || (s.hero && s.hero.sub) || `${name}${g.city ? ' in ' + g.city : ''}.`;
  const canon = s.custom_domain ? `https://${s.custom_domain}/` : url.origin + url.pathname;
  const noindex = seo.noindex || D.preview;
  const [locality, region] = String(g.city || '').split(',').map((x) => x.trim());
  const ld = {
    '@context': 'https://schema.org', '@type': 'ExerciseGym', name, url: canon, description: desc,
    ...(g.phone ? { telephone: g.phone } : {}), ...(g.email ? { email: g.email } : {}),
    ...(g.address ? { address: { '@type': 'PostalAddress', streetAddress: g.address, ...(locality ? { addressLocality: locality } : {}), ...(region ? { addressRegion: region } : {}), ...(links.zip ? { postalCode: links.zip } : {}), addressCountry: 'US' } } : {}),
    sameAs: Object.values(soc).filter((u) => typeof u === 'string' && /^https:\/\//.test(u) && !/behold|feeds\./i.test(u)),
  };
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow'}">`,
    `<link rel="canonical" href="${esc(canon)}">`,
    `<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canon)}">`,
    `<meta name="theme-color" content="${esc((b.vars && b.vars['--bg']) || b.bg || '#0A1430')}">`,
    `<script type="application/ld+json">${safeJson(ld)}</script>`,
    (D.code && D.code.head) || '', // DSI team only (gym_site_code), trusted
  ].join('\n');
}

async function template(env, url) {
  let r = await env.ASSETS.fetch(new Request(new URL('/gs/template', url)));
  if (r.status >= 300 && r.status < 400 && r.headers.get('location')) r = await env.ASSETS.fetch(new Request(new URL(r.headers.get('location'), url)));
  return r.text();
}

async function serveSite(key, url, env, ctx) {
  const [D, html] = await Promise.all([cached(ctx, 'site:' + key, TTL, () => rpc('site_public', { p_key: key })), template(env, url)]);
  const page = html
    .replace('<title>Gym</title>', '')
    .replace('<!--SITE_HEAD-->', headTags(D, url))
    .replace('<!--SITE_BRAND-->', D && D.site ? `<style id="brandVars">${brandCss(D.site.brand).replace(/<\//g, '<\\/')}</style>` + (D.code && D.code.css ? `<style id="gymCss">${D.code.css.replace(/<\/style/gi, '<\\/style')}</style>` : '') : '')
    .replace('<!--SITE_DATA-->', `<script>window.__SITE_KEY__=${safeJson(key)};window.__SITE__=${safeJson(D || null)};</script>`);
  return new Response(page, { status: D ? 200 : 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': `public, max-age=${TTL}`, 'X-Robots-Tag': D && !(D.site && D.site.seo && D.site.seo.noindex) && !D.preview ? 'all' : 'noindex' } });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), host = url.hostname.toLowerCase();
    if (req.method === 'GET' || req.method === 'HEAD') {
      const m = url.pathname.match(/^\/site\/([a-z0-9][a-z0-9.-]{0,60})\/?$/i);
      if (m) return serveSite(m[1].toLowerCase(), url, env, ctx);
      if (!APP_HOST.test(host) && !/\.[a-z0-9]{2,5}$/i.test(url.pathname) && !url.pathname.startsWith('/gs/')) {
        const sub = host.match(/^([a-z0-9-]+)\.(dandystrength\.com|dandy\.fit)$/);
        const key = sub ? sub[1] : await cached(ctx, 'host:' + host, 300, () => rpc('site_key_for_host', { p_host: host }));
        if (key) return serveSite(String(key), url, env, ctx);
      }
    }
    return env.ASSETS.fetch(req);
  },
};
