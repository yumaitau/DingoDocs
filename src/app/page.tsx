import { ArrowRight, FileCheck2, LockKeyhole, Server } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import dingoArtwork from "../../docs/assets/dingodocs-banner.png";
import dashboardScreenshot from "../../docs/screenshots/dashboard.png";
import engagementsScreenshot from "../../docs/screenshots/engagements.png";
import findingsScreenshot from "../../docs/screenshots/findings.png";
import reportsScreenshot from "../../docs/screenshots/reports.png";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Pentest engagement operations",
  description:
    "Run penetration testing engagements, evidence, findings, reporting, and remediation from one self-hosted workspace.",
};

const proofPoints = [
  {
    icon: FileCheck2,
    title: "Evidence-first",
    body: "Keep scope, evidence, findings, and approvals connected.",
  },
  {
    icon: Server,
    title: "Self-hosted",
    body: "Run it inside infrastructure and controls you already trust.",
  },
  {
    icon: LockKeyhole,
    title: "Private by default",
    body: "Telemetry stays off unless your team decides otherwise.",
  },
];

const workflow = [
  {
    title: "Shape the engagement",
    body: "Set scope, owners, dates, assets, and delivery expectations before testing begins.",
    image: engagementsScreenshot,
    alt: "DingoDocs engagement workspace showing scope and delivery status",
    className: styles.workflowWide,
  },
  {
    title: "Review what matters",
    body: "Move findings through evidence-backed review without losing context.",
    image: findingsScreenshot,
    alt: "DingoDocs finding workflow with severity and review state",
    className: styles.workflowCompact,
  },
  {
    title: "Deliver with confidence",
    body: "Publish consistent reports and preserve the decisions behind them.",
    image: reportsScreenshot,
    alt: "DingoDocs report workspace with review and publication controls",
    className: styles.workflowCompact,
  },
];

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <nav className={styles.nav} aria-label="Primary navigation">
          <Link className={styles.brand} href="/" aria-label="DingoDocs home">
            <Image
              src="/brand/dingodocs-logo-mark.png"
              alt=""
              width={32}
              height={32}
              className={styles.brandMark}
              priority
            />
            <span>DingoDocs</span>
          </Link>
          <div className={styles.navActions}>
            <Link className={styles.signIn} href="/sign-in">
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Pentest operations, self-hosted</p>
          <h1>Defensible pentests.</h1>
          <p className={styles.heroBody}>
            Scope work, preserve evidence, review findings, and deliver
            defensible reports from one secure workspace.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href="/sign-up">
              Start free
              <ArrowRight aria-hidden="true" size={18} strokeWidth={1.8} />
            </Link>
            <a className={styles.secondaryAction} href="#product">
              See the product
            </a>
          </div>
        </div>

        <div className={styles.heroVisual}>
          <div className={styles.sunWash} aria-hidden="true" />
          <Image
            className={styles.heroImage}
            src={dingoArtwork}
            alt="Dingo wearing sunglasses with evidence files against a red-earth Australian landscape"
            sizes="(max-width: 767px) 92vw, 46vw"
            preload
          />
        </div>
      </section>

      <section className={styles.proofStrip} aria-label="Product principles">
        {proofPoints.map(({ icon: Icon, title, body }) => (
          <article className={styles.proofItem} key={title}>
            <Icon aria-hidden="true" size={21} strokeWidth={1.7} />
            <div>
              <h2>{title}</h2>
              <p>{body}</p>
            </div>
          </article>
        ))}
      </section>

      <section className={styles.productSection} id="product">
        <div className={styles.sectionIntro}>
          <h2>One clear view of the work.</h2>
          <p>
            See delivery pressure early, keep reviewers aligned, and carry clean
            evidence into every report.
          </p>
        </div>
        <div className={styles.productFrame}>
          <Image
            className={styles.productImage}
            src={dashboardScreenshot}
            alt="DingoDocs dashboard showing engagements, review work, findings, and tasks"
            sizes="(max-width: 767px) 94vw, 86vw"
          />
        </div>
      </section>

      <section className={styles.workflowSection}>
        <div className={styles.sectionIntro}>
          <h2>From scope to signed-off report.</h2>
          <p>
            DingoDocs keeps the work legible across operators, reviewers,
            clients, and delivery leads.
          </p>
        </div>
        <div className={styles.workflowGrid}>
          {workflow.map((item) => (
            <article
              className={`${styles.workflowCard} ${item.className}`}
              key={item.title}
            >
              <div className={styles.workflowCopy}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
              <div className={styles.workflowImageWrap}>
                <Image
                  className={styles.workflowImage}
                  src={item.image}
                  alt={item.alt}
                  sizes="(max-width: 767px) 92vw, 56vw"
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.landSection}>
        <Image
          className={styles.landImage}
          src="/brand/red-earth-landscape.png"
          alt="Layered red-earth landscape under quiet late-afternoon light"
          fill
          sizes="(max-width: 767px) 100vw, 92vw"
        />
        <div className={styles.landScrim} aria-hidden="true" />
        <div className={styles.landCopy}>
          <h2>Your data stays on your ground.</h2>
          <p>
            Deploy DingoDocs to infrastructure you control, with open source
            code and no default telemetry.
          </p>
        </div>
      </section>

      <footer className={styles.footer}>
        <div>
          <span className={styles.footerBrand}>DingoDocs</span>
          <p>Defensible pentest delivery, from first scope to final report.</p>
        </div>
        <div className={styles.footerLinks}>
          <a href="https://github.com/jusso-dev/DingoDocs">Source code</a>
          <a href="https://github.com/jusso-dev/DingoDocs/blob/main/docs/deployment.md">
            Deployment guide
          </a>
        </div>
      </footer>
    </main>
  );
}
