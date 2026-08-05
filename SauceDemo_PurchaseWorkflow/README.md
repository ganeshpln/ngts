# SauceDemo Purchase Workflow (UiPath)

A UiPath RPA project that automates a full end-to-end purchase on
[saucedemo.com](https://www.saucedemo.com/) using the standard test account.

## What it does

1. Opens `https://www.saucedemo.com/` in Chrome.
2. Logs in with `standard_user` / `secret_sauce`.
3. Adds the first two products (**Sauce Labs Backpack**, **Sauce Labs Bike Light**) to the cart.
4. Opens the cart.
5. Proceeds to checkout.
6. Enters sample customer details: First Name `John`, Last Name `Doe`, Zip `600001`.
7. Continues to the order overview page.
8. Captures the order total text (`.summary_total_label`) into the `TotalAmount` variable.
9. Clicks **Finish** to complete the order.
10. Logs the captured total to the Output panel (`Log Message`).
11. Closes the browser tab.

## How to run

1. Install [UiPath Studio](https://www.uipath.com/product/studio) (Community edition is fine) and Google Chrome.
2. Make sure the **UiPath Extension for Chrome** is installed and enabled (Studio prompts for this on first web automation run).
3. Open Studio, choose **Open Project**, and select this folder (`project.json`).
4. Let Studio restore the two dependencies listed in `project.json`:
   - `UiPath.System.Activities`
   - `UiPath.UIAutomation.Activities`
5. Open `Main.xaml` and press **Run** (F5) / **Debug File**.

## Notes

- This project was authored by hand (XAML/JSON) outside of UiPath Studio, targeting the classic
  `UiPath.Core.Activities` (Open Browser / Type Into / Click / Get Text / Close Tab) with plain
  attribute-based web selectors, for maximum compatibility across recent Studio versions.
- Selectors target the stable element `id`/`class` attributes SauceDemo has used for years
  (e.g. `#user-name`, `#login-button`, `#add-to-cart-sauce-labs-backpack`, `.shopping_cart_link`,
  `#checkout`, `#first-name`, `#last-name`, `#postal-code`, `#continue`, `.summary_total_label`,
  `#finish`). If the site markup ever changes, open the affected activity in Studio and use
  **Indicate element on screen** to re-capture the selector.
- Since this was not compiled/run inside an actual UiPath Studio instance, please do a first
  test run in **Debug** mode and use **Repair** on any activity Studio flags, though the XAML
  follows the standard schema Studio exports.
- The workflow is set to `Windows-Legacy` target framework to keep the classic recording
  activities (Open Browser/Click/Type Into/Get Text) available as simple, single-file activities.
