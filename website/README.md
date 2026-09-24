# NextGen Technology Solutions — Website

A multi-page static website built from the company profile & services deck.

## Pages
| Page | File |
|---|---|
| Home | `index.html` |
| About | `about.html` |
| Services overview | `services.html` |
| RPA & Automation | `rpa-automation.html` |
| Agentic AI | `agentic-ai.html` |
| Power Platform | `power-platform.html` |
| Data & Custom Dev | `data-integration.html` |
| Industries | `industries.html` |
| How We Work | `how-we-work.html` |
| Technology | `technology.html` |
| Contact | `contact.html` |

## Preview locally
Open `index.html` in a browser, or run a local server:

```bash
cd website
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Editing content
All pages share one header/footer and are generated from `build.py`.
Edit the text/content lists in `build.py`, then regenerate:

```bash
python3 build.py
```

Styles live in `assets/css/style.css`, behaviour in `assets/js/main.js`.

## Contact form
The site is fully static, so the contact form opens the visitor's email app
with the enquiry pre-filled to admin@nextgentechnologys.com. To receive form
submissions directly instead, point the form at a service such as Formspree,
Netlify Forms or your own backend.

## Deploying
Upload the contents of this folder to any static host (GitHub Pages, Netlify,
Vercel, Azure Static Web Apps, cPanel hosting, etc.). No build step is needed
on the server.
