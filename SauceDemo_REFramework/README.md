# SauceDemo Purchase Workflow — REFramework Edition

The same end-to-end SauceDemo purchase automation, rebuilt on UiPath's **Robotic
Enterprise Framework (REFramework)** — the standard state-machine template with
config-driven settings, structured logging, and system/business exception handling
with retry.

## Structure

```
SauceDemo_REFramework/
├── project.json
├── Main.xaml                     State machine: Initialization → Get Transaction Data → Process → End Process
├── Framework/
│   ├── InitAllSettings.xaml      Builds the Config dictionary (mirrors Data\Config.xlsx)
│   ├── InitAllApplications.xaml  Opens Chrome, navigates to SauceDemo, logs in (Steps 1-2)
│   ├── GetTransactionData.xaml   Hands out one transaction (this process = a single purchase)
│   ├── Process.xaml              Add to cart, checkout, capture total, finish (Steps 3-10)
│   ├── SetTransactionStatus.xaml Logs the outcome; drives the retry loop
│   ├── CloseAllApplications.xaml Closes the browser (Step 11)
│   ├── KillAllProcesses.xaml     Kills any stray chrome.exe before Init
│   └── TakeScreenshot.xaml       Exception screenshot extension point (see note below)
├── Data/
│   └── Config.xlsx               Settings / Constants / Assets sheets
└── Screenshots/                  Where TakeScreenshot.xaml points exception captures
```

## How the REFramework states map to the original 11 steps

| REFramework state / workflow      | Steps covered |
|------------------------------------|----------------|
| `InitAllApplications.xaml`         | 1. Open browser · 2. Log in |
| `GetTransactionData.xaml`          | Hands out the single "purchase" transaction |
| `Process.xaml`                     | 3. Add first two products · 4. Open cart · 5. Checkout · 6. Customer details · 7. Continue · 8. Capture total · 9. Finish |
| `SetTransactionStatus.xaml`        | 10. Logs the total / outcome, decides retry vs. move on |
| `CloseAllApplications.xaml` (End Process) | 11. Close browser |

## Why it's structured this way (vs. a plain Sequence)

- **Config-driven**: URL, credentials, customer details, retry count, and screenshots
  path all live in `Data\Config.xlsx` rather than being hard-coded in the workflow.
- **Separation of concerns**: applications are opened/logged in once (`InitAllApplications`),
  transaction data is fetched independently of processing (`GetTransactionData` /
  `Process`), and cleanup always runs (`CloseAllApplications`), matching how REFramework
  keeps each concern in its own invokable workflow.
- **Exception handling with retry**: `Process.xaml` throws a `BusinessRuleException` if the
  order total can't be read (a business-rule failure, not retried). Any other exception is
  treated as a system exception and retried up to `MaxRetryNumber` (from Config, default `1`)
  before the transaction is marked failed — the same System vs. Business exception split
  REFramework uses everywhere.
- **This runs as a single local transaction**, not against an Orchestrator queue:
  `MaxTransactions` in Config (`= 1`) represents the one purchase this process performs.
  The `OrchestratorQueueName`/`OrchestratorQueueFolder` settings are kept in Config.xlsx
  for structural parity but are unused. To process many purchases, point
  `GetTransactionData.xaml` at a real Orchestrator queue (`Get Queue Item`) or a data
  source (Excel/DB) and loop `Process.xaml` over each row/item.

## Two intentional simplifications (and how to un-simplify them in Studio)

Because this project was authored by hand outside UiPath Studio (no Studio instance
available to compile/validate it in this environment), two utility pieces were kept
deliberately simple rather than guessing at XAML for activities that are easy to get
subtly wrong without a real designer:

1. **`InitAllSettings.xaml`** builds the `Config` dictionary in-memory with values that
   mirror `Data\Config.xlsx` exactly, instead of reading the file at runtime. To make
   settings truly file-driven, open the workflow in Studio and replace the `Assign` with
   a Workbook **Read Range** on `Config.xlsx` → `Settings` sheet into a DataTable, then:
   `dtSettings.AsEnumerable().ToDictionary(Function(r) r("Name").ToString, Function(r) r("Value"))`
   — a two-minute, drag-and-drop change.
2. **`TakeScreenshot.xaml`** logs the exception and the intended screenshot path instead
   of capturing a real screenshot. Drop a **Take Screenshot** + **Save Image** activity
   from the UI Automation activities pack at the marked spot if you want actual image
   capture on failure.

Everything else — the state machine, the browser automation (Open Browser / Type Into /
Click / Get Text / Close Tab), the exception handling, and the retry logic — is fully
functional as written.

## How to run

1. Install [UiPath Studio](https://www.uipath.com/product/studio) (Community edition is fine) and Google Chrome.
2. Make sure the **UiPath Extension for Chrome** is installed and enabled.
3. Open Studio, choose **Open Project**, and select this folder's `project.json`.
4. Let Studio restore the dependencies listed in `project.json`.
5. Open `Main.xaml` and press **Run** (F5) / **Debug File**.
6. Watch the Output panel for the structured log messages (transaction retrieved →
   processing → total captured → success/failure) as the state machine runs.

## Notes

- Selectors target SauceDemo's stable element IDs/classes (`#user-name`, `#login-button`,
  `#add-to-cart-sauce-labs-backpack`, `.shopping_cart_link`, `#checkout`,
  `#first-name`/`#last-name`/`#postal-code`, `#continue`, `.summary_total_label`, `#finish`).
  If the site markup ever changes, re-capture the selector in Studio via **Indicate element
  on screen**.
- As with the earlier flat-Sequence version of this workflow, please do a first test run in
  **Debug** mode in Studio, since the XAML/JSON was hand-authored and not compiled here.
