import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './index.module.css';

const lifecycle = [
  {n: '01', t: 'Code', d: 'Read, write, edit, move, and search files and directories.'},
  {n: '02', t: 'Version control', d: 'Full git lifecycle plus the complete GitHub PR and Actions/CI flow.'},
  {n: '03', t: 'Databases', d: 'Generic Postgres and MySQL, plus Supabase.'},
  {n: '04', t: 'Containers', d: 'Docker — build, run, inspect, compose. Docker Desktop or WSL-only.'},
  {n: '05', t: 'Infrastructure', d: 'Terraform — plan, apply, destroy, state, plus a CI plan-comment hook.'},
  {n: '06', t: 'Secrets', d: 'A built-in local encrypted vault — no external service required.'},
  {n: '07', t: 'Monitoring', d: 'Sentry — list, search, and triage errors from the same chat.'},
  {n: '08', t: 'Docs & knowledge', d: 'Notion — pages, databases, blocks, comments.'},
  {n: '09', t: 'Communication', d: 'Slack and Gmail — read, search, send, reply.'},
  {n: '10', t: 'Deployment', d: 'Vercel — deploy, verify, roll back, check health.'},
];

const logLines = [
  {tool: 'ship_change', risk: 'MEDIUM', extra: '', status: 'ok 842ms'},
  {tool: 'run_tests', risk: 'READ', extra: '', status: 'ok 1204ms'},
  {tool: 'docker_build', risk: 'HIGH', extra: 'confirm:true', status: 'ok'},
  {tool: 'terraform_apply', risk: 'DESTRUCTIVE', extra: 'confirm:true', status: ''},
  {tool: 'deploy_project', risk: 'HIGH', extra: 'confirm:true', status: 'ok'},
  {tool: 'http_check', risk: 'READ', extra: '', status: '200 healthy'},
  {tool: 'sentry_list_issues', risk: 'READ', extra: '', status: '0 open'},
];

function Hero() {
  return (
    <header className={styles.hero}>
      <div className={styles.heroInner}>
        <div>
          <div className={styles.eyebrow}>MCP server for Claude</div>
          <Heading as="h1" className={styles.h1}>
            One conversation. Your whole stack.
          </Heading>
          <p className={styles.lead}>
            Causly Server gives Claude 181 tools to build, deploy, containerize, and manage
            a real product end to end — code, databases, infrastructure, monitoring, all of
            it — running locally on your own machine.
          </p>
          <div className={styles.ctaRow}>
            <Link className={styles.btnPrimary} to="https://github.com/KNIHAL/causly-server">
              View on GitHub
            </Link>
            <Link className={styles.btnSecondary} to="/docs/architecture">
              Read the docs
            </Link>
          </div>
        </div>

        <div className={styles.logPanel}>
          <div className={styles.logPanelHead}>
            <span className={styles.logDot} style={{background: '#E5484D'}} />
            <span className={styles.logDot} style={{background: '#F5A623'}} />
            <span className={styles.logDot} style={{background: '#3FB8AF'}} />
            <span className={styles.logLabel}>logs/activity.log</span>
          </div>
          <div className={styles.logBody}>
            {logLines.map((l, i) => (
              <div className={styles.logLine} key={l.tool} style={{animationDelay: `${0.1 + i * 0.25}s`}}>
                <span>$</span>
                <span className={styles.logTool}>{l.tool}</span>
                <span className={styles[`risk${l.risk[0]}${l.risk.slice(1).toLowerCase()}`]}>{l.risk}</span>
                {l.extra && <span>{l.extra}</span>}
                {l.status && <span className={styles.logOk}>{l.status}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}

function Lifecycle() {
  return (
    <section className={styles.section}>
      <div className={styles.sectionInner}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTag}>// the product lifecycle</div>
          <h2 className={styles.h2}>Every stage of shipping something real, in one place</h2>
          <p className={styles.desc}>
            Not a pile of generic integrations — a set of tools that follows the shape of an
            actual project, from an empty repo to something live and monitored.
          </p>
        </div>
      </div>
      <div className={styles.lifecycleGrid}>
        {lifecycle.map((item) => (
          <div className={styles.lifeItem} key={item.n}>
            <span className={styles.lifeNum}>{item.n}</span>
            <div className={styles.lifeTitle}>{item.t}</div>
            <div className={styles.lifeDesc}>{item.d}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Security() {
  return (
    <section className={styles.section}>
      <div className={styles.sectionInner}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTag}>// safety model</div>
          <h2 className={styles.h2}>It can genuinely change your systems — so every call is classified first</h2>
          <p className={styles.desc}>
            Risky actions don't run silently. Every tool carries a permission level, and the
            ones that matter wait for your explicit confirmation.
          </p>
        </div>

        <div className={styles.chips}>
          <span className={`${styles.chip} ${styles.chipRead}`}>READ</span>
          <span className={`${styles.chip} ${styles.chipLow}`}>LOW</span>
          <span className={`${styles.chip} ${styles.chipMedium}`}>MEDIUM</span>
          <span className={`${styles.chip} ${styles.chipHigh}`}>HIGH — needs confirm:true</span>
          <span className={`${styles.chip} ${styles.chipDestructive}`}>DESTRUCTIVE — needs confirm:true</span>
        </div>

        <div className={styles.securityList}>
          <div className={styles.securityItem}>
            <span className={styles.mark}>→</span>
            <div><h4>Secret redaction</h4><p>Tokens, passwords, and keys are stripped before anything touches a log line.</p></div>
          </div>
          <div className={styles.securityItem}>
            <span className={styles.mark}>→</span>
            <div><h4>Command risk scanning</h4><p>Force-push, DROP TABLE, curl-pipe-bash, sudo — flagged and surfaced, not silently allowed.</p></div>
          </div>
          <div className={styles.securityItem}>
            <span className={styles.mark}>→</span>
            <div><h4>Path protection</h4><p>Writes and deletes inside protected system directories are blocked outright.</p></div>
          </div>
          <div className={styles.securityItem}>
            <span className={styles.mark}>→</span>
            <div><h4>Structured audit log</h4><p>Every call appended to logs/activity.log — one JSON line: risk, status, duration.</p></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Compare() {
  return (
    <section className={styles.section}>
      <div className={styles.sectionInner}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTag}>// vs. zapier / composio-style platforms</div>
          <h2 className={styles.h2}>The workflow is already built — and it never leaves your machine</h2>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.compareTable}>
            <tbody>
              <tr><th></th><th>Causly Server</th><th>Zapier / Composio-style</th></tr>
              <tr><td>Setup</td><td className={styles.causly}>Fill in a token — the workflow already exists</td><td className={styles.other}>You wire up the automation yourself, every time</td></tr>
              <tr><td>Your data</td><td className={styles.causly}>Local-first, never leaves your machine</td><td className={styles.other}>Cloud-hosted, passes through their servers</td></tr>
              <tr><td>Depth</td><td className={styles.causly}>Product-lifecycle-aware, expert-tuned tools</td><td className={styles.other}>Generic, one-action-at-a-time integrations</td></tr>
              <tr><td>Limits</td><td className={styles.causly}>None — free and open-source (MIT)</td><td className={styles.other}>Usage tiers, task limits, seat pricing</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Install() {
  return (
    <section className={styles.section}>
      <div className={styles.sectionInner}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTag}>// get started</div>
          <h2 className={styles.h2}>Running in under five minutes</h2>
          <p className={styles.desc}>
            Node.js 18+ and Claude Desktop (or any MCP client). Everything else is optional,
            only needed for the tools you use.
          </p>
        </div>
        <div className={styles.installBlock}>
          <div><span className={styles.prompt}>$</span> git clone https://github.com/KNIHAL/causly-server</div>
          <div><span className={styles.prompt}>$</span> cd causly-server && npm install</div>
          <div><span className={styles.prompt}>$</span> cp .env.example .env</div>
          <div><span className={styles.prompt}>$</span> npm run setup</div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <Layout
      title="Causly Server — Turn Claude into a full-stack product builder"
      description="An MCP server that gives Claude 181 tools to build, deploy, containerize, and manage a real product end to end — running locally on your machine.">
      <Hero />
      <Lifecycle />
      <Security />
      <Compare />
      <Install />
    </Layout>
  );
}
