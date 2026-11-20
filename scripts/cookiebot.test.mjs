import assert from "node:assert/strict";
import test from "node:test";
import { cookiesToCsv, parseCookiebotHtml } from "../src/utils/cookiebotHtml.js";

function modernRow(name, blocked, provider = "example.com") {
  return `<tr class="odd">
    <td><span class="cookie-name">${name}</span><div class="cookie-detail"><b>First found URL:</b>
      <a href="https://example.com/">https://example.com/</a><br><b>Initiator:</b> Script tag<br><b>Source:</b> Inline script</div>
      ${blocked ? `<div><b>Blocked until accepted by user:</b> <span class="no-consent-badge">${blocked}</span></div>` : ""}
    </td>
    <td data-label="Provider">${provider}</td><td data-label="Type">HTML</td><td data-label="Maximum Storage Duration">Persistent</td>
  </tr>`;
}

test("reads the consent flag and metadata from the same modern cookie row", () => {
  const { cookies, notBlocked } = parseCookiebotHtml(`
    <tr><td>
      <span class="cat-name">Category: Marketing</span><span class="cat-badge">4</span>
      <table class="cookie-table"><tbody>
        ${modernRow("missing-status", "")}
        ${modernRow("_boomr_akamaiXhrRetry", "No", "s.go-mpulse.net")}
        ${modernRow("_boomr_akamaiXhrRetry", "No", "s.go-mpulse.net")}
        ${modernRow("blocked", "Yes")}
      </tbody></table>
      <span class="cat-name">Category: Unclassified</span><span class="cat-badge">1</span>
      <table class="cookie-table"><tbody>${modernRow("blank-provider", "No", "")}</tbody></table>
      <span class="cat-name">New cookies (1)</span>
      <table class="cookie-table"><tbody>${modernRow("also-in-change-log", "No")}</tbody></table>
      <span class="cat-name">Removed cookies (1)</span>
      <table class="cookie-table"><tbody>${modernRow("removed", "No")}</tbody></table>
    </td></tr>
  `);

  assert.equal(cookies.length, 5);
  assert.deepEqual(cookies.map(({ blocked }) => blocked), ["", "No", "No", "Yes", "No"]);
  assert.deepEqual(notBlocked.map(({ name }) => name), ["_boomr_akamaiXhrRetry", "blank-provider"]);
  assert.deepEqual(notBlocked[0], {
    category: "Marketing",
    name: "_boomr_akamaiXhrRetry",
    provider: "s.go-mpulse.net",
    type: "HTML",
    duration: "Persistent",
    firstUrl: "https://example.com/",
    initiator: "Script tag",
    source: "Inline script",
    blocked: "No",
  });
  assert.match(cookiesToCsv(notBlocked), /\n2,Unclassified,blank-provider,,HTML,Persistent,https:\/\/example\.com\//);
});

test("still flags explicitly unblocked cookies in the legacy two-row layout", () => {
  const { notBlocked } = parseCookiebotHtml(`
    <h2>Unclassified (1)</h2>
    <table>
      <tr><td>legacy-cookie</td><td>example.com</td><td>HTTP</td><td>1 day</td></tr>
      <tr><td colspan="4"><b>First found URL: </b>https://example.com/<br>
        <b>Blocked until accepted by user: </b><font color="red">No</font>
      </td></tr>
    </table>
  `);

  assert.deepEqual(notBlocked.map(({ name, category }) => [name, category]), [
    ["legacy-cookie", "Unclassified"],
  ]);
});
