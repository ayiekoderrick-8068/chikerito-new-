import { Link } from "react-router-dom";

const milestones = [
  { emoji: "💒", name: "Wedding", photo: "/images/landing/wedding.jpg" },
  { emoji: "🎓", name: "Graduation", photo: "/images/landing/graduation.jpg" },
  { emoji: "🏡", name: "First Home", photo: "/images/landing/home.webp" },
  { emoji: "❤️", name: "Medical Support", photo: "/images/landing/medical.jpg" },
  { emoji: "👶", name: "Baby Shower", photo: "/images/landing/baby_shower.jpg" },
  { emoji: "💼", name: "Business Startup", photo: "/images/landing/business.jpg" },
  { emoji: "✈️", name: "Travel", photo: "/images/landing/travel.jpg" },
  { emoji: "🎂", name: "Birthday", photo: "/images/landing/birthday.jpg" },
  { emoji: "⛪", name: "Church Events", photo: "/images/landing/church.webp" },
  { emoji: "🌍", name: "Community Projects", photo: "/images/landing/community.jpg" },
  { emoji: "🏆", name: "Sports Teams", photo: "/images/landing/sports.jpg" },
  { emoji: "➕", name: "Custom Milestone", photo: "/images/landing/custom.jpg" },
];

const features = [
  { icon: "🤖", title: "AI Builder", desc: "Automatically generates your theme, budget, story, timeline, and landing page." },
  { icon: "💰", title: "Expense Tracker", desc: "Track contributions, expenses, receipts, and vendor payments — all in real time." },
  { icon: "📊", title: "Budget Planner", desc: "Create funding categories and watch progress update automatically." },
  { icon: "🌍", title: "Community Hub", desc: "Supporters can comment, upload photos, and follow your journey." },
  { icon: "📈", title: "Analytics", desc: "See visitors, conversion rate, top traffic sources, and average contribution." },
  { icon: "📱", title: "Mobile Friendly", desc: "A beautiful experience for organizers and supporters on any device." },
];

const steps = [
  { title: "Create Your Life Space", desc: "Choose your milestone and let AI build a personalized workspace with the right tools." },
  { title: "Customize Your Space", desc: "Pick a premium theme, add your story, set your goal, and build your budget." },
  { title: "Share & Receive Support", desc: "Invite friends and family via WhatsApp, social media, email, or QR code." },
  { title: "Manage Everything in One Place", desc: "Track contributions, expenses, budget, and messages from your Mission Control dashboard." },
  { title: "Celebrate & Preserve the Journey", desc: "Download reports, save memories, and keep your milestone as a lasting keepsake." },
];

const faqs = [
  { q: "What is Chikerito?", a: "Chikerito is an all-in-one platform that helps you plan, fund, manage, and celebrate life's biggest milestones — from weddings and graduations to medical fundraisers and business launches." },
  { q: "Do I need fundraising to use Chikerito?", a: "No. You can use Chikerito simply to plan an event, track your budget, organize guests, or share updates. Fundraising is optional." },
  { q: "Can I track how contributions are used?", a: "Yes. The Expense Tracker records expenses, stores receipts, monitors your budget, and shows remaining balances — you control what supporters can see." },
  { q: "Can supporters see my expenses?", a: "Only if you choose. Privacy modes include Private, Progress Only, and Transparent." },
  { q: "Is my financial information secure?", a: "Yes. Chikerito uses secure payment providers, encrypted connections, and role-based permissions." },
  { q: "What happens after my milestone is complete?", a: "Your Life Space stays available as a digital keepsake — revisit updates, photos, reports, and messages any time." },
];

export default function Landing() {
  return (
    <div>
      <header className="nav">
        <div className="nav-inner">
          <div className="brand">
            Chikerito<span className="dot">.</span>
          </div>
          <nav className="nav-links">
            <a href="#templates">Templates</a>
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
            <Link to="/login">Sign In</Link>
            <Link to="/register" className="btn btn-primary btn-sm">Get Started</Link>
          </nav>
        </div>
      </header>

      <section className="hero" style={{ backgroundImage: "url(/images/landing/hero.jpg)" }}>
        <div className="hero-scrim" />
        <h1>
          The Operating System for <span className="accent">Life's Biggest Moments</span>
        </h1>
        <p className="sub">
          Plan, fund, manage, connect, and celebrate every milestone in one beautiful platform —
          from weddings and graduations to medical fundraisers and business launches.
        </p>
        <div className="hero-cta">
          <Link to="/register" className="btn btn-primary">Get Started</Link>
          <a href="#how-it-works" className="btn btn-outline">View Demo</a>
        </div>
      </section>

      <div className="stats-bar">
        <div className="stat"><div className="num">$2.4M+</div><div className="label">Total Raised</div></div>
        <div className="stat"><div className="num">18k+</div><div className="label">Active Users</div></div>
        <div className="stat"><div className="num">6,200+</div><div className="label">Life Spaces</div></div>
        <div className="stat"><div className="num">32</div><div className="label">Countries</div></div>
        <div className="stat"><div className="num">94%</div><div className="label">Success Rate</div></div>
      </div>

      <section className="section" id="templates">
        <div className="section-head">
          <div className="eyebrow">Templates</div>
          <h2>Choose Your Milestone</h2>
          <p>Every journey starts with a beautifully designed Life Space, tailored to your moment.</p>
        </div>
        <div className="container">
          <div className="grid grid-4">
            {milestones.map((m) => (
              <Link to="/register" className="milestone-card" key={m.name}>
                <div className="milestone-photo" style={{ backgroundImage: `url(${m.photo})` }}>
                  <span className="emoji">{m.emoji}</span>
                </div>
                <div className="name">{m.name}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="features" style={{ background: "#fff" }}>
        <div className="section-head">
          <div className="eyebrow">Features</div>
          <h2>Everything You Need, In One Place</h2>
          <p>Chikerito goes beyond fundraising — it's a complete milestone management platform.</p>
        </div>
        <div className="container">
          <div className="grid grid-3">
            {features.map((f) => (
              <div className="feature-card" key={f.title}>
                <div className="icon-badge">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="how-it-works">
        <div className="section-head">
          <div className="eyebrow">How It Works</div>
          <h2>Turn Life's Biggest Moments Into Shared Journeys</h2>
          <p>From planning to celebration, Chikerito guides you every step of the way.</p>
        </div>
        <div className="container" style={{ maxWidth: 720 }}>
          <div className="steps">
            {steps.map((s, i) => (
              <div className="step" key={s.title}>
                <div className="step-num">{i + 1}</div>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ background: "#fff" }}>
        <div className="section-head">
          <div className="eyebrow">Success Stories</div>
          <h2>Loved By Organizers Everywhere</h2>
        </div>
        <div className="container">
          <div className="grid grid-3">
            {[
              { name: "Clinton & Mary", quote: "We could finally see exactly where every gift went — down to the last flower vendor." },
              { name: "The Achieng Family", quote: "The expense tracker gave our donors real confidence. Transparency changed everything." },
              { name: "Kevin, Startup Founder", quote: "Chikerito felt like a finance dashboard and a fundraiser had a beautiful baby." },
            ].map((t) => (
              <div className="feature-card" key={t.name}>
                <p style={{ fontStyle: "italic", color: "#232733" }}>&ldquo;{t.quote}&rdquo;</p>
                <h3 style={{ marginTop: 16, fontSize: 15 }}>{t.name}</h3>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="section-head">
          <div className="eyebrow">Pricing</div>
          <h2>Simple, Transparent Plans</h2>
        </div>
        <div className="container">
          <div className="grid grid-3">
            <div className="pricing-card">
              <h3>Free</h3>
              <div className="price">$0</div>
              <ul>
                <li>1 Life Space</li>
                <li>Basic Expense Tracker</li>
                <li>Supporter View privacy mode</li>
                <li>Standard themes</li>
              </ul>
              <Link to="/register" className="btn btn-outline" style={{ width: "100%" }}>Get Started</Link>
            </div>
            <div className="pricing-card featured">
              <h3>Professional</h3>
              <div className="price">$19<span style={{ fontSize: 15, color: "#6b7280" }}>/mo</span></div>
              <ul>
                <li>Unlimited Life Spaces</li>
                <li>Full Finance Hub &amp; Receipt Vault</li>
                <li>Transparent donor mode</li>
                <li>Team collaboration</li>
                <li>Custom themes &amp; domain</li>
              </ul>
              <Link to="/register" className="btn btn-gold" style={{ width: "100%" }}>Get Started</Link>
            </div>
            <div className="pricing-card">
              <h3>Enterprise</h3>
              <div className="price">Custom</div>
              <ul>
                <li>Multi-organizer accounts</li>
                <li>Admin portal &amp; reporting</li>
                <li>Dedicated support</li>
                <li>API access</li>
              </ul>
              <a href="mailto:hello@chikerito.com" className="btn btn-outline" style={{ width: "100%" }}>Contact Us</a>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="faq" style={{ background: "#fff" }}>
        <div className="section-head">
          <div className="eyebrow">FAQ</div>
          <h2>Frequently Asked Questions</h2>
        </div>
        <div className="container" style={{ maxWidth: 760 }}>
          {faqs.map((f) => (
            <details className="faq-item" key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="section" style={{ textAlign: "center", paddingBottom: 100 }}>
        <h2 style={{ color: "#1b2a4a", fontSize: 32 }}>Dream → Plan → Fund → Manage → Celebrate → Remember</h2>
        <p style={{ color: "#6b7280", maxWidth: 560, margin: "12px auto 32px" }}>
          Your milestone becomes a lasting keepsake — not just a completed fundraiser.
        </p>
        <Link to="/register" className="btn btn-primary">Create Your Life Space</Link>
      </section>

      <footer className="footer">
        <div className="container">
          <div>
            <div className="brand" style={{ color: "#fff", marginBottom: 12 }}>
              Chikerito<span className="dot">.</span>
            </div>
            <p style={{ color: "#aab4cc", fontSize: 14, maxWidth: 280 }}>
              The Operating System for Life's Biggest Moments.
            </p>
          </div>
          <div>
            <h4>Learn More</h4>
            <a href="#templates">Templates</a>
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
          </div>
          <div>
            <h4>Company</h4>
            <a href="#faq">FAQ</a>
            <a href="#pricing">Pricing</a>
            <a href="mailto:hello@chikerito.com">Contact</a>
          </div>
          <div>
            <h4>Account</h4>
            <Link to="/login">Sign In</Link>
            <Link to="/register">Get Started</Link>
          </div>
        </div>
        <div className="footer-bottom">© 2026 Chikerito. All rights reserved.</div>
      </footer>
    </div>
  );
}
