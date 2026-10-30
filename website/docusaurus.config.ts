import type { Config } from '@docusaurus/types';
import type { Options, ThemeConfig } from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Machination',
  tagline: 'Slow orbits. Cold decisions.',
  favicon: 'img/mark.svg',
  url: process.env.DOCUSAURUS_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000'),
  baseUrl: process.env.DOCUSAURUS_BASE_URL ?? '/',
  trailingSlash: true,
  organizationName: 'mcclowes',
  projectName: 'machination',
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: { hooks: { onBrokenMarkdownLinks: 'throw', onBrokenMarkdownImages: 'throw' } },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [
    ['docusaurus-plugin-glossary/preset', {
      docs: { routeBasePath: '/', sidebarPath: './sidebars.ts' },
      blog: false,
      glossary: { glossaryPath: 'glossary/glossary.json', routePath: '/glossary' },
      theme: { customCss: './src/css/custom.scss' },
    } satisfies Options & { glossary: { glossaryPath: string; routePath: string } }],
  ],
  plugins: ['docusaurus-plugin-sass'],
  themes: [
    ['@easyops-cn/docusaurus-search-local', {
      hashed: true, indexBlog: false, docsRouteBasePath: '/', highlightSearchTermsOnTargetPage: true,
    }],
  ],
  themeConfig: {
    colorMode: { defaultMode: 'dark', respectPrefersColorScheme: false },
    navbar: {
      title: 'Machination',
      logo: { alt: '', src: 'img/mark.svg' },
      items: [
        { to: '/learn/first-ten-minutes', label: 'Learn to play', position: 'left' },
        { to: '/rules', label: 'Rules', position: 'left' },
        { to: '/specialists', label: 'Specialists', position: 'left' },
        { to: '/glossary', label: 'Glossary', position: 'left' },
        { href: 'https://github.com/mcclowes/machination', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      links: [
        { title: 'Learn', items: [{ label: 'Your first 10 minutes', to: '/learn/first-ten-minutes' }, { label: 'Tactical practice', to: '/learn/practice' }] },
        { title: 'Keep close', items: [{ label: 'Rules', to: '/rules' }, { label: 'Specialist reference', to: '/specialists' }, { label: 'Glossary', to: '/glossary' }] },
        { title: 'Machination', items: [{ label: 'Source and playtest setup', href: 'https://github.com/mcclowes/machination' }, { label: 'Report a problem', href: 'https://github.com/mcclowes/machination/issues' }] },
      ],
      copyright: 'Slow orbits. Cold decisions. Built with Docusaurus.',
    },
    tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
  } satisfies ThemeConfig,
};

export default config;
