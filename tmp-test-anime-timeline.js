const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const speakerContext = await browser.newContext();
  const audienceContext = await browser.newContext();

  const speakerPage = await speakerContext.newPage();
  const audiencePage = await audienceContext.newPage();

  await speakerPage.goto('http://localhost:3002/speaker');
  await audiencePage.goto('http://localhost:3002/');

  // Wait for anime.js to load
  await speakerPage.waitForTimeout(2000);
  await audiencePage.waitForTimeout(2000);

  // Click Run Timeline on speaker
  await speakerPage.click('button:has-text("Run Timeline")');

  // Wait for timeline to complete
  await speakerPage.waitForTimeout(3000);
  await audiencePage.waitForTimeout(3000);

  // Get computed transforms of timeline boxes on both pages
  const getBoxStyles = async (page) => {
    return await page.evaluate(() => {
      return [1, 2, 3, 4].map((i) => {
        const el = document.getElementById('an-tl-' + i);
        if (!el) return null;
        const style = window.getComputedStyle(el);
        return {
          id: 'an-tl-' + i,
          transform: style.transform,
          translateY: el.style.transform
        };
      });
    });
  };

  const speakerStyles = await getBoxStyles(speakerPage);
  const audienceStyles = await getBoxStyles(audiencePage);

  console.log('Speaker styles:', JSON.stringify(speakerStyles, null, 2));
  console.log('Audience styles:', JSON.stringify(audienceStyles, null, 2));

  const allMatch = speakerStyles.every((s, i) => {
    const a = audienceStyles[i];
    return s && a && s.transform === a.transform;
  });

  console.log('All transforms match:', allMatch);

  await speakerPage.screenshot({ path: 'speaker-anime-timeline.png' });
  await audiencePage.screenshot({ path: 'audience-anime-timeline.png' });

  await browser.close();
})();
