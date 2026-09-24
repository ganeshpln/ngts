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

## Contact form (Formspree)
The contact form posts to [Formspree](https://formspree.io), which emails each
enquiry to you. To switch it on:

1. Sign up at formspree.io (free plan available) with admin@nextgentechnologys.com.
2. Create a new form. Formspree gives you an endpoint like
   `https://formspree.io/f/xyzabcde`.
3. In `build.py`, set `FORMSPREE_ID = "xyzabcde"` (the part after `/f/`).
4. Run `python3 build.py` and redeploy.

The form submits in the background and shows a success or error message on
the page. It includes a hidden `_gotcha` honeypot field for spam and a
`_subject` line for the notification email. The visitor's email is sent in the
`email` field, so replying to Formspree's notification replies to them.

## Deploying
Upload the contents of this folder to any static host (GitHub Pages, Netlify,
Vercel, Azure Static Web Apps, cPanel hosting, etc.). No build step is needed
on the server.
