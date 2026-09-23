const {test,expect}=require('@playwright/test');
const {directoryState,serveDirectory}=require('./fixtures/job-readability-fixture');
test('Dashboard new quote route creates one draft through the existing quote workflow',async({page})=>{
 const state=directoryState();const captures=await serveDirectory(page,state);
 await page.goto('/estimating/index.html?dev=1&newQuote=1');
 await expect(page.getByRole('tab',{name:/Details/})).toBeVisible();
 await expect(page).not.toHaveURL(/newQuote/);
 await expect.poll(()=>captures.writes.at(-1)?.quotes.length).toBe(state.quotes.length+1);
 expect(captures.writes.at(-1).settings.nextQuoteNumber).toBe(state.settings.nextQuoteNumber+1);
 await page.waitForTimeout(700);
 expect(captures.writes.at(-1).quotes.length).toBe(state.quotes.length+1);
});
test('Dashboard quotes link opens quote library directly',async({page})=>{
 await serveDirectory(page,directoryState());await page.goto('/estimating/index.html?dev=1&view=quotes');
 await expect(page.getByRole('textbox',{name:'Search quotes'})).toBeVisible();
});
