import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { createServer } from "vite";

let server;
let browser;
let url;

before(async () => {
  server = await createServer({
    envFile: false,
    base: "/",
    optimizeDeps: { include: ["react", "react-dom/client"] },
    plugins: [{
      name: "org-picker-test-harness",
      resolveId(id) { return id === "virtual:org-picker-test" ? "\0virtual:org-picker-test" : null; },
      load(id) {
        if (id !== "\0virtual:org-picker-test") return null;
        return `
          import React, { useState } from "react";
          import { createRoot } from "react-dom/client";
          import Picker from "/src/components/OrgSkillPicker.jsx";
          export function mount() {
            const host = document.createElement("main");
            document.body.replaceChildren(host);
            function App() {
              const [value, setValue] = useState([]);
              return React.createElement(React.Fragment, null,
                React.createElement(Picker, {
                  skills: [{ id: "vue", name: "Vue" }, { id: "react", name: "React" }],
                  value, onChange: setValue,
                }),
                React.createElement("button", { type: "button", style: { marginTop: 300 } }, "Outside"),
              );
            }
            createRoot(host).render(React.createElement(App));
          }
        `;
      },
    }],
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  url = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function picker(options = {}) {
  const page = await browser.newPage(options);
  page.setDefaultTimeout(5000);
  await page.goto(url);
  await page.evaluate(async () => {
    const { mount } = await import("/@id/__x00__virtual:org-picker-test");
    mount();
  });
  await page.locator("summary").waitFor();
  return page;
}

test("outside click closes the picker and keeps selections while inside clicks do not close it", async () => {
  const page = await picker();
  try {
    const details = page.locator("details");
    await page.locator("summary").click();
    await page.getByLabel("Vue").check();
    assert.equal(await details.evaluate((element) => element.open), true);
    await page.getByLabel("React").check();
    await page.getByLabel("React").uncheck();
    assert.equal(await details.evaluate((element) => element.open), true);
    await page.getByRole("button", { name: "Outside" }).click();
    assert.equal(await details.evaluate((element) => element.open), false);
    assert.match(await page.locator("summary").textContent(), /1 selected: Vue/);
    await page.locator("summary").click();
    assert.equal(await page.getByLabel("Vue").isChecked(), true);
    assert.equal(await page.getByLabel("React").isChecked(), false);
  } finally {
    await page.close();
  }
});

test("outside tap and Escape close the picker without clearing selections", async () => {
  const page = await picker({ hasTouch: true });
  try {
    const details = page.locator("details");
    await page.locator("summary").tap();
    await page.getByLabel("Vue").tap();
    assert.equal(await details.evaluate((element) => element.open), true);
    await page.getByRole("button", { name: "Outside" }).tap();
    assert.equal(await details.evaluate((element) => element.open), false);
    await page.locator("summary").tap();
    assert.equal(await page.getByLabel("Vue").isChecked(), true);
    await page.keyboard.press("Escape");
    assert.equal(await details.evaluate((element) => element.open), false);
    assert.match(await page.locator("summary").textContent(), /1 selected: Vue/);
  } finally {
    await page.close();
  }
});
