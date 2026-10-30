import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  playerGuide: [
    { type: 'category', label: 'Learn to play', collapsed: false, items: ['learn/first-ten-minutes', 'learn/practice'] },
    { type: 'category', label: 'During an operation', collapsed: false, items: ['guides/plan-ahead', 'guides/diplomacy', 'guides/kings-pulse'] },
    { type: 'category', label: 'Reference', collapsed: false, items: ['reference/rules', 'reference/specialists', 'reference/combat'] },
    { type: 'link', label: 'Glossary', href: '/glossary' },
  ],
};

export default sidebars;
