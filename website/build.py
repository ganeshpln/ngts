#!/usr/bin/env python3
"""Generates the static NextGen Technology Solutions website.

Every page shares one header, footer and set of components defined here,
so edit content in this file and run `python3 build.py` to regenerate the
HTML files next to it.
"""
from pathlib import Path

OUT = Path(__file__).parent
SITE = "NextGen Technology Solutions"
PHONE = "+91 96770 10170"
PHONE_LINK = "+919677010170"
EMAIL = "admin@nextgentechnologys.com"
DOMAIN = "nextgentechnologysolutions.com"

# ---------------------------------------------------------------- icons ----
# Stroke icons (24x24 viewBox, currentColor).
ICONS = {
    "gear": '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    "bulb": '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
    "bolt": '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    "db": '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
    "users": '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    "arrow": '<path d="M5 12h14M13 5l7 7-7 7"/>',
    "menu": '<path d="M3 6h18M3 12h18M3 18h18"/>',
    "hand": '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
    "link": '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    "brain": '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>',
    "clipboard": '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    "robot": '<rect x="3" y="8" width="18" height="12" rx="3"/><path d="M12 8V4M8 4h8"/><circle cx="9" cy="14" r="1.5"/><circle cx="15" cy="14" r="1.5"/>',
    "badge": '<circle cx="12" cy="8" r="6"/><path d="M15.5 13 17 22l-5-3-5 3 1.5-9"/>',
    "shield": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    "chart": '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>',
    "handshake": '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3M3 4h8"/>',
    "cart": '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
    "bank": '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l10 6H2l10-6z"/>',
    "heart": '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    "bag": '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
    "truck": '<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    "briefcase": '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    "phone": '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    "mail": '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
    "globe": '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    "pin": '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    "check": '<path d="M20 6 9 17l-5-5"/>',
    "layers": '<path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    "cloud": '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
    "target": '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    "search": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
    "compass": '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"/>',
    "code": '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    "refresh": '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    "file": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
}


def icon(name):
    return (f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')


ARROW = icon("arrow")

# ------------------------------------------------------------- content ----
SERVICES = [
    {
        "slug": "rpa-automation", "num": "01", "name": "RPA & Automation", "short": "UiPath-led",
        "color": "gold", "icon": "gear",
        "title": "RPA & Automation Services",
        "intro": "Robotic process automation with UiPath: we find the right processes, build resilient bots and run them as a governed platform.",
        "glance": ["Process discovery & assessment", "Attended & unattended bots", "Document Understanding / OCR",
                   "Orchestrator & bot operations", "Automation CoE setup"],
        "do": ["Automation opportunity assessment & ROI modelling", "Process & task mining",
               "Bot development in UiPath Studio / StudioX", "Document Understanding & intelligent OCR",
               "Orchestrator setup, queues, scheduling & monitoring", "Automation Centre of Excellence (CoE) enablement"],
        "get": ["A prioritised automation roadmap", "Production bots with exception handling & audit trails",
                "24/7 bot operations with SLA monitoring", "Reusable components and standards",
                "Hours returned to your teams every month"],
        "uses": [("file", "Invoice processing & AP automation"), ("users", "Employee onboarding & HR ops"),
                 ("refresh", "Reconciliations & reporting"), ("cart", "Order entry & customer service back office")],
        "tools": ["UiPath Studio", "UiPath Orchestrator", "Document Understanding", "Automation Cloud",
                  "UiPath Agents", "Power Automate Desktop"],
    },
    {
        "slug": "agentic-ai", "num": "02", "name": "Agentic AI", "short": "LLM-powered agents",
        "color": "teal", "icon": "bulb",
        "title": "Agentic AI Services",
        "intro": "AI agents that read, reason and act inside your business systems — with people approving what matters.",
        "glance": ["AI agents & copilots", "RAG knowledge assistants", "Document intelligence",
                   "Multi-agent workflows", "AI governance & guardrails"],
        "do": ["Design & build of task-specific AI agents and copilots", "Retrieval-augmented (RAG) knowledge assistants",
               "Document extraction, classification & summarisation",
               "Multi-agent workflows that coordinate bots, APIs and people",
               "Prompt engineering, evaluation & model selection", "Responsible AI: guardrails, monitoring & audit"],
        "get": ["Agents deployed in production, not just pilots", "Grounded answers from your own data",
                "Human-in-the-loop approvals where risk demands it", "Clear cost, accuracy and usage dashboards",
                "A repeatable framework for the next agent"],
        "uses": [("robot", "IT & customer support agents"), ("file", "Policy / contract knowledge assistants"),
                 ("chart", "Finance & procurement copilots"), ("mail", "Email triage & case routing")],
        "tools": ["Azure OpenAI", "OpenAI", "Anthropic Claude", "LangGraph / LangChain", "CrewAI",
                  "Copilot Studio", "UiPath Agents"],
    },
    {
        "slug": "power-platform", "num": "03", "name": "Power Platform", "short": "Microsoft low-code",
        "color": "blue", "icon": "bolt",
        "title": "Microsoft Power Platform",
        "intro": "Low-code apps, automated flows, analytics and conversational copilots — on the Microsoft 365 stack you already own.",
        "glance": ["Power Automate flows", "Power Apps (canvas & model-driven)", "Power BI dashboards",
                   "Copilot Studio agents", "Dataverse & governance"],
        "do": ["Power Automate cloud & desktop flows", "Power Apps — canvas and model-driven applications",
               "Power BI data models, DAX & executive dashboards", "Copilot Studio agents for Teams and web",
               "Dataverse design, security roles & environments", "Platform governance, ALM & CoE toolkit"],
        "get": ["Apps that replace spreadsheets and paper forms", "Approval and notification flows in days, not months",
                "One version of the truth in Power BI", "Copilots your staff can use inside Teams",
                "Governed, licensed and supportable solutions"],
        "uses": [("clipboard", "Approval & request workflows"), ("search", "Field & inspection apps"),
                 ("chart", "Operational KPI dashboards"), ("users", "HR / IT self-service copilots")],
        "tools": ["Power Automate", "Power Apps", "Power BI", "Copilot Studio", "Dataverse", "Microsoft 365",
                  "Dynamics 365"],
    },
    {
        "slug": "data-integration", "num": "04", "name": "Data & Custom Dev", "short": "Integration & apps",
        "color": "green", "icon": "db",
        "title": "Data, Integration & Custom Development",
        "intro": "The foundation under every bot and agent: clean data, connected systems and the custom applications in between.",
        "glance": ["API development & integration", "Data pipelines & ETL", "Azure / AWS cloud integration",
                   "Custom web apps & portals", "Legacy modernisation"],
        "do": ["REST API development & third-party integration", "Data pipelines, ETL and warehouse loading",
               "Azure & AWS cloud integration and hosting", "Custom web applications, portals & internal tools",
               "Legacy system modernisation", "Quality assurance, testing & DevOps"],
        "get": ["Systems that exchange data automatically", "Trustworthy, automation-ready data",
                "Scalable, secure custom applications", "Modern replacements for ageing systems",
                "One accountable partner for the full stack"],
        "uses": [("link", "ERP / CRM integration hubs"), ("db", "Reporting data marts"),
                 ("globe", "Customer & vendor portals"), ("clipboard", "Workflow & approval applications")],
        "tools": ["Python", ".NET", "Azure", "AWS", "SQL Server", "Dataverse", "REST / Webhooks"],
    },
]

CHALLENGES = [
    ("hand", "", "Manual, repetitive work",
     "Invoices, onboarding, reconciliations and reports still move by hand — slow, error-prone and impossible to scale without adding headcount.",
     "UiPath and Power Automate bots take over rule-based work, running 24/7 with full audit logs."),
    ("link", "icon--teal", "Disconnected systems",
     "ERP, CRM, email and spreadsheets each hold part of the truth. People become the integration layer, re-keying data between tools.",
     "API integrations, Power Platform connectors and data pipelines make systems talk to each other."),
    ("brain", "icon--blue", "AI that never scales",
     "Generative AI pilots impress in demos, then stall without governance, orchestration or a path to production.",
     "Production-grade AI agents with guardrails, human approvals and monitoring from day one."),
]

INDUSTRIES = [
    ("cart", "", "FMCG", "Automation for consumer goods operations — from order to cash through to plant floor reporting.",
     ["Order-to-cash", "Supplier onboarding", "Quality reporting", "Plant KPI dashboards", "R2P", "Consumer & Commercial"]),
    ("bank", "icon--teal", "Banking & Financial Services", "Accurate, auditable automation for highly regulated back-office processes.",
     ["KYC document processing", "Reconciliations", "Loan operations", "Compliance reporting"]),
    ("heart", "icon--green", "Healthcare", "Less admin, faster cycles and cleaner records across the patient and payer journey.",
     ["Claims processing", "Patient intake", "Revenue-cycle automation", "Records extraction"]),
    ("bag", "icon--blue", "Retail & E-commerce", "Keep orders, catalogues and customer conversations moving at peak volume.",
     ["Order management", "Returns", "Catalogue updates", "Customer-service agents"]),
    ("truck", "icon--violet", "Logistics", "Real-time visibility and fewer exceptions across shipments, carriers and invoices.",
     ["Shipment tracking", "Invoice matching", "Carrier integration", "Exception handling"]),
    ("briefcase", "", "Professional Services", "Give billable people their time back and put firm knowledge at their fingertips.",
     ["Timesheets", "Billing", "Proposal generation", "Knowledge assistants"]),
]

WHY = [
    ("clipboard", "", "Free automation assessment", "A prioritised roadmap with expected ROI before you commit to anything."),
    ("robot", "icon--teal", "Agents, not just bots", "RPA, Power Platform and LLM agents combined so processes run end to end."),
    ("badge", "icon--blue", "Certified platform expertise", "UiPath and Microsoft Power Platform specialists building to vendor best practice."),
    ("shield", "icon--green", "Governance built in", "Guardrails, audit trails and human approvals from day one — AI that is safe to scale."),
    ("chart", "icon--violet", "Measurable outcomes", "Every engagement ships with a dashboard: hours saved, accuracy, cost impact."),
    ("handshake", "", "Partner, not vendor", "Long-term Centre of Excellence support, not one-time fixes."),
]

STEPS = [
    ("Discover & Assess", "Free assessment of your processes, systems and automation potential, aligned to business goals.", "Roadmap & business case"),
    ("Design & Strategize", "Solution architecture choosing the right mix of RPA, Power Platform and AI agents per process.", "Solution design & plan"),
    ("Build & Integrate", "Agile sprints with weekly demos; bots, apps and agents built, tested and integrated with your systems.", "Production release"),
    ("Run & Optimize", "Managed support, monitoring and a continuous-improvement backlog so results keep compounding.", "Monthly value report"),
]

MODELS = [
    ("Automation Assessment", "Fixed scope · 0–1 week",
     ["Process discovery workshops", "Opportunity scoring & ROI model", "Platform recommendation", "Prioritised roadmap & business case"],
     "Organisations starting their automation or AI journey.", False),
    ("Project Delivery", "Fixed price or time & materials",
     ["Agile sprints with weekly demos", "Build, test, deploy & hypercare", "Documentation & knowledge transfer", "Change management support"],
     "A defined set of processes, apps or agents to deliver.", True),
    ("Managed Services / CoE", "Monthly subscription",
     ["Bot & agent monitoring, support and SLAs", "Continuous improvement backlog", "Dedicated automation squad", "Governance, licensing & reporting"],
     "Running and scaling a digital workforce long term.", False),
]

ROADMAP = [
    ("2026", "Reusable UiPath & Power Platform accelerators for the FMCG sector"),
    ("2027", "Production-grade multi-agent AI with built-in governance across industries"),
    ("2028", "Industry solution packs for manufacturing, BFSI and healthcare"),
    ("Beyond", "The trusted end-to-end partner for AI-powered operations"),
]

STACK = [
    ("layers", "", "Automation & Low-Code",
     ["UiPath Platform", "UiPath Orchestrator", "Document Understanding", "Power Automate", "Power Apps", "Copilot Studio"]),
    ("brain", "icon--teal", "Agentic AI",
     ["Azure OpenAI", "OpenAI", "Anthropic Claude", "LangGraph / LangChain", "CrewAI", "Semantic Kernel"]),
    ("cloud", "icon--blue", "Data & Cloud",
     ["Microsoft Azure", "AWS", "Power BI", "Python / .NET", "SQL Server / Dataverse", "REST APIs & Webhooks"]),
]

NAV = [
    ("index.html", "Home"),
    ("about.html", "About"),
    ("services.html", "Services"),
    ("industries.html", "Industries"),
    ("how-we-work.html", "How We Work"),
    ("technology.html", "Technology"),
]


# ------------------------------------------------------------ layout ----
def layout(file, title, description, body, nav_key=None):
    nav_key = nav_key or file
    active = ' class="active" aria-current="page"'
    links = "\n".join(
        f'        <a href="{href}"{active if href == nav_key else ""}>{label}</a>'
        for href, label in NAV
    )
    svc_links = "\n".join(f'            <li><a href="{s["slug"]}.html">{s["name"]}</a></li>' for s in SERVICES)
    page_title = SITE if file == "index.html" else f"{title} | {SITE}"
    return f"""<!DOCTYPE html>
<html lang="en" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{page_title}</title>
  <meta name="description" content="{description}">
  <meta name="theme-color" content="#0a1733">
  <meta property="og:title" content="{page_title}">
  <meta property="og:description" content="{description}">
  <meta property="og:type" content="website">
  <link rel="icon" type="image/png" href="assets/img/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
  <div class="topbar"></div>
  <header class="site-header">
    <div class="container nav">
      <a class="brand" href="index.html" aria-label="{SITE} home">
        <img src="assets/img/logo.png" alt="" width="42" height="42">
        <span><span class="brand-name">NextGen</span><span class="brand-sub">TECHNOLOGY SOLUTIONS</span></span>
      </a>
      <button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false" aria-controls="nav-links">{icon("menu")}</button>
      <nav class="nav-links" id="nav-links" aria-label="Main">
{links}
        <a class="btn btn--gold nav-cta" href="contact.html">Free Assessment</a>
      </nav>
    </div>
  </header>

  <main>
{body}
  </main>

  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-about">
          <a class="brand" href="index.html">
            <img src="assets/img/logo.png" alt="" width="42" height="42">
            <span><span class="brand-name">NextGen</span><span class="brand-sub">TECHNOLOGY SOLUTIONS</span></span>
          </a>
          <p>Intelligent automation, agentic AI and Microsoft Power Platform solutions for enterprises that want faster, leaner, smarter operations.</p>
          <p class="gold" style="font-weight:700">Automate. Orchestrate. Elevate.</p>
        </div>
        <div>
          <h4>Services</h4>
          <ul>
{svc_links}
          </ul>
        </div>
        <div>
          <h4>Company</h4>
          <ul>
            <li><a href="about.html">About us</a></li>
            <li><a href="industries.html">Industries</a></li>
            <li><a href="how-we-work.html">How we work</a></li>
            <li><a href="technology.html">Technology</a></li>
            <li><a href="contact.html">Contact</a></li>
          </ul>
        </div>
        <div>
          <h4>Get in touch</h4>
          <ul>
            <li><a href="tel:{PHONE_LINK}">{PHONE}</a></li>
            <li><a href="mailto:{EMAIL}">{EMAIL}</a></li>
            <li><a href="https://{DOMAIN}">{DOMAIN}</a></li>
            <li><span class="muted">Tamil Nadu, India</span></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <span>&copy; <span id="year">2026</span> {SITE}. All rights reserved.</span>
        <span>Automation · Agentic AI · Power Platform · Data &amp; Integration</span>
      </div>
    </div>
  </footer>
  <script src="assets/js/main.js"></script>
</body>
</html>
"""


# -------------------------------------------------------- components ----
def page_hero(eyebrow, heading, lead, label, crumb=None):
    crumbs = '<a href="index.html">Home</a><span>/</span>'
    if crumb:
        crumbs += f'<a href="{crumb[0]}">{crumb[1]}</a><span>/</span>'
    crumbs += label
    return f"""    <section class="page-hero">
      <div class="container">
        <div class="crumbs">{crumbs}</div>
        <div class="eyebrow">{eyebrow}</div>
        <h1>{heading}</h1>
        <p class="lead">{lead}</p>
      </div>
    </section>"""


def head(eyebrow, title, lead="", center=False):
    return f"""        <div class="section-head reveal{' center' if center else ''}">
          <div class="eyebrow">{eyebrow}</div>
          <h2>{title}</h2>
          {f'<p class="lead">{lead}</p>' if lead else ''}
        </div>"""


def lis(items, cls="ticks"):
    return f'<ul class="{cls}">' + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def service_cards():
    cards = []
    for s in SERVICES:
        cards.append(f"""          <article class="card svc svc--{s['color']} reveal">
            <div class="svc-head"><div class="icon">{icon(s['icon'])}</div><div><h3>{s['name']}</h3><small>{s['short']}</small></div></div>
            <div class="svc-body">
              {lis(s['glance'], 'dots')}
              <a class="link" href="{s['slug']}.html">Explore service {ARROW}</a>
            </div>
          </article>""")
    return '        <div class="grid grid-4">\n' + "\n".join(cards) + "\n        </div>"


def feature_cards(items, cols=3):
    cards = "\n".join(
        f"""          <article class="card reveal">
            <div class="icon {cls}">{icon(ic)}</div>
            <h3>{t}</h3>
            <p class="muted">{d}</p>
          </article>""" for ic, cls, t, d in items)
    return f'        <div class="grid grid-{cols}">\n{cards}\n        </div>'


def steps():
    out = []
    for i, (t, d, deliv) in enumerate(STEPS, 1):
        out.append(f"""          <div class="step reveal">
            <div class="step-num">{i}</div>
            <div class="card">
              <h3>{t}</h3>
              <p class="muted">{d}</p>
              <div class="deliverable"><span>Deliverable</span>{deliv}</div>
            </div>
          </div>""")
    return '        <div class="steps">\n' + "\n".join(out) + "\n        </div>"


def models():
    out = []
    for t, meta, items, best, featured in MODELS:
        out.append(f"""          <article class="card model{' model--featured' if featured else ''} reveal">
            <h3>{t}</h3>
            <span class="meta">{meta}</span>
            {lis(items)}
            <div class="bestfor"><strong>Best for:</strong> {best}</div>
          </article>""")
    return '        <div class="grid grid-3">\n' + "\n".join(out) + "\n        </div>"


def roadmap():
    items = "\n".join(f'          <div class="tl reveal"><strong>{y}</strong><p>{d}</p></div>' for y, d in ROADMAP)
    return f'        <div class="timeline">\n{items}\n        </div>'


def cta(title="Let's build your digital workforce.",
        text="Start with a free automation assessment: a personalised walkthrough of your processes, a shortlist of high-impact opportunities, indicative ROI and a clear roadmap — no obligation."):
    return f"""    <section class="section section--tight">
      <div class="container">
        <div class="cta reveal">
          <div>
            <h2>{title}</h2>
            <p>{text}</p>
          </div>
          <div class="btn-row">
            <a class="btn btn--gold" href="contact.html">Book free assessment {ARROW}</a>
            <a class="btn btn--ghost" href="tel:{PHONE_LINK}">{PHONE}</a>
          </div>
        </div>
      </div>
    </section>"""


def section(inner, alt=False, tight=False):
    cls = "section" + (" section--alt" if alt else "") + (" section--tight" if tight else "")
    return f'    <section class="{cls}">\n      <div class="container">\n{inner}\n      </div>\n    </section>'


# ------------------------------------------------------------- pages ----
def home():
    hero = f"""    <section class="hero">
      <div class="container hero-grid">
        <div class="reveal">
          <div class="eyebrow">Automation &amp; Agentic AI Consultancy</div>
          <h1>Your intelligent <span class="gold">digital workforce.</span></h1>
          <p class="tagline">Automate. Orchestrate. Elevate.</p>
          <p class="lead">Intelligent automation, agentic AI and Microsoft Power Platform solutions for enterprises that want faster, leaner, smarter operations.</p>
          <div class="btn-row">
            <a class="btn btn--gold" href="contact.html">Get a free assessment {ARROW}</a>
            <a class="btn btn--ghost" href="services.html">Explore services</a>
          </div>
          <div class="chips">
            <span class="chip">RPA &amp; UiPath</span><span class="chip">Agentic AI</span><span class="chip">Power Platform</span><span class="chip">Data &amp; Integration</span>
          </div>
        </div>
        <div class="orbit reveal" aria-hidden="true">
          <div class="orbit-ring"><span style="top:12%;left:14%"></span><span style="bottom:10%;right:20%"></span></div>
          <div class="orbit-ring orbit-ring--2"><span style="top:48%;left:-6px"></span><span style="top:-6px;right:40%"></span></div>
          <div class="orbit-core"><img src="assets/img/logo.png" alt=""></div>
          <div class="orbit-node orbit-node--gold">{icon('gear')}</div>
          <div class="orbit-node orbit-node--teal">{icon('bulb')}</div>
          <div class="orbit-node orbit-node--blue">{icon('bolt')}</div>
          <div class="orbit-node orbit-node--green">{icon('db')}</div>
          <div class="orbit-node orbit-node--violet">{icon('users')}</div>
        </div>
      </div>
    </section>"""

    facts = """        <div class="facts reveal">
          <div class="fact"><small>Headquarters</small><strong>Tamil Nadu, India</strong></div>
          <div class="fact"><small>Focus</small><strong>Automation &amp; Agentic AI</strong></div>
          <div class="fact"><small>Platforms</small><strong>UiPath · Microsoft · OpenAI · Claude</strong></div>
          <div class="fact"><small>Clients</small><strong>Mid-size to enterprise, global</strong></div>
        </div>"""

    challenges = "\n".join(
        f"""          <article class="card reveal">
            <div class="icon {cls}">{icon(ic)}</div>
            <h3>{t}</h3>
            <p class="muted">{d}</p>
            <p class="solve"><strong>How we solve it:</strong> {s}</p>
          </article>""" for ic, cls, t, d, s in CHALLENGES)

    inds = "\n".join(
        f"""          <a class="card reveal" href="industries.html">
            <div class="icon {cls}">{icon(ic)}</div>
            <h3>{t}</h3>
            <p class="muted">{", ".join(tags[:3])}.</p>
          </a>""" for ic, cls, t, d, tags in INDUSTRIES)

    body = "\n".join([
        hero,
        section(facts, tight=True),
        section(head("The challenge", "Why enterprises get stuck — and how we unblock them",
                     "Most operations teams face the same three problems. Each one has a clear, proven automation answer.")
                + '\n        <div class="grid grid-3">\n' + challenges + "\n        </div>", alt=True),
        section(head("What we do", "Our services at a glance",
                     "Four service lines that work together — from process discovery to a fully managed digital workforce.")
                + "\n" + service_cards()),
        section(head("How we work", "The NextGen Way",
                     "A structured yet flexible delivery model that keeps every engagement tied to measurable business value.", center=True)
                + "\n" + steps(), alt=True),
        section(head("Where we work", "Industries we serve",
                     "Automation and AI patterns adapted to the processes, systems and compliance needs of each sector.")
                + '\n        <div class="grid grid-3">\n' + inds + "\n        </div>"),
        section(head("Why NextGen", "What sets us apart", "Six commitments we make on every engagement.")
                + "\n" + feature_cards(WHY), alt=True),
        cta(),
    ])
    return layout("index.html", "Home",
                  "NextGen Technology Solutions builds intelligent digital workforces with UiPath RPA, agentic AI, Microsoft Power Platform and data integration.",
                  body)


def about():
    intro = f"""        <div class="split">
          <div class="reveal">
            <div class="eyebrow">Who we are</div>
            <h2>An automation and AI consultancy built for real operations.</h2>
            <p class="lead">We design, build and run digital workforces — software robots, low-code apps and AI agents — that take repetitive work off your teams and put intelligence into every process.</p>
            <p class="muted">Based in Tamil Nadu, India, we work with mid-size and enterprise clients around the world. Our specialists combine UiPath, Microsoft Power Platform and leading AI models so processes run end to end — with governance built in from day one.</p>
            <div class="btn-row" style="margin-top:28px">
              <a class="btn btn--gold" href="contact.html">Talk to us {ARROW}</a>
              <a class="btn btn--ghost" href="services.html">Our services</a>
            </div>
          </div>
          <div class="facts reveal" style="grid-template-columns:1fr 1fr">
            <div class="fact" style="border-bottom:1px solid var(--line)"><small>Headquarters</small><strong>Tamil Nadu, India</strong></div>
            <div class="fact" style="border-right:0;border-bottom:1px solid var(--line)"><small>Focus</small><strong>Automation &amp; Agentic AI</strong></div>
            <div class="fact"><small>Platforms</small><strong>UiPath · Microsoft · OpenAI · Claude</strong></div>
            <div class="fact" style="border-right:0"><small>Clients</small><strong>Mid-size to enterprise, global</strong></div>
          </div>
        </div>"""
    vmv = feature_cards([
        ("target", "", "Vision", "Every enterprise runs on a digital workforce that learns, adapts and scales with the business."),
        ("compass", "icon--teal", "Mission", "Make hyperautomation practical — measurable ROI in months, delivered with governance built in."),
        ("handshake", "icon--blue", "Values", "Transparency on outcomes, human-in-the-loop by design, and long-term partnership over one-off projects."),
    ]).replace('class="grid grid-3"', 'class="grid grid-3 vmv"')
    body = "\n".join([
        page_hero("About us", "About NextGen Technology Solutions",
                  "Your partner for intelligent automation, agentic AI and Microsoft Power Platform — from first assessment to a fully managed digital workforce.", "About"),
        section(intro),
        section(head("What drives us", "Vision, mission &amp; values", center=True) + "\n" + vmv, alt=True),
        section(head("Why NextGen", "What sets us apart", "Six commitments we make on every engagement.") + "\n" + feature_cards(WHY)),
        section(head("Roadmap", "Our journey ahead",
                     "We evolve with our clients — investing ahead of what tomorrow's digital workforce will need.") + "\n" + roadmap(), alt=True),
        cta(),
    ])
    return layout("about.html", "About Us",
                  "NextGen Technology Solutions is an automation and AI consultancy in Tamil Nadu, India, building digital workforces for enterprises worldwide.",
                  body)


def services():
    body = "\n".join([
        page_hero("Services", "Four service lines. One digital workforce.",
                  "From process discovery to a fully managed digital workforce — RPA, agentic AI, low-code and data services that work together.", "Services"),
        section(head("What we do", "Our services at a glance",
                     "Pick one service line or combine them — each is designed to plug into the others.") + "\n" + service_cards()),
        section(head("How we engage", "Flexible engagement models",
                     "Start small with an assessment, deliver a project, or hand us the whole automation programme.") + "\n" + models(), alt=True),
        section(head("How we work", "The NextGen Way",
                     "Every engagement follows four stages, each ending in a concrete deliverable.", center=True) + "\n" + steps()),
        cta(),
    ])
    return layout("services.html", "Services",
                  "RPA & UiPath automation, agentic AI, Microsoft Power Platform and data integration services from NextGen Technology Solutions.",
                  body)


def service_page(s):
    others = "\n".join(
        f"""          <a class="card reveal" href="{o['slug']}.html">
            <div class="icon{' icon--' + o['color'] if o['color'] != 'gold' else ''}">{icon(o['icon'])}</div>
            <h3>{o['name']}</h3>
            <p class="muted">{o['intro']}</p>
            <span class="link">Learn more {ARROW}</span>
          </a>""" for o in SERVICES if o is not s)
    uses = "\n".join(f'          <div class="usecase reveal">{icon(ic)}<span>{u}</span></div>' for ic, u in s["uses"])
    pills = "".join(f'<span class="pill">{t}</span>' for t in s["tools"])
    body = "\n".join([
        page_hero(f"Service line {s['num']}", s["title"], s["intro"], s["name"], crumb=("services.html", "Services")),
        section(f"""        <div class="split">
          <div class="panel reveal">
            <h3>What we do</h3>
            {lis(s['do'])}
          </div>
          <div class="panel reveal">
            <h3>What you get</h3>
            {lis(s['get'])}
          </div>
        </div>"""),
        section(f"""        <div class="split">
          <div class="reveal">
            <div class="eyebrow">Typical use cases</div>
            <h2>Where it pays off first</h2>
            <p class="lead">Proven starting points where {s['name']} delivers quick, measurable wins.</p>
          </div>
          <div class="usecases">
{uses}
          </div>
        </div>""", alt=True),
        section(f"""        <div class="reveal">
          <div class="eyebrow">Platforms &amp; tools</div>
          <h2>Built on platforms you can trust</h2>
          <div class="pills" style="margin-top:28px">{pills}</div>
        </div>"""),
        section(head("Explore more", "Other service lines") + '\n        <div class="grid grid-3">\n' + others + "\n        </div>", alt=True),
        cta(f"Ready to get started with {s['name']}?"),
    ])
    return layout(f"{s['slug']}.html", s["title"], s["intro"], body, nav_key="services.html")


def industries():
    cards = "\n".join(
        f"""          <article class="card ind reveal">
            <div class="icon {cls}">{icon(ic)}</div>
            <h3>{t}</h3>
            <p class="muted">{d}</p>
            <div class="tags">{"".join(f"<span>{x}</span>" for x in tags)}</div>
          </article>""" for ic, cls, t, d, tags in INDUSTRIES)
    body = "\n".join([
        page_hero("Where we work", "Industries we serve",
                  "Automation and AI patterns adapted to the processes, systems and compliance needs of each sector.", "Industries"),
        section('        <div class="grid grid-3">\n' + cards + "\n        </div>"),
        section(head("The challenge", "The same three blockers, in every sector",
                     "Whatever your industry, we see the same patterns — and apply the same proven answers.") + "\n" + feature_cards([
                        (ic, cls, t, d + f' <br><br><strong class="gold">How we solve it:</strong> {s}') for ic, cls, t, d, s in CHALLENGES]), alt=True),
        cta("Don't see your industry?", "Our automation and AI patterns travel well. Tell us about your processes and we'll show you where the quick wins are."),
    ])
    return layout("industries.html", "Industries",
                  "Automation and AI for FMCG, banking & financial services, healthcare, retail, logistics and professional services.",
                  body)


def how_we_work():
    body = "\n".join([
        page_hero("How we work", "The NextGen Way",
                  "A structured yet flexible delivery model that keeps every engagement tied to measurable business value.", "How We Work"),
        section(steps()),
        section(head("How we engage", "Flexible engagement models",
                     "Start small with an assessment, deliver a project, or hand us the whole automation programme.") + "\n" + models(), alt=True),
        section(head("Why NextGen", "Six commitments on every engagement") + "\n" + feature_cards(WHY)),
        cta(),
    ])
    return layout("how-we-work.html", "How We Work",
                  "Discover, design, build and run: how NextGen Technology Solutions delivers automation and AI, and the engagement models we offer.",
                  body)


def technology():
    cols = "\n".join(
        f"""          <article class="card stack reveal">
            <h3><span class="icon {cls}" style="margin:0">{icon(ic)}</span>{t}</h3>
            <div class="pills">{"".join(f'<span class="pill">{x}</span>' for x in items)}</div>
          </article>""" for ic, cls, t, items in STACK)
    by_service = "\n".join(
        f"""          <a class="card reveal" href="{s['slug']}.html">
            <h3>{s['name']}</h3>
            <div class="pills" style="margin-top:16px">{"".join(f'<span class="pill">{x}</span>' for x in s['tools'])}</div>
          </a>""" for s in SERVICES)
    body = "\n".join([
        page_hero("Technology", "Platforms we build on",
                  "Enterprise automation platforms, leading AI models and agent frameworks, and the cloud and data tools that hold everything together.", "Technology"),
        section('        <div class="grid grid-3">\n' + cols + "\n        </div>"),
        section(head("By service line", "The right tools for each job",
                     "We choose platforms per process — not the other way round.") + '\n        <div class="grid grid-2">\n' + by_service + "\n        </div>", alt=True),
        cta(),
    ])
    return layout("technology.html", "Technology",
                  "UiPath, Microsoft Power Platform, Azure OpenAI, OpenAI, Anthropic Claude, LangGraph, CrewAI, Azure, AWS and more.",
                  body)


def contact():
    options = "".join(f"<option>{o}</option>" for o in
                      ["Free automation assessment"] + [s["name"] for s in SERVICES] + ["Managed services / CoE", "Something else"])
    body = "\n".join([
        page_hero("Contact", "Let's build your digital workforce.",
                  "Start with a free automation assessment: a personalised walkthrough of your processes, a shortlist of high-impact opportunities, indicative ROI and a clear roadmap — no obligation.", "Contact"),
        section(f"""        <div class="contact-grid">
          <div class="reveal">
            <div class="panel">
              <div class="contact-item"><div class="icon">{icon('phone')}</div><div><small>Call us</small><a href="tel:{PHONE_LINK}">{PHONE}</a></div></div>
              <div class="contact-item"><div class="icon icon--teal">{icon('mail')}</div><div><small>Email</small><a href="mailto:{EMAIL}">{EMAIL}</a></div></div>
              <div class="contact-item"><div class="icon icon--blue">{icon('globe')}</div><div><small>Website</small><a href="https://{DOMAIN}">{DOMAIN}</a></div></div>
              <div class="contact-item" style="border-bottom:0;padding-bottom:0"><div class="icon icon--green">{icon('pin')}</div><div><small>Headquarters</small><strong>Tamil Nadu, India</strong></div></div>
            </div>
            <div class="panel" style="margin-top:24px">
              <h3>Your free assessment includes</h3>
              {lis(["A personalised walkthrough of your processes", "A shortlist of high-impact opportunities", "Indicative ROI for each opportunity", "A clear, prioritised roadmap — no obligation"])}
            </div>
          </div>
          <div class="panel reveal">
            <h3>Send us a message</h3>
            <form class="form" id="contact-form" novalidate>
              <div class="field"><label for="name">Full name *</label><input id="name" name="name" required autocomplete="name"></div>
              <div class="field"><label for="company">Company *</label><input id="company" name="company" required autocomplete="organization"></div>
              <div class="field"><label for="email">Work email *</label><input id="email" name="email" type="email" required autocomplete="email"></div>
              <div class="field"><label for="phone">Phone</label><input id="phone" name="phone" type="tel" autocomplete="tel"></div>
              <div class="field full"><label for="interest">I'm interested in</label><select id="interest" name="interest">{options}</select></div>
              <div class="field full"><label for="message">Tell us about your processes *</label><textarea id="message" name="message" required placeholder="Which processes take the most manual effort today? Which systems are involved?"></textarea></div>
              <div class="full btn-row" style="align-items:center"><button class="btn btn--gold" type="submit">Send enquiry {ARROW}</button></div>
              <p class="form-status full" id="form-status" role="status"></p>
              <p class="form-note full">We typically reply within one business day.</p>
            </form>
          </div>
        </div>"""),
    ])
    return layout("contact.html", "Contact",
                  "Book a free automation assessment with NextGen Technology Solutions. Call +91 96770 10170 or email admin@nextgentechnologys.com.",
                  body)


def main():
    pages = {
        "index.html": home(),
        "about.html": about(),
        "services.html": services(),
        "industries.html": industries(),
        "how-we-work.html": how_we_work(),
        "technology.html": technology(),
        "contact.html": contact(),
    }
    for s in SERVICES:
        pages[f"{s['slug']}.html"] = service_page(s)
    for name, html in pages.items():
        (OUT / name).write_text(html, encoding="utf-8")
        print("wrote", name)


if __name__ == "__main__":
    main()
