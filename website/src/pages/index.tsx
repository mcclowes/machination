import type { ReactElement } from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import styles from './index.module.scss';

const paths = [
  { number: '01', title: 'Make your first move', body: 'Read the chart, send a hauler, and claim a foothold. Start in practice, where mistakes cost you nothing.', to: '/learn/first-ten-minutes', label: 'Learn to play' },
  { number: '02', title: 'Know what will happen', body: 'Work through shields and combat, then use the Time Machine to plan around arrivals and future production.', to: '/guides/plan-ahead', label: 'Plan ahead' },
  { number: '03', title: 'Change the rules', body: 'Find the specialist you just recruited. Check its abilities, promotion, and place in combat before committing it.', to: '/specialists', label: 'Meet the specialists' },
];

export default function Home(): ReactElement {
  const artwork = useBaseUrl('/img/asteroid-frontier.png');
  return <Layout title="How to play" description="Learn Machination, a slow strategy game of rival machine intelligences, mining, and human diplomacy.">
    <main>
      <section className={styles.hero} aria-labelledby="intro-title">
        <div className={styles.intro}>
          <p className={styles.eyebrow}>The Machination field manual</p>
          <h1 id="intro-title">Slow orbits.<br /><span>Cold decisions.</span></h1>
          <p className={styles.lede}>You are a machine intelligence in the asteroid belt. Build a mining concern, move your forces, and decide which promises to keep.</p>
          <p>Orders take time. Rivals keep moving while you’re away. Learn the controls before you stake your King on a plan.</p>
          <div className={styles.actions}>
            <Link className="button button--primary button--lg" to="/learn/first-ten-minutes">Your first 10 minutes</Link>
            <Link className={styles.referenceLink} to="/rules">Look up a rule →</Link>
          </div>
        </div>
        <div className={styles.artwork}>
          <img src={artwork} alt="Industrial mining installations scattered across an asteroid frontier" fetchPriority="high" width="1536" height="1024" />
          <p>Rival intelligences. Shared territory. Long memories.</p>
        </div>
      </section>
      <section className={styles.paths} aria-label="Ways to learn">
        {paths.map(path => <article key={path.number}>
          <span className={styles.number} aria-hidden="true">{path.number}</span>
          <h2>{path.title}</h2><p>{path.body}</p><Link to={path.to}>{path.label} →</Link>
        </article>)}
      </section>
      <section className={styles.briefing} aria-labelledby="before-joining">
        <div><p className={styles.eyebrow}>Before you join an operation</p><h2 id="before-joining">Talk to your neighbors.</h2></div>
        <div><p>A strong fleet helps. So does knowing who will cross your border while it’s away. In multiplayer, agreements are promises between people.</p><Link to="/guides/diplomacy">Diplomacy, gifts, and staying connected →</Link></div>
      </section>
    </main>
  </Layout>;
}
