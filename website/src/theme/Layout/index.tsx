import type { ComponentProps, ReactElement } from 'react';
import OriginalLayout from '@theme-original/Layout';
import { useLocation } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import glossary from '../../../glossary/glossary.json';

export default function Layout(props: ComponentProps<typeof OriginalLayout>): ReactElement {
  const { pathname } = useLocation();
  const glossaryPath = useBaseUrl('/glossary/');
  const { collectAnchor } = useBrokenLinks();
  if (pathname.replace(/\/$/, '') === glossaryPath.replace(/\/$/, '')) {
    // Glossary 3.4 renders these IDs without registering them with Docusaurus's build-time checker.
    for (const entry of glossary.terms) {
      const { term, id } = entry as { term: string; id?: string };
      collectAnchor(id ?? term.toLowerCase().replace(/\s+/g, '-'));
      collectAnchor(`letter-${term.charAt(0).toUpperCase()}`);
    }
  }
  return <OriginalLayout {...props} />;
}
