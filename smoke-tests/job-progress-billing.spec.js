
const {test,expect} = require("@playwright/test");
const {directoryState,serveDirectory,openDirectoryJob} = require("./fixtures/job-readability-fixture");
for (const width of [390,1366]) test(`progress billing stays active and records history at ${width}px`,async({page},testInfo)=>{
  const state = directoryState(), original = JSON.stringify(state.jobs);
  const captures = await serveDirectory(page,state); const rows=[],calls=[];
  await page.setViewportSize({width,height:950});
  await page.route("**/api/job-progress-billing*",async route=>{
    const req=route.request();
    if(req.method()==="GET") return route.fulfill({json:{requests:rows,count:rows.length}});
    const body=req.postDataJSON(); calls.push(body);
    if(body.action==="request") {
      if(!rows.some(r=>!r.cancelled_at && !r.exported_at)) rows.unshift({id:body.requestId,requested_at:"2026-11-09T13:05:00Z",requested_by_name:"QA Administrator",cancelled_at:null,exported_at:null});
    } else rows.find(r=>r.id===body.requestId).cancelled_at="2026-11-09T13:10:00Z";
    return route.fulfill({json:{request:rows[0]}});
  });
  await page.getByLabel("Search jobs",{exact:true}).fill("26903");
  const row=page.locator(".jobs-table tbody tr");
  await row.locator(".job-status-menu > summary").click();
  await row.getByRole("button",{name:"Progress Billing - job 26903",exact:true}).click();
  await expect(page.getByRole("tab",{name:"Progress Billing",exact:true})).toHaveAttribute("aria-selected","true");
  await expect(page.locator(".job-topline .status-pill")).toHaveText("Active");
  const panel=page.getByRole("region",{name:"Progress billing history"});
  await expect(panel.getByText("Pending export",{exact:true})).toBeVisible();
  await expect(panel).toContainText("Nov 9, 2026");
  await expect(panel).toContainText("Requested by QA Administrator");
  await expect(panel.getByRole("button",{name:"Requested for next export"})).toBeDisabled();
  await expect(page.locator(".progress-billing-log li")).toHaveCount(1);
  const selectedTab = await page.getByRole("tab",{name:"Progress Billing",exact:true}).boundingBox();
  expect(selectedTab.x).toBeGreaterThanOrEqual(0); expect(selectedTab.x+selectedTab.width).toBeLessThanOrEqual(width);
  await page.screenshot({path:testInfo.outputPath(`billing-${width}.png`),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)).toBe(false);
  page.once("dialog",d=>d.accept()); await panel.getByRole("button",{name:"Cancel request",exact:true}).click();
  await expect(panel.getByText("Cancelled",{exact:true})).toBeVisible();
  await panel.getByRole("button",{name:"Request progress billing",exact:true}).click();
  await expect(page.locator(".progress-billing-log li")).toHaveCount(2);
  Object.assign(rows[0],{exported_at:"2026-11-09T14:00:00Z",export_version:7,export_cycle:1,export_color:"orange"});
  await panel.getByRole("button",{name:"Refresh billing history"}).click();
  await expect(panel).toContainText("Included in export V7");
  await page.getByRole("button",{name:"← All jobs",exact:true}).click();
  await openDirectoryJob(page,"26903");
  await page.getByRole("tab",{name:"Progress Billing",exact:true}).click();
  await expect(panel).toContainText("Included in export V7");
  expect(JSON.stringify(state.jobs)).toBe(original);
  expect(captures.jobInfo).toEqual([]);
  expect(captures.unexpectedRequests).toEqual([]);
});
test("a failed request leaves the job active and allows an idempotent retry",async({page})=>{
  const captures=await serveDirectory(page,directoryState()); const ids=[];
  await page.route("**/api/job-progress-billing*",async route=>{
    ids.push(route.request().postDataJSON().requestId);
    return route.fulfill({status:500,json:{error:"Billing service unavailable"}});
  });
  await openDirectoryJob(page,"26901");
  const button=page.getByRole("button",{name:"Progress Billing - job 26901",exact:true});
  await button.click(); await expect(page.getByText("Billing service unavailable")).toBeVisible();
  await button.click(); await expect(button).toBeEnabled();
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  await expect(page.locator(".job-topline .status-pill")).toHaveText("Active");
  expect(captures.jobInfo).toEqual([]);
});
