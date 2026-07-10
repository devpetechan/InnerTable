// Reproduce the iPhone list view and report every element that sticks out
// past the right edge of the viewport.
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

  await page.goto('http://localhost:8123/index.html', { waitUntil: 'networkidle2', timeout: 30000 });

  const report = await page.evaluate(() => {
    // Stub auth + data (globals from the app's own scripts)
    currentUser = { id: 'u1', display_name: 'pete.chan@gmail.com', avatar_url: null, is_admin: false };
    const take = (author, userId, status, rating, notes) => ({
      entryId: 'e-' + author + status, userId, author,
      ts: Date.now(), status, rating,
      factorRatings: { quality: 0, service: 0, value: 0, ambiance: 0 },
      notes, tryNote: '', url: ''
    });
    const mk = (id, name, cuisine, price, location, placeType, takes) => {
      const agg = { avgRating: 0, ratingsCount: 0, recommends: [], hardPasses: [], wantsToGo: [], triedBy: [] };
      let tot = 0, n = 0;
      takes.forEach(t => {
        if (t.status === 'been-recommend') { agg.recommends.push(t.author); agg.triedBy.push(t.author); }
        if (t.status === 'want-to-go') agg.wantsToGo.push(t.author);
        if (t.rating > 0) { tot += t.rating; n++; }
      });
      agg.avgRating = n ? tot / n : 0; agg.ratingsCount = n;
      return { id, name, cuisine, price, location, lat: null, lng: null, googlePlaceId: null,
               placeType, takes, comments: [], aggregate: agg, external: { rating: 4.4, ratingCount: 1234 } };
    };
    allPlaces = {
      p1: mk('p1', 'Seed Library', null, null, 'London E1 6JQ, UK', 'bar',
        [take('pete.chan@gmail.com', 'u1', 'been-recommend', 4, '')]),
      p2: mk('p2', 'Side Hustle', 'Cocktail Bar', '$$$', 'London WC2E 7AW, UK', 'bar',
        [take('pete.chan@gmail.com', 'u1', 'been-recommend', 5, ''),
         take('Peter Chan', 'u2', 'been-recommend', 5, 'Drinks are great. The Mexican food is also pretty tasty. Get a bit of both.')]),
      p3: mk('p3', 'The Lauriston', null, '$$', 'London E9 7JN, UK', 'restaurant',
        [take('pete.chan@gmail.com', 'u1', 'been-recommend', 4, 'Decent pub, standard beer list, pretty good pizza')])
    };
    placesLoaded = true;
    document.getElementById('welcome-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    navigateToList('all');

    const vw = document.documentElement.clientWidth;
    const offenders = [];
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.position === 'fixed') return;
      if (r.right > vw + 0.5) {
        offenders.push({
          desc: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
          left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width)
        });
      }
    });
    return {
      viewport: vw,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders
    };
  });

  console.log(JSON.stringify(report, null, 2));
  await page.screenshot({ path: 'list-390.png', fullPage: false });
  await browser.close();
})();
